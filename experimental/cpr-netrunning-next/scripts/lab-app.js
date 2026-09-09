import { ID } from "./store.js";
import { sanitizeArchitecture, publishAllProjections, readMyProjection } from "./projection.js";
import * as rules from "./rules.js";
import { candidateRunners, rollInterface, rollPlainInterface } from "./runner-profile.js";

const ICON = (name) => `modules/${ID}/assets/icons.svg#${name}`;
const uid = (prefix = "x") => `${prefix}_${foundry.utils.randomID(10)}`;

const ABILITY_META = {
  backdoor: { icon: "backdoor", label: "CRNSL.Ability.Backdoor", hint: "CRNSL.Ability.BackdoorHint" },
  cloak: { icon: "cloak", label: "CRNSL.Ability.Cloak", hint: "CRNSL.Ability.CloakHint" },
  control: { icon: "control", label: "CRNSL.Ability.Control", hint: "CRNSL.Ability.ControlHint" },
  eyedee: { icon: "eyedee", label: "CRNSL.Ability.EyeDee", hint: "CRNSL.Ability.EyeDeeHint" },
  pathfinder: { icon: "pathfinder", label: "CRNSL.Ability.Pathfinder", hint: "CRNSL.Ability.PathfinderHint" },
  slide: { icon: "slide", label: "CRNSL.Ability.Slide", hint: "CRNSL.Ability.SlideHint" },
  virus: { icon: "virus", label: "CRNSL.Ability.Virus", hint: "CRNSL.Ability.VirusHint" },
  zap: { icon: "zap", label: "CRNSL.Ability.Zap", hint: "CRNSL.Ability.ZapHint" }
};

function iconFor(kind, unknown = false) {
  if (unknown) return "encrypted";
  return { password: "lock", file: "file", controlnode: "control", control: "control", blackice: "ice", demon: "demon" }[kind] || "node";
}

function kindLabel(kind) {
  const key = { password: "Password", file: "File", controlnode: "Control", blackice: "BlackICE", demon: "Demon", custom: "Custom" }[kind] || "Custom";
  return game.i18n.localize(`CRNSL.Kind.${key}`);
}

function calculateDepths(nodes) {
  const map = new Map((nodes || []).map((n) => [n.id, n]));
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
  for (const node of nodes || []) memo.set(node.id, depth(node.id));
  return memo;
}

function layoutArchitecture(arch, runtime = {}, runner = null, { gmIntel = false } = {}) {
  if (!arch?.nodes?.length) return { nodes: [], edges: [], width: 760, height: 450 };
  const depths = calculateDepths(arch.nodes);
  const rows = new Map();
  for (const node of arch.nodes) {
    const d = depths.get(node.id) ?? 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(node);
  }

  const cardW = 228, cardH = 112, xGap = 54, yGap = 78, pad = 64;
  const maxCount = Math.max(...[...rows.values()].map((row) => row.length), 1);
  const width = Math.max(760, pad * 2 + maxCount * cardW + (maxCount - 1) * xGap);
  const position = new Map(), laid = [];
  const floorState = runtime.floorState || {};
  const moveMap = new Map((runtime.moves || []).map((m) => [m.id, m]));

  for (const [depth, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const rowWidth = row.length * cardW + Math.max(0, row.length - 1) * xGap;
    const start = (width - rowWidth) / 2;
    row.forEach((node, col) => {
      const x = Math.round(start + col * (cardW + xGap));
      const y = Math.round(pad + depth * (cardH + yGap));
      position.set(node.id, { x, y });
      const fx = floorState[node.id] || {};
      const move = moveMap.get(node.id);
      const current = (runner?.currentNodeId || runtime.currentNodeId) === node.id;
      laid.push({
        ...node,
        x, y, width: cardW, height: cardH,
        iconHref: ICON(iconFor(node.kind, node.unknown)),
        isCurrent: current,
        canMoveHere: !!move?.ok,
        moveBlocked: move?.reason === "obstruction",
        displayLabel: node.unknown ? game.i18n.localize("CRNSL.Node.Encrypted") : (node.label || "NODE"),
        displayKind: node.unknown ? "" : kindLabel(node.kind),
        showDv: !!gmIntel && !node.unknown && Number(node.dv) > 0,
        hasContents: !node.unknown && (!!node.contents || !!node.contentsImage || !!node.hasLockedData),
        attachmentCount: Array.isArray(node.attachments) ? node.attachments.length : 0,
        controlCount: Array.isArray(node.controls) ? node.controls.length : 0,
        entityCount: Array.isArray(node.entities) ? node.entities.length : 0,
        status: {
          breached: !!(node.state?.breached ?? fx.breached),
          identified: !!(node.state?.identified ?? false),
          controlled: !!(node.state?.controlledByMe ?? (fx.control?.runnerId === runner?.id)),
          virus: !!(node.state?.hasVirus ?? (fx.viruses || []).some((v) => v.runnerId === runner?.id)),
          scouted: !!node.scouted
        }
      });
    });
  }

  const edges = [];
  const nodeMap = new Map(arch.nodes.map((node) => [node.id, node]));
  for (const node of arch.nodes) {
    for (const fromId of [node.parent, ...(node.alsoFrom || [])].filter(Boolean)) {
      if (!nodeMap.has(fromId)) continue;
      const a = position.get(fromId), b = position.get(node.id);
      if (!a || !b) continue;
      edges.push({ id: `${fromId}:${node.id}`, x1: a.x + cardW / 2, y1: a.y + cardH, x2: b.x + cardW / 2, y2: b.y, secondary: fromId !== node.parent });
    }
  }

  const maxDepth = Math.max(...laid.map((n) => Math.round((n.y - pad) / (cardH + yGap))), 0);
  const height = Math.max(450, pad * 2 + (maxDepth + 1) * cardH + maxDepth * yGap);
  return { nodes: laid, edges, width, height };
}

function selectedSceneDocument() {
  return canvas?.walls?.controlled?.[0]?.document || canvas?.tokens?.controlled?.[0]?.document || canvas?.tiles?.controlled?.[0]?.document || canvas?.lighting?.controlled?.[0]?.document || canvas?.sounds?.controlled?.[0]?.document || null;
}

function controlActions(documentName) {
  return { Wall: ["open", "close", "lock", "unlock"], Token: ["show", "hide"], Tile: ["show", "hide"], AmbientLight: ["enable", "disable"], AmbientSound: ["enable", "disable"] }[documentName] || [];
}

function actionMeta(context = []) {
  return context.map((entry) => {
    const meta = ABILITY_META[entry.key] || { icon: "node", label: entry.key, hint: "" };
    return {
      ...entry,
      iconHref: ICON(meta.icon),
      label: meta.label.startsWith("CRNSL.") ? game.i18n.localize(meta.label) : meta.label,
      hint: meta.hint ? game.i18n.localize(meta.hint) : ""
    };
  });
}

function pips(runner) {
  const max = Number(runner?.actionsMax || 0);
  const used = Number(runner?.actionsUsed || 0);
  return Array.from({ length: max }, (_, i) => ({ used: i < used, index: i + 1 }));
}

function programClass(program) {
  if (program.class === "booster") return "booster";
  if (program.class === "defender") return "defender";
  if (program.class === "blackice") return "blackice";
  return "attacker";
}

function buildPrograms(runner) {
  return (runner?.programs || []).map((program) => ({
    ...program,
    bucket: programClass(program),
    rezPct: Number(program.rezMax) > 0 ? Math.max(0, Math.min(100, Math.round(Number(program.rez || 0) / Number(program.rezMax) * 100))) : 0,
    iconHref: ICON(program.class === "blackice" ? "ice" : program.class === "booster" ? "boost" : program.class === "defender" ? "shield" : "program")
  }));
}

export class NetrunningLabApp extends Application {
  constructor(store, { runtime = null, transport = null, ...options } = {}) {
    super(options);
    this.store = store;
    this.runtimeService = runtime;
    this.transport = transport;
    this.preview = !game.user.isGM;
    this.mode = game.user.isGM ? "run" : "play";
    this.selectedNodeId = "";
    this.inspectorTab = "node";
    this.programsOpen = false;
    this.gmIntel = false;
    this.candidateActorUuid = "";
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "crnsl-window",
      title: "Cyberpunk RED: Netrunning Lab",
      template: `modules/${ID}/templates/lab.hbs`,
      width: 1240,
      height: 820,
      minWidth: 860,
      minHeight: 600,
      resizable: true,
      classes: ["crnsl-window"]
    });
  }

  async getData() {
    const gm = game.user.isGM;
    const theme = game.settings.get(ID, "theme") || "redline";
    const reduceMotion = !!game.settings.get(ID, "reduceMotion");
    const densePrograms = !!game.settings.get(ID, "densePrograms");

    let privateState = null, privateArch = null, projection = null, runner = null, arch = null;
    let architectures = [], runtimeRunners = [], candidateActors = [];

    if (gm) {
      privateState = await this.store.getRuntime();
      const all = await this.store.all();
      privateArch = all[privateState.activeArchitectureId] || Object.values(all)[0] || null;
      if (privateArch && privateState.activeArchitectureId !== privateArch.id) {
        privateState.activeArchitectureId = privateArch.id;
      }
      runner = privateState.runners?.[privateState.activeRunnerId] || Object.values(privateState.runners || {})[0] || null;
      if (runner && privateState.activeRunnerId !== runner.id) privateState.activeRunnerId = runner.id;

      architectures = Object.values(all).map((a) => ({ id: a.id, name: a.name, selected: a.id === privateArch?.id }));
      runtimeRunners = Object.values(privateState.runners || {}).map((r) => ({
        id: r.id,
        name: r.name,
        img: r.img,
        selected: r.id === runner?.id,
        jackedIn: !!r.jackedIn,
        watcher: !!r.watcher,
        owner: game.users.get(r.userId)?.name || "GM"
      }));
      const existingActorUuids = new Set(runtimeRunners.map((r) => privateState.runners[r.id]?.actorUuid));
      candidateActors = candidateRunners().filter((actor) => !existingActorUuids.has(actor.uuid)).map((actor) => ({ uuid: actor.uuid, name: actor.name }));
      if (!this.candidateActorUuid && candidateActors[0]) this.candidateActorUuid = candidateActors[0].uuid;

      if (this.preview && runner && privateArch) {
        projection = sanitizeArchitecture(privateArch, privateState, runner.id);
        arch = projection ? { id: projection.architectureId, name: projection.name, nodes: projection.nodes } : null;
        runner = projection?.runner || null;
      } else {
        arch = privateArch;
      }
    } else {
      projection = readMyProjection();
      if (projection?.nodes) {
        arch = { id: projection.architectureId, name: projection.name, nodes: projection.nodes };
        runner = projection.runner;
      }
    }

    const currentNodeId = runner?.currentNodeId || projection?.currentNodeId || "";
    if (arch && (!this.selectedNodeId || !arch.nodes.some((n) => n.id === this.selectedNodeId))) this.selectedNodeId = currentNodeId || arch.nodes[0]?.id || "";

    let actionContext = [];
    let moves = [];
    let floorState = {};
    if (gm && !this.preview && privateArch && runner) {
      floorState = privateState.floorState || {};
      const current = privateArch.nodes.find((n) => n.id === runner.currentNodeId) || null;
      actionContext = current ? rules.primaryContext({
        nodes: privateArch.nodes,
        node: current,
        floorState,
        runnerId: runner.id,
        hasIceTarget: String(runner.targetRef || "").startsWith("ice:"),
        hasZapTarget: !!runner.targetRef,
        slideUsed: !!runner.slideUsed
      }) : [];
      moves = current ? rules.neighborIds(privateArch.nodes, current.id).map((id) => ({ id, ...rules.canMove(privateArch.nodes, current.id, id, floorState) })) : [];
    } else if (projection) {
      actionContext = projection.actionContext || [];
      moves = projection.moves || [];
    }

    const canvasRuntime = { currentNodeId, floorState, moves };
    const canvas = layoutArchitecture(arch, canvasRuntime, runner, { gmIntel: gm && !this.preview && this.gmIntel });
    canvas.nodes.forEach((node) => node.selected = node.id === this.selectedNodeId);
    const selected = arch?.nodes?.find((node) => node.id === this.selectedNodeId) || null;

    const inspector = selected ? this._inspectorVM(selected, { gm, privateState, privateArch, runner, preview: this.preview }) : null;
    const context = actionMeta(actionContext);
    const primary = context.filter((a) => a.available && !["pathfinder", "cloak"].includes(a.key));
    const utility = context.filter((a) => ["pathfinder", "cloak"].includes(a.key));
    const runnerVM = runner ? {
      ...runner,
      pips: pips(runner),
      actionsRemaining: Math.max(0, Number(runner.actionsMax || 0) - Number(runner.actionsUsed || 0)),
      programs: buildPrograms(runner),
      stealthed: !!runner.stealthed,
      stateLabel: runner.stealthed ? game.i18n.localize("CRNSL.State.Stealthed") : runner.jackedIn ? game.i18n.localize("CRNSL.State.JackedIn") : game.i18n.localize("CRNSL.State.Offline")
    } : null;

    return {
      gm,
      preview: this.preview,
      buildMode: gm && !this.preview && this.mode === "build",
      runMode: gm && !this.preview && this.mode === "run",
      playerMode: !gm || this.preview,
      themeClass: `theme-${theme}`,
      reduceMotion,
      densePrograms,
      secure: !!(gm || this.transport?.secure),
      modeLabel: this.preview ? "PLAYER VIEW" : this.mode === "build" ? "BUILD" : gm ? "GM RUN" : "PLAYER",
      hasArchitecture: !!arch,
      architectureName: arch?.name || "",
      architectures,
      runtimeRunners,
      candidateActors,
      candidateActorUuid: this.candidateActorUuid,
      runner: runnerVM,
      canvas: { ...canvas, style: `width:${canvas.width}px;height:${canvas.height}px` },
      inspector,
      inspectorTab: this.inspectorTab,
      tabNode: this.inspectorTab === "node",
      tabData: this.inspectorTab === "data",
      tabControl: this.inspectorTab === "control",
      actions: {
        primary,
        utility,
        hasAny: primary.length > 0 || utility.length > 0,
        canSpend: !!runnerVM && runnerVM.actionsRemaining > 0,
        canOperate: !!runnerVM && !!(gm || this.transport?.secure),
        programsOpen: this.programsOpen,
        programs: runnerVM?.programs || []
      },
      gmIntel: this.gmIntel,
      productionAvailable: game.modules.get("cpr-netrunning")?.active === true,
      footerVersion: "0.2.0"
    };
  }

  _inspectorVM(selected, { gm, privateState, privateArch, runner, preview }) {
    const privateNode = gm && !preview ? privateArch?.nodes?.find((n) => n.id === selected.id) : null;
    const source = privateNode || selected;
    const fx = privateState?.floorState?.[source.id] || {};
    const attachments = (source.attachments || []).map((a) => ({ ...a, iconHref: ICON(a.documentType === "Item" ? "item" : "journal") }));
    const controls = (source.controls || []).map((c) => ({
      ...c,
      actions: controlActions(c.documentType).map((value) => ({ value, label: value.toUpperCase(), selected: value === c.action }))
    }));
    const entities = (source.entities || []).map((entity) => ({ ...entity, iconHref: ICON(entity.kind === "demon" ? "demon" : "ice") }));
    const controlledByRunner = !!runner && (selected.state?.controlledByMe || fx.control?.runnerId === runner.id);
    return {
      ...selected,
      iconHref: ICON(iconFor(selected.kind, selected.unknown)),
      displayLabel: selected.unknown ? game.i18n.localize("CRNSL.Node.Encrypted") : (selected.label || "NODE"),
      displayKind: selected.unknown ? "" : kindLabel(selected.kind),
      unknown: !!selected.unknown,
      gmNotes: gm && !preview ? source.gmNotes || "" : "",
      showPrivateDV: gm && !preview,
      dv: gm && !preview ? Number(source.dv || 0) : null,
      check: selected.check || source.check || "",
      contents: selected.contents || (gm && !preview ? source.contents || "" : ""),
      contentsImage: selected.contentsImage || (gm && !preview ? source.contentsImage || "" : ""),
      hasLockedData: !!selected.hasLockedData,
      attachments,
      controls,
      entities,
      controlledByRunner,
      canBind: gm && !preview && this.mode === "build",
      isCurrent: runner?.currentNodeId === selected.id,
      state: {
        breached: !!(selected.state?.breached ?? fx.breached),
        identified: !!(selected.state?.identified ?? false),
        controlled: controlledByRunner,
        virus: !!(selected.state?.hasVirus ?? (fx.viruses || []).some((v) => v.runnerId === runner?.id)),
        scouted: !!selected.scouted
      }
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action]", (event) => {
      event.preventDefault();
      this._action(event.currentTarget.dataset.action, event.currentTarget, event.originalEvent || event).catch((error) => {
        console.error(`${ID} |`, error);
        ui.notifications.error(error.message);
      });
    });
    html.on("change", "[data-role='architecture']", (event) => this._selectArchitecture(event.currentTarget.value).catch((e) => ui.notifications.error(e.message)));
    html.on("change", "[data-role='runner']", (event) => this._selectRunner(event.currentTarget.value).catch((e) => ui.notifications.error(e.message)));
    html.on("change", "[data-role='candidate']", (event) => { this.candidateActorUuid = event.currentTarget.value; });
    html.on("change", "[data-control-action]", (event) => this._changeControlAction(event.currentTarget.dataset.controlId, event.currentTarget.value).catch((e) => ui.notifications.error(e.message)));
    html.on("click", ".crnsl-node", (event) => {
      if (event.target.closest("button")) return;
      this.selectedNodeId = event.currentTarget.dataset.nodeId;
      this.render(false);
    });
    html.on("dblclick", ".crnsl-node[data-can-move='true']", (event) => {
      this._move(event.currentTarget.dataset.nodeId).catch((e) => ui.notifications.error(e.message));
    });
    html.on("dragover", ".crnsl-node", (event) => { if (game.user.isGM && !this.preview && this.mode === "build") event.preventDefault(); });
    html.on("drop", ".crnsl-node", (event) => {
      if (!game.user.isGM || this.preview || this.mode !== "build") return;
      event.preventDefault();
      this._dropDocument(event.originalEvent || event, event.currentTarget.dataset.nodeId).catch((e) => ui.notifications.error(e.message));
    });
  }

  async _action(action, target, event) {
    const nodeId = target.dataset.nodeId || this.selectedNodeId;
    switch (action) {
      case "mode-run": this.mode = "run"; this.preview = false; break;
      case "mode-build": this.mode = "build"; this.preview = false; break;
      case "toggle-preview": this.preview = !this.preview; break;
      case "intel-toggle": this.gmIntel = !this.gmIntel; break;
      case "programs-toggle": this.programsOpen = !this.programsOpen; break;
      case "tab-node": this.inspectorTab = "node"; break;
      case "tab-data": this.inspectorTab = "data"; break;
      case "tab-control": this.inspectorTab = "control"; break;
      case "import-production": await this._importProduction(); break;
      case "create-demo": await this._createDemo(); break;
      case "runner-add": await this._addRunner(); break;
      case "runner-remove": await this._removeRunner(); break;
      case "start-turn": await this._request({ op: "startTurn" }); break;
      case "jack-in": await this._request({ op: "jackIn" }); break;
      case "quiet-jack": await this._quietJack(event); break;
      case "jack-out": await this._request({ op: "jackOut" }); break;
      case "move": await this._move(nodeId); break;
      case "ability": await this._runAbility(target.dataset.ability, nodeId, event); break;
      case "program-toggle": await this._request({ op: "programToggle", programId: target.dataset.programId, rezzed: target.dataset.rezzed === "true" }); break;
      case "control-execute": await this._request({ op: "executeControl", nodeId, controlId: target.dataset.controlId }); break;
      case "attachment-open": await this._openAttachment(target.dataset.uuid); return;
      case "attachment-toggle": await this._toggleAttachment(nodeId, target.dataset.attachmentId); break;
      case "attachment-remove": await this._removeAttachment(nodeId, target.dataset.attachmentId); break;
      case "bind-selected": await this._bindSelected(nodeId); break;
      case "control-remove": await this._removeControl(nodeId, target.dataset.controlId); break;
      default: return;
    }
    this.render(false);
  }

  async _request(payload) {
    const runnerId = await this._currentRunnerId();
    if (!runnerId) throw new Error("Select a Netrunner first.");
    return this.transport.request({ ...payload, runnerId });
  }

  async _currentRunnerId() {
    if (!game.user.isGM) return readMyProjection()?.runner?.id || "";
    const runtime = await this.store.getRuntime();
    return runtime.activeRunnerId || "";
  }

  async _runAbility(ability, nodeId, event) {
    if (!ABILITY_META[ability]) throw new Error("Unknown Interface Ability.");
    let virusText = "";
    if (ability === "virus") {
      virusText = await Dialog.prompt({
        title: game.i18n.localize("CRNSL.Virus.Title"),
        content: `<p>${game.i18n.localize("CRNSL.Virus.Hint")}</p><textarea name="virus" rows="4"></textarea>`,
        callback: (html) => String(html.find("textarea[name='virus']").val() || "")
      });
      if (virusText === null || virusText === undefined) return;
    }

    const runnerId = await this._currentRunnerId();
    const grant = await this.transport.request({ op: "beginAbility", runnerId, ability, nodeId, virusText });
    const actor = await fromUuid(grant.actorUuid);
    if (!actor) throw new Error("Runner Actor is unavailable.");
    const rolled = await rollInterface(actor, ability, event, { grantToken: grant.token });
    if (!rolled?.messageId) {
      await this.transport.request({ op: "cancelRoll", token: grant.token, runnerId });
      return;
    }
    const result = await this.transport.request({ op: "completeAbility", runnerId, token: grant.token, messageId: rolled.messageId });
    if (["backdoor", "control", "eyedee"].includes(ability)) {
      ui.notifications[result.success ? "info" : "warn"](game.i18n.localize(result.success ? "CRNSL.Roll.Success" : "CRNSL.Roll.Failure"));
    }
  }

  async _quietJack(event) {
    const runnerId = await this._currentRunnerId();
    const grant = await this.transport.request({ op: "beginQuietJack", runnerId });
    const actor = await fromUuid(grant.actorUuid);
    if (!actor) throw new Error("Runner Actor is unavailable.");
    const rolled = await rollPlainInterface(actor, event, { grantToken: grant.token });
    if (!rolled?.messageId) {
      await this.transport.request({ op: "cancelRoll", token: grant.token, runnerId });
      return;
    }
    const result = await this.transport.request({ op: "completeQuietJack", runnerId, token: grant.token, messageId: rolled.messageId });
    ui.notifications[result.stealthSucceeded ? "info" : "warn"](game.i18n.localize(result.stealthSucceeded ? "CRNSL.Stealth.Established" : "CRNSL.Stealth.Detected"));
  }

  async _move(nodeId) {
    await this._request({ op: "move", nodeId });
    this.selectedNodeId = nodeId;
  }

  async _selectArchitecture(id) {
    if (!game.user.isGM) return;
    const runtime = await this.store.getRuntime();
    if (Object.values(runtime.runners || {}).some((runner) => runner.jackedIn)) throw new Error("Jack all Netrunners Out before switching architecture.");
    const arch = await this.store.get(id);
    if (!arch) return;
    await this.store.mutateRuntime((state) => {
      state.activeArchitectureId = id;
      state.floorState = {};
      for (const runner of Object.values(state.runners || {})) {
        runner.currentNodeId = arch.nodes.find((n) => !n.parent)?.id || arch.nodes[0]?.id || "";
        runner.knownNodeIds = [];
        runner.visitedNodeIds = [];
        runner.actionsUsed = 0;
        runner.stealthed = false;
      }
    });
    this.selectedNodeId = "";
    await publishAllProjections(this.store);
    this.render(false);
  }

  async _selectRunner(id) {
    if (!game.user.isGM) return;
    await this.runtimeService.selectRunner(id);
    this.selectedNodeId = "";
    await publishAllProjections(this.store);
    this.render(false);
  }

  async _addRunner() {
    if (!game.user.isGM) return;
    if (!this.candidateActorUuid) throw new Error("Choose an eligible Netrunner Actor.");
    await this.runtimeService.addRunner(this.candidateActorUuid);
    await publishAllProjections(this.store);
    this.candidateActorUuid = "";
  }

  async _removeRunner() {
    if (!game.user.isGM) return;
    const runtime = await this.store.getRuntime();
    const id = runtime.activeRunnerId;
    if (!id) return;
    if (runtime.runners[id]?.jackedIn) throw new Error("Jack the Netrunner Out first.");
    await this.runtimeService.removeRunner(id);
    await publishAllProjections(this.store);
  }

  async _importProduction() {
    if (!game.user.isGM) return;
    const imported = await this.store.importProduction();
    if (!imported.length) return;
    await this._selectArchitecture(imported[0].id);
    ui.notifications.info(game.i18n.format("CRNSL.Imported", { count: imported.length }));
  }

  async _createDemo() {
    if (!game.user.isGM) return;
    const demo = await this.store.createDemo();
    await this._selectArchitecture(demo.id);
  }

  async _dropDocument(event, nodeId) {
    const data = TextEditor.getDragEventData(event);
    if (!data?.uuid) throw new Error("Drop a JournalEntry, JournalEntryPage, or Item.");
    const doc = await fromUuid(data.uuid);
    if (!doc || !["JournalEntry", "JournalEntryPage", "Item"].includes(doc.documentName)) throw new Error("Supported: JournalEntry, JournalEntryPage, Item.");
    const runtime = await this.store.getRuntime();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => {
      node.attachments ||= [];
      if (!node.attachments.some((a) => a.uuid === doc.uuid)) node.attachments.push({ id: uid("att"), uuid: doc.uuid, label: doc.name, documentType: doc.documentName, visible: false });
    });
    await publishAllProjections(this.store);
    this.selectedNodeId = nodeId;
  }

  async _openAttachment(uuid) {
    const doc = await fromUuid(uuid);
    if (!doc) throw new Error("Linked document unavailable.");
    doc.sheet?.render(true);
  }

  async _toggleAttachment(nodeId, attachmentId) {
    if (!game.user.isGM || this.preview || this.mode !== "build") return;
    const runtime = await this.store.getRuntime();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => {
      const attachment = (node.attachments || []).find((a) => a.id === attachmentId);
      if (!attachment) throw new Error("Attachment not found.");
      attachment.visible = !attachment.visible;
    });
    await publishAllProjections(this.store);
  }

  async _removeAttachment(nodeId, attachmentId) {
    if (!game.user.isGM || this.preview || this.mode !== "build") return;
    const runtime = await this.store.getRuntime();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => {
      node.attachments = (node.attachments || []).filter((a) => a.id !== attachmentId);
    });
    await publishAllProjections(this.store);
  }

  async _bindSelected(nodeId) {
    if (!game.user.isGM || this.preview || this.mode !== "build") return;
    const doc = selectedSceneDocument();
    if (!doc) throw new Error("Select a door, Token, Tile, Light, or Sound first.");
    const actions = controlActions(doc.documentName);
    if (!actions.length) throw new Error(`Unsupported: ${doc.documentName}.`);
    const runtime = await this.store.getRuntime();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => {
      node.controls ||= [];
      node.controls.push({ id: uid("ctl"), uuid: doc.uuid, label: doc.name || `${doc.documentName} control`, documentType: doc.documentName, action: actions[0], visible: true });
    });
    await publishAllProjections(this.store);
  }

  async _changeControlAction(controlId, action) {
    if (!game.user.isGM || this.preview || this.mode !== "build") return;
    const runtime = await this.store.getRuntime();
    await this.store.mutateNode(runtime.activeArchitectureId, this.selectedNodeId, (node) => {
      const control = (node.controls || []).find((c) => c.id === controlId);
      if (!control) throw new Error("Control not found.");
      if (!controlActions(control.documentType).includes(action)) throw new Error("Unsupported action.");
      control.action = action;
    });
    await publishAllProjections(this.store);
    this.render(false);
  }

  async _removeControl(nodeId, controlId) {
    if (!game.user.isGM || this.preview || this.mode !== "build") return;
    const runtime = await this.store.getRuntime();
    await this.store.mutateNode(runtime.activeArchitectureId, nodeId, (node) => {
      node.controls = (node.controls || []).filter((c) => c.id !== controlId);
    });
    await publishAllProjections(this.store);
  }

  async onActorUpdated(actor) {
    if (!game.user.isGM) return;
    const runtime = await this.store.getRuntime();
    const runner = Object.values(runtime.runners || {}).find((r) => r.actorUuid === actor.uuid);
    if (!runner) return;
    await this.runtimeService.refreshRunner(runner.id);
    await publishAllProjections(this.store);
    this.render(false);
  }
}
