import { MODULE_ID } from "./constants.js";
import { isAP } from "./model.js";
import { cameraConfig, controlFloors, validateCameraInput } from "./camera-rules.js";

export function cameraDraft(doc, archs) {
  const camera = cameraConfig(doc);
  const choices = Object.keys(archs).filter(id => controlFloors(archs[id]).length);
  return { ...camera, archId: camera.archId || (choices.length === 1 ? choices[0] : ""),
    rotation: Number(doc.rotation ?? 0), name: doc.name };
}

// Foundry v12 rotation: 0 south, 90 west, 180 north, 270 east.
export function directionTo(origin, point, previous = 0) {
  const dx = point.x - origin.x, dy = point.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1) return previous;
  return (Math.round(Math.atan2(-dx, dy) * 180 / Math.PI) + 360) % 360;
}

export function cameraCenter(doc, size) {
  return { x: doc.x + doc.width * size / 2, y: doc.y + doc.height * size / 2 };
}

export function bindingChanges(doc, draft, archs, isGM) {
  if (!isGM) throw new Error("Привязку камеры настраивает мастер.");
  if (!isAP(doc) || doc.flags[MODULE_ID].type !== "camera") throw new Error("Выберите на сцене точку типа «Камера».");
  const netarch = `CRNS.NetArch.${draft.archId}`;
  const { config, rotation } = validateCameraInput({
    cameraEnabled: true, cameraOnline: draft.online, cameraFloor: draft.floorId,
    cameraRange: draft.range, cameraAngle: draft.angle, cameraRotation: draft.rotation,
    cameraNightVision: draft.nightVision, netarch,
  }, archs);
  const name = String(draft.name ?? "").trim();
  if (!name || name.length > 120) throw new Error("Назовите камеру: от 1 до 120 символов.");
  // Patch only this camera. Preserve discovery, other cameras and the live run.
  return { name, rotation, [`flags.${MODULE_ID}.netarch`]: netarch, [`flags.${MODULE_ID}.camera`]: config };
}

export async function saveCameraBinding(doc, draft) {
  if (!doc?.parent?.tokens?.has(doc.id)) throw new Error("Камера удалена. Выберите другую на сцене.");
  return doc.update(bindingChanges(doc, draft, game.settings.get(MODULE_ID, "netArchs") ?? {}, game.user.isGM));
}
