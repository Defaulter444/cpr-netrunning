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
const ROOT = path.resolve(HERE, "..");

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
    i18n: { localize: (k) => k, format: (k) => k },
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

console.log("A runner can be connected, moved, disconnected and connected again");
{
  freshWorld();
  seedArch([
    { id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "f2", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "f3", parent: "f2", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.push(RUNNER);

  const pid = "actor:Actor_act1";
  const connected = await D.applyOp("session.connect",
    { pid, actorUuid: RUNNER.uuid, userId: "", archId: "a1" }, "gm");
  // The bug this scenario exists for: connect threw on an undeclared `archs`
  // and returned nothing, so no runner could ever be placed.
  expect(connected === true, `connect returned ${JSON.stringify(connected)}`);

  let session = settings.get("session");
  expect(!!session.participants[pid], "connect left no participant");
  eq(session.participants[pid].archId, "a1", "participant is not on the architecture");
  eq(session.participants[pid].visited, ["f1"], "the entry floor was not recorded as visited");

  // Step down, then check the path is remembered — the floor walked away from
  // must not vanish from the runner's map.
  await D.applyOp("session.move", { pid, floorIndex: 1 }, "gm");
  session = settings.get("session");
  eq(session.participants[pid].floorIndex, 1, "the runner did not move");
  eq(session.participants[pid].visited.sort(), ["f1", "f2"], "the path walked was forgotten");

  await D.applyOp("session.move", { pid, floorIndex: 2 }, "gm");
  session = settings.get("session");
  eq(session.participants[pid].visited.sort(), ["f1", "f2", "f3"], "the path walked was forgotten");

  // Disconnect, then connect again — the second connect used to be impossible.
  await D.applyOp("session.disconnect", { pid }, "gm");
  session = settings.get("session");
  eq(session.participants[pid].archId, "", "disconnect did not detach the runner");

  const again = await D.applyOp("session.connect",
    { pid, actorUuid: RUNNER.uuid, userId: "", archId: "a1" }, "gm");
  expect(again === true, `reconnect returned ${JSON.stringify(again)}`);
  session = settings.get("session");
  eq(session.participants[pid].archId, "a1", "reconnect did not attach the runner");
  eq(session.participants[pid].floorIndex, 0, "reconnect did not return to the entry");
  eq(session.participants[pid].visited, ["f1"], "reconnect did not reset the map");
}

console.log("Removing a runner keeps it removed");
{
  freshWorld();
  seedArch([{ id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null }]);
  game.actors.length = 0;
  game.actors.push(RUNNER);

  const pid = "actor:Actor_act1";
  await D.applyOp("session.connect", { pid, actorUuid: RUNNER.uuid, userId: "", archId: "a1" }, "gm");

  const removed = await D.applyOp("runner.remove", { pid }, "gm");
  expect(removed === true, `remove returned ${JSON.stringify(removed)}`);

  let session = settings.get("session");
  expect(!session.participants[pid], "the participant survived removal");
  // The roster auto-lists every eligible actor, so the removal only sticks if
  // it is remembered. Without this the same row came straight back and the
  // button looked dead.
  expect((session.dismissed || []).includes(pid), "the removal was not remembered");

  // Restoring brings it back into the roster.
  await D.applyOp("runner.restore", {}, "gm");
  session = settings.get("session");
  eq(session.dismissed, [], "restore did not clear the dismissed list");

  // Connecting a dismissed runner un-dismisses it: the GM is asking for it back.
  await D.applyOp("runner.remove", { pid }, "gm");
  await D.applyOp("session.connect", { pid, actorUuid: RUNNER.uuid, userId: "", archId: "a1" }, "gm");
  session = settings.get("session");
  expect(!(session.dismissed || []).includes(pid), "connecting did not un-dismiss the runner");
}

console.log("Movement obeys the tree, not the array");
{
  freshWorld();
  //      f1
  //     /  \
  //   f2    f3
  seedArch([
    { id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "f2", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "f3", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.length = 0;
  game.actors.push({ ...RUNNER, id: "act2", uuid: "Actor.act2" });

  const pid = "actor:Actor_act2";
  await D.applyOp("session.connect", { pid, actorUuid: "Actor.act2", userId: "player", archId: "a1" }, "gm");

  // A player may step to a child.
  const down = await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  expect(down === true, `step to a child returned ${JSON.stringify(down)}`);

  // But not sideways to its sibling: they are not adjacent, whatever their
  // array indices say. Upstream compared indices and would have allowed it.
  const sideways = await D.applyOp("session.move", { pid, floorIndex: 2 }, "player");
  expect(sideways && sideways.error === "CRNS.Errors.MoveStep",
    `a sideways step returned ${JSON.stringify(sideways)}`);
}

console.log("An un-breached password blocks the way down");
{
  freshWorld();
  seedArch([
    { id: "f1", parent: "", kind: "password", dv: 10, ice: [], demon: null },
    { id: "f2", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.length = 0;
  game.actors.push({ ...RUNNER, id: "act3", uuid: "Actor.act3" });

  const pid = "actor:Actor_act3";
  await D.applyOp("session.connect", { pid, actorUuid: "Actor.act3", userId: "player", archId: "a1" }, "gm");

  const blocked = await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  expect(blocked && blocked.error === "CRNS.Errors.PasswordBlocked",
    `a locked password returned ${JSON.stringify(blocked)}`);

  // The GM is not bound by it.
  const gmMove = await D.applyOp("session.move", { pid, floorIndex: 1 }, "gm");
  expect(gmMove === true, `the GM was blocked by a password: ${JSON.stringify(gmMove)}`);
}

fs.rmSync(scripts, { recursive: true, force: true });

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
