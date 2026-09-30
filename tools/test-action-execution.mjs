/* Run real click callbacks; no rendered Foundry DOM or system implementation is emulated. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
const root=process.env.CRNS_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"scripts/apps/actions.js"),"utf8")
  .replace(/^import .+;\r?$/gm,"").replace(/^export /gm,"");
// actions.js imports its pending-action guard; load the real one beside it.
const guardSource=fs.readFileSync(path.join(root,"scripts/apps/action-guard.mjs"),"utf8").replace(/^export /gm,"");
const bridgeSource=fs.readFileSync(path.join(root,"scripts/cpr-bridge.js"),"utf8")
  .replace(/^import .+;\r?$/gm,"").replace(/^export \{[^}]*\};?\r?$/gm,"").replace(/^export /gm,"");
const scenarios=[];
const check=(name,pass)=>scenarios.push({name,pass:!!pass});

/** Evaluate actions.js with the given globals. `listen(app)` wires the handlers
 *  once — call it again with the same app to model a re-render. */
function load(globals){
  const context=vm.createContext({foundry:{utils:{debounce:fn=>fn}},loc:x=>x,...globals});
  vm.runInContext(guardSource,context);
  vm.runInContext(source,context);
  const listen=app=>{
    const callbacks=new Map();
    context.activateListeners(app,{find:selector=>({on:(_event,fn)=>callbacks.set(selector,fn)})});
    return callbacks;
  };
  return {context,listen};
}
const click=(dataset,extra={})=>({preventDefault(){},stopPropagation(){},currentTarget:{dataset},...extra});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const settle=()=>new Promise(r=>setTimeout(r,0));

for (const name of ["demon-action","demon-zap"]) {
  for (const exhausted of [false,true]) {
    let spends=0,rolls=0;
    const {listen}=load({
      game:{user:{id:"gm",isGM:true},actors:{get:()=>({id:"d1"})}},
      getWorld:()=>({demonState:{d1:{value:exhausted?0:2,max:2}},targets:{}}),
      bridge:{rollEntityStat:async()=>{rolls++;return null;}},
      mutate:async()=>{spends++;return true;},
      ui:{notifications:{warn(){}}},
    });
    await listen({}).get(`[data-action="${name}"]`)(click({actorId:"d1"}));
    check(`${name}: ${exhausted?"no roll at zero actions":"cancelled roll spends nothing"}`,spends===0 && rolls===(exhausted?0:1));
  }
}

/* ---- runner abilities: GM-only Shift, one pending roll per runner ---- */
function abilityWorld({isGM=false,roll=async()=>({resultTotal:12}),result=true}={}){
  const ops=[];let rolls=0;
  const session={participants:{
    p1:{kind:"runner",jackedIn:true,actions:{value:2,max:3}},
    p2:{kind:"runner",jackedIn:true,actions:{value:2,max:3}},
  },targets:{},pendingTests:[{id:"t1",pid:"p1"}]};
  const notes=[];
  const {listen}=load({
    game:{user:{id:"u1",isGM},actors:{get:id=>({id,name:"Runner"})}},
    getWorld:k=>k==="session"?session:{},
    bridge:{rollInterface:async(...args)=>{rolls++;return roll(...args);}},
    mutate:async(op)=>{ops.push(op);return op==="run.abilityResult"?result:true;},
    notifyClients:data=>notes.push(data),
    ui:{notifications:{warn(){},info(){}}},
  });
  return {ops,session,notes,listen,rolls:()=>rolls,spends:()=>ops.filter(o=>o==="run.spend").length};
}
const ABILITY='[data-action="ability-roll"]';
const backdoor=(pid="p1")=>({pid,actorId:"a1",ability:"backdoor",free:"false"});
for(const ability of ['speed','defense','cloak'])for(const cancelled of [false,true]){
  const w=abilityWorld({roll:async()=>cancelled?null:{resultTotal:12}}),effects=[];
  await w.listen({render(){},playConsoleEffect:(...args)=>effects.push(args)}).get(ABILITY)(click({...backdoor(),ability,free:String(ability!=='cloak')}));
  check(`${ability}: effect only after completed roll`,JSON.stringify(effects)===JSON.stringify(cancelled?[]:[[ability,'p1']]));
  check(`${ability}: correct action cost`,w.spends()===(cancelled||ability!=='cloak'?0:1));
}
{
  const w=abilityWorld({result:{error:'denied'}}),effects=[];
  await w.listen({render(){},playConsoleEffect:(...args)=>effects.push(args)}).get(ABILITY)(click({...backdoor(),ability:'cloak'}));
  check('Cloak rejected by GM has no success effect',effects.length===0);
}
for (const [name,roll,result,expected] of [
  ["confirmed scan",async()=>({resultTotal:12}),{ok:true,applied:false},1],
  ["cancelled scan",async()=>null,{ok:true},0],
  ["rejected scan",async()=>({resultTotal:12}),{error:"denied"},0],
]) {
  const w=abilityWorld({roll,result}),effects=[];
  await w.listen({render(){},playConsoleEffect:(...args)=>effects.push(args)}).get(ABILITY)(click({...backdoor(),ability:"pathfinder"}));
  check(`${name}: visual effects follow the confirmed action, never a cancelled or rejected roll`,
    effects.length===expected && (!expected || JSON.stringify(effects[0])===JSON.stringify(["scan","p1"])));
}
{
  const w=abilityWorld({isGM:false});
  await w.listen({render(){}}).get(ABILITY)(click(backdoor(),{shiftKey:true}));
  check("Player Shift-click still spends the NET action",w.spends()===1 && w.ops.includes("run.abilityResult"));
}
{
  const w=abilityWorld({isGM:true});
  await w.listen({render(){}}).get(ABILITY)(click(backdoor(),{shiftKey:true}));
  check("GM Shift-click waives the NET action",w.spends()===0 && w.ops.includes("run.abilityResult"));
}
{
  const w=abilityWorld({isGM:true});
  await w.listen({render(){}}).get(ABILITY)(click(backdoor()));
  check("GM click without Shift spends as before",w.spends()===1);
}
{
  const d=deferred();
  const w=abilityWorld({roll:()=>d.promise});
  const app={render(){}};
  const before=w.listen(app);
  const first=before.get(ABILITY)(click(backdoor()));
  const after=w.listen(app); // re-render: fresh handlers, same app
  const second=after.get(ABILITY)(click(backdoor()));
  const third=before.get(ABILITY)(click(backdoor()));
  const other=after.get(ABILITY)(click(backdoor("p2")));
  d.resolve({resultTotal:12});
  await Promise.all([first,second,third,other]);
  check("Concurrent clicks, across a re-render, open one roll and spend once per runner",w.rolls()===2 && w.spends()===2);
  await after.get(ABILITY)(click(backdoor()));
  check("A finished action releases the runner for the next click",w.rolls()===3 && w.spends()===3);
}
{
  let answer=null;
  const w=abilityWorld({roll:async()=>answer});
  const cb=w.listen({render(){}});
  await cb.get(ABILITY)(click(backdoor()));
  answer={resultTotal:9};
  await cb.get(ABILITY)(click(backdoor()));
  check("A cancelled CPR dialog spends nothing and does not lock the runner",w.rolls()===2 && w.spends()===1);
}
{
  const events=[];
  const w=abilityWorld({roll:async(_actor,_ability,event)=>{events.push(event);return null;}});
  const real={type:"click",shiftKey:false};
  await w.listen({render(){}}).get(ABILITY)(click(backdoor(),{originalEvent:real}));
  check("The real click event still reaches the CPR roll dialog",events[0]===real);
}

/* ---- SPEED test and defence prompts ---- */
{
  const d=deferred();
  const w=abilityWorld({roll:()=>d.promise});
  const cb=w.listen({render(){}});
  const data={testId:"t1",pid:"p1",actorId:"a1"};
  const a=cb.get('[data-action="speed-test-roll"]')(click(data));
  const b=cb.get('[data-action="speed-test-roll"]')(click(data));
  d.resolve({resultTotal:11});
  await Promise.all([a,b]);
  check("Double-clicked SPEED test rolls and reports once",w.rolls()===1 && w.notes.length===1 && w.notes[0].runnerTotal===11);
}
{
  const d=deferred();
  const w=abilityWorld({roll:()=>d.promise});
  const cb=w.listen({render(){}});
  const pending=cb.get('[data-action="speed-test-roll"]')(click({testId:"t1",pid:"p1",actorId:"a1"}));
  w.session.pendingTests=[]; // dismissed while the dialog was open
  d.resolve({resultTotal:11});
  await pending;
  check("A SPEED test cleared during the dialog is not answered",w.notes.length===0);
}
function defenseWorld(roll){
  const w=abilityWorld({roll});
  const app={render(){},_pendingDefense:[{id:"d1",pid:"p1",attackerName:"Hellhound",attackerTotal:14,attackerProg:null}]};
  return {...w,app,cb:w.listen(app)};
}
const DEF='[data-action="defense-roll"]';
const defData={testId:"d1",pid:"p1",actorId:"a1"};
{
  const d=deferred();
  const w=defenseWorld(()=>d.promise);
  const a=w.cb.get(DEF)(click(defData));
  const b=w.cb.get(DEF)(click(defData));
  d.resolve({resultTotal:8});
  await Promise.all([a,b]);
  check("Double-clicked defence rolls once and reports the real attack",
    w.rolls()===1 && w.notes.length===1 && w.notes[0].attackerTotal===14 && w.notes[0].defenseTotal===8 && w.app._pendingDefense.length===0);
  await w.cb.get(DEF)(click(defData));
  check("An answered defence prompt neither rolls nor reports again",w.rolls()===1 && w.notes.length===1);
}
{
  const d=deferred();
  const w=defenseWorld(()=>d.promise);
  const pending=w.cb.get(DEF)(click(defData));
  w.cb.get('[data-action="defense-dismiss"]')(click({testId:"d1"}));
  d.resolve({resultTotal:8});
  await pending;
  check("A defence dismissed during the dialog sends no zero-valued result",w.notes.length===0);
}
{
  let answer=null;
  const w=defenseWorld(async()=>answer);
  await w.cb.get(DEF)(click(defData));
  check("A cancelled defence roll keeps the prompt",w.notes.length===0 && w.app._pendingDefense.length===1);
  answer={resultTotal:15};
  await w.cb.get(DEF)(click(defData));
  check("…and it can still be answered afterwards",w.notes.length===1 && w.notes[0].attackerTotal===14);
}

/* ---- program activation / deactivation ---- */
function programWorld({cls="booster",isRezzed=false,installed=true,status="done",deploy=true,rez=null,actions=2,target=""}={}){
  const ops=[],rezCalls=[],warns=[];
  const program={id:"prog1",system:{class:cls,isRezzed}};
  const session={participants:{p1:{kind:"runner",jackedIn:true,floorIndex:2,actions:{value:actions,max:3}}},targets:{u1:target}};
  const actor={id:"a1",name:"Runner",getOwnedItem:id=>id==="prog1"?program:null};
  const {listen}=load({
    game:{user:{id:"u1",isGM:false},actors:{get:()=>actor}},
    getWorld:k=>k==="session"?session:{},
    canDerezTrap:()=>true,
    bridge:{
      getDeck:()=>({}),
      installedPrograms:()=>installed?[program]:[],
      rezProgram:async()=>{throw new Error("the checked setProgramRez must be used");},
      setProgramRez:rez || (async(_actor,_id,rezzed)=>{
        rezCalls.push(rezzed);
        const s=typeof status==="function"?status(rezzed):status;
        if (s==="done") program.system.isRezzed=rezzed;
        return {status:s,error:s==="done"||s==="noop"?undefined:"CRNS.Errors.SystemApi"};
      }),
    },
    mutate:async(op,payload)=>{ops.push({op,payload});return op==="run.progDeploy"?deploy:true;},
    ui:{notifications:{warn:m=>warns.push(m),info(){}}},
  });
  const cb=listen({render(){}});
  const data={pid:"p1",actorId:"a1",programId:"prog1",cls};
  return {
    ops,rezCalls,warns,program,cb,data,
    names:()=>ops.map(o=>o.op),
    activate:()=>cb.get('[data-action="program-activate"]')(click(data)),
    deactivate:()=>cb.get('[data-action="program-deactivate"]')(click(data)),
  };
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
{
  let activations=0;
  const {listen}=load({
    game:{user:{id:"player"},actors:{get:()=>({id:"runner",getOwnedItem:()=>({id:"prog1",system:{class:"booster",isRezzed:false}})})}},
    getWorld:()=>({participants:{p1:{kind:"runner",jackedIn:true,actions:{value:1,max:2}}}}),
    bridge:{getDeck:()=>({}),installedPrograms:()=>[{id:"prog1",system:{class:"booster"}}],setProgramRez:async()=>{activations++;return {status:"done"};}},
    mutate:async()=>({error:"CRNS.Errors.NoActions"}),
    ui:{notifications:{warn(){}}},
  });
  await listen({}).get('[data-action="program-activate"]')(click({pid:"p1",actorId:"runner",programId:"prog1",cls:"booster"}));
  check("Rejected GM action spend cannot activate a program",activations===0);
}
{
  const w=programWorld({installed:false});
  await w.activate();
  check("A program no longer installed is refused before any spend",w.ops.length===0 && w.rezCalls.length===0 && w.warns.length===1);
}
{
  const w=programWorld({isRezzed:true});
  await w.activate();
  check("Activating an already running program spends nothing",w.ops.length===0 && w.rezCalls.length===0);
  await w.deactivate();
  check("…and deactivating it spends once and derezzes",same(w.names(),["run.spend"]) && same(w.rezCalls,[false]));
}
{
  const w=programWorld();
  await w.deactivate();
  check("Deactivating a program that is not running spends nothing",w.ops.length===0 && w.rezCalls.length===0);
}
{
  const w=programWorld({status:"failed"});
  await w.activate();
  check("A confirmed failed rez gives the spent action back and warns",
    same(w.names(),["run.spend","run.give"]) && w.warns.includes("CRNS.Errors.SystemApi"));
}
{
  const w=programWorld({isRezzed:true,status:"failed"});
  await w.deactivate();
  check("A confirmed failed derez gives the spent action back",same(w.names(),["run.spend","run.give"]));
}
{
  const w=programWorld({status:"unknown"});
  await w.activate();
  check("An outcome that may have landed keeps the spent action",same(w.names(),["run.spend"]) && w.warns.length===1);
}
{
  const w=programWorld();
  await w.activate();
  check("A successful rez spends once and keeps it",same(w.names(),["run.spend"]) && same(w.rezCalls,[true]) && w.warns.length===0);
}
{
  const d=deferred();let calls=0;
  const w=programWorld({rez:async()=>{calls++;return d.promise;}});
  const a=w.activate(),b=w.activate();
  await settle();
  d.resolve({status:"done"});
  await Promise.all([a,b]);
  check("Double-clicked activation spends and rezzes once",calls===1 && same(w.names(),["run.spend"]));
}

/* ---- Black ICE ---- */
{
  const w=programWorld({cls:"blackice",isRezzed:true});
  await w.deactivate();
  check("Black ICE derez clears the mirror after a successful derez",same(w.names(),["run.spend","run.setRezzed"]) && w.ops[1].payload.state===null);
}
{
  const w=programWorld({cls:"blackice",isRezzed:true,status:"failed"});
  await w.deactivate();
  check("Black ICE derez that failed keeps the mirror and refunds",same(w.names(),["run.spend","run.give"]));
}
{
  const w=programWorld({cls:"blackice"});
  await w.activate();
  const deploy=w.ops.find(o=>o.op==="run.progDeploy");
  check("Black ICE without a target is set as a trap on the runner's floor",
    same(w.names(),["run.spend","run.setRezzed","run.progDeploy"]) && deploy.payload.mode==="trap" && deploy.payload.floorIndex===2);
}
{
  const w=programWorld({cls:"blackice",deploy:{error:"CRNS.Errors.NoTarget"},target:"runner:p9"});
  await w.activate();
  check("A refused deploy puts the Black ICE back down and refunds",
    same(w.rezCalls,[true,false]) && same(w.names(),["run.spend","run.setRezzed","run.progDeploy","run.setRezzed","run.give"]) &&
    w.ops[3].payload.state===null && !w.program.system.isRezzed && w.warns.includes("CRNS.Errors.NoTarget"));
}
{
  const w=programWorld({cls:"blackice",deploy:false,status:r=>r?"done":"failed"});
  await w.activate();
  check("If putting it back down fails, the running Black ICE is not hidden and nothing is refunded",
    same(w.names(),["run.spend","run.setRezzed","run.progDeploy"]) && w.program.system.isRezzed);
}
{
  const w=programWorld({cls:"blackice",deploy:null});
  await w.activate();
  check("An unanswered deploy is neither rolled back nor refunded",
    same(w.rezCalls,[true]) && same(w.names(),["run.spend","run.setRezzed","run.progDeploy"]) && w.warns.length===1);
}
{
  const w=programWorld({cls:"blackice",status:"failed"});
  await w.activate();
  check("A Black ICE that would not rez is refunded and never deployed",same(w.names(),["run.spend","run.give"]));
}

/* ---- bridge: what setProgramRez reports ---- */
function bridgeWorld({deck=true,program=true,isRezzed=false,cls="booster",rezThrows=false,flipThenThrow=false,persistThrows=false,resetThrows=false}={}){
  const notes=[];let persisted=0;
  const context=vm.createContext({loc:x=>x,_netActionsMax:()=>0,console:{error(){}},
    ui:{notifications:{warn:m=>notes.push(["warn",m]),error:m=>notes.push(["error",m])}}});
  vm.runInContext(bridgeSource,context);
  const prog={id:"prog1",isOwned:true,isEmbedded:true,system:{class:cls,isRezzed,rez:{value:1,max:5}},
    async setRezzed(){this.system.isRezzed=true;},unsetRezzed(){this.system.isRezzed=false;}};
  const deckDoc={id:"deck",isOwned:true,isEmbedded:true,system:{},
    async rezProgram(p){if(rezThrows) throw new Error("before");p.system.isRezzed=true;if(flipThenThrow) throw new Error("after");},
    async derezProgram(p){p.system.isRezzed=false;},
    async resetRezProgram(){if(resetThrows) throw new Error("reset");}};
  const actor={token:null,getEquippedCyberdeck:()=>deck?deckDoc:null,getOwnedItem:id=>program&&id==="prog1"?prog:null,
    async updateEmbeddedDocuments(){if(persistThrows) throw new Error("persist");persisted++;}};
  return {context,actor,prog,notes,persisted:()=>persisted};
}
const outcome=async(opts,rezzed=true)=>{const w=bridgeWorld(opts);return {w,res:await w.context.setProgramRez(w.actor,"prog1",rezzed)};};
{
  const {res}=await outcome({deck:false});
  check("setProgramRez: no deck is a known failure",res.status==="failed" && res.error==="CRNS.Errors.NoDeck");
}
{
  const {res}=await outcome({program:false});
  check("setProgramRez: missing program is a known failure",res.status==="failed");
}
{
  const {res}=await outcome({isRezzed:true});
  check("setProgramRez: already rezzed is a no-op",res.status==="noop");
}
{
  const {res,w}=await outcome({});
  check("setProgramRez: success is done and persisted",res.status==="done" && w.persisted()===1);
}
{
  const w=bridgeWorld();
  const res=await w.context.setProgramRez(w.actor,"prog1",true,{requireInstalled:true});
  check("setProgramRez: a program removed from the current deck is rejected without mutation",
    res.status==="failed" && w.persisted()===0 && !w.prog.system.isRezzed);
  w.actor.getEquippedCyberdeck().system.installedPrograms=[w.prog];
  const installed=await w.context.setProgramRez(w.actor,"prog1",true,{requireInstalled:true});
  check("setProgramRez: an installed program passes the post-spend deck check",
    installed.status==="done" && w.persisted()===1);
}
{
  const {res}=await outcome({rezThrows:true});
  check("setProgramRez: a throw before the program changed is a known failure",res.status==="failed");
}
{
  const {res}=await outcome({flipThenThrow:true});
  check("setProgramRez: a throw after the program flipped is unknown",res.status==="unknown");
}
{
  const {res}=await outcome({persistThrows:true});
  check("setProgramRez: a failed write to the server is unknown, not refundable",res.status==="unknown");
}
{
  const {res}=await outcome({isRezzed:true,resetThrows:true},false);
  check("setProgramRez: derez that threw after derezzing is unknown",res.status==="unknown");
}
{
  const {res}=await outcome({isRezzed:true,cls:"blackice"},false);
  check("setProgramRez: Black ICE derez uses the token-less path",res.status==="done");
}
{
  const w=bridgeWorld({persistThrows:true});
  const ok=await w.context.rezProgram(w.actor,"prog1");
  const none=bridgeWorld({deck:false});
  const noDeck=await none.context.derezProgram(none.actor,"prog1");
  check("rezProgram/derezProgram keep their boolean contract and notifications",
    ok===false && same(w.notes,[["error","CRNS.Errors.SystemApi"]]) && noDeck===false && same(none.notes,[["warn","CRNS.Errors.NoDeck"]]));
}

const failures=scenarios.filter(x=>!x.pass).length;
console.log(JSON.stringify({checks:scenarios.length,failures,scenarios},null,2));
process.exitCode=failures?1:0;
