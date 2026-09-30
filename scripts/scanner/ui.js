import { accessPointTypes, typeInfo } from "./types.js";
import { MODULE_ID, MODULE_TITLE, TYPES } from "./constants.js";
import { apData, isAP, sceneDistance, validateRadius, withinRadius } from "./model.js";
import { architectures, colorFor, saveUnassignedColor, hideAPs, pulseAPs, requireGM, applyAPControls, serverNow, saveAP, stopPulses } from "./actions.js";
import { setting, pulseLabel, pulseCount } from "./settings.js";

import { visibleControls, controlState, bulkControls, controlChange } from "./controls.js";

import { isNetrunner, isPlayerOwned } from "./runners.js";
import { openArchitecture } from "./architectures.js";
import { cameraConfig, controlFloors } from "./camera-rules.js";

const panels = new Map();
const rootElement = (html) => html[0] ?? html;
const report = (error) => { console.error(`${MODULE_ID} |`, error); ui.notifications.error(error.message); };
export function editAccessPoint(doc) {
  if (apData(doc).type === "camera") return import("./camera-manager.js").then(({ openCameraManager }) => openCameraManager(doc));
  return new APEditor(doc).render(true);
}

export function refreshPanels() {
  for (const panel of panels.values()) if (panel.rendered && !panel.busy) panel.render(false);
}

export class APEditor extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["crns-ap-scanner", "crns-ap-ap-editor"], title: "Точка доступа",
      template: `modules/${MODULE_ID}/templates/scanner/ap-editor.hbs`,
      width: 440, height: "auto", closeOnSubmit: true,
      submitOnChange: false, submitOnClose: false,
    });
  }

  getData() {
    const data = apData(this.object);
    const camera = cameraConfig(this.object);
    const items = architectures();
    const nets = items.map((item) => ({ uuid: item.uuid, label: item.parent ? `${item.name} (${item.parent.name})` : item.name, selected: item.uuid === data.netarch }));
    if (data.netarch && !nets.some((entry) => entry.uuid === data.netarch)) nets.unshift({ uuid: data.netarch, label: "Архитектура удалена — выберите другую", selected: true });
    return {
      appId: this.appId,
      isCamera: data.type === "camera", camera, cameraRotation: this.object.rotation ?? 0,
      cameraNodes: controlFloors(game.settings.get(MODULE_ID, "netArchs")?.[camera.archId])
        .map((floor, index) => ({ id: floor.id, label: floor.label || `Узел ${index + 1}`, selected: floor.id === camera.floorId })),
      name: this.object.name,
      types: [...accessPointTypes(), ...(!accessPointTypes().some(entry => entry.id === data.type) ? [{ ...(typeInfo(data.type) ?? { id: data.type, label: data.type }), label: (typeInfo(data.type)?.label ?? data.type) + " (отключён)" }] : [])].map(entry => ({ ...entry, selected: entry.id === data.type })),
      nets, noNet: !data.netarch, color: colorFor(data.netarch, this.object.parent), hasNet: Boolean(data.netarch),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = rootElement(html);
    const cameraFields = root.querySelector(".ap-camera-settings");
    root.querySelector('[name="type"]').addEventListener("change", event => {
      cameraFields.hidden = event.target.value !== "camera";
    });
    root.querySelector('[name="netarch"]').addEventListener("change", (event) => {
      root.querySelector('[name="color"]').value = colorFor(event.target.value, this.object.parent);
      root.querySelector('[name="color"]').disabled = !event.target.value;
      root.querySelector('[data-action="open-netarch"]').disabled = !event.target.value;
      const select = root.querySelector('[name="cameraFloor"]');
      const previous = select.value;
      select.replaceChildren(new Option("Выберите управляющий узел", ""));
      const archId = event.target.value.startsWith("CRNS.NetArch.") ? event.target.value.slice(13) : "";
      controlFloors(game.settings.get(MODULE_ID, "netArchs")?.[archId]).forEach((floor, index) => {
        select.add(new Option(floor.label || `Узел ${index + 1}`, floor.id, false, floor.id === previous));
      });
    });
    root.querySelector('[data-action="open-netarch"]').addEventListener("click", async () => {
      const uuid = root.querySelector('[name="netarch"]').value;
      try {
        await openArchitecture(uuid);
      } catch (error) { report(error); }
    });
  }

  async _updateObject(_event, data) {
    try { await saveAP(this.object, data); }
    catch (error) { report(error); throw error; }
  }
}

export class ScannerPanel extends Application {
  constructor({ scene, runnerId = "", result = null, selected = [], messageId = null } = {}, options = {}) {
    super(options);
    this.scene = scene;
    this.runnerId = runnerId;
    this.result = result;
    this.messageId = messageId;
    this.playerOwnedOnly = true;
    const configuredRadius = Number(setting("scannerRadius"));
    this.radius = Number.isFinite(configuredRadius) && configuredRadius >= 0 ? configuredRadius : 0;
    this.selected = new Set(selected);
    this.bulkChanges = {};
    this.busy = false;
    this.options.id = `${MODULE_ID}-${scene.id}`;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["crns-ap-scanner", "crns-ap-scanner-panel"],
      title: "Сканер — точки доступа", template: `modules/${MODULE_ID}/templates/scanner/scanner.hbs`,
      width: Math.min(1140, (globalThis.innerWidth || 1200) - 32), height: "auto", resizable: true, scrollY: [".ap-list"],
    });
  }

  get runners() { return this.scene.tokens.filter(doc => isNetrunner(doc) && (!this.playerOwnedOnly || isPlayerOwned(doc))); }
  get runner() { return this.runners.find(doc => doc.id === this.runnerId) ?? null; }
  get documents() { return this.scene.tokens.filter(isAP); }

  getData() {
    if (setting("showRevealAll") === false && this.bulkChanges.reveal === "all") delete this.bulkChanges.reveal;
    const tokenNames = new Map([...game.scenes].flatMap(scene => [...scene.tokens].map(token => [token.uuid, token.name])));
    const netNames = new Map(architectures().map((item) => [item.uuid, item.name]));
    this.pruneSelection();
    const runner = this.runner;
    if (!runner) this.runnerId = "";
    const rows = this.documents.map((doc) => {
      const data = apData(doc);
      const distance = sceneDistance(runner, doc, this.scene.grid);
      const visible = withinRadius(distance, this.radius);
      const discovery = data.discovery;
      const users = (discovery?.users ?? []).map((id) => game.users.get(id)?.name).filter(Boolean);
      const recipients = (discovery?.runners ?? []).map(uuid => tokenNames.get(uuid) ?? "Токен нетраннера удалён");
      return {
        id: doc.id, name: doc.name, type: typeInfo(data.type)?.label ?? "Точка доступа",
        netarch: data.netarch ? netNames.get(data.netarch) ?? "Архитектура удалена" : "Без привязки к архитектуре",
        color: colorFor(data.netarch, this.scene), distance, distanceText: distance === null ? "—" : distance.toFixed(1),
        visible, selected: this.selected.has(doc.id),
        controls: visibleControls().map(option => ({ ...option, checked: controlState(doc, serverNow(), this.runner?.uuid ?? null)[option.key], apId: doc.id, name: doc.name })),
        status: !discovery?.revealed ? "Скрыта" : discovery.public ? "Все игроки" : recipients.join(", ") || (users.length ? `Игроки: ${users.join(", ")}` : "Только мастер"),
        statusTitle: discovery?.revealed && !discovery.public && users.length ? `Видят игроки: ${users.join(", ")}` : "",
      };
    }).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name));
    return {
      showRevealAll: setting("showRevealAll") !== false, unassignedColor: colorFor("", this.scene), hasRollCard: Boolean(this.messageId), pulseLabel: pulseLabel(), pulseCount: pulseCount(), pulseUnit: "", sceneName: this.scene.name, result: this.result, hasResult: this.result !== null,
      radius: this.radius, units: this.scene.grid.units || "ед.", rows,
      playerOwnedOnly: this.playerOwnedOnly, runnerMissing: !runner, runnerName: runner?.name ?? "Не выбран", hasRows: rows.length > 0,
      runners: this.runners
        .map((doc) => ({ id: doc.id, name: doc.name, selected: doc.id === this.runnerId })),
      bulkControls: bulkControls(this.selectedDocuments(), this.bulkChanges, serverNow(), this.runner?.uuid ?? null),
      canApply: this.selectedDocuments().length > 0 && Object.keys(this.bulkChanges).length > 0,
      selectedCount: rows.filter((row) => row.visible && row.selected).length,
      visibleCount: rows.filter((row) => row.visible).length, totalCount: rows.length,
      busy: this.busy,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = rootElement(html);
    root.querySelector('[name="unassignedColor"]').addEventListener("change", event => {
      saveUnassignedColor(this.scene, event.target.value).catch(error => { report(error); this.render(false); });
    });
    root.querySelector('[name="playerOwnedOnly"]').addEventListener("change", event => {
      this.playerOwnedOnly = event.target.checked;
      if (!this.runner) this.runnerId = "";
      this.bulkChanges = {};
      this.render(false);
    });
    root.querySelector('[name="runner"]').addEventListener("change", (event) => {
      this.runnerId = event.target.value;
      this.bulkChanges = {};
      this.render(false);
    });
    root.querySelector('[name="radius"]').addEventListener("change", (event) => {
      try { this.radius = validateRadius(event.target.value.trim() || "0"); this.bulkChanges = {}; }
      catch (error) { report(error); }
      this.render(false);
    });
    root.querySelectorAll("[data-ap-select]").forEach(checkbox => checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(checkbox.dataset.apSelect);
      else this.selected.delete(checkbox.dataset.apSelect);
      this.bulkChanges = {};
      this.syncControls(root);
    }));
    root.querySelectorAll("[data-control]").forEach(checkbox => checkbox.addEventListener("change", () => {
      this.readRunnerSelection(root);
      const changes = controlChange(checkbox.dataset.group, checkbox.dataset.control, checkbox.checked);
      if (checkbox.dataset.apId) this.applyControls([this.scene.tokens.get(checkbox.dataset.apId)], changes).catch(report);
      else { Object.assign(this.bulkChanges, changes); this.syncControls(root); }
    }));
    const list = root.querySelector(".ap-list");
    const header = root.querySelector(".ap-list-header");
    const bulk = root.querySelector(".ap-bulk-bar");
    const syncHeader = () => { header.scrollLeft = list.scrollLeft; bulk.scrollLeft = list.scrollLeft; };
    list.addEventListener("scroll", syncHeader, { passive: true });
    syncHeader();
    this.renderRollCard(root);
    this.syncControls(root);
    this.highlightRunner();
    root.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      this.readRunnerSelection(root);
      this.handleAction(button.dataset.action, button.dataset.apId).catch(report);
    }));
  }

  async renderRollCard(root) {
    const host = root.querySelector(".ap-roll-card");
    if (!host) return;
    const messageId = this.messageId;
    const message = game.messages?.get(messageId);
    if (!message || !message.visible) {
      host.textContent = "Исходная карточка «Сканера» удалена.";
      return;
    }
    try {
      // Render a fresh copy through Foundry, retaining system dice markup and listeners.
      const html = await message.getHTML();
      if (!host.isConnected || this.messageId !== messageId || game.messages.get(messageId) !== message) return;
      const card = html[0];
      if (!card) throw new Error("Не удалось отобразить карточку «Сканера».");
      card.querySelectorAll(".crns-ap-open-scanner").forEach(button => button.remove());
      host.replaceChildren(card);
    } catch (error) {
      if (host.isConnected && this.messageId === messageId) host.textContent = "Карточка недоступна в панели. Откройте исходное сообщение в чате.";
      console.error(`${MODULE_ID} | Scanner roll preview`, error);
    }
  }

  syncControls(root) {
    const now = serverNow();
    root.querySelectorAll("[data-control][data-ap-id]").forEach(checkbox => {
      const doc = this.scene.tokens.get(checkbox.dataset.apId);
      checkbox.checked = doc ? controlState(doc, now, this.runner?.uuid ?? null)[checkbox.dataset.control] : false;
      checkbox.disabled = this.busy;
    });
    const docs = this.selectedDocuments();
    for (const option of bulkControls(docs, this.bulkChanges, now, this.runner?.uuid ?? null)) {
      const checkbox = root.querySelector(`[data-control="${option.key}"]:not([data-ap-id])`);
      if (!checkbox) continue;
      checkbox.checked = option.checked; checkbox.indeterminate = option.mixed;
      checkbox.disabled = this.busy || !docs.length;
    }
    root.querySelector(".ap-selection-count").textContent = `Выбрано: ${docs.length}`;
    root.querySelector('[data-action="apply"]').disabled = this.busy || !docs.length || !Object.keys(this.bulkChanges).length;
    clearTimeout(this.pulseTimer);
    const ends = this.documents.map(doc => apData(doc).pulse).filter(pulse => pulse && !pulse.loop)
      .map(pulse => pulse.started + pulse.duration * pulse.count).filter(end => Number.isFinite(end) && end > now);
    if (ends.length) this.pulseTimer = setTimeout(() => {
      if (this.rendered && root.isConnected) this.syncControls(root);
    }, Math.min(2147483647, Math.max(50, Math.min(...ends) - now + 30)));
  }

  readRunnerSelection(root) {
    const select = root.querySelector('[name="runner"]');
    if (select && this.runnerId !== select.value) {
      this.runnerId = select.value;
      this.bulkChanges = {};
    }
  }

  async applyControls(docs, changes) {
    requireGM();
    if (this.busy) return;
    const runner = this.runner;
    this.busy = true;
    this.element.find("button, input, select").prop("disabled", true);
    try {
      await applyAPControls(docs, changes, { runner });
      this.bulkChanges = {};
    } finally { this.busy = false; this.render(false); }
  }

  highlightRunner({control=false}={}) {
    const doc=this.runner;
    Hooks.callAll?.('cprNetrunningScannerRunner',{sceneId:this.scene.id,tokenId:doc?.id||''});
    const key=doc?`${this.scene.id}:${doc.id}`:'';
    const changed=this._highlightedRunnerKey!==key;this._highlightedRunnerKey=key;
    if(doc&&canvas.scene?.id===this.scene.id&&(control||changed)){
      const token=canvas.tokens.get(doc.id);
      if(token&&!token.controlled&&typeof token.control==='function')token.control({releaseOthers:true});
    }
  }

  selectedDocuments() {
    this.pruneSelection();
    return this.documents.filter((doc) => this.selected.has(doc.id)
      && withinRadius(sceneDistance(this.runner, doc, this.scene.grid), this.radius));
  }

  pruneSelection() {
    for (const id of this.selected) {
      const doc = this.scene.tokens.get(id);
      if (!isAP(doc) || !withinRadius(sceneDistance(this.runner, doc, this.scene.grid), this.radius)) {
        this.selected.delete(id);
        this.bulkChanges = {};
      }
    }
  }

  async handleAction(action, id) {
    requireGM();
    if (this.busy) return;
    const doc = id ? this.scene.tokens.get(id) : null;
    if (action === "locate-runner") {
      if(!this.runner)throw Error('Выберите токен нетраннера.');
      if(canvas.scene?.id!==this.scene.id)throw Error('Откройте сцену сканера.');
      this.highlightRunner({control:true});const token=canvas.tokens.get(this.runner.id);if(token)await canvas.animatePan({...token.center});return;
    }
    if (action === "hide-all") {
      if (!this.documents.length) return;
      return this.applyControls(this.documents, { reveal: "hidden", pulse: "off", showName: false });
    }
    if (action === "edit" && doc) return editAccessPoint(doc);
    if (action === "locate" && doc) {
      if (canvas.scene?.id !== this.scene.id) throw new Error("Откройте эту сцену, чтобы перейти к её точке доступа.");
      const token = canvas.tokens.get(doc.id);
      if (token) {
        await canvas.animatePan({ ...token.center });
        token.control({ releaseOthers: true });
      }
      return;
    }
    if (action === "select-visible") {
      for (const row of this.getData().rows) if (row.visible) this.selected.add(row.id);
      this.bulkChanges = {}; this.render(false); return;
    }
    if (action === "clear") { this.selected.clear(); this.bulkChanges = {}; this.render(false); return; }
    if (action === "apply") {
      if (this.radius > 0 && !this.runner) throw new Error("Выберите токен нетраннера для фильтра по расстоянию.");
      return this.applyControls(this.selectedDocuments(), this.bulkChanges);
    }
  }

  async close(options) {
    clearTimeout(this.pulseTimer);
    panels.delete(this.scene.id);
    Hooks.callAll?.('cprNetrunningScannerRunner',{sceneId:this.scene.id,tokenId:''});
    return super.close(options);
  }
}

export function openScanner({ scene = canvas.scene, runnerId = "", result = null, selected = [], messageId = null } = {}) {
  requireGM();
  if (!scene) throw new Error("Сначала откройте сцену, затем панель сканера.");
  let panel = panels.get(scene.id);
  if (!panel) {
    if (!runnerId && canvas.scene?.id === scene.id) {
      const controlled = canvas.tokens.controlled.filter((token) => isNetrunner(token.document));
      if (controlled.length === 1) runnerId = controlled[0].id;
    }
    panel = new ScannerPanel({ scene, runnerId, result, selected, messageId });
    panels.set(scene.id, panel);
  } else {
    if (runnerId || result !== null) panel.runnerId = runnerId;
    if (result !== null) { panel.result = result; panel.messageId = messageId; panel.selected.clear(); }
    if (selected.length) panel.selected = new Set(selected);
  }
  if (selected.length) panel.radius = 0;
  panel.highlightRunner();
  panel.bulkChanges = {};
  panel.render(true);
  // Initial rendering is asynchronous; Foundry raises the window when it is ready.
  if (panel.rendered && panel.element?.[0]?.isConnected) panel.bringToTop();
  return panel;
}

const wrappedTokenClasses = new WeakSet();

export function installAPDoubleClick(tokenClass = CONFIG.Token.objectClass) {
  if (wrappedTokenClasses.has(tokenClass)) return;
  if (typeof globalThis.libWrapper?.register !== "function") throw new Error("Включите libWrapper и перезагрузите мир, чтобы использовать сканер.");
  if (typeof tokenClass.prototype._onClickLeft2 !== "function") throw new Error("Недоступен обработчик двойного щелчка токена. Проверьте версию Foundry.");
  libWrapper.register(MODULE_ID, "CONFIG.Token.objectClass.prototype._onClickLeft2", function(wrapped, ...args) {
    if (game.user.isGM && isAP(this.document)) return editAccessPoint(this.document);
    return wrapped(...args);
  }, "MIXED");
  wrappedTokenClasses.add(tokenClass);
}

export function registerUI() {
  Hooks.on("getApplicationHeaderButtons", (app, buttons) => {
    if (!app.options.classes?.includes("crns-ap-scanner")) return;
    const close = buttons.find(button => button.class === "close");
    if (close) close.label = "Закрыть";
  });
  Hooks.on("renderApplication", (app, html) => {
    if (!app.options.classes?.includes("crns-ap-scanner")) return;
    for (const element of rootElement(html).querySelectorAll("button, input, select")) {
      const label = element.getAttribute("title") || element.getAttribute("aria-label")
        || element.closest("label")?.textContent?.trim() || element.textContent?.trim();
      if (label && !element.dataset.tooltip) element.dataset.tooltip = label;
    }
  });
  // Token interaction callbacks bind before ready on an initial scene load.
  Hooks.once("setup", () => installAPDoubleClick());
  Hooks.on("canvasInit", () => installAPDoubleClick());
  Hooks.on("renderTokenHUD", (hud, html) => {
    const doc = hud.object?.document;
    if (!game.user.isGM || !isAP(doc)) return;
    const root = rootElement(html);
    root.classList.add("crns-ap-ap-hud");
    root.querySelectorAll('.control-icon:not([data-action="config"]), .attribute, .status-effects').forEach((element) => { element.hidden = true; });
    const column = root.querySelector(".col.right");
    if (!column) return;
    const add = (label, icon, callback) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "control-icon crns-ap-ap-action";
      button.title = label; button.setAttribute("aria-label", label);
      const glyph = document.createElement("i"); glyph.className = `fas ${icon}`; button.append(glyph);
      button.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        Promise.resolve().then(callback).catch(report);
      });
      column.append(button);
    };
    add(apData(doc).type === "camera" ? "Настроить связь и обзор камеры" : "Изменить точку доступа", "fa-pen-to-square", () => editAccessPoint(doc));
    add("Показать точку доступа…", "fa-eye", () => openScanner({ scene: doc.parent, selected: [doc.id] }));
    if (apData(doc).discovery?.revealed) {
      add("Скрыть точку от всех игроков", "fa-eye-slash", () => hideAPs([doc]));
      add("Подать сигнал", "fa-tower-broadcast", () => {
        return pulseAPs([doc]);
      });
      add("Остановить сигнал", "fa-stop", () => stopPulses([doc]));
    }
  });
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls.find((control) => control.name === "token")?.tools.push({
      name: MODULE_ID, title: MODULE_TITLE, icon: "fas fa-tower-broadcast", button: true,
      onClick: () => { try { openScanner(); } catch (error) { report(error); } },
    });
  });
  for (const hook of ["createToken", "updateToken", "deleteToken"]) {
    Hooks.on(hook, (doc) => { const panel = panels.get(doc.parent?.id); if (panel?.rendered && !panel.busy) panel.render(false); });
  }
  for (const hook of ["updateChatMessage", "deleteChatMessage"]) {
    Hooks.on(hook, message => {
      for (const panel of panels.values()) {
        if (panel.messageId === message.id && panel.rendered && !panel.busy) panel.render(false);
      }
    });
  }
  Hooks.on("updateScene", scene => { const panel = panels.get(scene.id); if (panel?.rendered && !panel.busy) panel.render(false); });
  Hooks.on("updateActor", () => refreshPanels());
  Hooks.on("updateUser", () => refreshPanels());
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (!["netarch", "role"].includes(item.type)) return;
      refreshPanels();
    });
  }
}
