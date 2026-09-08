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

console.log("Beating a floor's check opens it");
{
  freshWorld();
  seedArch([
    { id: "f1", parent: "", kind: "password", dv: 6, ice: [], demon: null },
    { id: "f2", parent: "f1", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.length = 0;
  game.actors.push({ ...RUNNER, id: "p1", uuid: "Actor.p1" });

  const pid = "actor:Actor_p1";
  await D.applyOp("session.connect",
    { pid, actorUuid: "Actor.p1", userId: "player", archId: "a1" }, "gm");

  // The player rolls Backdoor on the password floor and beats DV 6.
  const res = await D.applyOp("run.abilityResult",
    { pid, ability: "backdoor", total: 12 }, "player");
  expect(res && res.ok, `abilityResult returned ${JSON.stringify(res)}`);
  expect(res && res.applied, "a beaten password was not marked as breached");

  let session = settings.get("session");
  const fx = (session.floorState || {})["a1:f1"];
  expect(fx && fx.breached === true, `floor state after the roll: ${JSON.stringify(fx)}`);

  // And now the way down is open.
  const moved = await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  expect(moved === true, `moving past a breached password returned ${JSON.stringify(moved)}`);
}

console.log("A GM-named check opens a gated floor of any kind");
{
  freshWorld();
  // Not a password: an ordinary floor the GM decided nobody walks past until
  // they have talked their way through it.
  seedArch([
    { id: "g1", parent: "", kind: "custom", label: "Шлюз", dv: 8,
      check: "control", gate: true, ice: [], demon: null },
    { id: "g2", parent: "g1", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.length = 0;
  game.actors.push({ ...RUNNER, id: "p2", uuid: "Actor.p2" });

  const pid = "actor:Actor_p2";
  await D.applyOp("session.connect",
    { pid, actorUuid: "Actor.p2", userId: "player", archId: "a1" }, "gm");

  // The gate holds before the check is beaten.
  const held = await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  expect(held && held.error === "CRNS.Errors.PasswordBlocked",
    `a gated floor let the runner through: ${JSON.stringify(held)}`);

  // The WRONG ability does not open it, however well it rolls.
  await D.applyOp("run.abilityResult", { pid, ability: "backdoor", total: 20 }, "player");
  let session = settings.get("session");
  expect(!((session.floorState || {})["a1:g1"] || {}).breached,
    "the wrong ability opened the floor");

  // The named one does.
  const res = await D.applyOp("run.abilityResult", { pid, ability: "control", total: 9 }, "player");
  expect(res && res.applied, `the named check did not open the floor: ${JSON.stringify(res)}`);
  session = settings.get("session");
  expect(((session.floorState || {})["a1:g1"] || {}).breached === true, "the gate stayed shut");

  const moved = await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  expect(moved === true, `the opened gate still blocked: ${JSON.stringify(moved)}`);
}

console.log("A floor the GM opened can be shut again");
{
  freshWorld();
  // Not a password — an ordinary floor the GM decided to gate. Since the lock
  // appears on any gated floor, it has to be closable on any gated floor too.
  seedArch([
    { id: "d1", parent: "", kind: "custom", label: "Дно", dv: 6,
      check: "backdoor", gate: true, ice: [], demon: null },
    { id: "d2", parent: "d1", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.length = 0;
  game.actors.push({ ...RUNNER, id: "p3", uuid: "Actor.p3" });

  const pid = "actor:Actor_p3";
  await D.applyOp("session.connect",
    { pid, actorUuid: "Actor.p3", userId: "player", archId: "a1" }, "gm");

  // Opened by beating the check.
  await D.applyOp("run.abilityResult", { pid, ability: "backdoor", total: 12 }, "player");
  let session = settings.get("session");
  expect((session.floorState["a1:d1"] || {}).breached === true, "the floor did not open");
  expect(await D.applyOp("session.move", { pid, floorIndex: 1 }, "player") === true,
    "an opened floor still blocked");

  // And shut again by the GM. This is what was impossible: the padlock showed
  // on a gated custom floor but the gear that carries the toggle did not, so
  // the GM could open a floor and never close it.
  await D.applyOp("session.move", { pid, floorIndex: 0 }, "player");
  const shut = await D.applyOp("fx.clear",
    { archId: "a1", floorId: "d1", kind: "breach", value: false }, "gm");
  expect(shut !== false, `re-locking returned ${JSON.stringify(shut)}`);

  session = settings.get("session");
  expect(!(session.floorState["a1:d1"] || {}).breached, "the floor stayed open");

  const blocked = await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  expect(blocked && blocked.error === "CRNS.Errors.PasswordBlocked",
    `a re-locked floor let the runner through: ${JSON.stringify(blocked)}`);

  // A player cannot re-lock anything.
  const denied = await D.applyOp("fx.clear",
    { archId: "a1", floorId: "d1", kind: "breach", value: true }, "player");
  expect(denied === false, `a player toggled a lock: ${JSON.stringify(denied)}`);
}

console.log("The GM can make a runner forget the map");
{
  freshWorld();
  seedArch([
    { id: "m1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "m2", parent: "m1", kind: "custom", dv: 0, ice: [], demon: null },
    { id: "m3", parent: "m2", kind: "custom", dv: 0, ice: [], demon: null },
  ]);
  game.actors.length = 0;
  game.actors.push({ ...RUNNER, id: "p4", uuid: "Actor.p4" });

  const pid = "actor:Actor_p4";
  await D.applyOp("session.connect",
    { pid, actorUuid: "Actor.p4", userId: "player", archId: "a1" }, "gm");
  await D.applyOp("session.move", { pid, floorIndex: 1 }, "player");
  await D.applyOp("run.abilityResult", { pid, ability: "pathfinder", total: 9 }, "player");

  let session = settings.get("session");
  expect(session.participants[pid].visited.length >= 2, "the runner remembers nothing to forget");
  expect((session.reveal[pid] || {}).a1?.length > 0, "pathfinder revealed nothing to forget");

  const cleared = await D.applyOp("run.clearReveal", { pid }, "gm");
  expect(cleared === true, `clearing returned ${JSON.stringify(cleared)}`);

  session = settings.get("session");
  // Both halves go. Clearing only the scouted floors left the walked ones on
  // screen, which is why the button looked like it did nothing.
  expect(!session.reveal[pid], "the scouted floors survived");
  eq(session.participants[pid].visited, ["m2"],
     "the walked floors survived, or the current floor was forgotten too");

  // A player cannot wipe their own map, nor anyone else's.
  const denied = await D.applyOp("run.clearReveal", { pid }, "player");
  expect(denied === false, `a player cleared the map: ${JSON.stringify(denied)}`);
}

console.log("An architecture can be shaped from the map");
{
  freshWorld();
  const arch = { id: "a1", name: "Shape", floors: [
    { id: "f1", parent: "", alsoFrom: [], kind: "custom", dv: 0, ice: [], demon: null },
  ] };
  settings.set("netArchs", { a1: arch });
  // arch.update rejects an architecture that is not tab-open in some paths and
  // renames actor folders; the stub has neither, so it just has to not throw.
  settings.set("session", { ...settings.get("session"), tabs: ["a1"], activeTab: "a1" });

  // Two floors under the entry — a fork.
  const left = await D.applyOp("arch.addFloor", { archId: "a1", parentId: "f1" }, "gm");
  const right = await D.applyOp("arch.addFloor", { archId: "a1", parentId: "f1" }, "gm");
  expect(left && left.floorId, `adding a floor returned ${JSON.stringify(left)}`);
  expect(right && right.floorId, `adding a second floor returned ${JSON.stringify(right)}`);

  let floors = settings.get("netArchs").a1.floors;
  eq(floors.length, 3, "wrong number of floors after two additions");
  eq(floors.filter((f) => f.parent === "f1").length, 2, "the fork did not appear");

  // One floor below the left branch, then linked from the right one too: the
  // diamond the strict tree could not express.
  const bottom = await D.applyOp("arch.addFloor", { archId: "a1", parentId: left.floorId }, "gm");
  const linked = await D.applyOp("arch.linkFloor",
    { archId: "a1", floorId: bottom.floorId, fromId: right.floorId }, "gm");
  expect(!linked?.error, `linking returned ${JSON.stringify(linked)}`);

  floors = settings.get("netArchs").a1.floors;
  const merge = floors.find((f) => f.id === bottom.floorId);
  eq(merge.parent, left.floorId, "the primary way in changed");
  eq(merge.alsoFrom, [right.floorId], "the second way in was not recorded");

  // A link from below would close a loop.
  const loop = await D.applyOp("arch.linkFloor",
    { archId: "a1", floorId: "f1", fromId: bottom.floorId }, "gm");
  expect(loop && loop.error === "CRNS.Errors.Cycle", `a loop returned ${JSON.stringify(loop)}`);

  // Unlinking the extra route leaves the primary alone.
  await D.applyOp("arch.unlinkFloor",
    { archId: "a1", floorId: bottom.floorId, fromId: right.floorId }, "gm");
  floors = settings.get("netArchs").a1.floors;
  eq(floors.find((f) => f.id === bottom.floorId).alsoFrom, [], "the extra route survived");
  eq(floors.find((f) => f.id === bottom.floorId).parent, left.floorId, "the primary route was lost");

  // Unlinking the PRIMARY promotes an extra rather than orphaning the floor.
  await D.applyOp("arch.linkFloor",
    { archId: "a1", floorId: bottom.floorId, fromId: right.floorId }, "gm");
  await D.applyOp("arch.unlinkFloor",
    { archId: "a1", floorId: bottom.floorId, fromId: left.floorId }, "gm");
  floors = settings.get("netArchs").a1.floors;
  eq(floors.find((f) => f.id === bottom.floorId).parent, right.floorId,
     "removing the primary way in did not promote the other one");

  // Deleting a middle floor lifts what hung under it.
  const before = settings.get("netArchs").a1.floors.length;
  await D.applyOp("arch.removeFloor", { archId: "a1", floorId: right.floorId }, "gm");
  floors = settings.get("netArchs").a1.floors;
  eq(floors.length, before - 1, "the floor was not deleted");
  expect(!floors.some((f) => f.id === right.floorId), "the deleted floor is still there");
  eq(floors.find((f) => f.id === bottom.floorId).parent, "f1",
     "the orphaned floor did not move up to the grandparent");

  // The last floor cannot be deleted: an architecture with no floors has no
  // entry to jack into.
  const only = { id: "a2", name: "Lone", floors: [
    { id: "g1", parent: "", alsoFrom: [], kind: "custom", dv: 0, ice: [], demon: null },
  ] };
  settings.set("netArchs", { ...settings.get("netArchs"), a2: only });
  const last = await D.applyOp("arch.removeFloor", { archId: "a2", floorId: "g1" }, "gm");
  expect(last && last.error === "CRNS.Errors.MinFloor", `deleting the last floor returned ${JSON.stringify(last)}`);

  // Players cannot reshape anything.
  const denied = await D.applyOp("arch.addFloor", { archId: "a1", parentId: "f1" }, "player");
  expect(denied === false, `a player was allowed to add a floor: ${JSON.stringify(denied)}`);
}

fs.rmSync(scripts, { recursive: true, force: true });

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
