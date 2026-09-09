import { ID } from "./store.js";
import { publishProjection, updateRuntime } from "./projection.js";

const ICON = (name) => `modules/${ID}/assets/icons.svg#${name}`;
const uid = (prefix = "x") => `${prefix}_${foundry.utils.randomID(10)}`;
const clone = (v) => foundry.utils.deepClone(v);

function iconFor(kind, unknown = false) {
  if (unknown) return "encrypted";
  return { password: "lock", file: "file", controlnode: "control", control: "control", blackice: "ice", demon: "demon" }[kind] || "node";
}

function calculateDepths(nodes) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const depth = (id, visiting = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const node = map.get(id);
    if (!node || !node.parent) return 0;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value = Math.min(30, depth(node.parent, visiting) + 1);
    visiting.delete(id);
    memo.set(id, value);
    return value;
  };
  for (const n of nodes) memo.set(n.id, depth(n.id));
  return memo;
}

function layoutArchitecture(arch, runtime = {}) {
  if (!arch?.nodes?.length) return { nodes: [], edges: [], width: 700, height: 420 };
  const depths = calculateDepths(arch.nodes);
  const rows = new Map();
  for (const node of arch.nodes) {
    const d = depths.get(node.id) ?? 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(node);
  }
  const cardW = 220, cardH = 104, xGap = 46, yGap = 70, pad = 60;
  const maxCount = Math.max(...[...rows.values()].map((r) => r.length), 1);
  const width = Math.max(720, pad * 2 + maxCount * cardW + (maxCount - 1) * xGap);
  const position = new Map(), laid = [];
  for (const [depth, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const rowWidth = row.length * cardW + Math.max(0, row.length - 1) * xGap;
    const start = (width - rowWidth) / 2;
    row.forEach((node, col) => {
      const x = Math.round(start + col * (cardW + xGap));
      const y = Math.round(pad + depth * (cardH + yGap));
      position.set(node.id, { x, y });
      laid.push({
        ...node, x, y, width: cardW, height: cardH,
        iconHref: ICON(iconFor(node.kind, node.unknown)),
        isCurrent: runtime.currentNodeId === node.id,
        isDiscovered: (runtime.discoveredNodeIds || []).includes(node.id),
        displayLabel: node.unknown ? game.i18n.localize("CRNSL.Node.Encrypted") : (node.label || "NODE"),
        displayKind: node.unknown ? "" : (node.kind || "custom"),
        showDv: !node.unknown && Number(node.dv) > 0,
        hasContents: !node.unknown && (!!node.contents || !!node.contentsImage),
        attachmentCount: Array.isArray(node.attachments) ? node.attachments.length : 0,
        controlCount: Array.isArray(node.controls) ? node.controls.length : 0
      });
    });
  }
  const edges = [];
  const nodeMap = new Map(arch.nodes.map((n) => [n.id, n]));
  for (const node of arch.nodes) {
    for (const fromId of [node.parent, ...(node.alsoFrom || [])].filter(Boolean)) {
      if (!nodeMap.has(fromId)) continue;
      const a = position.get(fromId), b = position.get(node.id);
      if (!a || !b) continue;
      edges.push({ id: `${fromId}:${node.id}`, x1: a.x + cardW / 2, y1: a.y + cardH, x2: b.x + cardW / 2, y2: b.y, secondary: fromId !== node.parent });
    }
  }
  const maxDepth = Math.max(...laid.map((n) => Math.round((n.y - pad) / (cardH + yGap))), 0);
  const height = Math.max(430, pad * 2 + (maxDepth + 1) * cardH + maxDepth * yGap);
  return { nodes: laid, edges, width, height };
}

const runtimeState = () => clone(game.settings.get(ID, "runtime") || {});
const projectionState = () => clone(game.settings.get(ID, "publicProjection") || {});

function selectedSceneDocument() {
  return canvas?.walls?.controlled?.[0]?.document || canvas?.tokens?.controlled?.[0]?.document || canvas?.tiles?.controlled?.[0]?.document || canvas?.lighting?.controlled?.[0]?.document || canvas?.sounds?.controlled?.[0]?.document || null;
}

function controlActions(documentName) {
  return { Wall: ["open", "close", "lock", "unlock"], Token: ["show", "hide"], Tile: ["show", "hide"], AmbientLight: ["enable", "disable"], AmbientSound: ["enable", "disable"] }[documentName] || [];
}

async function executeControl(control) {
  if (!game.user.isGM) throw new Error("GM only.");
  const doc = await fromUuid(control.uuid);
  if (!doc || doc.documentName !== control.documentType) throw new Error("Linked Scene Document is unavailable or changed type.");
  const action = control.action;
  if (!controlActions(doc.documentName).includes(action)) throw new Error("Unsupported control action.");
  if (doc.documentName === "Wall") {
    if (!(doc.door > 0)) throw new Error("Selected Wall is not a door.");
    await doc.update({ ds: { open: 1, close: 0, lock: 2, unlock: 0 }[action] });
  } else if (doc.documentName === "Token" || doc.documentName === "Tile") {
    await doc.update({ hidden: action === "hide" });
  } else {
    await doc.update({ hidden: action === "disable" });
  }
}

export class NetrunningLabApp extends Application {
  constructor(store, options = {}) {
    super(options);
    this.store = store;
    this.preview = !game.user.isGM;
    this.selectedNodeId = "";
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "crnsl-window", title: "Cyberpunk RED: Netrunning Lab",
      template: `modules/${ID}/templates/lab.hbs`, width: 1180, height: 780,
      minWidth: 820, minHeight: 560, resizable: true, classes: ["crnsl-window"]
    });
  }

  async getData() {
    const gm = game.user.isGM;
    const runtime = runtimeState();
    const publicProjection = projectionState();
    const privateArchitectures = gm ? await this.store.all() : {};
    const architectures = Object.values(privateArchitectures).map((a) => ({ id: a.id, name: a.name, selected: a.id === runtime.activeArchitectureId }));
    let arch = null;
    if (gm && !this.preview) {
      arch = privateArchitectures[runtime.activeArchitectureId] || Object.values(privateArchitectures)[0] || null;
      if (arch) runtime.activeArchitectureId = arch.id;
    } else if (publicProjection?.nodes) {
      arch = { id: publicProjection.architectureId, name: publicProjection.name, nodes: publicProjection.nodes };
    }
    if (arch && !this.selectedNodeId) this.selectedNodeId = runtime.currentNodeId || arch.nodes[0]?.id || "";
    if (arch && !arch.nodes.some((n) => n.id === this.selectedNodeId)) this.selectedNodeId = arch.nodes[0]?.id || "";
    const effectiveRuntime = gm && !this.preview ? runtime : { currentNodeId: publicProjection.currentNodeId || "", discoveredNodeIds: publicProjection.discoveredNodeIds || [] };
    const canvas = layoutArchitecture(arch, effectiveRuntime);
    canvas.nodes.forEach((n) => n.selected = n.id === this.selectedNodeId);
    const selected = arch?.nodes?.find((n) => n.id === this.selectedNodeId) || null;
    const inspector = selected ? {
      ...selected,
      iconHref: ICON(iconFor(selected.kind, selected.unknown)),
      displayLabel: selected.unknown ? game.i18n.localize("CRNSL.Node.Encrypted") : (selected.label || "NODE"),
      unknown: !!selected.unknown,
      attachments: (selected.attachments || []).map((a) => ({ ...a, iconHref: ICON(a.documentType === "Item" ? "item" : "journal") })),
      controls: (selected.controls || []).map((c) => ({ ...c, actions: controlActions(c.documentType).map((value) => ({ value, label: value.toUpperCase(), selected: value === c.action })) })),
      isCurrent: effectiveRuntime.currentNodeId === selected.id,
      isDiscovered: (effectiveRuntime.discoveredNodeIds || []).includes(selected.id)
    } : null;
    return {
      gm, preview: this.preview, modeLabel: this.preview ? "PLAYER PROJECTION" : "GM LAB",
      icon: ICON, hasArchitecture: !!arch, architectureName: arch?.name || "", architectures,
      canvas: { ...canvas, style: `width:${canvas.width}px;height:${canvas.height}px` }, inspector,
      runtime: effectiveRuntime, productionAvailable: game.modules.get("cpr-netrunning")?.active === true
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action]", (event) => {
      event.preventDefault();
      this._action(event.currentTarget.dataset.action, event.currentTarget).catch((error) => { console.error(`${ID} |`, error); ui.notifications.error(error.message); });
    });
    html.on("change", "[data-role='architecture']", (event) => game.user.isGM && this._selectArchitecture(event.currentTarget.value).catch((e) => ui.notifications.error(e.message)));
    html.on("change", "[data-control-action]", (event) => game.user.isGM && this._changeControlAction(event.currentTarget.dataset.controlId, event.currentTarget.value).catch((e) => ui.notifications.error(e.message)));
    html.on("click", ".crnsl-node", (event) => { this.selectedNodeId = event.currentTarget.dataset.nodeId; this.render(false); });
    html.on("dragover", ".crnsl-node", (event) => { if (game.user.isGM && !this.preview) event.preventDefault(); });
    html.on("drop", ".crnsl-node", (event) => { if (!game.user.isGM || this.preview) return; event.preventDefault(); this._dropDocument(event.originalEvent || event, event.currentTarget.dataset.nodeId).catch((e) => ui.notifications.error(e.message)); });
  }

  async _selectArchitecture(id) {
    const arch = await this.store.get(id); if (!arch) return;
    const root = arch.nodes[0]?.id || "";
    await updateRuntime(this.store, { activeArchitectureId: arch.id, currentNodeId: root, discoveredNodeIds: root ? [root] : [] });
    this.selectedNodeId = root; this.render(false);
  }

  async _action(action, target) {
    const runtime = runtimeState();
    const nodeId = target.dataset.nodeId || this.selectedNodeId;
    switch (action) {
      case "import-production": {
        const imported = await this.store.importProduction();
        const first = imported[0];
        if (first) { const root = first.nodes[0]?.id || ""; await updateRuntime(this.store, { activeArchitectureId: first.id, currentNodeId: root, discoveredNodeIds: root ? [root] : [] }); this.selectedNodeId = root; }
        ui.notifications.info(`Imported ${imported.length} architecture copy/copies.`); break;
      }
      case "create-demo": {
        const demo = await this.store.createDemo(); const root = demo.nodes[0]?.id || "";
        await updateRuntime(this.store, { activeArchitectureId: demo.id, currentNodeId: root, discoveredNodeIds: root ? [root] : [] }); this.selectedNodeId = root; break;
      }
      case "toggle-preview": this.preview = !this.preview; break;
      case "reveal": { const ids = new Set(runtime.discoveredNodeIds || []); ids.add(nodeId); await updateRuntime(this.store, { discoveredNodeIds: [...ids] }); break; }
      case "hide": { const ids = new Set(runtime.discoveredNodeIds || []); if (runtime.currentNodeId === nodeId) throw new Error("Move current marker first."); ids.delete(nodeId); await updateRuntime(this.store, { discoveredNodeIds: [...ids] }); break; }
      case "set-current": { const ids = new Set(runtime.discoveredNodeIds || []); ids.add(nodeId); await updateRuntime(this.store, { currentNodeId: nodeId, discoveredNodeIds: [...ids] }); break; }
      case "bind-selected": await this._bindSelected(nodeId); break;
      case "control-execute": await this._executeControl(nodeId, target.dataset.controlId); break;
      case "control-remove": await this._removeControl(nodeId, target.dataset.controlId); break;
      case "attachment-open": { const doc = await fromUuid(target.dataset.uuid); if (!doc) throw new Error("Linked document unavailable."); doc.sheet?.render(true); return; }
      case "attachment-toggle": await this._toggleAttachment(nodeId, target.dataset.attachmentId); break;
      case "attachment-remove": await this._removeAttachment(nodeId, target.dataset.attachmentId); break;
      default: return;
    }
    if (game.user.isGM && runtimeState().activeArchitectureId) await publishProjection(this.store, runtimeState().activeArchitectureId);
    this.render(false);
  }

  async _dropDocument(event, nodeId) {
    const data = TextEditor.getDragEventData(event); if (!data?.uuid) throw new Error("Drop a JournalEntry, JournalEntryPage, or Item.");
    const doc = await fromUuid(data.uuid);
    if (!doc || !["JournalEntry", "JournalEntryPage", "Item"].includes(doc.documentName)) throw new Error("Supported: JournalEntry, JournalEntryPage, Item.");
    const runtime = runtimeState();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => {
      node.attachments ||= [];
      if (!node.attachments.some((a) => a.uuid === doc.uuid)) node.attachments.push({ id: uid("att"), uuid: doc.uuid, label: doc.name, documentType: doc.documentName, visible: false });
    });
    await publishProjection(this.store, runtime.activeArchitectureId); this.selectedNodeId = nodeId; this.render(false);
  }

  async _toggleAttachment(nodeId, attachmentId) {
    const runtime = runtimeState();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => { const a = (node.attachments || []).find((x) => x.id === attachmentId); if (!a) throw new Error("Attachment not found."); a.visible = !a.visible; });
  }
  async _removeAttachment(nodeId, attachmentId) {
    const runtime = runtimeState(); await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => { node.attachments = (node.attachments || []).filter((a) => a.id !== attachmentId); });
  }
  async _bindSelected(nodeId) {
    const doc = selectedSceneDocument(); if (!doc) throw new Error("Select a door, Token, Tile, Light, or Sound first.");
    const actions = controlActions(doc.documentName); if (!actions.length) throw new Error(`Unsupported: ${doc.documentName}.`);
    const runtime = runtimeState();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => { node.controls ||= []; node.controls.push({ id: uid("ctl"), uuid: doc.uuid, label: doc.name || `${doc.documentName} control`, documentType: doc.documentName, action: actions[0], visible: true }); });
  }
  async _changeControlAction(controlId, action) {
    const runtime = runtimeState();
    await this.store.mutateNode(runtime.activeArchitectureId, this.selectedNodeId, (node) => { const c = (node.controls || []).find((x) => x.id === controlId); if (!c) throw new Error("Control not found."); if (!controlActions(c.documentType).includes(action)) throw new Error("Unsupported action."); c.action = action; });
    await publishProjection(this.store, runtime.activeArchitectureId); this.render(false);
  }
  async _executeControl(nodeId, controlId) {
    const runtime = runtimeState(), arch = await this.store.get(runtime.activeArchitectureId);
    const control = arch?.nodes?.find((n) => n.id === nodeId)?.controls?.find((c) => c.id === controlId);
    if (!control) throw new Error("Control not found."); await executeControl(control); ui.notifications.info(`${control.label}: ${control.action}`);
  }
  async _removeControl(nodeId, controlId) {
    const runtime = runtimeState(); await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => { node.controls = (node.controls || []).filter((c) => c.id !== controlId); });
  }
}
