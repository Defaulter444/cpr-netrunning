/* Netrunning Lab 0.5 — Black ICE request/roll bridge.
 * Player rolls remain native cyberpunk-red-core rolls and are verified by the
 * authoritative GM using the existing one-use grant mechanism.
 */
import { ID } from "./store.js";
import { LabRequestController } from "./request-controller.js";
import { publishAllProjections } from "./projection.js";
import { rollBlackIcePerception, rollBlackIceSpeed } from "./entity-rolls.js";
import { findBlackIceByRef } from "./rules-v05-runtime.js";
import * as rules from "./rules.js";

/* request-v04 is loaded before this file, so delegating executeControl to
 * baseHandle preserves its transactional once-per-Turn Control Node logic. */
const baseHandle = LabRequestController.prototype.handle;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

async function postComparison({ title, runnerName, runnerTotal, iceName, iceTotal, success, detail = "" }) {
  const icon = success ? "fa-shield-check" : "fa-triangle-exclamation";
  const content = `<div class="crnsl-chat-roll"><div><i class="fas ${icon}"></i> <strong>${esc(title)}</strong></div><div>${esc(runnerName)} <b>${Number(runnerTotal)||0}</b> · ${esc(iceName)} <b>${Number(iceTotal)||0}</b></div>${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
  await ChatMessage.create({ user: game.user.id, content, flags: { [ID]: { encounterSummary: true } } });
}

async function activeRunner(controller, request, user) {
  const state = await controller.store.getRuntime();
  const runner = state?.runners?.[request.runnerId];
  if (!runner) throw new Error("Runner not found.");
  controller._authorize(user, runner);
  return { state, runner };
}
async function ensureNotEncounterBlocked(controller, runnerId) {
  const block = await controller.runtime.encounterBlock(runnerId);
  if (block.pending.length) throw new Error("Resolve the Black ICE encounter first.");
  if (block.effects.length) throw new Error("Resolve the pending Black ICE effect first.");
}

LabRequestController.prototype.handle = async function handleV05(user, request) {
  if (!request || typeof request.op !== "string") throw new Error("Invalid NET request.");

  if (request.op === "beginEncounter") {
    const { state, runner } = await activeRunner(this, request, user);
    const encounter = state.encounters?.[request.encounterId];
    if (!encounter || encounter.runnerId !== runner.id || encounter.status !== "pending") throw new Error("Black ICE encounter not found.");
    if (runner.currentNodeId !== encounter.nodeId) throw new Error("The Netrunner is no longer on the encounter floor.");
    return this._grant(user, runner, state, "encounter", { encounterId:encounter.id, mode:encounter.mode, ref:encounter.ref });
  }

  if (request.op === "completeEncounter") {
    const { grant, state, runner, total } = await this._verifyCompletion(user, request, "encounter");
    const encounter = state.encounters?.[grant.data.encounterId];
    if (!encounter || encounter.runnerId !== runner.id) throw new Error("Black ICE encounter changed while the roll was open.");
    const arch = await this.store.get(state.activeArchitectureId);
    const found = findBlackIceByRef(arch, encounter.ref);
    if (!found?.entity?.actorId) throw new Error("Black ICE Actor is unavailable.");
    const enemy = encounter.mode === "stealth" ? await rollBlackIcePerception(found.entity) : await rollBlackIceSpeed(found.entity);
    const iceTotal = Number(enemy?.total ?? 0);
    const result = await this.runtime.resolveIceEncounter(runner.id, encounter.id, { runnerTotal:total, iceTotal });
    await publishAllProjections(this.store);
    await postComparison({
      title: encounter.mode === "stealth" ? "Cloak vs Black ICE PER" : "Black ICE SPEED Check",
      runnerName:runner.name, runnerTotal:total, iceName:encounter.name, iceTotal, success:!!result?.success,
      detail: encounter.mode === "stealth"
        ? (result?.success ? "Stealth maintained; Black ICE never detected the Netrunner." : "Detected: stealth breaks and the Black ICE immediate effect resolves as a failed SPEED Check.")
        : (result?.success ? "The Netrunner avoids the Black ICE immediate effect." : "Failed SPEED: resolve the Black ICE effect before continuing.")
    });
    return result;
  }

  if (request.op === "ackIceEffect") {
    const { runner } = await activeRunner(this, request, user);
    if (!user?.isGM) throw new Error("Only the GM can confirm a Black ICE effect has been resolved.");
    const removed = await this.runtime.ackIceEffect(runner.id, request.effectId);
    await publishAllProjections(this.store);
    return { ok:true, removed };
  }

  /* Slide is now exposed because the full action flow exists: valid pursuing
   * non-Demon Black ICE target, once per Turn, 1 NET Action, opposed PER, and a
   * required adjacent destination that cannot cross a NET obstruction. */
  if (request.op === "beginAbility" && request.ability === "slide") {
    const { state, runner } = await activeRunner(this, request, user);
    await ensureNotEncounterBlocked(this, runner.id);
    if (!runner.jackedIn) throw new Error("Jack In first.");
    if (runner.slideUsed) throw new Error("Slide can only be attempted once per Turn.");
    const ref = String(runner.targetRef || "");
    if (!ref.startsWith("ice:") || !(runner.engagedIceRefs || []).includes(ref)) throw new Error("Target Black ICE that is currently following this Netrunner.");
    if (Number(runner.actionsUsed || 0) >= Number(runner.actionsMax || 0)) throw new Error("No NET Actions remaining this Turn.");
    const arch = await this.store.get(state.activeArchitectureId);
    const destinationNodeId = String(request.destinationNodeId || "");
    if (!rules.neighborIds(arch?.nodes || [], runner.currentNodeId).includes(destinationNodeId)) throw new Error("Choose an adjacent NET floor for Slide.");
    const movement = rules.canMove(arch.nodes, runner.currentNodeId, destinationNodeId, state.floorState || {});
    if (!movement.ok) throw new Error("A NET obstruction blocks that Slide destination.");
    return this._grant(user, runner, state, "ability", { ability:"slide", nodeId:runner.currentNodeId, ref, destinationNodeId });
  }

  if (request.op === "completeAbility") {
    const pendingGrant = this.grants.get(request.token);
    if (pendingGrant?.kind === "ability" && pendingGrant.data?.ability === "slide") {
      const { grant, state, runner, total } = await this._verifyCompletion(user, request, "ability");
      const arch = await this.store.get(state.activeArchitectureId);
      const found = findBlackIceByRef(arch, grant.data.ref);
      if (!found?.entity?.actorId) throw new Error("Black ICE Actor is unavailable.");
      const enemy = await rollBlackIcePerception(found.entity);
      const iceTotal = Number(enemy?.total ?? 0);
      const success = rules.slideCheckSucceeded(total, iceTotal);
      await this.runtime.resolveSlide(runner.id, grant.data.ref, success, success ? grant.data.destinationNodeId : "");
      await publishAllProjections(this.store);
      await postComparison({
        title:"Slide", runnerName:runner.name, runnerTotal:total,
        iceName:found.entity.label || "Black ICE", iceTotal, success,
        detail: success ? "Pursuit broken; the Netrunner immediately moves to the chosen adjacent floor and the Black ICE lays in wait behind them." : "The Black ICE keeps following."
      });
      return { ability:"slide", success, runnerTotal:total, iceTotal, ref:grant.data.ref, destinationNodeId:success?grant.data.destinationNodeId:"" };
    }
  }

  /* Immediate Black ICE encounter/effect resolution cannot be skipped by using
   * another NET action. Control Node execution still delegates to request-v04,
   * which enforces its once-per-Turn activation and transactional Foundry update. */
  if (["programToggle", "jackOut", "beginAbility", "executeControl"].includes(request.op)) {
    const { runner } = await activeRunner(this, request, user);
    await ensureNotEncounterBlocked(this, runner.id);
  }

  return baseHandle.call(this, user, request);
};
