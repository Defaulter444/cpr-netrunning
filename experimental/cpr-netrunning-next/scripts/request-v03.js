/* Going Quiet rules bridge for Lab 0.3.
 * Replaces the 0.2 Quiet Jack resolver so a plain Interface Check never rides
 * through the Scanner ability and accidentally inherits Scanner modifiers.
 */
import { LabRequestController } from "./request-controller.js";
import { publishAllProjections } from "./projection.js";
import { rollWatcherInterface } from "./entity-rolls.js";
import { rollPlainInterfaceV03 } from "./plain-interface-v03.js";

LabRequestController.prototype._completeQuietJack = async function completeQuietJackV03(user, request) {
  const { grant, state, total } = await this._verifyCompletion(user, request, "quietJack");
  const arch = await this.store.get(state.activeArchitectureId);
  const watcherTotals = [];

  for (const node of arch?.nodes || []) {
    for (const entity of node.entities || []) {
      if (entity.kind !== "demon" || !entity.actorId) continue;
      const rolled = await rollWatcherInterface(entity);
      watcherTotals.push({ id:entity.id, name:entity.label, total:rolled.total });
    }
  }

  for (const other of Object.values(state.runners || {})) {
    if (other.id === grant.runnerId || !other.jackedIn || !other.watcher) continue;
    const actor = await fromUuid(other.actorUuid);
    if (!actor) continue;
    const rolled = await rollPlainInterfaceV03(actor, { type:"auto", ctrlKey:true, metaKey:false });
    watcherTotals.push({ id:other.id, name:other.name, total:rolled?.total ?? 0 });
  }

  /* Going Quiet: the entering Netrunner has to beat every Watcher, not tie. */
  const stealthSucceeded = watcherTotals.every((watcher) => Number(total) > Number(watcher.total));
  await this.runtime.jackIn(grant.runnerId, { quiet:true, stealthSucceeded });
  await publishAllProjections(this.store);
  return { ok:true, stealthSucceeded, watcherTotals };
};
