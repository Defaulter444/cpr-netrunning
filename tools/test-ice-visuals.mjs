import assert from 'node:assert/strict';
import {ICE_PROFILES,ICE_PHASES,iceProfile,iceSnapshot,iceChanges,iceRoute,queueIceChanges} from '../scripts/apps/ice-profiles.mjs';
import {iceGlyph,drawIceCue} from '../scripts/apps/ice-art.mjs';
assert.equal(Object.keys(ICE_PROFILES).length,12);assert.equal(new Set(Object.values(ICE_PROFILES).map(p=>p.shape)).size,12);
assert.equal(iceProfile('unknown').name,'Неизвестный ЛЁД');assert.equal(iceProfile('custom-type').name,'Особый ЛЁД');
const canvas={archId:'a',floors:[{index:0,entities:[{ref:'ice:a:f0:x',iceType:'scorpion',derezzed:false}]},{index:1,encrypted:true,entities:[{ref:'ice:a:f1:hidden',iceType:'dragon'}]}]};
const base=iceSnapshot(canvas,'p');assert.equal(base.items.length,1);assert.deepEqual(iceChanges(null,base),[]);assert.deepEqual(iceChanges(base,iceSnapshot(canvas,'other')),[]);
const changed=structuredClone(canvas);changed.floors[0].entities=[];changed.floors[1].encrypted=false;changed.floors[1].entities=[{ref:'ice:a:f1:x',iceType:'scorpion',tether:{pid:'p'}}];
let next=iceSnapshot(changed,'p');assert.equal(iceChanges(base,next)[0].phase,'pursuit');assert.equal(iceChanges(base,next)[0].fromFloor,0);
const pending=queueIceChanges([],iceChanges(base,next),true);assert.equal(queueIceChanges(pending,[],true).length,1,'cosmetic render must not drop movement');assert.equal(queueIceChanges(pending,[],false).length,0,'scope change clears old cues');assert.equal(queueIceChanges(pending,pending,true).length,1);
changed.floors[1].entities[0].derezzed=true;let dead=iceSnapshot(changed,'p');assert.equal(iceChanges(next,dead)[0].phase,'derez');assert.deepEqual(iceChanges(dead,dead),[]);
changed.floors[1].entities=[];assert.deepEqual(iceChanges(next,iceSnapshot(changed,'p')),[],'removal is not destruction');
assert.deepEqual(iceRoute({nodes:[{index:0},{index:1},{index:2}],edges:[{from:0,to:1},{from:1,to:2}]},0,2),[0,1,2]);
assert.deepEqual(iceRoute({nodes:[{index:0},{index:1,encrypted:true},{index:2}],edges:[{from:0,to:1},{from:1,to:2}]},0,2),[]);
let draws=0;const c=new Proxy({globalAlpha:1},{get:(obj,k)=>k in obj?obj[k]:(...args)=>{assert.ok(args.filter(a=>typeof a==='number').every(Number.isFinite),`finite ${k}`);draws++;}});
for(const type of [...Object.keys(ICE_PROFILES),'unknown','custom'])for(const phase of Object.keys(ICE_PHASES))for(const t of [0,.25,.65,.99,1]){iceGlyph(c,type,t);drawIceCue(c,{type,phase},t,{x:20,y:30},{x:400,y:90});}
assert.ok(draws>1000);console.log('ICE: 12 distinct avatars, all phases, fog, stable identity, pursuit, destruction and draw math PASS');
