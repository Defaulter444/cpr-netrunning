/* Lab 0.4 rules-hardening.
 * Reservation semantics make Control Node execution safe even when the linked
 * Foundry Scene Document throws during update.
 */
import { LabRuntimeService } from "./runtime-service.js";

export const LAB_RULES_VERSION = "0.4";
export const controlActivationKeyV04 = (nodeId, turnSerial) => `${String(nodeId || "")}:${Math.max(0, Math.trunc(Number(turnSerial) || 0))}`;

LabRuntimeService.prototype.reserveControlledNodeActivation = async function reserveControlledNodeActivation(runnerId, nodeId) {
  const reservation = foundry.utils.randomID(16);
  let key = "";
  await this.store.mutateRuntime((state) => {
    const runner = state.runners?.[runnerId];
    const fx = state.floorState?.[nodeId];
    if (!runner || fx?.control?.runnerId !== runnerId) throw new Error("This Netrunner does not control that Control Node.");

    const turn = Math.max(0, Math.trunc(Number(state.turnSerial) || 0));
    key = controlActivationKeyV04(nodeId, turn);
    state.controlActivations ||= {};
    if (state.controlActivations[key]) throw new Error("This Control Node has already been activated this Turn.");

    this._spend(runner, 1);
    state.controlActivations[key] = { runnerId, nodeId, turn, reservation };
  });
  return { key, reservation, runnerId, nodeId };
};

LabRuntimeService.prototype.rollbackControlledNodeActivation = async function rollbackControlledNodeActivation(ticket) {
  if (!ticket?.key || !ticket?.reservation) return;
  await this.store.mutateRuntime((state) => {
    const current = state.controlActivations?.[ticket.key];
    if (!current || current.reservation !== ticket.reservation) return;
    const runner = state.runners?.[ticket.runnerId];
    if (runner) runner.actionsUsed = Math.max(0, Number(runner.actionsUsed || 0) - 1);
    delete state.controlActivations[ticket.key];
  });
};

/* Keep direct callers rules-safe too. The request controller uses the reservation
 * method so it can roll back if a Foundry Scene update fails. */
LabRuntimeService.prototype.activateControlledNode = async function activateControlledNodeV04(runnerId, nodeId) {
  return this.reserveControlledNodeActivation(runnerId, nodeId);
};

Hooks.once("ready", () => {
  globalThis.CRNSL ||= {};
  globalThis.CRNSL.rulesVersion = LAB_RULES_VERSION;
  globalThis.CRNSL.rulePolicy = Object.freeze({
    scannerInsideArchitecture: false,
    controlActivationOncePerTurn: true,
    controlActivationRollbackOnSceneFailure: true,
    unfinishedCombatAutomationIsHidden: true
  });
});
