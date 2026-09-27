import { MODULE_ID, TYPES, iconPath } from "./constants.js";

export function accessPointTypes({ includeDisabled = false } = {}) {
  const saved = globalThis.game?.settings?.get(MODULE_ID, "scannerApTypes");
  const entries = saved?.entries ?? TYPES.map(type => ({ id: type.id, label: type.label, img: iconPath(type.id), enabled: true }));
  return entries.filter(type => includeDisabled || type.enabled !== false).map(type => ({ ...type }));
}
export const typeInfo = id => accessPointTypes({ includeDisabled: true }).find(type => type.id === id);
export const typeImage = id => typeInfo(id)?.img || iconPath("generic");

export function validateTypes(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("Оставьте хотя бы один тип точки доступа.");
  const ids = new Set(), names = new Set();
  const normalized = entries.map(entry => {
    const id = String(entry.id ?? ""), label = String(entry.label ?? "").trim(), img = String(entry.img ?? "").trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error("Идентификатор типа должен быть уникальным: латинские буквы, цифры, дефис или подчёркивание.");
    if (!label || label.length > 80 || names.has(label.toLowerCase())) throw new Error("Задайте каждому типу уникальное название длиной от 1 до 80 символов.");
    if (!img || /^(?:javascript|data):/i.test(img)) throw new Error("Выберите файл изображения для каждого типа.");
    ids.add(id); names.add(label.toLowerCase());
    return { id, label, img, enabled: entry.enabled !== false };
  });
  if (!normalized.some(entry => entry.enabled)) throw new Error("Оставьте хотя бы один тип включённым.");
  return normalized;
}
