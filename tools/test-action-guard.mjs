/* The per-app, per-runner pending-action guard used by the action bar. */
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=process.env.CRNS_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const {withRunnerGuard,runnerBusy}=await import(pathToFileURL(path.join(root,"scripts/apps/action-guard.mjs")).href);
const scenarios=[];
const check=(name,pass)=>scenarios.push({name,pass:!!pass});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

{
  const app={},d=deferred();let runs=0;
  const first=withRunnerGuard(app,"p1",async()=>{runs++;return d.promise;});
  const second=withRunnerGuard(app,"p1",async()=>{runs++;return "second";});
  check("The claim is taken before the first await",runnerBusy(app,"p1"));
  d.resolve("first");
  check("A second action for the same runner is dropped",await second===undefined && await first==="first" && runs===1);
  check("The claim is released once the action ends",!runnerBusy(app,"p1"));
}
{
  const app={},d=deferred();let runs=0;
  const held=withRunnerGuard(app,"p1",()=>d.promise);
  await withRunnerGuard(app,"p2",async()=>{runs++;});
  await withRunnerGuard({},"p1",async()=>{runs++;});
  d.resolve();await held;
  check("Other runners and other apps are not blocked",runs===2);
}
{
  const app={};let threw=false,runs=0;
  try { await withRunnerGuard(app,"p1",async()=>{throw new Error("boom");}); } catch (e) { threw=e.message==="boom"; }
  await withRunnerGuard(app,"p1",async()=>{runs++;});
  check("A throwing action propagates and still releases the runner",threw && runs===1 && !runnerBusy(app,"p1"));
}
{
  const app={};
  const res=await withRunnerGuard(app,"p1",async()=>null);
  check("A cancelled action (null) passes through and releases",res===null && !runnerBusy(app,"p1"));
}

const failures=scenarios.filter(x=>!x.pass).length;
console.log(JSON.stringify({checks:scenarios.length,failures,scenarios},null,2));
process.exitCode=failures?1:0;
