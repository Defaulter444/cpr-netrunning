/* Lab 0.4 request hardening.
 * Intercepts Control Node scene execution so the NET Action + once-per-Turn
 * reservation is created before the Foundry Scene mutation, and rolled back if
 * the Scene Document update fails.
 */
import { LabRequestController } from "./request-controller.js";
import { publishAllProjections } from "./projection.js";

const baseHandle = LabRequestController.prototype.handle;

function controlActions(documentName) {
  return {
    Wall: ["open", "close", "lock", "unlock"],
    Token: ["show", "hide"],
    Tile: ["show", "hide"],
    AmbientLight: ["enable", "disable"],
    AmbientSound: ["enable", "disable"]
  }[documentName] || [];
}

async function executeSceneControl(control) {
  const doc = await fromUuid(control.uuid);
  if (!doc || doc.documentName !== control.documentType) throw new Error("Linked Scene Document is unavailable or changed type.");
  if (!controlActions(doc.documentName).includes(control.action)) throw new Error("Unsupported Control Node action.");

  if (doc.documentName === "Wall") {
    if (!(doc.door > 0)) throw new Error("Linked Wall is not a door.");
    await doc.update({ ds: { open: 1, close: 0, lock: 2, unlock: 0 }[control.action] });
  } else if (doc.documentName === "Token" || doc.documentName === "Tile") {
    await doc.update({ hidden: control.action === "hide" });
  } else {
    await doc.update({ hidden: control.action === "disable" });
  }
}

LabRequestController.prototype.handle = async function handleV04(user, request) {
  if (request?.op !== "executeControl") return baseHandle.call(this, user, request);

  const state = await this.store.getRuntime();
  const runner = state?.runners?.[request.runnerId];
  if (!runner) throw new Error("Runner not found.");
  this._authorize(user, runner);

  const arch = await this.store.get(state.activeArchitectureId);
  const node = arch?.nodes?.find((n) => n.id === request.nodeId);
  const control = node?.controls?.find((c) => c.id === request.controlId);
  if (!node || !control) throw new Error("Control Node binding not found.");

  const ticket = await this.runtime.reserveControlledNodeActivation(runner.id, node.id);
  try {
    await executeSceneControl(control);
  } catch (error) {
    await this.runtime.rollbackControlledNodeActivation(ticket);
    await publishAllProjections(this.store);
    throw error;
  }

  await publishAllProjections(this.store);
  Hooks.callAll("cprNetrunningLabControlExecuted", {
    runnerId: runner.id,
    nodeId: node.id,
    controlId: control.id,
    label: control.label,
    action: control.action
  });
  return { ok: true, label: control.label, action: control.action };
};
