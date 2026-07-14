/* Left GM file panel (tree): folder/arch file-manager. Phase B.
 * Renders netTree + treeState as a flat, depth-tagged display list (folders
 * first, alphabetical), with per-row actions, drag&drop reparenting, and
 * create/import/export. All state writes go through mutate(). */

import { loc } from "../constants.js";
import { getWorld, mutate } from "../data.js";
import { promptText } from "./suite-app.js";
import { snapshotEntityActor } from "../cpr-bridge.js";

/* Build the depth-tagged, sorted display list from the flat tree. */
function buildDisplayList() {
  const tree = getWorld("netTree") || [];
  const state = getWorld("treeState") || {};
  const byParent = {};
  for (const n of tree) (byParent[n.parentId || ""] ||= []).push(n);

  const sortNodes = (nodes) =>
    nodes.slice().sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const out = [];
  const walk = (parentId, depth) => {
    for (const node of sortNodes(byParent[parentId] || [])) {
      const open = node.type === "folder" ? !!state[node.id] : false;
      out.push({ ...node, depth, open, indent: depth * 14 });
      if (node.type === "folder" && open) walk(node.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export function getData(app) {
  if (!game.user.isGM) return { tree: null };
  return { tree: { nodes: buildDisplayList() } };
}

/* Enrich an arch for export: snapshot each backing actor into def.actorData. */
function enrichArchForExport(arch) {
  const out = foundry.utils.deepClone(arch);
  for (const floor of out.floors || []) {
    for (const i of floor.ice || []) {
      const snap = i.actorId ? snapshotEntityActor(i.actorId) : null;
      if (snap) i.actorData = snap;
      delete i.actorId;
    }
    if (floor.demon) {
      const snap = floor.demon.actorId ? snapshotEntityActor(floor.demon.actorId) : null;
      if (snap) floor.demon.actorData = snap;
      delete floor.demon.actorId;
    }
  }
  delete out.id;
  return out;
}

/* Surface an op result that may be a localized error object. */
function reportError(result) {
  if (result && typeof result === "object" && result.error) {
    ui.notifications.warn(loc(result.error));
    return true;
  }
  return false;
}

export function activateListeners(app, html) {
  if (!game.user.isGM) return;

  // Collapse / expand the left tree panel (works in both the expanded header and
  // the collapsed rail — bound on the whole html, not scoped to .crns-tree).
  html.find('[data-action="tree-toggle"]').on("click", () => {
    app.state.collapsedLeft = !app.state.collapsedLeft;
    app.render(false);
  });

  const root = html.find(".crns-tree")[0];
  if (!root) return;

  const nodeName = (nodeId) => (getWorld("netTree") || []).find((n) => n.id === nodeId)?.name ?? "";

  /* ---- header buttons ---- */
  html.find('[data-action="tree-new-folder"]').on("click", async () => {
    const name = await promptText(loc("CRNS.Tree.NewFolderTitle"), loc("CRNS.Tree.NewFolder"));
    if (name) await mutate("tree.createFolder", { parentId: "", name });
  });
  html.find('[data-action="tree-new-arch"]').on("click", async () => {
    const name = await promptText(loc("CRNS.Tree.NewArchTitle"), loc("CRNS.Tree.Untitled"));
    if (name) await mutate("tree.createArch", { parentId: "", name });
  });
  html.find('[data-action="tree-import"]').on("click", () => {
    html.find('input.crns-import-file')[0]?.click();
  });
  html.find("input.crns-import-file").on("change", (ev) => {
    const file = ev.currentTarget.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed = null;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { ui.notifications.error(loc("CRNS.Errors.BadImport")); return; }
      const result = await mutate("arch.import", { parentId: "", arch: parsed });
      reportError(result);
    };
    reader.readAsText(file);
    ev.currentTarget.value = "";
  });

  /* ---- per-folder + buttons ---- */
  html.find('[data-action="folder-new-folder"]').on("click", async (ev) => {
    const parentId = ev.currentTarget.closest("[data-node-id]")?.dataset.nodeId;
    const name = await promptText(loc("CRNS.Tree.NewFolderTitle"), loc("CRNS.Tree.NewFolder"));
    if (name) await mutate("tree.createFolder", { parentId, name });
  });
  html.find('[data-action="folder-new-arch"]').on("click", async (ev) => {
    const parentId = ev.currentTarget.closest("[data-node-id]")?.dataset.nodeId;
    const name = await promptText(loc("CRNS.Tree.NewArchTitle"), loc("CRNS.Tree.Untitled"));
    if (name) await mutate("tree.createArch", { parentId, name });
  });

  /* ---- folder toggle ---- */
  html.find('[data-action="folder-toggle"]').on("click", (ev) => {
    const row = ev.currentTarget.closest("[data-node-id]");
    const nodeId = row?.dataset.nodeId;
    const state = getWorld("treeState") || {};
    mutate("tree.toggle", { nodeId, open: !state[nodeId] });
  });

  /* ---- rename (double-click name) ---- */
  html.find(".crns-tree-name").on("dblclick", async (ev) => {
    ev.preventDefault();
    const nodeId = ev.currentTarget.closest("[data-node-id]")?.dataset.nodeId;
    const name = await promptText(loc("CRNS.Tree.RenameTitle"), nodeName(nodeId));
    if (name) await mutate("tree.rename", { nodeId, name });
  });

  /* ---- arch row buttons ---- */
  html.find('[data-action="arch-open"]').on("click", async (ev) => {
    const archId = ev.currentTarget.closest("[data-arch-id]")?.dataset.archId;
    app.state.editorArchId = "";
    await mutate("tabs.open", { archId });
  });
  html.find('[data-action="arch-edit"]').on("click", async (ev) => {
    const archId = ev.currentTarget.closest("[data-arch-id]")?.dataset.archId;
    await mutate("tabs.open", { archId });
    app.state.editorArchId = archId;
    app.state.draft = foundry.utils.deepClone((getWorld("netArchs") || {})[archId] || {});
    app.render(false);
  });
  html.find('[data-action="arch-duplicate"]').on("click", async (ev) => {
    const archId = ev.currentTarget.closest("[data-arch-id]")?.dataset.archId;
    await mutate("arch.duplicate", { archId });
  });
  html.find('[data-action="arch-export"]').on("click", (ev) => {
    const archId = ev.currentTarget.closest("[data-arch-id]")?.dataset.archId;
    const arch = (getWorld("netArchs") || {})[archId];
    if (!arch) return;
    const enriched = enrichArchForExport(arch);
    const safe = (arch.name || "architecture").replace(/[^\w\-]+/g, "_");
    saveDataToFile(JSON.stringify(enriched, null, 2), "text/json", `${safe}.json`);
  });
  const archIdOfNode = (nodeId) => (getWorld("netTree") || []).find((n) => n.id === nodeId)?.archId ?? "";
  // After a delete, if the arch open in the editor is gone, drop the stale draft
  // so the centre pane falls back to the canvas (mirrors tabs.js tab-close).
  const clearEditorIfDeleted = () => {
    const openId = app.state.editorArchId;
    if (openId && !(getWorld("netArchs") || {})[openId]) {
      app.state.editorArchId = "";
      app.state.draft = {};
      app.render(false);
    }
  };

  html.find('[data-action="arch-delete"]').on("click", async (ev) => {
    const row = ev.currentTarget.closest("[data-node-id]");
    const nodeId = row?.dataset.nodeId;
    const name = nodeName(nodeId);
    const ok = await Dialog.confirm({
      title: loc("CRNS.Tree.DeleteTitle"),
      content: `<p>${loc("CRNS.Tree.DeleteArchConfirm", { name })}</p>`,
    });
    if (ok) {
      const deletedArchId = archIdOfNode(nodeId);
      await mutate("tree.delete", { nodeId });
      if (deletedArchId && deletedArchId === app.state.editorArchId) clearEditorIfDeleted();
    }
  });
  html.find('[data-action="folder-delete"]').on("click", async (ev) => {
    const nodeId = ev.currentTarget.closest("[data-node-id]")?.dataset.nodeId;
    const name = nodeName(nodeId);
    const ok = await Dialog.confirm({
      title: loc("CRNS.Tree.DeleteTitle"),
      content: `<p>${loc("CRNS.Tree.DeleteFolderConfirm", { name })}</p>`,
    });
    if (ok) {
      await mutate("tree.delete", { nodeId });
      // A folder delete may have removed the arch under the editor's archId.
      clearEditorIfDeleted();
    }
  });

  /* ---- drag & drop reparenting ---- */
  html.find(".crns-tree-row[draggable=true]").on("dragstart", (ev) => {
    const nodeId = ev.currentTarget.dataset.nodeId;
    ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ crnsNode: nodeId }));
    ev.originalEvent.dataTransfer.effectAllowed = "move";
  });

  const readNode = (ev) => {
    try {
      const raw = ev.originalEvent.dataTransfer.getData("text/plain");
      return JSON.parse(raw)?.crnsNode ?? null;
    } catch (e) { return null; }
  };

  html.find('.crns-tree-row[data-node-type="folder"]').on("dragover", (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.add("crns-drop-hover");
  }).on("dragleave", (ev) => {
    ev.currentTarget.classList.remove("crns-drop-hover");
  }).on("drop", async (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove("crns-drop-hover");
    const nodeId = readNode(ev);
    const parentId = ev.currentTarget.dataset.nodeId;
    if (nodeId && nodeId !== parentId) {
      const result = await mutate("tree.move", { nodeId, parentId });
      reportError(result);
    }
  });

  // Drop onto the header / empty area → move to root.
  html.find('[data-action="tree-drop-root"]').on("dragover", (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.add("crns-drop-hover");
  }).on("dragleave", (ev) => {
    ev.currentTarget.classList.remove("crns-drop-hover");
  }).on("drop", async (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove("crns-drop-hover");
    const nodeId = readNode(ev);
    if (nodeId) await mutate("tree.move", { nodeId, parentId: "" });
  });
}
