import test from "node:test";
import assert from "node:assert/strict";
import { environment, makeScene, makeToken } from "./helpers.mjs";
import { apData } from "../../scripts/scanner/model.js";

globalThis.Application = class {
  static get defaultOptions() { return {}; }
  constructor(options = {}) { this.options = { ...this.constructor.defaultOptions, ...options }; this.element = { find: () => ({ prop: () => {} }) }; }
  render() { this.rendered = true; return this; }
  bringToTop() { assert.ok(this.element[0]?.isConnected, "Cannot raise a window before its element exists"); this.raised = (this.raised ?? 0) + 1; }
  async close() { this.rendered = false; }
};
globalThis.FormApplication = class extends Application { constructor(object, options) { super(options); this.object = object; } };
const { openScanner, ScannerPanel, APEditor, installAPDoubleClick, registerUI } = await import("../../scripts/scanner/ui.js");

test("right-click selection replaces stale selections from an earlier Scanner window", async () => {
  environment(); const scene = makeScene("manual"); const a = makeToken(scene, "a"), b = makeToken(scene, "b");
  const panel = openScanner({ scene, selected: [a.id] }); panel.radius = 4;
  openScanner({ scene, selected: [b.id] });
  assert.deepEqual([...panel.selected], [b.id]); assert.equal(panel.radius, 0);
  await panel.close();
});
test("a new ambiguous Scanner result does not inherit the last Netrunner", async () => {
  environment(); const scene = makeScene("ambiguous"); const runner = makeToken(scene, "runner", { ap: false });
  const panel = openScanner({ scene, runnerId: runner.id, result: 14 });
  panel.selected.add("old-ap");
  openScanner({ scene, runnerId: "", result: 15 });
  assert.equal(panel.runnerId, ""); assert.equal(panel.selected.size, 0);
  await panel.close();
});
test("bulk Apply excludes checked APs outside the current radius", async () => {
  environment(); const scene = makeScene("radius"); const runner = makeToken(scene, "runner", { ap: false });
  const near = makeToken(scene, "near", { x: 100 }), far = makeToken(scene, "far", { x: 1000 });
  const panel = new ScannerPanel({ scene, runnerId: runner.id, selected: [near.id, far.id] });
  panel.radius = 5; panel.getData(); panel.bulkChanges = { reveal: "all" };
  await panel.handleAction("apply");
  assert.equal(apData(near).discovery.revealed, true);
  assert.equal(apData(far).discovery.revealed, false);
});
test("zero radius allows selecting all scene APs for bulk Apply", async () => {
  environment(); const scene = makeScene("all"); const runner = makeToken(scene, "runner", { ap: false });
  const near = makeToken(scene, "near", { x: 100 }), far = makeToken(scene, "far", { x: 1000 });
  const panel = new ScannerPanel({ scene, runnerId: runner.id }); panel.radius = 0;
  await panel.handleAction("select-visible");
  panel.bulkChanges = { reveal: "all" };
  await panel.handleAction("apply");
  assert.equal(apData(near).discovery.revealed, true);
  assert.equal(apData(far).discovery.revealed, true);
});

test("filtering clears hidden selections permanently without changing AP state", () => {
  environment(); const scene=makeScene(), runner=makeToken(scene,"runner",{ap:false});
  const near=makeToken(scene,"near",{x:100}), far=makeToken(scene,"far",{x:1000});
  apData(far).showName=true; apData(far).discovery={revealed:true,public:true,users:[]};
  apData(far).pulse={loop:true};
  const before=structuredClone(apData(far));
  const panel=new ScannerPanel({scene,runnerId:runner.id,selected:[near.id,far.id]});
  panel.bulkChanges={reveal:"hidden"}; panel.radius=5; panel.getData();
  assert.deepEqual([...panel.selected],[near.id]);
  assert.deepEqual(panel.bulkChanges,{});
  panel.radius=0; panel.getData();
  assert.equal(panel.selected.has(far.id),false);
  assert.deepEqual(apData(far),before);
});

test("opening Scanner waits for a connected window before bringing it to the front", async () => {
  environment(); const scene=makeScene("render-lifecycle");
  const panel=openScanner({scene});
  assert.equal(panel.raised, undefined);
  panel.element[0]={isConnected:true};
  openScanner({scene});
  assert.equal(panel.raised,1);
  panel.element[0].isConnected=false;
  openScanner({scene});
  assert.equal(panel.raised,1);
  await panel.close();
});

test("GM panel embeds a fresh native card without the reopen button", async () => {
  environment(); const scene=makeScene(); let removed=false, calls=0;
  const card={querySelectorAll:selector=>{assert.equal(selector,".crns-ap-open-scanner");return [{remove:()=>{removed=true;}}];}};
  const message={visible:true,getHTML:async()=>{calls++;return [card];}};
  game.messages=new Map([["roll",message]]);
  const panel=new ScannerPanel({scene,messageId:"roll",result:14});
  const host={isConnected:true,replaceChildren:value=>{host.card=value;}};
  await panel.renderRollCard({querySelector:()=>host});
  assert.equal(calls,1); assert.equal(host.card,card); assert.equal(removed,true);
  assert.equal(panel.getData().hasRollCard,true);
});

test("late chat rendering cannot overwrite a newer Scanner roll", async () => {
  environment(); const scene=makeScene(); let finish;
  const message={visible:true,getHTML:()=>new Promise(resolve=>{finish=resolve;})};
  game.messages=new Map([["old",message]]);
  const panel=new ScannerPanel({scene,messageId:"old"});
  const host={isConnected:true,replaceChildren:()=>assert.fail("Stale card inserted")};
  const pending=panel.renderRollCard({querySelector:()=>host});
  panel.messageId="new"; finish([{}]); await pending;
});

test("missing or hidden messages show a fallback without rendering their contents", async () => {
  environment(); const scene=makeScene(); game.messages=new Map();
  const panel=new ScannerPanel({scene,messageId:"missing"});
  const host={isConnected:true};
  await panel.renderRollCard({querySelector:()=>host});
  assert.match(host.textContent,/удалена/);
  game.messages.set("missing",{visible:false,getHTML:()=>assert.fail("Hidden message rendered")});
  await panel.renderRollCard({querySelector:()=>host});
  assert.match(host.textContent,/удалена/);
});

test("a new Scanner roll replaces the previous card reference", async () => {
  environment(); const scene=makeScene("card-replacement");
  const panel=openScanner({scene,result:14,messageId:"first"});
  openScanner({scene,result:17,messageId:"second"});
  assert.equal(panel.messageId,"second"); assert.equal(panel.result,17);
  openScanner({scene,result:9});
  assert.equal(panel.messageId,null); assert.equal(panel.getData().hasRollCard,false);
  await panel.close();
});

test("Netrunner dropdown filters roles and optionally player ownership, including offline owners", () => {
  environment(); const scene=makeScene();
  const player=makeToken(scene,"player-runner",{ap:false});
  const npc=makeToken(scene,"npc-runner",{ap:false,owners:[]});
  const offline=makeToken(scene,"offline-runner",{ap:false,owners:["offline"]});
  const solo=makeToken(scene,"solo",{ap:false}); solo.actor.items.clear();
  solo.actor.items.set("solo",{id:"solo",type:"role",name:"Solo"});
  const fake=makeToken(scene,"Netrunner",{ap:false}); fake.actor.items.clear();
  fake.actor.items.set("skill",{id:"skill",type:"skill",name:"Netrunner"});
  makeToken(scene,"ap");
  const panel=new ScannerPanel({scene,runnerId:npc.id});
  assert.equal(panel.getData().playerOwnedOnly,true);

  assert.deepEqual(panel.getData().runners.map(r=>r.id),[player.id,offline.id]);
  assert.equal(panel.runnerId,""); assert.equal(panel.runner,null);
  panel.playerOwnedOnly=false;
  assert.ok(panel.getData().runners.some(r=>r.id===npc.id));
});

test("Netrunner list follows token additions and embedded role changes", () => {
  environment(); const scene=makeScene(); const panel=new ScannerPanel({scene});
  assert.equal(panel.getData().runners.length,0);
  const runner=makeToken(scene,"new-runner",{ap:false});
  runner.actor.items.get("netrunner-role").name=" NETRUNNER ";
  assert.equal(panel.getData().runners[0].id,runner.id);
  runner.actor.items.clear();
  assert.equal(panel.getData().runners.length,0);
});

test("Show Reveal to all controls visibility without changing existing discoveries", () => {
  const {values}=environment(); const scene=makeScene(), ap=makeToken(scene);
  apData(ap).discovery={revealed:true,public:true,users:[]};
  const panel=new ScannerPanel({scene,selected:[ap.id]});
  assert.ok(panel.getData().rows[0].controls.some(option=>option.key==="all"));
  panel.bulkChanges={reveal:"all",pulse:"loop"};
  values.set("showRevealAll",false);
  const data=panel.getData();
  assert.equal(data.showRevealAll,false);
  assert.equal(data.rows[0].controls.some(option=>option.key==="all"),false);
  assert.equal(data.bulkControls.some(option=>option.key==="all"),false);
  assert.deepEqual(panel.bulkChanges,{pulse:"loop"});
  assert.equal(apData(ap).discovery.public,true);
  values.set("showRevealAll",true);
  assert.ok(panel.getData().bulkControls.some(option=>option.key==="all"));
});

test("displayed distances and selection filtering share the scene grid measurement", () => {
  environment(); const scene=makeScene(), runner=makeToken(scene,"runner",{ap:false});
  const ap=makeToken(scene,"ap",{x:300,y:400});
  scene.grid.measurePath=()=>({distance:8,euclidean:10});
  const panel=new ScannerPanel({scene,runnerId:runner.id,selected:[ap.id]}); panel.radius=9;
  assert.equal(panel.getData().rows[0].distanceText,"8.0");
  assert.deepEqual(panel.selectedDocuments(),[ap]);
  scene.grid.measurePath=()=>({distance:14,euclidean:10});
  assert.equal(panel.getData().rows[0].visible,false);
  assert.equal(panel.selected.size,0);
});

test("private reveals follow the selected second Netrunner for row and bulk actions", async () => {
  environment(); const scene=makeScene();
  const first=makeToken(scene,"first",{ap:false,owners:["player"]});
  const second=makeToken(scene,"second",{ap:false,owners:["other"]});
  const a=makeToken(scene,"a"), b=makeToken(scene,"b");
  const panel=new ScannerPanel({scene,runnerId:first.id,selected:[a.id,b.id]});
  await panel.applyControls([a],{reveal:"runner"});
  assert.deepEqual(apData(a).discovery.users,["player"]);
  panel.readRunnerSelection({querySelector:()=>({value:second.id})});
  let data=panel.getData();
  assert.equal(data.rows.find(row=>row.id===a.id).controls.find(option=>option.key==="runner").checked,false);
  await panel.applyControls([a],{reveal:"runner"});
  assert.deepEqual(apData(a).discovery.users,["player","other"]);
  assert.deepEqual(apData(a).discovery.runners,[first.uuid,second.uuid]);
  panel.bulkChanges={reveal:"runner"};
  await panel.handleAction("apply");
  assert.deepEqual(apData(b).discovery.users,["other"]);
  data=panel.getData();
  assert.equal(data.bulkControls.find(option=>option.key==="runner").checked,true);
  panel.runnerId=first.id;
  assert.equal(panel.getData().bulkControls.find(option=>option.key==="runner").checked,false);
});

test("Revealed to shows the recorded Netrunner token rather than its player accounts or current selection", async () => {
  environment(); const scene=makeScene();
  const pex=makeToken(scene,"pex-token",{ap:false,name:"Pex",owners:["player","other"]});
  const other=makeToken(scene,"other-token",{ap:false,name:"Other runner"});
  const ap=makeToken(scene,"ap");
  const panel=new ScannerPanel({scene,runnerId:pex.id});
  await panel.applyControls([ap],{reveal:"runner"});
  const discovery=structuredClone(apData(ap).discovery);
  panel.runnerId=other.id;
  let row=panel.getData().rows[0];
  assert.equal(row.status,"Pex");
  assert.match(row.statusTitle,/Netrunner player/);
  assert.match(row.statusTitle,/Other player/);
  assert.deepEqual(apData(ap).discovery,discovery);
  scene.tokens.delete(pex.id);
  assert.equal(panel.getData().rows[0].status,"Токен нетраннера удалён");
});

test("GM AP double-click opens properties and preserves ordinary container behavior", () => {
  environment(); const scene = makeScene("double-click");
  const ap = makeToken(scene, "ap");
  const ordinary = makeToken(scene, "container", { ap: false }); ordinary.actor.type = "container";
  const calls = [];
  class Token {
    constructor(document) { this.document = document; }
    _onClickLeft2(...args) { calls.push({ token: this, args }); return "native"; }
  }
  globalThis.CONFIG = { Token: { objectClass: Token } };
  installAPDoubleClick(Token);
  const installed = Token.prototype._onClickLeft2;
  globalThis.CONFIG = { Token: { objectClass: Token } };
  installAPDoubleClick(Token);
  assert.equal(Token.prototype._onClickLeft2, installed);
  const editor = new Token(ap)._onClickLeft2({});
  assert.ok(editor instanceof APEditor);
  assert.equal(editor.object, ap); assert.equal(editor.rendered, true); assert.equal(calls.length, 0);
  const normalToken = new Token(ordinary), event = {};
  assert.equal(normalToken._onClickLeft2(event, "extra"), "native");
  assert.equal(calls[0].token, normalToken); assert.deepEqual(calls[0].args, [event, "extra"]);
  game.user = game.users.get("player");
  assert.equal(new Token(ap)._onClickLeft2(event), "native");
  assert.equal(calls.length, 2);
});
test("reload installs AP double-click before the initial scene binds token callbacks", async () => {
  environment(); const scene = makeScene("initial-load");
  const ap = makeToken(scene, "ap");
  class Token {
    constructor(document) { this.document = document; this.doubleClick = this._onClickLeft2.bind(this); }
    _onClickLeft2() { return "native"; }
  }
  globalThis.CONFIG = { Token: { objectClass: Token } };
  registerUI();
  await Hooks.call("setup");
  await Hooks.call("canvasInit");
  const token = new Token(ap);
  await Hooks.call("ready");
  assert.ok(token.doubleClick() instanceof APEditor);
  const ordinary = makeToken(scene, "ordinary", { ap: false });
  assert.equal(new Token(ordinary).doubleClick(), "native");
});
test("emergency Hide All ignores selection and radius, resets all disclosures and pulses only on its scene", async () => {
  environment(); const scene = makeScene("emergency");
  const a = makeToken(scene, "near"), b = makeToken(scene, "far", { x: 10000 });
  const other = makeToken(makeScene("other-scene"), "other");
  for (const doc of [a,b,other]) {
    apData(doc).discovery = { revealed: true, public: true, users: ["player"], runners: ["runner"] };
    apData(doc).pulse = { loop: true };
    apData(doc).showName = true;
  }
  const panel = new ScannerPanel({ scene }); panel.radius = 1;
  await panel.handleAction("hide-all");
  for (const doc of [a,b]) {
    assert.equal(apData(doc).discovery.revealed, false);
    assert.deepEqual(apData(doc).discovery.users, []);
    assert.equal(apData(doc).pulse, null);
    assert.equal(apData(doc).showName, false);
  }
  assert.equal(apData(other).discovery.revealed, true);
  assert.equal(apData(other).pulse.loop, true);
});

test("libWrapper cooperates with another conditional token handler in either registration order", () => {
  for (const scannerFirst of [true, false]) {
    environment(); const scene = makeScene("chain");
    const ap = makeToken(scene, "ap");
    const ordinary = makeToken(scene, "ordinary", { ap: false });
    class Token {
      constructor(document, pile = false) { this.document = document; this.pile = pile; }
      _onClickLeft2(value) { return `native:${value}`; }
    }
    globalThis.CONFIG = { Token: { objectClass: Token } };
    const installOther = () => libWrapper.register("test-other", "CONFIG.Token.objectClass.prototype._onClickLeft2", function(wrapped, value) {
      return this.pile ? `pile:${value}` : wrapped(value);
    }, "MIXED");
    if (scannerFirst) { installAPDoubleClick(); installOther(); }
    else { installOther(); installAPDoubleClick(); }
    assert.ok(new Token(ap)._onClickLeft2("event") instanceof APEditor);
    assert.equal(new Token(ordinary, true)._onClickLeft2("event"), "pile:event");
    assert.equal(new Token(ordinary)._onClickLeft2("event"), "native:event");
    assert.equal(libWrapper.registrations.find(entry => entry.module === "cpr-netrunning").type, "MIXED");
    assert.equal(libWrapper.registrations.length, 2);
  }
});

test("missing libWrapper never installs a direct token override", () => {
  environment(); class Token { _onClickLeft2() { return "native"; } }
  globalThis.CONFIG = { Token: { objectClass: Token } };
  const original = Token.prototype._onClickLeft2;
  delete globalThis.libWrapper;
  assert.throws(() => installAPDoubleClick(), /Включите libWrapper/);
  assert.equal(Token.prototype._onClickLeft2, original);
});
