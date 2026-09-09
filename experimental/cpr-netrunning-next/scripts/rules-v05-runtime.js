/* Netrunning Lab 0.5 — rules-aware Black ICE encounter runtime.
 *
 * The layer is additive to 0.4: Control Node activation remains governed by the
 * 0.4 transactional once-per-Turn implementation. 0.5 concentrates on the
 * Black ICE encounter → SPEED/Cloak → pursuit → Slide lifecycle.
 */
import { LabRuntimeService } from "./runtime-service.js";
import * as rules from "./rules.js";

export const LAB_RULES_VERSION = "0.5";
const baseMove = LabRuntimeService.prototype.move;
const baseJackIn = LabRuntimeService.prototype.jackIn;
const baseJackOut = LabRuntimeService.prototype.jackOut;
const baseResolveSlide = LabRuntimeService.prototype.resolveSlide;

const unique = (list) => [...new Set((list || []).filter(Boolean))];
const refForIce = (entity) => `ice:${entity.id}`;
const refId = (ref) => String(ref || "").startsWith("ice:") ? String(ref).slice(4) : "";

function normalizeRunner(runner) {
  if (!runner) return runner;
  runner.engagedIceRefs = unique(runner.engagedIceRefs);
  runner.encounteredIceRefs = unique(runner.encounteredIceRefs);
  runner.slidIceRefs = unique(runner.slidIceRefs);
  runner.evadedEntityRefs = unique(runner.evadedEntityRefs);
  return runner;
}
function normalizeEncounterState(state) {
  state.encounters ||= {};
  state.freeIceEffects ||= {};
  state.icePositions ||= {};
  return state;
}

export function findBlackIceByRef(arch, ref) {
  const id = refId(ref);
  if (!id || !arch) return null;
  for (const node of arch.nodes || []) {
    const entity = (node.entities || []).find((item) => item.kind === "blackice" && item.id === id);
    if (entity) return { node, entity, ref: `ice:${entity.id}` };
  }
  return null;
}
function iceIsAlive(entity) {
  if (!entity?.actorId) return false;
  const actor = game.actors?.get(entity.actorId);
  return !!actor && Number(actor.system?.stats?.rez?.value ?? 0) > 0;
}
function iceAtNode(arch, state, nodeId) {
  const out = [];
  for (const source of arch?.nodes || []) {
    for (const entity of (source.entities || []).filter((item) => item.kind === "blackice")) {
      const ref = refForIce(entity);
      const position = state.icePositions?.[ref] || source.id;
      if (position === nodeId && iceIsAlive(entity)) out.push({ source, entity, ref });
    }
  }
  return out;
}
function runnerBlockingState(state, runnerId) {
  const pending = Object.values(state.encounters || {}).filter((enc) => enc.runnerId === runnerId && enc.status === "pending");
  const effects = Object.values(state.freeIceEffects || {}).filter((fx) => fx.runnerId === runnerId);
  return { pending, effects, blocked: pending.length > 0 || effects.length > 0 };
}

/* Foundry v12 has one initiative tracker for meatspace and NET combat. Black ICE
 * does not roll Initiative: when triggered it is placed at the top of the queue.
 * We therefore only manipulate the Combatant ordering; the SPEED check is a
 * separate opposed check and never becomes the ICE initiative value. */
export async function queueBlackIce(actorId, runnerActorUuid = "") {
  if (!game.user.isGM || !actorId) return false;
  const iceActor = game.actors?.get(actorId);
  if (!iceActor) return false;
  let combat = game.combat;
  if (!combat) combat = await Combat.create({ scene: canvas?.scene?.id ?? null, active: true });
  if (!combat) return false;

  if (runnerActorUuid) {
    const runnerActor = await fromUuid(runnerActorUuid);
    if (runnerActor) {
      let runnerCombatant = combat.combatants.find((c) => c.actorId === runnerActor.id);
      if (!runnerCombatant) runnerCombatant = (await combat.createEmbeddedDocuments("Combatant", [{ actorId: runnerActor.id }]))?.[0] || null;
      if (runnerCombatant && runnerCombatant.initiative == null) {
        const ref = Number(runnerActor.system?.stats?.ref?.value ?? 0);
        const initRoll = new Roll(`1d10 + ${ref}`);
        await initRoll.evaluate();
        await initRoll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: runnerActor }), flavor: "Initiative" });
        await combat.setInitiative(runnerCombatant.id, initRoll.total);
      }
    }
  }

  let iceCombatant = combat.combatants.find((c) => c.actorId === actorId);
  if (!iceCombatant) iceCombatant = (await combat.createEmbeddedDocuments("Combatant", [{ actorId }]))?.[0] || null;
  if (!iceCombatant) return false;
  const otherInitiatives = combat.combatants.filter((c) => c.id !== iceCombatant.id).map((c) => c.initiative).filter(Number.isFinite);
  const top = otherInitiatives.length ? Math.max(...otherInitiatives) : 0;
  await combat.setInitiative(iceCombatant.id, top + 1);
  if (!combat.started) await combat.startCombat();
  return true;
}

async function registerCurrentFloorEncounters(service, runnerId) {
  const state = normalizeEncounterState(await service.store.getRuntime());
  const arch = await service.architecture(state);
  const runner = normalizeRunner(state.runners?.[runnerId]);
  if (!arch || !runner?.jackedIn) return [];
  const node = arch.nodes.find((n) => n.id === runner.currentNodeId);
  if (!node) return [];

  const present = iceAtNode(arch, state, node.id);
  const created = [];
  await service.store.mutateRuntime((next) => {
    normalizeEncounterState(next);
    const current = normalizeRunner(next.runners?.[runnerId]);
    if (!current) return;

    /* Black ICE already pursuing this runner shares their virtual floor. */
    for (const ref of current.engagedIceRefs) next.icePositions[ref] = node.id;

    for (const { entity, ref } of present) {
      if (current.engagedIceRefs.includes(ref)) continue;
      if (Object.values(next.encounters).some((enc) => enc.runnerId === runnerId && enc.ref === ref && enc.status === "pending")) continue;

      const encounter = {
        id: `enc_${foundry.utils.randomID(12)}`,
        runnerId, ref, entityId: entity.id, actorId: entity.actorId || "",
        name: entity.label || "Black ICE", nodeId: node.id,
        mode: current.stealthed ? "stealth" : "speed",
        status: "pending", createdAt: Date.now()
      };
      next.encounters[encounter.id] = encounter;
      next.icePositions[ref] = node.id;

      /* A normal encounter triggers the ICE immediately: it follows and moves to
       * the top of Initiative regardless of the SPEED result. Under Going Quiet,
       * a successful Cloak-vs-PER check means it never notices the Netrunner and
       * therefore is not queued or marked encountered. */
      if (encounter.mode === "speed") {
        current.engagedIceRefs = unique([...current.engagedIceRefs, ref]);
        current.encounteredIceRefs = unique([...current.encounteredIceRefs, ref]);
      }
      created.push({ ...encounter, runnerActorUuid: current.actorUuid });
    }
  });

  for (const encounter of created) if (encounter.mode === "speed" && encounter.actorId) await queueBlackIce(encounter.actorId, encounter.runnerActorUuid);
  if (created.length) Hooks.callAll("cprNetrunningLabIceEncountered", { runnerId, encounters: created });
  return created;
}

LabRuntimeService.prototype.encounterBlock = async function encounterBlockV05(runnerId) {
  const state = normalizeEncounterState(await this.store.getRuntime());
  return runnerBlockingState(state, runnerId);
};

LabRuntimeService.prototype.move = async function moveV05(runnerId, nodeId) {
  const before = normalizeEncounterState(await this.store.getRuntime());
  const block = runnerBlockingState(before, runnerId);
  if (block.pending.length) throw new Error("Resolve the Black ICE encounter before moving again.");
  if (block.effects.length) throw new Error("Resolve the pending Black ICE effect before continuing the Netrun.");
  const result = await baseMove.call(this, runnerId, nodeId);

  /* Every Black ICE still following the runner moves with them. */
  await this.store.mutateRuntime((state) => {
    normalizeEncounterState(state);
    const runner = normalizeRunner(state.runners?.[runnerId]);
    if (!runner) return;
    for (const ref of runner.engagedIceRefs) state.icePositions[ref] = runner.currentNodeId || nodeId;
  });
  await registerCurrentFloorEncounters(this, runnerId);
  return result;
};

LabRuntimeService.prototype.jackIn = async function jackInV05(runnerId, options = {}) {
  const result = await baseJackIn.call(this, runnerId, options);
  await registerCurrentFloorEncounters(this, runnerId);
  return result;
};

LabRuntimeService.prototype.jackOut = async function jackOutV05(runnerId) {
  const before = normalizeEncounterState(await this.store.getRuntime());
  const runner = normalizeRunner(before.runners?.[runnerId]);
  const refs = [...(runner?.engagedIceRefs || [])];
  const result = await baseJackOut.call(this, runnerId);
  await this.store.mutateRuntime((state) => {
    normalizeEncounterState(state);
    for (const [id, enc] of Object.entries(state.encounters)) if (enc.runnerId === runnerId) delete state.encounters[id];
    for (const [id, fx] of Object.entries(state.freeIceEffects)) if (fx.runnerId === runnerId) delete state.freeIceEffects[id];
    for (const ref of refs) delete state.icePositions[ref];
  });
  return result;
};

LabRuntimeService.prototype.resolveIceEncounter = async function resolveIceEncounterV05(runnerId, encounterId, { runnerTotal = 0, iceTotal = 0 } = {}) {
  const snapshot = normalizeEncounterState(await this.store.getRuntime());
  const arch = await this.architecture(snapshot);
  let outcome = null;
  const queueLater = [];

  await this.store.mutateRuntime((state) => {
    normalizeEncounterState(state);
    const encounter = state.encounters?.[encounterId];
    const runner = normalizeRunner(state.runners?.[runnerId]);
    if (!encounter || encounter.runnerId !== runnerId || encounter.status !== "pending" || !runner) throw new Error("Black ICE encounter is no longer pending.");

    const effectId = `fx_${foundry.utils.randomID(12)}`;
    if (encounter.mode === "speed") {
      const avoided = rules.speedCheckAvoided(runnerTotal, iceTotal);
      outcome = { mode:"speed", success:avoided, avoided, encounter:{...encounter}, runnerTotal, iceTotal };
      if (!avoided) state.freeIceEffects[effectId] = { id:effectId, runnerId, ref:encounter.ref, actorId:encounter.actorId, name:encounter.name, nodeId:encounter.nodeId, source:"failed-speed", createdAt:Date.now() };
      delete state.encounters[encounterId];
      return;
    }

    const avoided = rules.stealthIceAvoided(runnerTotal, iceTotal);
    outcome = { mode:"stealth", success:avoided, avoided, encounter:{...encounter}, runnerTotal, iceTotal };
    delete state.encounters[encounterId];
    if (avoided) {
      runner.evadedEntityRefs = unique([...runner.evadedEntityRefs, encounter.ref]);
      return;
    }

    /* Going Quiet failure: stealth breaks. The failed ICE applies its effect as
     * though SPEED failed, enters the queue, and all other Black ICE on this
     * floor now react normally. That includes one the runner had just evaded
     * while still stealthed. */
    runner.stealthed = false;
    runner.engagedIceRefs = unique([...runner.engagedIceRefs, encounter.ref]);
    runner.encounteredIceRefs = unique([...runner.encounteredIceRefs, encounter.ref]);
    runner.evadedEntityRefs = runner.evadedEntityRefs.filter((ref) => ref !== encounter.ref);
    state.freeIceEffects[effectId] = { id:effectId, runnerId, ref:encounter.ref, actorId:encounter.actorId, name:encounter.name, nodeId:encounter.nodeId, source:"stealth-detected", createdAt:Date.now() };
    queueLater.push({ actorId:encounter.actorId, runnerActorUuid:runner.actorUuid });

    const onFloor = iceAtNode(arch, state, encounter.nodeId);
    for (const { entity, ref } of onFloor) {
      if (ref === encounter.ref || runner.engagedIceRefs.includes(ref)) continue;
      for (const [otherId, other] of Object.entries(state.encounters)) {
        if (other.runnerId === runnerId && other.ref === ref) delete state.encounters[otherId];
      }
      runner.evadedEntityRefs = runner.evadedEntityRefs.filter((old) => old !== ref);
      runner.engagedIceRefs = unique([...runner.engagedIceRefs, ref]);
      runner.encounteredIceRefs = unique([...runner.encounteredIceRefs, ref]);
      const nextEncounter = { id:`enc_${foundry.utils.randomID(12)}`, runnerId, ref, entityId:entity.id, actorId:entity.actorId||"", name:entity.label||"Black ICE", nodeId:encounter.nodeId, mode:"speed", status:"pending", createdAt:Date.now() };
      state.encounters[nextEncounter.id] = nextEncounter;
      queueLater.push({ actorId:entity.actorId, runnerActorUuid:runner.actorUuid });
    }
  });

  for (const entry of queueLater) if (entry.actorId) await queueBlackIce(entry.actorId, entry.runnerActorUuid);
  if (outcome) Hooks.callAll("cprNetrunningLabEncounterResolved", outcome);
  return outcome;
};

LabRuntimeService.prototype.ackIceEffect = async function ackIceEffectV05(runnerId, effectId) {
  let removed = null;
  await this.store.mutateRuntime((state) => {
    normalizeEncounterState(state);
    const effect = state.freeIceEffects?.[effectId];
    if (!effect || effect.runnerId !== runnerId) throw new Error("Pending Black ICE effect not found.");
    removed = { ...effect };
    delete state.freeIceEffects[effectId];
  });
  if (removed) Hooks.callAll("cprNetrunningLabIceEffectAcknowledged", removed);
  return removed;
};

LabRuntimeService.prototype.resolveSlide = async function resolveSlideV05(runnerId, ref, success, destinationNodeId = "") {
  const state = normalizeEncounterState(await this.store.getRuntime());
  const arch = await this.architecture(state);
  const runner = normalizeRunner(state.runners?.[runnerId]);
  if (!runner?.engagedIceRefs.includes(ref)) throw new Error("Slide can target only Black ICE currently following this Netrunner.");
  if (runner.slideUsed) throw new Error("Slide can only be attempted once per Turn.");
  if (success) {
    if (!destinationNodeId || !rules.neighborIds(arch.nodes, runner.currentNodeId).includes(destinationNodeId)) throw new Error("A successful Slide must move to an adjacent NET floor.");
    const movement = rules.canMove(arch.nodes, runner.currentNodeId, destinationNodeId, state.floorState || {});
    if (!movement.ok) throw new Error("That NET obstruction blocks the Slide destination.");
  }

  const originNodeId = runner.currentNodeId;
  const result = await baseResolveSlide.call(this, runnerId, ref, success, success ? destinationNodeId : "");
  if (success) {
    /* The escaped ICE stays behind on the floor where Slide broke pursuit. If the
     * runner later returns to that floor, it is encountered again normally. */
    await this.store.mutateRuntime((next) => {
      normalizeEncounterState(next);
      next.icePositions[ref] = originNodeId;
    });
  }
  Hooks.callAll("cprNetrunningLabSlideResolved", { runnerId, ref, success:!!success, fromNodeId:originNodeId, toNodeId:success?destinationNodeId:"" });
  return result;
};

Hooks.once("ready", () => {
  globalThis.CRNSL ||= {};
  globalThis.CRNSL.rulesVersion = LAB_RULES_VERSION;
  globalThis.CRNSL.blackIcePolicy = Object.freeze({
    speedTieFavorsRunner:true,
    slideTieFavorsIce:true,
    stealthTieFavorsIce:true,
    slideRequiresAdjacentMove:true,
    escapedIceLaysInWait:true,
    unresolvedImmediateEffectBlocksFurtherNetActions:true,
    blackIceAttackTurnsRemainManual:true
  });
});
