/* Pure Cyberpunk RED NET rules used by the UX lab. */

export const INTERFACE_ABILITIES = Object.freeze([
  "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus", "zap"
]);

export const beatsDV = (total, dv) => Number(total || 0) > Number(dv || 0);

export function netActionsMax(rank) {
  const r = Math.trunc(Number(rank) || 0);
  if (r <= 0) return 0;
  if (r <= 3) return 2;
  if (r <= 6) return 3;
  if (r <= 9) return 4;
  return 5;
}

export function floorHoldsData(node) {
  if (!node) return false;
  return node.kind === "file" || !!String(node.contents || "").trim() || !!String(node.contentsImage || "").trim() || (node.attachments || []).some((a) => ["JournalEntry", "JournalEntryPage"].includes(a.documentType));
}

export function parentIds(node) {
  if (!node) return [];
  return [...new Set([node.parent, ...(node.alsoFrom || [])].filter(Boolean))];
}

export function childIds(nodes, id) {
  return (nodes || []).filter((node) => node?.id && (node.parent === id || (node.alsoFrom || []).includes(id))).map((node) => node.id);
}

export function neighborIds(nodes, id) {
  const node = (nodes || []).find((n) => n.id === id);
  if (!node) return [];
  return [...new Set([...parentIds(node), ...childIds(nodes, id)])];
}

export const isLeaf = (nodes, id) => childIds(nodes, id).length === 0;
export const isDownward = (nodes, fromId, toId) => childIds(nodes, fromId).includes(toId);

/* Virtual movement between adjacent NET floors is free. An unresolved gate on
 * the current floor stops movement deeper into that route, but not retreat.
 */
export function canMove(nodes, fromId, toId, floorState = {}) {
  if (!neighborIds(nodes, fromId).includes(toId)) return { ok: false, reason: "notAdjacent" };
  const from = (nodes || []).find((n) => n.id === fromId);
  if (isDownward(nodes, fromId, toId) && from?.gate && !floorState?.[fromId]?.breached) return { ok: false, reason: "obstruction" };
  return { ok: true, reason: "freeMovement" };
}

export function abilityAvailability({ nodes = [], node = null, floorState = {}, runnerId = "", hasIceTarget = false, hasZapTarget = false, slideUsed = false } = {}) {
  const fx = node ? (floorState[node.id] || {}) : {};
  return {
    backdoor: !!node?.gate && !fx.breached,
    cloak: true,
    control: node?.kind === "controlnode" && fx.control?.runnerId !== runnerId,
    eyedee: floorHoldsData(node) && !(fx.eyedee || []).includes(runnerId),
    pathfinder: true,
    slide: !!hasIceTarget && !slideUsed,
    virus: !!node && isLeaf(nodes, node.id),
    zap: !!hasZapTarget
  };
}

/* Pathfinder reveals one floor-depth per point of the Check, branch by branch.
 * The first unbeaten Password on each branch is revealed inclusively and stops
 * only that branch.
 */
export function pathfinderReveal(nodes, startId, check, floorState = {}) {
  const limit = Math.max(0, Math.trunc(Number(check) || 0));
  if (!limit || !(nodes || []).some((n) => n.id === startId)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set([startId]);
  let frontier = childIds(nodes, startId);
  const revealed = [];
  for (let step = 1; step <= limit && frontier.length; step++) {
    const next = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (!node) continue;
      revealed.push(id);
      const fx = floorState[id] || {};
      const blocks = node.kind === "password" && !fx.breached && Number(node.dv || 0) > limit;
      if (!blocks) next.push(...childIds(nodes, id));
    }
    frontier = next;
  }
  return revealed;
}

export function primaryContext(args = {}) {
  if (!args.node) return [];
  const available = abilityAvailability(args);
  const order = ["backdoor", "eyedee", "control", "pathfinder", "virus", "slide", "zap", "cloak"];
  return order.map((key) => ({ key, available: !!available[key], cost: 1 }));
}

export function resetArchitectureState(floorState = {}) {
  return Object.fromEntries(Object.entries(floorState || {}).map(([id, value]) => [id, { ...value, breached: false, control: null, eyedee: [], viruses: [] }]));
}

/* Going Quiet ------------------------------------------------------ */
export const quietJackInActionCost = () => 2;

export function stealthBreaksOn({ action = "", targetKind = "" } = {}) {
  if (action === "control-take") return true;
  if (["zap", "program-attack", "blackice-interact", "watcher-interact"].includes(action)) return true;
  return ["blackice", "demon", "watcher", "enemy-runner"].includes(targetKind) && action === "direct-interact";
}

export function quietEncounterMode({ stealthed = false, entityKind = "" } = {}) {
  if (!stealthed) return entityKind === "blackice" ? "speed" : "normal";
  if (entityKind === "blackice") return "cloak-vs-perception";
  if (["demon", "watcher", "enemy-runner"].includes(entityKind)) return "cloak-vs-pathfinder";
  return "normal";
}

export const watcherSearchAllowed = (watcherState = {}, turnSerial = 0) => Number(watcherState?.stealthSearchTurnSerial ?? -1) !== Number(turnSerial);
