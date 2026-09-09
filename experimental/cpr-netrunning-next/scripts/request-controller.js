import { ID } from "./store.js";
import { publishAllProjections } from "./projection.js";
import { rollPlainInterface, setProgramRezzed } from "./runner-profile.js";
import { rollWatcherInterface } from "./entity-rolls.js";

function uid() {
  return foundry.utils.randomID(24);
}

function validMessage(user, grant, messageId) {
  const message = game.messages.get(messageId);
  const flag = message?.getFlag(ID, "playerRoll");
  if (!message || message.author?.id !== user.id) return null;
  if (!flag || flag.token !== grant.token || flag.actorUuid !== grant.actorUuid) return null;
  if (!Number.isFinite(Number(flag.total))) return null;
  return { message, total: Number(flag.total) };
}

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

export class LabRequestController {
  constructor(store, runtimeService) {
    this.store = store;
    this.runtime = runtimeService;
    this.grants = new Map();
  }

  async handle(user, request) {
    if (!request || typeof request.op !== "string") throw new Error("Invalid NET request.");
    if (request.op === "cancelRoll") {
      const grant = this.grants.get(request.token);
      if (grant?.userId === user.id) this.grants.delete(request.token);
      return true;
    }

    const state = await this.store.getRuntime();
    const runner = state?.runners?.[request.runnerId];
    if (!runner) throw new Error("Runner not found.");
    this._authorize(user, runner);

    switch (request.op) {
      case "move":
        await this.runtime.move(runner.id, request.nodeId);
        await publishAllProjections(this.store);
        return { ok: true };

      case "startTurn":
        if (!user?.isGM) throw new Error("Only the GM can manually reset a NET Turn. Combat turns reset automatically.");
        await this.runtime.startTurn(runner.id);
        await publishAllProjections(this.store);
        return { ok: true };

      case "jackIn":
        if (runner.jackedIn) throw new Error("Runner is already Jacked In.");
        await this.runtime.jackIn(runner.id, { quiet: false });
        await publishAllProjections(this.store);
        return { ok: true };

      case "jackOut":
        if (!runner.jackedIn) throw new Error("Runner is not Jacked In.");
        await this.runtime.jackOut(runner.id);
        await publishAllProjections(this.store);
        return { ok: true };

      case "beginAbility":
        return this._grant(user, runner, state, "ability", {
          ability: request.ability,
          nodeId: request.nodeId,
          virusText: String(request.virusText || "")
        });

      case "completeAbility":
        return this._completeAbility(user, request);

      case "beginQuietJack":
        if (runner.jackedIn) throw new Error("Runner is already Jacked In.");
        if (Number(runner.actionsMax || 0) - Number(runner.actionsUsed || 0) < 2) throw new Error("Quiet Jack In needs two NET Actions.");
        return this._grant(user, runner, state, "quietJack", {});

      case "completeQuietJack":
        return this._completeQuietJack(user, request);

      case "programToggle": {
        if (Number(runner.actionsUsed || 0) >= Number(runner.actionsMax || 0)) throw new Error("No NET Actions remaining this Turn.");
        const actor = await fromUuid(runner.actorUuid);
        if (!actor) throw new Error("Runner Actor is unavailable.");
        await setProgramRezzed(actor, request.programId, !!request.rezzed);
        await this.runtime.spendAction(runner.id, 1);
        await this.runtime.refreshRunner(runner.id);
        await publishAllProjections(this.store);
        return { ok: true };
      }

      case "executeControl": {
        if (Number(runner.actionsUsed || 0) >= Number(runner.actionsMax || 0)) throw new Error("No NET Actions remaining this Turn.");
        const arch = await this.store.get(state.activeArchitectureId);
        const node = arch?.nodes?.find((n) => n.id === request.nodeId);
        const control = node?.controls?.find((c) => c.id === request.controlId);
        if (!control) throw new Error("Control Node binding not found.");
        if (state.floorState?.[node.id]?.control?.runnerId !== runner.id) throw new Error("Take control of this Control Node first.");
        await executeSceneControl(control);
        await this.runtime.activateControlledNode(runner.id, node.id);
        await publishAllProjections(this.store);
        return { ok: true, label: control.label, action: control.action };
      }

      case "setTarget":
        await this.runtime.setTarget(runner.id, request.ref || "");
        await publishAllProjections(this.store);
        return { ok: true };

      default:
        throw new Error(`Unknown NET request: ${request.op}`);
    }
  }

  _authorize(user, runner) {
    if (user?.isGM) return true;
    if (!runner.userId || runner.userId !== user?.id) throw new Error("You do not control this Netrunner.");
    return true;
  }

  _grant(user, runner, _state, kind, data) {
    const token = uid();
    const grant = {
      token,
      kind,
      userId: user.id,
      runnerId: runner.id,
      actorUuid: runner.actorUuid,
      currentNodeId: runner.currentNodeId,
      actionsUsed: Number(runner.actionsUsed || 0),
      deckId: runner.deckId,
      expires: Date.now() + 10 * 60 * 1000,
      data
    };
    this.grants.set(token, grant);
    return { token, kind, actorUuid: runner.actorUuid, ...data };
  }

  async _verifyCompletion(user, request, kind) {
    const grant = this.grants.get(request.token);
    if (!grant || grant.kind !== kind || grant.userId !== user.id || Date.now() > grant.expires) throw new Error("Roll grant expired or does not match.");
    const state = await this.store.getRuntime();
    const runner = state.runners?.[grant.runnerId];
    this._authorize(user, runner);
    if (!runner || runner.actorUuid !== grant.actorUuid || runner.currentNodeId !== grant.currentNodeId || Number(runner.actionsUsed || 0) !== grant.actionsUsed || runner.deckId !== grant.deckId) {
      throw new Error("NET state changed while the roll was open. Cancel and try again.");
    }
    const verified = validMessage(user, grant, request.messageId);
    if (!verified) throw new Error("Matching native CPR roll card not found.");
    this.grants.delete(grant.token);
    return { grant, state, runner, total: verified.total };
  }

  async _completeAbility(user, request) {
    const { grant, total } = await this._verifyCompletion(user, request, "ability");
    const result = await this.runtime.applyAbilityResult(grant.runnerId, grant.data.ability, grant.data.nodeId, total, { virusText: grant.data.virusText });
    await publishAllProjections(this.store);
    return result;
  }

  async _completeQuietJack(user, request) {
    const { grant, state, total } = await this._verifyCompletion(user, request, "quietJack");
    const arch = await this.store.get(state.activeArchitectureId);
    const watcherTotals = [];

    for (const node of arch?.nodes || []) {
      for (const entity of node.entities || []) {
        if (entity.kind !== "demon" || !entity.actorId) continue;
        const rolled = await rollWatcherInterface(entity);
        watcherTotals.push({ id: entity.id, name: entity.label, total: rolled.total });
      }
    }

    for (const other of Object.values(state.runners || {})) {
      if (other.id === grant.runnerId || !other.jackedIn || !other.watcher) continue;
      const actor = await fromUuid(other.actorUuid);
      if (!actor) continue;
      const rolled = await rollPlainInterface(actor, { type: "auto", ctrlKey: true, metaKey: false });
      watcherTotals.push({ id: other.id, name: other.name, total: rolled?.total ?? 0 });
    }

    const stealthSucceeded = watcherTotals.every((watcher) => total > watcher.total);
    await this.runtime.jackIn(grant.runnerId, { quiet: true, stealthSucceeded });
    await publishAllProjections(this.store);
    return { ok: true, stealthSucceeded, watcherTotals };
  }
}
