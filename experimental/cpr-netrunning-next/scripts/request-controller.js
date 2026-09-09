import { ID } from "./store.js";
import { publishAllProjections } from "./projection.js";
import { rollPlainInterface } from "./runner-profile.js";
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

    const runtime = await this.store.getRuntime();
    const runner = runtime?.runners?.[request.runnerId];
    if (!runner) throw new Error("Runner not found.");
    this._authorize(user, runner);

    switch (request.op) {
      case "move":
        await this.runtime.move(runner.id, request.nodeId);
        await publishAllProjections(this.store);
        return { ok: true };

      case "startTurn":
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
        return this._grant(user, runner, runtime, "ability", {
          ability: request.ability,
          nodeId: request.nodeId,
          virusText: String(request.virusText || "")
        });

      case "completeAbility":
        return this._completeAbility(user, request);

      case "beginQuietJack":
        if (runner.jackedIn) throw new Error("Runner is already Jacked In.");
        if (Number(runner.actionsMax || 0) - Number(runner.actionsUsed || 0) < 2) throw new Error("Quiet Jack In needs two NET Actions.");
        return this._grant(user, runner, runtime, "quietJack", {});

      case "completeQuietJack":
        return this._completeQuietJack(user, request);

      case "controlPulse":
        await this.runtime.activateControlledNode(runner.id, request.nodeId);
        await publishAllProjections(this.store);
        return { ok: true };

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

  _grant(user, runner, runtime, kind, data) {
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
    const runtime = await this.store.getRuntime();
    const runner = runtime.runners?.[grant.runnerId];
    this._authorize(user, runner);
    if (!runner || runner.actorUuid !== grant.actorUuid || runner.currentNodeId !== grant.currentNodeId || Number(runner.actionsUsed || 0) !== grant.actionsUsed || runner.deckId !== grant.deckId) {
      throw new Error("NET state changed while the roll was open. Cancel and try again.");
    }
    const verified = validMessage(user, grant, request.messageId);
    if (!verified) throw new Error("Matching native CPR roll card not found.");
    this.grants.delete(grant.token);
    return { grant, runtime, runner, total: verified.total };
  }

  async _completeAbility(user, request) {
    const { grant, total } = await this._verifyCompletion(user, request, "ability");
    const result = await this.runtime.applyAbilityResult(
      grant.runnerId,
      grant.data.ability,
      grant.data.nodeId,
      total,
      { virusText: grant.data.virusText }
    );
    await publishAllProjections(this.store);
    return result;
  }

  async _completeQuietJack(user, request) {
    const { grant, runtime, total } = await this._verifyCompletion(user, request, "quietJack");
    const arch = await this.store.get(runtime.activeArchitectureId);
    const watcherTotals = [];

    for (const node of arch?.nodes || []) {
      for (const entity of node.entities || []) {
        if (entity.kind !== "demon" || !entity.actorId) continue;
        const rolled = await rollWatcherInterface(entity);
        watcherTotals.push({ id: entity.id, name: entity.label, total: rolled.total });
      }
    }

    for (const other of Object.values(runtime.runners || {})) {
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
