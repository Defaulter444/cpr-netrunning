/* Run real click callbacks; no rendered Foundry DOM or system implementation is emulated. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
const root=process.env.CRNS_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"scripts/apps/actions.js"),"utf8")
  .replace(/^import .+;\r?$/gm,"").replace(/^export /gm,"");
const scenarios=[];
for (const name of ["demon-action","demon-zap"]) {
  for (const exhausted of [false,true]) {
    const callbacks=new Map();let spends=0,rolls=0;
    const context=vm.createContext({
      foundry:{utils:{debounce:fn=>fn}},
      game:{user:{id:"gm",isGM:true},actors:{get:()=>({id:"d1"})}},
      getWorld:()=>({demonState:{d1:{value:exhausted?0:2,max:2}},targets:{}}),
      bridge:{rollEntityStat:async()=>{rolls++;return null;}},
      mutate:async()=>{spends++;return true;},loc:x=>x,
      ui:{notifications:{warn(){}}},
    });
    vm.runInContext(source,context);
    context.activateListeners({}, {find:selector=>({on:(_event,fn)=>callbacks.set(selector,fn)})});
    await callbacks.get(`[data-action="${name}"]`)({preventDefault(){},currentTarget:{dataset:{actorId:"d1"}}});
    scenarios.push({name:`${name}: ${exhausted?"no roll at zero actions":"cancelled roll spends nothing"}`,pass:spends===0 && rolls===(exhausted?0:1)});
  }
}
{
  const callbacks=new Map();let activations=0;
  const context=vm.createContext({
    foundry:{utils:{debounce:fn=>fn}},
    game:{user:{id:"player"},actors:{get:()=>({id:"runner"})}},
    getWorld:()=>({participants:{p1:{kind:"runner",jackedIn:true,actions:{value:1,max:2}}}}),
    bridge:{rezProgram:async()=>{activations++;}},
    mutate:async()=>({error:"CRNS.Errors.NoActions"}),loc:x=>x,
    ui:{notifications:{warn(){}}},
  });
  vm.runInContext(source,context);
  context.activateListeners({}, {find:selector=>({on:(_event,fn)=>callbacks.set(selector,fn)})});
  await callbacks.get('[data-action="program-activate"]')({currentTarget:{dataset:{pid:"p1",actorId:"runner",programId:"prog1",cls:"booster"}}});
  scenarios.push({name:"Rejected GM action spend cannot activate a program",pass:activations===0});
}
const failures=scenarios.filter(x=>!x.pass).length;
console.log(JSON.stringify({checks:scenarios.length,failures,scenarios},null,2));
process.exitCode=failures?1:0;
