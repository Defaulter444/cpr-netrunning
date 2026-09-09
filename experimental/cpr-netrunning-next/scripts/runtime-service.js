import { profileFor, eligibleRunner } from "./runner-profile.js";
import * as rules from "./rules.js";

const clone = (v) => foundry.utils.deepClone(v);

function rootId(arch) {
  return arch?.nodes?.find((n) => !n.parent)?.id || arch?.nodes?.[0]?.id || "";
}

function runnerIdFor(actor) {
  return `runner_${actor.id}`;
}

function floorFx(runtime, nodeId) {
  runtime.floorState ||= {};
  runtime.floorState[nodeId] ||= { breached: false, control: null, eyedee: [], viruses: [] };
  const fx = runtime.floorState[nodeId];
  fx.eyedee = Array.isArray(fx.eyedee) ? fx.eyedee : [];
  fx.viruses = Array.isArray(fx.viruses) ? fx.viruses : [];
  return fx;
}

function refreshRunnerFromProfile(runner, actor) {
  const profile = profileFor(actor);
  Object.assign(runner, {
    actorUuid: profile.actorUuid,
    name: profile.name,
    img: profile.img,
    rank: profile.rank,
    actionsMax: profile.actionsMax,
    deckId: profile.deckId,
    deckName: profile.deckName,
    programs: profile.programs
  });
  runner.actionsUsed = Math.min(Number(runner.actionsUsed || 0), runner.actionsMax);
  return runner;
}

export class LabRuntimeService {
  constructor(store) {
    this.store = store;
  }

  async architecture(runtime = null) {
    runtime ||= await this.store.getRuntime();
    return runtime?.activeArchitectureId ? this.store.get(runtime.activeArchitectureId) : null;
  }

  async addRunner(actorUuid, preferredUserId = "") {
    const actor = await fromUuid(actorUuid);
    if (!eligibleRunner(actor)) throw new Error("Actor needs a positive active Interface Role and an equipped Cyberdeck.");
    const arch = await this.architecture();
    if (!arch) throw new Error("Select a NET Architecture first.");
    const id = runnerIdFor(actor);
    const profile = profileFor(actor);
    const owner = preferredUserId
      ? game.users.get(preferredUserId)
      : game.users.find((u) => !u.isGM && actor.testUserPermission?.(u, "OWNER"));

    await this.store.mutateRuntime((runtime) => {
      runtime.runners ||= {};
      const previous = runtime.runners[id] || {};
      runtime.runners[id] = {
        id,
        actorUuid: actor.uuid,
        userId: owner?.id || previous.userId || "",
        name: profile.name,
        img: profile.img,
        rank: profile.rank,
        deckId: profile.deckId,
        deckName: profile.deckName,
        programs: profile.programs,
        actionsMax: profile.actionsMax,
        actionsUsed: Number(previous.actionsUsed || 0),
        jackedIn: !!previous.jackedIn,
        stealthed: !!previous.stealthed,
        quietMode: !!previous.quietMode,
        currentNodeId: previous.currentNodeId || rootId(arch),
        knownNodeIds: Array.isArray(previous.knownNodeIds) ? previous.knownNodeIds : [],
        visitedNodeIds: Array.isArray(previous.visitedNodeIds) ? previous.visitedNodeIds : [],
        cloakCheck: previous.cloakCheck ?? null,
        slideUsed: !!previous.slideUsed,
        targetRef: previous.targetRef || ""
      };
      runtime.activeRunnerId = id;
    });
    return id;
  }

  async removeRunner(runnerId) {
    await this.store.mutateRuntime((runtime) => {
      delete runtime.runners?.[runnerId];
      if (runtime.activeRunnerId === runnerId) runtime.activeRunnerId = Object.keys(runtime.runners || {})[0] || "";
    });
  }

  async selectRunner(runnerId) {
    await this.store.mutateRuntime((runtime) => {
      if (!runtime.runners?.[runnerId]) throw new Error("Runner not found.");
      runtime.activeRunnerId = runnerId;
    });
  }

  async refreshRunner(runnerId) {
    const runtime = await this.store.getRuntime();
    const runner = runtime.runners?.[runnerId];
    if (!runner) return null;
    const actor = await fromUuid(runner.actorUuid);
    if (!actor) return runner;
    await this.store.mutateRuntime((next) => refreshRunnerFromProfile(next.runners[runnerId], actor));
    return (await this.store.getRuntime()).runners[runnerId];
  }

  async startTurn(runnerId) {
    await this.store.mutateRuntime((runtime) => {
      const runner = runtime.runners?.[runnerId];
      if (!runner) throw new Error("Runner not found.");
      runner.actionsUsed = 0;
      runner.slideUsed = false;
      runtime.turnSerial = Number(runtime.turnSerial || 0) + 1;
    });
  }

  async jackIn(runnerId, { quiet = false, stealthSucceeded = false } = {}) {
    const arch = await this.architecture();
    if (!arch) throw new Error("No active architecture.");
    await this.store.mutateRuntime((runtime) => {
      const runner = runtime.runners?.[runnerId];
      if (!runner) throw new Error("Runner not found.");
      const cost = quiet ? rules.quietJackInActionCost() : 1;
      this._spend(runner, cost);
      const root = rootId(arch);
      runner.jackedIn = true;
      runner.quietMode = !!quiet;
      runner.stealthed = !!quiet && !!stealthSucceeded;
      runner.currentNodeId = root;
      runner.knownNodeIds = root ? [...new Set([...(runner.knownNodeIds || []), root])] : [];
      runner.visitedNodeIds = root ? [...new Set([...(runner.visitedNodeIds || []), root])] : [];
    });
  }

  async jackOut(runnerId) {
    await this.store.mutateRuntime((runtime) => {
      const runner = runtime.runners?.[runnerId];
      if (!runner) throw new Error("Runner not found.");
      this._spend(runner, 1);
      runner.jackedIn = false;
      runner.stealthed = false;
      runner.quietMode = false;
      runner.targetRef = "";
      const anyoneInside = Object.values(runtime.runners || {}).some((r) => r.jackedIn);
      if (!anyoneInside) {
        runtime.floorState = rules.resetArchitectureState(runtime.floorState || {});
        for (const r of Object.values(runtime.runners || {})) {
          r.knownNodeIds = [];
          r.visitedNodeIds = [];
          r.cloakCheck = null;
          r.slideUsed = false;
        }
      }
    });
  }

  async move(runnerId, nodeId) {
    const runtime = await this.store.getRuntime();
    const arch = await this.architecture(runtime);
    const runner = runtime.runners?.[runnerId];
    if (!runner || !runner.jackedIn) throw new Error("Jack In first.");
    const verdict = rules.canMove(arch.nodes, runner.currentNodeId, nodeId, runtime.floorState || {});
    if (!verdict.ok) throw new Error(verdict.reason === "obstruction" ? "Resolve the obstruction before moving deeper." : "NET movement is only between adjacent floors.");

    await this.store.mutateRuntime((next) => {
      const r = next.runners[runnerId];
      r.currentNodeId = nodeId;
      r.knownNodeIds = [...new Set([...(r.knownNodeIds || []), nodeId])];
      r.visitedNodeIds = [...new Set([...(r.visitedNodeIds || []), nodeId])];
    });
    return arch.nodes.find((n) => n.id === nodeId)?.entities || [];
  }

  async applyAbilityResult(runnerId, ability, nodeId, total, { virusText = "" } = {}) {
    const runtime = await this.store.getRuntime();
    const arch = await this.architecture(runtime);
    const runner = runtime.runners?.[runnerId];
    const node = arch?.nodes?.find((n) => n.id === nodeId);
    if (!runner || !node) throw new Error("Runner or node not found.");
    if (!runner.jackedIn) throw new Error("Jack In first.");
    if (runner.currentNodeId !== nodeId) throw new Error("Interface Abilities apply to the runner's current floor.");
    const availability = rules.abilityAvailability({ nodes: arch.nodes, node, floorState: runtime.floorState, runnerId, slideUsed: runner.slideUsed });
    if (["backdoor", "control", "eyedee", "virus"].includes(ability) && !availability[ability]) throw new Error("That Interface Ability has no valid target here.");

    let result = { ability, total: Number(total) || 0, success: false };
    await this.store.mutateRuntime((next) => {
      const r = next.runners[runnerId];
      this._spend(r, 1);
      const fx = floorFx(next, nodeId);
      const rollTotal = Number(total) || 0;

      if (ability === "backdoor") {
        result.success = rollTotal > Number(node.dv || 0);
        if (result.success) fx.breached = true;
      } else if (ability === "eyedee") {
        result.success = rollTotal > Number(node.dv || 0);
        if (result.success && !fx.eyedee.includes(runnerId)) fx.eyedee.push(runnerId);
      } else if (ability === "control") {
        const opposedDV = fx.control?.runnerId && fx.control.runnerId !== runnerId ? Number(fx.control.dv || 0) : Number(node.dv || 0);
        result.success = rollTotal > opposedDV;
        if (result.success) {
          fx.control = { runnerId, dv: rollTotal };
          if (r.stealthed) r.stealthed = false;
        }
      } else if (ability === "pathfinder") {
        const found = rules.pathfinderReveal(arch.nodes, nodeId, rollTotal, next.floorState || {});
        r.knownNodeIds = [...new Set([...(r.knownNodeIds || []), ...found])];
        result.success = found.length > 0;
        result.revealed = found;
      } else if (ability === "cloak") {
        r.cloakCheck = rollTotal;
        result.success = true;
      } else if (ability === "virus") {
        if (!rules.isLeaf(arch.nodes, nodeId)) throw new Error("Virus can only be left at the bottom of a branch.");
        fx.viruses.push({ id: foundry.utils.randomID(12), runnerId, dv: rollTotal, text: String(virusText || "") });
        result.success = true;
      }
    });
    return result;
  }

  async activateControlledNode(runnerId, nodeId) {
    const runtime = await this.store.getRuntime();
    const runner = runtime.runners?.[runnerId];
    const fx = runtime.floorState?.[nodeId];
    if (!runner || fx?.control?.runnerId !== runnerId) throw new Error("This runner does not control that node.");
    await this.store.mutateRuntime((next) => this._spend(next.runners[runnerId], 1));
  }

  async breakStealth(runnerId) {
    await this.store.mutateRuntime((runtime) => {
      const runner = runtime.runners?.[runnerId];
      if (runner) runner.stealthed = false;
    });
  }

  async projectionForRunner(runnerId) {
    const runtime = await this.store.getRuntime();
    const arch = await this.architecture(runtime);
    const { sanitizeArchitecture } = await import("./projection.js");
    return sanitizeArchitecture(arch, runtime, runnerId);
  }

  _spend(runner, amount) {
    const n = Math.max(0, Math.trunc(Number(amount) || 0));
    if (Number(runner.actionsUsed || 0) + n > Number(runner.actionsMax || 0)) throw new Error("No NET Actions remaining this Turn.");
    runner.actionsUsed = Number(runner.actionsUsed || 0) + n;
  }
}
