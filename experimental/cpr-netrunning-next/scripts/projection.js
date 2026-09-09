import { ID } from "./store.js";

function clone(v) {
  return foundry.utils.deepClone(v);
}

function childrenOf(nodes, id) {
  return nodes.filter((n) => n.parent === id || (n.alsoFrom || []).includes(id));
}

function frontierIds(arch, discovered) {
  const seen = new Set(discovered);
  const frontier = new Set();
  for (const id of seen) {
    for (const child of childrenOf(arch.nodes, id)) if (!seen.has(child.id)) frontier.add(child.id);
    const node = arch.nodes.find((n) => n.id === id);
    if (node?.parent && !seen.has(node.parent)) frontier.add(node.parent);
    for (const extra of node?.alsoFrom || []) if (!seen.has(extra)) frontier.add(extra);
  }
  return frontier;
}

export function sanitizeArchitecture(arch, runtime = {}) {
  if (!arch) return null;

  const discovered = new Set(runtime.discoveredNodeIds || []);
  const frontier = frontierIds(arch, discovered);
  const visibleIds = new Set([...discovered, ...frontier]);

  const nodes = arch.nodes
    .filter((n) => visibleIds.has(n.id))
    .map((n) => {
      if (!discovered.has(n.id)) {
        return {
          id: n.id,
          parent: visibleIds.has(n.parent) ? n.parent : "",
          alsoFrom: (n.alsoFrom || []).filter((id) => visibleIds.has(id)),
          unknown: true
        };
      }

      return {
        id: n.id,
        parent: visibleIds.has(n.parent) ? n.parent : "",
        alsoFrom: (n.alsoFrom || []).filter((id) => visibleIds.has(id)),
        unknown: false,
        label: n.label,
        kind: n.kind,
        dv: n.dv,
        check: n.check,
        gate: !!n.gate,
        contents: n.contents || "",
        contentsImage: n.contentsImage || "",
        attachments: (n.attachments || [])
          .filter((a) => a.visible)
          .map((a) => ({
            id: a.id,
            uuid: a.uuid,
            label: a.label || "Linked document",
            documentType: a.documentType || ""
          })),
        controls: (n.controls || [])
          .filter((c) => c.visible)
          .map((c) => ({ id: c.id, label: c.label || "CONTROL" }))
      };
    });

  return {
    schema: 1,
    architectureId: arch.id,
    name: arch.name,
    currentNodeId: runtime.currentNodeId || "",
    discoveredNodeIds: [...discovered],
    nodes
  };
}

export async function publishProjection(store, architectureId = "") {
  if (!game.user.isGM) return;

  const runtime = clone(game.settings.get(ID, "runtime") || {});
  const arch = architectureId ? await store.get(architectureId) : null;

  if (!arch) {
    await game.settings.set(ID, "publicProjection", {});
    return;
  }

  if (!runtime.currentNodeId || !arch.nodes.some((n) => n.id === runtime.currentNodeId)) {
    runtime.currentNodeId = arch.nodes[0]?.id || "";
  }
  runtime.activeArchitectureId = arch.id;
  if (!Array.isArray(runtime.discoveredNodeIds)) runtime.discoveredNodeIds = [];
  if (runtime.currentNodeId && !runtime.discoveredNodeIds.includes(runtime.currentNodeId)) {
    runtime.discoveredNodeIds.push(runtime.currentNodeId);
  }

  await game.settings.set(ID, "runtime", runtime);
  await game.settings.set(ID, "publicProjection", sanitizeArchitecture(arch, runtime) || {});
}

export async function updateRuntime(store, patch = {}) {
  if (!game.user.isGM) throw new Error("GM only.");
  const runtime = clone(game.settings.get(ID, "runtime") || {});
  Object.assign(runtime, patch);
  await game.settings.set(ID, "runtime", runtime);
  await publishProjection(store, runtime.activeArchitectureId || "");
}
