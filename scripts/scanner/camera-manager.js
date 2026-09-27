import { MODULE_ID, iconPath } from "./constants.js";
import { isAP, escapeHTML } from "./model.js";
import { cameraConfig, controlFloors, validOptics } from "./camera-rules.js";
import { cameraDraft, cameraCenter, directionTo, saveCameraBinding } from "./camera-setup.js";
import { requireGM } from "./actions.js";
import { ensureTemplates } from "./templates.js";

let manager;
const isCamera = doc => isAP(doc) && doc.flags[MODULE_ID].type === "camera";
const rootOf = html => html[0] ?? html;

export function openCameraManager(doc = null) {
  requireGM();
  if (!canvas.ready || !canvas.scene) throw new Error("Откройте сцену, на которой стоят камеры.");
  if (!manager || manager.sceneId !== canvas.scene.id) {
    manager?.close(); manager = new CameraManager();
  }
  if (doc && doc.parent?.id === canvas.scene.id && isCamera(doc)) manager.selectedId = doc.id;
  manager.render(true);
  return manager;
}

export class CameraManager extends Application {
  constructor(options = {}) {
    super(options);
    this.sceneId = canvas.scene.id; this.drafts = new Map(); this.selectedId = "";
    this.status = ""; this.busy = false; this.mode = null; this.overlay = null; this.hooks = [];
    this.showOverlay = false;
    for (const name of ["createToken", "updateToken", "deleteToken", "createWall", "updateWall", "deleteWall"]) {
      this.hooks.push([name, Hooks.on(name, doc => {
        if (doc.parent?.id !== this.sceneId || this.busy) return;
        if (this.rendered) this.render(false);
      })]);
    }
    this.hooks.push(["updateSetting", Hooks.on("updateSetting", setting => {
      if (setting.key === `${MODULE_ID}.netArchs` && this.rendered) this.render(false);
    })]);
    this.hooks.push(["canvasTearDown", Hooks.on("canvasTearDown", () => this.close())]);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "crns-camera-manager", title: "Камеры сцены — привязка и обзор",
      classes: ["crns-ap-scanner", "crns-camera-manager"],
      template: `modules/${MODULE_ID}/templates/scanner/camera-manager.hbs`,
      width: Math.min(940, window.innerWidth - 40), height: "auto", resizable: true,
      scrollY: [".cam-device-list", ".cam-node-list"],
    });
  }
  get scene() { return game.scenes.get(this.sceneId); }
  get documents() { return this.scene?.tokens.filter(isCamera) ?? []; }
  get doc() { return this.documents.find(doc => doc.id === this.selectedId); }
  get archs() { return game.settings.get(MODULE_ID, "netArchs") ?? {}; }
  get draft() {
    if (!this.doc) return null;
    if (!this.drafts.has(this.doc.id)) this.drafts.set(this.doc.id, cameraDraft(this.doc, this.archs));
    return this.drafts.get(this.doc.id);
  }

  async _render(...args) {
    await super._render(...args);
    this.paintPreview();
  }

  getData() {
    if (!this.doc) this.selectedId = this.documents[0]?.id ?? "";
    const draft = this.draft, archs = this.archs;
    const nodes = controlFloors(archs[draft?.archId]).map((floor, i) => ({
      id: floor.id, label: floor.label || `Узел ${i + 1}`, selected: floor.id === draft.floorId,
      count: this.documents.filter(doc => { const c = cameraConfig(doc); return c.enabled && c.archId === draft.archId && c.floorId === floor.id; }).length,
    }));
    const node = nodes.find(n => n.selected);
    const current = this.doc ? cameraConfig(this.doc) : {};
    const linked = current.enabled && current.archId === draft?.archId && current.floorId === draft?.floorId && !!node;
    return {
      sceneName: this.scene?.name, icon: iconPath("camera"), draft, hasCamera: !!draft,
      units: this.scene?.grid.units || "ед.", status: this.status, showOverlay: this.showOverlay,
      cameras: this.documents.map(doc => {
        const c = cameraConfig(doc), floor = controlFloors(archs[c.archId]).find(f => f.id === c.floorId);
        const bound = c.enabled && !!floor;
        return { id: doc.id, name: doc.name, selected: doc.id === this.selectedId, bound,
          state: bound ? `${c.online ? "Связана" : "Выключена"} · ${floor.label || "Управляющий узел"}` : "Не привязана" };
      }),
      architectures: Object.entries(archs).map(([id, arch]) => ({ id, name: arch.name || "Без названия", selected: id === draft?.archId })),
      nodes, nodeName: node?.label || "Выберите узел справа", canSave: !!node,
      linkState: linked ? "Связь настроена" : node ? "Связь готова к сохранению" : "Ожидает выбора узла",
      linked, saveLabel: current.enabled ? "Сохранить связь и обзор" : "Привязать камеру",
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = rootOf(html);
    root.querySelectorAll("[data-cam-action]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      this.act(button.dataset.camAction, button.dataset.id).catch(error => this.report(error));
    }));
    root.querySelectorAll("[name]").forEach(input => input.addEventListener("change", () => {
      if (!this.draft) return;
      const name = input.name;
      if (name === "overlay") { this.showOverlay = input.checked; this.paintPreview(); return; }
      this.draft[name] = input.type === "checkbox" ? input.checked : input.type === "number" || input.type === "range" ? Number(input.value) : input.value;
      if (name === "archId") this.draft.floorId = "";
      this.status = "Есть несохранённые изменения";
      if (name === "archId") this.render(false);
      else { this.paintPreview(); root.querySelector(".cam-status").textContent = this.status; }
    }));
    root.querySelectorAll('input[type="range"]').forEach(input => input.addEventListener("input", () => {
      this.draft[input.name] = Number(input.value); this.status = "Есть несохранённые изменения";
      this.paintPreview(); root.querySelector(".cam-status").textContent = this.status;
    }));
    root.querySelector(".cam-preview")?.addEventListener("click", event => {
      const svg = event.currentTarget;
      const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      this.setDirection(position); this.paintPreview();
    });
    this.paintPreview();
  }

  report(error) { console.error(`${MODULE_ID} | Камеры`, error); this.status = error.message; ui.notifications.warn(error.message); if (this.rendered) this.render(false); }

  async act(action, id) {
    requireGM(); if (this.busy) return;
    if (action === "select") { this.selectedId = id; this.status = ""; return this.render(false); }
    if (action === "node") { this.draft.floorId = id; this.status = "Нажмите «Привязать камеру» или «Сохранить связь и обзор»"; return this.render(false); }
    if (["pick", "place", "aim"].includes(action)) return this.startMapMode(action);
    if (action === "locate") { if (this.doc) await canvas.animatePan(cameraCenter(this.doc, canvas.grid.size)); return; }
    if (action === "reset") { this.drafts.delete(this.selectedId); this.status = "Загружены сохранённые настройки"; return this.render(false); }
    if (action === "save") {
      this.busy = true;
      try {
        const doc = this.doc; await saveCameraBinding(doc, this.draft);
        this.drafts.delete(doc.id); this.status = `Связь сохранена: ${doc.name}. Игрок получит обзор после захвата узла.`;
      } finally { this.busy = false; this.render(false); }
    }
    if (action === "unlink") {
      if (!this.doc) return;
      await this.doc.update({ [`flags.${MODULE_ID}.camera.enabled`]: false, [`flags.${MODULE_ID}.camera.floorId`]: "" });
      this.drafts.delete(this.selectedId); this.status = "Камера отвязана. Обзор игрока отключён."; this.render(false);
    }
  }

  setDirection(point) {
    if (!this.doc || !this.draft) return;
    this.draft.rotation = directionTo(cameraCenter(this.doc, canvas.grid.size), point, this.draft.rotation);
    this.status = "Направление выбрано. Сохраните связь и обзор.";
  }

  geometry() {
    if (!this.doc || !validOptics(this.draft) || !canvas.ready) return null;
    const origin = cameraCenter(this.doc, canvas.grid.size);
    const radius = Math.min(canvas.dimensions.maxR, this.draft.range * canvas.grid.size / this.scene.grid.distance);
    const polygon = CONFIG.Canvas.polygonBackends.sight.create(origin, {
      type: "sight", radius, angle: this.draft.angle, rotation: this.draft.rotation,
      externalRadius: 0, useThreshold: true,
    });
    return { origin, radius, points: polygon.points };
  }

  paintPreview() {
    this.overlay?.clear();
    if (!this.rendered || canvas.scene?.id !== this.sceneId) return;
    const geometry = this.geometry(), root = this.element[0], svg = root.querySelector(".cam-preview");
    const status = root.querySelector(".cam-status"); if (status) status.textContent = this.status;
    if (!geometry || !svg) return;
    const { origin: o, radius: r, points } = geometry;
    const extent = Math.max(r * 1.12, canvas.grid.size);
    svg.setAttribute("viewBox", `${o.x-extent} ${o.y-extent} ${extent*2} ${extent*2}`);
    const stroke = extent / 120, dot = extent / 32;
    const rect = canvas.dimensions.sceneRect;
    const background = this.scene.background?.src;
    const walls = this.scene.walls.filter(w => w.sight !== 0 && w.ds !== 1).map(w => `<line x1="${w.c[0]}" y1="${w.c[1]}" x2="${w.c[2]}" y2="${w.c[3]}" stroke="#ff7180" stroke-width="${stroke*1.6}"/>`).join("");
    const angle = (this.draft.rotation + 90) * Math.PI / 180;
    const end = { x: o.x + Math.cos(angle)*r, y: o.y + Math.sin(angle)*r };
    svg.innerHTML = `<rect x="${o.x-extent}" y="${o.y-extent}" width="${extent*2}" height="${extent*2}" fill="#07131b"/>${background ? `<image href="${escapeHTML(background)}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" opacity=".55" preserveAspectRatio="none"/>` : ""}<circle cx="${o.x}" cy="${o.y}" r="${r}" fill="none" stroke="#476477" stroke-width="${stroke}" stroke-dasharray="${stroke*3} ${stroke*4}"/><polygon points="${points.join(" ")}" fill="#38d8d3" fill-opacity=".24" stroke="#55ede0" stroke-width="${stroke}"/>${walls}<line x1="${o.x}" y1="${o.y}" x2="${end.x}" y2="${end.y}" stroke="#fff" stroke-width="${stroke}" stroke-dasharray="${stroke*2} ${stroke*3}"/><circle cx="${o.x}" cy="${o.y}" r="${dot}" fill="#fff" stroke="#002426" stroke-width="${stroke}"/>`;
    root.querySelectorAll("[data-cam-output]").forEach(el => { el.textContent = `${this.draft[el.dataset.camOutput]}°`; });
    const direction = root.querySelector('[name="rotation"]'); if (direction) direction.value = this.draft.rotation;
    if (this.showOverlay || this.mode === "aim") {
      this.overlay ??= canvas.interface.addChild(new PIXI.Graphics());
      this.overlay.eventMode = "none";
      this.overlay.lineStyle(2, 0x55ede0, .95).beginFill(0x38d8d3, .2).drawPolygon(points).endFill();
      this.overlay.lineStyle(3, 0xffffff, 1).drawCircle(o.x, o.y, canvas.grid.size / 5);
    }
  }

  async startMapMode(mode) {
    requireGM();
    if (mode === "aim" && !this.doc) throw new Error("Сначала выберите камеру.");
    this.stopMapMode(); this.mode = mode; this.originalRotation = this.draft?.rotation;
    canvas.tokens.activate();
    await this.minimize();
    const prompt = document.createElement("div"); prompt.className = "crns-camera-map-prompt";
    const message = mode === "pick" ? "Щёлкните по камере на сцене" : mode === "place" ? "Щёлкните, где поставить камеру" : "Укажите направление камеры и щёлкните";
    const text = document.createElement("span"); text.textContent = message;
    const cancel = document.createElement("button"); cancel.textContent = "Отменить · Esc";
    cancel.addEventListener("click", () => this.stopMapMode(true)); prompt.append(text, cancel); document.body.append(prompt); this.prompt = prompt;
    this.onMapKey = event => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); this.stopMapMode(true); } };
    document.addEventListener("keydown", this.onMapKey, true);
    this.onMapMove = event => { if (this.mode === "aim") { this.setDirection(event.getLocalPosition(canvas.stage)); this.paintPreview(); } };
    this.onMapClick = async event => {
      if (event.button !== 0 || this.busy) return;
      const point = event.getLocalPosition(canvas.stage);
      if (!canvas.dimensions.sceneRect.contains(point.x, point.y)) { ui.notifications.info("Щёлкните внутри границ сцены."); return; }
      event.stopPropagation();
      const picked = mode === "pick" ? this.documents.find(d => point.x >= d.x && point.y >= d.y && point.x <= d.x+d.width*canvas.grid.size && point.y <= d.y+d.height*canvas.grid.size) : null;
      if (mode === "pick" && !picked) { ui.notifications.info("Выберите значок камеры, а не персонажа или другую точку."); return; }
      try {
        if (mode === "pick") {
          this.selectedId = picked.id;
        }
        if (mode === "aim") this.setDirection(point);
        this.stopMapMode();
        if (mode === "place") {
          this.busy = true;
          await ensureTemplates({ manual: true });
          const actor = game.actors.find(a => a.flags?.[MODULE_ID]?.templateType === "camera");
          if (!actor) throw new Error("Включите тип «Камера» в типах точек доступа.");
          const data = (await actor.getTokenDocument()).toObject();
          delete data._id;
          const rect = canvas.dimensions.sceneRect;
          data.x = Math.max(rect.x, Math.min(rect.right-data.width*canvas.grid.size, point.x-data.width*canvas.grid.size/2));
          data.y = Math.max(rect.y, Math.min(rect.bottom-data.height*canvas.grid.size, point.y-data.height*canvas.grid.size/2));
          const [doc] = await this.scene.createEmbeddedDocuments("Token", [data]);
          this.selectedId = doc.id; this.status = "Камера поставлена. Выберите её управляющий узел.";
        }
      } catch (error) { this.report(error); }
      finally { this.busy = false; await this.maximize(); this.render(false); }
    };
    // Capture before Token's native handler consumes a click on its icon.
    canvas.stage.on("pointermove", this.onMapMove); canvas.stage.on("pointerdowncapture", this.onMapClick);
    this.paintPreview();
  }

  stopMapMode(cancel = false) {
    if (cancel && this.mode === "aim" && this.draft) this.draft.rotation = this.originalRotation;
    if (this.onMapMove) canvas.stage?.off("pointermove", this.onMapMove);
    if (this.onMapClick) canvas.stage?.off("pointerdowncapture", this.onMapClick);
    if (this.onMapKey) document.removeEventListener("keydown", this.onMapKey, true);
    this.onMapMove = this.onMapClick = this.onMapKey = null;
    this.prompt?.remove(); this.prompt = null; this.mode = null;
    this.overlay?.clear();
    if (cancel) { this.maximize(); this.render(false); }
  }

  async close(options) {
    this.stopMapMode();
    this.overlay?.destroy(); this.overlay = null;
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = []; if (manager === this) manager = null;
    return super.close(options);
  }
}
