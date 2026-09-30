import {contentDialogKeys} from './dialog-keys.js';
import {ICE_PROFILES,ICE_PHASES,iceProfile} from './ice-profiles.mjs';
import {previewIce,stopIceEffects,unlockIceAudio} from './ice-effects.mjs';
import {MODULE_ID,loc} from '../constants.js';
import {layoutPreferences,PANEL_KEYS,motionAllowed} from './console-layout.mjs';
import {playConsoleEffect,stopConsoleEffects,EFFECT_KINDS} from './console-effects.mjs';

const LABELS={left:'Нетраннер',right:'Устройства и оснащение',controls:'Управление',log:'Журнал'};
export function activateDisplay(app,root){
  app._consoleDisplayCleanup?.();
  let timer=0,frame=0,disposed=false,narrow=root.clientWidth<680,narrowOpen=app._consoleRevealPanel||'';
  delete app._consoleRevealPanel;
  const prefs=app._consoleLayout;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const complete=()=>{clearTimeout(timer);delete root.dataset.panelAnimating;app._consoleRelayout?.();};
  const update=(animate=false)=>{
    const overview=app.state.consoleSection==='overview'||!app.state.consoleSection;
    if(animate&&!root.dataset.panelAnimating)app._consoleCaptureView?.();
    if(animate&&motionAllowed(app,null,root)){root.dataset.panelAnimating='true';clearTimeout(timer);timer=setTimeout(complete,prefs.duration+60);}
    root.style.setProperty('--nc-motion-ms',`${prefs.duration}ms`);
    root.classList.toggle('nc-compact',prefs.compact);
    root.classList.toggle('nc-narrow',narrow);
    for(const key of PANEL_KEYS){
      const visible=!overview||(narrow&&['left','right'].includes(key)?narrowOpen===key:prefs[key]),panel=root.querySelector(`[data-console-panel="${key}"]`),button=root.querySelector(`[data-console-panel-toggle="${key}"]`);
      if(!visible&&panel?.contains(document.activeElement))button?.focus();
      root.classList.toggle(`nc-hide-${key}`,!visible);
      if(panel){panel.inert=!visible;panel.setAttribute('aria-hidden',String(!visible));}
      if(button){button.setAttribute('aria-expanded',String(visible));button.classList.toggle('active',visible);button.title=`${visible?'Скрыть':'Показать'}: ${LABELS[key]}`;button.dataset.tooltip=button.title;}
    }
    const allHidden=PANEL_KEYS.every(k=>!prefs[k]);
    const focus=root.querySelector('[data-console-focus]');
    if(focus){focus.setAttribute('aria-pressed',String(allHidden));focus.textContent=allHidden?'Вернуть панели':'Только схема';focus.dataset.tooltip=focus.textContent;}
    if(!animate||!motionAllowed(app,null,root))complete();
  };
  const save=()=>{app._consoleLayout={...prefs};game.settings.set(MODULE_ID,'consoleLayout',{...prefs});};
  for(const b of root.querySelectorAll('[data-console-panel-toggle]'))b.addEventListener('click',()=>{const key=b.dataset.consolePanelToggle;if(narrow&&['left','right'].includes(key)){narrowOpen=narrowOpen===key?'':key;update(true);return;}prefs[key]=!prefs[key];update(true);save();});
  root.querySelector('[data-console-focus]')?.addEventListener('click',()=>{
    if(PANEL_KEYS.every(k=>!prefs[k]))Object.assign(prefs,app._consoleLayoutRestore??Object.fromEntries(PANEL_KEYS.map(k=>[k,true])));
    else{app._consoleLayoutRestore=Object.fromEntries(PANEL_KEYS.map(k=>[k,prefs[k]]));for(const k of PANEL_KEYS)prefs[k]=false;}
    update(true);save();
  });
  const status=root.querySelector('[data-console-view-status]');
  const statusUpdate=()=>{
    const mode=root.querySelector('[data-console-move-mode]'),target=root.querySelector('[data-console-target-select]');
    if(status){status.textContent=[mode?.selectedOptions[0]?.textContent,target?.value?`Цель: ${target.selectedOptions[0]?.textContent}`:''].filter(Boolean).join(' · ');status.title=status.textContent;}
  };
  statusUpdate();root.querySelector('[data-console-move-mode]')?.addEventListener('change',statusUpdate);
  const onMotion=()=>{if(!motionAllowed(app)){stopConsoleEffects(app);stopIceEffects(app);app._consoleGeometryCleanup?.();complete();}};
  motion.addEventListener('change',onMotion);
  const visibility=()=>{root.classList.toggle('nc-page-hidden',document.hidden);if(document.hidden){stopIceEffects(app);stopConsoleEffects(app);}};
  document.addEventListener('visibilitychange',visibility);visibility();
  const resize=new ResizeObserver(()=>{const next=root.clientWidth<680;if(next!==narrow){narrow=next;narrowOpen='';update(false);}});resize.observe(root);
  app._consoleApplyDisplay=()=>{Object.assign(prefs,layoutPreferences(game.settings.get(MODULE_ID,'consoleLayout')));update(true);};
  root.querySelector('[data-console-display]')?.addEventListener('click',()=>openDisplaySettings(app));
  for(const img of root.querySelectorAll('.nc-file-thumb img'))img.addEventListener('error',()=>{img.hidden=true;img.closest('.nc-file-thumb').classList.add('image-unavailable');});
  root.classList.add('nc-no-anim');update();
  frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{if(!disposed)root.classList.remove('nc-no-anim');});});
  app._consoleDisplayCleanup=()=>{disposed=true;clearTimeout(timer);cancelAnimationFrame(frame);resize.disconnect();motion.removeEventListener('change',onMotion);document.removeEventListener('visibilitychange',visibility);delete root.dataset.panelAnimating;};
}

function openDisplaySettings(app){
  if(app._consoleDisplayDialog?.rendered){app._consoleDisplayDialog.bringToTop();return;}
  const prefs=layoutPreferences(game.settings.get(MODULE_ID,'consoleLayout'));
  const enabled=game.settings.get(MODULE_ID,'consoleMotion')!==false,force=game.settings.get(MODULE_ID,'consoleForceMotion')===true;
  const content=`<div class="nc-display-settings">
    <header><i class="fas fa-wand-magic-sparkles"></i><div><small>КОНСОЛЬ / ЛИЧНЫЕ НАСТРОЙКИ</small><h2>Движение и эффекты</h2><p>Настройте обзор под свой стиль игры.</p></div></header>
    <section><h3>АНИМАЦИЯ</h3><label class="nc-setting-switch"><span>Плавное движение и эффекты действий</span><input name="motion" type="checkbox" ${enabled?'checked':''}></label>
    <label class="nc-setting-switch"><span>Анимация при системном ограничении движения<small>Включите, если эффекты отключены настройкой ОС.</small></span><input name="force" type="checkbox" ${force?'checked':''}></label>
    <label class="nc-setting-select">Скорость переходов<select name="duration"><option value="180" ${prefs.duration===180?'selected':''}>Быстро</option><option value="300" ${prefs.duration===300?'selected':''}>Плавно</option><option value="450" ${prefs.duration===450?'selected':''}>Размеренно</option></select></label></section>
    <section><h3>МЕСТО ДЛЯ СХЕМЫ</h3><label class="nc-setting-switch"><span>Компактные боковые панели</span><input name="compact" type="checkbox" ${prefs.compact?'checked':''}></label><div class="nc-settings-panels">${PANEL_KEYS.map(k=>`<label><input name="${k}" type="checkbox" ${prefs[k]?'checked':''}> ${LABELS[k]}</label>`).join('')}</div></section>
    <section class="nc-ice-preview"><h3>ХАРАКТЕР ЧЁРНОГО ЛЬДА</h3><div class="nc-ice-preview-select"><select name="ice-type" aria-label="Тип ЛЬДА">${Object.entries(ICE_PROFILES).map(([k,p])=>`<option value="${k}">${p.name}</option>`).join('')}</select><select name="ice-phase" aria-label="Событие">${Object.entries(ICE_PHASES).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></div><canvas data-ice-preview width="510" height="215" aria-label="Предпросмотр ЛЬДА"></canvas><p data-ice-description></p><button type="button" data-ice-play><i class="fas fa-play"></i> Проиграть</button><p>Предпросмотр не расходует действия.</p><label class="nc-setting-switch"><span>Звуки ЛЬДА<small>Только на этом устройстве</small></span><input name="ice-sound" type="checkbox" ${game.settings.get(MODULE_ID,'iceSound')?'checked':''}></label><label class="nc-setting-select">Громкость<input name="ice-volume" type="range" min="0" max="100" value="${Math.round(game.settings.get(MODULE_ID,'iceVolume')*100)}"></label></section>
    <section><h3>ПРОВЕРИТЬ ЭФФЕКТ</h3><div class="nc-effect-picker">${EFFECT_KINDS.map(k=>`<button type="button" data-preview-kind="${k}"><i class="fas ${({zap:'fa-bolt',scan:'fa-satellite-dish',program:'fa-microchip',breach:'fa-unlock',speed:'fa-forward-fast',defense:'fa-shield-halved',cloak:'fa-ghost'})[k]}"></i>${loc(`CRNS.Console.Effects.${k}`)}</button>`).join('')}</div><p class="nc-preview-status" aria-live="polite">Предпросмотр в обзоре. Для разряда нужны видимые токены раннера и цели.</p></section>
  </div>`;
  let stopPreview=()=>{};
  const dialog=new Dialog({title:'Вид и эффекты',content,buttons:{apply:{icon:'<i class="fas fa-check"></i>',label:'Применить',callback:async html=>{
    const el=html[0],checked=name=>el.querySelector(`[name="${name}"]`).checked;
    const next=layoutPreferences({...Object.fromEntries(PANEL_KEYS.map(k=>[k,checked(k)])),compact:checked('compact'),duration:Number(el.querySelector('[name="duration"]').value)});
    // Save personal preferences only. No session or architecture mutation.
    await game.settings.set(MODULE_ID,'consoleLayout',next);app._consoleLayout=next;
    await game.settings.set(MODULE_ID,'consoleForceMotion',checked('force'));
    await game.settings.set(MODULE_ID,'consoleMotion',checked('motion'));
    await game.settings.set(MODULE_ID,"iceSound",checked("ice-sound"));
    await game.settings.set(MODULE_ID,"iceVolume",Number(el.querySelector('[name="ice-volume"]').value)/100);
    stopConsoleEffects(app);stopIceEffects(app);
    app._consoleApplyDisplay?.();app.render(false);
  }},cancel:{label:'Закрыть'}},render:html=>{contentDialogKeys(html[0]);
    const root=html[0];
    const play=()=>{stopPreview();const type=root.querySelector('[name="ice-type"]').value;root.querySelector('[data-ice-description]').textContent=iceProfile(type).description;stopPreview=previewIce(root.querySelector('[data-ice-preview]'),type,root.querySelector('[name="ice-phase"]').value,{enabled:root.querySelector('[name="motion"]').checked,force:root.querySelector('[name="force"]').checked,sound:root.querySelector('[name="ice-sound"]').checked,volume:Number(root.querySelector('[name="ice-volume"]').value)/100});};
    root.querySelector('[data-ice-play]').addEventListener('click',play);
    root.querySelector('[name="ice-type"]').addEventListener('change',play);
    root.querySelector('[name="ice-phase"]').addEventListener('change',play);
    root.querySelector('[name="ice-sound"]').addEventListener('change',e=>{if(e.target.checked)unlockIceAudio();});
    for(const name of ['motion','force'])root.querySelector(`[name="${name}"]`).addEventListener('change',()=>{stopPreview();});
    root.querySelector('[data-ice-description]').textContent=iceProfile('asp').description;
    stopPreview=previewIce(root.querySelector('[data-ice-preview]'),'asp','appear',{enabled:false});
    html[0].querySelectorAll('[data-preview-kind]').forEach(b=>b.addEventListener('click',()=>{
      const root=app.element.find('.crns-console')[0];
      if(!root)return;
      const played=playConsoleEffect(app,b.dataset.previewKind,null,null,{enabled:html[0].querySelector('[name="motion"]').checked,force:html[0].querySelector('[name="force"]').checked});
      html[0].querySelector('.nc-preview-status').textContent=played?'Эффект запущен в обзоре. Игровое действие не расходуется.':'Эффект недоступен: включите анимацию и покажите нужные токены в обзоре.';
    }));
  },close:()=>{stopPreview();app._consoleDisplayDialog=null;}},{id:'crns-console-display',classes:['dialog','nc-display-window'],width:560,height:760,resizable:true});
  app._consoleDisplayDialog=dialog;dialog.render(true);
}
