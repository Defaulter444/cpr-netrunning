import { accessPointTypes, typeImage } from "./types.js";
import { MODULE_ID, MODULE_TITLE, SYSTEM_ID, TYPES, iconPath } from "./constants.js";
import { apData, freshAP, isAP } from "./model.js";

export function activeGM() {
  return game.users.activeGM ?? game.users.filter((user) => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
}

const TEMPLATE_FOLDER = "Точки доступа — Нетраннинг";
const DEFAULT_FOLDER_NAMES = new Set([TEMPLATE_FOLDER, MODULE_TITLE]);

let provisioning;
export async function ensureTemplates({ defaults = false, manual = false } = {}) {
  if (!game.user.isGM || (!manual && activeGM()?.id !== game.user.id)) return;
  if (provisioning) { await provisioning; if (!manual) return; }
  provisioning = provision(defaults).finally(() => { provisioning = null; });
  return provisioning;
}

async function provision(defaults) {
  if (!game.documentTypes.Actor.includes("container")) throw new Error("В системе недоступен тип актёра «Контейнер». Проверьте версию Cyberpunk RED.");
  let folder = game.folders.find((entry) => entry.type === "Actor"
    && (entry.getFlag(MODULE_ID, "templates") || (!entry.folder && DEFAULT_FOLDER_NAMES.has(entry.name))));
  if (folder && folder.name !== TEMPLATE_FOLDER && DEFAULT_FOLDER_NAMES.has(folder.name)) {
    await folder.update({ name: TEMPLATE_FOLDER });
  }
  const updates = game.actors.filter((actor) => (actor.getFlag?.(MODULE_ID, "templateType") || isAP(actor.prototypeToken))
    && actor.prototypeToken?.appendNumber !== true)
    .map((actor) => ({ _id: actor.id, "prototypeToken.appendNumber": true }));
  if (updates.length) await Actor.updateDocuments(updates);
  const missing = (defaults ? TYPES : accessPointTypes()).filter((type) => !game.actors.some((actor) => actor.getFlag(MODULE_ID, "templateType") === type.id));
  if (!missing.length) return 0;
  if (!folder) folder = await Folder.create({ name: TEMPLATE_FOLDER, type: "Actor", sorting: "a", flags: { [MODULE_ID]: { templates: true } } });
  // createDocuments uses the native data model without CPRContainerActor.create's shop defaults.
  await Actor.createDocuments(missing.map((type) => ({
    name: `Точка доступа — ${type.label}`, type: "container", folder: folder.id,
    img: typeImage(type.id), system: {}, items: [], ownership: { default: 0 },
    flags: { [MODULE_ID]: { templateType: type.id }, [SYSTEM_ID]: { "container-type": "custom" } },
    prototypeToken: {
      name: type.label, actorLink: false, appendNumber: true, width: 0.5, height: 0.5,
      texture: { src: typeImage(type.id) }, hidden: true, disposition: 0,
      displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
      bar1: { attribute: null }, bar2: { attribute: null },
      sight: { enabled: false }, light: { bright: 0, dim: 0 },
      flags: { [MODULE_ID]: freshAP(type.id) },
    },
  })));
  return missing.length;
}

export function registerTokenGuards() {
  Hooks.on("preCreateToken", (doc, _data, _options, userId) => {
    if (userId !== game.user.id) return;
    const templateType = game.actors.get(doc.actorId)?.getFlag(MODULE_ID, "templateType");
    if (!isAP(doc) && !templateType) return;
    const data = apData(doc);
    doc.updateSource({
      hidden: true, actorLink: false,
      sight: { enabled: false }, light: { bright: 0, dim: 0 },
      flags: { [MODULE_ID]: freshAP(data.type ?? templateType, data.netarch) },
    });
  });
  Hooks.on("preUpdateToken", (doc, changes) => {
    if (!isAP(doc)) return;
    // Native tokens stay GM-only. Disclosure is per-client, including after disabling this module.
    changes.hidden = true;
    changes.actorLink = false;
    if (changes.sight) changes.sight.enabled = false;
    if (changes.light) { changes.light.bright = 0; changes.light.dim = 0; }
    changes["sight.enabled"] = false;
    changes["light.bright"] = 0;
    changes["light.dim"] = 0;
  });
}
