import {iceSnapshot,iceChanges,iceProfile,queueIceChanges} from './ice-profiles.mjs';
import {playIceEffect,stopIceEffects,unlockIceAudio} from './ice-effects.mjs';
import {openFindingsCollection} from './findings.js';
import {layoutPreferences,animateGeometry} from './console-layout.mjs';
import {activateDisplay} from './console-display.js';
import {MODULE_ID,loc,esc} from '../constants.js';
import {connectionData,activateConnection} from './console-connect.js';
import {activateOverview} from './console-overview.js';
import {controlDeviceData} from './console-devices.mjs';
import {activateDevices} from './console-devices.js';
import {getDeck, installedPrograms} from '../cpr-bridge.js';
import {consoleGraph, consoleGraphScale, clampMapZoom, mapZoomAnchor} from './console-graph.mjs';
import {consoleSnapshot,consoleChanges,appendConsoleEvents,consoleFloorSummary} from './console-state.mjs';
import {playConsoleEffect,stopConsoleEffects,effectForChanges,EFFECT_KINDS} from './console-effects.mjs';
const ICONS={backdoor:'fa-code',cloak:'fa-ghost',control:'fa-cube',eyedee:'fa-eye',pathfinder:'fa-diagram-project',slide:'fa-angles-right',virus:'fa-biohazard',zap:'fa-bolt',speed:'fa-person-running',defense:'fa-shield-halved'};
const ART={backdoor:'locked-fortress',cloak:'ghost',control:'processor',eyedee:'cyber-eye',pathfinder:'radar-sweep',slide:'exit-door',virus:'virus',zap:'lightning-trio',speed:'circuitry',defense:'defensive-wall'};
export function consoleData(app,data){
  const action=data.actions??{}, actor=action.actorUuid?fromUuidSync(action.actorUuid):(action.actorId?game.actors.get(action.actorId):null);
  const deck=actor?getDeck(actor):null, programs=deck?installedPrograms(deck):[];
  const archId=data.canvas?.archId??'';
  const selected=app.state.consoleFloorArch===archId&&Number.isInteger(app.state.consoleFloor)?app.state.consoleFloor:(action.archId===archId?action.floorIndex:-1);
  const graph=consoleGraph(data.canvas,selected);
  graph.wireId=`nc-wire-${String(app.appId??app.id??'console').replace(/[^\w-]/g,'')}`;
  app._consoleLayout=layoutPreferences(app._consoleLayout??game.settings.get(MODULE_ID,'consoleLayout'));
  app._consoleCanvas=data.canvas;
  app._consoleTargetRef=action.target?.ref??'';
  app._consoleGraph=graph;
  const ice=iceSnapshot(data.canvas,action.pid);
  app._iceFeedback=queueIceChanges(app._iceFeedback,iceChanges(app._iceSnapshot,ice),app._iceSnapshot?.scope===ice.scope);app._iceSnapshot=ice;
  const devices=controlDeviceData(data,game.modules.get(MODULE_ID)?.api?.scanner?.cameraDevices?.(action.pid)??[]);
  const snapshot=consoleSnapshot({...data,actions:{...action,controlNodes:devices.nodes}});
  app._consoleVisualPid=action.pid??null;
  app._consoleForceMotion=game.settings.get(MODULE_ID,'consoleForceMotion')===true;
  if(app._consoleSnapshot?.scope!==snapshot.scope)app._consoleEvents=[];
  const changes=consoleChanges(app._consoleSnapshot,snapshot);
  app._consoleEvents=appendConsoleEvents(app._consoleEvents??[],changes.map(e=>({...e,text:loc(`CRNS.Console.Events.${e.key}`,e.values)})));
  app._consoleSnapshot=snapshot;
  app._consoleFeedback=changes;
  app.state.consoleFloor=graph.selectedIndex;app.state.consoleFloorArch=archId;
  return {consoleUI:!app.state.consoleClassic,console:{
    section:app.state.consoleSection??'overview', graph, connection:connectionData(app,data),devices,
    archName:data.canvas?.archName||data.tabsGM?.tabs?.find(t=>t.active)?.name||'СЕТевая архитектура',
    selectedLabel:graph.selectedLabel||'Обзор доступных этажей',
    deckName:deck?.name??'Кибердека не выбрана',deckId:deck?.id??'',actorId:actor?.id??'',actorUuid:actor?.uuid??'',
    programCount:programs.length,activeCount:programs.filter(p=>p.system.isRezzed).length,
    scannerEnabled:!!game.modules.get(MODULE_ID)?.api?.scanner?.enabled,
    events:(app._consoleEvents??[]).slice().reverse().map(e=>({...e,time:new Date(e.stamp).toLocaleTimeString(game.i18n.lang,{hour:'2-digit',minute:'2-digit',second:'2-digit'})})),runner:action.variant==='runner',
    motion:game.settings.get(MODULE_ID,'consoleMotion')!==false,
    forceMotion:app._consoleForceMotion,
    floor:consoleFloorSummary(data.canvas,graph.selectedIndex),
    knownCount:snapshot.floors.length,
    connected:!!action.jackedIn,
  }};
}
export function activateConsole(app,html){
  app._consoleResizeObserver?.disconnect();
  app._consoleDisplayCleanup?.();app._consoleGeometryCleanup?.();
  const root=html.filter('.crns-console')[0]??html.find('.crns-console')[0];if(!root)return;
  app.playConsoleEffect=(kind,pid,refs)=>playConsoleEffect(app,kind,pid,refs);
  if(game.settings.get(MODULE_ID,'iceSound'))root.addEventListener('pointerdown',()=>unlockIceAudio(),{once:true});
  activateConnection(app,root);
  activateOverview(app,root);
  activateDevices(app,root);
  root.querySelector('[data-console-findings]')?.addEventListener('click',openFindingsCollection);
  app._stopConsoleEffects=()=>{stopConsoleEffects(app);stopIceEffects(app);};
  app.playIceEffect=cue=>playIceEffect(app,cue);
  for(const el of root.querySelectorAll("[data-ice-type]")){const p=iceProfile(el.dataset.iceType);el.dataset.iceMotion=p.motion;el.style.setProperty("--ice-color",p.color);el.style.setProperty("--ice-time",`${2+p.frequency/300}s`);el.querySelector(".nc-token-main")?.setAttribute("title",p.description);}
  const move=(selector,target)=>{const source=root.querySelector(selector),dest=root.querySelector(target);if(source&&dest)dest.append(source);};
  move('.crns-actions>.crns-zone-left','[data-console-profile]');
  const portrait=root.querySelector('[data-console-profile] .crns-act-avatar');
  if(portrait&&app._consoleVisualPid)portrait.dataset.effectSource=`runner:${app._consoleVisualPid}`;
  const emptyProfile=root.querySelector('[data-console-profile] .crns-zone-empty');
  if(emptyProfile&&game.user.isGM){const choose=document.createElement('button');choose.type='button';choose.textContent='Выбрать нетраннера';choose.addEventListener('click',()=>{const select=root.querySelector('[data-connect-select="runner"]');select?.scrollIntoView({block:'nearest'});select?.focus();});emptyProfile.append(choose);}
  move('.crns-act-abilities','[data-console-abilities]');
  move('.crns-prog-list','[data-console-programs]');
  move('.crns-actions>.crns-zone-right','[data-console-target]');
  move('.crns-actions>.crns-zone-center','[data-console-alerts]');
  if(!root.querySelector('[data-console-alerts]')?.textContent.trim())root.querySelector('.nc-alerts')?.remove();
  for(const b of root.querySelectorAll('[data-ability]')){
    const icon=document.createElement('i');
    const art=ART[b.dataset.ability];
    icon.className=art?'nc-ability-art':`fas ${ICONS[b.dataset.ability]??'fa-microchip'}`;
    if(art)icon.style.setProperty('--nc-icon',`url('${new URL(`../../assets/console/icons/${art}.svg`,import.meta.url).href}')`);
    icon.setAttribute('aria-hidden','true');b.prepend(icon);
  }
  // Foundry interprets tooltip attributes as HTML after the browser decodes them.
  for(const b of root.querySelectorAll('button'))b.dataset.tooltip=esc(b.dataset.tooltip||b.title||b.getAttribute('aria-label')||b.textContent.trim()||'Открыть действие');
  const setSection=(section)=>{app.state.consoleSection=section;app.state.editorArchId='';if(section==='detail')app.state.consoleDetailFocus=app.state.consoleFloor;if(section==='manage'){app.state.collapsedLeft=false;app.state.collapsedRight=false;}app.render(false);};
  root.querySelector('[data-console-clear-log]')?.addEventListener('click',()=>{app._consoleEvents=[];app.render(false);});
  const feedback=app._consoleFeedback??[];app._consoleFeedback=[];
  if(feedback.some(event=>event.key==='ControlTaken')){
    app._consoleLayout.right=true;
    app._consoleRevealPanel='right';
    ui.notifications.info('Узел под вашим контролем. Камеры и действия доступны в блоке «Устройства узла».');
  }
  const effect=effectForChanges(feedback);
  if(root.classList.contains('has-motion')&&(app._consoleForceMotion||!matchMedia('(prefers-reduced-motion: reduce)').matches)){
    for(const e of feedback){
      const target=e.floor!==null?root.querySelector(`.nc-isofloor[data-console-floor="${e.floor}"] .nc-slab-top`):root.querySelector(e.key.startsWith('Program')?'.nc-program-panel':'.nc-connection-card');
      target?.animate([{opacity:.5},{opacity:1}],{duration:650,easing:'ease-out'});
    }
  }
  // Keep the native editor/draft lifecycle, but reveal its pane when opened from the management list.
  root.addEventListener('click',event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(!['arch-edit','arch-open','tree-new-arch','tab-edit','tab-activate'].includes(action))return;
    app.state.consoleSection='overview';
    // Opening the already-active architecture makes no world change and emits no
    // update hook. Still leave management and reveal its existing overview.
    if(action==='arch-open')queueMicrotask(()=>app.render(false));
  },true);
  root.querySelectorAll('[data-console-section]').forEach(b=>b.addEventListener('click',()=>setSection(b.dataset.consoleSection)));
  const selectFloor=value=>{const index=Number(value);if(!root.querySelector(`.nc-isofloor[data-console-floor="${index}"]`))return;app.state.consoleFloor=index;app.state.consoleFocusFloor=index;app.render(false);};
  root.querySelectorAll('[data-console-floor]').forEach(b=>{
    const activate=()=>selectFloor(b.dataset.consoleFloor);
    b.addEventListener('click',e=>{if(!e.target.closest('[data-console-token], [data-console-object]'))activate();});b.addEventListener('keydown',e=>{if(e.target!==b)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();app.state.consoleKeyboardFloor=Number(b.dataset.consoleFloor);activate();}});
  });
  for(const selector of ['[data-console-floor-select]','[data-console-link-select]'])root.querySelector(selector)?.addEventListener('change',e=>{if(e.target.value!=='')selectFloor(e.target.value);});
  root.querySelectorAll('[data-console-open-floor]').forEach(b=>b.addEventListener('click',()=>{app.state.consoleSection='detail';app.state.consoleDetailFocus=app.state.consoleFloor;app.render(false);}));
  root.querySelector('[data-console-map-home]')?.addEventListener('click',()=>selectFloor(root.querySelector('.nc-iso').dataset.mapCurrent));
  activateDisplay(app,root);
  activatePerspective(app,root);
  app._consoleGeometryDone=new Promise(resolve=>requestAnimationFrame(()=>resolve(root.isConnected?animateGeometry(app,root):null)));
  const iceFeedback=app._iceFeedback??[],iceScope=app._iceSnapshot?.scope;app._iceFeedback=[];
  // A session update may replace this root while geometry settles. Resolve
  // the current root in the renderer; don't lose the transition on that redraw.
  if(iceFeedback.length)app._consoleGeometryDone.then(()=>{if(iceScope===app._iceSnapshot?.scope)for(const cue of iceFeedback)playIceEffect(app,cue);});
  if(effect)app._consoleGeometryDone.then(()=>{if(root.isConnected)playConsoleEffect(app,effect);});
  root.querySelector('[data-console-sheet]')?.addEventListener('click',()=>{
    const actor=fromUuidSync(root.querySelector('[data-console-sheet]').dataset.actorUuid);
    if(actor?.isOwner)actor.sheet.render(true);
  });
  if(Number.isInteger(app.state.consoleKeyboardFloor)){
    const index=app.state.consoleKeyboardFloor;delete app.state.consoleKeyboardFloor;
    requestAnimationFrame(()=>root.querySelector(`[data-console-floor="${index}"]`)?.focus({preventScroll:true}));
  }
  if(app.state.consoleSection==='detail'&&Number.isInteger(app.state.consoleDetailFocus)){
    const detailFloor=app.state.consoleDetailFocus;delete app.state.consoleDetailFocus;
    requestAnimationFrame(()=>{
    const stage=root.querySelector('.crns-stage'),vp=root.querySelector('.crns-viewport');
    const card=stage?.querySelector(`.crns-floor-wrap[data-floor-index="${detailFloor}"]`);
    if(!card||!vp)return;const cam=app.state.cam[root.dataset.archId];
    // Keep native zoom/pan state in sync; focus only on an explicitly selected, rendered floor.
    const c=cam;if(!c)return;
    c.z=Math.min(1,(vp.clientWidth-35)/Math.max(1,card.offsetWidth));
    c.x=(stage.offsetWidth/2-card.offsetLeft-card.offsetWidth/2)*c.z;
    c.y=(stage.offsetHeight/2-card.offsetTop-card.offsetHeight/2)*c.z;
    stage.style.transform=`translate(-50%,-50%) translate(${c.x}px,${c.y}px) scale(${c.z})`;
    });
  }
}

function activatePerspective(app,root){
  const viewport=root.querySelector('.nc-schematic-viewport'),svg=root.querySelector('.nc-iso');
  if(!viewport||!svg)return;
  const graph={width:Number(svg.dataset.mapWidth),height:Number(svg.dataset.mapHeight),count:Number(svg.dataset.mapCount)};
  const maps=app.state.consoleMaps??={}, saved=maps[root.dataset.archId]??={zoom:1};
  saved.zoom=clampMapZoom(saved.zoom);
  let baseScale=0,scale=0,viewAnchor=null,focus=Number.isInteger(app.state.consoleFocusFloor)||!Number.isFinite(saved.top);
  app.state.consoleFocusFloor=null;
  const selected=Number(svg.dataset.mapSelected);
  const priorGeometry=app._consoleGeomPrev;
  app._consoleGeometryScrollDelta=0;
  const extentKey=`${graph.width}x${graph.height}`;
  if(saved.baseExtent!==extentKey){delete saved.baseScale;saved.baseExtent=extentKey;}
  const remember=()=>{saved.top=viewport.scrollTop;saved.left=viewport.scrollLeft;};
  const layout=(anchor)=>{
    if(!root.isConnected||root.dataset.panelAnimating||!viewport.clientWidth||!viewport.clientHeight)return;
    const oldScale=scale,oldTop=viewport.scrollTop,oldLeft=viewport.scrollLeft;
    if(!baseScale)baseScale=saved.baseScale??consoleGraphScale(viewport.clientWidth,viewport.clientHeight,graph);
    saved.baseScale=baseScale;scale=baseScale*saved.zoom;
    svg.style.width=`${graph.width*scale}px`;svg.style.height=`${graph.height*scale}px`;
    if(focus){const node=svg.querySelector(`[data-console-floor="${selected}"]`);viewport.scrollTop=Math.max(0,Number(node?.dataset.floorY??0)*scale-viewport.clientHeight*.56);viewport.scrollLeft=Math.max(0,Number(node?.dataset.floorX??0)*scale-viewport.clientWidth/2);focus=false;}
    else if(oldScale){viewport.scrollLeft=mapZoomAnchor(oldLeft,anchor?.x??viewport.clientWidth/2,oldScale,scale,graph.width,viewport.clientWidth);viewport.scrollTop=mapZoomAnchor(oldTop,anchor?.y??viewport.clientHeight/2,oldScale,scale,graph.height,viewport.clientHeight,false);}
    else {const prior=priorGeometry?.arch===root.dataset.archId?priorGeometry.nodes.get(selected):null;const current=app._consoleGraph.nodes.find(n=>n.index===selected);const before=saved.top??0;viewport.scrollTop=before+(prior&&current?(current.y-prior.y)*scale:0);app._consoleGeometryScrollDelta=(viewport.scrollTop-before)/scale;viewport.scrollLeft=saved.left??0;}
    if(viewAnchor){viewport.scrollLeft=viewAnchor.x*scale+Math.max(0,(viewport.clientWidth-graph.width*scale)/2)-viewport.clientWidth/2;viewport.scrollTop=viewAnchor.y*scale-viewport.clientHeight/2;viewAnchor=null;}
    const percent=Math.round(saved.zoom*100);
    root.querySelector('[data-console-zoom-value]').textContent=`${percent}%`;
    root.querySelector('[data-console-zoom-range]').value=String(percent);
    root.querySelector('[data-console-zoom="-1"]').disabled=saved.zoom<=.25;
    root.querySelector('[data-console-zoom="1"]').disabled=saved.zoom>=4;
    remember();
  };
  const zoom=(value,anchor)=>{viewAnchor=null;saved.zoom=clampMapZoom(value);layout(anchor);};
  viewport.addEventListener('scroll',remember,{passive:true});
  root.querySelectorAll('[data-console-zoom]').forEach(button=>button.addEventListener('click',()=>{
    const step=Number(button.dataset.consoleZoom);
    if(!step){focus=true;baseScale=0;delete saved.baseScale;}zoom(step?saved.zoom*(step>0?1.2:1/1.2):1);
  }));
  root.querySelector('[data-console-zoom-range]')?.addEventListener('input',e=>zoom(Number(e.target.value)/100));
  root.querySelector('[data-console-fit]')?.addEventListener('click',()=>{
    baseScale=Math.min((viewport.clientWidth-16)/graph.width,(viewport.clientHeight-16)/graph.height);saved.baseScale=baseScale;
    zoom(1);
    viewport.scrollTop=0;viewport.scrollLeft=0;remember();
  });
  viewport.addEventListener('wheel',e=>{
    e.preventDefault();const r=viewport.getBoundingClientRect();
    zoom(saved.zoom*Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002),{x:e.clientX-r.left,y:e.clientY-r.top});
  },{passive:false});
  let drag=null,suppressClick=false;
  viewport.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[data-console-token], [data-console-object]'))return;suppressClick=false;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,moved:false};});
  viewport.addEventListener('dragstart',e=>e.preventDefault());
  viewport.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return;
    if(!drag.moved){drag.moved=true;viewport.setPointerCapture(e.pointerId);viewport.classList.add('is-panning');}
    viewport.scrollLeft=drag.left-(e.clientX-drag.x);viewport.scrollTop=drag.top-(e.clientY-drag.y);remember();
  });
  const endDrag=e=>{if(!drag||e.pointerId!==drag.id)return;suppressClick=drag.moved;drag=null;viewport.classList.remove('is-panning');if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);};
  viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
  viewport.addEventListener('lostpointercapture',()=>{drag=null;viewport.classList.remove('is-panning');});
  viewport.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
  viewport.addEventListener('keydown',e=>{
    if(e.target!==viewport)return;
    const steps={ArrowUp:[0,-90],ArrowDown:[0,90],ArrowLeft:[-90,0],ArrowRight:[90,0]};
    if(steps[e.key]){e.preventDefault();const [x,y]=steps[e.key];viewport.scrollLeft+=x;viewport.scrollTop+=y;remember();}
    else if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0'){focus=true;baseScale=0;delete saved.baseScale;}zoom(e.key==='0'?1:saved.zoom*(e.key==='-'?1/1.2:1.2));}
  });
  app._consoleRelayout=()=>layout();
  app._consoleCaptureView=()=>{if(scale)viewAnchor={x:(viewport.scrollLeft+viewport.clientWidth/2-Math.max(0,(viewport.clientWidth-graph.width*scale)/2))/scale,y:(viewport.scrollTop+viewport.clientHeight/2)/scale};};
  app._consoleResizeObserver=new ResizeObserver(()=>layout());app._consoleResizeObserver.observe(viewport);
  requestAnimationFrame(()=>layout());
}
