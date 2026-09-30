// Visual effects only. This module never rolls dice, reads world documents, or
// sends socket messages. A transient layer survives Foundry's content rerenders.
import {motionAllowed} from './console-layout.mjs';
const active = new WeakMap();
const textures = new Map();
const TAU = Math.PI * 2;
const DURATION = 2600;
const ASSETS = {ring:'circle_02.png', spark:'spark_01.png', glow:'light_02.png'};
export const EFFECT_KINDS = ['scan', 'program', 'zap', 'breach', 'speed', 'defense', 'cloak'];
const SELF_EFFECTS = ['speed', 'defense', 'cloak'];

export function effectForChanges(changes) {
  if (changes.some(e => e.key === 'ProgramOn')) return 'program';
  if (changes.some(e => e.key === 'Breached' || e.key === 'ControlTaken')) return 'breach';
  if (changes.some(e => e.key === 'Discovered' || e.key === 'Connected')) return 'scan';
  return null;
}

function rootFor(app) { return app.element?.[0]?.querySelector('.crns-console'); }
function enabled(root, app, override=null) {
  return root?.isConnected && motionAllowed(app,override,root) && !document.hidden;
}

function preload() {
  for (const [key, name] of Object.entries(ASSETS)) {
    if (textures.has(key)) continue;
    const img = new Image();
    img.src = new URL(`../../assets/console/fx/${name}`, import.meta.url).href;
    textures.set(key, img);
  }
}

export function stopConsoleEffects(app) {
  const state = active.get(app);
  if (!state) return;
  cancelAnimationFrame(state.frame);
  state.canvas.remove();
  active.delete(app);
}

/** Resolve only displayed token portraits. There is deliberately no generic icon fallback. */
export function zapAnchors(root, bounds, refs) {
  if(!refs?.sourceRef || !refs.targetRef || refs.sourceRef===refs.targetRef)return null;
  const portrait=ref=>[...(root.querySelectorAll?.('.nc-token-main')??[])].find(el=>el.dataset.entityRef===ref)?.querySelector('.nc-token-portrait');
  const source=portrait(refs.sourceRef),target=portrait(refs.targetRef);
  if(!source?.getClientRects().length||!target?.getClientRects().length)return null;
  const area=visibleArea(root,'.nc-schematic-viewport',bounds);if(!area)return null;
  const center=el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2-bounds.left,y:r.top+r.height/2-bounds.top};};
  const from=center(source),to=center(target),inside=p=>p.x>=area.x&&p.x<=area.x+area.w&&p.y>=area.y&&p.y<=area.y+area.h;
  return inside(from)&&inside(to)?{area,from,to}:null;
}

/** Self effects stay attached to the acting runner, including after a re-render. */
export function selfAnchor(root, bounds, sourceRef) {
  if(!sourceRef)return null;
  const token=[...(root.querySelectorAll?.('.nc-token-main')??[])].find(el=>el.dataset.entityRef===sourceRef)?.querySelector('.nc-token-portrait');
  const profile=root.querySelector('.nc-runner [data-effect-source]');
  for(const [el,selector] of [[token,'.nc-schematic-viewport'],[profile?.dataset?.effectSource===sourceRef?profile:null,'.nc-runner']]){
    if(!el?.getClientRects().length)continue;
    const area=visibleArea(root,selector,bounds);if(!area)continue;
    const r=el.getBoundingClientRect(),x=r.left+r.width/2-bounds.left,y=r.top+r.height/2-bounds.top;
    if(x<area.x||x>area.x+area.w||y<area.y||y>area.y+area.h)continue;
    return {area,x,y,r:Math.max(24,Math.min(r.width,r.height)/2)};
  }
  return null;
}

export function playConsoleEffect(app, kind, pid = null, refs = null, preview = null) {
  if (!EFFECT_KINDS.includes(kind) || (pid && pid !== app._consoleVisualPid)) return false;
  const root = rootFor(app);
  if (!enabled(root, app, preview)) return false;
  if(kind==='zap') {
    refs??={sourceRef:`runner:${pid??app._consoleVisualPid}`,targetRef:root.querySelector('.nc-map-token.targeted')?.dataset.consoleToken};
    if(!zapAnchors(root,root.getBoundingClientRect(),refs))return false;
  }
  if(SELF_EFFECTS.includes(kind)){
    refs??={sourceRef:`runner:${pid??app._consoleVisualPid}`};
    if(!selfAnchor(root,root.getBoundingClientRect(),refs.sourceRef))return false;
  }
  preload();
  const now = performance.now();
  let state = active.get(app);
  if (state && state.scope !== app._consoleSnapshot?.scope) {
    stopConsoleEffects(app); state = null;
  }
  if (!state) {
    const canvas = document.createElement('canvas');
    canvas.className = 'nc-vfx-layer';
    canvas.setAttribute('aria-hidden', 'true');
    const context = canvas.getContext('2d');
    if (!context) return false;
    document.body.append(canvas);
    state = {canvas, context, cues:[], frame:0, scope:app._consoleSnapshot?.scope};
    active.set(app, state);
    state.frame = requestAnimationFrame(t => frame(app, state, t));
  }
  // Collapse state updates and ability completion arriving in the same burst.
  if (state.cues.some(c => c.kind === kind && c.refs?.sourceRef === refs?.sourceRef && c.refs?.targetRef === refs?.targetRef && now - c.start < DURATION)) return true;
  state.cues.push({kind, refs, preview, start:now});
  state.cues = state.cues.slice(-3);
  return true;
}

function frame(app, state, time) {
  const root = rootFor(app);
  if (!root?.isConnected || document.hidden || state.scope !== app._consoleSnapshot?.scope) {
    stopConsoleEffects(app); return;
  }
  state.cues = state.cues.filter(c => time - c.start < DURATION && enabled(root,app,c.preview));
  if (!state.cues.length) { stopConsoleEffects(app); return; }
  const bounds = root.getBoundingClientRect();
  if (bounds.width < 40 || bounds.height < 40) { stopConsoleEffects(app); return; }
  const {canvas, context:ctx} = state;
  // Cap retina resolution so these short effects also work on modest hardware.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  Object.assign(canvas.style, {left:`${bounds.left}px`, top:`${bounds.top}px`, width:`${bounds.width}px`, height:`${bounds.height}px`, zIndex:getComputedStyle(app.element[0]).zIndex});
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,bounds.width,bounds.height);
  for (const cue of state.cues) {
    const self=SELF_EFFECTS.includes(cue.kind);
    const anchors=cue.kind==='zap'?zapAnchors(root,bounds,cue.refs):self?selfAnchor(root,bounds,cue.refs?.sourceRef):null;
    if((cue.kind==='zap'||self)&&!anchors)continue;
    const preferred = cue.kind === 'program' ? '.nc-deck' : '.nc-schematic-viewport';
    const area = anchors?.area || visibleArea(root, preferred, bounds) || visibleArea(root, '.nc-schematic-viewport', bounds) || visibleArea(root, '.nc-deck', bounds);
    if(!area)continue;
    const t = Math.max(0, (time - cue.start) / DURATION);
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x,area.y,area.w,area.h); ctx.clip();
    ctx.globalAlpha = Math.min(1,t*8) * Math.min(1,(1-t)*5);
    if (cue.kind === 'scan') scan(ctx,area,t);
    else if (cue.kind === 'program') program(ctx,area,t);
    else if (cue.kind === 'zap') zap(ctx,anchors,t);
    else if (cue.kind === 'speed') speed(ctx,anchors,t);
    else if (cue.kind === 'defense') defense(ctx,anchors,t);
    else if (cue.kind === 'cloak') cloak(ctx,anchors,t);
    else breach(ctx,area,t);
    ctx.restore();
  }
  state.frame = requestAnimationFrame(t => frame(app,state,t));
}

function speed(ctx,{x,y,r},t) {
  const radius=r+12;
  for(let i=0;i<3;i++){
    const angle=t*TAU*2+i*TAU/3;
    line(ctx,'#78ffe1',2.5,()=>ctx.arc(x,y,radius+i*5,angle,angle+1.4));
  }
  for(let i=0;i<10;i++){
    const phase=(t*3+i/10)%1,px=x-radius*2.7+phase*radius*5.4,py=y+(i%5-2)*radius*.4;
    ctx.globalAlpha*=.72;
    line(ctx,i%2?'#a6ffff':'#34dfff',2,()=>{ctx.moveTo(px-radius*.7,py);ctx.lineTo(px,py);});
    ctx.globalAlpha/=.72;
  }
  sprite(ctx,'spark',x+Math.cos(t*TAU*2)*radius,y+Math.sin(t*TAU*2)*radius,24,.7);
}
function defense(ctx,{x,y,r},t) {
  const radius=(r+18)*(1+.05*Math.sin(t*TAU*3));
  const shield=()=>{ctx.moveTo(x,y-radius);ctx.lineTo(x+radius*.85,y-radius*.55);ctx.lineTo(x+radius*.7,y+radius*.4);ctx.quadraticCurveTo(x+radius*.45,y+radius*.9,x,y+radius*1.2);ctx.quadraticCurveTo(x-radius*.45,y+radius*.9,x-radius*.7,y+radius*.4);ctx.lineTo(x-radius*.85,y-radius*.55);ctx.closePath();};
  ctx.beginPath();shield();ctx.fillStyle='#64baff22';ctx.fill();
  line(ctx,'#93cfff',3,shield);
  line(ctx,'#d4efff',1,()=>ctx.arc(x,y,radius*1.3,-Math.PI/2,t*TAU-Math.PI/2));
  for(let i=0;i<6;i++){const a=i*TAU/6+t*.3;sprite(ctx,'spark',x+Math.cos(a)*radius*1.3,y+Math.sin(a)*radius*1.3,14,.7);}
}
function cloak(ctx,{x,y,r},t) {
  const radius=r+14,phase=Math.floor(t*16);
  for(let i=0;i<14;i++){
    const a=i*2.39996+t*.5,rr=radius*(.65+((i+phase)%5)*.15);
    const px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;
    ctx.fillStyle=i%3?'#c798ff80':'#ede0ff';
    ctx.fillRect(px,py,4+((i+phase)%4)*4,2);
  }
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2+t;
    line(ctx,'#bf89ff',2,()=>ctx.arc(x,y,radius,a,a+.6));
  }
  const sweep=y-radius+2*radius*((t*2)%1);
  line(ctx,'#e1caff',1.5,()=>{ctx.moveTo(x-radius,sweep);ctx.lineTo(x+radius,sweep);});
  // An intermittent veil conveys concealment without changing the game token.
  ctx.fillStyle=`rgba(40,12,75,${.12+.12*Math.sin(t*TAU*3)**2})`;
  ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
}

function visibleArea(root, selector, bounds) {
  const el = root.querySelector(selector);
  if (!el?.getClientRects().length) return null;
  const r = el.getBoundingClientRect();
  let left=Math.max(bounds.left,r.left),top=Math.max(bounds.top,r.top);
  let right=Math.min(bounds.right,r.right),bottom=Math.min(bounds.bottom,r.bottom);
  for(let parent=el.parentElement;parent && parent!==root;parent=parent.parentElement){
    const style=getComputedStyle(parent),clip=parent.getBoundingClientRect();
    if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
    if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
  }
  const x=left-bounds.left,y=top-bounds.top,w=right-left,h=bottom-top;
  return w > 70 && h > 70 ? {x,y,w,h} : null;
}

function sprite(ctx,key,x,y,size,alpha=1,rotation=0) {
  const img = textures.get(key);
  if (!img?.complete || !img.naturalWidth) return;
  ctx.save(); ctx.translate(x,y); ctx.rotate(rotation);
  ctx.globalAlpha *= alpha; ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(img,-size/2,-size/2,size,size); ctx.restore();
}
function line(ctx,color,width,draw) {
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.shadowColor=color;ctx.shadowBlur=12;
  ctx.beginPath();draw();ctx.stroke();ctx.shadowBlur=0;
}
function scan(ctx,a,t) {
  const x=a.x+a.w/2,y=a.y+a.h/2,r=Math.min(a.w,a.h)*.42;
  const angle=t*TAU*1.4-Math.PI/2;
  const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
  gradient.addColorStop(0,'#52ffd92a');gradient.addColorStop(1,'#52ffd900');
  ctx.fillStyle=gradient;ctx.fillRect(a.x,a.y,a.w,a.h);
  for(let i=1;i<=3;i++)line(ctx,'#63f9d98c',1,()=>ctx.arc(x,y,r*i/3,0,TAU));
  ctx.fillStyle='#5af8d91c';ctx.beginPath();ctx.moveTo(x,y);ctx.arc(x,y,r,angle-.6,angle);ctx.closePath();ctx.fill();
  line(ctx,'#8effe3',2,()=>{ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(angle)*r,y+Math.sin(angle)*r);});
  for(let i=0;i<24;i++){
    const theta=i*TAU/24,rr=r*(.25+.7*((i*17%23)/23));
    const pulse=Math.max(0,1-((angle-theta+TAU*3)%TAU)/1.8);
    if(pulse>.03)sprite(ctx,'spark',x+Math.cos(theta)*rr,y+Math.sin(theta)*rr,10+18*pulse,pulse);
  }
  const sweep=a.y+a.h*t;
  line(ctx,'#81ffe4',2,()=>{ctx.moveTo(a.x,sweep);ctx.lineTo(a.x+a.w,sweep);});
  sprite(ctx,'glow',x,y,70,.6);
}
function program(ctx,a,t) {
  const x=a.x+a.w/2,y=a.y+a.h*.53,r=Math.min(a.w,a.h)*.44;
  sprite(ctx,'ring',x,y,r*(1.1+.25*Math.sin(t*Math.PI)),.5,-t*3);
  for(let i=0;i<38;i++){
    const theta=i*2.39996+t*2;
    const distance=r*(1-Math.min(1,t*1.5))*(.35+(i%7)/7);
    const px=x+Math.cos(theta)*distance,py=y+Math.sin(theta)*distance;
    ctx.fillStyle=i%3?'#78ffe4':'#ffffff';ctx.shadowColor='#55ffd7';ctx.shadowBlur=8;
    ctx.fillRect(px-2,py-2,4+(i%3),4+(i%3));
    if(i%5===0)sprite(ctx,'spark',px,py,22,.7,t*4);
  }
  ctx.shadowBlur=0;
  const p=Math.min(1,t*1.8),size=r*.7;
  line(ctx,'#78ffe4',2,()=>{
    ctx.rect(x-size/2,y-size/2,size,size);
    for(let i=0;i<4;i++){const u=(i+1)*size/5;ctx.moveTo(x-size/2+u,y-size/2-10);ctx.lineTo(x-size/2+u,y-size/2);ctx.moveTo(x-size/2+u,y+size/2);ctx.lineTo(x-size/2+u,y+size/2+10);}
  });
  ctx.fillStyle='#68ffdc75';ctx.fillRect(x-size/2+5,y+size/2-6-(size-10)*p,size-10,(size-10)*p);
  sprite(ctx,'glow',x,y,100,.4*p);
}
function zap(ctx,{from,to},t) {
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.max(1,Math.hypot(dx,dy));
  const reach=Math.min(1,t*4),step=Math.floor(t*24),normal={x:-dy/length,y:dx/length};
  for(let branch=0;branch<3;branch++){
    const points=[];
    for(let i=0;i<=18;i++){
      const p=i/18*reach,offset=i===0||i===18?0:Math.sin(i*19+step*2+branch*7)*Math.sin(p*Math.PI)*(8+branch*4);
      points.push([from.x+dx*p+normal.x*offset,from.y+dy*p+normal.y*offset]);
    }
    for(const [color,width]of [['#ff285a',4],['#fff1f6',1.3]])line(ctx,color,width,()=>points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y)));
  }
  sprite(ctx,'glow',from.x,from.y,46,.55);
  if(reach===1){
    const radius=18+(t-.25)*60;
    sprite(ctx,'ring',to.x,to.y,radius*2,.6*(1-t),t);
    sprite(ctx,'glow',to.x,to.y,82,.8);
    for(let i=0;i<20;i++){
      const theta=i*2.39996,rr=radius*((i%5+1)/5);
      sprite(ctx,'spark',to.x+Math.cos(theta)*rr,to.y+Math.sin(theta)*rr,12+(i%4)*4,(1-t)*.8,theta);
    }
  }
}
function breach(ctx,a,t) {
  const x=a.x+a.w/2,y=a.y+a.h/2,r=Math.min(a.w,a.h)*(.15+t*.35);
  sprite(ctx,'ring',x,y,r*2,.65,t*2);
  const spread=t*Math.min(a.w,a.h)*.36;
  line(ctx,'#83ffe2',3,()=>{ctx.rect(x-55-spread,y-35,48,70);ctx.rect(x+7+spread,y-35,48,70);});
  line(ctx,'#a4ffe8',4,()=>{ctx.moveTo(x-18,y);ctx.lineTo(x-3,y+15);ctx.lineTo(x+25,y-21);});
  for(let i=0;i<18;i++){const angle=i*TAU/18;sprite(ctx,'spark',x+Math.cos(angle)*r,y+Math.sin(angle)*r,17,.8*(1-t),angle);}
}
