/* CPR system bridge — the ONLY file allowed to import from the cyberpunk-red-core
 * system or touch actor/item CPR internals. Everything else calls these helpers.
 *
 * All functions are defensive: optional chaining + try/catch so a system update
 * degrades gracefully rather than breaking the whole app.
 */

import { loc, esc, netActionsMax as _netActionsMax, MODULE_ID, BLACK_ICE, DEMONS, ENTITY_ICONS } from "./constants.js";

// URL imports from the active system (legal in Foundry v12).
// CPRRolls exposes named classes; CPRChat is the default export.
import * as CPRRolls from "/systems/cyberpunk-red-core/modules/rolls/cpr-rolls.js";
import CPRChat from "/systems/cyberpunk-red-core/modules/chat/cpr-chat.js";
import CPRCONFIG from "/systems/cyberpunk-red-core/modules/system/config.js";

function sysError(e) {
  console.error("cpr-netrunning | bridge", e);
  try { ui.notifications.error(loc("CRNS.Errors.SystemApi")); } catch (_e) { /* noop */ }
}

/* ------------------------------------------------------------------ */
/* Role / rank / deck introspection                                    */
/* ------------------------------------------------------------------ */

export function getNetRole(actor) {
  try {
    return actor?.itemTypes?.role?.find((r) => r.id === actor.system.roleInfo.activeNetRole) ?? null;
  } catch (e) { return null; }
}

export function getInterfaceRank(actor) {
  return Number(getNetRole(actor)?.system?.rank ?? 0);
}

// Re-export the pure formula so the rest of the module has one entry point.
export const netActionsMax = _netActionsMax;

export function getDeck(actor) {
  try { return actor?.getEquippedCyberdeck?.() ?? null; }
  catch (e) { return null; }
}

export function hasDeck(actor) {
  return !!getDeck(actor);
}

export function eligibleNetrunner(actor) {
  return !!actor && (actor.type === "character" || actor.type === "mook") && hasDeck(actor);
}

/** Prefer the user's assigned character if eligible, else their first owned
 *  eligible character/mook actor. Used for the toolbar visibility + roster. */
export function userNetrunnerActor(user) {
  if (!user) return null;
  if (eligibleNetrunner(user.character)) return user.character;
  const owned = game.actors?.filter((a) => a.testUserPermission(user, "OWNER") && eligibleNetrunner(a)) ?? [];
  return owned[0] ?? null;
}

/** The interface-ability action list, each localized via the system's own i18n
 *  keys, plus Speed and Defense. `key` is what rollInterface expects.
 *  `free` marks abilities that never cost a NET action (defence/speed). */
export function interfaceAbilities() {
  const out = [];
  try {
    const map = CPRCONFIG?.interfaceAbilities || {};
    for (const [key, i18n] of Object.entries(map)) {
      out.push({ key, label: game.i18n.localize(i18n), free: false });
    }
  } catch (e) { /* noop — fall through with Speed/Defense only */ }
  // Speed + Defense are handled by the system's _createInterfaceRoll and are
  // reactive rolls, so they default to free (no action spend).
  try {
    out.push({ key: "speed", label: game.i18n.localize("CPR.global.generic.speed"), free: true });
    out.push({ key: "defense", label: game.i18n.localize("CPR.global.generic.defense"), free: true });
  } catch (e) { /* noop */ }
  return out;
}

export function installedPrograms(deck) {
  try { return deck?.system?.installedPrograms ?? []; }
  catch (e) { return []; }
}

export function rezzedPrograms(deck) {
  try { return deck?.system?.rezzedPrograms ?? []; }
  catch (e) { return []; }
}

/* ------------------------------------------------------------------ */
/* Netrunner rolls (reuse the system pipeline: dialog + crits + DSN)   */
/* ------------------------------------------------------------------ */

/**
 * Interface ability roll. `ability` ∈ CONFIG.CPR.interfaceAbilities keys plus
 * "speed" / "defense" (the system's _createInterfaceRoll handles those).
 */
export async function rollInterface(actor, ability, event) {
  try {
    // Auto-rolls (defence/speed) arrive with no event; synthesize one that skips
    // the dialog. handleRollDialog only inverts ctrl for type==="click", so a
    // non-"click" synthetic with ctrlKey:true takes the plain skip path.
    event = event ?? { ctrlKey: true, metaKey: false, type: "auto" };
    const deck = getDeck(actor);
    if (!deck) { ui.notifications.warn(loc("CRNS.Errors.NoDeck")); return null; }
    const netRoleItem = getNetRole(actor);
    if (!netRoleItem) { ui.notifications.error(loc("CRNS.Errors.SystemApi")); return null; }

    const roll = deck.createRoll("interfaceAbility", actor, {
      interfaceAbility: ability,
      cyberdeck: deck,
      netRoleItem,
    });
    if (!roll) return null;

    const keepRolling = await roll.handleRollDialog(event, actor, deck);
    if (!keepRolling) return null;
    await roll.roll();

    roll.entityData = { actor: actor.id };
    await CPRChat.RenderRollCard(roll);
    return roll;
  } catch (e) { sysError(e); return null; }
}

/**
 * Program roll. `executionType` ∈ "atk" | "def" | "damage".
 */
export async function rollProgram(actor, programId, executionType, event) {
  try {
    event = event ?? { ctrlKey: true, metaKey: false, type: "auto" };
    const deck = getDeck(actor);
    if (!deck) { ui.notifications.warn(loc("CRNS.Errors.NoDeck")); return null; }
    const netRoleItem = getNetRole(actor);
    if (!netRoleItem) { ui.notifications.error(loc("CRNS.Errors.SystemApi")); return null; }

    const roll = deck.createRoll("cyberdeckProgram", actor, {
      cyberdeckId: deck.id,
      programId,
      executionType,
      netRoleItem,
    });
    if (!roll) return null;

    const keepRolling = await roll.handleRollDialog(event, actor, deck);
    if (!keepRolling) return null;
    await roll.roll();

    roll.entityData = { actor: actor.id };
    if (deck) roll.entityData.item = deck.id;
    await CPRChat.RenderRollCard(roll);
    return roll;
  } catch (e) { sysError(e); return null; }
}

/* ------------------------------------------------------------------ */
/* Program rez management (replicates the sheet's persistence effects)  */
/* ------------------------------------------------------------------ */

/** Rez an installed program and persist the deck + program document changes,
 *  mirroring cpr-character-sheet._cyberdeckProgramExecution / _updateOwnedItem.
 *
 *  Black-ICE note (SPEC §14.12 / Task 1): the system's `deck.rezProgram` calls
 *  `_rezBlackIceToken`, which — for a token-less world actor (netrunners in this
 *  suite have no scene token) — fails to find a token and fires the
 *  `CPR.messages.rezBlackIceWithoutToken` warning (cpr-cyberdeck.js:302-306).
 *  We DON'T want a canvas token anyway: the suite backs a rezzed player Black-ICE
 *  with its own folder Actor (createProgIceActor). So for a blackice program we
 *  replicate ONLY the safe part of `deck.rezProgram` — `program.setRezzed()` — and
 *  skip the token spawn entirely, silencing the warning at the source. */
export async function rezProgram(actor, programId) {
  try {
    const deck = getDeck(actor);
    if (!deck) { ui.notifications.warn(loc("CRNS.Errors.NoDeck")); return false; }
    const program = actor.getOwnedItem(programId);
    if (!program) return false;
    if (program.system.isRezzed) return true;

    if (program.system.class === "blackice") {
      // Safe subset of deck.rezProgram (cpr-cyberdeck.js:62-68) minus the token.
      await program.setRezzed();
    } else {
      await deck.rezProgram(program, actor.token ?? null);
    }

    const updateList = [];
    if (deck.isOwned && deck.isEmbedded) updateList.push({ _id: deck.id, system: deck.system });
    if (program.isOwned && program.isEmbedded) updateList.push({ _id: program.id, system: program.system });
    if (updateList.length) await actor.updateEmbeddedDocuments("Item", updateList);
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Derez a program. Module rule: deactivation restores its REZ to max. */
export async function derezProgram(actor, programId) {
  try {
    const deck = getDeck(actor);
    if (!deck) { ui.notifications.warn(loc("CRNS.Errors.NoDeck")); return false; }
    const program = actor.getOwnedItem(programId);
    if (!program) return false;
    if (!program.system.isRezzed) return true;

    if (program.system.class === "blackice") {
      // Mirror of the rez-side note above: the system's `deck.derezProgram`
      // calls `_derezBlackIceToken`, which expects the token flags the token
      // spawn would have written (biTokenId/sceneId) and logs a CPR ERR when
      // they're absent — our BI never had a canvas token. Replicate only the
      // safe part (`program.unsetRezzed()` mutates in-memory; the
      // updateEmbeddedDocuments below persists it).
      program.unsetRezzed?.();
    } else {
      await deck.derezProgram(program);
    }
    // Module rule: restore REZ to max on deactivation.
    await deck.resetRezProgram(program);

    const updateList = [];
    if (deck.isOwned && deck.isEmbedded) updateList.push({ _id: deck.id, system: deck.system });
    if (program.isOwned && program.isEmbedded) updateList.push({ _id: program.id, system: program.system });
    if (updateList.length) await actor.updateEmbeddedDocuments("Item", updateList);
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Reduce a rezzed program's REZ (brain/black-ice damage to a runner program). */
export async function applyProgramDamage(actor, programId, amount) {
  try {
    const deck = getDeck(actor);
    const program = actor?.getOwnedItem?.(programId);
    if (!program) return false;
    if (deck?.reduceRezProgram) {
      await deck.reduceRezProgram(program, Math.max(0, Number(amount) || 0));
    } else {
      const newRez = Math.max(0, (program.system.rez?.value ?? 0) - (Number(amount) || 0));
      await program.update({ "system.rez.value": newRez });
    }
    return true;
  } catch (e) { sysError(e); return false; }
}

/* ------------------------------------------------------------------ */
/* Architecture-entity actors (blackIce / demon Actor documents)        */
/* ------------------------------------------------------------------ */

const ROOT_FOLDER = "NET Architectures";

async function ensureFolder(name, parent) {
  const existing = game.folders?.find(
    (f) => f.type === "Actor" && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null),
  );
  if (existing) return existing;
  return Folder.create({ name, type: "Actor", folder: parent?.id ?? null });
}

/** Root "NET Architectures" folder → child <archName> folder (both idempotent). */
export async function ensureEntityFolder(archName) {
  try {
    const root = await ensureFolder(ROOT_FOLDER, null);
    return await ensureFolder(archName || loc("CRNS.Tree.Untitled"), root);
  } catch (e) { sysError(e); return null; }
}

/** Create a blackIce Actor seeded from the constants table. Returns actor.id. */
export async function createIceActor(type, archName) {
  try {
    const def = BLACK_ICE[type];
    if (!def) return null;
    const folder = await ensureEntityFolder(archName);
    const actor = await Actor.create({
      type: "blackIce",
      name: loc(`${def.effectKey}.name`),
      img: ENTITY_ICONS[type],
      folder: folder?.id ?? null,
      system: {
        // Per SPEC §5: tgt "P" -> "antiprogram", else "antipersonnel".
        class: def.tgt === "P" ? "antiprogram" : "antipersonnel",
        stats: {
          per: def.per, spd: def.spd, atk: def.atk, def: def.def,
          rez: { value: def.rez, max: def.rez },
        },
      },
    });
    return actor?.id ?? null;
  } catch (e) { sysError(e); return null; }
}

/** Create a real blackIce Actor to back a rezzed player Black-ICE PROGRAM
 *  (SPEC §14.12 / Task 1). Seeded from a plain program snapshot (name, img, class,
 *  stats) so it can run GM-side without the live item. While rezzed this actor is
 *  the source of truth for the prog entity's REZ/stats. Returns actor.id or null.
 *  `snap` = { name, img, per, spd, atk, def, rez, rezMax, blackIceType }. */
export async function createProgIceActor(snap, archName) {
  try {
    if (!snap) return null;
    const folder = await ensureEntityFolder(archName);
    const key = String(snap.name || "").toLowerCase();
    const rezMax = Number(snap.rezMax ?? snap.rez ?? 0) || 0;
    const rez = Number(snap.rez ?? rezMax) || 0;
    const cls = ["antipersonnel", "antiprogram", "other"].includes(snap.blackIceType)
      ? snap.blackIceType
      : "antipersonnel";
    const actor = await Actor.create({
      type: "blackIce",
      name: snap.name || loc("CRNS.Actions.KindProgram"),
      img: ENTITY_ICONS[key] || snap.img || "icons/svg/mystery-man.svg",
      folder: folder?.id ?? null,
      system: {
        class: cls,
        stats: {
          per: Number(snap.per) || 0, spd: Number(snap.spd) || 0,
          atk: Number(snap.atk) || 0, def: Number(snap.def) || 0,
          rez: { value: rez, max: rezMax || rez },
        },
      },
    });
    return actor?.id ?? null;
  } catch (e) { sysError(e); return null; }
}

/** Create a demon Actor seeded from the constants table. Returns actor.id. */
export async function createDemonActor(type, archName) {
  try {
    const def = DEMONS[type];
    if (!def) return null;
    const folder = await ensureEntityFolder(archName);
    const actor = await Actor.create({
      type: "demon",
      name: loc(`CRNS.Demon.${type}.name`),
      img: ENTITY_ICONS[type],
      folder: folder?.id ?? null,
      system: {
        stats: {
          rez: { value: def.rez, max: def.rez },
          interface: def.interface,
          actions: def.actions,
          combatNumber: def.combatNumber,
        },
      },
      // Record the constants-table type so demonState can seed lazily without
      // name matching (SPEC §14.8).
      flags: { [MODULE_ID]: { type } },
    });
    return actor?.id ?? null;
  } catch (e) { sysError(e); return null; }
}

/** The DEMONS[] key for a demon actor: the creation flag when present, else a
 *  case-insensitive name match against the localized DEMONS names (legacy
 *  actors). Returns null when nothing matches. */
export function getDemonType(actor) {
  try {
    const flagged = actor?.getFlag?.(MODULE_ID, "type") ?? actor?.flags?.[MODULE_ID]?.type;
    if (flagged && DEMONS[flagged]) return flagged;
    const name = String(actor?.name ?? "").trim().toLowerCase();
    if (!name) return null;
    for (const key of Object.keys(DEMONS)) {
      if (loc(`CRNS.Demon.${key}.name`).toLowerCase() === name) return key;
      if (key === name) return key;
    }
    return null;
  } catch (e) { return null; }
}

/** Set a core actor flag (flags are core — direct write, but kept in the bridge
 *  per SPEC §1: this is the ONLY file that writes to actors). GM-side only. */
export async function setActorFlag(actorId, key, value) {
  try {
    const actor = game.actors?.get(actorId);
    if (!actor) return false;
    await actor.setFlag(MODULE_ID, key, value);
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Read a namespaced actor flag (no write). Returns undefined when unavailable. */
export function getActorFlag(actorId, key) {
  try {
    const actor = game.actors?.get(actorId);
    return actor?.getFlag?.(MODULE_ID, key);
  } catch (e) { return undefined; }
}

/** Duplicate a backing entity actor into the given architecture's folder.
 *  Returns the new actor's id (or null). REZ is reset to max on the copy. */
export async function duplicateEntityActor(actorId, archName) {
  try {
    const src = game.actors?.get(actorId);
    if (!src) return null;
    const folder = await ensureEntityFolder(archName);
    const objData = src.toObject();
    delete objData._id;
    objData.folder = folder?.id ?? null;
    // Fresh run: restore REZ to max on the copy.
    const max = objData.system?.stats?.rez?.max;
    if (typeof max === "number" && objData.system?.stats?.rez) {
      objData.system.stats.rez.value = max;
    }
    const actor = await Actor.create(objData);
    return actor?.id ?? null;
  } catch (e) { sysError(e); return null; }
}

/** Delete the (expected empty) per-architecture actor folder if it exists. */
export async function deleteEntityFolder(archName) {
  try {
    const root = game.folders?.find((f) => f.type === "Actor" && f.name === ROOT_FOLDER && !f.folder);
    if (!root) return true;
    const child = game.folders?.find(
      (f) => f.type === "Actor" && f.name === archName && f.folder?.id === root.id,
    );
    if (child) await child.delete();
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Rename the per-architecture actor folder (keeps its contents). */
export async function renameEntityFolder(oldName, newName) {
  try {
    if (oldName === newName) return true;
    const root = game.folders?.find((f) => f.type === "Actor" && f.name === ROOT_FOLDER && !f.folder);
    if (!root) return true;
    const child = game.folders?.find(
      (f) => f.type === "Actor" && f.name === oldName && f.folder?.id === root.id,
    );
    if (child) await child.update({ name: newName });
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Apply arbitrary override data ({name?, img?, system?}) onto a fresh actor. */
export async function applyActorOverrides(actorId, overrides) {
  try {
    if (!overrides || typeof overrides !== "object") return true;
    const actor = game.actors?.get(actorId);
    if (!actor) return false;
    const patch = {};
    if (typeof overrides.name === "string" && overrides.name) patch.name = overrides.name;
    if (typeof overrides.img === "string" && overrides.img) patch.img = overrides.img;
    if (overrides.system && typeof overrides.system === "object") patch.system = overrides.system;
    if (Object.keys(patch).length) await actor.update(patch);
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Snapshot the backing actor for export: {name, img, system:{stats}}. */
export function snapshotEntityActor(actorId) {
  try {
    const actor = game.actors?.get(actorId);
    if (!actor) return null;
    return {
      name: actor.name,
      img: actor.img,
      system: { stats: foundry.utils.deepClone(actor.system?.stats ?? {}) },
    };
  } catch (e) { return null; }
}

/** Bulk-delete entity actors by id, ignoring missing ones. */
export async function deleteEntityActors(actorIds) {
  try {
    const ids = (actorIds || []).filter((id) => game.actors?.get(id));
    if (ids.length) await Actor.deleteDocuments(ids);
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Roll an entity stat off the backing actor (blackIce/demon createStatRoll). */
export async function rollEntityStat(actor, statName, event) {
  try {
    event = event ?? { ctrlKey: true, metaKey: false, type: "auto" };
    if (!actor?.createStatRoll) { ui.notifications.error(loc("CRNS.Errors.SystemApi")); return null; }
    const roll = actor.createStatRoll(statName);
    if (!roll) return null;
    if (roll.setNetCombat) roll.setNetCombat(actor.name);
    const keepRolling = await roll.handleRollDialog(event, actor);
    if (!keepRolling) return null;
    await roll.roll();
    roll.entityData = { actor: actor.id };
    await CPRChat.RenderRollCard(roll);
    return roll;
  } catch (e) { sysError(e); return null; }
}

/** Roll entity damage. Formula comes from the constants table (arch ICE actors
 *  have no backing program item, so we build the damage roll directly). */
export async function rollEntityDamage(actor, formula, event) {
  try {
    event = event ?? { ctrlKey: true, metaKey: false, type: "auto" };
    if (!actor) { ui.notifications.error(loc("CRNS.Errors.SystemApi")); return null; }
    const roll = new CPRRolls.CPRDamageRoll(actor.name, formula, "program");
    if (roll.setNetCombat) roll.setNetCombat(actor.name);
    const keepRolling = await roll.handleRollDialog(event, actor);
    if (!keepRolling) return null;
    await roll.roll();
    roll.entityData = { actor: actor.id };
    await CPRChat.RenderRollCard(roll);
    return roll;
  } catch (e) { sysError(e); return null; }
}

/** Demon combat number: no dice, styled static chat card, speaker = actor. */
export async function rollDemonStatic(actor, cn) {
  try {
    const name = actor?.name ?? "";
    const line = loc("CRNS.Chat.DemonAction", { name, cn });
    const content =
      `<div class="crns-chat-card"><div class="crns-chat-title">${esc(name)}</div>` +
      `<div class="crns-chat-body">${line}</div></div>`;
    return ChatMessage.create({
      user: game.user.id,
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: name },
      content,
    });
  } catch (e) { sysError(e); return null; }
}

/** Apply "brain damage" straight to a netrunner's HP. In CPR RED, damage a
 *  netrunner takes inside the NET goes directly to HP (system.derivedStats.hp,
 *  verified against derivedStats-schema.js / HpSchema — min 0). Clamps to
 *  0..hp.max. GM-side only (called from the runner.damage OP). */
export async function damageRunnerHp(actorId, amount) {
  try {
    const actor = game.actors?.get(actorId);
    if (!actor) return false;
    const max = actor.system?.derivedStats?.hp?.max ?? 0;
    const cur = actor.system?.derivedStats?.hp?.value ?? 0;
    const next = Math.max(0, Math.min(max, cur - (Number(amount) || 0)));
    await actor.update({ "system.derivedStats.hp.value": next });
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Apply damage to an entity actor's REZ. GM-side only (called from OPS). */
export async function damageEntity(actorId, amount) {
  try {
    const actor = game.actors?.get(actorId);
    if (!actor) return false;
    const max = actor.system?.stats?.rez?.max ?? 0;
    const cur = actor.system?.stats?.rez?.value ?? 0;
    const next = Math.max(0, Math.min(max, cur - (Number(amount) || 0)));
    await actor.update({ "system.stats.rez.value": next });
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Set (and clamp) an entity actor's current REZ. GM-side only. */
export async function setEntityRez(actorId, value) {
  try {
    const actor = game.actors?.get(actorId);
    if (!actor) return false;
    const max = actor.system?.stats?.rez?.max ?? 0;
    const next = Math.max(0, Math.min(max, Number(value) || 0));
    await actor.update({ "system.stats.rez.value": next });
    return true;
  } catch (e) { sysError(e); return false; }
}

/** Restore an entity actor's REZ to its maximum. GM-side only. */
export async function restoreEntity(actorId) {
  try {
    const actor = game.actors?.get(actorId);
    if (!actor) return false;
    const max = actor.system?.stats?.rez?.max ?? 0;
    await actor.update({ "system.stats.rez.value": max });
    return true;
  } catch (e) { sysError(e); return false; }
}
