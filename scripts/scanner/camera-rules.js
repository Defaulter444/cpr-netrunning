// Camera access is derived from the live control node, never from scanner discovery.
const MODULE = "cpr-netrunning";
const PREFIX = "CRNS.NetArch.";

export function cameraConfig(doc) {
  const flags = doc?.flags?.[MODULE] ?? {};
  const camera = flags.camera ?? {};
  return {
    enabled: flags.type === "camera" && camera.enabled === true,
    online: camera.online !== false,
    archId: String(flags.netarch ?? "").startsWith(PREFIX) ? flags.netarch.slice(PREFIX.length) : "",
    floorId: String(camera.floorId ?? ""),
    range: Number(camera.range ?? 20), angle: Number(camera.angle ?? 90),
    nightVision: camera.nightVision === true,
  };
}

export function controlFloors(arch) {
  return (arch?.floors ?? []).filter(floor => floor.kind === "controlnode" || floor.check === "control");
}

export function validOptics(camera) {
  return Number.isFinite(camera.range) && camera.range > 0 && camera.range <= 10000
    && Number.isFinite(camera.angle) && camera.angle >= 1 && camera.angle <= 360;
}

/** Returns the controlling runner only when this viewer may receive this camera.
 * Core p. 200: control belongs to a runner until released, taken, or disconnected.
 * Merely discovering an access point does not control a device.
 */
export function cameraController(doc, { archs, session, user, ownsActor = () => false, selectedActors = [] }) {
  const config = cameraConfig(doc);
  if (!config.enabled || !config.online || !validOptics(config)) return null;
  if (!controlFloors(archs?.[config.archId]).some(floor => floor.id === config.floorId)) return null;
  const pid = session?.floorState?.[`${config.archId}:${config.floorId}`]?.control?.pid;
  const runner = session?.participants?.[pid];
  if (!runner || runner.kind !== "runner" || !runner.jackedIn || runner.archId !== config.archId) return null;
  if (user?.isGM) return selectedActors.includes(runner.actorUuid) ? runner : null;
  if (!user?.id) return null;
  return (runner.userId ? runner.userId === user.id : ownsActor(runner.actorUuid, user)) ? runner : null;
}

export function cameraSourceData(doc, config, { size, distance, maxR }) {
  const scale = size / distance;
  const range = Math.min(maxR, config.range * scale);
  return {
    x: doc.x + doc.width * size / 2, y: doc.y + doc.height * size / 2,
    elevation: doc.elevation ?? 0, rotation: doc.rotation ?? 0,
    angle: config.angle, radius: config.nightVision ? range : 0, lightRadius: range,
    externalRadius: 0, visionMode: "basic", attenuation: 0,
    // v12 draws preview vision but excludes it from saved fog exploration.
    preview: true, disabled: false,
  };
}

export function validateCameraInput(data, archs) {
  const enabled = data.cameraEnabled === true || data.cameraEnabled === "true";
  const config = {
    enabled, online: data.cameraOnline === true || data.cameraOnline === "true",
    floorId: String(data.cameraFloor ?? ""), range: Number(data.cameraRange),
    angle: Number(data.cameraAngle), nightVision: data.cameraNightVision === true || data.cameraNightVision === "true",
  };
  if (!validOptics(config)) throw new Error("Укажите дальность от 0 до 10 000 (не включая 0) и угол от 1 до 360 градусов.");
  const rotation = Number(data.cameraRotation);
  if (!Number.isFinite(rotation) || rotation < 0 || rotation >= 360) throw new Error("Укажите направление от 0 до 359 градусов.");
  if (enabled) {
    const archId = String(data.netarch ?? "").startsWith(PREFIX) ? data.netarch.slice(PREFIX.length) : "";
    if (!controlFloors(archs?.[archId]).some(floor => floor.id === config.floorId)) {
      throw new Error("Выберите архитектуру нашего модуля и управляющий узел камеры.");
    }
  }
  return { config, rotation };
}
