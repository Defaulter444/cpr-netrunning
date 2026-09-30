import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../scripts/main.js',import.meta.url),'utf8');
const start=source.indexOf('const resolvingSpeedTests =');
const end=source.indexOf('\n/**',start);
assert.ok(start>=0 && end>start);
const handler=source.slice(start,end);
function setup() {
  let pending=[{id:'t1',pid:'p1',iceActorId:'ice',iceName:'ICE'}];
  let rolls=0,cards=0,clears=0,finish;
  const ctx=vm.createContext({
    getWorld:()=>({pendingTests:pending}),
    game:{actors:{get:()=>({id:'ice',name:'ICE'})}},
    bridge:{rollEntityStat:()=>{rolls++;return new Promise(r=>finish=r);}},
    mutate:async()=>{clears++;pending=[];},
    participantName:()=> 'Runner',loc:s=>s,refToActor:()=>null,
    postComparisonCard:()=>cards++,postEffectCard:()=>{},
  });
  vm.runInContext(handler,ctx);
  return {run:data=>ctx.handleSpeedTest(data),done:roll=>finish(roll),dismiss:()=>pending=[],stats:()=>({rolls,cards,clears})};
}
const data={testId:'t1',pid:'p1',runnerTotal:10};
{
  const s=setup();const first=s.run(data);await s.run(data);
  assert.equal(s.stats().rolls,1,'duplicate reply must not start second ICE roll');
  s.done({resultTotal:9});await first;await s.run(data);
  assert.deepEqual(s.stats(),{rolls:1,cards:1,clears:1},'completed test cannot be replayed');
}
{
  const s=setup();await s.run({...data,pid:'other'});await s.run({...data,runnerTotal:'invalid'});
  assert.deepEqual(s.stats(),{rolls:0,cards:0,clears:0});
  const first=s.run(data);s.done(null);await first;
  const retry=s.run(data);s.done({resultTotal:11});await retry;
  assert.deepEqual(s.stats(),{rolls:2,cards:1,clears:1},'cancelled roll leaves test retryable');
}
{
  const s=setup();const first=s.run(data);s.dismiss();s.done({resultTotal:15});await first;
  assert.deepEqual(s.stats(),{rolls:1,cards:0,clears:0},'dismissal while roll is pending produces no stale verdict');
}
console.log('SPEED replies: concurrent duplicates, replay, wrong participant, invalid total, cancellation/retry and dismissal passed');
