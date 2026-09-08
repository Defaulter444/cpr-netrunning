/* World data layer.
 *
 * All shared state lives in world-scoped settings (type Object). Only a GM
 * client may write them, so player mutations are relayed over the module
 * socket to the primary GM, who validates and applies them. Every write
 * triggers the core `updateSetting` broadcast, which re-renders open suites
 * on all clients — no manual refresh fan-out is needed for data changes.
 */

import { MODULE_ID, SOCKET_NAME, uid, loc, BLACK_ICE, DEMONS, FLOOR_KINDS, MAX_ICE_PER_FLOOR, maxDemons } from "./constants.js";
import * as bridge from "./cpr-bridge.js";
import * as tree from "./rules/tree.js";

const FLOOR_KINDS_SET = new Set(FLOOR_KINDS);

/* Floors of an architecture, with the tree fixed up.
 *
 * Every read goes through here so a world saved before branching existed keeps
 * working: `normalizeFloors` turns such a chain into a spine on the fly. It
 * also repairs orphans and cycles, which matters because the traversals below
 * assume a well-formed tree and would otherwise loop.
 */
function floorsOf(archs, archId) {
  const floors = archs?.[archId]?.floors;
  if (!Array.isArray(floors)) return [];
  return tree.normalizeFloors(floors);
}

/* Floors a runner standing on `from` may legally step to.
 *
 * The parent and the children — never a sibling, never a jump. An un-breached
 * password does not stop you arriving, it stops you leaving downward, which is
 * exactly how a locked door behaves.
 */
function reachableFrom(session, archId, floors, from) {
  const out = tree.adjacentOf(floors, from);
  if (!isBlockingPasswordFloor(session, archId, floors[from])) return out;
  const up = tree.parentOf(floors, from);
  return up >= 0 ? [up] : [];
}

/* The floor ids a runner has stood on. Stored as ids, not indices: the GM may
 * reorder or re-parent floors in the editor, and a remembered index would then
 * point at somebody else's floor. */
function visitedIds(part) {
  return Array.isArray(part?.visited) ? part.visited : [];
}

function markVisited(part, floorId) {
  if (!floorId) return;
  part.visited = visitedIds(part);
  if (!part.visited.includes(floorId)) part.visited.push(floorId);
}

/* World-setting defaults. main.js registers each key from this dict. */
export const WORLD_OBJECTS = {
  netTree: [],
  treeState: {},
  netArchs: {},
  // Current entity REZ lives on the backing blackIce/demon Actor, not here.
  session: {
    tabs: [], activeTab: "", participants: {}, targets: {}, demonPrograms: {},
    progFloors: {}, pendingTests: [],
    // Round-2 (SPEC §14):
    floorState: {},    // "<archId>:<floorId>" -> FloorFx (breach/virus/control/eyedee)
    cloaks: {},        // "<archId>" -> [{id, n, pid, dv}]  — arch-level cloak markers (Addendum 6)
    reveal: {},        // "<pid>" -> { "<archId>": maxVisibleFloorIndex }  (pathfinder fog of war)
    slid: [],          // [{archId, iceId|progKey, pid}] — ICE this runner slid past (never re-attaches)
    attachments: [],   // [{archId, iceId|progKey, pid}] — ICE following a player's runner
    demonState: {},    // "<actorId>" -> { value, max }  — demon NET-action counter
    progState: {},     // "<pid>|<programId>" -> { mode:"trap"|"deployed", targetRef, floorIndex }
  },
};

/* ------------------------------------------------------------------ */
/* Generic access                                                      */
/* ------------------------------------------------------------------ */

export function getWorld(key) {
  try { return foundry.utils.deepClone(game.settings.get(MODULE_ID, key)); }
  catch (e) { return null; }
}

export async function setWorld(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

export function primaryGM() {
  return game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export function isPrimaryGM() {
  return primaryGM()?.id === game.user.id;
}

/* Pending player-side mutation requests awaiting the GM's result. */
const _pendingMutations = new Map(); // requestId -> resolve

/** Mutate shared world data. GMs apply locally; players relay to the GM and
 *  await the GM's result over the socket (10s timeout -> null). */
export async function mutate(op, payload = {}) {
  if (game.user.isGM) {
    return applyOp(op, payload, game.user.id);
  }
  const gm = primaryGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("CRNS.Errors.NoGm"));
    return false;
  }
  const requestId = foundry.utils.randomID(10);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (_pendingMutations.delete(requestId)) resolve(null);
    }, 10000);
    _pendingMutations.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    game.socket.emit(SOCKET_NAME, { action: "mutate", op, payload, userId: game.user.id, requestId });
  });
}

/** Called by the socket router when the GM reports a mutation result. */
export function resolveMutation(requestId, result) {
  const resolve = _pendingMutations.get(requestId);
  if (!resolve) return;
  _pendingMutations.delete(requestId);
  resolve(result);
}

/* ------------------------------------------------------------------ */
/* Notification fan-out (GM side)                                      */
/* ------------------------------------------------------------------ */

export function notifyClients(data) {
  game.socket.emit(SOCKET_NAME, { action: "notify", ...data });
  // The emitting GM does not receive its own socket message.
  Hooks.callAll(`${MODULE_ID}.notify`, data);
}

/* ------------------------------------------------------------------ */
/* Operations (executed on a GM client only)                           */
/* ------------------------------------------------------------------ */

function requesterIsGM(userId) {
  return game.users.get(userId)?.isGM ?? false;
}

/* ------------------------------------------------------------------ */
/* Phase C helpers (session participants / entity refs)                 */
/* ------------------------------------------------------------------ */

/** Does the given user own this participant record? Runners: by userId, or by
 *  OWNER permission on the backing actor when userId is unset. Spectators: by
 *  userId. GM-added NPC runners (userId "") are GM-only — never "owned". */
function ownsParticipant(part, userId) {
  if (!part || !userId) return false;
  if (part.userId && part.userId === userId) return true;
  if (part.kind === "runner" && !part.userId && part.actorUuid) {
    const user = game.users.get(userId);
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    // Only non-GM owners of the actor; NPC runners stay GM-controlled otherwise.
    if (user && !user.isGM && actor?.testUserPermission?.(user, "OWNER")) return true;
  }
  return false;
}

/** Recompute a runner participant's NET-action maximum from its Interface rank
 *  (falls back to the stored max, else 2, when the actor can't be resolved). */
function participantActionMax(part) {
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  if (actor) return bridge.netActionsMax(bridge.getInterfaceRank(actor));
  return part?.actions?.max ?? 2;
}

const ENTITY_REF_PREFIXES = new Set(["ice", "demon", "runner", "prog"]);

/** Validate an entityRef's prefix (ice:|demon:|runner:|prog:). */
function validEntityRef(ref) {
  if (typeof ref !== "string" || !ref) return false;
  return ENTITY_REF_PREFIXES.has(ref.split(":")[0]);
}

/** Resolve an "ice:<archId>:<floorId>:<entId>" / "demon:…" target ref to its
 *  backing actorId, using the current netArchs floors. "" if it doesn't resolve. */
function refActorId(ref) {
  const [kind, archId, floorId, entId] = (ref || "").split(":");
  if (kind !== "ice" && kind !== "demon") return "";
  const arch = (getWorld("netArchs") || {})[archId];
  const floor = (arch?.floors || []).find((f) => f.id === floorId);
  if (!floor) return "";
  const def = kind === "ice"
    ? (floor.ice || []).find((i) => i.id === entId)
    : (floor.demon && floor.demon.id === entId ? floor.demon : null);
  return def?.actorId || "";
}

/** Clamp a damage amount to a whole number in 1..500. NaN → 0 (no-op damage). */
function clampDamage(amount) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(500, n));
}

/* ------------------------------------------------------------------ */
/* Round-2 helpers (SPEC §14) — floor state / fog / attachments         */
/* ------------------------------------------------------------------ */

/** Key for a floor's FloorFx record: "<archId>:<floorId>". */
function floorKey(archId, floorId) { return `${archId}:${floorId}`; }

/** A fresh, empty FloorFx record. (Cloaks are arch-level now — see session.cloaks
 *  and archCloaks(); Addendum 6.) */
function emptyFloorFx() {
  return { breached: false, viruses: [], control: null, eyedee: [] };
}

/** Get (creating on demand) the FloorFx for a floor. Mutating the return value
 *  and then calling setWorld("session") persists it. */
function getFloorFx(session, archId, floorId) {
  session.floorState = session.floorState || {};
  const key = floorKey(archId, floorId);
  const cur = session.floorState[key];
  const fx = { ...emptyFloorFx(), ...(cur || {}) };
  // Normalize array/object shapes in case a partial record was stored.
  fx.viruses = Array.isArray(fx.viruses) ? fx.viruses : [];
  fx.eyedee = Array.isArray(fx.eyedee) ? fx.eyedee : [];
  fx.control = fx.control || null;
  session.floorState[key] = fx;
  return fx;
}

/** The arch-level cloak marker list (creating on demand). Addendum 6. */
function archCloaks(session, archId) {
  session.cloaks = session.cloaks || {};
  if (!Array.isArray(session.cloaks[archId])) session.cloaks[archId] = [];
  return session.cloaks[archId];
}

/** Resolve a participant's current floor object from netArchs. */
function participantFloor(part, archs) {
  const floors = archs?.[part?.archId]?.floors || [];
  return floors[part?.floorIndex || 0] || null;
}

/** Resolve payload.pid to a participant the caller may act for (owner-or-GM).
 *  Returns { session, part, pid } or null (invalid / not permitted). */
function resolveActingRunner(session, pid, callerId) {
  const part = (session.participants || {})[pid];
  if (!part || part.kind !== "runner") return null;
  if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return null;
  return { part, pid };
}

/** Move an ICE def (by iceId) to another floor of the same arch, rewriting any
 *  session.targets ice: refs whose floorId changed. Runtime follow moves ignore
 *  the 3-per-floor editor cap. Mutates `archs` (persist via setWorld) and
 *  `session.targets`. Returns true if the def moved. Shared by ent.move-like
 *  logic and attachment follow. */
function moveIceDefToFloor(session, archs, archId, iceId, toFloorIndex) {
  const arch = archs?.[archId];
  const floors = arch?.floors || [];
  const target = floors[toFloorIndex];
  if (!target) return false;

  let srcFloor = null, def = null, srcIndex = -1;
  for (const floor of floors) {
    const idx = (floor.ice || []).findIndex((i) => i.id === iceId);
    if (idx >= 0) { srcFloor = floor; def = floor.ice[idx]; srcIndex = idx; break; }
  }
  if (!srcFloor || !def) return false;
  if (srcFloor.id === target.id) return false; // already there.

  srcFloor.ice.splice(srcIndex, 1);
  target.ice = target.ice || [];
  target.ice.push(def);

  // Rewrite ice: targets referencing the old floorId.
  for (const [uid_, ref] of Object.entries(session.targets || {})) {
    const [rKind, rArch, rFloor, rEnt] = (ref || "").split(":");
    if (rKind === "ice" && rArch === archId && rFloor === srcFloor.id && rEnt === iceId) {
      session.targets[uid_] = `ice:${archId}:${target.id}:${iceId}`;
    }
  }
  return true;
}

/** Drop attachments matching a predicate. Returns true if any removed. */
function pruneAttachments(session, predicate) {
  const list = session.attachments;
  if (!Array.isArray(list) || !list.length) return false;
  const kept = list.filter((a) => !predicate(a));
  if (kept.length === list.length) return false;
  session.attachments = kept;
  return true;
}

/** Delete every progState belonging to a participant, and prune the reaction
 *  side-effects (pendingTests / attachments / slid) each of those player BIs
 *  provoked (Addendum 2). Returns true if it changed anything. */
function clearProgState(session, pid) {
  const ps = session.progState;
  let changed = false;
  const prefix = `${pid}|`;
  if (ps) {
    for (const key of Object.keys(ps)) {
      if (!key.startsWith(prefix)) continue;
      const actorId = ps[key]?.actorId || "";
      delete ps[key];
      changed = true;
      pruneProgBiSideEffects(session, actorId, key);
    }
  }
  return changed;
}

/** Prune the reaction side-effects of a player-placed Black ICE (Addendum 2):
 *  pendingTests it provoked (by its backing actorId), and the attachments / slid
 *  records keyed on its progKey. Call when a player BI is derezzed / removed.
 *  Returns true if anything changed. */
function pruneProgBiSideEffects(session, actorId, progKey) {
  let changed = false;
  if (actorId && prunePendingTests(session, (t) => t.iceActorId === actorId)) changed = true;
  if (progKey) {
    if (pruneAttachments(session, (a) => a.progKey === progKey)) changed = true;
    const sBefore = (session.slid || []).length;
    session.slid = (session.slid || []).filter((s) => s.progKey !== progKey);
    if ((session.slid || []).length !== sBefore) changed = true;
  }
  return changed;
}

/** All backing prog-ICE actorIds for a participant's progState (SPEC §14.12 /
 *  Task 1). Used to delete the actors when the prog state is cleared (derez /
 *  jack-out / disconnect / removal). */
function progActorIdsForPid(session, pid) {
  const ps = session.progState || {};
  const out = [];
  const prefix = `${pid}|`;
  for (const [key, st] of Object.entries(ps)) {
    if (key.startsWith(prefix) && st?.actorId) out.push(st.actorId);
  }
  return out;
}

/** Delete the backing prog-ICE actors for a participant (or a single program).
 *  Reads progState BEFORE the caller clears it, so call this first. GM-side. */
async function deleteProgActors(session, pid, programId = null) {
  const ps = session.progState || {};
  const ids = [];
  const prefix = `${pid}|`;
  for (const [key, st] of Object.entries(ps)) {
    if (!key.startsWith(prefix) || !st?.actorId) continue;
    if (programId && key !== `${pid}|${programId}`) continue;
    ids.push(st.actorId);
  }
  if (ids.length) await bridge.deleteEntityActors(ids);
}

/** A player-placed Black-ICE program (prog: target) was destroyed by damage
 *  (backing actor REZ ≤ 0) — automatically DEREZ it GM-side, mirroring a manual
 *  derez (Task 2): delete its backing prog actor, derez the program item on the
 *  owner's actor (bridge.derezProgram — restores item REZ per module rule), clear
 *  the progState/progFloors entry + the owner's rezzed mirror, and prune the
 *  reaction side-effects (pendingTests/attachments/slid) it provoked. Mutates
 *  `session` in place (caller persists). GM-side only. Returns true if it acted. */
async function autoDerezDestroyedProg(session, pid, programId) {
  const part = (session.participants || {})[pid];
  if (!part) return false;
  const progKey = `${pid}|${programId}`;
  const actorId = (session.progState || {})[progKey]?.actorId || "";

  // Derez the program item on the owner's actor (GM client owns everything).
  const owner = part.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  if (owner) await bridge.derezProgram(owner, programId);

  // Delete the backing prog-ICE actor (read progState BEFORE clearing it).
  await deleteProgActors(session, pid, programId);

  // Clear the mirror + floor override + prog state.
  if (part.rezzed) delete part.rezzed[programId];
  if (session.progFloors) delete session.progFloors[progKey];
  if (session.progState) delete session.progState[progKey];

  // Drop the reactions this BI provoked (pendingTests / attachments / slid).
  pruneProgBiSideEffects(session, actorId, progKey);
  return true;
}

/** Whether a floor is a password floor un-breached for the given arch (blocks
 *  deeper non-GM movement past it). */
function isBlockingPasswordFloor(session, archId, floor) {
  if (!floor) return false;
  // Two ways a floor can hold a runner up. A `password` gates by its nature —
  // that is what the rulebook calls it. `gate` is the GM saying so explicitly
  // about any floor: a server room nobody walks past until the alarm is dealt
  // with, a maintenance hatch that needs a Tech roll. Both open the same way,
  // by beating the floor's own check.
  const gated = floor.gate === true || floor.kind === "password";
  if (!gated) return false;
  const fx = (session.floorState || {})[floorKey(archId, floor.id)];
  return !(fx && fx.breached);
}

/** Get (seeding lazily from DEMONS[type]) a demon's NET-action counter. Returns
 *  { value, max } stored on session.demonState, or null if the type is unknown. */
function ensureDemonState(session, actorId) {
  session.demonState = session.demonState || {};
  if (session.demonState[actorId]) return session.demonState[actorId];
  const actor = game.actors?.get(actorId);
  const type = bridge.getDemonType(actor);
  const max = type ? (DEMONS[type]?.actions ?? 0) : (actor?.system?.stats?.actions ?? 0);
  if (!max) return null;
  session.demonState[actorId] = { value: max, max };
  return session.demonState[actorId];
}

/** Server-side gate for derezzing a TRAP Black-ICE program: only when the owner
 *  runner stands on the same floor as the trap (SPEC §14.12). Enforcement of the
 *  actual derez runs client-side (owner's own item), so the UI calls this first.
 *  Exported for G2. Returns true when the derez is permitted. */
export function canDerezTrap(session, pid, programId) {
  const ps = (session?.progState || {})[`${pid}|${programId}`];
  if (!ps || ps.mode !== "trap") return true; // not a trap → normal derez rules.
  const part = (session?.participants || {})[pid];
  if (!part) return false;
  return (part.floorIndex || 0) === (Number(ps.floorIndex) || 0);
}

/** The set of ICE def ids across all archs backed by the given actorId. Used to
 *  drop attachments when an ICE actor is derezzed (attachments key on def id). */
function iceDefIdsForActor(actorId) {
  const out = new Set();
  const archs = getWorld("netArchs") || {};
  for (const arch of Object.values(archs)) {
    for (const floor of arch.floors || []) {
      for (const i of floor.ice || []) if (i.actorId === actorId) out.add(i.id);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Turn queue (core Foundry Combat API — no CPR internals)              */
/* ------------------------------------------------------------------ */

/** Move an actor's combatant to the top of the active combat's turn queue by
 *  giving it initiative EQUAL to the current highest (SPEC §14.1 — "above the
 *  current top" without out-running everyone by +1). A `queueTs` flag is stamped
 *  on the combatant so main.js's `_sortCombatants` patch tie-breaks newest-first.
 *  Creates an actorId-only combatant if one does not already exist (legal in
 *  v12 — name/img fall back to the actor). Returns true on success, false if
 *  there is no active combat (caller emits the no-combat hint). */
export async function moveToTopOfQueue(actorId) {
  // No active combat → CREATE one (user requirement: an ICE encounter must
  // initialize the fight so the queue mechanics work out of the box).
  let combat = game.combat;
  if (!combat) {
    try {
      combat = await Combat.create({ scene: canvas?.scene?.id ?? null, active: true });
    } catch (e) {
      console.error(`${MODULE_ID} | failed to create combat`, e);
      return false;
    }
  }
  if (!combat) return false;
  let c = combat.combatants.find((x) => x.actorId === actorId);
  if (!c) {
    const created = await combat.createEmbeddedDocuments("Combatant", [{ actorId }]);
    c = created?.[0];
  }
  if (!c) return false;
  // The current highest initiative among the others; fall back to the first
  // combatant's initiative, else 0. We match it exactly (equal-init insertion).
  const others = combat.combatants.filter((x) => x.id !== c.id);
  const inits = others.map((x) => x.initiative).filter((v) => typeof v === "number");
  const topInit = inits.length
    ? Math.max(...inits)
    : (others[0]?.initiative ?? combat.combatants.contents[0]?.initiative ?? 0);
  // Stamp queueTs first (drives the tie-break), then set the equal initiative.
  await c.setFlag(MODULE_ID, "queueTs", Date.now());
  await combat.setInitiative(c.id, topInit);
  return true;
}

/** Post a localized chat card. `whisperGM` sends it only to GM users. */
function postChatCard(title, body, { whisperGM = false } = {}) {
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-shield-halved"></i> ${escHtml(title)}</div>` +
    `<div class="crns-chat-body">${escHtml(body)}</div></div>`;
  const msg = { user: game.user.id, content };
  if (whisperGM) msg.whisper = game.users.filter((u) => u.isGM).map((u) => u.id);
  return ChatMessage.create(msg);
}

/** Post the "«name» takes N damage" chat card for a damaged target (any kind:
 *  ICE / demon / prog-BI / runner). Target naming is resolved by the caller so
 *  the card always names the RIGHT entity. */
function postDamageCard(name, amount) {
  return postChatCard(
    loc("CRNS.Chat.DamageTitle"),
    loc("CRNS.Chat.TookDamage", { name, n: Number(amount) || 0 }),
  );
}

/** Post the "«name» destroyed/derezzed" chat card when a target's REZ hits 0. */
function postDestroyedCard(name) {
  return postChatCard(loc("CRNS.Chat.DestroyedTitle"), loc("CRNS.Chat.Destroyed", { name }));
}

/** Minimal HTML escape (data.js does not import esc from constants). */
function escHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** All backing actorIds of alive Black ICE on a floor (rez.value > 0). */
function aliveIceOnFloor(floor) {
  const out = [];
  for (const def of floor?.ice || []) {
    if (!def.actorId) continue;
    const actor = game.actors?.get(def.actorId);
    const rez = actor?.system?.stats?.rez?.value ?? 0;
    if (rez > 0) out.push({ def, actor });
  }
  return out;
}

/** Player-placed TRAP Black ICE sitting on a given floor of an arch, backed by a
 *  live actor (rez > 0). Player traps behave like architecture ICE toward OTHER
 *  runners (Addendum 2). Returns { progKey, ownerPid, programId, actorId, actor }. */
function aliveTrapProgsOnFloor(session, archId, floorIndex) {
  const out = [];
  const ps = session.progState || {};
  for (const [key, st] of Object.entries(ps)) {
    if (!st || st.mode !== "trap" || !st.actorId) continue;
    if (Number(st.floorIndex) !== Number(floorIndex)) continue;
    // key = "<ownerPid>|<programId>"; ownerPid may contain "|"? No — pids never
    // contain "|" (see runnerPid). Split on the LAST "|".
    const cut = key.lastIndexOf("|");
    if (cut < 0) continue;
    const ownerPid = key.slice(0, cut);
    const programId = key.slice(cut + 1);
    // The trap belongs to this arch only if its owner is connected to it.
    const owner = (session.participants || {})[ownerPid];
    if (!owner || owner.archId !== archId) continue;
    const actor = game.actors?.get(st.actorId);
    const rez = actor?.system?.stats?.rez?.value ?? 0;
    if (rez <= 0) continue;
    out.push({ progKey: key, ownerPid, programId, actorId: st.actorId, actor });
  }
  return out;
}

/** Trigger a Black ICE "attack of opportunity" SPEED test when a runner ENTERS a
 *  floor (Corebook p.205). For each alive Black ICE on the destination floor with
 *  no existing pending test for this pid+iceRef: register the test, bump the ICE
 *  to the top of the combat queue, and post an encounter chat card. Mutates
 *  `session` in place; returns true if it changed. GM-side only. */
async function triggerFloorIce(session, archId, pid) {
  const part = (session.participants || {})[pid];
  if (!part || part.kind !== "runner" || part.archId !== archId) return false;
  const arch = (getWorld("netArchs") || {})[archId];
  const floor = (arch?.floors || [])[part.floorIndex || 0];
  if (!floor) return false;

  session.pendingTests = session.pendingTests || [];
  session.attachments = session.attachments || [];
  session.slid = session.slid || [];
  let changed = false;
  let queuedAny = false;

  // Does the runner belong to a non-GM player? Only then do ICE auto-attach.
  const runnerUser = part.userId ? game.users.get(part.userId) : null;
  const playerRunner = !!part.userId && !!runnerUser && !runnerUser.isGM;

  const queuedActorIds = [];
  for (const { def, actor } of aliveIceOnFloor(floor)) {
    // Skip ICE ALREADY ATTACHED to THIS runner: the attack-of-opportunity happens
    // once, at first contact. Attached ICE move together with the runner (follow
    // logic), so without this every step would re-provoke them. Slid ICE and ICE
    // attached to OTHER runners are unaffected (they may legitimately trigger).
    const alreadyAttached = (session.attachments || [])
      .some((a) => a.archId === archId && a.iceId === def.id && a.pid === pid);
    if (alreadyAttached) continue;

    const ref = `ice:${archId}:${floor.id}:${def.id}`;
    const exists = session.pendingTests.some((t) => t.pid === pid && t.ref === ref);
    if (!exists) {
      session.pendingTests.push({
        id: uid("st"),
        pid,
        ref,
        iceActorId: def.actorId,
        iceName: actor?.name || def.type,
        ts: Date.now(),
      });
      changed = true;
      const queued = await moveToTopOfQueue(def.actorId);
      if (queued) { queuedAny = true; queuedActorIds.push(def.actorId); }
      postChatCard(actor?.name || def.type, loc("CRNS.Chat.IceReacts", { name: actor?.name || def.type }));
    }

    // Auto-attach the ICE to a player's runner (SPEC §14.11): follow enabled on
    // the actor (default true), not already slid past by this pid, and not
    // already attached to this pid.
    if (playerRunner) {
      const follow = actor?.getFlag?.(MODULE_ID, "follow");
      if (follow === false) continue;
      const isSlid = session.slid.some((s) => s.archId === archId && s.iceId === def.id && s.pid === pid);
      if (isSlid) continue;
      const already = session.attachments.some((a) => a.archId === archId && a.iceId === def.id && a.pid === pid);
      if (!already) {
        session.attachments.push({ archId, iceId: def.id, pid });
        changed = true;
      }
    }
  }

  // Player-placed TRAP Black ICE reacts to OTHER runners just like arch ICE
  // (Addendum 2). Skip a trap owned by the moving runner itself.
  for (const trap of aliveTrapProgsOnFloor(session, archId, part.floorIndex || 0)) {
    if (trap.ownerPid === pid) continue;
    const iceName = trap.actor?.name || loc("CRNS.Actions.KindIce");
    const ref = `prog:${trap.progKey.replace("|", ":")}`; // prog:<ownerPid>:<programId>
    const alreadyAttachedProg = session.attachments
      .some((a) => a.archId === archId && a.progKey === trap.progKey && a.pid === pid);
    if (alreadyAttachedProg) continue;

    const exists = session.pendingTests.some((t) => t.pid === pid && t.ref === ref);
    if (!exists) {
      session.pendingTests.push({
        id: uid("st"), pid, ref,
        iceActorId: trap.actorId, iceName, ts: Date.now(),
      });
      changed = true;
      const queued = await moveToTopOfQueue(trap.actorId);
      if (queued) { queuedAny = true; queuedActorIds.push(trap.actorId); }
      postChatCard(iceName, loc("CRNS.Chat.IceReacts", { name: iceName }));
    }

    // Chase-on-trigger: the trap leaves "lying in wait" and CHASES the runner
    // that triggered it ("They do not move, unless chasing a target that
    // triggered them") — ANY runner, player or GM-run NPC alike.
    const isSlid = session.slid.some((s) => s.archId === archId && s.progKey === trap.progKey && s.pid === pid);
    if (isSlid) continue;
    session.attachments.push({ archId, progKey: trap.progKey, pid });
    changed = true;
  }

  // If tests were registered but there is no combat, whisper the GM a hint once.
  // (moveToTopOfQueue now auto-creates the combat, so this is a rare failure path.)
  if (changed && !queuedAny && !game.combat) {
    postChatCard(loc("CRNS.Chat.TurnQueue"), loc("CRNS.Chat.NoCombat"), { whisperGM: true });
  }

  // An encounter happened: bootstrap the combat around the encountering runner.
  if (queuedAny && game.combat) {
    await bootstrapRunnerCombat(part, queuedActorIds);
  }
  return changed;
}

/** Ensure a runner participant is a combatant of the active combat with a ROLLED
 *  initiative (1d10 + REF, public roll — the CPR tracker's own die crashes on
 *  tokenless combatants: cpr-combat.js destructures combatant.token). Then
 *  re-bump the just-queued ICE so their equal-top initiative is computed against
 *  the fresh runner roll (otherwise they'd display 0 in an empty queue), and
 *  start the combat so turn-based mechanics (NET-action resets) run. */
async function bootstrapRunnerCombat(part, requeueActorIds = []) {
  const combat = game.combat;
  if (!combat) return;
  try {
    const runnerActor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
    if (runnerActor) {
      let c = combat.combatants.find((x) => x.actorId === runnerActor.id);
      if (!c) {
        const created = await combat.createEmbeddedDocuments("Combatant", [{ actorId: runnerActor.id }]);
        c = created?.[0];
      }
      if (c && (c.initiative === null || c.initiative === undefined)) {
        const ref = Number(runnerActor.system?.stats?.ref?.value ?? 0);
        const roll = new Roll(`1d10 + ${ref}`);
        await roll.evaluate();
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: runnerActor }),
          flavor: loc("CRNS.Chat.Initiative"),
        });
        await combat.setInitiative(c.id, roll.total);
        // Re-bump the freshly queued ICE above the runner's rolled initiative.
        for (const aid of requeueActorIds) await moveToTopOfQueue(aid);
      }
    }
    if (!combat.started) await combat.startCombat();
  } catch (e) {
    console.error(`${MODULE_ID} | combat bootstrap`, e);
  }
}

/** Drop pending tests matching a predicate. Returns true if any were removed. */
function prunePendingTests(session, predicate) {
  const list = session.pendingTests;
  if (!Array.isArray(list) || !list.length) return false;
  const kept = list.filter((t) => !predicate(t));
  if (kept.length === list.length) return false;
  session.pendingTests = kept;
  return true;
}

/* ------------------------------------------------------------------ */
/* Phase B helpers (tree / arch reconciliation)                         */
/* ------------------------------------------------------------------ */

/** Node lookup in a flat tree array. */
function findNode(tree, nodeId) {
  return tree.find((n) => n.id === nodeId) ?? null;
}

/** All descendant node ids of a folder (excluding the folder itself). */
function descendantIds(tree, nodeId) {
  const out = [];
  const stack = tree.filter((n) => n.parentId === nodeId).map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    for (const c of tree.filter((n) => n.parentId === id)) stack.push(c.id);
  }
  return out;
}

/** Would reparenting nodeId under parentId create a cycle? */
function wouldCycle(tree, nodeId, parentId) {
  if (parentId === "") return false;
  if (parentId === nodeId) return true;
  let cur = findNode(tree, parentId);
  const seen = new Set();
  while (cur && cur.parentId) {
    if (cur.parentId === nodeId) return true;
    if (seen.has(cur.parentId)) break;
    seen.add(cur.parentId);
    cur = findNode(tree, cur.parentId);
  }
  return false;
}

/** Every actorId backing an ICE or Demon anywhere in an arch. */
function archActorIds(arch) {
  const ids = [];
  for (const floor of arch?.floors || []) {
    for (const i of floor.ice || []) if (i.actorId) ids.push(i.actorId);
    if (floor.demon?.actorId) ids.push(floor.demon.actorId);
  }
  return ids;
}

/** A fresh default floor. */
function defaultFloor() {
  return { id: uid("f"), kind: "password", label: "", dv: 6, description: "", ice: [], demon: null };
}

/** Validate arch caps (server-side). Returns an error key or null. */
function validateArchCaps(arch) {
  const floors = arch?.floors || [];
  if (!floors.length) return "CRNS.Errors.MinFloor";
  let demonCount = 0;
  for (const floor of floors) {
    const ice = floor.ice || [];
    if (ice.length > MAX_ICE_PER_FLOOR) return "CRNS.Errors.TooManyIce";
    for (const i of ice) if (!BLACK_ICE[i.type]) return "CRNS.Errors.UnknownIce";
    if (floor.demon) {
      if (!DEMONS[floor.demon.type]) return "CRNS.Errors.UnknownDemon";
      demonCount += 1;
    }
  }
  if (demonCount > maxDemons(floors.length)) return "CRNS.Errors.TooManyDemons";
  return null;
}

/** Disconnect (or drop) every participant currently in the given arch, pruning
 *  any pending SPEED tests belonging to those participants. Async: it deletes the
 *  backing prog-ICE actors (SPEC §14.12 / Task 1) of disconnected runners. */
async function disconnectArchParticipants(session, archId) {
  const parts = session.participants || {};
  const affected = new Set();
  const progActorIds = [];
  for (const [pid, p] of Object.entries(parts)) {
    if (p.archId !== archId) continue;
    affected.add(pid);
    if (p.kind === "spectator") delete parts[pid];
    else {
      p.archId = ""; p.floorIndex = 0; p.jackedIn = false; p.maxFloor = 0; p.visited = [];
      progActorIds.push(...progActorIdsForPid(session, pid));
      clearProgFloors(session, pid);
      clearProgState(session, pid);
      if (session.reveal && session.reveal[pid]) delete session.reveal[pid];
    }
  }
  if (progActorIds.length) await bridge.deleteEntityActors(progActorIds);
  if (affected.size) {
    prunePendingTests(session, (t) => affected.has(t.pid));
    pruneAttachments(session, (a) => affected.has(a.pid) || a.archId === archId);
  }
}

/** Delete every progFloors override belonging to a participant (called wherever
 *  that participant's rezzed mirror is cleared). Returns true if it changed. */
function clearProgFloors(session, pid) {
  const pf = session.progFloors;
  if (!pf) return false;
  let changed = false;
  const prefix = `${pid}|`;
  for (const key of Object.keys(pf)) {
    if (key.startsWith(prefix)) { delete pf[key]; changed = true; }
  }
  return changed;
}

/** Remove an arch from the open-tabs list, fixing activeTab. */
function closeArchTab(session, archId) {
  session.tabs = (session.tabs || []).filter((t) => t !== archId);
  if (session.activeTab === archId) session.activeTab = session.tabs[0] ?? "";
}

/** Reconcile actors for arch.update: create actors for new defs, delete removed
 *  ones, mutating `newArch` in place so defs carry their actorId. */
async function reconcileArchActors(oldArch, newArch) {
  const oldIds = new Set(archActorIds(oldArch));
  const keptIds = new Set();
  const archName = newArch.name;

  for (const floor of newArch.floors || []) {
    const ice = floor.ice || [];
    for (const def of ice) {
      if (def.actorId && game.actors?.get(def.actorId)) { keptIds.add(def.actorId); continue; }
      const actorId = await bridge.createIceActor(def.type, archName);
      def.actorId = actorId || "";
      if (actorId) keptIds.add(actorId);
    }
    if (floor.demon) {
      const def = floor.demon;
      if (def.actorId && game.actors?.get(def.actorId)) { keptIds.add(def.actorId); }
      else {
        const actorId = await bridge.createDemonActor(def.type, archName);
        def.actorId = actorId || "";
        if (actorId) keptIds.add(actorId);
      }
    }
  }
  const removed = [...oldIds].filter((id) => !keptIds.has(id));
  if (removed.length) await bridge.deleteEntityActors(removed);
}

/* OPS: op name -> async handler(payload, userId). Every handler re-validates
 * permissions on the GM side via `userId` — never trust the client.
 *
 * Phase A ships only the `ping` test op. Domain ops arrive in later phases:
 *   Phase B: tree.* / arch.* / tabs.*
 *   Phase C: session.* / ent.*
 *   Phase D: run.*
 */
const OPS = {
  /* ---- diagnostics ---- */
  async ping({ echo } = {}, userId) {
    return { pong: true, echo: echo ?? null, gm: requesterIsGM(userId) };
  },

  /* ---- tree ---- (Phase B) */

  async "tree.createFolder"({ parentId = "", name } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    tree.push({ id: uid("nd"), type: "folder", name: name || loc("CRNS.Tree.NewFolder"), parentId: parentId || "" });
    await setWorld("netTree", tree);
    return true;
  },

  async "tree.createArch"({ parentId = "", name } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archName = name || loc("CRNS.Tree.Untitled");
    const archId = uid("a");
    const archs = getWorld("netArchs") || {};
    archs[archId] = { id: archId, name: archName, floors: [defaultFloor()] };
    const tree = getWorld("netTree") || [];
    tree.push({ id: uid("nd"), type: "arch", name: archName, parentId: parentId || "", archId });
    await setWorld("netArchs", archs);
    await setWorld("netTree", tree);
    return { archId };
  },

  async "tree.rename"({ nodeId, name } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    const node = findNode(tree, nodeId);
    if (!node) return false;
    const newName = (name || "").trim();
    if (!newName) return false;
    node.name = newName;
    if (node.type === "arch" && node.archId) {
      const archs = getWorld("netArchs") || {};
      const arch = archs[node.archId];
      if (arch) {
        const oldName = arch.name;
        arch.name = newName;
        await setWorld("netArchs", archs);
        await bridge.renameEntityFolder(oldName, newName);
      }
    }
    await setWorld("netTree", tree);
    return true;
  },

  async "tree.delete"({ nodeId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    let tree = getWorld("netTree") || [];
    const node = findNode(tree, nodeId);
    if (!node) return false;
    const toRemove = [nodeId, ...descendantIds(tree, nodeId)];
    const removeSet = new Set(toRemove);
    const archs = getWorld("netArchs") || {};
    let session = getWorld("session") || {};

    const removedArchIds = new Set();
    for (const id of toRemove) {
      const n = findNode(tree, id);
      if (n?.type === "arch" && n.archId && archs[n.archId]) {
        const arch = archs[n.archId];
        // Disconnect participants first so their backing prog-ICE actors are
        // deleted before the arch folder is removed (SPEC §14.12 / Task 1).
        await disconnectArchParticipants(session, n.archId);
        await bridge.deleteEntityActors(archActorIds(arch));
        await bridge.deleteEntityFolder(arch.name);
        closeArchTab(session, n.archId);
        removedArchIds.add(n.archId);
        delete archs[n.archId];
      }
    }
    // Prune session targets that referenced any deleted arch's ice/demon.
    for (const [uid_, ref] of Object.entries(session.targets || {})) {
      const [kind, refArchId] = (ref || "").split(":");
      if ((kind === "ice" || kind === "demon") && removedArchIds.has(refArchId)) {
        delete session.targets[uid_];
      }
    }
    // Prune pending SPEED tests whose ICE lived in a deleted arch.
    prunePendingTests(session, (t) => removedArchIds.has((t.ref || "").split(":")[1]));
    // Prune round-2 state referencing any deleted arch.
    pruneAttachments(session, (a) => removedArchIds.has(a.archId));
    session.slid = (session.slid || []).filter((s) => !removedArchIds.has(s.archId));
    if (session.floorState) {
      for (const key of Object.keys(session.floorState)) {
        if (removedArchIds.has(key.split(":")[0])) delete session.floorState[key];
      }
    }
    if (session.cloaks) {
      for (const aId of Object.keys(session.cloaks)) if (removedArchIds.has(aId)) delete session.cloaks[aId];
    }
    if (session.reveal) {
      for (const rp of Object.values(session.reveal)) {
        for (const aId of Object.keys(rp)) if (removedArchIds.has(aId)) delete rp[aId];
      }
    }
    tree = tree.filter((n) => !removeSet.has(n.id));

    await setWorld("netArchs", archs);
    await setWorld("session", session);
    await setWorld("netTree", tree);
    return true;
  },

  async "tree.toggle"({ nodeId, open } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const state = getWorld("treeState") || {};
    if (open) state[nodeId] = true; else delete state[nodeId];
    await setWorld("treeState", state);
    return true;
  },

  async "tree.move"({ nodeId, parentId = "" } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    const node = findNode(tree, nodeId);
    if (!node) return false;
    const target = parentId ? findNode(tree, parentId) : null;
    if (parentId && (!target || target.type !== "folder")) return false;
    if (wouldCycle(tree, nodeId, parentId)) return { error: "CRNS.Errors.Cycle" };
    node.parentId = parentId || "";
    await setWorld("netTree", tree);
    return true;
  },

  /* ---- arch ---- (Phase B) */

  async "arch.update"({ archId, arch } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archs = getWorld("netArchs") || {};
    const oldArch = archs[archId];
    if (!oldArch || !arch) return false;
    const capErr = validateArchCaps(arch);
    if (capErr) return { error: capErr };

    const newArch = foundry.utils.deepClone(arch);
    newArch.id = archId;
    if (!newArch.name) newArch.name = oldArch.name;
    // Repair the tree before it reaches storage: the editor already refuses to
    // offer a parent that would close a loop, but an imported file or a hand-
    // edited world has no such manners, and a cycle is an architecture with no
    // bottom — nothing to descend to and nowhere to leave a Virus.
    tree.normalizeFloors(newArch.floors || []);

    // If the arch was renamed via the editor, rename the actor folder too.
    if (newArch.name !== oldArch.name) await bridge.renameEntityFolder(oldArch.name, newArch.name);

    await reconcileArchActors(oldArch, newArch);

    archs[archId] = newArch;
    await setWorld("netArchs", archs);

    // Reconcile the live session against the new floor set: clamp participant
    // positions and drop stale ice:/demon: targets that no longer resolve.
    const session = getWorld("session") || {};
    const floors = newArch.floors || [];
    const floorById = new Set(floors.map((f) => f.id));
    let sessionChanged = false;

    for (const p of Object.values(session.participants || {})) {
      if (p.archId !== archId) continue;
      const clamped = Math.max(0, Math.min(floors.length - 1, Number(p.floorIndex) || 0));
      if (clamped !== p.floorIndex) { p.floorIndex = clamped; sessionChanged = true; }
    }

    for (const [uid_, ref] of Object.entries(session.targets || {})) {
      const [kind, refArchId, floorId, entId] = (ref || "").split(":");
      if ((kind !== "ice" && kind !== "demon") || refArchId !== archId) continue;
      // Verify the floor + entity + backing actor still exist in the new arch.
      let ok = floorById.has(floorId);
      if (ok) {
        const floor = floors.find((f) => f.id === floorId);
        const def = kind === "ice"
          ? (floor.ice || []).find((i) => i.id === entId)
          : (floor.demon && floor.demon.id === entId ? floor.demon : null);
        ok = !!def?.actorId;
      }
      if (!ok) { delete session.targets[uid_]; sessionChanged = true; }
    }

    // Drop pending SPEED tests whose ICE floor/def no longer exists in this arch.
    if (prunePendingTests(session, (t) => {
      const [, tArch, tFloor, tEnt] = (t.ref || "").split(":");
      if (tArch !== archId) return false;
      const floor = floors.find((f) => f.id === tFloor);
      const def = floor && (floor.ice || []).find((i) => i.id === tEnt && i.actorId);
      return !def;
    })) sessionChanged = true;

    // Prune round-2 state against the new floor/ice set.
    const liveIceIds = new Set();
    for (const f of floors) for (const i of f.ice || []) if (i.id) liveIceIds.add(i.id);
    if (pruneAttachments(session, (a) => a.archId === archId && !liveIceIds.has(a.iceId))) sessionChanged = true;
    const slidBefore = (session.slid || []).length;
    session.slid = (session.slid || []).filter((s) => s.archId !== archId || liveIceIds.has(s.iceId));
    if (session.slid.length !== slidBefore) sessionChanged = true;
    if (session.floorState) {
      for (const key of Object.keys(session.floorState)) {
        const [kArch, kFloor] = key.split(":");
        if (kArch === archId && !floorById.has(kFloor)) {
          delete session.floorState[key];
          sessionChanged = true;
        }
      }
    }

    if (sessionChanged) await setWorld("session", session);

    // Keep the tree node name in sync with an in-editor rename.
    const tree = getWorld("netTree") || [];
    const node = tree.find((n) => n.type === "arch" && n.archId === archId);
    if (node && node.name !== newArch.name) {
      node.name = newArch.name;
      await setWorld("netTree", tree);
    }
    return true;
  },

  async "arch.duplicate"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archs = getWorld("netArchs") || {};
    const src = archs[archId];
    if (!src) return false;
    const tree = getWorld("netTree") || [];
    const srcNode = tree.find((n) => n.type === "arch" && n.archId === archId);

    const newId = uid("a");
    const newName = `${src.name} ${loc("CRNS.Tree.CopySuffix")}`;
    const copy = { id: newId, name: newName, floors: [] };

    for (const floor of src.floors || []) {
      const nf = {
        id: uid("f"), kind: floor.kind, label: floor.label || "",
        dv: floor.dv, description: floor.description || "", ice: [], demon: null,
      };
      for (const i of floor.ice || []) {
        const actorId = i.actorId ? await bridge.duplicateEntityActor(i.actorId, newName) : "";
        nf.ice.push({ id: uid("i"), type: i.type, actorId: actorId || "" });
      }
      if (floor.demon) {
        const actorId = floor.demon.actorId ? await bridge.duplicateEntityActor(floor.demon.actorId, newName) : "";
        nf.demon = { id: uid("d"), type: floor.demon.type, actorId: actorId || "" };
      }
      copy.floors.push(nf);
    }

    archs[newId] = copy;
    tree.push({ id: uid("nd"), type: "arch", name: newName, parentId: srcNode?.parentId ?? "", archId: newId });
    await setWorld("netArchs", archs);
    await setWorld("netTree", tree);
    return { archId: newId };
  },

  async "arch.import"({ parentId = "", arch } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    if (!arch || !Array.isArray(arch.floors)) return { error: "CRNS.Errors.BadImport" };

    const newId = uid("a");
    const newName = (typeof arch.name === "string" && arch.name.trim()) || loc("CRNS.Tree.Untitled");
    const clean = { id: newId, name: newName, floors: [] };

    for (const floor of arch.floors) {
      const kind = FLOOR_KINDS_SET.has(floor?.kind) ? floor.kind : "custom";
      const nf = {
        id: uid("f"), kind, label: typeof floor?.label === "string" ? floor.label : "",
        dv: Number.isFinite(Number(floor?.dv)) ? Number(floor.dv) : 0,
        description: typeof floor?.description === "string" ? floor.description : "",
        ice: [], demon: null,
      };
      const srcIce = Array.isArray(floor?.ice) ? floor.ice.slice(0, MAX_ICE_PER_FLOOR) : [];
      for (const i of srcIce) {
        if (!BLACK_ICE[i?.type]) continue;
        const actorId = await bridge.createIceActor(i.type, newName);
        if (actorId && i.actorData) await bridge.applyActorOverrides(actorId, i.actorData);
        nf.ice.push({ id: uid("i"), type: i.type, actorId: actorId || "" });
      }
      if (floor?.demon && DEMONS[floor.demon.type]) {
        const actorId = await bridge.createDemonActor(floor.demon.type, newName);
        if (actorId && floor.demon.actorData) await bridge.applyActorOverrides(actorId, floor.demon.actorData);
        nf.demon = { id: uid("d"), type: floor.demon.type, actorId: actorId || "" };
      }
      clean.floors.push(nf);
    }
    if (!clean.floors.length) clean.floors.push(defaultFloor());

    const capErr = validateArchCaps(clean);
    if (capErr) { await bridge.deleteEntityActors(archActorIds(clean)); return { error: capErr }; }

    const archs = getWorld("netArchs") || {};
    const tree = getWorld("netTree") || [];
    archs[newId] = clean;
    tree.push({ id: uid("nd"), type: "arch", name: newName, parentId: parentId || "", archId: newId });
    await setWorld("netArchs", archs);
    await setWorld("netTree", tree);
    return { archId: newId };
  },

  /* ---- tabs ---- (Phase B) */

  async "tabs.open"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archs = getWorld("netArchs") || {};
    if (!archs[archId]) return false;
    const session = getWorld("session") || {};
    session.tabs = session.tabs || [];
    if (!session.tabs.includes(archId)) session.tabs.push(archId);
    session.activeTab = archId;
    await setWorld("session", session);
    return true;
  },

  async "tabs.close"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const session = getWorld("session") || {};
    await disconnectArchParticipants(session, archId);
    closeArchTab(session, archId);
    await setWorld("session", session);
    return true;
  },

  async "tabs.activate"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const session = getWorld("session") || {};
    session.tabs = session.tabs || [];
    if (!session.tabs.includes(archId)) return false;
    session.activeTab = archId;
    await setWorld("session", session);
    return true;
  },

  /* ---- session ---- (Phase C) */

  async "session.connect"({ pid, actorUuid, userId = "", archId = "" } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    session.participants = session.participants || {};

    // Resolve the actor to recompute the NET-action maximum from Interface rank.
    const actor = actorUuid ? (fromUuidSync?.(actorUuid) ?? null) : null;
    const max = actor ? bridge.netActionsMax(bridge.getInterfaceRank(actor)) : 2;

    const prev = session.participants[pid] || {};
    const connecting = !!archId; // archId "" → roster only (not jacked in).
    const part = {
      kind: "runner",
      userId: userId || prev.userId || "",
      actorUuid: actorUuid || prev.actorUuid || "",
      archId: archId || "",
      floorIndex: connecting ? 0 : (prev.floorIndex || 0),
      jackedIn: connecting,
      // On connect, actions reset to max minus 1 (Jack In costs 1 action).
      actions: connecting ? { value: Math.max(0, max - 1), max } : (prev.actions || { value: max, max }),
      rezzed: prev.rezzed || {},
      // Fog-of-war baseline: deepest floor visited (reset to 0 on a fresh connect).
      maxFloor: connecting ? 0 : (prev.maxFloor || 0),
      // Jacking in fresh forgets the map: leaving an architecture resets its
      // defences, so the runner starts blind again (Corebook p. 199).
      visited: connecting ? [] : (Array.isArray(prev.visited) ? prev.visited : []),
    };
    session.participants[pid] = part;
    // Connecting places the runner on floor 0 — provoke any Black ICE there.
    if (connecting) await triggerFloorIce(session, archId, pid);
    await setWorld("session", session);
    return true;
  },

  async "session.spectate"({ userId, archId = "" } = {}, callerId) {
    const session = getWorld("session") || {};
    session.participants = session.participants || {};

    const isGM = requesterIsGM(callerId);
    const self = callerId === userId;

    // Self-service spectating is gated by settings.
    if (!isGM) {
      if (!self) return false;
      let allow = false, freeMove = false;
      try { allow = !!game.settings.get(MODULE_ID, "allowSpectators"); } catch (e) { /* noop */ }
      try { freeMove = !!game.settings.get(MODULE_ID, "spectatorFreeMove"); } catch (e) { /* noop */ }
      if (!allow) return false;
      const pidSelf = `user:${userId}`;
      const cur = session.participants[pidSelf];
      const curArch = cur?.archId || "";
      // May move freely, or may join/leave only from an unset arch.
      if (!freeMove && curArch !== "") return false;
      // Target arch must currently hold at least one runner (self-service only).
      if (archId) {
        const hasRunner = Object.values(session.participants)
          .some((p) => p.kind === "runner" && p.archId === archId);
        if (!hasRunner) return false;
      }
    }

    const pid = `user:${userId}`;
    session.participants[pid] = {
      kind: "spectator",
      userId,
      actorUuid: "",
      archId: archId || "",
      floorIndex: 0,
      jackedIn: false,
    };
    await setWorld("session", session);
    return true;
  },

  async "session.disconnect"({ pid } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part) return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    if (part.kind === "spectator") delete parts[pid];
    else {
      part.archId = ""; part.floorIndex = 0; part.jackedIn = false; part.maxFloor = 0; part.visited = [];
      await deleteProgActors(session, pid); // delete backing prog-ICE actors first.
      clearProgFloors(session, pid);
      clearProgState(session, pid);
      prunePendingTests(session, (t) => t.pid === pid);
      // Drop this runner's ICE attachments (SPEC §14.11).
      pruneAttachments(session, (a) => a.pid === pid);
      // Drop its pathfinder reveal.
      if (session.reveal && session.reveal[pid]) delete session.reveal[pid];
    }
    await setWorld("session", session);
    return true;
  },

  async "session.move"({ pid, floorIndex } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner" || !part.archId) return false;

    const isGM = requesterIsGM(callerId);
    if (!isGM && !ownsParticipant(part, callerId)) return false;

    const archs = getWorld("netArchs") || {};
    const floors = floorsOf(archs, part.archId);
    if (!floors.length) return false;

    const from = Math.max(0, Math.min(floors.length - 1, Number(part.floorIndex) || 0));
    const dest = Math.max(0, Math.min(floors.length - 1, Number(floorIndex) || 0));

    // Movement gating for non-GM movers (SPEC §14.7), rewritten for the tree:
    // one step along a real edge, and never downward off an un-breached
    // password. Upstream expressed both as arithmetic on the index, which stops
    // meaning anything once an architecture forks.
    if (!isGM && dest !== from) {
      const reachable = reachableFrom(session, part.archId, floors, from);
      if (!reachable.includes(dest)) {
        const blocked = isBlockingPasswordFloor(session, part.archId, floors[from])
          && tree.childrenOf(floors, from).includes(dest);
        return { error: blocked ? "CRNS.Errors.PasswordBlocked" : "CRNS.Errors.MoveStep" };
      }
    }

    part.floorIndex = dest;
    // Fog-of-war baseline: which floors this runner has actually stood on.
    markVisited(part, floors[dest]?.id);
    part.maxFloor = Math.max(Number(part.maxFloor) || 0, dest);

    // Attached ICE follow the runner to the new floor (SPEC §14.11). Runtime
    // follows ignore the 3-per-floor editor cap. Two attachment shapes:
    //   {iceId}  → arch ICE def, moved between floors (rewrites targets)
    //   {progKey} → a player TRAP BI chasing the runner it caught (Addendum 2):
    //               just update its stored floorIndex (mode stays "trap").
    let archsChanged = false;
    for (const att of session.attachments || []) {
      if (att.pid !== pid || att.archId !== part.archId) continue;
      if (att.progKey) {
        const st = (session.progState || {})[att.progKey];
        if (st && Number(st.floorIndex) !== dest) st.floorIndex = dest;
      } else if (att.iceId) {
        if (moveIceDefToFloor(session, archs, part.archId, att.iceId, dest)) archsChanged = true;
      }
    }
    if (archsChanged) await setWorld("netArchs", archs);

    // A runner ENTERING a floor with alive Black ICE provokes a SPEED test.
    await triggerFloorIce(session, part.archId, pid);
    await setWorld("session", session);
    return true;
  },

  async "session.setTarget"({ entityRef } = {}, callerId) {
    const session = getWorld("session") || {};
    session.targets = session.targets || {};
    // Any user currently in the session (runner/spectator) or the GM may target.
    const inSession = requesterIsGM(callerId)
      || Object.values(session.participants || {}).some((p) => ownsParticipant(p, callerId));
    if (!inSession) return false;

    const ref = validEntityRef(entityRef) ? entityRef : "";
    // Toggle: setting the current target again clears it.
    session.targets[callerId] = session.targets[callerId] === ref ? "" : ref;
    await setWorld("session", session);
    return true;
  },

  /* ---- ent ---- (Phase C) — operate on the backing blackIce/demon actors
   *   via bridge.damageEntity / actor.update on the GM side */

  async "ent.damage"({ actorId, amount } = {}, callerId) {
    const session = getWorld("session") || {};
    if (!requesterIsGM(callerId)) {
      // Non-GM: must own a participant AND their own stored target must be an
      // ice:/demon: ref resolving to exactly this actor.
      const inSession = Object.values(session.participants || {})
        .some((p) => ownsParticipant(p, callerId));
      if (!inSession) return false;
      const myTarget = (session.targets || {})[callerId] || "";
      if (refActorId(myTarget) !== actorId || !actorId) return { error: "CRNS.Errors.NotYourTarget" };
    }
    const dmg = clampDamage(amount);
    const ok = await bridge.damageEntity(actorId, dmg);
    if (!ok) return ok;
    // Chat: name the TARGET correctly (the damaged actor), then a distinct
    // "destroyed" card when its REZ hit 0.
    const targetActor = game.actors?.get(actorId);
    const targetName = targetActor?.name || "";
    postDamageCard(targetName, dmg);
    const rez = targetActor?.system?.stats?.rez?.value ?? 1;
    if (rez <= 0) {
      postDestroyedCard(targetName);
      // Derezzed ICE can no longer act: drop pending SPEED tests pointing at it
      // and any attachments it held.
      let changed = prunePendingTests(session, (t) => t.iceActorId === actorId);
      const iceIds = iceDefIdsForActor(actorId);
      if (iceIds.size && pruneAttachments(session, (a) => iceIds.has(a.iceId))) changed = true;
      if (changed) await setWorld("session", session);
    }
    return ok;
  },

  async "ent.setRez"({ actorId, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    return bridge.setEntityRez(actorId, value);
  },

  async "ent.restore"({ actorId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    return bridge.restoreEntity(actorId);
  },

  async "ent.reset"({ archId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const archs = getWorld("netArchs") || {};
    const arch = archs[archId];
    if (!arch) return false;
    for (const id of archActorIds(arch)) await bridge.restoreEntity(id);
    return true;
  },

  /** GM: move an entity actor (ICE or Demon) to the top of the combat turn queue.
   *  `demon` true posts the "demon activated" card; else the plain ICE card. */
  async "ent.toQueue"({ actorId, demon = false } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    const actor = game.actors?.get(actorId);
    const name = actor?.name || "";
    const queued = await moveToTopOfQueue(actorId);
    if (!queued) {
      postChatCard(loc("CRNS.Chat.TurnQueue"), loc("CRNS.Chat.NoCombat"), { whisperGM: true });
      return false;
    }
    if (demon) postChatCard(name, loc("CRNS.Chat.DemonActivated", { name }));
    else postChatCard(name, loc("CRNS.Chat.ToQueue", { name }));
    return true;
  },

  /** GM: move an ICE/Demon def from its current floor to another floor of the
   *  same arch. Validates target-floor capacity, then rewrites any session
   *  targets that referenced the entity's old floorId. */
  async "ent.move"({ archId, entId, toFloorIndex } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const archs = getWorld("netArchs") || {};
    const arch = archs[archId];
    if (!arch) return false;
    const floors = arch.floors || [];
    const toIndex = Number(toFloorIndex);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= floors.length) return false;
    const target = floors[toIndex];

    // Locate the def (ice array entry or the demon) in any source floor.
    let srcFloor = null, kind = "", def = null, iceIndex = -1;
    for (const floor of floors) {
      const idx = (floor.ice || []).findIndex((i) => i.id === entId);
      if (idx >= 0) { srcFloor = floor; kind = "ice"; def = floor.ice[idx]; iceIndex = idx; break; }
      if (floor.demon && floor.demon.id === entId) { srcFloor = floor; kind = "demon"; def = floor.demon; break; }
    }
    if (!srcFloor || !def) return false;
    if (srcFloor.id === target.id) return true; // already there — no-op.

    // Validate target capacity.
    if (kind === "ice") {
      if ((target.ice || []).length >= MAX_ICE_PER_FLOOR) return { error: "CRNS.Errors.FloorFull" };
    } else {
      if (target.demon) return { error: "CRNS.Errors.FloorFull" };
    }

    // Remove from source, push to target.
    if (kind === "ice") {
      srcFloor.ice.splice(iceIndex, 1);
      target.ice = target.ice || [];
      target.ice.push(def);
    } else {
      srcFloor.demon = null;
      target.demon = def;
    }
    await setWorld("netArchs", archs);

    // Rewrite session targets: <kind>:<archId>:<oldFloorId>:<entId> → new floorId.
    const session = getWorld("session") || {};
    let changed = false;
    for (const [uid_, ref] of Object.entries(session.targets || {})) {
      const [rKind, rArch, rFloor, rEnt] = (ref || "").split(":");
      if (rKind === kind && rArch === archId && rFloor === srcFloor.id && rEnt === entId) {
        session.targets[uid_] = `${kind}:${archId}:${target.id}:${entId}`;
        changed = true;
      }
    }
    if (changed) await setWorld("session", session);
    return true;
  },

  /* ---- runner roster (Phase C) ---- */

  async "runner.remove"({ pid } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    if (!parts[pid]) return false;
    // Delete the runner's backing prog-ICE actors before dropping it (Task 1).
    await deleteProgActors(session, pid);
    clearProgState(session, pid);
    // Drop attachments/pending tests where this pid is the chased/attacked runner
    // (a player BI chasing them, or an arch-ICE follow) — Addendum 2/5.
    pruneAttachments(session, (a) => a.pid === pid);
    prunePendingTests(session, (t) => t.pid === pid);
    delete parts[pid];
    await setWorld("session", session);
    return true;
  },

  /* ---- run ---- (Phase D) */

  /** Jack In/Out toggle from the UI. Costs 1 action. Jack-out clears the
   *  rezzed mirror (the GM decides actual disconnection). */
  async "run.jack"({ pid, in: jackIn } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const actions = part.actions || { value: 0, max: 0 };
    if ((actions.value || 0) < 1) return { error: "CRNS.Errors.NoActions" };
    actions.value = Math.max(0, (actions.value || 0) - 1);
    part.actions = actions;
    part.jackedIn = !!jackIn;
    if (!jackIn) {
      part.rezzed = {}; // Clear the rezzed mirror on jack-out.
      await deleteProgActors(session, pid); // delete backing prog-ICE actors first.
      clearProgFloors(session, pid); // …and any floor overrides for it.
      clearProgState(session, pid);  // …and any trap/deployed BI state (§14.12).
      pruneAttachments(session, (a) => a.pid === pid); // …and ICE attachments.
      if (session.reveal && session.reveal[pid]) delete session.reveal[pid];
    }
    await setWorld("session", session);
    return true;
  },

  /** Spend NET actions (clamped at 0). */
  async "run.spend"({ pid, n = 1 } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const actions = part.actions || { value: 0, max: 0 };
    actions.value = Math.max(0, (actions.value || 0) - (Number(n) || 0));
    part.actions = actions;
    await setWorld("session", session);
    return true;
  },

  /* Give back NET actions (pip click-to-restore), clamped to max. */
  async "run.give"({ pid, n = 1 } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const actions = part.actions || { value: 0, max: 0 };
    const max = actions.max || participantActionMax(part);
    actions.value = Math.min(max, (actions.value || 0) + (Number(n) || 0));
    part.actions = actions;
    await setWorld("session", session);
    return true;
  },

  /** Reset one runner's NET actions to a freshly recomputed maximum. */
  async "run.reset"({ pid } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const max = participantActionMax(part);
    part.actions = { value: max, max };
    await setWorld("session", session);
    return true;
  },

  /** Reset every runner's NET actions (optionally only those in one arch). GM. */
  async "run.resetAll"({ archId = "" } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    for (const part of Object.values(parts)) {
      if (part.kind !== "runner") continue;
      if (archId && part.archId !== archId) continue;
      const max = participantActionMax(part);
      part.actions = { value: max, max };
    }
    await setWorld("session", session);
    return true;
  },

  /** Clear a resolved SPEED test. GM, or the owner of the test's runner pid. */
  async "run.clearSpeedTest"({ testId } = {}, callerId) {
    const session = getWorld("session") || {};
    const list = session.pendingTests || [];
    const test = list.find((t) => t.id === testId);
    if (!test) return true; // already gone — idempotent.
    if (!requesterIsGM(callerId)) {
      const part = (session.participants || {})[test.pid];
      if (!ownsParticipant(part, callerId)) return false;
    }
    if (prunePendingTests(session, (t) => t.id === testId)) {
      await setWorld("session", session);
    }
    return true;
  },

  /** Maintain the per-runner rezzed Black-ICE mirror (null deletes the entry). */
  async "run.setRezzed"({ pid, programId, state = null } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;
    if (!programId) return false;

    part.rezzed = part.rezzed || {};
    if (state === null || state === undefined) {
      delete part.rezzed[programId];
      // A derezzed program can no longer have a floor override or prog state.
      // Delete its backing prog-ICE actor first (SPEC §14.12 / Task 1) — derez
      // restores REZ per module rule, so nothing mirrors back to the item.
      const progKey = `${pid}|${programId}`;
      const derezActorId = (session.progState || {})[progKey]?.actorId || "";
      await deleteProgActors(session, pid, programId);
      if (session.progFloors) delete session.progFloors[progKey];
      if (session.progState) delete session.progState[progKey];
      // Drop the reactions this BI provoked (pendingTests / attachments / slid).
      pruneProgBiSideEffects(session, derezActorId, progKey);
    } else {
      part.rezzed[programId] = state;
    }
    await setWorld("session", session);
    return true;
  },

  /** GM: place a runner's rezzed Black-ICE program on a specific floor
   *  (progFloors override). `floorIndex` null deletes the override. */
  async "run.progFloor"({ pid, programId, floorIndex = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!pid || !programId) return false;
    const session = getWorld("session") || {};
    session.progFloors = session.progFloors || {};
    const key = `${pid}|${programId}`;
    if (floorIndex === null || floorIndex === undefined) delete session.progFloors[key];
    else session.progFloors[key] = Number(floorIndex);
    await setWorld("session", session);
    return true;
  },

  /** Apply damage to a runner's rezzed program item (prog: target). */
  async "run.progDamage"({ pid, programId, amount } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner" || !part.actorUuid) return false;
    if (!requesterIsGM(callerId)) {
      // Non-GM: must own a participant AND their own stored target must be
      // exactly this rezzed program.
      const inSession = Object.values(parts).some((p) => ownsParticipant(p, callerId));
      if (!inSession) return false;
      const myTarget = (session.targets || {})[callerId] || "";
      if (myTarget !== `prog:${pid}:${programId}`) return { error: "CRNS.Errors.NotYourTarget" };
    }
    const dmg = clampDamage(amount);
    // While rezzed with a backing actor (SPEC §14.12 / Task 1) the ACTOR is the
    // source of truth for REZ — damage it instead of the program item.
    const ps = (session.progState || {})[`${pid}|${programId}`] || null;
    if (ps?.actorId && game.actors?.get(ps.actorId)) {
      const progActor = game.actors.get(ps.actorId);
      const name = progActor?.name || "";
      const ok = await bridge.damageEntity(ps.actorId, dmg);
      if (!ok) return ok;
      postDamageCard(name, dmg);
      // Destroyed (REZ ≤ 0) → auto-derez GM-side + a distinct destroyed card.
      const rez = game.actors?.get(ps.actorId)?.system?.stats?.rez?.value ?? 1;
      if (rez <= 0) {
        postDestroyedCard(name);
        await autoDerezDestroyedProg(session, pid, programId);
        await setWorld("session", session);
      }
      return ok;
    }
    // Item-backed program BI (no backing actor): damage the program item; on
    // REZ ≤ 0 auto-derez it too (the item is the source of truth here).
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    if (!actor) return false;
    const name = actor.getOwnedItem?.(programId)?.name || actor.name || "";
    const ok = await bridge.applyProgramDamage(actor, programId, dmg);
    if (!ok) return ok;
    postDamageCard(name, dmg);
    const itemRez = actor.getOwnedItem?.(programId)?.system?.rez?.value ?? 1;
    if (itemRez <= 0) {
      postDestroyedCard(name);
      await autoDerezDestroyedProg(session, pid, programId);
      await setWorld("session", session);
    }
    return ok;
  },

  /** GM-only: apply "brain damage" straight to a targeted/selected netrunner's HP
   *  (CPR RED — NET damage goes to HP). Resolves the participant's backing actor
   *  and clamps GM-side (bridge.damageRunnerHp). Task 1. */
  async "runner.damage"({ pid, amount } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const part = (session.participants || {})[pid];
    if (!part || part.kind !== "runner" || !part.actorUuid) return false;
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    if (!actor) return false;
    const dmg = clampDamage(amount);
    const ok = await bridge.damageRunnerHp(actor.id, dmg);
    if (ok) postDamageCard(actor.name, dmg);
    return ok;
  },

  /* ---- Round-2: interface-ability results (SPEC §14.7) ---- */

  /** Resolve an interface-ability roll's effect on the floor state. The DV is
   *  never revealed in the (public) chat card — only a neutral verdict.
   *  owner-or-GM for the acting pid. Returns { ok, applied }. */
  async "run.abilityResult"({ pid, ability, total, extra } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return { ok: false, applied: false };
    const { part } = acting;
    const archs = getWorld("netArchs") || {};
    const arch = archs[part.archId];
    const floors = arch?.floors || [];
    const floor = floors[part.floorIndex || 0];
    if (!floor) return { ok: false, applied: false };

    const t = Number(total) || 0;

    /* A floor may name the ability that opens it (`floor.check`) instead of
     * relying on its kind. When the runner rolls THAT ability on THIS floor and
     * beats the DV, the floor is passed — which is what unlocks a gate.
     *
     * Reveal and stealth are deliberately excluded: Pathfinder tells you what is
     * there and Cloak hides you, neither of them opens anything, so letting them
     * satisfy a gate would hand the runner a free pass. */
    const OPENS = !["pathfinder", "cloak"].includes(ability);
    if (OPENS && floor && floor.check === ability && t > (Number(floor.dv) || 0)) {
      const fx = getFloorFx(session, part.archId, floor.id);
      if (!fx.breached) {
        fx.breached = true;
        applied = true;
      }
    }
    const name = fromUuidSync?.(part.actorUuid)?.name || "";
    let applied = false;

    switch (ability) {
      case "backdoor": {
        const fx = getFloorFx(session, part.archId, floor.id);
        if (floor.kind === "password" && !fx.breached && t > (Number(floor.dv) || 0)) {
          fx.breached = true;
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Backdoor"),
          loc(applied ? "CRNS.Chat.Breached" : "CRNS.Chat.NotBreached", { name }));
        break;
      }
      case "cloak": {
        // Arch-level cloaks (Addendum 6). If the roller already has marker(s) and
        // the new total beats their LOWEST-dv marker → replace that dv (keep its
        // number); else append a new sequentially-numbered marker.
        const list = archCloaks(session, part.archId);
        const mine = list.filter((c) => c.pid === pid);
        let lowest = null;
        for (const c of mine) if (!lowest || (Number(c.dv) || 0) < (Number(lowest.dv) || 0)) lowest = c;
        if (lowest && t > (Number(lowest.dv) || 0)) {
          lowest.dv = t;
        } else {
          const nextN = list.reduce((m, c) => Math.max(m, Number(c.n) || 0), 0) + 1;
          list.push({ id: uid("ck"), n: nextN, pid, dv: t });
        }
        applied = true;
        postChatCard(loc("CRNS.Chat.Cloak"), loc("CRNS.Chat.Cloaked", { name }));
        break;
      }
      case "control": {
        const fx = getFloorFx(session, part.archId, floor.id);
        const contestDv = fx.control?.dv ?? (Number(floor.dv) || 0);
        if (floor.kind === "controlnode" && fx.control?.pid !== pid && t > contestDv) {
          fx.control = { pid, dv: t };
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Control"),
          loc(applied ? "CRNS.Chat.Controlled" : "CRNS.Chat.ControlFailed", { name }));
        break;
      }
      case "eyedee": {
        const fx = getFloorFx(session, part.archId, floor.id);
        if (floor.kind === "file" && !fx.eyedee.includes(pid) && t > (Number(floor.dv) || 0)) {
          fx.eyedee.push(pid);
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Eyedee"),
          loc(applied ? "CRNS.Chat.Accessed" : "CRNS.Chat.AccessFailed", { name }));
        break;
      }
      case "virus": {
        // Only at the bottom of a branch. On a tree there are several
        // bottoms — one per branch — and "last element of the array" stopped
        // meaning anything the moment architectures could fork.
        const isLast = tree.isLeaf(floors, part.floorIndex || 0);
        if (isLast) {
          const fx = getFloorFx(session, part.archId, floor.id);
          fx.viruses.push({ id: uid("fx"), pid });
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Virus"),
          loc(applied ? "CRNS.Chat.VirusPlanted" : "CRNS.Chat.VirusFailed", { name }));
        break;
      }
      case "pathfinder": {
        // (handled below — listed here only so the generic pass above cannot
        //  swallow it: Pathfinder reveals, it never unlocks.)
        // Walk every branch below the runner, each stopping on its own account:
        // one locked door does not blind the corridor beside it. The blocking
        // floor is itself revealed — the runner learns something is in the way,
        // not what lies past it.
        const start = part.floorIndex || 0;
        const blocks = (f) => {
          if (!f || f.kind !== "password") return false;
          const ffx = (session.floorState || {})[floorKey(part.archId, f.id)];
          if (ffx && ffx.breached) return false;
          return (Number(f.dv) || 0) > t;
        };
        const found = tree.revealFrom(floors, start, t, blocks)
          .map((i) => floors[i]?.id)
          .filter(Boolean);

        session.reveal = session.reveal || {};
        session.reveal[pid] = session.reveal[pid] || {};
        // Stored as ids for the same reason `visited` is: the GM may re-parent
        // floors between rolls, and a remembered index would drift onto
        // somebody else's floor.
        const already = session.reveal[pid][part.archId];
        const keep = Array.isArray(already) ? already : [];
        session.reveal[pid][part.archId] = [...new Set([...keep, ...found])];
        applied = found.length > 0;
        postChatCard(loc("CRNS.Chat.Pathfinder"), loc("CRNS.Chat.PathfinderDone", { name }));
        break;
      }
      default:
        return { ok: false, applied: false };
    }

    await setWorld("session", session);
    return { ok: true, applied };
  },

  /** Transient activation pulse on a controlled node (SPEC §14.7). owner of the
   *  controlling pid or GM. Spends nothing (UI spends); emits a notify for the
   *  highlight + posts a chat card. */
  async "run.nodePulse"({ archId, floorId } = {}, callerId) {
    const session = getWorld("session") || {};
    const fx = (session.floorState || {})[floorKey(archId, floorId)];
    const controllerPid = fx?.control?.pid || "";
    if (!controllerPid) return false;
    // Caller must be GM or own the controlling participant.
    if (!requesterIsGM(callerId)) {
      const part = (session.participants || {})[controllerPid];
      if (!ownsParticipant(part, callerId)) return false;
    }
    const arch = (getWorld("netArchs") || {})[archId];
    const floor = (arch?.floors || []).find((f) => f.id === floorId);
    const label = floor ? (floor.label || loc(`CRNS.Floor.${floor.kind}`)) : "";
    notifyClients({ kind: "nodePulse", archId, floorId });
    postChatCard(loc("CRNS.Chat.NodePulse"), loc("CRNS.Chat.NodePulseBody", { floor: label }));
    return true;
  },

  /** GM: clear the pathfinder reveal of a runner. */
  async "run.clearReveal"({ pid } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    if (session.reveal && session.reveal[pid]) {
      delete session.reveal[pid];
      await setWorld("session", session);
    }
    return true;
  },

  /** GM: clear one slid record. Matches arch ICE (archId+iceId) OR a player-BI
   *  entry (archId+progKey), optionally scoped to a pid (Addendum 2). */
  async "run.clearSlid"({ archId, iceId, progKey = null, pid = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const before = (session.slid || []).length;
    session.slid = (session.slid || []).filter((s) => {
      const idMatch = progKey ? s.progKey === progKey : s.iceId === iceId;
      return !(s.archId === archId && idMatch && (pid === null || s.pid === pid));
    });
    if (session.slid.length !== before) await setWorld("session", session);
    return true;
  },

  /** GM override of floor markers (SPEC §14.7). One flexible op:
   *   kind "cloak" + {id}          → remove that ARCH-level cloak (no floorId; Addendum 6)
   *   kind "virus" + {id}          → remove that marker
   *   kind "eyedee" + {pid}        → remove that pid from the access list
   *   kind "breach" + {value}      → set breached true/false
   *   kind "control" + {pid|null}  → set controller (pid) or clear (null) */
  async "fx.clear"({ archId, floorId, kind, id, pid, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};

    // Cloaks are arch-level: no floorId, keyed under session.cloaks[archId].
    if (kind === "cloak") {
      const list = archCloaks(session, archId);
      const n = list.length;
      session.cloaks[archId] = list.filter((c) => c.id !== id);
      if (session.cloaks[archId].length !== n) await setWorld("session", session);
      return true;
    }

    const fx = getFloorFx(session, archId, floorId);
    let changed = false;
    switch (kind) {
      case "virus":
        { const n = fx.viruses.length; fx.viruses = fx.viruses.filter((v) => v.id !== id); changed = fx.viruses.length !== n; }
        break;
      case "eyedee":
        { const n = fx.eyedee.length; fx.eyedee = fx.eyedee.filter((p) => p !== pid); changed = fx.eyedee.length !== n; }
        break;
      case "breach":
        { const nv = !!value; if (fx.breached !== nv) { fx.breached = nv; changed = true; } }
        break;
      case "control":
        if (pid === null || pid === undefined) {
          if (fx.control) { fx.control = null; changed = true; }
        } else {
          fx.control = { pid, dv: fx.control?.dv ?? 0 };
          changed = true;
        }
        break;
      default:
        return false;
    }
    if (changed) await setWorld("session", session);
    return true;
  },

  /* ---- Round-2: attachments / follow (SPEC §14.11) ---- */

  /** GM: set the per-ICE follow flag on the backing actor. */
  async "ice.setFollow"({ actorId, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    return bridge.setActorFlag(actorId, "follow", !!value);
  },

  /** GM: attach an ICE to a runner (pid) or detach it (pid null). */
  /* GM attach management: arch ICE (iceId) or a player's rezzed BI (progKey). */
  async "ice.attach"({ archId, iceId = "", progKey = "", pid = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!archId || (!iceId && !progKey)) return false;
    const session = getWorld("session") || {};
    session.attachments = session.attachments || [];
    const matches = (a) => a.archId === archId
      && (progKey ? a.progKey === progKey : a.iceId === iceId);
    if (pid === null || pid === undefined) {
      const before = session.attachments.length;
      session.attachments = session.attachments.filter((a) => !matches(a));
      if (session.attachments.length !== before) await setWorld("session", session);
      return true;
    }
    const already = session.attachments.some((a) => matches(a) && a.pid === pid);
    if (!already) {
      // One ICE follows one runner at a time — replace any prior attachment.
      session.attachments = session.attachments.filter((a) => !matches(a));
      session.attachments.push(progKey ? { archId, progKey, pid } : { archId, iceId, pid });
      // A manual GM attach overrides an earlier slide-escape by that runner.
      session.slid = (session.slid || []).filter((s) => !(s.archId === archId
        && (progKey ? s.progKey === progKey : s.iceId === iceId) && s.pid === pid));
      await setWorld("session", session);
    }
    return true;
  },

  /** Record a successful slide: drop the ICE's attachment to this runner and add
   *  a slid record so it never re-attaches (until GM clears). GM only — called
   *  by the primary-GM slideTest notify consumer. Handles both arch ICE (iceId)
   *  and player-placed BI (progKey) targets (Addendum 2). */
  async "run.slideResolve"({ archId, iceId, progKey = null, pid } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!archId || !pid || (!iceId && !progKey)) return false;
    const session = getWorld("session") || {};
    session.slid = session.slid || [];
    if (progKey) {
      pruneAttachments(session, (a) => a.archId === archId && a.progKey === progKey && a.pid === pid);
      const exists = session.slid.some((s) => s.archId === archId && s.progKey === progKey && s.pid === pid);
      if (!exists) session.slid.push({ archId, progKey, pid });
    } else {
      pruneAttachments(session, (a) => a.archId === archId && a.iceId === iceId && a.pid === pid);
      const exists = session.slid.some((s) => s.archId === archId && s.iceId === iceId && s.pid === pid);
      if (!exists) session.slid.push({ archId, iceId, pid });
    }
    await setWorld("session", session);
    return true;
  },

  /* ---- Round-2: demon state (SPEC §14.8) ---- */

  /** Seed a demon's NET-action counter lazily from DEMONS[type] and spend n.
   *  GM only (demons are GM-run). */
  async "demon.spend"({ actorId, n = 1 } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    const session = getWorld("session") || {};
    const state = ensureDemonState(session, actorId);
    if (!state) return false;
    state.value = Math.max(0, (state.value || 0) - (Number(n) || 0));
    await setWorld("session", session);
    return true;
  },

  /** Reset a demon's NET-action counter to its max. GM only. */
  async "demon.reset"({ actorId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    const session = getWorld("session") || {};
    const state = ensureDemonState(session, actorId);
    if (!state) return false;
    state.value = state.max;
    await setWorld("session", session);
    return true;
  },

  /* ---- Round-2: program state — trap vs deployed (SPEC §14.12) ---- */

  /** Deploy an own Black-ICE program in trap or deployed mode. owner-or-GM.
   *  Trap is allowed both in and out of combat and sits on the runner's current
   *  floor; deployed needs a valid target and sits on its stored floor. There is
   *  NO owner-escort/standby behavior — a deployed BI whose target later vanishes
   *  simply sits idle (a dangling targetRef is harmless; the line just won't draw). */
  async "run.progDeploy"({ pid, programId, mode, targetRef = "", floorIndex } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    if (!programId || (mode !== "trap" && mode !== "deployed")) return false;

    // Deployed mode requires a valid target; trap needs none.
    if (mode === "deployed" && !validEntityRef(targetRef)) return { error: "CRNS.Errors.NoTarget" };

    const part = acting.part;
    const fi = mode === "trap"
      ? (part.floorIndex || 0)
      : (Number.isInteger(Number(floorIndex)) ? Number(floorIndex) : (part.floorIndex || 0));

    // Create a real blackIce Actor to back the rezzed prog entity (SPEC §14.12 /
    // Task 1): while rezzed the ACTOR is the source of truth for REZ/stats. Read
    // the program snapshot GM-side from the owner's actor; reuse an existing
    // actor if this program was already deployed (re-deploy without re-create).
    const key = `${pid}|${programId}`;
    session.progState = session.progState || {};
    const prev = session.progState[key] || null;
    let actorId = prev?.actorId || "";
    if (!actorId || !game.actors?.get(actorId)) {
      const runnerActor = part.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
      const program = runnerActor?.getOwnedItem?.(programId) ?? null;
      const archName = (getWorld("netArchs") || {})[part.archId]?.name || loc("CRNS.Tree.Untitled");
      if (program) {
        actorId = await bridge.createProgIceActor({
          name: program.name,
          img: program.img,
          per: program.system?.per, spd: program.system?.spd,
          atk: program.system?.atk, def: program.system?.def,
          rez: program.system?.rez?.value, rezMax: program.system?.rez?.max,
          blackIceType: program.system?.blackIceType,
        }, archName) || "";
      }
    }

    session.progState[key] = {
      mode,
      targetRef: mode === "deployed" ? targetRef : "",
      floorIndex: fi,
      actorId,
    };

    // Deployed BI enters initiative like a regular ICE encounter (Addendum 4):
    // ALWAYS jump to the top of the queue on rez (auto-creates the combat), and
    // if the target is a RUNNER, provoke that runner's SPEED test via the normal
    // pendingTests flow. Non-runner targets (ice/demon/prog) just queue + react.
    if (mode === "deployed" && actorId) {
      const iceActor = game.actors?.get(actorId);
      const iceName = iceActor?.name || loc("CRNS.Actions.KindIce");
      await moveToTopOfQueue(actorId);
      const ref = `prog:${key.replace("|", ":")}`; // prog:<ownerPid>:<programId>
      const [tKind] = (targetRef || "").split(":");
      if (tKind === "runner") {
        const targetPid = targetRef.slice("runner:".length);
        const targetPart = (session.participants || {})[targetPid];
        if (targetPart && targetPart.kind === "runner") {
          session.pendingTests = session.pendingTests || [];
          const exists = session.pendingTests.some((t) => t.pid === targetPid && t.ref === ref);
          if (!exists) {
            session.pendingTests.push({
              id: uid("st"), pid: targetPid, ref,
              iceActorId: actorId, iceName, ts: Date.now(),
            });
          }
          // Attach to the TARGET runner so the BI CHASES them between floors
          // (Addendum 5) — same prog-attachment shape as a triggered trap. Skip
          // if that runner already slid this BI; dedup otherwise. Ends on the
          // target's disconnect/jack-out (pruned by a.pid) or a successful slide.
          session.attachments = session.attachments || [];
          session.slid = session.slid || [];
          const slidBy = session.slid.some((s) => s.archId === part.archId && s.progKey === key && s.pid === targetPid);
          const attached = session.attachments.some((a) => a.archId === part.archId && a.progKey === key && a.pid === targetPid);
          if (!slidBy && !attached) {
            session.attachments.push({ archId: part.archId, progKey: key, pid: targetPid });
          }
          // Ensure the targeted runner sits in the combat with rolled initiative
          // (and re-bump this BI above it) — same bootstrap as floor encounters.
          await bootstrapRunnerCombat(targetPart, [actorId]);
        }
      }
      postChatCard(iceName, loc("CRNS.Chat.IceReacts", { name: iceName }));
    }

    await setWorld("session", session);
    return true;
  },
};

/** Whether an op handler is registered. Used to guard optional calls (e.g. the
 *  combat hooks trying to run run.reset before Phase D exists). */
export function hasOp(op) {
  return typeof OPS[op] === "function";
}

export async function applyOp(op, payload, userId) {
  const fn = OPS[op];
  if (!fn) {
    console.warn(`${MODULE_ID} | unknown op ${op}`);
    return false;
  }
  try {
    return await fn(payload, userId);
  } catch (e) {
    console.error(`${MODULE_ID} | op ${op} failed`, e);
    return false;
  }
}
