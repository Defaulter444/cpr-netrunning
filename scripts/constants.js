/* Shared constants and game-data tables for the Netrunning Suite. */

export const MODULE_ID = "cpr-netrunning";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const TPL = (name) => `modules/${MODULE_ID}/templates/${name}.hbs`;
export const uid = (prefix) => `${prefix}_${foundry.utils.randomID(12)}`;
export const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
/* HTML-escape for strings interpolated into raw HTML (foundry.utils.escapeHTML does not exist in v12). */
export const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Window classes that let a standalone Dialog wear the suite's palette.
 *  A Dialog is its own application window, outside the suite's DOM, so none of
 *  the `--crns-*` variables reach it and every `var()` in a rule resolves to
 *  nothing — which makes the whole declaration invalid, not merely default. That
 *  is why the forge's inputs had no borders. `crns-vars` carries the colours;
 *  `crns-root` would also drag in the suite's three-column grid. */
export function dialogClasses() {
  let theme = "green";
  try { theme = globalThis.game?.settings?.get?.(MODULE_ID, "theme") || "green"; } catch (e) { theme = "green"; }
  return ["dialog", "crns-vars", `theme-${theme}`];
}

/* ------------------------------------------------------------------ */
/* Game data tables (values from the Cyberpunk RED core book)          */
/* ------------------------------------------------------------------ */

/* Black ICE stat block. tgt "N" = anti-NETRUNNER (system class "antipersonnel":
 * Asp…Wisp), tgt "P" = anti-PROGRAM (system class "antiprogram": Dragon, Killer,
 * Sabertooth). See cpr-bridge.createIceActor: tgt "P" -> "antiprogram". */
const BUILTIN_BLACK_ICE = {
  asp:        { tgt: "N", per: 4, spd: 6, atk: 2, def: 2, rez: 15, damage: null,  effectKey: "CRNS.Ice.Asp" },
  giant:      { tgt: "N", per: 2, spd: 2, atk: 8, def: 4, rez: 25, damage: "3d6", effectKey: "CRNS.Ice.Giant" },
  hellhound:  { tgt: "N", per: 6, spd: 6, atk: 6, def: 2, rez: 20, damage: "2d6", effectKey: "CRNS.Ice.Hellhound" },
  kraken:     { tgt: "N", per: 6, spd: 2, atk: 8, def: 4, rez: 30, damage: "3d6", effectKey: "CRNS.Ice.Kraken" },
  liche:      { tgt: "N", per: 8, spd: 2, atk: 6, def: 2, rez: 25, damage: null,  effectKey: "CRNS.Ice.Liche" },
  raven:      { tgt: "N", per: 6, spd: 4, atk: 4, def: 2, rez: 15, damage: "1d6", effectKey: "CRNS.Ice.Raven" },
  scorpion:   { tgt: "N", per: 2, spd: 6, atk: 2, def: 2, rez: 15, damage: null,  effectKey: "CRNS.Ice.Scorpion" },
  skunk:      { tgt: "N", per: 2, spd: 4, atk: 4, def: 2, rez: 10, damage: null,  effectKey: "CRNS.Ice.Skunk" },
  wisp:       { tgt: "N", per: 4, spd: 4, atk: 4, def: 2, rez: 15, damage: "1d6", effectKey: "CRNS.Ice.Wisp" },
  dragon:     { tgt: "P", per: 6, spd: 4, atk: 6, def: 6, rez: 30, damage: "6d6", effectKey: "CRNS.Ice.Dragon" },
  killer:     { tgt: "P", per: 4, spd: 8, atk: 6, def: 2, rez: 20, damage: "4d6", effectKey: "CRNS.Ice.Killer" },
  sabertooth: { tgt: "P", per: 8, spd: 6, atk: 6, def: 2, rez: 25, damage: "6d6", effectKey: "CRNS.Ice.Sabertooth" },
};

const BUILTIN_DEMONS = {
  imp:    { rez: 15, interface: 3, actions: 2, combatNumber: 14 },
  efreet: { rez: 25, interface: 4, actions: 3, combatNumber: 14 },
  balron: { rez: 30, interface: 7, actions: 4, combatNumber: 14 },
};

export const FLOOR_KINDS = ["password", "file", "controlnode", "custom"];

/* Interface abilities a floor's DV may be rolled against.
 *
 * The GM names this per floor instead of it being implied by the floor kind.
 * Two reasons. A "custom" floor otherwise has a DV nothing can beat — there is
 * no ability the game would think to roll. And the runner's programs only pay
 * out when the roll knows what it is: Worm grants +2 to Backdoor, See Ya +2 to
 * Pathfinder, and those bonuses attach by ability name.
 *
 * Scanner is absent on purpose — it is a MEAT action taken outside the
 * architecture, so it can never be what a floor asks of you (Corebook p. 200).
 *
 * Virus is absent for the same kind of reason. It does not open a floor: it is
 * planted at the bottom of a branch against the DV in that floor's virus plan,
 * which is a separate box in the editor. Offering it here promised a second,
 * parallel way to roll a virus that no code ever honoured.
 */
export const CHECK_ABILITIES = [
  "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "zap",
];
export const THEMES = ["red", "yellow", "blue", "green"];

// Icons — reuse the system's own art (verified to exist).
const SYS = "systems/cyberpunk-red-core/icons";
const BUILTIN_ENTITY_ICONS = {
  // Black ICE actor portraits (webp) — used as Actor.img and canvas chips.
  asp: `${SYS}/compendium/blackice/asp.webp`, giant: `${SYS}/compendium/blackice/giant.webp`,
  hellhound: `${SYS}/compendium/blackice/hellhound.webp`, kraken: `${SYS}/compendium/blackice/kraken.webp`,
  liche: `${SYS}/compendium/blackice/liche.webp`, raven: `${SYS}/compendium/blackice/raven.webp`,
  scorpion: `${SYS}/compendium/blackice/scorpion.webp`, skunk: `${SYS}/compendium/blackice/skunk.webp`,
  wisp: `${SYS}/compendium/blackice/wisp.webp`, dragon: `${SYS}/compendium/blackice/dragon.webp`,
  killer: `${SYS}/compendium/blackice/killer.webp`, sabertooth: `${SYS}/compendium/blackice/sabertooth.webp`,
  // Demons (netrunning PNG set).
  imp: `${SYS}/netrunning/Imp.png`, efreet: `${SYS}/netrunning/Efreet.png`, balron: `${SYS}/netrunning/Balron.png`,
};
/* ------------------------------------------------------------------ */
/* GM-authored Black ICE and demons                                    */
/* ------------------------------------------------------------------ */

/* The core-book tables above are the game's own. A table cannot hold what a
 * table was never given, so the GM's own creations live beside them in a world
 * setting and are merged in on read.
 *
 * Merging happens through a Proxy rather than by copying, because every call
 * site in the module already reads `BLACK_ICE[type]` / `Object.keys(DEMONS)`
 * directly. A Proxy keeps all of them working and, more importantly, keeps them
 * CURRENT: a type the GM adds mid-session is visible on the next read, with no
 * cache to invalidate and no reload. */

export const CUSTOM_SETTING = "customEntities";
export const DEFAULT_ICE_IMG = `${SYS}/netrunning/Black_Ice.png`;
export const DEFAULT_DEMON_IMG = `${SYS}/netrunning/Demon.png`;

/** The GM-authored registry, always a well-formed `{ ice, demons }`.
 *  Deliberately total: called before `game` exists (module evaluation, the Node
 *  test harness) and before the setting is registered. Either way it answers
 *  "nothing custom" instead of throwing, so a missing registry can never take
 *  the built-in tables down with it. */
export function readCustomEntities() {
  try {
    const raw = globalThis.game?.settings?.get?.(MODULE_ID, CUSTOM_SETTING);
    if (!raw || typeof raw !== "object") return { ice: {}, demons: {} };
    return {
      ice: raw.ice && typeof raw.ice === "object" ? raw.ice : {},
      demons: raw.demons && typeof raw.demons === "object" ? raw.demons : {},
    };
  } catch (e) {
    return { ice: {}, demons: {} };
  }
}

/** A read-only view of `builtin` with `overlay()` merged over it. Built-in keys
 *  always win: a custom type can never quietly redefine Hellhound. */
function mergedTable(builtin, overlay) {
  const extra = () => {
    try { return overlay() || {}; } catch (e) { return {}; }
  };
  const owns = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  return new Proxy(builtin, {
    get(target, prop, recv) {
      if (typeof prop === "string" && !owns(target, prop)) {
        const c = extra();
        if (owns(c, prop)) return c[prop];
      }
      return Reflect.get(target, prop, recv);
    },
    has(target, prop) {
      if (Reflect.has(target, prop)) return true;
      return typeof prop === "string" && owns(extra(), prop);
    },
    ownKeys(target) {
      return Array.from(new Set([...Reflect.ownKeys(target), ...Object.keys(extra())]));
    },
    getOwnPropertyDescriptor(target, prop) {
      const own = Reflect.getOwnPropertyDescriptor(target, prop);
      if (own) return own;
      const c = extra();
      if (typeof prop === "string" && owns(c, prop)) {
        return { value: c[prop], writable: false, enumerable: true, configurable: true };
      }
      return undefined;
    },
    set() { return false },
    deleteProperty() { return false },
  });
}

/* The core-book keys, frozen. Used to refuse a custom type that would shadow a
 * built-in one, and to tell the two apart without consulting the registry. */
export const BUILTIN_ICE_KEYS = Object.freeze(Object.keys(BUILTIN_BLACK_ICE));
export const BUILTIN_DEMON_KEYS = Object.freeze(Object.keys(BUILTIN_DEMONS));

export const BLACK_ICE = mergedTable(BUILTIN_BLACK_ICE, () => readCustomEntities().ice);
export const DEMONS = mergedTable(BUILTIN_DEMONS, () => readCustomEntities().demons);
export const ENTITY_ICONS = mergedTable(BUILTIN_ENTITY_ICONS, () => {
  const c = readCustomEntities();
  const out = {};
  for (const [k, v] of Object.entries(c.ice)) if (v?.img) out[k] = v.img;
  for (const [k, v] of Object.entries(c.demons)) if (v?.img) out[k] = v.img;
  return out;
});

/** Is this a GM-authored type? Built-in types carry a lang key; custom ones
 *  carry the literal strings the GM typed, so the two need different lookups. */
export const isCustomIce = (type) => !!BLACK_ICE[type] && !BUILTIN_BLACK_ICE[type];
export const isCustomDemon = (type) => !!DEMONS[type] && !BUILTIN_DEMONS[type];

/** Display name of a Black ICE type — the GM's own text, or the localized
 *  core-book name. "" for a type that does not exist. */
export function iceName(type) {
  const def = BLACK_ICE[type];
  if (!def) return "";
  if (!def.effectKey) return String(def.name || type);
  return loc(`${def.effectKey}.name`);
}

/** Effect text of a Black ICE type, already resolved to display text. */
export function iceEffectText(type) {
  const def = BLACK_ICE[type];
  if (!def) return "";
  if (!def.effectKey) return String(def.effect || "");
  return loc(`${def.effectKey}.effect`);
}

/** Display name of a demon type. */
export function demonName(type) {
  const def = DEMONS[type];
  if (!def) return "";
  if (BUILTIN_DEMONS[type]) return loc(`CRNS.Demon.${type}.name`);
  return String(def.name || type);
}

/** Effect / notes text of a demon type ("" for the core-book three). */
export function demonEffectText(type) {
  const def = DEMONS[type];
  if (!def || BUILTIN_DEMONS[type]) return "";
  return String(def.effect || "");
}

export const FLOOR_ICONS = {
  password: `${SYS}/netrunning/Password.png`, file: `${SYS}/netrunning/File.png`,
  controlnode: `${SYS}/netrunning/Control_Node.png`, custom: `${SYS}/netrunning/Access.png`,
  root: `${SYS}/netrunning/Root_Access.png`, // decorative: last floor marker
};

export const MAX_ICE_PER_FLOOR = 3;

export const maxDemons = (floorCount) => Math.ceil(floorCount / 6);

/* ------------------------------------------------------------------ */
/* Program 3-letter codes (SPEC §14.3) — key by lowercased name.       */
/* ------------------------------------------------------------------ */

export const PROGRAM_ABBR = {
  "eraser": "ERS",
  "see ya": "SYA",
  "speedy gonzalvez": "SPG",
  "worm": "WRM",
  "armor": "ARM",
  "flak": "FLK",
  "shield": "SHD",
  "banhammer": "BAN",
  "sword": "SWD",
  "deck krash": "KRS",
  "hellbolt": "HLB",
  "nervescrub": "NRV",
  "poison flatline": "PSN",
  "superglue": "GLU",
  "vrizzbolt": "VRZ",
};

/** A 3-letter code for a program by name: the PROGRAM_ABBR map when known, else
 *  a fallback — uppercase the name, keep the first char, strip vowels after it,
 *  and take the first 3 chars. Empty name → "???". */
export function abbrFor(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return "???";
  const known = PROGRAM_ABBR[raw.toLowerCase()];
  if (known) return known;
  const up = raw.toUpperCase();
  const first = up[0];
  const rest = up.slice(1).replace(/[AEIOU\s]/g, "");
  return (first + rest).slice(0, 3) || up.slice(0, 3);
}

/** The BLACK_ICE[] key for a Black-ICE by display name: case-insensitive match
 *  against the localized `CRNS.Ice.<Type>.name` and the raw key. Returns "" when
 *  nothing matches (custom-named player programs) — callers skip the effect card
 *  gracefully. Used for player-deployed BI whose actor/program is name-only. */
export function blackIceTypeForName(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return "";
  for (const key of Object.keys(BLACK_ICE)) {
    if (key === n) return key;
    // iceName() covers both spellings: the core-book lang key and a GM-authored
    // literal name. Matching only the former left every custom type nameless.
    let locName = "";
    try { locName = iceName(key); } catch (e) { locName = ""; }
    if (locName && locName.toLowerCase() === n) return key;
  }
  return "";
}

/* NET actions per turn from Interface rank: 1-3->2, 4-6->3, 7-9->4, 10->5. */
export const netActionsMax = (rank) => (rank <= 0 ? 0 : Math.min(5, Math.ceil(rank / 3) + 1));
