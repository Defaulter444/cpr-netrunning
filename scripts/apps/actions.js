/* Static 3-zone action bar (SPEC §14.4/14.5), entity action panels, roll
 * execution, damage application. Round-2 (G2).
 *
 * Every variant emits a fixed 3-zone view-model:
 *   zones.left   : selection panel (portrait / identity / pips-REZ / toggles) —
 *                  or an empty-state placeholder.
 *   zones.center : abilities + programs (runner) / entity buttons — internal scroll.
 *   zones.right  : the permanent TARGET panel (portrait, name, kind, REZ bar,
 *                  damage box, clear button) — or an empty-state placeholder.
 * All three zones are ALWAYS rendered so selecting/targeting never reflows the
 * viewport (the bar height is constant, see CSS).
 *
 * All state mutations go through mutate(); all rolls go through the bridge. The
 * last damage total this client rolled is stashed on app._lastDamage. */

import { MODULE_ID, loc, esc, BLACK_ICE, DEMONS, ENTITY_ICONS, abbrFor, blackIceTypeForName } from "../constants.js";
import * as archTree from "../rules/tree.js";
import * as archAbilities from "../rules/abilities.js";
import { getWorld, mutate, notifyClients, canDerezTrap } from "../data.js";
import * as bridge from "../cpr-bridge.js";

/* ------------------------------------------------------------------ */
/* Selection resolution                                                */
/* ------------------------------------------------------------------ */

/** Parse "prog:<pid>:<programId>" → { pid, programId } (programId = last segment). */
function parseProgRef(ref) {
  const rest = (ref || "").slice("prog:".length);
  const cut = rest.lastIndexOf(":");
  if (cut < 0) return { pid: rest, programId: "" };
  return { pid: rest.slice(0, cut), programId: rest.slice(cut + 1) };
}

/** Parse "ice:<archId>:<floorId>:<iceId>" → the def + backing actor, or null. */
function resolveIceRef(ref) {
  const [kind, archId, floorId, entId] = (ref || "").split(":");
  if (kind !== "ice" && kind !== "demon") return null;
  const archs = getWorld("netArchs") || {};
  const arch = archs[archId];
  const floor = (arch?.floors || []).find((f) => f.id === floorId);
  if (!floor) return null;
  let def = null;
  if (kind === "ice") def = (floor.ice || []).find((i) => i.id === entId) || null;
  else def = floor.demon && floor.demon.id === entId ? floor.demon : null;
  if (!def) return null;
  const actor = def.actorId ? game.actors?.get(def.actorId) : null;
  return { kind, archId, floorId, entId, def, actor };
}

/** Resolve a "runner:<pid>" selection to its participant + actor. */
function resolveRunnerRef(ref) {
  if (!(ref || "").startsWith("runner:")) return null;
  const pid = ref.slice("runner:".length); // pid must never contain ":" (see runnerPid)
  if (!pid) return null;
  const session = getWorld("session") || {};
  const part = (session.participants || {})[pid];
  if (!part || part.kind !== "runner") return null;
  const actor = part.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  return { pid, part, actor };
}

/** Class icon + label metadata for a cyberdeck program item. */
function programChrome(program) {
  const cls = program?.system?.class || "";
  if (cls === "booster") return { icon: "fa-arrow-trend-up", cls };
  if (cls === "defender") return { icon: "fa-shield-halved", cls };
  if (cls === "blackice") {
    // Try to match a known Black-ICE art by lowercased name.
    const key = (program?.name || "").toLowerCase();
    return { icon: "fa-skull", cls, iceKey: ENTITY_ICONS[key] ? key : "" };
  }
  // antipersonnelattacker / antiprogramattacker.
  return { icon: "fa-burst", cls };
}

const ATTACKER_CLASSES = new Set(["antipersonnelattacker", "antiprogramattacker"]);

/** Build the program-chip view-models for a runner deck. */
function programVMs(actor, part, session) {
  const deck = bridge.getDeck(actor);
  if (!deck) return [];
  const programs = bridge.installedPrograms(deck) || [];
  const rezzedMirror = part?.rezzed || {};
  const progState = session.progState || {};
  return programs.map((p) => {
    const chrome = programChrome(p);
    const rezzed = !!p.system?.isRezzed;
    const isAttacker = ATTACKER_CLASSES.has(chrome.cls);
    const isBlackIce = chrome.cls === "blackice";
    const isBooster = chrome.cls === "booster";
    const isDefender = chrome.cls === "defender";
    const rezMax = p.system?.rez?.max ?? 0;
    const rez = p.system?.rez?.value ?? 0;
    const atk = p.system?.atk ?? 0;
    const def = p.system?.def ?? 0;
    const ps = progState[`${part.pid}|${p.id}`] || null;
    const isDeployed = isBlackIce && ps?.mode === "deployed";
    // Class bucket for color coding + a localized class label (Task B).
    const classBucket = isBooster ? "booster" : isDefender ? "defender"
      : isBlackIce ? "blackice" : "attacker";
    return {
      id: p.id,
      name: p.name,
      code: abbrFor(p.name),
      icon: chrome.icon,
      cls: chrome.cls,
      classBucket,
      classLabel: `CRNS.ProgramClass.${classBucket}`,
      rezzed,
      derezzed: rezzed && rezMax > 0 && rez <= 0,
      isAttacker,
      isBlackIce,
      canRoll: rezzed && (isAttacker || isBlackIce),
      atk, def,
      // Stat badges: only show the ones the program actually carries.
      showAtk: atk > 0,
      showDef: def > 0,
      // DEF roll button: rezzed non-booster/non-defender only (Task B).
      showDefBtn: rezzed && !isBooster && !isDefender,
      rez, rezMax,
      rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
      hasDamage: !!(p.system?.damage?.blackIce || p.system?.damage?.standard),
      mirrored: !!rezzedMirror[p.id],
      // Deploy state (blackice only): "trap" | "deployed" | "".
      deployMode: isBlackIce ? (ps?.mode || "") : "",
      isDeployed,
      isTrap: isBlackIce && ps?.mode === "trap",
      // Auto-derez hint for attacker programs (they self-derez after a DMG roll).
      autoDerezHint: rezzed && isAttacker,
      // Tooltip: full name + class + REZ.
      tip: `${p.name} · ${chrome.cls}${rezMax > 0 ? ` · REZ ${rez}/${rezMax}` : ""}`,
    };
  });
}

/** Localized "kind" label for a target ref. */
function kindLabel(kind) {
  if (kind === "runner") return loc("CRNS.Actions.KindRunner");
  if (kind === "ice") return loc("CRNS.Actions.KindIce");
  if (kind === "demon") return loc("CRNS.Actions.KindDemon");
  if (kind === "prog") return loc("CRNS.Actions.KindProgram");
  return "";
}

/** Resolve the current target ref for a userId to a rich TARGET-panel view-model.
 *  Always returns an object (empty-state fields when there is no target). */
function targetPanel(session, userId, app) {
  const ref = (session.targets || {})[userId] || "";
  if (!ref) return { ref: "", name: "", kind: "", kindLabel: "", img: "", hasRez: false };
  const [kind] = ref.split(":");
  let name = loc("CRNS.Actions.UnknownTarget");
  let img = "";
  let rez = 0, rezMax = 0, hasRez = false;

  if (kind === "ice" || kind === "demon") {
    const r = resolveIceRef(ref);
    name = r?.actor?.name || r?.def?.type || name;
    img = r?.actor?.img || ENTITY_ICONS[r?.def?.type] || "icons/svg/mystery-man.svg";
    rezMax = r?.actor?.system?.stats?.rez?.max ?? 0;
    rez = r?.actor?.system?.stats?.rez?.value ?? 0;
    hasRez = rezMax > 0;
  } else if (kind === "runner") {
    const r = resolveRunnerRef(ref);
    name = r?.actor?.name || loc("CRNS.Runners.NPC");
    img = r?.actor?.img || "icons/svg/mystery-man.svg";
  } else if (kind === "prog") {
    const { pid, programId } = parseProgRef(ref);
    const r = resolveRunnerRef(`runner:${pid}`);
    const deck = r?.actor ? bridge.getDeck(r.actor) : null;
    const prog = deck ? (bridge.installedPrograms(deck) || []).find((p) => p.id === programId) : null;
    // While rezzed the backing prog-ICE actor is the source of truth for
    // name/img/REZ (SPEC §14.12 / Task 1); legacy prog entities fall back to item.
    const ps = (session.progState || {})[`${pid}|${programId}`] || null;
    const progActor = ps?.actorId ? (game.actors?.get(ps.actorId) ?? null) : null;
    name = progActor?.name || prog?.name || name;
    img = progActor?.img || r?.actor?.img || "icons/svg/mystery-man.svg";
    rezMax = progActor ? (progActor.system?.stats?.rez?.max ?? 0) : (prog?.system?.rez?.max ?? 0);
    rez = progActor ? (progActor.system?.stats?.rez?.value ?? 0) : (prog?.system?.rez?.value ?? 0);
    hasRez = rezMax > 0;
  }

  return {
    ref, name, kind, kindLabel: kindLabel(kind), img,
    rez, rezMax, hasRez,
    rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
    damageBox: buildDamageBox(app, session, { ref, name }),
  };
}

/** Whether a target ref points at a GM-controlled entity (for auto-roll). */
function targetIsGMControlled(ref) {
  const [kind] = (ref || "").split(":");
  if (kind === "ice" || kind === "demon") return true;
  if (kind === "runner") {
    const r = resolveRunnerRef(ref);
    return !!r && r.part.userId === "";
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* getData                                                             */
/* ------------------------------------------------------------------ */

export function getData(app) {
  const session = getWorld("session") || {};
  const selection = app.state.selection || "";
  const [selKind] = selection.split(":");
  const userId = game.user.id;

  // GM with an ice:/demon: selection → entity variant.
  if (game.user.isGM && (selKind === "ice" || selKind === "demon")) {
    return { actions: buildEntityVM(app, selection, session) };
  }
  // GM with a prog: selection (a player's rezzed Black ICE) → the same entity
  // panel, with the same attach management as arch ICE (enemy runners must be
  // able to be attached/detached and Slide away from it).
  if (game.user.isGM && selKind === "prog") {
    return { actions: buildProgEntityVM(app, selection, session) };
  }

  // A runner selection (own, or GM acting for any runner), or default runner.
  let runnerSel = null;
  if (selKind === "runner") runnerSel = resolveRunnerRef(selection);

  // Player default (no runner selection): fall back to my own runner participant.
  let me = app.myParticipant();
  if (!runnerSel && me?.kind === "runner") {
    runnerSel = { pid: me.pid, part: me, actor: me.actorUuid ? (fromUuidSync?.(me.actorUuid) ?? null) : null };
  }

  if (runnerSel && runnerSel.actor) {
    return { actions: buildRunnerVM(app, runnerSel, session) };
  }

  // Spectator / nothing actionable.
  const watching = me?.kind === "spectator";
  const target = targetPanel(session, userId, app);
  return {
    actions: {
      variant: "none",
      watching,
      hint: watching ? "CRNS.Actions.WatchingHint" : "CRNS.Actions.NoSelection",
      target,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ability availability (SPEC §14.7)                                   */
/* ------------------------------------------------------------------ */

/** Compute per-ability availability for the runner's current floor.
 *  Unavailable → `dim: true` (dimmed but still clickable). Returns a lookup by
 *  ability key; abilities not in the map are always available. */
function abilityAvailability(part, session, archs) {
  const arch = archs[part.archId];
  const floors = arch?.floors || [];
  const idx = part.floorIndex || 0;
  const floor = floors[idx] || null;
  const fx = floor ? (session.floorState || {})[`${part.archId}:${floor.id}`] : null;

  const targetRef = (session.targets || {})[game.user.id] || "";
  const [targetKind] = targetRef.split(":");

  // The rules themselves are in rules/abilities.js — pure, and tested there.
  return archAbilities.availabilityFor({
    floor,
    fx,
    pid: part.pid,
    isLeaf: archTree.isLeaf(floors, idx),
    targetKind,
    targetIsBlackIce: targetKind === "prog" && progRefIsBlackIce(session, targetRef),
  });
}

/** Whether a prog: target ref points at a blackice program (slideable). Reads the
 *  owner's deck; falls back false for a non-blackice/missing program. */
function progRefIsBlackIce(session, ref) {
  const { pid, programId } = parseProgRef(ref);
  const r = resolveRunnerRef(`runner:${pid}`);
  const deck = r?.actor ? bridge.getDeck(r.actor) : null;
  const prog = deck ? (bridge.installedPrograms(deck) || []).find((p) => p.id === programId) : null;
  return (prog?.system?.class || "") === "blackice";
}

/** Floors this runner currently controls (for the Control Node ability popover). */
function controlledNodes(part, session, archs) {
  const arch = archs[part.archId];
  const floors = arch?.floors || [];
  const out = [];
  for (let i = 0; i < floors.length; i += 1) {
    const f = floors[i];
    const fx = (session.floorState || {})[`${part.archId}:${f.id}`];
    if (fx?.control?.pid === part.pid) {
      out.push({
        floorId: f.id,
        index: i,
        number: i + 1,
        label: f.label || loc(`CRNS.Floor.${f.kind}`),
      });
    }
  }
  return out;
}

function buildRunnerVM(app, sel, session) {
  const { pid, part, actor } = sel;
  // Ensure the participant carries its own pid for downstream lookups.
  part.pid = part.pid || pid;
  const archs = getWorld("netArchs") || {};
  const rank = bridge.getInterfaceRank(actor);
  const actions = part.actions || { value: 0, max: bridge.netActionsMax(rank) };
  const maxVal = actions.max || bridge.netActionsMax(rank);
  const pips = [];
  for (let i = 0; i < maxVal; i++) pips.push({ filled: i < (actions.value || 0) });

  const avail = abilityAvailability(part, session, archs);
  const abilities = bridge.interfaceAbilities()
    // Scanner is a MEAT action: it hunts for an architecture's access points from
    // the room you are standing in, and inside one there is nothing for it to do
    // (Corebook p. 200). It sat in the strip only to be misclicked, spending a
    // NET action on nothing. `CHECK_ABILITIES` has excluded it all along; this
    // brings the runner's own strip in line with that.
    .filter((ab) => ab.key !== "scanner")
    .map((ab) => {
    const dim = (ab.key in avail) ? !avail[ab.key] : false;
    // What the ability does, plus — when it is dimmed — why it is not lit here.
    // Ten identical chips with one-word names told the player nothing about
    // which one to press, and nothing at all about why the one he wanted was
    // greyed out.
    const what = loc(`CRNS.Hints.Ability.${ab.key}`);
    const why = dim ? loc(`CRNS.Hints.Dim.${ab.key}`) : "";
    return { ...ab, dim, hint: why ? `${what}\n\n${why}` : what };
  });
  const nodes = controlledNodes(part, session, archs);
  const programs = programVMs(actor, part, session);
  const target = targetPanel(session, game.user.id, app);

  return {
    variant: "runner",
    pid,
    actorId: actor.id,
    archId: part.archId || "",
    floorIndex: part.floorIndex || 0,
    name: actor.name,
    img: actor.img || "icons/svg/mystery-man.svg",
    rank,
    jackedIn: !!part.jackedIn,
    actionsValue: actions.value || 0,
    actionsMax: maxVal,
    pips,
    noActions: (actions.value || 0) < 1,
    abilities,
    controlNodes: nodes,
    controlNodesJson: JSON.stringify(nodes),
    hasControl: nodes.length > 0,
    programs,
    speedTests: speedTestsFor(session, pid, actor),
    defenseTests: defenseTestsFor(app, pid, actor),
    target,
    combatActive: !!game.combat?.started,
    isGM: game.user.isGM,
    // GM-only left-zone control: apply brain damage (HP) to THIS runner directly,
    // independent of the target panel (Addendum). Not shown to players.
    gmDamage: game.user.isGM
      ? { pid, name: actor.name, amount: Math.max(0, Number(app._lastDamage) || 0) }
      : null,
  };
}

/** Pending player defence prompts for this runner (SPEC Addendum 2). Only the
 *  owner sees them (they were filtered on receipt in main.js handleDefenseRequest). */
function defenseTestsFor(app, pid, actor) {
  const list = (app._pendingDefense || []).filter((d) => d.pid === pid);
  return list.map((d) => ({
    id: d.id,
    pid,
    actorId: actor.id,
    attackerName: d.attackerName,
    attackerTotal: d.attackerTotal,
  }));
}

/** Pending Black-ICE SPEED tests for this runner (Corebook p.205). */
function speedTestsFor(session, pid, actor) {
  const list = (session.pendingTests || []).filter((t) => t.pid === pid);
  const mine = game.user.isGM || Object.values(session.participants || {})
    .some((p) => p.userId === game.user.id);
  return list.map((t) => ({
    id: t.id,
    pid,
    actorId: actor.id,
    iceName: t.iceName,
    canDismiss: game.user.isGM || mine,
  }));
}

function buildEntityVM(app, ref, session) {
  const r = resolveIceRef(ref);
  if (!r || !r.actor) {
    return { variant: "none", hint: "CRNS.Actions.NoSelection", target: targetPanel(session, game.user.id, app) };
  }
  const { kind, archId, floorId, entId, def, actor } = r;
  const rezMax = actor.system?.stats?.rez?.max ?? 0;
  const rez = actor.system?.stats?.rez?.value ?? 0;
  const target = targetPanel(session, game.user.id, app);

  if (kind === "demon") {
    const table = DEMONS[def.type] || {};
    const state = (session.demonState || {})[actor.id] || null;
    const dMax = state?.max ?? (table.actions ?? actor.system?.stats?.actions ?? 0);
    const dVal = state?.value ?? dMax;
    const dpips = [];
    for (let i = 0; i < dMax; i++) dpips.push({ filled: i < dVal });
    return {
      variant: "entity",
      entityKind: "demon",
      actorId: actor.id,
      name: actor.name,
      img: actor.img || ENTITY_ICONS[def.type] || "",
      rez, rezMax,
      rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
      combatNumber: table.combatNumber ?? actor.system?.stats?.combatNumber ?? 0,
      demonPips: dpips,
      demonValue: dVal,
      demonMax: dMax,
      demonNoActions: dVal < 1,
      target,
    };
  }

  // ICE: follow flag (default true), attachment status.
  const followFlag = bridge.getActorFlag(actor.id, "follow");
  const following = followFlag !== false;
  const att = (session.attachments || []).find((a) => a.archId === archId && a.iceId === entId) || null;
  let attachedTo = "";
  if (att) {
    const rr = resolveRunnerRef(`runner:${att.pid}`);
    attachedTo = rr?.actor?.name || loc("CRNS.Runners.NPC");
  }
  // Runner participants on this arch → attach-to select.
  const attachChoices = [];
  for (const [rpid, p] of Object.entries(session.participants || {})) {
    if (p.kind !== "runner" || p.archId !== archId) continue;
    const rActor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
    attachChoices.push({ pid: rpid, name: rActor?.name || loc("CRNS.Runners.NPC"), selected: att?.pid === rpid });
  }

  const table = BLACK_ICE[def.type] || {};
  const hasDamage = !!table.damage;
  return {
    variant: "entity",
    entityKind: "ice",
    iceType: def.type,
    actorId: actor.id,
    archId, iceId: entId,
    name: actor.name,
    img: actor.img || ENTITY_ICONS[def.type] || "",
    rez, rezMax,
    rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
    hasDamage,
    damageFormula: table.damage || "",
    effectKey: table.effectKey ? `${table.effectKey}.effect` : "",
    showFollow: true,
    following,
    attachedTo,
    hasAttachment: !!att,
    attachChoices,
    progKey: "",
    target,
  };
}

/** GM entity panel for a player's rezzed Black ICE (prog: selection). Same
 *  shape as the arch-ICE entity VM (entityKind "ice"), but attachment management
 *  works on the prog-attachment shape (progKey) and there is no follow flag. */
function buildProgEntityVM(app, ref, session) {
  const { pid: ownerPid, programId } = parseProgRef(ref);
  const key = `${ownerPid}|${programId}`;
  const ps = (session.progState || {})[key] || null;
  const actor = ps?.actorId ? (game.actors?.get(ps.actorId) ?? null) : null;
  const target = targetPanel(session, game.user.id, app);
  if (!actor) {
    return { variant: "none", hint: "CRNS.Actions.NoSelection", target, damageBox: buildDamageBox(app, session, target) };
  }
  const owner = resolveRunnerRef(`runner:${ownerPid}`);
  const archId = owner?.part?.archId || "";
  const rezMax = actor.system?.stats?.rez?.max ?? 0;
  const rez = actor.system?.stats?.rez?.value ?? 0;
  const iceType = blackIceTypeForName(actor.name);
  const table = BLACK_ICE[iceType] || {};

  const att = (session.attachments || []).find((a) => a.archId === archId && a.progKey === key) || null;
  let attachedTo = "";
  if (att) {
    const rr = resolveRunnerRef(`runner:${att.pid}`);
    attachedTo = rr?.actor?.name || loc("CRNS.Runners.NPC");
  }
  // Attach-to choices: runners on the owner's arch, excluding the owner itself.
  const attachChoices = [];
  for (const [rpid, p] of Object.entries(session.participants || {})) {
    if (p.kind !== "runner" || p.archId !== archId || rpid === ownerPid) continue;
    const rActor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
    attachChoices.push({ pid: rpid, name: rActor?.name || loc("CRNS.Runners.NPC"), selected: att?.pid === rpid });
  }

  return {
    variant: "entity",
    entityKind: "ice",
    iceType,
    actorId: actor.id,
    archId,
    iceId: "",           // arch-ICE only; attach controls use progKey instead.
    progKey: key,
    name: actor.name,
    img: actor.img || ENTITY_ICONS[iceType] || "icons/svg/mystery-man.svg",
    rez, rezMax,
    rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
    hasDamage: !!table.damage,
    damageFormula: table.damage || "",
    effectKey: table.effectKey ? `${table.effectKey}.effect` : "",
    showFollow: false,   // player BI has no follow flag — it chases by attachment.
    following: false,
    attachedTo,
    hasAttachment: !!att,
    attachChoices,
    ownerName: owner?.actor?.name || loc("CRNS.Runners.NPC"),
    target,
  };
}

/** The compact "apply damage → target" box, shown when the current user has a
 *  target that resolves to a damageable entity (ice/demon/prog). */
function buildDamageBox(app, session, target) {
  const ref = target?.ref || "";
  const [kind] = ref.split(":");
  // Players may damage ice/demon/prog targets (op re-checks their own target).
  // The GM may ALSO damage runner targets (Task 1: apply damage straight to the
  // netrunner's HP) — the runner box is GM-only.
  if (kind === "runner") {
    if (!game.user.isGM) return null;
  } else if (kind !== "ice" && kind !== "demon" && kind !== "prog") {
    return null;
  }

  let allowed = game.user.isGM;
  if (!allowed) {
    // Player: allowed if they own a participant in the session (op re-checks).
    allowed = Object.values(session.participants || {})
      .some((p) => p.userId === game.user.id);
  }
  if (!allowed) return null;

  return {
    ref,
    name: target.name,
    amount: Math.max(0, Number(app._lastDamage) || 0),
  };
}

/* ------------------------------------------------------------------ */
/* Listeners                                                           */
/* ------------------------------------------------------------------ */

export function activateListeners(app, html) {
  /* ---- action-bar resize handle (Task A) ---- */
  wireBarResize(app, html);

  /* ---- runner variant ---- */

  // Jack In / Out.
  html.find('[data-action="run-jack"]').on("click", async (ev) => {
    const el = ev.currentTarget;
    const pid = el.dataset.pid;
    const jackIn = el.dataset.jackIn === "true";
    const res = await mutate("run.jack", { pid, in: jackIn });
    if (res && res.error) ui.notifications.warn(loc(res.error));
  });

  // NET-action pips: click a filled pip to spend 1, an empty pip to restore 1.
  html.find('[data-action="pip-toggle"]').on("click", (ev) => {
    ev.stopPropagation();
    const el = ev.currentTarget;
    const pid = el.closest(".crns-pips")?.dataset.pid;
    if (!pid) return;
    const filled = el.dataset.filled === "true";
    mutate(filled ? "run.spend" : "run.give", { pid, n: 1 });
  });

  // Reset own / reset all.
  html.find('[data-action="run-reset"]').on("click", (ev) => {
    mutate("run.reset", { pid: ev.currentTarget.dataset.pid });
  });
  html.find('[data-action="run-reset-all"]').on("click", () => {
    const session = getWorld("session") || {};
    mutate("run.resetAll", { archId: session.activeTab || "" });
  });

  // GM disconnect (from the runner bar) — confirm first.
  html.find('[data-action="run-disconnect"]').on("click", async (ev) => {
    const pid = ev.currentTarget.dataset.pid;
    if (!(await confirmDisconnect(pid))) return;
    mutate("session.disconnect", { pid });
  });

  // GM-only: damage the SELECTED runner's HP directly (Addendum). Independent of
  // the target-panel damage box.
  html.find('[data-action="runner-damage-self"]').on("click", (ev) => {
    const box = ev.currentTarget.closest(".crns-runner-dmg");
    const input = box?.querySelector('input[name="runnerdmg"]');
    const amount = Math.max(0, Number(input?.value) || 0);
    const pid = ev.currentTarget.dataset.pid;
    if (pid) mutate("runner.damage", { pid, amount });
  });

  // Clear my target (click the target readout / target-panel clear button).
  html.find('[data-action="clear-target"]').on("click", () => {
    const session = getWorld("session") || {};
    const ref = (session.targets || {})[game.user.id] || "";
    if (ref) mutate("session.setTarget", { entityRef: ref }); // toggles it off.
  });

  // Black ICE attack-of-opportunity SPEED test (free roll; no NET-action spend).
  // Passes the REAL event so the CPR roll-verify dialog appears (players add LUCK).
  html.find('[data-action="speed-test-roll"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const { testId, pid } = el.dataset;
    const actor = game.actors?.get(el.dataset.actorId);
    if (!actor) return;
    const roll = await bridge.rollInterface(actor, "speed", ev.originalEvent || ev);
    if (!roll) return; // cancelled — leave the test pending.
    notifyClients({
      kind: "speedTest",
      testId,
      pid,
      runnerTotal: Number(roll.resultTotal) || 0,
    });
    app.render(false);
  });

  // Player defence prompt (SPEC Addendum 2): roll defence with the STANDARD CPR
  // dialog (real event → LUCK available), then report the result back to the GM.
  html.find('[data-action="defense-roll"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const { testId, pid } = el.dataset;
    const actor = game.actors?.get(el.dataset.actorId);
    if (!actor) return;
    const roll = await bridge.rollInterface(actor, "defense", ev.originalEvent || ev);
    if (!roll) return; // cancelled — leave the prompt pending.
    const entry = (app._pendingDefense || []).find((d) => d.id === testId);
    notifyClients({
      kind: "defenseResult",
      pid,
      attackerName: entry?.attackerName || "",
      attackerTotal: entry?.attackerTotal || 0,
      defenseTotal: Number(roll.resultTotal) || 0,
      // Attacker program (Requirement 3): the GM derezzes it on a miss.
      attackerProg: entry?.attackerProg || null,
    });
    app._pendingDefense = (app._pendingDefense || []).filter((d) => d.id !== testId);
    app.render(false);
  });

  // Dismiss a pending defence prompt without rolling.
  html.find('[data-action="defense-dismiss"]').on("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const testId = ev.currentTarget.dataset.testId;
    app._pendingDefense = (app._pendingDefense || []).filter((d) => d.id !== testId);
    app.render(false);
  });

  // Dismiss a pending SPEED test without rolling (owner or GM).
  html.find('[data-action="speed-test-dismiss"]').on("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await mutate("run.clearSpeedTest", { testId: ev.currentTarget.dataset.testId });
  });

  // Interface ability roll (with availability gating + effect resolution).
  html.find('[data-action="ability-roll"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const pid = el.dataset.pid;
    const actorId = el.dataset.actorId;
    const ability = el.dataset.ability;
    const free = el.dataset.free === "true";
    const actor = game.actors?.get(actorId);
    if (!actor) return;

    const shift = !!ev.shiftKey;
    const spend = !free && !shift; // Defence/Speed are free; Shift skips the spend.

    if (spend) {
      const part = participantById(pid);
      if ((part?.actions?.value ?? 0) < 1) { ui.notifications.warn(loc("CRNS.Errors.NoActions")); return; }
      await mutate("run.spend", { pid, n: 1 });
    }
    const roll = await bridge.rollInterface(actor, ability, ev.originalEvent || ev);
    if (!roll) return;

    // Slide is an opposed roll vs the targeted ICE — arch ICE (ice:) or a
    // player-placed Black ICE (prog:, Addendum 2) → emit the slideTest notify.
    if (ability === "slide") {
      const session = getWorld("session") || {};
      const testRef = (session.targets || {})[game.user.id] || "";
      if (testRef.startsWith("ice:") || testRef.startsWith("prog:")) {
        notifyClients({ kind: "slideTest", testRef, pid, runnerTotal: Number(roll.resultTotal) || 0 });
      }
      return;
    }

    // Floor-effect abilities → resolve GM-side via run.abilityResult.
    if (["backdoor", "cloak", "control", "eyedee", "virus", "pathfinder"].includes(ability)) {
      const res = await mutate("run.abilityResult", { pid, ability, total: Number(roll.resultTotal) || 0 });
      if (res && res.error) ui.notifications.warn(loc(res.error));
      return;
    }

    // Attack abilities (zap) → auto-roll defence path.
    await maybeAutoRoll(app, roll, actor, ability, "interface");
  });

  // Control Node ability: spend 1 + pick a controlled node → nodePulse.
  html.find('[data-action="control-node"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const pid = el.dataset.pid;
    const archId = el.dataset.archId;
    const part = participantById(pid);
    if ((part?.actions?.value ?? 0) < 1) { ui.notifications.warn(loc("CRNS.Errors.NoActions")); return; }
    const floorId = await pickControlledNode(html, el);
    if (!floorId) return;
    await mutate("run.spend", { pid, n: 1 });
    const res = await mutate("run.nodePulse", { archId, floorId });
    if (res && res.error) ui.notifications.warn(loc(res.error));
  });

  // Let go of a node. Free — no action is spent.
  html.find('[data-action="control-release"]').on("click", async (ev) => {
    const el = ev.currentTarget;
    const archId = el.dataset.archId;
    const floorId = await pickControlledNode(html, el,
      loc("CRNS.Actions.ControlReleasePick"), { confirmSingle: true });
    if (!floorId) return;
    const res = await mutate("run.nodeRelease", { archId, floorId });
    if (res === false) ui.notifications.warn(loc("CRNS.Errors.NodeReleaseFailed"));
  });

  // Program: activate / deactivate.
  html.find('[data-action="program-activate"]').on("click", async (ev) => {
    const el = ev.currentTarget;
    const { pid, actorId, programId, cls } = el.dataset;
    const actor = game.actors?.get(actorId);
    if (!actor) return;
    const part = participantById(pid);
    if ((part?.actions?.value ?? 0) < 1) { ui.notifications.warn(loc("CRNS.Errors.NoActions")); return; }

    // Player Black-ICE deploy flow (SPEC §14.12): trap vs deployed.
    if (cls === "blackice") { await activateBlackIce(app, part, pid, actor, programId); return; }

    await mutate("run.spend", { pid, n: 1 });
    await bridge.rezProgram(actor, programId);
  });

  html.find('[data-action="program-deactivate"]').on("click", async (ev) => {
    const el = ev.currentTarget;
    const { pid, actorId, programId, cls } = el.dataset;
    const actor = game.actors?.get(actorId);
    if (!actor) return;
    const part = participantById(pid);
    if ((part?.actions?.value ?? 0) < 1) { ui.notifications.warn(loc("CRNS.Errors.NoActions")); return; }

    // Trap Black-ICE derez gating: owner must stand on the trap's floor.
    if (cls === "blackice") {
      const session = getWorld("session") || {};
      if (!canDerezTrap(session, pid, programId)) { ui.notifications.warn(loc("CRNS.Errors.TrapDerezFloor")); return; }
    }

    await mutate("run.spend", { pid, n: 1 });
    await bridge.derezProgram(actor, programId);
    if (cls === "blackice") await mutate("run.setRezzed", { pid, programId, state: null });
  });

  // Program rolls: atk / def / damage.
  html.find('[data-action="program-roll"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const { pid, actorId, programId, exec, isAttacker } = el.dataset;
    const actor = game.actors?.get(actorId);
    if (!actor) return;
    const roll = await bridge.rollProgram(actor, programId, exec, ev.originalEvent || ev);
    if (!roll) return;

    if (exec === "damage") {
      stashDamage(app, roll);
      // Attacker-class programs auto-deactivate after a damage roll (no cost).
      // Idempotent: derezProgram no-ops when the program is already derezzed
      // (e.g. a miss already derezzed it), so no double card / no error.
      if (isAttacker === "true") {
        const wasRezzed = !!actor.getOwnedItem?.(programId)?.system?.isRezzed;
        await bridge.derezProgram(actor, programId);
        if (wasRezzed) ui.notifications.info(loc("CRNS.Actions.AttackerDerez", { name: actor.name }));
      }
      app.render(false);
    }
    if (exec === "atk") {
      // Thread the attacker-program identity so a MISS auto-derezzes it without a
      // damage roll (Requirement 3). `pid`/`programId` from the button dataset.
      const attackerProg = { pid, programId, isAttacker: isAttacker === "true" };
      await maybeAutoRoll(app, roll, actor, "atk", "program", { attackerProg });
    }
  });

  /* ---- entity variant (GM) ---- */

  html.find('[data-action="entity-stat"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const actor = game.actors?.get(el.dataset.actorId);
    if (!actor) return;
    const roll = await bridge.rollEntityStat(actor, el.dataset.stat, ev.originalEvent || ev);
    // A GM ICE ATTACK against a targeted PLAYER runner triggers that player's
    // defence prompt (SPEC Addendum 2) — same rollRequest contract as demon Zap.
    if (roll && el.dataset.stat === "atk") {
      const session = getWorld("session") || {};
      const targetRef = (session.targets || {})[game.user.id] || "";
      if (targetRef.startsWith("runner:")) {
        notifyClients({
          kind: "rollRequest",
          targetRef,
          vs: "defense",
          attackerName: actor.name,
          total: Number(roll.resultTotal) || 0,
          archId: session.activeTab || "",
        });
      }
    }
  });

  html.find('[data-action="entity-damage"]').on("click", async (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const actor = game.actors?.get(el.dataset.actorId);
    if (!actor) return;
    const roll = await bridge.rollEntityDamage(actor, el.dataset.formula, ev.originalEvent || ev);
    if (roll) { stashDamage(app, roll); app.render(false); }
  });

  html.find('[data-action="entity-effect"]').on("click", (ev) => {
    const el = ev.currentTarget;
    postEffectCard(el.dataset.actorId, el.dataset.effectKey);
  });

  html.find('[data-action="demon-cn"]').on("click", async (ev) => {
    const el = ev.currentTarget;
    const actor = game.actors?.get(el.dataset.actorId);
    if (!actor) return;
    if (!(await spendDemonAction(el.dataset.actorId))) return;
    bridge.rollDemonStatic(actor, Number(el.dataset.cn) || 0);
  });

  html.find('[data-action="demon-action"]').on("click", async (ev) => {
    ev.preventDefault();
    const actor = game.actors?.get(ev.currentTarget.dataset.actorId);
    if (!actor) return;
    if (!(await spendDemonAction(ev.currentTarget.dataset.actorId))) return;
    await bridge.rollEntityStat(actor, "interface", ev.originalEvent || ev);
  });

  // Demon Zap (SPEC §14.8): attack roll 1d10+Interface posted as an attack; if a
  // runner is targeted, emit the rollRequest so the runner's defence auto-rolls.
  html.find('[data-action="demon-zap"]').on("click", async (ev) => {
    ev.preventDefault();
    const actorId = ev.currentTarget.dataset.actorId;
    const actor = game.actors?.get(actorId);
    if (!actor) return;
    if (!(await spendDemonAction(actorId))) return;
    const roll = await bridge.rollEntityStat(actor, "interface", ev.originalEvent || ev);
    if (!roll) return;
    const session = getWorld("session") || {};
    const targetRef = (session.targets || {})[game.user.id] || "";
    if (targetRef.startsWith("runner:")) {
      notifyClients({
        kind: "rollRequest",
        targetRef,
        vs: "defense",
        attackerName: actor.name,
        total: Number(roll.resultTotal) || 0,
        archId: session.activeTab || "",
      });
    }
  });

  html.find('[data-action="demon-reset"]').on("click", (ev) => {
    mutate("demon.reset", { actorId: ev.currentTarget.dataset.actorId });
  });

  // GM: send an ICE or Demon to the top of the combat turn queue.
  html.find('[data-action="ent-to-queue"]').on("click", async (ev) => {
    const el = ev.currentTarget;
    const res = await mutate("ent.toQueue", { actorId: el.dataset.actorId, demon: el.dataset.demon === "true" });
    if (res && res.error) ui.notifications.warn(loc(res.error));
  });

  // ICE follow toggle (SPEC §14.11).
  html.find('[data-action="ice-follow"]').on("change", (ev) => {
    mutate("ice.setFollow", { actorId: ev.currentTarget.dataset.actorId, value: !!ev.currentTarget.checked });
  });

  // ICE attach-to-runner select / detach (arch ICE via iceId, player BI via progKey).
  html.find('[data-action="ice-attach"]').on("change", (ev) => {
    const el = ev.currentTarget;
    const pid = el.value || null;
    mutate("ice.attach", { archId: el.dataset.archId, iceId: el.dataset.iceId || "", progKey: el.dataset.progKey || "", pid });
  });
  html.find('[data-action="ice-detach"]').on("click", (ev) => {
    const el = ev.currentTarget;
    mutate("ice.attach", { archId: el.dataset.archId, iceId: el.dataset.iceId || "", progKey: el.dataset.progKey || "", pid: null });
  });

  // REZ management (GM): set / restore / apply-damage.
  html.find('[data-action="ent-set-rez"]').on("click", (ev) => {
    const box = ev.currentTarget.closest(".crns-rezmgmt");
    const input = box?.querySelector('input[name="rezval"]');
    const value = Number(input?.value);
    mutate("ent.setRez", { actorId: ev.currentTarget.dataset.actorId, value });
  });
  html.find('[data-action="ent-restore"]').on("click", (ev) => {
    mutate("ent.restore", { actorId: ev.currentTarget.dataset.actorId });
  });
  html.find('[data-action="ent-damage-self"]').on("click", (ev) => {
    const box = ev.currentTarget.closest(".crns-rezmgmt");
    const input = box?.querySelector('input[name="rezdmg"]');
    const amount = Number(input?.value);
    mutate("ent.damage", { actorId: ev.currentTarget.dataset.actorId, amount });
  });

  /* ---- damage → target box (all variants) ---- */
  html.find('[data-action="apply-target-damage"]').on("click", (ev) => {
    const box = ev.currentTarget.closest(".crns-damagebox");
    const input = box?.querySelector('input[name="dmgamount"]');
    const amount = Math.max(0, Number(input?.value) || 0);
    const ref = ev.currentTarget.dataset.targetRef || "";
    applyTargetDamage(ref, amount);
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Action-bar resize (Task A)                                          */
/* ------------------------------------------------------------------ */

const BAR_MIN = 200;   // px floor
const BAR_DEFAULT = 290; // px default (matches the CSS fallback)

/** Drag the top-edge handle to resize the action bar. Live-updates the
 *  `--crns-bar-h` custom property on `.crns-root` during the drag (no re-render,
 *  no flicker); persists the final height to a per-client user flag on release
 *  (debounced). Double-click resets to the default by clearing the flag. */
function wireBarResize(app, html) {
  const handle = html.find('[data-action="bar-resize"]')[0];
  if (!handle) return;
  const root = html.filter(".crns-root")[0] || html.find(".crns-root")[0];
  if (!root) return;

  const maxFor = () => Math.max(BAR_MIN, Math.round(root.getBoundingClientRect().height * 0.55));
  const clamp = (h) => Math.min(maxFor(), Math.max(BAR_MIN, Math.round(h)));

  let dragging = false;
  let startY = 0;
  let startH = 0;
  let curH = 0;

  const onMove = (ev) => {
    if (!dragging) return;
    // Dragging UP (smaller clientY) grows the bar → invert the delta.
    curH = clamp(startH + (startY - ev.clientY));
    root.style.setProperty("--crns-bar-h", `${curH}px`);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("crns-resizing");
    persistBarHeight(curH);
  };

  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    dragging = true;
    startY = ev.clientY;
    // Current rendered bar height as the drag origin (falls back to default).
    const bar = root.querySelector(".crns-actions");
    startH = bar ? bar.getBoundingClientRect().height : BAR_DEFAULT;
    curH = clamp(startH);
    document.body.classList.add("crns-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  // Double-click → reset to default (clear the flag + drop the inline var).
  handle.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    root.style.removeProperty("--crns-bar-h");
    try { game.user.unsetFlag(MODULE_ID, "barHeight"); } catch (e) { /* noop */ }
  });
}

let _barHeightTimer = null;
/** Debounced persist of the action-bar height to a per-client user flag. */
function persistBarHeight(px) {
  if (_barHeightTimer) clearTimeout(_barHeightTimer);
  _barHeightTimer = setTimeout(() => {
    _barHeightTimer = null;
    try { game.user.setFlag(MODULE_ID, "barHeight", Math.round(px)); } catch (e) { /* noop */ }
  }, 250);
}

function participantById(pid) {
  const session = getWorld("session") || {};
  const part = (session.participants || {})[pid] || null;
  if (part) part.pid = part.pid || pid;
  return part;
}

/** Confirmation dialog before disconnecting a runner (Addendum 3). Resolves the
 *  runner's display name for the prompt. Shared by the action bar + runners panel.
 *  Returns true on confirm, false on cancel. */
export function confirmDisconnect(pid) {
  const r = resolveRunnerRef(`runner:${pid}`);
  const name = r?.actor?.name || loc("CRNS.Runners.NPC");
  return Dialog.confirm({
    title: loc("CRNS.Actions.DisconnectConfirmTitle"),
    content: `<p>${esc(loc("CRNS.Actions.DisconnectConfirm", { name }))}</p>`,
  });
}

/** GM demon action spend with 0-action warn. Returns true when spent (or when a
 *  demon has no tracked counter — legacy actors). */
async function spendDemonAction(actorId) {
  const session = getWorld("session") || {};
  const state = (session.demonState || {})[actorId];
  if (state && (state.value || 0) < 1) { ui.notifications.warn(loc("CRNS.Errors.NoActions")); return false; }
  await mutate("demon.spend", { actorId, n: 1 });
  return true;
}

/** Player Black-ICE activate flow (SPEC §14.12, reworked per §13): a current
 *  target → DEPLOYED against it; no target → TRAP on the runner's current floor
 *  (allowed in and out of combat). No owner-escort/standby. To change a deployed
 *  target the runner deactivates then reactivates with a new target. */
async function activateBlackIce(app, part, pid, actor, programId) {
  const session = getWorld("session") || {};
  const targetRef = (session.targets || {})[game.user.id] || "";
  const hasTarget = targetRef && !targetRef.startsWith("prog:");

  await mutate("run.spend", { pid, n: 1 });
  const ok = await bridge.rezProgram(actor, programId);
  if (!ok) return;
  await mutate("run.setRezzed", { pid, programId, state: { rezzed: true } });
  const res = hasTarget
    ? await mutate("run.progDeploy", { pid, programId, mode: "deployed", targetRef })
    : await mutate("run.progDeploy", { pid, programId, mode: "trap", floorIndex: part?.floorIndex || 0 });
  if (res && res.error) ui.notifications.warn(loc(res.error));
}

/** Small popover listing a runner's controlled nodes; resolves to a floorId or
 *  null. Reads the choices from the clicked chip's data-nodes JSON. */
function pickControlledNode(html, anchorEl, title = "", { confirmSingle = false } = {}) {
  let nodes = [];
  try { nodes = JSON.parse(anchorEl.dataset.nodes || "[]"); } catch (e) { nodes = []; }
  if (!nodes.length) { ui.notifications.warn(loc("CRNS.Errors.NoControlledNode")); return Promise.resolve(null); }
  // One node and nothing to choose between — except when the choice is whether
  // to do it at all, which is the case for letting go.
  if (nodes.length === 1 && !confirmSingle) return Promise.resolve(nodes[0].floorId);

  return new Promise((resolve) => {
    const buttons = {};
    for (const n of nodes) {
      buttons[n.floorId] = { label: `${n.number}. ${esc(n.label)}`, callback: () => resolve(n.floorId) };
    }
    new Dialog({
      title: title || loc("CRNS.Actions.ControlNodePick"),
      content: "",
      buttons,
      close: () => resolve(null),
    }).render(true);
  });
}

/** Stash a roll's final total for the "apply damage" box. */
function stashDamage(app, roll) {
  const total = Number(roll?.resultTotal);
  if (Number.isFinite(total)) app._lastDamage = total;
}

/** Apply damage from the "damage → target" box to the resolved entity. */
function applyTargetDamage(ref, amount) {
  const [kind] = (ref || "").split(":");
  if (kind === "ice" || kind === "demon") {
    const r = resolveIceRef(ref);
    if (r?.actor) mutate("ent.damage", { actorId: r.actor.id, amount });
  } else if (kind === "prog") {
    const { pid, programId } = parseProgRef(ref);
    mutate("run.progDamage", { pid, programId, amount });
  } else if (kind === "runner") {
    // GM-only: brain damage straight to the netrunner's HP (op re-checks GM).
    const pid = ref.slice("runner:".length);
    if (pid) mutate("runner.damage", { pid, amount });
  }
}

/** Post a styled effect chat card for an ICE actor. */
function postEffectCard(actorId, effectKey) {
  const actor = game.actors?.get(actorId);
  if (!actor || !effectKey) return;
  const text = loc(effectKey);
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-skull"></i> ${esc(actor.name)}</div>` +
    `<div class="crns-chat-body">${text}</div></div>`;
  ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}

/* ------------------------------------------------------------------ */
/* Auto-roll notify (SPEC §8.4)                                        */
/* ------------------------------------------------------------------ */

/** After a player attack-ish roll against a GM-controlled target, emit a
 *  rollRequest so the primary GM can auto-roll the defence. Only fires for
 *  non-GM clients (the GM rolls entities directly). */
async function maybeAutoRoll(app, roll, actor, ability, source, opts = {}) {
  if (!roll) return;

  // Only attacks trigger auto-roll: interface "zap" (rollType "attack") or program "atk".
  const isAttack = source === "program"
    ? ability === "atk"
    : roll.rollType === "attack";
  if (!isAttack) return;

  // Emit for ANY valid target — the primary GM's handleRollRequest routes it:
  // GM-controlled defenders (ice/demon/NPC runner/prog BI) auto-roll defence,
  // player-owned runners get the defence prompt in their own action bar. GM
  // attacks (acting for NPC runners, demon Zap, etc.) flow the same way.
  const session = getWorld("session") || {};
  const targetRef = (session.targets || {})[game.user.id] || "";
  if (!targetRef) return;

  const total = Number(roll.resultTotal) || 0;
  const archId = session.activeTab || "";
  notifyClients({
    kind: "rollRequest",
    targetRef,
    vs: "defense",
    attackerName: actor?.name || "",
    total,
    archId,
    // Attacker-program identity (Requirement 3): the primary GM derezzes it on a
    // MISS. Only present when the attack came from an attacker-class program.
    attackerProg: (opts.attackerProg && opts.attackerProg.isAttacker) ? opts.attackerProg : null,
  });
}
