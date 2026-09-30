export const PANEL_KEYS=['left','right','controls','log'];
export function layoutPreferences(value={}){
  return {...Object.fromEntries(PANEL_KEYS.map(k=>[k,value?.[k]!==false])),compact:value?.compact!==false,
    duration:[180,300,450].includes(Number(value?.duration))?Number(value.duration):300};
}
export function motionAllowed(app,override=null,root=app.element?.[0]?.querySelector('.crns-console')){
  return !!(override?.enabled??root?.classList.contains('has-motion'))&&
    ((override?.force??app._consoleForceMotion)||!matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Only numeric geometry survives a render; no images or inaccessible file contents. */
export function geometrySnapshot(graph,arch){
  return {arch,nodes:new Map((graph?.nodes??[]).map(n=>[n.index,{left:n.left,top:n.top,width:n.width,height:n.height,x:n.x,y:n.y,
    objectX:n.objectX,objectY:n.objectY,previewX:n.previewX,previewY:n.previewY,labelY:n.labelY}])),
    tokens:new Map((graph?.nodes??[]).flatMap(n=>n.tokens.map(t=>[t.ref,{x:t.x,y:t.y}])))};
}

export function animateGeometry(app,root){
  app._consoleGeometryCleanup?.();
  const graph=app._consoleGraph,previous=app._consoleGeomPrev,next=geometrySnapshot(graph,root.dataset.archId);
  app._consoleGeomPrev=next;
  const anims=[];
  if(previous?.arch===next.arch&&motionAllowed(app,null,root)){
    const compensation=app._consoleGeometryScrollDelta||0;
    const animate=(el,from)=>{if(el&&from!=='none')anims.push(el.animate([{transform:from},{transform:'none'}],{duration:app._consoleLayout.duration,easing:'cubic-bezier(.2,.7,.2,1)'}));};
    for(const n of graph.nodes){
      const old=previous.nodes.get(n.index);if(!old)continue;
      const dx=old.left-n.left,dy=old.top-n.top+compensation,sx=old.width/n.width,sy=old.height/n.height;
      if(dx||dy||sx!==1||sy!==1){
        const slab=root.querySelector(`[data-floor-surface="${n.index}"]`);
        if(slab){slab.style.transformOrigin=`${n.left}px ${n.top}px`;animate(slab,`translate(${dx}px,${dy}px) scale(${sx},${sy})`);}
        animate(root.querySelector(`[data-floor-caption="${n.index}"]`),`translate(${old.x-n.x}px,${old.labelY-n.labelY+compensation}px)`);
        const card=root.querySelector(`[data-floor-object="${n.index}"]`);
        animate(card,`translate(${n.card?old.previewX-n.previewX:old.objectX-n.objectX}px,${(n.card?old.previewY-n.previewY:old.objectY-n.objectY)+compensation}px)`);
      }
    }
    for(const el of root.querySelectorAll('[data-token-slot]')){
      const before=previous.tokens.get(el.dataset.tokenSlot),after=next.tokens.get(el.dataset.tokenSlot);
      if(before&&after&&(before.x!==after.x||before.y!==after.y||compensation))animate(el,`translate(${before.x-after.x}px,${before.y-after.y+compensation}px)`);
    }
    if(anims.length)for(const el of root.querySelectorAll('.nc-connection-line,.nc-wire-continuity'))anims.push(el.animate([{opacity:.15},{opacity:1}],{duration:app._consoleLayout.duration}));
  }
  const finish=()=>anims.forEach(a=>{try{a.finish();}catch{a.cancel();}});
  root.addEventListener('pointerdown',finish,{once:true,capture:true});
  app._consoleGeometryCleanup=()=>{root.removeEventListener('pointerdown',finish,true);anims.forEach(a=>a.cancel());};
  app._consoleGeometryDone=Promise.allSettled(anims.map(a=>a.finished));
  return app._consoleGeometryDone;
}
