/* Pure Cyberpunk RED NET rules used by the UX lab.
 * No Foundry calls live here. This file deliberately automates only rules that
 * are mechanically unambiguous; contested combat remains in the production engine.
 */

export const INTERFACE_ABILITIES = Object.freeze([
  "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus", "zap"
]);

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
  return node.kind === "file" || !!String(node.contents || "").trim() || !!String(node.contentsImage || "").trim() || (node.attachments || []).some((a) => a.documentType === "JournalEntry" || a.documentType === "JournalEntryPage");
}

export function parentIds(node) {
  if (!node) return [];
  return [...new Set([node.parent, ...(node.alsoFrom || [])].filter(Boolean))];
}

export function childIds(nodes, id) {
  const out = [];
  for (const node of nodes || []) {
    if (!node?.id) continue;
    if (node.parent === id || (node.alsoFrom || []).includes(id)) out.push(node.id);
  }
  return out;
}

export function neighborIds(nodes, id) {
  const node = (nodes || []).find((n) => n.id === id);
  if (!node) return [];
  return [...new Set([...parentIds(node), ...childIds(nodes, id)])];
}

export function isLeaf(nodes, id) {
  return childIds(nodes, id).length === 0;
}

export function isDownward(nodes, fromId, toId) {
  return childIds(nodes, fromId).includes(toId);
}

/* A Password/GM gate is an obstruction on its floor. The runner may arrive on
 * that floor, but cannot move farther down that route until it is breached.
 */
export function canMove(nodes, fromId, toId, floorState = {}) {
  if (!neighborIds(nodes, fromId).includes(toId)) return { ok: false, reason: "notAdjacent" };
  const from = (nodes || []).find((n) => n.id === fromId);
  if (isDownward(nodes, fromId, toId) && from?.gate && !floorState?.[fromId]?.breached) {
    return { ok: false, reason: "obstruction" };
  }
  return { ok: true, reason: "freeMovement" };
}

export function abilityAvailability({ nodes = [], node = null, floorState = {}, runnerId = "", hasIceTarget = false, hasZapTarget = false, slideUsed = false } = {}) {
  const fx = node ? (floorState[node.id] || {}) : {};
  const controlledByMe = fx.control?.runnerId === runnerId;
  const identified = Array.isArray(fx.eyedee) && fx.eyedee.includes(runnerId);
  return {
    backdoor: !!node?.gate && !fx.breached,
    cloak: true,
    control: node?.kind === "controlnode" && !controlledByMe,
    eyedee: floorHoldsData(node) && !identified,
    pathfinder: true,
    slide: !!hasIceTarget && !slideUsed,
    virus: !!node && isLeaf(nodes, node.id),
    zap: !!hasZapTarget
  };
}

/* Pathfinder: reveal general contents but never DVs. Branches are traversed
 * independently. A route stops at the first obstruction whose DV is greater
 * than the Pathfinder Check; the obstructing floor itself is still learned.
 * The Check also caps how many floor-steps can be learned from the current floor.
 */
export function pathfinderReveal(nodes, startId, check) {
  const limit = Math.max(0, Math.trunc(Number(check) || 0));
  if (!limit || !(nodes || []).some((n) => n.id === startId)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set([startId]);
  const queue = [{ id: startId, depth: 0 }];
  const revealed = [];

  while (queue.length) {
    const { id, depth } = queue.shift();
    if (depth >= limit) continue;
    for (const childId of childIds(nodes, id)) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      const child = byId.get(childId);
      if (!child) continue;
      revealed.push(childId);
      const blocked = !!child.gate && Number(child.dv || 0) > limit;
      if (!blocked) queue.push({ id: childId, depth: depth + 1 });
    }
  }
  return revealed;
}

export function primaryContext({ nodes = [], node = null, floorState = {}, runnerId = "", hasIceTarget = false, hasZapTarget = false, slideUsed = false } = {}) {
  if (!node) return [];
  const available = abilityAvailability({ nodes, node, floorState, runnerId, hasIceTarget, hasZapTarget, slideUsed });
  const order = ["backdoor", "eyedee", "control", "pathfinder", "virus", "slide", "zap", "cloak"];
  return order.map((key) => ({ key, available: !!available[key], cost: 1 }));
}

export function controlCanActivate(fx = {}, turnSerial = 0) {
  return Number(fx.activatedTurnSerial ?? -1) !== Number(turnSerial);
}

export function resetDefenses(floorState = {}) {
  const out = {};
  for (const [id, value] of Object.entries(floorState || {})) {
    out[id] = {
      ...value,
      breached: false,
      control: null,
      activatedTurnSerial: -1
    };
  }
  return out;
}
