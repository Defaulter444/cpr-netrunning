import { ID } from "./store.js";

const PROJECTION_FLAG = "projectionFor";

function clone(v) {
  return foundry.utils.deepClone(v);
}

function childrenOf(nodes, id) {
  return (nodes || []).filter((n) => n.parent === id || (n.alsoFrom || []).includes(id));
}

/* A runner standing on / having physically visited a floor can perceive that a
 * route continues, but an unknown frontier placeholder contains no secret data.
 * Pathfinder knowledge is added explicitly to knownNodeIds and does not, by
 * itself, leak another floor beyond the Check.
 */
function frontierIds(arch, runner) {
  const anchors = new Set([...(runner?.visitedNodeIds || []), runner?.currentNodeId].filter(Boolean));
  const known = new Set(runner?.knownNodeIds || []);
  const frontier = new Set();
  for (const id of anchors) {
    for (const child of childrenOf(arch.nodes, id)) if (!known.has(child.id)) frontier.add(child.id);
    const node = arch.nodes.find((n) => n.id === id);
    if (node?.parent && !known.has(node.parent)) frontier.add(node.parent);
    for (const extra of node?.alsoFrom || []) if (!known.has(extra)) frontier.add(extra);
  }
  return frontier;
}

function sanitizedNode(node, runner, runtime, visibleIds) {
  const known = new Set(runner?.knownNodeIds || []);
  const visited = new Set(runner?.visitedNodeIds || []);
  const fx = runtime.floorState?.[node.id] || {};
  const identified = Array.isArray(fx.eyedee) && fx.eyedee.includes(runner.id);
  const controlledByMe = fx.control?.runnerId === runner.id;

  if (!known.has(node.id)) {
    return {
      id: node.id,
      parent: visibleIds.has(node.parent) ? node.parent : "",
      alsoFrom: (node.alsoFrom || []).filter((id) => visibleIds.has(id)),
      unknown: true
    };
  }

  const physicallyKnown = visited.has(node.id) || runner.currentNodeId === node.id;
  const dataUnlocked = physicallyKnown && identified;
  const isData = node.kind === "file" || !!node.contents || !!node.contentsImage || (node.attachments || []).some((a) => ["JournalEntry", "JournalEntryPage"].includes(a.documentType));

  return {
    id: node.id,
    parent: visibleIds.has(node.parent) ? node.parent : "",
    alsoFrom: (node.alsoFrom || []).filter((id) => visibleIds.has(id)),
    unknown: false,
    scouted: !physicallyKnown,
    visited: physicallyKnown,
    label: node.label,
    kind: node.kind,
    gate: physicallyKnown ? !!node.gate : false,
    check: physicallyKnown ? (node.check || "") : "",
    state: {
      breached: physicallyKnown ? !!fx.breached : false,
      identified: !!dataUnlocked,
      controlledByMe: !!controlledByMe,
      hasVirus: (fx.viruses || []).some((v) => v.runnerId === runner.id)
    },
    contents: dataUnlocked ? (node.contents || "") : "",
    contentsImage: dataUnlocked ? (node.contentsImage || "") : "",
    hasLockedData: !!isData && !dataUnlocked,
    attachments: physicallyKnown && (!isData || dataUnlocked)
      ? (node.attachments || []).filter((a) => a.visible).map((a) => ({
          id: a.id,
          uuid: a.uuid,
          label: a.label || "Linked document",
          documentType: a.documentType || ""
        }))
      : [],
    controls: controlledByMe
      ? (node.controls || []).filter((c) => c.visible !== false).map((c) => ({ id: c.id, label: c.label || "CONTROL" }))
      : []
  };
}

export function sanitizeArchitecture(arch, runtime = {}, runnerId = "") {
  if (!arch) return null;
  const runner = runtime.runners?.[runnerId] || null;
  if (!runner) return null;

  const known = new Set(runner.knownNodeIds || []);
  const frontier = frontierIds(arch, runner);
  const visibleIds = new Set([...known, ...frontier]);
  const nodes = arch.nodes.filter((n) => visibleIds.has(n.id)).map((n) => sanitizedNode(n, runner, runtime, visibleIds));

  return {
    schema: 2,
    architectureId: arch.id,
    name: arch.name,
    runner: {
      id: runner.id,
      actorUuid: runner.actorUuid,
      name: runner.name,
      img: runner.img,
      rank: runner.rank,
      actionsMax: runner.actionsMax,
      actionsUsed: runner.actionsUsed,
      jackedIn: !!runner.jackedIn
    },
    currentNodeId: runner.currentNodeId || "",
    knownNodeIds: [...known],
    visitedNodeIds: [...(runner.visitedNodeIds || [])],
    turnSerial: Number(runtime.turnSerial || 0),
    nodes
  };
}

async function projectionDocument(userId) {
  const existing = game.journal?.find((j) => j.getFlag(ID, PROJECTION_FLAG) === userId);
  if (existing) return existing;
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  return JournalEntry.create({
    name: `[CRNS LAB] Player Projection ${userId}`,
    ownership,
    flags: { [ID]: { [PROJECTION_FLAG]: userId, payload: {} } }
  });
}

export async function publishProjection(store, runnerId = "") {
  if (!game.user.isGM) return null;
  const runtime = await store.getRuntime();
  const runner = runtime?.runners?.[runnerId];
  if (!runner?.userId) return null;
  const arch = await store.get(runtime.activeArchitectureId);
  const payload = sanitizeArchitecture(arch, runtime, runnerId) || {};
  const doc = await projectionDocument(runner.userId);
  await doc.setFlag(ID, "payload", payload);
  return payload;
}

export async function publishAllProjections(store) {
  if (!game.user.isGM) return;
  const runtime = await store.getRuntime();
  for (const runner of Object.values(runtime.runners || {})) {
    if (runner.userId) await publishProjection(store, runner.id);
  }
}

export function readMyProjection() {
  if (game.user.isGM) return null;
  const doc = game.journal?.find((j) => j.getFlag(ID, PROJECTION_FLAG) === game.user.id);
  return clone(doc?.getFlag(ID, "payload") || null);
}

export async function clearProjectionForUser(userId) {
  if (!game.user.isGM) return;
  const doc = game.journal?.find((j) => j.getFlag(ID, PROJECTION_FLAG) === userId);
  if (doc) await doc.setFlag(ID, "payload", {});
}
