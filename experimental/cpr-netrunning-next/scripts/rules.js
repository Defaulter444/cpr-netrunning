/* Pure Cyberpunk RED NET rules used by the UX lab.
 * No Foundry calls live here. The lab automates only deterministic state changes;
 * contested rolls are exposed to the CPR roll layer instead of being invented here.
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

/* Virtual movement between adjacent NET floors is free. The only stop is an
 * unresolved obstruction on the floor the runner is leaving toward deeper NET.
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

/* Pathfinder follows the Corebook's "roll total levels down, or to the first
 * Password you could not beat" rule. Every branch is walked independently;
 * the blocking Password itself is revealed, but nothing beyond it is.
 */
export function pathfinderReveal(nodes, startId, check, floorState = {}) {
  const limit = Math.max(0, Math.trunc(Number(check) || 0));
  if (!limit || !(nodes || []).some((n) => n.id === startId)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set([startId]);
  let frontier = childIds(nodes, startId);
  const revealed = [];

  for (let step = 1; step <= limit && frontier.length; step += 1) {
    const next = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (!node) continue;
      revealed.push(id);
      const fx = floorState?.[id] || {};
      const blocks = node.kind === "password" && !fx.breached && Number(node.dv || 0) > limit;
      if (!blocks) next.push(...childIds(nodes, id));
    }
    frontier = next;
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

export function resetArchitectureState(floorState = {}) {
  const out = {};
  for (const [id, value] of Object.entries(floorState || {})) {
    out[id] = {
      ...value,
      breached: false,
      control: null,
      eyedee: [],
      viruses: [],
      activatedTurnSerial: -1
    };
  }
  return out;
}

/* Going Quiet (2025) -------------------------------------------------- */

export function quietJackInActionCost() {
  return 2; // ordinary Jack In + one additional NET Action for Quiet Jack In
}

export function stealthBreaksOn({ action = "", targetKind = "" } = {}) {
  if (action === "control-take") return true;
  if (["zap", "program-attack", "blackice-interact", "watcher-interact"].includes(action)) return true;
  if (["blackice", "demon", "watcher", "enemy-runner"].includes(targetKind) && action === "direct-interact") return true;
  return false;
}

export function quietEncounterMode({ stealthed = false, entityKind = "" } = {}) {
  if (!stealthed) return entityKind === "blackice" ? "speed" : "normal";
  if (entityKind === "blackice") return "cloak-vs-perception";
  if (["demon", "watcher", "enemy-runner"].includes(entityKind)) return "cloak-vs-pathfinder";
  return "normal";
}

export function watcherSearchAllowed(watcherState = {}, turnSerial = 0) {
  return Number(watcherState?.stealthSearchTurnSerial ?? -1) !== Number(turnSerial);
}
