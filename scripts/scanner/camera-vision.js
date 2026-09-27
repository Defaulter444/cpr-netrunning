import { MODULE_ID } from "./constants.js";
import { isAP, escapeHTML } from "./model.js";
import { cameraConfig, cameraController, cameraSourceData } from "./camera-rules.js";

/** Local, temporary v12 vision sources. Never grant ownership, create shared lights,
 * move a character, or write explored fog. Camera access is recomputed on every change.
 */
export class CameraVision {
  constructor() { this.sources = new Map(); this.pending = false; this.panel = null; }

  context() {
    return {
      archs: game.settings.get(MODULE_ID, "netArchs"),
      session: game.settings.get(MODULE_ID, "session"), user: game.user,
      selectedActors: (canvas.tokens?.controlled ?? []).filter(t => !isAP(t.document)).map(t => t.actor?.uuid),
      ownsActor: (uuid, user) => fromUuidSync(uuid)?.testUserPermission(user, "OWNER") === true,
    };
  }

  available() {
    if (!canvas.ready || !canvas.scene || canvas.scene.tokenVision === false) return [];
    const context = this.context();
    return (canvas.tokens?.placeables ?? []).flatMap(token => {
      const runner = cameraController(token.document, context);
      return runner ? [{ token, runner, config: cameraConfig(token.document) }] : [];
    });
  }

  queueRefresh() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (!canvas.ready) return;
      this.refresh();
      canvas.perception.update({ initializeVision: true, refreshLighting: true, refreshVision: true });
      if (this.panel?.rendered) this.openPanel();
    });
  }

  refresh() {
    if (!canvas.ready || !canvas.effects) return;
    const wanted = new Set();
    for (const { token, runner, config } of this.available()) {
      const id = `${MODULE_ID}.camera.${token.id}`;
      wanted.add(id);
      let entry = this.sources.get(id);
      if (!entry) {
        const source = new CONFIG.Canvas.visionSourceClass({ sourceId: id });
        entry = { source }; this.sources.set(id, entry);
      }
      // A facade supplies camera optics to native token detection. The real token
      // remains hidden, without sight or ownership; other clients see no new source.
      const modes = [
        { id: "basicSight", enabled: true, range: config.nightVision ? config.range : 0 },
        { id: "lightPerception", enabled: true, range: config.range },
      ];
      const document = new Proxy(token.document, {
        get(target, key) {
          if (key === "detectionModes") return modes;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      entry.source.object = new Proxy(token, {
        get(target, key) {
          if (key === "document") return document;
          if (key === "getLightRadius") return range => range * canvas.dimensions.size / canvas.dimensions.distance;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      entry.source.cprCameraActorUuid = runner.actorUuid;
      entry.source.initialize(cameraSourceData(token.document, config, canvas.dimensions));
      entry.source.add();
    }
    for (const [id, entry] of this.sources) {
      if (wanted.has(id)) continue;
      entry.source.destroy(); this.sources.delete(id);
    }
  }

  openPanel() {
    if (game.user.isGM) return import("./camera-manager.js")
      .then(({ openCameraManager }) => openCameraManager())
      .catch(error => ui.notifications.warn(error.message));
    const cameras = this.available();
    const content = `<div class="ap-camera-list"><p>Обзор подключённых камер добавлен к вашему обзору на карте. Персонаж остаётся на месте.</p>${cameras.length
      ? cameras.map(({token, config}) => `<button type="button" class="ap-camera-locate" data-camera-id="${escapeHTML(token.id)}" data-tooltip="Перейти к камере на карте. Управление устройствами: корбук, с. 200."><i class="fas fa-video"></i> ${escapeHTML(token.name)} <span>${config.angle}° · ${config.range} ${escapeHTML(canvas.scene.grid.units)}</span></button>`).join("")
      : "<p><strong>Нет доступных камер на этой сцене.</strong> Захватите связанный управляющий узел. Камера должна быть включена мастером.</p>"}</div>`;
    if (this.panel?.rendered) { this.panel.data.content = content; this.panel.render(false); return this.panel; }
    this.panel = new Dialog({ title: "Камеры под контролем", content, default: "dismiss",
      buttons: { dismiss: { label: "Закрыть список" } },
      render: html => {
        const locate = event => {
          const camera = this.available().find(c => c.token.id === event.currentTarget.dataset.cameraId);
          if (camera) canvas.animatePan({ ...camera.token.center });
          else this.openPanel();
        };
        html.find("[data-camera-id]").on("click", locate).on("keydown", event => {
          // Dialog v12 treats Enter as submission even on content buttons.
          if (event.key !== "Enter") return;
          event.preventDefault(); event.stopPropagation(); locate(event);
        });
        html.find('[data-button="dismiss"]').attr("data-tooltip", "Закрыть список. Обзор остаётся доступен, пока вы контролируете узел.");
      },
    }, { width: 430, classes: ["dialog", "crns-ap-scanner", "crns-ap-camera-panel"] });
    return this.panel.render(true);
  }

  destroy() {
    for (const { source } of this.sources.values()) source.destroy();
    this.sources.clear(); this.panel?.close(); this.panel = null;
  }

  registerHooks() {
    Hooks.on("initializeVisionSources", () => this.refresh());
    Hooks.on("canvasReady", () => this.queueRefresh());
    Hooks.on("canvasTearDown", () => this.destroy());
    Hooks.on("updateSetting", setting => {
      if ([`${MODULE_ID}.session`, `${MODULE_ID}.netArchs`].includes(setting.key)) this.queueRefresh();
    });
    for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "deleteActor", "updateUser", "controlToken", "updateScene"]) {
      Hooks.on(hook, () => this.queueRefresh());
    }
    // Door/wall changes also re-initialize the same LOS polygons used by normal vision.
    for (const hook of ["createWall", "updateWall", "deleteWall"]) Hooks.on(hook, () => this.queueRefresh());
    Hooks.on("getApplicationHeaderButtons", (app, buttons) => {
      if (app.options.id !== "crns-suite") return;
      buttons.unshift({ label: "Камеры", class: "crns-camera-launch", icon: "fas fa-video", onclick: () => this.openPanel() });
    });
  }
}
