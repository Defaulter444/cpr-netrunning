import {iceProfile,ICE_DURATION,iceRoute,stableIceRef} from './ice-profiles.mjs';
import {drawIceCue,iceGlyph} from './ice-art.mjs';
import {motionAllowed} from './console-layout.mjs';
const running=new WeakMap(),seen=new WeakMap();
let audioContext=null,sounds=0;
export function unlockIceAudio(){
  try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();return audioContext.resume();}catch{return Promise.resolve();}
}
export function iceSound(type,phase,override=null){
  const enabled=override?.enabled??game.settings.get('cpr-netrunning','iceSound');
  if(!enabled||document.hidden||audioContext?.state!=='running'||sounds>=3)return;
  const volume=(override?.volume??game.settings.get('cpr-netrunning','iceVolume'))*Number(game.settings.get('core','globalInterfaceVolume')??1);
  if(!volume)return;
  const p=iceProfile(type),now=audioContext.currentTime,osc=audioContext.createOscillator(),gain=audioContext.createGain();
  osc.type=['blades','fangs','fist'].includes(p.shape)?'triangle':'sine';
  osc.frequency.setValueAtTime(p.frequency*(phase==='appear'?2:1),now);osc.frequency.exponentialRampToValueAtTime(Math.max(25,p.frequency*(phase==='derez'?.12:phase==='attack'?3:.6)),now+.55);
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(Math.min(1,Math.max(0,volume))*.13,now+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+.65);
  osc.connect(gain);gain.connect(audioContext.destination);sounds++;osc.onended=()=>{sounds--;osc.disconnect();gain.disconnect();};osc.start();osc.stop(now+.7);
}
export function stopIceEffects(app){const s=running.get(app);if(s){cancelAnimationFrame(s.frame);s.canvas.remove();running.delete(app);}}
const rootFor=app=>app.element?.[0]?.querySelector('.crns-console');
function portrait(root,ref){return [...root.querySelectorAll('.nc-token-main')].find(e=>e.dataset.entityRef===ref)?.querySelector('.nc-token-portrait');}
function point(el,rect){if(!el?.getClientRects().length)return null;const b=el.getBoundingClientRect();return {x:b.left+b.width/2-rect.left,y:b.top+b.height/2-rect.top,r:b.width/2};}
function routePoints(app,root,cue,rect){
  const graph=app._consoleGraph,route=iceRoute(graph,cue.fromFloor,cue.floor);if(route.length<2)return [];
  const svg=root.querySelector('.nc-iso'),matrix=svg?.getScreenCTM();if(!matrix)return [];
  const points=[];
  for(let i=1;i<route.length;i++){
    const edge=graph.edges.find(e=>e.from===route[i-1]&&e.to===route[i]||e.to===route[i-1]&&e.from===route[i]);
    if(!edge?.samples?.length)return [];
    const samples=edge.from===route[i-1]?edge.samples:[...edge.samples].reverse();
    for(const [x,y] of samples){const q=new DOMPoint(x,y).matrixTransform(matrix);points.push({x:q.x-rect.left,y:q.y-rect.top});}
  }return points;
}
export function playIceEffect(app,cue){
  const root=rootFor(app);if(!root?.isConnected||!motionAllowed(app,null,root)||document.hidden||!Object.hasOwn(ICE_DURATION,cue.phase))return false;
  const token=(app._consoleCanvas?.floors??[]).filter(f=>!f.encrypted).flatMap(f=>(f.entities??[]).map(e=>({...e,floorIndex:f.index}))).find(e=>stableIceRef(e.ref)===stableIceRef(cue.ref));
  if(!token?.iceType||!portrait(root,token.ref))return false;
  if(Number.isInteger(cue.floor)&&cue.floor!==token.floorIndex)return false;
  if(token.derezzed&&cue.phase!=='derez')return false;
  if(cue.phase==='attack'&&!portrait(root,cue.targetRef))return false;
  if(cue.eventId){const ids=seen.get(app)??new Set();if(ids.has(cue.eventId))return false;ids.add(cue.eventId);if(ids.size>128)ids.delete(ids.values().next().value);seen.set(app,ids);}
  let s=running.get(app);
  if(s&&s.scope!==app._iceSnapshot?.scope){stopIceEffects(app);s=null;}
  if(!s){const canvas=document.createElement('canvas');canvas.className='nc-vfx-layer nc-ice-vfx';Object.assign(canvas.style,{position:'fixed',pointerEvents:'none'});canvas.setAttribute('aria-hidden','true');const context=canvas.getContext('2d');if(!context)return false;document.body.append(canvas);s={canvas,context,cues:[],scope:app._iceSnapshot?.scope,frame:0};running.set(app,s);s.frame=requestAnimationFrame(t=>frame(app,s,t));}
  s.cues.push({...cue,type:token.iceType,ref:token.ref,start:performance.now()});s.cues=s.cues.slice(-8);iceSound(token.iceType,cue.phase);return true;
}
function frame(app,s,time){
  try {renderFrame(app,s,time);}catch(error){stopIceEffects(app);console.error('cpr-netrunning | ICE effect',error);}
}
function renderFrame(app,s,time){
  const root=rootFor(app);if(!root?.isConnected||document.hidden||!motionAllowed(app,null,root)||s.scope!==app._iceSnapshot?.scope){stopIceEffects(app);return;}
  s.cues=s.cues.filter(q=>time-q.start<ICE_DURATION[q.phase]&&portrait(root,q.ref));if(!s.cues.length){stopIceEffects(app);return;}
  s.canvas.dataset.icePhases=s.cues.map(q=>q.phase).join(',');
  const viewport=root.querySelector('.nc-schematic-viewport'),rect=root.getBoundingClientRect(),vr=viewport?.getBoundingClientRect();if(!vr?.width||!vr.height){stopIceEffects(app);return;}
  const dpr=Math.min(devicePixelRatio||1,1.5),c=s.context;
  if(s.canvas.width!==Math.round(rect.width*dpr)||s.canvas.height!==Math.round(rect.height*dpr)){s.canvas.width=Math.round(rect.width*dpr);s.canvas.height=Math.round(rect.height*dpr);}
  Object.assign(s.canvas.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,zIndex:getComputedStyle(app.element[0]).zIndex});
  c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,rect.width,rect.height);c.save();c.beginPath();c.rect(vr.left-rect.left,vr.top-rect.top,vr.width,vr.height);c.clip();
  const visible=q=>q&&q.x>=vr.left-rect.left&&q.x<=vr.right-rect.left&&q.y>=vr.top-rect.top&&q.y<=vr.bottom-rect.top;
  for(const cue of s.cues){const t=(time-cue.start)/ICE_DURATION[cue.phase],end=point(portrait(root,cue.ref),rect);if(!visible(end))continue;
    let a=end,b=cue.phase==='attack'?point(portrait(root,cue.targetRef),rect):end;if(!visible(b))continue;
    if(cue.phase==='pursuit'){
      const path=routePoints(app,root,cue,rect);
      if(path.length>1&&path.every(visible)){const f=Math.min(path.length-1,t*(path.length-1)),i=Math.floor(f),next=path[Math.min(i+1,path.length-1)];a={x:path[i].x+(next.x-path[i].x)*(f-i),y:path[i].y+(next.y-path[i].y)*(f-i)};b=a;}
    }
    drawIceCue(c,cue,t,a,b,Math.max(16,Math.min(48,end.r)));
  }c.restore();s.frame=requestAnimationFrame(t=>frame(app,s,t));
}
/** Preview is deliberately independent of all documents, sockets and gameplay. */
export function previewIce(canvas,type,phase,{enabled=true,force=false,sound=false,volume=.35}={}){
  const animate=enabled&&!document.hidden&&(force||!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const c=canvas.getContext('2d');if(!c)return ()=>{};const start=performance.now();let raf=0,stopped=false;
  const draw=time=>{if(stopped||!canvas.isConnected||document.hidden)return;const t=Math.min(1,(time-start)/ICE_DURATION[phase]);c.clearRect(0,0,canvas.width,canvas.height);
    c.strokeStyle='#303748';c.lineWidth=1;c.beginPath();c.moveTo(80,105);c.lineTo(430,105);c.stroke();c.fillStyle='#aabbd0';c.font='12px sans-serif';c.fillText(iceProfile(type).name,30,195);c.fillText('ЦЕЛЬ',410,195);
    c.save();c.translate(80,105);c.scale(30,30);c.strokeStyle=iceProfile(type).color;iceGlyph(c,type,t);c.restore();c.strokeStyle='#5ce4d2';c.beginPath();c.arc(430,105,27,0,Math.PI*2);c.stroke();
    drawIceCue(c,{type,phase},t,{x:80,y:105},{x:phase==='attack'||phase==='pursuit'?430:80,y:105},35);
    if(t<1&&animate)raf=requestAnimationFrame(draw);
  };if(animate)raf=requestAnimationFrame(draw);else draw(start+ICE_DURATION[phase]);if(sound&&animate)unlockIceAudio().then(()=>{if(!stopped)iceSound(type,phase,{enabled:true,volume});});return ()=>{stopped=true;cancelAnimationFrame(raf);};
}
