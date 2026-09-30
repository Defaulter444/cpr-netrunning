import {contentDialogKeys} from './dialog-keys.js';
import {MODULE_ID,esc,uid} from '../constants.js';
import {mutate} from '../data.js';
import {FINDING_KINDS,floorFindings,normalizeFindings,findingSource} from '../findings-model.js';
import {canReadFinding,journalFindings} from '../findings-store.js';
const ICON={dossier:'fa-id-card',message:'fa-comments',image:'fa-image',audio:'fa-wave-square',map:'fa-map-location-dot'};
const opts=(current)=>Object.entries(FINDING_KINDS).map(([k,v])=>`<option value="${k}" ${current===k?'selected':''}>${v}</option>`).join('');
const classes=['dialog','nc-findings-window'];
export function editFindings(floor,onSave){
  if(!game.user.isGM)return;
  let draft=floorFindings(floor),selected=draft[0]?.id??'',dialog;
  const capture=root=>{
    const record=draft.find(f=>f.id===selected);if(!record)return;
    for(const key of ['title','kind','text','src','from','to'])record[key]=root.querySelector(`[name="${key}"]`)?.value??record[key];
  };
  const content=()=>{
    const f=draft.find(f=>f.id===selected);
    return `<div class="nc-findings-author"><header><small>АРХИТЕКТУРА / СОДЕРЖИМОЕ ЭТАЖА</small><h2>Файлы как находки</h2><p>Доступ открывается после «Идентификации». Сохранённые игроками копии останутся в коллекции после изменения оригинала.</p></header><div class="nc-findings-tabs">${draft.map(r=>`<button type="button" data-record="${r.id}" class="${r.id===selected?'active':''}"><i class="fas ${ICON[r.kind]}"></i> ${esc(r.title)}</button>`).join('')}<button type="button" data-add ${draft.length>=12?'disabled':''}><i class="fas fa-plus"></i> Добавить файл</button></div>${f?`<label>Название<input name="title" maxlength="120" value="${esc(f.title)}"></label><label>Формат<select name="kind">${opts(f.kind)}</select></label><div class="nc-findings-address" ${f.kind==='message'?'':'hidden'}><label>От<input name="from" maxlength="120" value="${esc(f.from)}"></label><label>Кому<input name="to" maxlength="120" value="${esc(f.to)}"></label></div><label>Текст / описание<textarea name="text" rows="7" maxlength="8000">${esc(f.text)}</textarea></label><div class="nc-findings-media" ${['image','map','audio'].includes(f.kind)?'':'hidden'}><label>Медиафайл<div class="nc-findings-source"><input name="src" value="${esc(f.src)}" placeholder="Выберите файл в хранилище Foundry"><button type="button" data-browse aria-label="Выбрать медиафайл"><i class="fas fa-folder-open"></i></button></div></label><small>Медиа хранится в файловом хранилище Foundry. Используйте непредсказуемые имена и ограничьте просмотр файлов в правах игроков.</small></div><button type="button" data-delete><i class="fas fa-trash"></i> Удалить этот файл из черновика</button>`:'<p class="nc-findings-empty">Добавьте досье, переписку, изображение, аудиозапись или план объекта.</p>'}<p class="nc-findings-status" role="status"></p></div>`;
  };
  const refresh=()=>{dialog.data.content=content();dialog.render(false);};
  dialog=new Dialog({title:'Находки на этаже',content:content(),buttons:{save:{label:'В черновик архитектуры',icon:'<i class="fas fa-check"></i>',callback:html=>{
    capture(html[0]);const bad=draft.find(f=>f.src&&['image','map','audio'].includes(f.kind)&&!findingSource(f.src,f.kind));
    if(bad){throw new Error('Неподдерживаемый медиафайл. Выберите изображение или аудиофайл подходящего формата.');}
    onSave(normalizeFindings(draft));
  }},cancel:{label:'Отмена'}},render:html=>{contentDialogKeys(html[0]);
    const root=html[0];
    root.querySelectorAll('[data-record]').forEach(b=>b.addEventListener('click',()=>{capture(root);selected=b.dataset.record;refresh();}));
    root.querySelector('[data-add]')?.addEventListener('click',()=>{capture(root);const f=normalizeFindings([{id:uid('find'),kind:'dossier',title:`Находка ${draft.length+1}`}])[0];draft.push(f);selected=f.id;refresh();});
    root.querySelector('[data-delete]')?.addEventListener('click',()=>{draft=draft.filter(f=>f.id!==selected);selected=draft[0]?.id??'';refresh();});
    root.querySelector('[name="kind"]')?.addEventListener('change',()=>{capture(root);refresh();});
    root.querySelector('[data-browse]')?.addEventListener('click',()=>{
      capture(root);const id=selected,f=draft.find(f=>f.id===id);
      new FilePicker({type:f.kind==='audio'?'audio':'image',current:f.src,callback:path=>{
        if(!dialog.rendered)return;
        const live=dialog.element?.[0];if(live)capture(live);
        const record=draft.find(r=>r.id===id);if(record)record.src=path;refresh();
      }}).browse();
    });
  }},{classes,width:650,height:'auto',resizable:true});dialog.render(true);
}
function body(f){
  return `<article class="nc-finding-body kind-${f.kind}"><div class="nc-finding-stamp"><i class="fas ${ICON[f.kind]}"></i> ${FINDING_KINDS[f.kind]} / ДОСТУП РАЗРЕШЁН</div><h2>${esc(f.title)}</h2>${f.kind==='message'?`<div class="nc-message-address"><b>ОТ</b> ${esc(f.from||'Неизвестно')}<br><b>КОМУ</b> ${esc(f.to||'Неизвестно')}</div>`:''}${f.src&&['image','map'].includes(f.kind)?`<button type="button" data-expand-image aria-label="Открыть изображение целиком"><img src="${esc(f.src)}" alt="${esc(f.title)}"></button>`:''}${f.src&&f.kind==='audio'?`<audio controls preload="none" src="${esc(f.src)}">Аудиозапись</audio>`:''}<div class="nc-finding-text">${esc(f.text||'').replace(/\n/g,'<br>')}</div></article>`;
}
function viewFinding(f,{collect,journal}={}){
  const buttons={};
  if(collect)buttons.collect={label:'Сохранить в коллекцию',icon:'<i class="fas fa-bookmark"></i>',callback:async()=>{
    const result=await mutate('finding.collect',{...collect,findingId:f.id});
    if(result?.ok)ui.notifications.info('Находка сохранена. Откройте «Находки» в верхнем меню.');else ui.notifications.warn('Не удалось сохранить находку. Проверьте доступ к файлу и присутствие Мастера.');
  }};
  if(journal)buttons.share={label:'Показать группе',icon:'<i class="fas fa-users"></i>',callback:()=>shareFinding(journal)};
  buttons.close={label:'Закрыть'};
  new Dialog({title:f.title,content:body(f),buttons,render:html=>{contentDialogKeys(html[0]);
    html[0].querySelector('[data-expand-image]')?.addEventListener('click',()=>new ImagePopout(f.src,{title:f.title,editable:false,shareable:game.user.isGM}).render(true));
    for(const media of html[0].querySelectorAll('img,audio'))media.addEventListener('error',()=>{const p=document.createElement('p');p.textContent='Медиафайл недоступен. Текст находки сохранён.';media.replaceWith(p);},{once:true});
  },close:html=>{html.find('audio').each((_,audio)=>audio.pause());}},{classes,width:720,height:'auto',resizable:true}).render(true);
}
export function openFloorFindings(app,floor,details){
  if(!floor.contentsVisible){new Dialog({title:'Файл закрыт',content:'<div class="nc-findings-empty"><i class="fas fa-lock"></i><p>Используйте «Идентификация» на этом этаже, чтобы открыть содержимое.</p></div>',buttons:{details:{label:'Карточка этажа',callback:details},close:{label:'Закрыть'}}},{classes,width:460}).render(true);return;}
  const list=floorFindings(floor);
  gallery({title:'Находки на этаже',entries:list.map(f=>({finding:f,collect:{archId:app._consoleCanvas.archId,floorId:floor.floorId,pid:app._consoleVisualPid}})),empty:'На этом этаже пока нет вложений.'});
}
function gallery({title,entries,empty}){
  new Dialog({title,content:`<div class="nc-findings-gallery"><header><small>ЛИЧНЫЙ АРХИВ / СЕТЕВЫЕ НАХОДКИ</small><h2>${esc(title)}</h2><input type="search" data-findings-search placeholder="Поиск по названию и содержимому" aria-label="Поиск находок"></header><div class="nc-findings-grid">${entries.map(({finding:f,journal},i)=>`<button type="button" class="nc-finding-tile kind-${f.kind}" data-finding-index="${i}">${f.src&&['image','map'].includes(f.kind)?`<img src="${esc(f.src)}" alt="" loading="lazy">`:`<i class="fas ${ICON[f.kind]}"></i>`}<small>${FINDING_KINDS[f.kind]}${journal&&journal.getFlag(MODULE_ID,'finding')?.collectorId!==game.user.id?' · ВАМ ПЕРЕДАЛИ':''}</small><strong>${esc(f.title)}</strong><span>${esc(f.text.slice(0,110))}</span></button>`).join('')}</div><p class="nc-findings-empty" data-empty ${entries.length?'hidden':''}>${esc(empty)}</p></div>`,buttons:{close:{label:'Закрыть'}},render:html=>{contentDialogKeys(html[0]);
    const root=html[0];root.querySelectorAll('[data-finding-index]').forEach(b=>b.addEventListener('click',()=>{const entry=entries[Number(b.dataset.findingIndex)];if(entry.journal&&!canReadFinding(entry.journal))return;viewFinding(entry.finding,entry);}));
    root.querySelector('[data-findings-search]').addEventListener('input',e=>{let count=0;for(const b of root.querySelectorAll('[data-finding-index]')){const f=entries[Number(b.dataset.findingIndex)].finding;b.hidden=!`${f.title} ${f.text}`.toLocaleLowerCase().includes(e.target.value.trim().toLocaleLowerCase());if(!b.hidden)count++;}const msg=root.querySelector('[data-empty]');msg.hidden=count>0;msg.textContent=entries.length?'Ничего не найдено.':empty;});
  }},{classes,width:Math.min(790,window.innerWidth-40),height:Math.min(740,window.innerHeight-60),top:25,resizable:true}).render(true);
}
export function openFindingsCollection(){
  const entries=game.journal.filter(j=>j.getFlag(MODULE_ID,'finding')&&canReadFinding(j)&&(!game.user.isGM||j.getFlag(MODULE_ID,'finding').collectorId===game.user.id)).sort((a,b)=>(b.getFlag(MODULE_ID,'finding').collectedAt??0)-(a.getFlag(MODULE_ID,'finding').collectedAt??0)||a.name.localeCompare(b.name)).flatMap(j=>journalFindings(j).map(f=>({finding:f,journal:j})));
  gallery({title:'Находки',entries,empty:'Коллекция пуста. Откройте доступный файл на этаже и нажмите «Сохранить в коллекцию».'});
}
function shareFinding(journal){
  const users=game.users.filter(u=>!u.isGM&&u.id!==game.user.id);
  new Dialog({title:'Показать находку группе',content:`<div class="nc-findings-share"><h2>${esc(journal.name)}</h2><p>Выбранные игроки получат постоянный доступ и ссылку в личном сообщении чата.</p>${users.map(u=>`<label><input type="checkbox" name="recipient" value="${u.id}" checked> ${esc(u.name)}</label>`).join('')||'<p>В мире нет других игроков.</p>'}</div>`,buttons:{share:{label:'Передать выбранным',callback:async html=>{
    const userIds=Array.from(html[0].querySelectorAll('[name="recipient"]:checked')).map(e=>e.value);if(!userIds.length)return;
    const result=await mutate('finding.share',{journalId:journal.id,userIds});ui.notifications[result?.ok?'info':'warn'](result?.ok?'Находка передана выбранным игрокам.':'Не удалось передать находку. Нужны доступ к записи и подключённый Мастер.');
  }},cancel:{label:'Отмена'}}},{classes,width:480}).render(true);
}
