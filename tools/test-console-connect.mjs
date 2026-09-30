/* Console direct-connection panel — real ops, real template.
 *
 *   node tools/test-console-connect.mjs
 *
 * The scripts are copied with the CPR system imports stubbed (as test-ops.mjs
 * does), so session.connect, tabs.open and runner.request run for real and are
 * judged by the world they leave. The template is rendered by a small
 * Handlebars subset and the fake DOM is built from that HTML, so the listeners
 * bind to the hooks the template actually emits. Players' mutations go through
 * the real socket relay path into the GM-side ops with the player as caller. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "templates", "console-connect.hbs"), "utf8");

/* ---- loadable copy of scripts (system imports → stub) ---- */
function prepareScripts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crns-connect-"));
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name), dst = path.join(to, entry.name);
      if (entry.isDirectory()) { copyDir(src, dst); continue; }
      if (!/\.m?js$/.test(entry.name)) continue;
      let stub = path.relative(path.dirname(dst), path.join(tmp, "system-stub.js")).replace(/\\/g, "/");
      if (!stub.startsWith(".")) stub = `./${stub}`;
      fs.writeFileSync(dst, fs.readFileSync(src, "utf8").replace(/from\s+["']\/systems\/[^"']+["']/g, `from "${stub}"`));
    }
  };
  copyDir(path.join(ROOT, "scripts"), tmp);
  fs.writeFileSync(path.join(tmp, "system-stub.js"), "export default {};\nexport const CPRRolls = {};\nexport class CPRChat {}\n");
  return tmp;
}

/* ---- Foundry stub ---- */
const settings = new Map();
const notes = [];
let sessionWrites = 0;
let failNextSessionWrite = false;
let confirmAnswer = false;
const confirms = [];
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const users = Object.assign([
  { id: "gm", isGM: true, active: true, name: "GM", color: "#fff", character: null },
  { id: "p1", isGM: false, active: true, name: "Игрок", color: "#0f0", character: null },
  { id: "p2", isGM: false, active: true, name: "Второй", color: "#00f", character: null },
], { get(id) { return this.find((u) => u.id === id); } });

function makeActor({ id, name, type = "character", deck = true, rank = 0, owners = [] }) {
  return {
    id, uuid: `Actor.${id}`, name, img: "", type,
    hasPlayerOwner: owners.length > 0,
    testUserPermission(user) { return !!user?.isGM || owners.includes(user?.id); },
    getEquippedCyberdeck() { return deck ? { system: { installedPrograms: [] } } : null; },
    itemTypes: { role: [{ id: "net", system: { rank } }] },
    system: { roleInfo: { activeNetRole: "net" }, stats: { ref: { value: 5 } } },
  };
}
const actors = Object.assign([
  makeActor({ id: "vee", name: "Ви", rank: 4, owners: ["p1"] }),
  makeActor({ id: "npc", name: "Наёмный раннер", type: "mook", rank: 2 }),
  makeActor({ id: "nodeck", name: "Без деки", owners: ["p2"], deck: false }),
  makeActor({ id: "ice", name: "Лёд", type: "blackIce" }),
  makeActor({ id: "xss", name: '<img src=x onerror="alert(1)">', rank: 1 }),
], { get(id) { return this.find((a) => a.id === id); } });

globalThis.foundry = { utils: {
  deepClone: clone, debounce: (fn) => fn, mergeObject: (a, b) => ({ ...a, ...b }),
  randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "0"),
} };
globalThis.Hooks = { on: () => 0, once: () => 0, off() {}, callAll() {} };
globalThis.ui = { notifications: {
  warn: (m) => notes.push(["warn", m]), info: (m) => notes.push(["info", m]), error: (m) => notes.push(["error", m]),
} };
globalThis.ChatMessage = { create: async (d) => d, getSpeaker: () => ({}) };
globalThis.Dialog = class { static async confirm(opts) { confirms.push(opts); return confirmAnswer; } };
globalThis.Actor = { create: async () => null, deleteDocuments: async () => [] };
globalThis.Folder = { create: async () => null };
globalThis.fromUuidSync = (uuid) => actors.find((a) => a.uuid === uuid) ?? null;
let D; // data.js, bound below; the socket relay needs it.
globalThis.game = {
  user: users.get("gm"), users, actors, combat: null, modules: new Map(),
  i18n: { lang: "ru", localize: (k) => k, format: (k, d = {}) => [k, ...Object.values(d)].join(" ") },
  settings: {
    get: (_s, key) => clone(settings.get(key)),
    set: async (_s, key, value) => {
      if (key === "session") {
        if (failNextSessionWrite) { failNextSessionWrite = false; throw new Error("write refused"); }
        sessionWrites += 1;
      }
      settings.set(key, clone(value));
      return value;
    },
    register() {},
  },
  // The player → primary-GM relay: the op runs GM-side with the caller's id.
  socket: {
    on() {},
    emit(_name, msg) {
      if (msg?.action !== "mutate") return;
      setTimeout(async () => D.resolveMutation(msg.requestId, await D.applyOp(msg.op, msg.payload, msg.userId)), 0);
    },
  },
};

const scripts = prepareScripts();
D = await import(pathToFileURL(path.join(scripts, "data.js")).href);
const C = await import(pathToFileURL(path.join(scripts, "apps", "console-connect.js")).href);
// The shell's real myParticipant(), lifted from its source: importing
// suite-app.js would pull in the whole console, which is edited independently.
const suiteSource = fs.readFileSync(path.join(ROOT, "scripts", "apps", "suite-app.js"), "utf8");
const myParticipantSource = suiteSource.match(/\n {2}myParticipant\(\) \{[\s\S]*?\n {2}\}\r?\n/)?.[0];
assert.ok(myParticipantSource, "suite-app.js myParticipant found");
const myParticipant = new Function("getWorld", `return function ${myParticipantSource.trim()};`)(D.getWorld);

/* ---- Handlebars subset: {{x.y}} (escaped), #if/#unless/#each with else, comments ---- */
const escHbs = (s) => String(s ?? "").replace(/[&<>"'`=]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "`": "&#x60;", "=": "&#x3D;" }[c]));
function renderHbs(src, root) {
  const tokens = src.replace(/{{!--[\s\S]*?--}}/g, "").split(/({{[^}]+}})/);
  let i = 0;
  const parse = () => {
    const nodes = [];
    while (i < tokens.length) {
      const t = tokens[i++];
      const m = t.match(/^{{\s*([#/]?)([\w.]+)\s*([\w.]*)\s*}}$/);
      if (!m) { nodes.push({ text: t }); continue; }
      const [, sigil, name, arg] = m;
      if (sigil === "/") return { nodes, stop: `/${name}` };
      if (!sigil && name === "else") return { nodes, stop: "else" };
      if (sigil === "#") {
        const body = parse();
        const alt = body.stop === "else" ? parse() : { nodes: [] };
        nodes.push({ block: name, arg, body: body.nodes, alt: alt.nodes });
        continue;
      }
      nodes.push({ path: name });
    }
    return { nodes, stop: "" };
  };
  const get = (ctx, p) => p.split(".").reduce((o, k) => o?.[k], ctx);
  const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
  const run = (nodes, ctx) => nodes.map((n) => {
    if ("text" in n) return n.text;
    if (n.path) return escHbs(get(ctx, n.path));
    const v = get(ctx, n.arg);
    if (n.block === "if") return run(truthy(v) ? n.body : n.alt, ctx);
    if (n.block === "unless") return run(truthy(v) ? n.alt : n.body, ctx);
    if (n.block === "each") return truthy(v) ? v.map((item) => run(n.body, item)).join("") : run(n.alt, ctx);
    throw new Error(`unsupported block ${n.block}`);
  }).join("");
  return run(parse().nodes, root);
}

/* ---- fake DOM built from the rendered HTML ---- */
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#x27|#x60|#x3D);/g, (_m, e) =>
  ({ amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#x60": "`", "#x3D": "=" }[e]));
function element(dataset, props = {}) {
  return {
    dataset, disabled: false, value: "", listeners: {}, ...props,
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    fire(type) { return Promise.all((this.listeners[type] ?? []).map((fn) => fn({ type, preventDefault() {} }))); },
  };
}
function domFrom(html) {
  const children = [];
  for (const m of html.matchAll(/<select data-connect-select="(\w+)"([^>]*)>([\s\S]*?)<\/select>/g)) {
    const options = [...m[3].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)]
      .map((o) => ({ value: unesc(o[1]), selected: !!o[2], text: unesc(o[3]) }));
    const value = (options.find((o) => o.selected) ?? options[0])?.value ?? "";
    children.push(element({ connectSelect: m[1] }, { value, options, disabled: /\bdisabled\b/.test(m[2]) }));
  }
  for (const m of html.matchAll(/<button type="button" data-connect-action="(\w+)"( disabled)?>/g)) {
    children.push(element({ connectAction: m[1] }, { disabled: !!m[2] }));
  }
  const matches = (el, sel) => sel.split(",").map((s) => s.trim()).some((s) => {
    const key = s.match(/^\[data-([\w-]+)\]$/)?.[1].replace(/-(\w)/g, (_m, c) => c.toUpperCase());
    return !!key && key in el.dataset;
  });
  const box = element({}, {
    querySelectorAll: (sel) => children.filter((el) => matches(el, sel)),
    querySelector: (sel) => children.find((el) => matches(el, sel)) ?? null,
  });
  const root = { querySelector: (sel) => (sel === "[data-console-connect]" && html.includes("data-console-connect") ? box : null) };
  const select = (kind) => children.find((el) => el.dataset.connectSelect === kind);
  const button = (kind) => children.find((el) => el.dataset.connectAction === kind);
  return { root, box, select, button, children };
}

function makeApp() {
  const app = { state: { selection: "" }, renders: 0, render() { this.renders += 1; } };
  app.myParticipant = myParticipant.bind(app);
  return app;
}
function mount(app) {
  const vm = C.connectionData(app, {});
  const html = renderHbs(TEMPLATE, vm);
  const dom = domFrom(html);
  C.activateConnection(app, dom.root);
  return { vm, html, dom };
}
async function change(dom, kind, value) {
  const sel = dom.select(kind);
  assert.ok(sel, `select ${kind} rendered`);
  assert.ok(sel.options.some((o) => o.value === value), `option ${value} offered`);
  sel.value = value;
  await sel.fire("change");
}
const session = () => settings.get("session");
const part = (pid) => session().participants?.[pid];

function freshWorld() {
  settings.clear();
  for (const [k, v] of Object.entries(D.WORLD_OBJECTS)) settings.set(k, clone(v));
  settings.set("netArchs", {
    a1: { id: "a1", name: "Башня Арасаки", floors: [
      { id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
      { id: "f2", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null },
    ] },
    a2: { id: "a2", name: "Склад <b>", floors: [{ id: "g1", parent: "", kind: "custom", dv: 0, ice: [], demon: null }] },
  });
  notes.length = 0; confirms.length = 0; sessionWrites = 0; confirmAnswer = false;
  game.user = users.get("gm");
}

const PID = { vee: C.runnerPid("Actor.vee"), npc: C.runnerPid("Actor.npc"), xss: C.runnerPid("Actor.xss") };

/* ------------------------------------------------------------------ */

{ // Stable IDs: identical to the roster's runnerPid, colon-free.
  const src = fs.readFileSync(path.join(ROOT, "scripts", "apps", "runners.js"), "utf8");
  const fn = src.match(/function runnerPid\(actorUuid\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, "runners.js runnerPid found");
  const reference = new Function(`${fn}; return runnerPid;`)();
  for (const uuid of ["Actor.vee", "Scene.s1.Token.t1.Actor.a9", "Compendium.world.pack:x.Actor.y", "", undefined]) {
    assert.equal(C.runnerPid(uuid), reference(uuid), `pid parity for ${uuid}`);
    assert.ok(!C.runnerPid(uuid).includes(":"));
  }
  console.log("IDs: runner pid matches runners.js and never contains ':' passed");
}

{ // GM: the empty panel is actionable, NPCs included, ineligible actors out, names escaped.
  freshWorld();
  const app = makeApp();
  const { vm, html } = mount(app);
  assert.equal(vm.gm, true);
  assert.deepEqual(vm.runners.map((r) => r.pid).sort(), [PID.npc, PID.vee, PID.xss].sort(), "eligible player and NPC actors only");
  assert.ok(vm.runners.find((r) => r.pid === PID.npc).label.includes("НИП"), "NPC is marked");
  assert.deepEqual(vm.archs.map((a) => a.id).sort(), ["a1", "a2"]);
  assert.equal(vm.canConnect, true);
  assert.ok(html.includes("Подключить к СЕТИ"));
  assert.ok(!html.includes('<img src=x onerror="alert(1)">') && html.includes("&lt;img src&#x3D;x"), "actor name escaped");
  assert.ok(html.includes("Склад &lt;b&gt;") && !html.includes("Склад <b>"), "architecture name escaped");
  assert.ok(!html.includes("{{"), "every expression resolved");
  console.log("GM view: actionable empty panel, NPCs listed, ineligible excluded, escaping passed");
}

{ // GM connects an NPC runner once, even when the button is hit twice.
  freshWorld();
  const app = makeApp();
  let { dom } = mount(app);
  await change(dom, "runner", PID.npc);
  ({ dom } = mount(app));
  await change(dom, "arch", "a1");
  ({ dom } = mount(app));
  const staleDom = dom;
  const renders = app.renders;
  const pending = Promise.all([dom.button("connect").fire("click"), dom.button("connect").fire("click")]);
  assert.equal(app._consoleConnectBusy, true, "busy set synchronously");
  assert.ok(dom.button("connect").disabled, "controls disabled while awaiting");
  const busyView = mount(app);
  assert.ok(busyView.vm.busy && /data-connect-action="connect" disabled/.test(busyView.html), "a re-render mid-await stays disabled");
  await pending;
  assert.equal(app._consoleConnectBusy, false);
  assert.ok(app.renders > renders);
  const p = part(PID.npc);
  assert.equal(p.archId, "a1");
  assert.equal(p.jackedIn, true);
  assert.equal(p.userId, "", "NPC stays GM-controlled");
  assert.equal(p.actions.value, 1, "Jack In cost taken once (rank 2 → max 2)");
  assert.equal(session().activeTab, "a1", "network put on screen");
  assert.equal(sessionWrites, 2, "one session.connect + one tabs.open, no duplicate connect");
  assert.equal(app.state.selection, `runner:${PID.npc}`);
  assert.equal(users.get("gm").character, null, "user.character untouched");

  // Progress survives every way of re-selecting the runner.
  assert.equal(await D.applyOp("session.move", { pid: PID.npc, floorIndex: 1 }, "gm"), true);
  const before = clone(part(PID.npc));
  assert.equal(before.floorIndex, 1, "runner has progress to lose");
  app.state.selection = "";
  const again = mount(app);
  assert.equal(again.vm.canConnect, false);
  assert.equal(again.vm.canSwitch, true);
  assert.equal(again.vm.canReconnect, false);
  assert.ok(again.html.includes("Управлять этим нетраннером") && !again.html.includes("Подключить к СЕТИ"));
  const writes = sessionWrites;
  await again.dom.button("switch").fire("click");
  assert.equal(app.state.selection, `runner:${PID.npc}`);
  assert.deepEqual(part(PID.npc), before, "switch leaves floor, actions and map alone");
  // A stale render still showing «Подключить» must not re-run session.connect.
  await staleDom.button("connect").fire("click");
  assert.deepEqual(part(PID.npc), before, "stale connect on the same network does not reset");
  // Picking him in the list takes control at once, without a world write.
  app.state.selection = "";
  app.state.consoleConnectPick = PID.vee;
  ({ dom } = mount(app));
  await change(dom, "runner", PID.npc);
  assert.equal(app.state.selection, `runner:${PID.npc}`);
  assert.equal(sessionWrites, writes, "switching wrote nothing");
  console.log("GM connect: single connect under double click, busy guard, tab opened, switch/select keep progress passed");

  // Moving him to another network asks first; declining changes nothing.
  ({ dom } = mount(app));
  await change(dom, "arch", "a2");
  const moveView = mount(app);
  assert.equal(moveView.vm.canReconnect, true);
  confirmAnswer = false;
  await moveView.dom.button("connect").fire("click");
  assert.deepEqual(part(PID.npc), before, "declined reconnect left the run intact");
  assert.ok(confirms.at(-1).content.includes("Склад &lt;b&gt;"), "confirmation escapes names");
  confirmAnswer = true;
  await mount(app).dom.button("connect").fire("click");
  assert.equal(part(PID.npc).archId, "a2");
  assert.equal(session().activeTab, "a2");
  console.log("GM reconnect: confirmation required and escaped passed");
}

{ // What the GM saw is what gets used: a vanished architecture is refused, not substituted.
  freshWorld();
  const app = makeApp();
  let { dom } = mount(app);
  await change(dom, "runner", PID.vee);
  ({ dom } = mount(app));
  assert.equal(dom.select("arch").value, "a1");
  const archs = settings.get("netArchs"); delete archs.a1; settings.set("netArchs", archs);
  await dom.button("connect").fire("click");
  assert.equal(part(PID.vee), undefined, "no connect to a substitute architecture");
  assert.ok(notes.some(([k]) => k === "warn"));

  // A failed op is reported, leaves selection alone and re-enables the panel.
  ({ dom } = mount(app));
  failNextSessionWrite = true;
  notes.length = 0;
  const logError = console.error;
  console.error = () => {}; // executeOp logs the refused write; expected here.
  try { await dom.button("connect").fire("click"); } finally { console.error = logError; }
  assert.equal(part(PID.vee), undefined);
  assert.ok(notes.some(([k]) => k === "error"), "failure reported");
  assert.equal(app.state.selection, "");
  assert.equal(app._consoleConnectBusy, false);
  console.log("GM validation: stale architecture refused, failed op reported and recovered passed");
}

{ // A non-primary GM needs nothing extra: the relay carries his GM rights.
  freshWorld();
  users.push({ id: "zgm", isGM: true, active: true, name: "Помощник", character: null });
  game.user = users.get("zgm");
  const app = makeApp();
  await mount(app).dom.button("connect").fire("click");
  const connected = Object.values(session().participants).filter((p) => p.archId);
  assert.equal(connected.length, 1, "assistant GM connected via the relay");
  users.pop();
  console.log("GM relay: assistant GM connects without extra permissions passed");
}

{ // Players: own participant only, no architecture list, the existing request flow.
  freshWorld();
  await D.applyOp("session.connect", { pid: PID.vee, actorUuid: "Actor.vee", userId: "p1", archId: "" }, "gm");
  await D.applyOp("session.connect", { pid: PID.npc, actorUuid: "Actor.npc", userId: "", archId: "a2" }, "gm");
  game.user = users.get("p1");
  const app = makeApp();
  let view = mount(app);
  assert.equal(view.vm.player, true);
  assert.ok(!("runners" in view.vm) && !("archs" in view.vm), "no lists in a player VM");
  const json = JSON.stringify(view.vm);
  for (const secret of ["Башня", "Склад", "a1", "a2", "Наёмный", PID.npc]) assert.ok(!json.includes(secret), `player VM hides ${secret}`);
  assert.ok(!view.html.includes("<select"), "no selects for players");
  assert.equal(view.vm.me.name, "Ви");
  assert.equal(view.vm.canAsk, true);
  assert.ok(view.html.includes("Запросить подключение к СЕТИ"));

  await view.dom.button("ask").fire("click");
  assert.deepEqual(session().requests.map((r) => [r.pid, r.userId]), [[PID.vee, "p1"]], "request stored through the GM op");
  view = mount(app);
  assert.equal(view.vm.canAsk, false);
  assert.equal(view.vm.canCancel, true);
  assert.equal(view.vm.me.status, "Запрос отправлен ГМ");
  await view.dom.button("cancel").fire("click");
  assert.deepEqual(session().requests, [], "request withdrawn");

  // A crafted connect button does nothing for a player.
  const crafted = domFrom('<div data-console-connect><button type="button" data-connect-action="connect">');
  C.activateConnection(app, crafted.root);
  await crafted.button("connect").fire("click");
  assert.equal(part(PID.vee).archId, "", "players cannot connect themselves");

  // No GM online: the refusal is reported, nothing is stored.
  users.get("gm").active = false;
  notes.length = 0;
  await mount(app).dom.button("ask").fire("click");
  assert.ok(notes.some(([k]) => k === "error"));
  users.get("gm").active = true;

  // Connected: his own network's name, nobody else's.
  game.user = users.get("gm");
  await D.applyOp("session.connect", { pid: PID.vee, actorUuid: "Actor.vee", userId: "p1", archId: "a1" }, "gm");
  game.user = users.get("p1");
  view = mount(app);
  assert.equal(view.vm.me.status, "В СЕТИ · Башня Арасаки");
  assert.ok(!JSON.stringify(view.vm).includes("Склад"));
  assert.equal(view.vm.canAsk, false);

  // A player with no participant gets a hint and nothing to press.
  game.user = users.get("p2");
  view = mount(app);
  assert.equal(view.vm.me, null);
  assert.ok(view.vm.hint && !view.html.includes("data-connect-action"));
  assert.ok(users.every((u) => u.character === null), "user.character never assigned");
  game.user = users.get("gm");
  console.log("Players: own participant only, no architecture list, request/cancel via GM ops, no self-connect passed");
}

{ // Template contract.
  assert.ok(!TEMPLATE.includes("{{{"), "no unescaped output");
  for (const b of ["if", "each", "unless"]) {
    assert.equal((TEMPLATE.match(new RegExp(`{{#${b}\\b`, "g")) || []).length,
      (TEMPLATE.match(new RegExp(`{{/${b}}}`, "g")) || []).length, `${b} balanced`);
  }
  const src = fs.readFileSync(path.join(ROOT, "scripts", "apps", "console-connect.js"), "utf8");
  for (const [, a] of TEMPLATE.matchAll(/data-connect-action="(\w+)"/g)) assert.ok(new RegExp(`\\n  ${a}: `).test(src), `handler for ${a}`);
  console.log("Template: escaped output, balanced blocks, every action handled passed");
}
