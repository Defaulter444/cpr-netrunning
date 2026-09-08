/* Shared constants and game-data tables for the Netrunning Suite. */

export const MODULE_ID = "cpr-netrunning";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const TPL = (name) => `modules/${MODULE_ID}/templates/${name}.hbs`;
export const uid = (prefix) => `${prefix}_${foundry.utils.randomID(12)}`;
export const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
/* HTML-escape for strings interpolated into raw HTML (foundry.utils.escapeHTML does not exist in v12). */
export const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------ */
/* Game data tables (values from the Cyberpunk RED core book)          */
/* ------------------------------------------------------------------ */

/* Black ICE stat block. tgt "N" = anti-NETRUNNER (system class "antipersonnel":
 * Asp…Wisp), tgt "P" = anti-PROGRAM (system class "antiprogram": Dragon, Killer,
 * Sabertooth). See cpr-bridge.createIceActor: tgt "P" -> "antiprogram". */
export const BLACK_ICE = {
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

export const DEMONS = {
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
 */
export const CHECK_ABILITIES = [
  "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus", "zap",
];
export const THEMES = ["red", "yellow", "blue", "green"];

// Icons — reuse the system's own art (verified to exist).
const SYS = "systems/cyberpunk-red-core/icons";
export const ENTITY_ICONS = {
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
    let locName = "";
    try { locName = loc(`CRNS.Ice.${key.charAt(0).toUpperCase() + key.slice(1)}.name`); } catch (e) { locName = ""; }
    if (locName && locName.toLowerCase() === n) return key;
  }
  return "";
}

/* NET actions per turn from Interface rank: 1-3->2, 4-6->3, 7-9->4, 10->5. */
export const netActionsMax = (rank) => (rank <= 0 ? 0 : Math.min(5, Math.ceil(rank / 3) + 1));
