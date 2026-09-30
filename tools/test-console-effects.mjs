import assert from 'node:assert/strict';
import {effectForChanges,playConsoleEffect,stopConsoleEffects} from '../scripts/apps/console-effects.mjs';
assert.equal(effectForChanges([{key:'ActionsChanged'}]),null);
assert.equal(effectForChanges([{key:'Discovered'},{key:'ProgramOn'}]),'program');
assert.equal(effectForChanges([{key:'Breached'}]),'breach');
assert.equal(effectForChanges([{key:'Discovered'}]),'scan');
assert.equal(effectForChanges([{key:'ProgramOff'}]),null);

let reduced=false, motion=true, attached=0, created=0;
const callbacks=new Map(); let sequence=0;
const rect={left:0,top:0,right:800,bottom:600,width:800,height:600};
const root={isConnected:true,classList:{contains:()=>motion},getBoundingClientRect:()=>rect,querySelector:()=>null};
const context=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{})});
globalThis.document={hidden:false,body:{append(){attached++;}},createElement:()=>{
  created++;return {style:{},setAttribute(){},getContext:()=>context,remove(){attached--;}};
}};
globalThis.window={devicePixelRatio:2};
globalThis.matchMedia=()=>({matches:reduced});
globalThis.getComputedStyle=()=>({zIndex:'100'});
globalThis.requestAnimationFrame=fn=>{callbacks.set(++sequence,fn);return sequence;};
globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
globalThis.Image=class {complete=false;};
const app={element:[{querySelector:()=>root}],_consoleSnapshot:{scope:'arch|p'},_consoleVisualPid:'p'};
function step(time){const pending=[...callbacks.values()];callbacks.clear();for(const fn of pending)fn(time);}

motion=false;assert.equal(playConsoleEffect(app,'scan'),false);assert.equal(created,0);
motion=true;reduced=true;assert.equal(playConsoleEffect(app,'scan'),false);
app._consoleForceMotion=true;assert.equal(playConsoleEffect(app,'scan'),true);
stopConsoleEffects(app);motion=false;assert.equal(playConsoleEffect(app,'scan'),false,'off always wins over full effects');
motion=true;app._consoleForceMotion=false;
reduced=false;assert.equal(playConsoleEffect(app,'scan','other'),false);
assert.equal(playConsoleEffect(app,'invalid'),false);
assert.equal(playConsoleEffect(app,'scan','p'),true);assert.equal(attached,1);
assert.equal(playConsoleEffect(app,'program','p'),true);assert.equal(attached,1,'one shared canvas per app');
step(performance.now()+100);assert.equal(callbacks.size,1,'one frame loop');
// Replacing the Foundry content root does not cancel an ongoing effect.
app.element=[{querySelector:()=>({...root})}];step(performance.now()+200);assert.equal(attached,1);
step(performance.now()+3000);assert.equal(attached,0);assert.equal(callbacks.size,0,'idle effects use no RAF');
playConsoleEffect(app,'zap');reduced=true;step(performance.now()+10);assert.equal(attached,0);
reduced=false;playConsoleEffect(app,'breach');app._consoleSnapshot.scope='other';step(performance.now()+10);assert.equal(attached,0,'no effect leaks to another participant');
playConsoleEffect(app,'scan');document.hidden=true;step(performance.now()+10);assert.equal(attached,0);
document.hidden=false;playConsoleEffect(app,'program');stopConsoleEffects(app);stopConsoleEffects(app);
assert.equal(attached,0);assert.equal(callbacks.size,0,'closing the app cancels and removes the layer');
const actorRect={left:300,top:200,right:366,bottom:266,width:66,height:66};
const actor={getClientRects:()=>[1],getBoundingClientRect:()=>actorRect};
const viewport={getClientRects:()=>[1],getBoundingClientRect:()=>rect};
root.querySelector=selector=>selector==='.nc-schematic-viewport'?viewport:null;
root.querySelectorAll=()=>[{dataset:{entityRef:'runner:p'},querySelector:()=>actor}];
app.element=[{querySelector:()=>root}];
for(const kind of ['speed','defense','cloak']){
  assert.equal(playConsoleEffect(app,kind,'p'),true,`${kind} anchors to actual runner`);
  step(performance.now()+500);
  assert.equal(attached,1);
  step(performance.now()+3000);
  assert.equal(attached,0,`${kind} cleans up`);
}
motion=false;reduced=true;
assert.equal(playConsoleEffect(app,'scan',null,null,{enabled:true,force:true}),true,'preview can temporarily enable its own cue');
assert.equal(playConsoleEffect(app,'program'),false,'preview cannot enable a real action');
step(performance.now()+100);assert.equal(attached,1,'preview survives with personal motion preference off');
stopConsoleEffects(app);assert.equal(attached,0);
motion=true;reduced=false;
root.querySelectorAll=()=>[];
assert.equal(playConsoleEffect(app,'defense','p'),false,'no actor portrait means no invented source');
app.element=null;assert.equal(playConsoleEffect(app,'scan'),false,'a late callback cannot start on a closed app');
console.log('Console effects: cue selection, reduced motion, participant scope, redraw survival, hidden page and cleanup passed');
