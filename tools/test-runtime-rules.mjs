/* World-operation tests — the ops actually run.
 *
 *   node tools/test-ops.mjs
 *
 * Why this exists. Two bugs in a row got out because nothing ever *executed*
 * `data.js`. `session.connect` called `entryVisited(archs, archId)` with a name
 * that is a local of other operations and does not exist in that function;
 * `--check` passes, the module loads, and the failure waits until a GM presses
 * Connect — at which point the ReferenceError takes the whole operation down and
 * runners cannot be attached to an architecture at all. Before that, an import
 * shadowed by a local of the same name killed Save the same way.
 *
 * Both are invisible to any amount of reading and obvious the first time the
 * code is called. So call it: stub the parts of Foundry the data layer touches,
 * run the operations end to end, and assert on the world state they leave.
 *
 * The stub is deliberately thin. It is not a Foundry emulator — it is just
 * enough for the ops to reach their own logic.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CRNS_SOURCE_ROOT || path.resolve(HERE, "..");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  FAIL: ${message}`);
}

function eq(a, b, message) {
  expect(
    JSON.stringify(a) === JSON.stringify(b),
    `${message} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`
  );
}

/* ------------------------------------------------------------------ */
/* Loadable copy of the scripts                                        */
/* ------------------------------------------------------------------ */

/* `cpr-bridge.js` imports the system from Foundry-served absolute paths
 * (`/systems/cyberpunk-red-core/...`), which Node cannot resolve. Copy the
 * sources and point those three imports at a stub instead. Nothing else is
 * touched, so what runs here is the real data layer. */
function prepareScripts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crns-ops-"));
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) { copyDir(src, dst); continue; }
      if (!entry.name.endsWith(".js")) continue;
      let stub = path.relative(path.dirname(dst), path.join(tmp, "system-stub.js")).replace(/\\/g, "/");
      // Node reads a bare specifier as a package name, so a sibling file needs
      // the explicit "./".
      if (!stub.startsWith(".")) stub = `./${stub}`;
      const body = fs.readFileSync(src, "utf-8")
        .replace(/from\s+"\/systems\/[^"]+"/g, `from "${stub}"`);
      fs.writeFileSync(dst, body, "utf-8");
    }
  };
  copyDir(path.join(ROOT, "scripts"), tmp);

  fs.writeFileSync(path.join(tmp, "system-stub.js"), `
    export default {};
    export const CPRRolls = {};
    export class CPRChat {}
  `, "utf-8");
  return tmp;
}

/* ------------------------------------------------------------------ */
/* Foundry stub                                                        */
/* ------------------------------------------------------------------ */

const settings = new Map();
const chat = [];

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function installStubs() {
  globalThis.foundry = {
    utils: {
      deepClone,
      randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "0"),
      debounce: (fn) => fn,
      mergeObject: (a, b) => ({ ...a, ...b }),
      getProperty: (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj),
      duplicate: deepClone,
    },
  };
  globalThis.Hooks = { on: () => 0, once: () => 0, off: () => {}, callAll: () => {} };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.ChatMessage = {
    create: async (data) => { chat.push(data); return data; },
    getSpeaker: () => ({}),
  };
  globalThis.CONFIG = { Combat: { documentClass: class {} } };
  globalThis.fromUuidSync = (uuid) => globalThis.game.actors.find((a) => a.uuid === uuid) ?? null;
  globalThis.getDocumentClass = () => globalThis.Actor;
  globalThis.Actor = { create: async () => null };
  globalThis.Folder = { create: async () => null };

  globalThis.game = {
    system: { id: "cyberpunk-red-core" },
    user: { id: "gm", isGM: true },
    users: Object.assign([{ id: "gm", isGM: true, active: true, color: "#fff", name: "GM" }], {
      get(id) { return this.find((u) => u.id === id); },
      filter(fn) { return Array.prototype.filter.call(this, fn); },
    }),
    actors: Object.assign([], { get(id) { return this.find((a) => a.id === id); } }),
    combat: null,
    // Broadcasts to the other clients. Nothing here listens, but the ops that
    // highlight something on everyone's map do emit.
    socket: { emit() {}, on() {} },
    // `format` substitutes the values into the localised string. The stub has
    // no strings, so it appends them — enough to assert that what the code
    // passed in (a floor's name, a runner's name) actually reaches the card.
    i18n: {
      localize: (k) => k,
      format: (k, data = {}) => [k, ...Object.values(data)].join(" "),
    },
    settings: {
      get: (_scope, key) => settings.get(key),
      set: async (_scope, key, value) => { settings.set(key, value); return value; },
      register: () => {},
    },
  };
}

/* ------------------------------------------------------------------ */

console.log("World operations\n");

installStubs();
const scripts = prepareScripts();
const D = await import(pathToFileURL(path.join(scripts, "data.js")).href);
const C = await import(pathToFileURL(path.join(scripts, "rules", "abilities.js")).href);

/** Reset the world to empty defaults before each scenario. */
function freshWorld() {
  settings.clear();
  for (const [key, value] of Object.entries(D.WORLD_OBJECTS)) {
    settings.set(key, deepClone(value));
  }
}

/** Put an architecture straight into the world, bypassing the editor. */
function seedArch(floors) {
  const archs = { a1: { id: "a1", name: "Test", floors } };
  settings.set("netArchs", archs);
  return archs;
}

const RUNNER = { id: "act1", uuid: "Actor.act1", name: "Runner", img: "", isOwner: true };


const outcomes = [];
async function scenario(name, fn) {
  freshWorld(); game.combat = null; game.actors.length = 0;
  seedArch([
    {id:"f1",parent:"",kind:"controlnode",dv:6,ice:[],demon:null},
    {id:"f2",parent:"f1",kind:"custom",dv:0,ice:[],demon:null},
  ]);
  const role = {id:"role",system:{rank:4}};
  game.actors.push({...RUNNER, system:{roleInfo:{activeNetRole:"role"}}, itemTypes:{role:[role]}});
  await D.applyOp("session.connect",{pid:"p1",actorUuid:"Actor.act1",userId:"player",archId:"a1"},"gm");
  const before=failures;
  await fn();
  outcomes.push({name,pass:failures===before});
}
function getPart() { return settings.get("session").participants.p1; }
function editSession(fn) { const s=deepClone(settings.get("session")); fn(s); settings.set("session",s); }
function iceFixture() {
  const archs=deepClone(settings.get("netArchs"));
  archs.a1.floors[0].ice=[{id:"ice1",actorId:"iceactor",type:"hellhound"}];
  settings.set("netArchs",archs);
  game.actors.push({id:"iceactor",type:"blackIce",name:"Hellhound",system:{stats:{rez:{value:20,max:20}}}});
  editSession(s=>{s.attachments=[{archId:"a1",iceId:"ice1",pid:"p1"}]; s.participants.p1.actions={value:5,max:5};});
}
await scenario("NET budget denies overspending and invalid costs", async()=>{
  expect(getPart().actions.value===2,"rank4 connection leaves2actions");
  expect(await D.applyOp("run.spend",{pid:"p1",n:2},"player")===true,"spend2");
  expect((await D.applyOp("run.spend",{pid:"p1",n:1},"player"))?.error==="CRNS.Errors.NoActions","overdraw denied");
  for (const n of [-1,0,0.5,Infinity]) expect((await D.applyOp("run.spend",{pid:"p1",n},"player"))?.error,"invalid cost denied");
  expect(getPart().actions.value===0,"invalid costs did not refill");
});
await scenario("Concurrent writes cannot lose an action spend", async()=>{
  const oldSet=game.settings.set;
  game.settings.set=async(scope,key,value)=>{await new Promise(r=>setTimeout(r,10));return oldSet(scope,key,value);};
  try {
    const results=await Promise.all([1,2,3].map(()=>D.applyOp("run.spend",{pid:"p1",n:1},"player")));
    expect(results.filter(x=>x===true).length===2,"only two of three spends accepted");
    expect(getPart().actions.value===0,"two actions debited");
  } finally {game.settings.set=oldSet;}
});
await scenario("Node activation once per turn, atomic action cost and refresh", async()=>{
  await D.applyOp("run.abilityResult",{pid:"p1",ability:"control",total:12},"player");
  expect(await D.applyOp("run.nodePulse",{archId:"a1",floorId:"f1"},"player")===true,"first activation");
  expect(getPart().actions.value===1,"activation cost1");
  expect((await D.applyOp("run.nodePulse",{archId:"a1",floorId:"f1"},"player"))?.error==="CRNS.Errors.NodeUsed","second activation denied");
  expect(getPart().actions.value===1,"denied activation does not spend");
  await D.applyOp("run.reset",{pid:"p1"},"gm");
  expect(await D.applyOp("run.nodePulse",{archId:"a1",floorId:"f1"},"player")===true,"next manual turn permits activation");
});
await scenario("Combat node limit survives a manual action refill", async()=>{
  game.combat={id:"combat1",started:true,round:1,turn:0};
  await D.applyOp("run.abilityResult",{pid:"p1",ability:"control",total:12},"player");
  await D.applyOp("run.nodePulse",{archId:"a1",floorId:"f1"},"player");
  await D.applyOp("run.reset",{pid:"p1"},"gm");
  expect((await D.applyOp("run.nodePulse",{archId:"a1",floorId:"f1"},"player"))?.error==="CRNS.Errors.NodeUsed","refill does not undo combat turn limit");
  game.combat.turn=1;
  expect(await D.applyOp("run.nodePulse",{archId:"a1",floorId:"f1"},"player")===true,"new combat turn permits activation");
});
await scenario("Jack out clears control, passwords, private progress and pending effects",async()=>{
  editSession(s=>{
    s.participants.p1.floorIndex=1;s.participants.p1.visited=["f1","f2"];
    s.floorState["a1:f1"]={breached:true,control:{pid:"p1",dv:12},eyedee:["p1"],virusWork:{p1:2},viruses:[{pid:"p1",id:"v1"}]};
    s.pendingTests=[{id:"speed",pid:"p1"}]; s.slid=[{pid:"p1",archId:"a1",iceId:"ice1"}];
  });
  expect(await D.applyOp("run.jack",{pid:"p1",in:false},"player")===true,"jackout");
  const st=settings.get("session"),fx=st.floorState["a1:f1"];
  expect(getPart().floorIndex===0 && !getPart().jackedIn,"back atentry disconnected");
  expect(!fx.breached && !fx.control && !fx.virusWork.p1 && fx.eyedee.length===0,"ephemeral progress cleared");
  expect(fx.viruses.length===1,"installedvirus survives");
  expect(!st.pendingTests.length && !st.slid.length,"old reaction states cleared");
  expect((await D.applyOp("run.abilityResult",{pid:"p1",ability:"control",total:20},"player"))?.applied===false,"disconnected cannot acquirecontrol");
  expect(await D.applyOp("session.move",{pid:"p1",floorIndex:1},"player")===false,"disconnectedcannotmove");
  const before=getPart().actions.value;
  await D.applyOp("run.jack",{pid:"p1",in:false},"player");
  expect(getPart().actions.value===before,"duplicatejackout costsnothing");
});
await scenario("Roster disconnect also drops node ownership",async()=>{
  await D.applyOp("run.abilityResult",{pid:"p1",ability:"control",total:12},"player");
  await D.applyOp("session.disconnect",{pid:"p1"},"player");
  expect(!settings.get("session").floorState["a1:f1"].control,"disconnectdropsnode");
});
await scenario("GM switching architectures releases the old control node",async()=>{
  await D.applyOp("run.abilityResult",{pid:"p1",ability:"control",total:12},"player");
  settings.get("netArchs").a2={id:"a2",name:"Second",floors:[{id:"x1",parent:"",kind:"custom",ice:[],demon:null}]};
  await D.applyOp("session.connect",{pid:"p1",actorUuid:"Actor.act1",userId:"player",archId:"a2"},"gm");
  expect(!settings.get("session").floorState["a1:f1"].control,"oldsuitenodeisreleased");
  expect(getPart().archId==="a2","connectedtonewarch");
});
await scenario("Slide once per turn, failed attempt still costs action",async()=>{
  iceFixture();
  const attempt={pid:"p1",testRef:"ice:a1:f1:ice1",total:12,floorIndex:1};
  expect(await D.applyOp("run.slideAttempt",attempt,"player")===true,"attempt accepted");
  expect(getPart().actions.value===4,"attemptcost1");
  const pending=getPart().slidePending;
  if(pending) await D.applyOp("run.slideResolve",{pid:"p1",archId:"a1",iceId:"ice1",attemptId:pending.id,success:false},"gm");
  expect((await D.applyOp("run.slideAttempt",attempt,"player"))?.error==="CRNS.Errors.SlideUsed","second attempt denied afterfailure");
  expect(getPart().actions.value===4,"deniedattemptdoesnotspend");
});
await scenario("Slide cannot target demons, unengaged ICE, dead ICE or cross a password",async()=>{
  iceFixture();
  const attempt={pid:"p1",testRef:"demon:a1:f1:d1",total:12,floorIndex:1};
  expect((await D.applyOp("run.slideAttempt",attempt,"player"))?.error==="CRNS.Errors.SlideTarget","demon denied");
  attempt.testRef="ice:a1:f1:ice1";
  editSession(s=>s.attachments=[]);
  expect((await D.applyOp("run.slideAttempt",attempt,"player"))?.error==="CRNS.Errors.SlideTarget","unengaged denied");
  editSession(s=>s.attachments=[{pid:"p1",archId:"a1",iceId:"ice1"}]);
  game.actors.get("iceactor").system.stats.rez.value=0;
  expect((await D.applyOp("run.slideAttempt",attempt,"player"))?.error==="CRNS.Errors.SlideTarget","dead denied");
  game.actors.get("iceactor").system.stats.rez.value=20;
  settings.get("netArchs").a1.floors[0].kind="password";
  expect((await D.applyOp("run.slideAttempt",attempt,"player"))?.error==="CRNS.Errors.MoveStep","password denied");
  expect(getPart().actions.value===5,"invalidslidesfree");
});
await scenario("Successful Slide moves adjacent, leaves ICE behind and rejects duplicate resolution",async()=>{
  iceFixture();
  await D.applyOp("run.slideAttempt",{pid:"p1",testRef:"ice:a1:f1:ice1",total:15,floorIndex:1},"player");
  const pending=getPart().slidePending;
  const args={pid:"p1",archId:"a1",iceId:"ice1",attemptId:pending?.id,success:true};
  expect(await D.applyOp("run.slideResolve",args,"gm")===true,"resolveaccepted");
  expect(getPart().floorIndex===1,"runnerescapedadjacent");
  expect(settings.get("netArchs").a1.floors[0].ice.some(i=>i.id==="ice1"),"iceremainsatstart");
  expect(!settings.get("session").attachments.length,"icenolongerchases");
  expect(await D.applyOp("run.slideResolve",args,"gm")===false,"duplicateignored");
});
await scenario("Returning to escaped ICE starts a new encounter",async()=>{
  iceFixture();
  globalThis.Combat={create:async()=>null};globalThis.canvas={scene:null};
  game.users.push({id:"player",isGM:false,active:true});
  try {
    await D.applyOp("run.slideAttempt",{pid:"p1",testRef:"ice:a1:f1:ice1",total:15,floorIndex:1},"player");
    const pending=getPart().slidePending;
    if(pending) await D.applyOp("run.slideResolve",{pid:"p1",archId:"a1",iceId:"ice1",attemptId:pending.id,success:true},"gm");
    await D.applyOp("session.move",{pid:"p1",floorIndex:0},"player");
    const st=settings.get("session");
    expect(st.attachments.some(a=>a.pid==="p1"&&a.iceId==="ice1"),"escapedICEcanengageagain");
    expect(st.pendingTests.some(t=>t.pid==="p1"&&t.iceActorId==="iceactor"),"newencounterspeedtest");
  } finally {game.users.splice(game.users.findIndex(u=>u.id==="player"),1);}
});
await scenario("Slide retry reuses saved attempt without spending",async()=>{
  iceFixture();
  await D.applyOp("run.slideAttempt",{pid:"p1",testRef:"ice:a1:f1:ice1",total:15,floorIndex:1},"player");
  const before=getPart().actions.value, id=getPart().slidePending?.id;
  expect(await D.applyOp("run.slideRetry",{pid:"p1"},"player")===true,"retry accepted");
  expect(getPart().actions.value===before && getPart().slidePending?.id===id,"savedattempt unchanged");
  expect(await D.applyOp("run.slideRetry",{pid:"p1"},"other")===false,"otheruser denied");
});
await scenario("Participant ownership blocks other players' moves and spends",async()=>{
  expect(await D.applyOp("run.spend",{pid:"p1",n:1},"other")===false,"strangerspenddenied");
  expect(await D.applyOp("session.move",{pid:"p1",floorIndex:1},"other")===false,"strangermovedenied");
  expect(await D.applyOp("run.jack",{pid:"p1",in:false},"other")===false,"strangerdisconnectdenied");
  expect(getPart().actions.value===2,"nochange");
});
await scenario("Every installed rezzed program leaves on jack out",async()=>{
  const programs = ["booster", "blackice"].map((cls,n)=>({id:`p${n}`,system:{class:cls,isRezzed:true,rez:{value:2,max:7}},unsetRezzed(){this.system.isRezzed=false;}}));
  const deck = {system:{installedPrograms:programs},derezProgram:async p=>p.unsetRezzed(),resetRezProgram:async p=>{p.system.rez.value=p.system.rez.max;}};
  const actor=game.actors.get("act1");
  actor.getEquippedCyberdeck=()=>deck; actor.getOwnedItem=id=>programs.find(p=>p.id===id);
  await D.applyOp("run.jack",{pid:"p1",in:false},"player");
  expect(programs.every(p=>!p.system.isRezzed),"real program state cleared, not only mirror");
});
await scenario("Deployment rejects absent and ordinary programs",async()=>{
  expect(await D.applyOp("run.progDeploy",{pid:"p1",programId:"missing",mode:"trap"},"player")===false,"missing program rejected");
  const actor=game.actors.get("act1"), program={id:"booster",system:{class:"booster",isRezzed:true}};
  actor.getOwnedItem=()=>program;actor.getEquippedCyberdeck=()=>({system:{installedPrograms:[program]}});
  expect(await D.applyOp("run.progDeploy",{pid:"p1",programId:"booster",mode:"trap"},"player")===false,"booster cannot become ICE");
  expect(!Object.keys(settings.get("session").progState).length,"no phantom entity created");
});
await scenario("Secondary GM relays writes through primary GM",async()=>{
  const oldUser=game.user, oldEmit=game.socket.emit;
  game.users.push({id:"gm2",isGM:true,active:true}); game.user=game.users.get("gm2");
  let relayed=false;
  game.socket.emit=(_name,data)=>{relayed=data.action==="mutate";queueMicrotask(()=>D.resolveMutation(data.requestId,true));};
  try { expect(await D.mutate("run.spend",{pid:"p1",n:1})===true && relayed,"secondary GM uses primary queue"); }
  finally {game.user=oldUser;game.socket.emit=oldEmit;game.users.splice(game.users.findIndex(u=>u.id==="gm2"),1);}
});
fs.rmSync(scripts,{recursive:true,force:true});
console.log(JSON.stringify({checks,failures,scenarios:outcomes},null,2));
process.exit(failures?1:0);
