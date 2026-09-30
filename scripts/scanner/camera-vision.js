import { MODULE_ID } from "./constants.js";
import { isAP, escapeHTML } from "./model.js";
import { cameraConfig, cameraController, cameraSourceData } from "./camera-rules.js";
import {canReadAPName} from './name-visibility.js';

/** Local, temporary v12 vision sources. Never grant ownership, create shared lights,
 * move a character, or write explored fog. Camera access is recomputed on every change.
 */
export class CameraVision {
  constructor() { this.sources = new Map(); this.pending = false; this.panel = null; this.hiddenViews=new Set(); this.previewPid=''; }

  context() {
    return {
      archs: game.settings.get(MODULE_ID, "netArchs"),
      session: game.settings.get(MODULE_ID, "session"), user: game.user,
      selectedActors: [...new Set((canvas.tokens?.controlled ?? []).filter(t => !isAP(t.document)).flatMap(t => [t.actor?.uuid,game.actors?.get(t.document.actorId)?.uuid]).filter(Boolean))],
      assignedPlayer: id => {const user=game.users?.get(id);return id===game.user.id&&!game.user.isGM||!!user&&!user.isGM;},
      ownsActor: (uuid, user) => fromUuidSync(uuid)?.testUserPermission(user, "OWNER") === true,
    };
  }

  available() {
    if (!canvas.ready || !canvas.scene || canvas.scene.tokenVision === false) return [];
    if(game.user.isGM&&this.gmPreviewStopped)return [];
    const context = this.context();
    if(game.user.isGM&&this.previewPid){const runner=context.session?.participants?.[this.previewPid];context.selectedActors=runner?[runner.actorUuid]:[];}
    return (canvas.tokens?.placeables ?? []).flatMap(token => {
      const runner = cameraController(token.document, context);
      return runner && !this.hiddenViews.has(token.id) ? [{ token, runner, config: cameraConfig(token.document) }] : [];
    });
  }

  devices(pid='') {
    if(!canvas.ready||!canvas.scene)return [];
    const context=this.context(),part=context.session?.participants?.[pid];
    const viewingIds=new Set(this.available().map(camera=>camera.token.id));
    if(game.user.isGM&&part)context.selectedActors=[part.actorUuid];
    return (canvas.tokens?.placeables??[]).flatMap(token=>{
      const runner=cameraController(token.document,context,{includeOffline:true});
      if(!runner||(pid&&part!==runner))return [];
      const config=cameraConfig(token.document);
      return [{id:token.id,floorId:config.floorId,archId:config.archId,name:game.user.isGM||canReadAPName(token)?token.name:'Камера',
        online:config.online,viewing:viewingIds.has(token.id),
        range:config.range,angle:config.angle,nightVision:config.nightVision,units:canvas.scene.grid.units||'ед.',visionEnabled:canvas.scene.tokenVision!==false}];
    });
  }

  async view(id,pid='',enabled=true) {
    const device=this.devices(pid).find(d=>d.id===id);
    if(!device)throw Error('Камера недоступна: проверьте контроль узла и подключение.');
    if(!device.online)throw Error('Камера выключена Мастером.');
    if(!device.visionEnabled)throw Error('На этой сцене отключено зрение токенов.');
    if(game.user.isGM&&pid)this.previewPid=pid;
    if(game.user.isGM&&enabled)this.gmPreviewStopped=false;
    if(enabled)this.hiddenViews.delete(id);else this.hiddenViews.add(id);
    if(game.user.isGM&&!this.available().length)this.previewPid='';
    this.queueRefresh();
    if(enabled)await this.locate(id,pid);
    return true;
  }

  async locate(id,pid='') {
    if(!this.devices(pid).some(d=>d.id===id))throw Error('Камера больше недоступна.');
    const token=canvas.tokens.get(id);if(token)await canvas.animatePan({...token.center});
  }

  stopPreview() {
    if(!game.user.isGM)throw Error('Остановка предпросмотра доступна Мастеру.');
    this.previewPid='';this.hiddenViews.clear();this.gmPreviewStopped=true;this.queueRefresh();
  }

  queueRefresh() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (!canvas.ready) return;
      try{this.refresh();}catch(error){console.error(`${MODULE_ID} | Камеры`,error);ui.notifications.error('Не удалось включить обзор камеры. Проверьте настройки камеры.');return;}
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
      const object = new Proxy(token, {
        get(target, key) {
          if (key === "document") return document;
          if (key === "getLightRadius") return range => range * canvas.dimensions.size / canvas.dimensions.distance;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      let entry=this.sources.get(id);
      if(!entry){entry={source:new CONFIG.Canvas.visionSourceClass({sourceId:id,object})};this.sources.set(id,entry);}
      entry.source.object=object;
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
    const cameras = this.devices();
    const content = `<div class="ap-camera-list"><p>Нажмите «Смотреть», чтобы перейти к обзору камеры на карте. Нетраннер остаётся на месте. Без ночного зрения видны только освещённые участки.</p>${cameras.length
      ? cameras.map(camera => `<div><strong>${escapeHTML(camera.name)}</strong><span> ${camera.angle}° · ${camera.range} ${escapeHTML(camera.units)} · ${camera.online?'В сети':'Выключена'}</span><button type="button" class="ap-camera-locate" data-camera-id="${escapeHTML(camera.id)}" ${!camera.online?'disabled':''}><i class="fas fa-video"></i> Смотреть</button><button type="button" data-camera-hide="${escapeHTML(camera.id)}" ${!camera.viewing?'disabled':''}>Скрыть обзор</button></div>`).join("")
      : "<p><strong>Нет доступных камер на этой сцене.</strong> Захватите связанный управляющий узел. Камера должна быть включена мастером.</p>"}</div>`;
    if (this.panel?.rendered) { this.panel.data.content = content; this.panel.render(false); return this.panel; }
    this.panel = new Dialog({ title: "Камеры под контролем", content, default: "dismiss",
      buttons: { dismiss: { label: "Закрыть список" } },
      render: html => {
        const locate = event => {
          this.view(event.currentTarget.dataset.cameraId).catch(error=>ui.notifications.warn(error.message));
        };
        html.find("[data-camera-id]").on("click", locate).on("keydown", event => {
          // Dialog v12 treats Enter as submission even on content buttons.
          if (event.key !== "Enter") return;
          event.preventDefault(); event.stopPropagation(); locate(event);
        });
        const hide=event=>this.view(event.currentTarget.dataset.cameraHide,'',false).catch(error=>ui.notifications.warn(error.message));
        html.find('[data-camera-hide]').on('click',hide).on('keydown',event=>{
          if(event.key!=='Enter')return;
          event.preventDefault();event.stopPropagation();hide(event);
        });
        html.find('[data-button="dismiss"]').attr("data-tooltip", "Закрыть список. Обзор остаётся доступен, пока вы контролируете узел.");
      },
    }, { width: 430, classes: ["dialog", "crns-ap-scanner", "crns-ap-camera-panel"] });
    return this.panel.render(true);
  }

  destroy() {
    for (const { source } of this.sources.values()) source.destroy();
    this.sources.clear(); this.hiddenViews.clear();this.previewPid='';this.gmPreviewStopped=false;this.panel?.close(); this.panel = null;
  }

  registerHooks() {
    Hooks.on("initializeVisionSources", () => this.refresh());
    Hooks.on("canvasReady", () => this.queueRefresh());
    Hooks.on("canvasTearDown", () => this.destroy());
    Hooks.on("updateSetting", setting => {
      if ([`${MODULE_ID}.session`, `${MODULE_ID}.netArchs`].includes(setting.key)) this.queueRefresh();
    });
    Hooks.on('controlToken',()=>{if(game.user.isGM){this.previewPid='';this.gmPreviewStopped=false;}this.queueRefresh();});
    for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "deleteActor", "updateUser", "updateScene"]) {
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
