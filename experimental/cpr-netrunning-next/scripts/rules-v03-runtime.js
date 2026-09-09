/* Lab 0.3 rules-hardening layer.
 *
 * This file is intentionally small and additive. It patches the experimental
 * runtime only; production `cpr-netrunning` is never imported or mutated here.
 */

import { LabRuntimeService } from "./runtime-service.js";

export const LAB_RULES_VERSION = "0.3";

export function controlActivationKey(nodeId, turnSerial) {
  return `${String(nodeId || "")}:${Math.max(0, Math.trunc(Number(turnSerial) || 0))}`;
}

/* Cyberpunk RED: taking a Control Node and activating the thing behind it are
 * separate NET Actions. A specific Control Node may be activated only once per
 * Turn. The 0.2 runtime already charged the activation action, but did not
 * remember that the node had been used this Turn.
 *
 * Make the validation + action spend + marker one atomic GM-side mutation so a
 * rejected second activation never consumes an action.
 */
LabRuntimeService.prototype.activateControlledNode = async function activateControlledNodeV03(runnerId, nodeId) {
  await this.store.mutateRuntime((state) => {
    const runner = state.runners?.[runnerId];
    const fx = state.floorState?.[nodeId];
    if (!runner || fx?.control?.runnerId !== runnerId) {
      throw new Error("This Netrunner does not control that Control Node.");
    }

    const turn = Math.max(0, Math.trunc(Number(state.turnSerial) || 0));
    const key = controlActivationKey(nodeId, turn);
    state.controlActivations ||= {};
    if (state.controlActivations[key]) {
      throw new Error("This Control Node has already been activated this Turn.");
    }

    this._spend(runner, 1);
    state.controlActivations[key] = { runnerId, nodeId, turn };

    /* Keep the private runtime compact. Old entries have no mechanical use. */
    for (const [oldKey, value] of Object.entries(state.controlActivations)) {
      if (Number(value?.turn ?? -999) < turn - 2) delete state.controlActivations[oldKey];
    }
  });
};

Hooks.once("ready", () => {
  globalThis.CRNSL ||= {};
  globalThis.CRNSL.rulesVersion = LAB_RULES_VERSION;
  globalThis.CRNSL.rulePolicy = Object.freeze({
    scannerInsideArchitecture: false,
    controlActivationOncePerTurn: true,
    unfinishedCombatAutomationIsHidden: true
  });
});
