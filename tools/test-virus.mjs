/* Planting a virus, end to end.
 *
 *   node tools/test-virus.mjs
 *
 * Three things about this path were wrong at once, and none of them could be
 * seen by reading it.
 *
 * The runner never declared anything. The editor has a "what the virus changes"
 * field, the GM fills it in, and that was the only text in the whole feature —
 * the player, whose virus it is, had nowhere to say what he was trying to do.
 *
 * Nothing was ever displayed. The GM's text, the roll and the DV were all
 * written into the world and then read by nobody: the marker on the map is
 * captioned with the bare word "Virus", and the chat card said only that the
 * virus went in or did not. A player could not see 15 against 12, so a failure
 * was indistinguishable from a bug.
 *
 * And every refusal wore the same face. Standing on a floor that is not the
 * bottom of a branch answered "no virus plan" — with the plan visibly filled in
 * — and then reported the roll as failed, though no roll had been attempted.
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

function prepareScripts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crns-virus-"));
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) { copyDir(src, dst); continue; }
      if (!entry.name.endsWith(".js")) continue;
      let stub = path.relative(path.dirname(dst), path.join(tmp, "system-stub.js")).split(path.sep).join("/");
      if (!stub.startsWith(".")) stub = `./${stub}`;
      fs.writeFileSync(dst, fs.readFileSync(src, "utf-8")
        .replace(/from\s+"\/systems\/[^"]+"/g, `from "${stub}"`), "utf-8");
    }
  };
  copyDir(path.join(ROOT, "scripts"), tmp);
  fs.writeFileSync(path.join(tmp, "system-stub.js"),
    "export default {}; export const CPRRolls={}; export class CPRChat{}", "utf-8");
  return tmp;
}

const settings = new Map();
const chat = [];
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function installStubs() {
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "0"),
      debounce: (fn) => fn,
      mergeObject: (a, b) => ({ ...a, ...b }),
      getProperty: (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj),
      duplicate: clone,
    },
  };
  globalThis.Hooks = { on: () => 0, once: () => 0, off() {}, callAll() {} };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.ChatMessage = {
    create: async (d) => {
      chat.push(String(d.content).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      return d;
    },
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
    socket: { emit() {}, on() {} },
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

console.log("Planting a virus\n");

installStubs();
const scripts = prepareScripts();
const D = await import(pathToFileURL(path.join(scripts, "data.js")).href);

const RUNNER = { id: "act1", uuid: "Actor.act1", name: "Runner", img: "", isOwner: true };
const PID = "actor:Actor_act1";
const PLAN = { dv: 12, actions: 3, effect: "the door logic" };
const INTENT = "open every door on this floor and hold them open";

/** A world with the runner standing on the bottom floor, which carries `plan`. */
async function world({ leaf = true, plan = PLAN, actions = 9 } = {}) {
  settings.clear();
  for (const [k, v] of Object.entries(D.WORLD_OBJECTS)) settings.set(k, clone(v));
  const floors = [
    { id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "f2", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null, virusPlan: plan },
  ];
  if (!leaf) floors.push({ id: "f3", parent: "f2", kind: "custom", dv: 0, ice: [], demon: null });
  settings.set("netArchs", { a1: { id: "a1", name: "Net", floors } });
  game.actors.length = 0;
  game.actors.push(RUNNER);
  await D.applyOp("session.connect", { pid: PID, actorUuid: RUNNER.uuid, userId: "", archId: "a1" }, "gm");
  const s = settings.get("session");
  s.participants[PID].floorIndex = 1;
  s.participants[PID].actions = { value: actions, max: actions };
  settings.set("session", s);
  chat.length = 0;
}

const fxNow = () => settings.get("session").floorState["a1:f2"] || {};
const actionsLeft = () => settings.get("session").participants[PID].actions.value;

/* ------------------------------------------------------------------ */

console.log("Nothing is spent until the runner says what the virus is for");
{
  await world();
  const first = await D.applyOp("run.virusWork", { pid: PID }, "gm");
  eq(first?.error, "CRNS.Errors.VirusIntent", "work started with no declaration");
  eq(actionsLeft(), 9, "a refused action was still charged");
  eq(chat.length, 0, "a refusal reached the chat");

  const said = await D.applyOp("run.virusWork", { pid: PID, intent: INTENT }, "gm");
  eq(said?.progress, 1, "the declared attempt did not start");
  eq(said?.intent, INTENT, "the declaration was not echoed back");
  eq(fxNow().virusIntent[PID], INTENT, "the declaration did not reach the world");
  eq(actionsLeft(), 8, "the first action was not charged");
  // The table hears what he is attempting, once, when he starts.
  expect(chat.some((c) => c.includes("VirusDeclared") && c.includes(INTENT)),
    "the declaration was never announced");

  // Later actions carry no text and must not need one.
  chat.length = 0;
  const second = await D.applyOp("run.virusWork", { pid: PID }, "gm");
  eq(second?.progress, 2, "the second action was refused");
  eq(second?.intent, INTENT, "the declaration was lost between actions");
  eq(chat.length, 0, "the declaration was announced twice");
}

console.log("A refusal says which refusal it is");
{
  // Not the bottom of a branch. This used to answer "no virus plan" — with the
  // plan filled in — and then report a failed roll that never happened.
  await world({ leaf: false });
  eq((await D.applyOp("run.virusWork", { pid: PID, intent: INTENT }, "gm"))?.error,
    "CRNS.Errors.VirusFloor", "a middle floor blamed the plan");
  eq((await D.applyOp("run.abilityResult", { pid: PID, ability: "virus", total: 15 }, "gm"))?.error,
    "CRNS.Errors.VirusFloor", "a middle floor reported a lost roll");
  eq(chat.length, 0, "a floor that cannot hold a virus still posted a verdict");

  // No plan at all is a different problem, and keeps its own message.
  await world({ plan: null });
  eq((await D.applyOp("run.virusWork", { pid: PID, intent: INTENT }, "gm"))?.error,
    "CRNS.Errors.VirusPlan", "a missing plan reported something else");

  // Rolling before the work is done is a third.
  await world();
  await D.applyOp("run.virusWork", { pid: PID, intent: INTENT }, "gm");
  chat.length = 0;
  eq((await D.applyOp("run.abilityResult", { pid: PID, ability: "virus", total: 15 }, "gm"))?.error,
    "CRNS.Errors.VirusWork", "an unfinished virus reported a lost roll");
  eq(fxNow().viruses, [], "an unfinished virus was planted anyway");
  eq(chat.length, 0, "an unfinished virus posted a verdict");
}

console.log("The roll, the DV and the declaration all reach the table");
{
  await world();
  for (let i = 0; i < 3; i += 1) {
    await D.applyOp("run.virusWork", { pid: PID, intent: i ? "" : INTENT }, "gm");
  }
  eq(actionsLeft(), 6, "the work did not cost three actions");
  chat.length = 0;

  const res = await D.applyOp("run.abilityResult", { pid: PID, ability: "virus", total: 15 }, "gm");
  eq(res?.applied, true, "a beaten DV did not plant the virus");

  const card = chat.join(" | ");
  expect(card.includes("VirusPlanted"), "no verdict was posted");
  // The two numbers are the whole point: without them a failure looks like a bug.
  expect(card.includes("VirusRoll") && card.includes("15") && card.includes("12"),
    "the card named neither the roll nor the DV");
  expect(card.includes(INTENT), "the card did not say what the virus was for");

  const planted = fxNow().viruses;
  eq(planted.length, 1, "the virus was not recorded");
  eq(planted[0].intent, INTENT, "the runner's declaration is not on the record");
  eq(planted[0].effect, PLAN.effect, "the GM's note is not on the record");
  eq(planted[0].dv, 15, "the roll is not on the record");
  eq(planted[0].target, 12, "the DV it had to beat is not on the record");
  // The marker on the map is the only place anyone can look afterwards.
  eq(fxNow().virusWork, {}, "finished work was not cleared");
  eq(fxNow().virusIntent, {}, "a spent declaration was left behind");
}

console.log("A lost roll is reported as a lost roll, with the numbers");
{
  await world();
  for (let i = 0; i < 3; i += 1) {
    await D.applyOp("run.virusWork", { pid: PID, intent: i ? "" : INTENT }, "gm");
  }
  chat.length = 0;
  const res = await D.applyOp("run.abilityResult", { pid: PID, ability: "virus", total: 8 }, "gm");
  eq(res?.applied, false, "a lost roll planted the virus");
  eq(fxNow().viruses, [], "a lost roll left a virus behind");

  const card = chat.join(" | ");
  expect(card.includes("VirusFailed"), "no verdict was posted");
  expect(card.includes("8") && card.includes("12"), "the loss did not name the numbers");

  // Current rule: a lost roll consumes the work as well as the actions. Pinned
  // here so it cannot drift silently — it is a balance decision, not an accident.
  eq(fxNow().virusWork, {}, "a lost roll left the accumulated work in place");
}

console.log("Jacking out takes the unfinished declaration with it");
{
  await world();
  await D.applyOp("run.virusWork", { pid: PID, intent: INTENT }, "gm");
  eq(fxNow().virusIntent[PID], INTENT, "the declaration was never stored");
  await D.applyOp("run.jack", { pid: PID, in: false }, "gm");
  expect(!fxNow().virusIntent?.[PID], "a stale declaration survived the disconnect");
  expect(!fxNow().virusWork?.[PID], "stale work survived the disconnect");
}

console.log("The map marker is built from what was recorded, not from a constant");
{
  const canvas = fs.readFileSync(path.join(ROOT, "scripts/apps/arch-canvas.js"), "utf-8");
  // It used to read `title: loc("CRNS.Canvas.Virus")` and nothing else, so every
  // marker on every floor said the same word.
  expect(/v\.intent/.test(canvas), "the marker ignores the runner's declaration");
  expect(/v\.effect/.test(canvas), "the marker ignores the GM's note");
  expect(/CRNS\.Canvas\.VirusRolled/.test(canvas), "the marker never shows the roll it was planted on");
}

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
