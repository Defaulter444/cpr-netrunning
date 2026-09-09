/* Foundry v12 fires combatTurn before applying its update and combatTurnChange after. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root = process.env.CRNS_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "scripts/main.js"), "utf8");
const start = src.indexOf("const resetCombatTurns") >= 0 ? src.indexOf("const resetCombatTurns") : src.indexOf("function resetRunnerForCombatant");
const end = src.indexOf("/* ------------------------------------------------------------------ */", start);
const listeners = new Map(), calls = [];
const context = vm.createContext({
  isPrimaryGM: () => true,
  getWorld: () => ({participants: {old: {kind:"runner",actorUuid:"Actor.old"},next: {kind:"runner",actorUuid:"Actor.next"}}}),
  hasOp: () => true, mutate: (op, payload) => calls.push({op,payload}),
  Hooks: {on: (name, fn) => listeners.set(name, fn)},
});
vm.runInContext(src.slice(start,end),context);
const combat = {id:"c1",started:true,round:1,turn:0,combatant:{actor:{uuid:"Actor.old",type:"character"}}};
listeners.get("combatTurn")?.(combat,{round:1,turn:1});
const noPremature = calls.length===0;
combat.turn=1; combat.combatant.actor={uuid:"Actor.next",type:"character"};
listeners.get("combatTurnChange")?.(combat);
const correct = calls.length===1 && calls[0].payload.pid==="next";
listeners.get("combatTurnChange")?.(combat);
const once = calls.length===1;
combat.round=2; combat.turn=0; combat.combatant.actor={uuid:"Actor.old",type:"character"};
listeners.get("combatTurnChange")?.(combat);
const wrap = calls.length===2 && calls[1].payload.pid==="old";
const scenarios = [
  {name:"No outgoing runner refill from pre-update hook",pass:noPremature},
  {name:"Incoming runner refilled after turn changes",pass:correct},
  {name:"Duplicate notification does not refill spent actions",pass:once},
  {name:"First runner refilled on next round",pass:wrap},
];
const failures=scenarios.filter(x=>!x.pass).length;
console.log(JSON.stringify({checks:scenarios.length,failures,scenarios},null,2));
process.exitCode=failures?1:0;
