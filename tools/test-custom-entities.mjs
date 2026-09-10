/* GM-authored Black ICE and demons, plus the two map controls that had no
 * caller.
 *
 *   node tools/test-custom-entities.mjs
 *
 * Four things are worth executing rather than reading.
 *
 * The merged tables are a Proxy over the core-book constants. Every call site in
 * the module reads `BLACK_ICE[type]` and `Object.keys(DEMONS)` directly, so the
 * Proxy has to behave like the plain object it replaced — including for `in`,
 * `Object.keys` and property descriptors — or something far from here breaks in
 * a way no syntax check would notice.
 *
 * Validation lives in the op, not the dialog. A malformed type reaches storage
 * once and then poisons every architecture that references it: arch validation
 * rejects an unknown ICE type, so the GM loses the ability to save the whole
 * architecture. The refusals are the feature.
 *
 * Deleting a type in use is the same failure from the other side.
 *
 * And `run.clearSlid` — the op existed from the start, correct and unreachable.
 * The test asserts the state change so it cannot quietly go dead again.
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
/* Loadable copy of the scripts (same approach as test-ops.mjs)        */
/* ------------------------------------------------------------------ */

function prepareScripts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crns-custom-"));
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) { copyDir(src, dst); continue; }
      if (!entry.name.endsWith(".js")) continue;
      let stub = path.relative(path.dirname(dst), path.join(tmp, "system-stub.js")).replace(/\\/g, "/");
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

const settings = new Map();

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
  globalThis.ChatMessage = { create: async (d) => d, getSpeaker: () => ({}) };
  globalThis.CONFIG = { Combat: { documentClass: class {} } };
  globalThis.fromUuidSync = () => null;
  globalThis.getDocumentClass = () => globalThis.Actor;
  globalThis.Actor = { create: async () => null };
  globalThis.Folder = { create: async () => null };

  globalThis.game = {
    system: { id: "cyberpunk-red-core" },
    user: { id: "gm", isGM: true },
    users: Object.assign(
      [{ id: "gm", isGM: true, active: true, color: "#fff", name: "GM" },
       { id: "pc", isGM: false, active: true, color: "#0f0", name: "Player" }],
      {
        get(id) { return this.find((u) => u.id === id); },
        filter(fn) { return Array.prototype.filter.call(this, fn); },
      }
    ),
    actors: Object.assign([], { get(id) { return this.find((a) => a.id === id); } }),
    combat: null,
    socket: { emit() {}, on() {} },
    i18n: { localize: (k) => k, format: (k, d = {}) => [k, ...Object.values(d)].join(" ") },
    settings: {
      get: (_scope, key) => settings.get(key),
      set: async (_scope, key, value) => { settings.set(key, value); return value; },
      register: () => {},
    },
  };
}

/* ------------------------------------------------------------------ */

console.log("Forged Black ICE and demons\n");

installStubs();
const scripts = prepareScripts();
const D = await import(pathToFileURL(path.join(scripts, "data.js")).href);
const K = await import(pathToFileURL(path.join(scripts, "constants.js")).href);

function freshWorld() {
  settings.clear();
  for (const [key, value] of Object.entries(D.WORLD_OBJECTS)) {
    settings.set(key, deepClone(value));
  }
}

const GOOD_ICE = {
  name: "Сирена", effect: "Оглушает раннера на ход.", img: "art/siren.webp",
  tgt: "N", per: 6, spd: 5, atk: 4, def: 3, rez: 18, damage: "2d6",
};
const GOOD_DEMON = {
  name: "Химера", effect: "Ведёт две программы сразу.", img: "art/chimera.webp",
  rez: 40, interface: 8, actions: 5, combatNumber: 16,
};

/* ------------------------------------------------------------------ */

console.log("An empty registry leaves the core-book tables exactly as printed");
{
  freshWorld();
  eq(Object.keys(K.BLACK_ICE).length, 12, "core-book Black ICE count changed");
  eq(Object.keys(K.DEMONS).length, 3, "core-book demon count changed");
  eq(K.BLACK_ICE.hellhound.rez, 20, "Hellhound REZ changed");
  eq(K.DEMONS.balron.actions, 4, "Balron actions changed");
  expect(!K.isCustomIce("hellhound"), "a printed type reported itself as forged");
}

console.log("A forged type joins the tables and answers every lookup");
{
  freshWorld();
  const res = await D.applyOp("custom.save", { kind: "ice", def: GOOD_ICE }, "gm");
  expect(res?.ok === true, `save refused: ${JSON.stringify(res)}`);
  const key = res.key;
  expect(!!key, "save returned no key");

  eq(Object.keys(K.BLACK_ICE).length, 13, "the forged type is missing from Object.keys");
  expect(key in K.BLACK_ICE, "`in` does not see the forged type");
  eq(K.BLACK_ICE[key].per, 6, "PER did not survive the round trip");
  eq(K.BLACK_ICE[key].damage, "2d6", "damage did not survive the round trip");
  eq(K.ENTITY_ICONS[key], "art/siren.webp", "the icon is not served from the registry");
  eq(K.iceName(key), "Сирена", "iceName did not return the GM's own name");
  eq(K.iceEffectText(key), "Оглушает раннера на ход.", "iceEffectText did not return the GM's own text");
  expect(K.isCustomIce(key), "a forged type did not report itself as forged");
  // Name lookup is how a player-deployed Black ICE actor finds its stats.
  eq(K.blackIceTypeForName("сирена"), key, "name lookup cannot find a forged type");

  // A printed type must still resolve through the lang key, not the registry.
  eq(K.iceName("hellhound"), "CRNS.Ice.Hellhound.name", "a printed name stopped resolving");
}

console.log("A forged demon does the same");
{
  freshWorld();
  const res = await D.applyOp("custom.save", { kind: "demon", def: GOOD_DEMON }, "gm");
  expect(res?.ok === true, `demon save refused: ${JSON.stringify(res)}`);
  const key = res.key;
  eq(Object.keys(K.DEMONS).length, 4, "the forged demon is missing from Object.keys");
  eq(K.DEMONS[key].interface, 8, "INT did not survive the round trip");
  eq(K.demonName(key), "Химера", "demonName did not return the GM's own name");
  eq(K.demonName("imp"), "CRNS.Demon.imp.name", "a printed demon name stopped resolving");
  expect(K.isCustomDemon(key), "a forged demon did not report itself as forged");
}

console.log("Malformed types are refused, one reason at a time");
{
  freshWorld();
  const bad = async (def, want, why) => {
    const res = await D.applyOp("custom.save", { kind: "ice", def }, "gm");
    eq(res?.error, want, why);
  };
  await bad({ ...GOOD_ICE, name: "   " }, "CRNS.Errors.CustomName", "a nameless type was accepted");
  await bad({ ...GOOD_ICE, damage: "2к6" }, "CRNS.Errors.CustomDamage", "a damage formula Roll cannot parse was accepted");
  await bad({ ...GOOD_ICE, damage: "drop table" }, "CRNS.Errors.CustomDamage", "free text passed as a damage formula");
  await bad({ ...GOOD_ICE, rez: 0 }, "CRNS.Errors.CustomStats", "REZ 0 was accepted");
  await bad({ ...GOOD_ICE, per: "many" }, "CRNS.Errors.CustomStats", "a non-numeric stat was accepted");
  await bad({ ...GOOD_ICE, atk: 999 }, "CRNS.Errors.CustomStats", "an out-of-range stat was accepted");

  // Empty damage is legal — Asp, Liche, Scorpion and Skunk have none.
  const none = await D.applyOp("custom.save", { kind: "ice", def: { ...GOOD_ICE, damage: "" } }, "gm");
  expect(none?.ok === true, `a damage-less type was refused: ${JSON.stringify(none)}`);
  eq(K.BLACK_ICE[none.key].damage, null, "empty damage was not normalized to null");

  eq(Object.keys(settings.get("customEntities").ice).length, 1, "a refused type still reached storage");
}

console.log("A forged type can never shadow a printed one, nor share its name");
{
  freshWorld();
  const reserved = await D.applyOp("custom.save",
    { kind: "ice", key: "hellhound", def: GOOD_ICE }, "gm");
  eq(reserved?.error, "CRNS.Errors.CustomReserved", "a core-book key was overwritable");
  eq(K.BLACK_ICE.hellhound.rez, 20, "Hellhound was modified anyway");

  const first = await D.applyOp("custom.save", { kind: "ice", def: GOOD_ICE }, "gm");
  const twin = await D.applyOp("custom.save",
    { kind: "ice", def: { ...GOOD_ICE, name: "сирена" } }, "gm");
  eq(twin?.error, "CRNS.Errors.CustomNameTaken", "two forged types share one name");

  // Editing by key keeps the key, so architectures keep resolving.
  const edit = await D.applyOp("custom.save",
    { kind: "ice", key: first.key, def: { ...GOOD_ICE, rez: 22 } }, "gm");
  eq(edit?.key, first.key, "editing a type moved it to a new key");
  eq(K.BLACK_ICE[first.key].rez, 22, "the edit did not reach storage");
}

console.log("Only the GM may forge");
{
  freshWorld();
  const res = await D.applyOp("custom.save", { kind: "ice", def: GOOD_ICE }, "pc");
  eq(res?.error, "CRNS.Errors.GmOnly", "a player forged a type");
  eq(Object.keys(settings.get("customEntities").ice).length, 0, "a player's type reached storage");

  const kind = await D.applyOp("custom.save", { kind: "sandwich", def: GOOD_ICE }, "gm");
  eq(kind?.error, "CRNS.Errors.CustomKind", "an unknown entity kind was accepted");
}

console.log("An architecture accepts a forged type — the whole point of the registry");
{
  freshWorld();
  const made = await D.applyOp("custom.save", { kind: "ice", def: GOOD_ICE }, "gm");
  const demon = await D.applyOp("custom.save", { kind: "demon", def: GOOD_DEMON }, "gm");
  settings.set("netArchs", { a1: { id: "a1", name: "Test", floors: [
    { id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
  ] } });

  const arch = { id: "a1", name: "Test", floors: [
    { id: "f1", parent: "", kind: "custom", dv: 0,
      ice: [{ id: "i1", type: made.key, actorId: "" }],
      demon: { id: "d1", type: demon.key, actorId: "" } },
  ] };
  const saved = await D.applyOp("arch.update", { archId: "a1", arch }, "gm");
  expect(saved !== false && !saved?.error,
    `arch validation rejected a forged type: ${JSON.stringify(saved)}`);

  // The same architecture with a type nobody forged must still be refused.
  const ghost = deepClone(arch);
  ghost.floors[0].ice[0].type = "ci_nothing";
  const bad = await D.applyOp("arch.update", { archId: "a1", arch: ghost }, "gm");
  eq(bad?.error, "CRNS.Errors.UnknownIce", "an unknown ICE type passed validation");
}

console.log("A type an architecture still places cannot be deleted");
{
  freshWorld();
  const made = await D.applyOp("custom.save", { kind: "ice", def: GOOD_ICE }, "gm");
  settings.set("netArchs", { a1: { id: "a1", name: "Арасака-башня", floors: [
    { id: "f1", parent: "", kind: "custom", dv: 0,
      ice: [{ id: "i1", type: made.key, actorId: "" }], demon: null },
  ] } });

  const refused = await D.applyOp("custom.delete", { kind: "ice", key: made.key }, "gm");
  eq(refused?.error, "CRNS.Errors.CustomInUse", "a type in use was deleted");
  // Naming the architecture is what makes the refusal actionable.
  eq(refused?.archs, ["Арасака-башня"], "the refusal did not name the architecture");
  expect(!!K.BLACK_ICE[made.key], "the type vanished despite the refusal");

  // Take it off the floor and the deletion goes through.
  settings.set("netArchs", { a1: { id: "a1", name: "Арасака-башня", floors: [
    { id: "f1", parent: "", kind: "custom", dv: 0, ice: [], demon: null },
  ] } });
  const gone = await D.applyOp("custom.delete", { kind: "ice", key: made.key }, "gm");
  expect(gone?.ok === true, `deletion refused: ${JSON.stringify(gone)}`);
  expect(!K.BLACK_ICE[made.key], "the type survived deletion");
  eq(Object.keys(K.BLACK_ICE).length, 12, "the table did not return to the printed twelve");

  const missing = await D.applyOp("custom.delete", { kind: "ice", key: made.key }, "gm");
  eq(missing?.error, "CRNS.Errors.CustomMissing", "deleting nothing reported success");

  const byPlayer = await D.applyOp("custom.delete", { kind: "demon", key: "imp" }, "pc");
  eq(byPlayer?.error, "CRNS.Errors.GmOnly", "a player deleted a type");
}

console.log("The slid mark can be taken off — the op had no caller for a year");
{
  freshWorld();
  const session = settings.get("session");
  session.slid = [
    { archId: "a1", iceId: "i1", pid: "p1" },
    { archId: "a1", iceId: "i1", pid: "p2" },
    { archId: "a1", iceId: "i2", pid: "p1" },
    { archId: "a2", iceId: "i1", pid: "p1" },
  ];
  settings.set("session", session);

  // No pid: the GM clears the mark for everyone who slid past this ICE, which
  // is what removing it from the map means.
  const res = await D.applyOp("run.clearSlid", { archId: "a1", iceId: "i1" }, "gm");
  expect(res === true, `clearSlid returned ${JSON.stringify(res)}`);
  const left = settings.get("session").slid;
  eq(left.length, 2, "clearing one ICE took the wrong number of marks");
  expect(!left.some((s) => s.archId === "a1" && s.iceId === "i1"), "the mark survived");
  expect(left.some((s) => s.archId === "a1" && s.iceId === "i2"), "another ICE on the same floor lost its mark");
  expect(left.some((s) => s.archId === "a2" && s.iceId === "i1"), "the same ICE id on another arch lost its mark");

  // One runner at a time still works, and a player still cannot do it.
  const one = await D.applyOp("run.clearSlid", { archId: "a1", iceId: "i2", pid: "p9" }, "gm");
  expect(one === true, "a pid-scoped clear failed");
  eq(settings.get("session").slid.length, 2, "a non-matching pid cleared something");

  const denied = await D.applyOp("run.clearSlid", { archId: "a2", iceId: "i1" }, "pc");
  expect(denied === false, "a player cleared a slid mark");
  eq(settings.get("session").slid.length, 2, "a player's clear changed the world");
}

console.log("The two dead controls now have a caller, and the name has room to wrap");
{
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
  const canvasJs = read("scripts/apps/arch-canvas.js");
  const chip = read("templates/entity-card.hbs");
  const canvasHbs = read("templates/arch-canvas.hbs");
  const css = read("styles/netrunning.css");

  // Bug: `run.clearSlid` was correct, GM-gated and completely unreachable — no
  // button, no menu entry, no template. A unit test cannot see a missing
  // caller, so assert the wiring itself.
  expect(chip.includes('data-action="clear-slid"'), "the chip offers no way to clear the slid mark");
  expect(canvasJs.includes('[data-action="clear-slid"]'), "nothing listens for the clear-slid click");
  expect(canvasJs.includes('"run.clearSlid"'), "the clear-slid handler never calls the op");

  // Bug: a floor note reached the screen only as the floor div's `title`, and
  // the chips and buttons drawn on top of that div swallowed the hover.
  expect(canvasHbs.includes('data-action="floor-note"'), "the floor draws no note marker");
  expect(canvasJs.includes('[data-action="floor-note"]'), "nothing listens for the note click");
  expect(canvasJs.includes("hasNote:"), "the view-model never says whether a note exists");

  // Bug: `white-space: nowrap` plus `overflow: hidden` clipped a long floor
  // name down to nothing at all.
  const at = css.indexOf(".crns-floor-title {");
  const titleBlock = at < 0 ? "" : css.slice(at, at + 320);
  expect(at >= 0, "the floor title rule vanished");
  expect(!/white-space:\s*nowrap/.test(titleBlock), "a long floor name is still forbidden to wrap");
  expect(/line-clamp/.test(titleBlock), "the floor name has no line budget to wrap into");
}

console.log("Every dialog carries the palette, and carries it without the grid");
{
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
  const css = read("styles/netrunning.css");
  const forge = read("scripts/apps/entity-forge.js");
  const editor = read("scripts/apps/editor.js");
  const canvas = read("scripts/apps/arch-canvas.js");
  const constants = read("scripts/constants.js");

  // A Dialog is its own application window. None of the --crns-* variables
  // reach it, so `border: 1px solid var(--crns-border)` is not a default border
  // — it is an invalid declaration, and the forge's fields had no edges at all.
  expect(/\.crns-vars\s*\{/.test(css), "the palette has no layout-free hook to hang on a dialog");
  expect(constants.includes("export function dialogClasses"), "no helper builds the dialog's classes");
  // crns-root would bring the suite's three-column grid along with the colours.
  expect(!/dialogClasses[\s\S]{0,200}"crns-root"/.test(constants),
    "the dialog classes drag in the suite grid");

  for (const [name, src, want] of [["entity-forge", forge, 2], ["editor", editor, 1], ["arch-canvas", canvas, 1]]) {
    const uses = (src.match(/classes: dialogClasses\(\)/g) || []).length;
    expect(uses >= want, `${name}: ${uses} of ${want} dialogs wear the palette`);
  }
  // FilePicker is Foundry's own window; it must not be dressed as our dialog.
  // Line-based on purpose: a regex window wide enough to span one constructor
  // also spans the next one, and then it reports the neighbour's options.
  for (const [name, src] of [["entity-forge", forge], ["editor", editor]]) {
    const lines = src.split(String.fromCharCode(10));
    let dressed = 0;
    lines.forEach((line, i) => {
      if (!line.includes("new FilePicker(")) return;
      const body = lines.slice(i, i + 10);
      const end = body.findIndex((l, k) => k > 0 && l.includes(").render(true)"));
      if (end < 0) return;
      if (body.slice(0, end + 1).some((l) => l.includes("dialogClasses"))) dressed += 1;
    });
    expect(dressed === 0, `${name}: a FilePicker was given the module's dialog classes`);
  }

  // The buttons the dialogs draw are styled under .crns-root; without a twin
  // selector they are unstyled the moment they appear outside the suite window.
  expect(/\.crns-vars \.crns-icon-btn/.test(css), "icon buttons are styled only inside the suite window");
}

console.log("What we draw inside a dialog brings its own ground");
{
  const css = fs.readFileSync(path.join(ROOT, "styles/netrunning.css"), "utf-8");

  // The palette is written for the suite's near-black ground, which .crns-root
  // paints. A Dialog is its own application window and nothing of ours paints
  // behind it, so `--crns-text` — near-white under the red theme — sat on
  // Foundry's own light dialog and could not be read at all.
  const groundRule = css.indexOf(".crns-virus-intent,");
  expect(groundRule > 0, "the dialog containers have no shared ground rule");
  // Searching from -1 would search the whole file and find somebody else's
  // background, so the rule has to be found before the colour is looked for.
  expect(groundRule > 0 && css.indexOf("background: var(--crns-bg)", groundRule) > groundRule,
    "the dialog containers paint no ground of their own");

  // The fields used to be `background: transparent`, i.e. windows onto whatever
  // the host window happened to be. The later rule has to win the cascade, so
  // it has to come after — same specificity, source order decides.
  const transparent = css.indexOf(".crns-virus-intent textarea {");
  const opaque = css.lastIndexOf(".crns-virus-intent textarea,");
  expect(transparent > 0 && opaque > transparent,
    "the opaque field rule does not come after the transparent one, so it loses the cascade");
  expect(css.indexOf("background: var(--crns-panel)", opaque) > opaque,
    "the fields are still transparent");

  // A browser's own placeholder grey is unreadable on this ground, and its
  // default opacity fades whatever colour it is.
  const ph = css.indexOf("::placeholder");
  expect(ph > 0, "no placeholder colour is set anywhere");
  expect(css.indexOf("opacity: 1", ph) > ph, "the placeholder keeps the browser's fade");
}

/* ------------------------------------------------------------------ */

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
