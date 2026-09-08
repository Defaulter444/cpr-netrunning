/* Cyberpunk RED — Netrunning Suite: entry point.
 * Settings registration, Handlebars helpers, template preload, hooks. */

import { MODULE_ID, TPL, THEMES, loc, esc, BLACK_ICE, blackIceTypeForName } from "./constants.js";
import { WORLD_OBJECTS, getWorld, setWorld, isPrimaryGM, mutate, hasOp, notifyClients } from "./data.js";
import { initSocket } from "./socket.js";
import * as bridge from "./cpr-bridge.js";
import { eligibleNetrunner, userNetrunnerActor } from "./cpr-bridge.js";
import NetrunningSuiteApp from "./apps/suite-app.js";

/* ------------------------------------------------------------------ */
/* init: settings + helpers                                            */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  // World-object stores.
  for (const [key, def] of Object.entries(WORLD_OBJECTS)) {
    game.settings.register(MODULE_ID, key, {
      scope: "world", config: false,
      type: Object, default: foundry.utils.deepClone(def),
    });
  }

  // Config-visible settings (SPEC §3.5).
  game.settings.register(MODULE_ID, "allowSpectators", {
    name: "CRNS.Settings.AllowSpectators", hint: "CRNS.Settings.AllowSpectatorsHint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: rerenderNow,
  });
  game.settings.register(MODULE_ID, "spectatorFreeMove", {
    name: "CRNS.Settings.SpectatorFreeMove", hint: "CRNS.Settings.SpectatorFreeMoveHint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: rerenderNow,
  });
  game.settings.register(MODULE_ID, "autoRollNPC", {
    name: "CRNS.Settings.AutoRollNPC", hint: "CRNS.Settings.AutoRollNPCHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: rerenderNow,
  });
  game.settings.register(MODULE_ID, "theme", {
    name: "CRNS.Settings.Theme", hint: "CRNS.Settings.ThemeHint",
    scope: "client", config: true, type: String, default: "green",
    choices: Object.fromEntries(THEMES.map((t) => [t, `CRNS.Themes.${t}`])),
    onChange: rerenderNow,
  });

  registerHandlebarsHelpers();
});

/* ------------------------------------------------------------------ */
/* ready: socket, singleton app, template preload                      */
/* ------------------------------------------------------------------ */

Hooks.once("ready", async () => {
  watchInteraction();
  initSocket();
  globalThis.CRNS = { ui: new NetrunningSuiteApp() };

  await loadTemplates([
    "shell", "tree", "tabs", "arch-canvas", "editor", "runners", "actions", "actions-damagebox", "actions-target", "entity-card",
  ].map(TPL));

  patchSortCombatants();
  await normalizeLegacyPids();
});

/* ------------------------------------------------------------------ */
/* Turn-queue tie ordering (SPEC §14.1)                                */
/* ------------------------------------------------------------------ */

/** Idempotently monkey-patch Combat.prototype._sortCombatants so that equal
 *  initiatives are ordered by our `queueTs` flag DESC (most recently encountered
 *  ICE on top), falling back to the system/core comparator. The CPR system does
 *  not override _sortCombatants (verified), so we patch the CPRCombat prototype
 *  set at CONFIG.Combat.documentClass. */
function patchSortCombatants() {
  const cls = CONFIG?.Combat?.documentClass;
  const proto = cls?.prototype;
  if (!proto) return;
  if (proto._crnsSortPatched) return; // idempotent.
  const original = proto._sortCombatants;
  proto._sortCombatants = function crnsSortCombatants(a, b) {
    const ia = Number.isFinite(a?.initiative) ? a.initiative : -Infinity;
    const ib = Number.isFinite(b?.initiative) ? b.initiative : -Infinity;
    if (ia === ib) {
      const ta = Number(a?.getFlag?.(MODULE_ID, "queueTs")) || 0;
      const tb = Number(b?.getFlag?.(MODULE_ID, "queueTs")) || 0;
      if (ta !== tb) return tb - ta; // newer first.
    }
    return original.call(this, a, b);
  };
  proto._crnsSortPatched = true;
}

/* One-time data normalization: runner pids used to embed ":" ("actor:<uuid>"),
 * which broke every colon-delimited entityRef parser ("runner:<pid>",
 * "prog:<pid>:<programId>"). Re-key legacy participants to "a_<uuid>". */
async function normalizeLegacyPids() {
  if (!isPrimaryGM()) return;
  const session = getWorld("session") || {};
  const parts = session.participants || {};
  const legacy = Object.keys(parts).filter((k) => k.startsWith("actor:"));
  if (!legacy.length) return;
  const rename = {};
  for (const oldPid of legacy) {
    const newPid = `a_${oldPid.slice("actor:".length).replace(/[^\w-]/g, "_")}`;
    rename[oldPid] = newPid;
    parts[newPid] = parts[oldPid];
    delete parts[oldPid];
  }
  const pf = session.progFloors || {};
  for (const key of Object.keys(pf)) {
    const cut = key.lastIndexOf("|");
    if (cut < 0) continue;
    const pid = key.slice(0, cut);
    if (rename[pid]) {
      pf[`${rename[pid]}${key.slice(cut)}`] = pf[key];
      delete pf[key];
    }
  }
  const targets = session.targets || {};
  for (const [uid, ref] of Object.entries(targets)) {
    for (const [o, n] of Object.entries(rename)) {
      if (ref === `runner:${o}`) targets[uid] = `runner:${n}`;
      else if (ref.startsWith(`prog:${o}:`)) targets[uid] = `prog:${n}:${ref.slice(`prog:${o}:`.length)}`;
    }
  }
  await setWorld("session", session);
  console.log(`${MODULE_ID} | normalized ${legacy.length} legacy participant id(s)`);
}

/* ------------------------------------------------------------------ */
/* Scene-control toolbar button (SPEC §7.8)                            */
/* ------------------------------------------------------------------ */

Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find((c) => c.name === "token");
  token?.tools.push({
    name: "crns",
    title: loc("CRNS.Button.Open"),
    icon: "fas fa-microchip",
    visible: game.user.isGM
      || !!userNetrunnerActor(game.user)
      || game.settings.get(MODULE_ID, "allowSpectators"),
    onClick: () => globalThis.CRNS?.ui?.render(true),
    button: true,
  });
});

/* ------------------------------------------------------------------ */
/* Live re-render                                                      */
/* ------------------------------------------------------------------ */

/* Re-render gate.
 *
 * Five hook families feed the debounced re-render: world settings, actors, and
 * three item hooks. During play they fire constantly — every REZ tick, every
 * chat roll that touches an actor — and a re-render replaces the whole window's
 * DOM.
 *
 * That is why buttons "needed several clicks". A click is only delivered if the
 * element that received the mousedown is still in the document at mouseup; when
 * a re-render lands in between, the node the user pressed is gone and the click
 * is never dispatched. Same for a drag: the drop target is replaced mid-flight.
 * Same for typing: the field is rebuilt and the keystrokes vanish.
 *
 * So the render waits. While a pointer is down inside the window, while a drag
 * is in progress, or while focus sits in one of its fields, the pending render
 * is remembered and run the moment the user lets go. Data is never lost — only
 * the repaint is deferred, by as long as the interaction lasts. */
let _interacting = false;
let _dragging = false;
let _renderPending = false;

/** The window's root element, if it is open. */
function suiteRoot() {
  return globalThis.CRNS?.ui?.element?.[0] ?? null;
}

/** Is the user in the middle of something we must not interrupt? */
function suiteBusy() {
  const root = suiteRoot();
  if (!root) return false;
  if (_interacting || _dragging) return true;
  const active = document.activeElement;
  return !!active
    && root.contains(active)
    && active.matches("input, textarea, select, [contenteditable=\"true\"]");
}

const _rerenderDebounced = foundry.utils.debounce(() => {
  const app = globalThis.CRNS?.ui;
  if (!app?.rendered) { _renderPending = false; return; }
  if (suiteBusy()) { _renderPending = true; return; }
  _renderPending = false;
  app.render(false);
}, 100);

/** Called when an interaction ends: run whatever we held back. */
function flushPendingRender() {
  if (!_renderPending) return;
  _rerenderDebounced();
}

/** Bind the interaction watchers once. Listeners sit on the document so a
 *  pointer released outside the window still clears the flag — otherwise a
 *  drag that ends on the desktop would freeze the window forever. */
function watchInteraction() {
  document.addEventListener("pointerdown", (ev) => {
    const root = suiteRoot();
    _interacting = !!root && root.contains(ev.target);
  }, true);
  const release = () => {
    if (!_interacting) return;
    _interacting = false;
    flushPendingRender();
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);

  document.addEventListener("dragstart", (ev) => {
    const root = suiteRoot();
    _dragging = !!root && root.contains(ev.target);
  }, true);
  document.addEventListener("dragend", () => {
    if (!_dragging) return;
    _dragging = false;
    flushPendingRender();
  }, true);
  // A drop outside the window fires no dragend on some paths.
  document.addEventListener("drop", () => {
    if (!_dragging) return;
    _dragging = false;
    flushPendingRender();
  }, true);

  document.addEventListener("focusout", () => {
    // Focus moving out of a field is the other end of "the user is typing".
    if (_renderPending && !suiteBusy()) flushPendingRender();
  }, true);
}

function rerenderNow() { _rerenderDebounced(); }

Hooks.on("updateSetting", (setting) => {
  if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
  _rerenderDebounced();
});

/** Whether an actor changing should re-render the suite: a session runner, an
 *  architecture entity actor (blackIce/demon referenced by any arch), or one the
 *  current user could act with. Used to filter actor/item hooks. */
function actorRelevant(actor) {
  if (!actor) return false;
  const session = getWorld("session") || {};
  const parts = session.participants || {};
  const uuid = actor.uuid;
  for (const p of Object.values(parts)) {
    if (p.kind === "runner" && p.actorUuid === uuid) return true;
  }
  if (actor.type === "blackIce" || actor.type === "demon") {
    if (archReferencesActor(actor.id)) return true;
  }
  return actor.testUserPermission?.(game.user, "OWNER") && eligibleNetrunner(actor);
}

/** Cheap scan of netArchs for a floor entity backed by this actor id. */
function archReferencesActor(actorId) {
  const archs = getWorld("netArchs") || {};
  for (const arch of Object.values(archs)) {
    for (const floor of arch.floors || []) {
      if ((floor.ice || []).some((i) => i.actorId === actorId)) return true;
      if (floor.demon?.actorId === actorId) return true;
    }
  }
  return false;
}

const _actorHook = (actor) => {
  const app = globalThis.CRNS?.ui;
  if (!app?.rendered) return;
  if (actorRelevant(actor)) _rerenderDebounced();
};
Hooks.on("updateActor", _actorHook);

const _itemHook = (item) => {
  const app = globalThis.CRNS?.ui;
  if (!app?.rendered) return;
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  if (actorRelevant(actor)) _rerenderDebounced();
};
Hooks.on("createItem", _itemHook);
Hooks.on("updateItem", _itemHook);
Hooks.on("deleteItem", _itemHook);

/* ------------------------------------------------------------------ */
/* Combat integration — reset a runner's NET actions on their turn      */
/* ------------------------------------------------------------------ */

function resetRunnerForCombatant(combat) {
  if (!isPrimaryGM()) return;
  const actor = combat?.combatant?.actor;
  if (!actor) return;
  const session = getWorld("session") || {};
  const parts = session.participants || {};
  // Runner whose turn it is → reset its NET actions.
  if (hasOp("run.reset")) {
    for (const [pid, p] of Object.entries(parts)) {
      if (p.kind === "runner" && p.actorUuid === actor.uuid) {
        mutate("run.reset", { pid });
      }
    }
  }
  // Demon whose turn it is → reset its NET-action counter (SPEC §14.8/§14.10).
  if (actor.type === "demon" && hasOp("demon.reset")) {
    mutate("demon.reset", { actorId: actor.id });
  }
}
Hooks.on("combatTurn", (combat) => resetRunnerForCombatant(combat));
Hooks.on("combatRound", (combat) => resetRunnerForCombatant(combat));

/* ------------------------------------------------------------------ */
/* Auto-roll: primary GM answers a player's attack (SPEC §8.4)          */
/* ------------------------------------------------------------------ */

Hooks.on(`${MODULE_ID}.notify`, (data) => {
  // Player-side defence prompt (SPEC Addendum 2): the OWNING player client shows
  // a defence prompt in the action bar; evaluated on every client (not GM-gated).
  if (data?.kind === "defenseRequest") {
    handleDefenseRequest(data);
    return;
  }
  if (!isPrimaryGM()) return;
  if (data?.kind === "rollRequest") {
    handleRollRequest(data).catch((e) => console.error(`${MODULE_ID} | rollRequest`, e));
  } else if (data?.kind === "speedTest") {
    handleSpeedTest(data).catch((e) => console.error(`${MODULE_ID} | speedTest`, e));
  } else if (data?.kind === "slideTest") {
    handleSlideTest(data).catch((e) => console.error(`${MODULE_ID} | slideTest`, e));
  } else if (data?.kind === "defenseResult") {
    handleDefenseResult(data).catch((e) => console.error(`${MODULE_ID} | defenseResult`, e));
  }
});

/** Client-side: if I own the targeted runner, record a pending defence prompt on
 *  the app and re-render so the action bar shows the "roll defence" block. */
function handleDefenseRequest(data) {
  const app = globalThis.CRNS?.ui;
  if (!app) return;
  const part = (getWorld("session") || {}).participants?.[data.pid];
  if (!part || part.userId !== game.user.id) return; // only the owner prompts.
  app._pendingDefense = app._pendingDefense || [];
  app._pendingDefense.push({
    id: foundry.utils.randomID(8),
    pid: data.pid,
    attackerName: data.attackerName || "",
    attackerTotal: Number(data.total) || 0,
    // Carry the attacker program so the defence reply can trigger miss auto-derez.
    attackerProg: data.attackerProg || null,
  });
  if (app.rendered) app.render(false);
}

/** Resolve the ICE side of a Slide (SPEC §14.7). The runner initiated, so the
 *  runner succeeds only when runnerTotal STRICTLY exceeds the ICE's PER total
 *  (opposed, defender wins ties). `data.testRef` is the ICE ref; `data.pid` the
 *  runner; `data.runnerTotal` the runner's slide total. On success the ICE's
 *  attachment to this runner is dropped and a slid record stored. */
async function handleSlideTest(data) {
  const resolved = refToActor(data.testRef);
  if (!resolved?.actor || resolved.kind !== "ice") return;
  const iceActor = resolved.actor;

  const roll = await bridge.rollEntityStat(iceActor, "per");
  const iceTotal = Number(roll?.resultTotal) || 0;
  const runnerTotal = Number(data.runnerTotal) || 0;

  // Runner initiates → success only when he EXCEEDS the ICE's PER (ties to ICE).
  const success = runnerTotal > iceTotal;

  const slideRunnerName = participantName(getWorld("session") || {}, data.pid);
  postComparisonCard(slideRunnerName, runnerTotal, iceActor.name, iceTotal, {
    title: loc("CRNS.Actions.Slide"),
    avoided: success, // reuse the titled variant: "avoided" = runner slid past.
    speedTest: true,
    slide: true,
  });

  if (success) {
    // Slide target is either an arch ICE (ice:archId:floorId:iceId) or a player
    // Black ICE (prog:<ownerPid>:<programId>) — resolve the right slideResolve
    // shape so the attachment + slid record use matching identity (Addendum 2).
    const testRef = data.testRef || "";
    if (testRef.startsWith("prog:")) {
      const rest = testRef.slice("prog:".length);
      const cut = rest.lastIndexOf(":");
      const ownerPid = rest.slice(0, cut);
      const programId = rest.slice(cut + 1);
      const st = (getWorld("session") || {}).progState?.[`${ownerPid}|${programId}`] || null;
      const archId = (getWorld("session") || {}).participants?.[data.pid]?.archId
        || (getWorld("session") || {}).participants?.[ownerPid]?.archId || "";
      if (st && archId) {
        await mutate("run.slideResolve", { archId, progKey: `${ownerPid}|${programId}`, pid: data.pid });
      }
    } else {
      const [, archId, , iceId] = testRef.split(":");
      await mutate("run.slideResolve", { archId, iceId, pid: data.pid });
    }
  }
}

/** Resolve the opposed side of a Black ICE attack-of-opportunity SPEED test
 *  (Corebook p.205). The runner's total arrives in `data.runnerTotal`; the GM
 *  rolls the ICE's SPD, compares (ties go to the RUNNER — he is defending), and
 *  on a runner loss posts the ICE's effect text. Then the test is cleared. */
async function handleSpeedTest(data) {
  const session = getWorld("session") || {};
  const test = (session.pendingTests || []).find((t) => t.id === data.testId);
  if (!test) return;
  const iceActor = game.actors?.get(test.iceActorId);
  if (!iceActor) { await mutate("run.clearSpeedTest", { testId: data.testId }); return; }

  const roll = await bridge.rollEntityStat(iceActor, "spd");
  const iceTotal = Number(roll?.resultTotal) || 0;
  const runnerTotal = Number(data.runnerTotal) || 0;
  const runnerName = participantName(session, test.pid);

  // Ties go to the RUNNER: he avoids the attack of opportunity unless the ICE
  // strictly exceeds his total.
  const avoided = runnerTotal >= iceTotal;

  postComparisonCard(test.iceName, iceTotal, runnerName, runnerTotal, {
    title: loc("CRNS.Actions.SpeedTest"),
    avoided,
    speedTest: true,
  });

  if (!avoided) {
    // The ICE's effect applies — post its effect text.
    const resolved = refToActor(test.ref);
    const effectKey = resolved?.type ? BLACK_ICE[resolved.type]?.effectKey : "";
    if (effectKey) postEffectCard(iceActor.id, `${effectKey}.effect`);
  }

  await mutate("run.clearSpeedTest", { testId: data.testId });
}

/** A participant's display name (backing actor's name, else the NPC label). */
function participantName(session, pid) {
  const part = (session.participants || {})[pid];
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  return actor?.name || loc("CRNS.Runners.NPC");
}

/** Post a styled effect chat card for an ICE actor (shared with the action bar). */
function postEffectCard(actorId, effectKey) {
  const actor = game.actors?.get(actorId);
  if (!actor || !effectKey) return;
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-skull"></i> ${esc(actor.name)}</div>` +
    `<div class="crns-chat-body">${loc(effectKey)}</div></div>`;
  ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content });
}

/** Resolve an ice:/demon:/runner: ref to its backing actor + kind. */
function refToActor(ref) {
  const [kind, archId, floorId, entId] = (ref || "").split(":");
  if (kind === "ice" || kind === "demon") {
    const arch = (getWorld("netArchs") || {})[archId];
    const floor = (arch?.floors || []).find((f) => f.id === floorId);
    if (!floor) return null;
    const def = kind === "ice"
      ? (floor.ice || []).find((i) => i.id === entId)
      : (floor.demon && floor.demon.id === entId ? floor.demon : null);
    if (!def?.actorId) return null;
    return { kind, actor: game.actors?.get(def.actorId) ?? null, type: def.type };
  }
  if (kind === "runner") {
    const part = (getWorld("session") || {}).participants?.[archId]; // archId slot = pid here
    const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
    return actor ? { kind, actor, type: "" } : null;
  }
  // prog:<pid>:<programId> — a rezzed player Black-ICE backed by its own actor
  // (SPEC §14.12 / Task 1). pid may contain ":", so split off the trailing id.
  if (kind === "prog") {
    const rest = (ref || "").slice("prog:".length);
    const cut = rest.lastIndexOf(":");
    if (cut < 0) return null;
    const pid = rest.slice(0, cut);
    const programId = rest.slice(cut + 1);
    const ps = (getWorld("session") || {}).progState?.[`${pid}|${programId}`] || null;
    const actor = ps?.actorId ? (game.actors?.get(ps.actorId) ?? null) : null;
    // Treat as ICE for rolls. Derive a BLACK_ICE type from the actor name so the
    // effect card can resolve (empty for custom-named programs — caller skips).
    return actor ? { kind: "ice", actor, type: blackIceTypeForName(actor.name) } : null;
  }
  return null;
}

/** Is a runner participant PLAYER-controlled (owned by a non-GM user)? Such a
 *  defender must roll on THEIR OWN client so the standard CPR verify dialog opens
 *  (they can add LUCK). GM-controlled runners (userId "") auto-roll GM-side. */
function runnerIsPlayerControlled(pid) {
  const part = (getWorld("session") || {}).participants?.[pid];
  if (!part || part.kind !== "runner" || !part.userId) return false;
  const user = game.users.get(part.userId);
  return !!user && !user.isGM;
}

async function handleRollRequest(data) {
  const auto = game.settings.get(MODULE_ID, "autoRollNPC");
  const resolved = refToActor(data.targetRef);
  if (!resolved?.actor) return;
  const { kind, actor } = resolved;

  // Player-owned runner defender (SPEC Addendum 2): do NOT auto-roll on the GM
  // client. Prompt the owning player to roll defence with the standard dialog.
  if (kind === "runner") {
    const pid = (data.targetRef || "").slice("runner:".length);
    if (runnerIsPlayerControlled(pid)) {
      notifyClients({
        kind: "defenseRequest",
        pid,
        attackerName: data.attackerName || "",
        total: Number(data.total) || 0,
        // Carry the attacker program through so the player's defence reply can
        // trigger the miss auto-derez (Requirement 3).
        attackerProg: data.attackerProg || null,
      });
      return;
    }
  }

  if (!auto) {
    ui.notifications.info(loc("CRNS.Actions.AutoRollPrompt", { attacker: data.attackerName, target: actor.name }));
    return;
  }

  let defenderTotal = 0;
  if (kind === "ice") {
    const roll = await bridge.rollEntityStat(actor, "def");
    defenderTotal = Number(roll?.resultTotal) || 0;
  } else if (kind === "demon") {
    // SPEC §14.8: demons now ROLL 1d10+Interface on defense (Combat Number stays
    // only as a separate manual action button on the demon panel).
    const roll = await bridge.rollEntityStat(actor, "interface");
    defenderTotal = Number(roll?.resultTotal) || 0;
  } else if (kind === "runner") {
    // GM-controlled runner (userId "") — auto-roll GM-side.
    const roll = await bridge.rollInterface(actor, "defense");
    defenderTotal = Number(roll?.resultTotal) || 0;
  } else if (kind === "prog") {
    // A player's rezzed Black ICE defends with its DEF stat (backing actor).
    const roll = await bridge.rollEntityStat(actor, "def");
    defenderTotal = Number(roll?.resultTotal) || 0;
  }

  postComparisonCard(data.attackerName, Number(data.total) || 0, actor.name, defenderTotal);

  // Requirement 3: on a MISS (atk <= def) an attacker program auto-derezzes,
  // WITHOUT a damage roll. (On a hit the player rolls damage and the attacker
  // self-derezzes after that roll — existing, idempotent behaviour.)
  if ((Number(data.total) || 0) <= defenderTotal) {
    await derezAttackerProg(data.attackerProg);
  }
}

/** Requirement 3: derez the attacker program GM-side after a MISS. Resolves the
 *  owner actor from the participant pid, derezzes the program item, clears its
 *  rezzed mirror, and posts the AttackerDerez info as a chat card (not just a
 *  toast, so players see it). Idempotent — a program already derezzed is a
 *  no-op (no error, no double card). */
async function derezAttackerProg(attackerProg) {
  if (!attackerProg?.isAttacker) return;
  const { pid, programId } = attackerProg;
  if (!pid || !programId) return;
  const part = (getWorld("session") || {}).participants?.[pid];
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  if (!actor) return;
  // Idempotency: only act (and post) when the program is still rezzed.
  const wasRezzed = !!actor.getOwnedItem?.(programId)?.system?.isRezzed;
  if (!wasRezzed) return;
  await bridge.derezProgram(actor, programId);
  await mutate("run.setRezzed", { pid, programId, state: null });
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-arrow-rotate-left"></i> ${esc(actor.name)}</div>` +
    `<div class="crns-chat-body">${esc(loc("CRNS.Actions.AttackerDerez", { name: actor.name }))}</div></div>`;
  ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content });
}

/** Primary GM: a player rolled their defence (SPEC Addendum 2) — post the
 *  attacker-vs-defence comparison card (ties to defender, default rule). */
async function handleDefenseResult(data) {
  const part = (getWorld("session") || {}).participants?.[data.pid];
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  const name = actor?.name || loc("CRNS.Runners.NPC");
  const atk = Number(data.attackerTotal) || 0;
  const def = Number(data.defenseTotal) || 0;
  postComparisonCard(data.attackerName || "", atk, name, def);
  // Requirement 3: attacker program auto-derezzes on a MISS (atk <= def).
  if (atk <= def) await derezAttackerProg(data.attackerProg);
}

/** Post the module comparison mini-card. Default (attack): the attacker must
 *  EXCEED the defender (ties go to the defender). SPEED-test variant (`opts`):
 *  a titled card whose verdict is "avoided"/"failed" for the runner, ties to
 *  the RUNNER (Corebook p.205). */
function postComparisonCard(attacker, atkTotal, defender, defTotal, opts = null) {
  let verdict, cls, note, title;
  if (opts?.slide) {
    verdict = opts.avoided ? loc("CRNS.Actions.SlidPast") : loc("CRNS.Actions.SlideBlocked");
    cls = opts.avoided ? "crns-hit" : "crns-miss";
    note = loc("CRNS.Actions.SlideTieNote");
    title = `${esc(opts.title || "")}: ${esc(attacker)} → ${esc(defender)}`;
  } else if (opts?.speedTest) {
    verdict = opts.avoided ? loc("CRNS.Actions.SpeedAvoided") : loc("CRNS.Actions.SpeedFailed");
    cls = opts.avoided ? "crns-hit" : "crns-miss";
    note = loc("CRNS.Actions.SpeedTieNote");
    title = `${esc(opts.title || "")}: ${esc(attacker)} → ${esc(defender)}`;
  } else {
    const hit = atkTotal > defTotal;
    verdict = hit ? loc("CRNS.Actions.Hit") : loc("CRNS.Actions.Miss");
    cls = hit ? "crns-hit" : "crns-miss";
    note = loc("CRNS.Actions.TieNote");
    title = `${esc(attacker)} → ${esc(defender)}`;
  }
  const content =
    `<div class="crns-chat-card crns-compare">` +
    `<div class="crns-chat-title">${title}</div>` +
    `<div class="crns-chat-body">${esc(attacker)}: <b>${atkTotal}</b> ` +
    `${loc("CRNS.Actions.Versus")} ${esc(defender)}: <b>${defTotal}</b></div>` +
    `<div class="crns-compare-verdict ${cls}">${verdict}</div>` +
    `<div class="crns-compare-note">${note}</div></div>`;
  ChatMessage.create({ user: game.user.id, content });
}

/* ------------------------------------------------------------------ */
/* Handlebars helpers (prefix crns)                                    */
/* ------------------------------------------------------------------ */

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("crnsEq", (a, b) => a === b);
  Handlebars.registerHelper("crnsOr", (a, b) => a || b);
  Handlebars.registerHelper("crnsAnd", (a, b) => a && b);
  Handlebars.registerHelper("crnsIncludes", (arr, v) => Array.isArray(arr) && arr.includes(v));
  Handlebars.registerHelper("crnsConcat", (...args) => args.slice(0, -1).join(""));
  Handlebars.registerHelper("crnsGt", (a, b) => Number(a) > Number(b));
}
