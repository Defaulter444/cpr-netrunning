import {openFloorFindings} from './findings.js';
import {mutate} from '../data.js';
import {loc,dialogClasses} from '../constants.js';
import {overviewTokens,overviewMove,escapeOverview as esc} from './console-overview.mjs';

export function activateOverview(app,root) {
  app._consoleDragCleanup?.();
  const canvas=app._consoleCanvas, archId=canvas?.archId;
  const tokens=overviewTokens(canvas), tokenFor=ref=>tokens.find(t=>t.ref===ref);
  root.querySelectorAll('[data-console-note]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    const floor=canvas?.floors?.find(f=>f.index===Number(button.dataset.consoleNote));
    if(!game.user.isGM||floor?.encrypted||!floor?.hasNote)return;
    new Dialog({title:`Заметка Мастера · ${floor.label}`,content:`<div class="nc-overview-note-dialog">${esc(floor.description)}</div>`,buttons:{close:{label:'Закрыть'}},default:'close'},{classes:dialogClasses()}).render(true);
  }));
  const current=()=>app._consoleCanvas?.archId===archId&&root.isConnected;
  const warn=result=>{if(result!==true&&result?.ok!==true)ui.notifications.warn((result?.error?loc(result.error):'')||'Действие не выполнено. Проверьте подключение и права участника.');};
  const target=async ref=>{
    if(!current()||(ref&&!tokenFor(ref)))return;
    try{warn(await mutate('session.setTarget',{entityRef:ref}));}catch(e){ui.notifications.warn(e.message);}
  };
  const move=async(ref,floorIndex)=>{
    const plan=overviewMove(app._consoleCanvas,ref,floorIndex,{placement:game.user.isGM&&app.state.consoleMoveMode!=='run'});
    if(!current()||!plan||app._consoleMoving)return;
    app._consoleMoving=true;
    try {
      const result=await mutate(plan.op,plan.payload);warn(result);
      if(result===true||result?.ok===true){
        app.state.consoleFloor=floorIndex;app.state.consoleFocusFloor=floorIndex;
        // Moving an architecture entity changes the floor segment of its ref.
        if(plan.op==='ent.move'&&app.state.selection===ref){const floor=canvas.floors.find(f=>f.index===floorIndex);const parts=ref.split(':');parts[2]=floor.floorId;app.state.selection=parts.join(':');}
      }
    }catch(e){ui.notifications.warn(e.message);}finally{app._consoleMoving=false;app.render(false);}
  };
  const targetSelect=root.querySelector('[data-console-target-select]');
  if(targetSelect){
    for(const t of tokens){
      const kind=t.ref.startsWith('runner:')?'Нетраннер':t.isDemon?'Демон':t.ref.startsWith('prog:')?'Программа':'Чёрный ЛЁД';
      const option=document.createElement('option');option.value=t.ref;
      const peers=tokens.filter(p=>p.floorIndex===t.floorIndex&&p.name===t.name);
      option.textContent=`${t.name}${peers.length>1?` #${peers.findIndex(p=>p.ref===t.ref)+1}`:''} · ${kind} · этаж ${t.floorIndex+1}`;
      option.selected=!!t.targeted;targetSelect.append(option);
    }
    if(app._consoleTargetRef&&!tokens.some(t=>t.targeted)){
      const option=document.createElement('option');option.value='outside';option.disabled=true;option.selected=true;
      option.textContent='Текущая цель вне этого обзора';targetSelect.append(option);
    }
    targetSelect.addEventListener('change',()=>target(targetSelect.value));
  }
  const targetToken=tokens.find(t=>t.targeted);
  const controlTarget=root.querySelector('[data-console-control-target]');
  if(controlTarget){controlTarget.disabled=!targetToken?.selectable;controlTarget.addEventListener('click',()=>{
    if(!targetToken?.selectable)return;app.state.selection=targetToken.ref;app.state.consoleFloor=targetToken.floorIndex;app.render(false);
  });}
  root.querySelector('[data-console-clear-target]')?.addEventListener('click',()=>target(''));
  const mode=root.querySelector('[data-console-move-mode]');
  if(mode){mode.value=app.state.consoleMoveMode==='run'?'run':'place';mode.addEventListener('change',()=>{app.state.consoleMoveMode=mode.value;app.render(false);});}
  const hint=root.querySelector('[data-console-move-hint]');
  if(hint)hint.textContent=game.user.isGM&&app.state.consoleMoveMode!=='run'
    ?'Расстановка: двигается только выбранный токен; прежнее преследование раннера прекращается.'
    :'Ход: привязанный ЛЁД следует за раннером. Выберите преследователя целью и используйте «Подкат», чтобы попытаться уйти.';
  const pursuit=root.querySelector('[data-console-pursuit]');
  if(pursuit){
    const chasing=tokens.filter(t=>t.tether||t.isChasing);
    pursuit.textContent=chasing.map(t=>`${t.name} → ${t.tether?.name||t.chaseTitle||'преследует раннера'}`).join(' · ');
    pursuit.hidden=!chasing.length;
  }
  const selected=tokens.find(t=>t.ref===app.state.selection)??tokens.find(t=>t.isMine);
  const moveHere=root.querySelector('[data-console-move-here]');
  if(moveHere){moveHere.hidden=!selected?.canMove;moveHere.disabled=selected?.floorIndex===app.state.consoleFloor;moveHere.addEventListener('click',()=>move(selected.ref,app.state.consoleFloor));}
  let drag=null,suppressClick=false,scrollFrame=0;
  const viewport=root.querySelector('.nc-schematic-viewport');
  const clearDrop=()=>root.querySelectorAll('.is-token-drop').forEach(el=>el.classList.remove('is-token-drop'));
  const floorAt=(x,y)=>document.elementsFromPoint(x,y).map(el=>el.closest?.('[data-console-floor]')).find(el=>el&&root.contains(el));
  const updateDrop=()=>{clearDrop();const floor=floorAt(drag.x,drag.y);if(floor&&overviewMove(canvas,drag.ref,Number(floor.dataset.consoleFloor)))floor.classList.add('is-token-drop');};
  const cleanup=()=>{
    cancelAnimationFrame(scrollFrame);scrollFrame=0;clearDrop();app._consoleDragActive=false;
    if(drag){drag.slot.style.transform='';drag.slot.style.pointerEvents='';drag.slot.classList.remove('is-dragging');if(drag.button.hasPointerCapture(drag.id))drag.button.releasePointerCapture(drag.id);}
    drag=null;
  };
  app._consoleDragCleanup=cleanup;
  const autoScroll=()=>{
    if(!drag?.moved||!current())return cleanup();
    const r=viewport.getBoundingClientRect();
    viewport.scrollTop+=drag.y<r.top+35?-9:drag.y>r.bottom-35?9:0;
    viewport.scrollLeft+=drag.x<r.left+35?-9:drag.x>r.right-35?9:0;
    updateDrop();scrollFrame=requestAnimationFrame(autoScroll);
  };
  for(const el of root.querySelectorAll('[data-console-token]')){
    const ref=el.dataset.consoleToken,t=tokenFor(ref),button=el.querySelector('.nc-token-main');if(!t)continue;
    el.addEventListener('mouseenter',()=>{app.hovered=ref;});el.addEventListener('mouseleave',()=>{if(app.hovered===ref)app.hovered=null;});
    el.addEventListener('focusin',()=>{app.hovered=ref;});
    el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();target(ref);});
    el.querySelector('[data-console-target-token]').addEventListener('click',e=>{e.stopPropagation();target(ref);});
    button.addEventListener('click',e=>{
      e.stopPropagation();if(suppressClick){suppressClick=false;return;}
      if(ref.startsWith('runner:')&&t.selectable){app.state.selection=ref;app.state.consoleConnectPick=t.pid;app.state.consoleConnectArch='';app.state.consoleFloor=t.floorIndex;app.render(false);}else target(ref);
    });
    button.addEventListener('pointerdown',e=>{
      e.stopPropagation();suppressClick=false;if(e.button!==0||!t.canMove||app._consoleMoving)return;
      drag={id:e.pointerId,ref,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button,slot:el.closest('.nc-token-slot'),moved:false};
      button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      drag.x=e.clientX;drag.y=e.clientY;
      if(!drag.moved&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
      if(!drag.moved){drag.moved=true;app._consoleDragActive=true;drag.slot.classList.add('is-dragging');drag.slot.style.pointerEvents='none';scrollFrame=requestAnimationFrame(autoScroll);}
      // CSS transform on the SVG foreignObject uses its own SVG coordinate system.
      const svg=root.querySelector('.nc-iso'),scale=svg.getBoundingClientRect().width/Number(svg.dataset.mapWidth);
      drag.slot.style.transform=`translate(${(drag.x-drag.startX)/scale}px,${(drag.y-drag.startY)/scale}px)`;updateDrop();
    });
    button.addEventListener('pointerup',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      const moved=drag.moved,ref=drag.ref,floor=moved?floorAt(e.clientX,e.clientY):null;
      suppressClick=moved;cleanup();if(floor)move(ref,Number(floor.dataset.consoleFloor));
    });
    button.addEventListener('pointercancel',cleanup);
    button.addEventListener('lostpointercapture',()=>{if(drag)cleanup();});
  }
  for(const button of root.querySelectorAll('[data-console-object]'))button.addEventListener('click',e=>{
    e.stopPropagation();if(!current())return;
    const index=Number(button.dataset.consoleObject),floor=canvas.floors.find(f=>f.index===index);if(!floor)return;
    app.state.consoleFloor=index;
    const details=()=>{app.state.consoleSection='detail';app.state.consoleDetailFocus=index;app.render(false);};
    if(floor.encrypted){ui.notifications.info('Этаж ещё не исследован. Используйте «Следопыт» или перейдите на него.');return;}
    if(!floor.holdsFile&&floor.kind!=='file'&&!(floor.contentsVisible&&(floor.findings?.length||floor.contents||floor.contentsImage))){details();return;}
    openFloorFindings(app,floor,details);
  });
}
