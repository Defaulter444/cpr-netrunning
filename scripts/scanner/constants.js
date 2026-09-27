export const MODULE_ID = "cpr-netrunning";
export const MODULE_TITLE = "Нетраннинг — точки доступа";
export const SYSTEM_ID = "cyberpunk-red-core";
export const SCHEMA_VERSION = 1;
export const TYPES = Object.freeze([
  { id: "computer", label: "Компьютер", icon: "computer.svg" },
  { id: "camera", label: "Камера", icon: "camera.svg" },
  { id: "turret", label: "Турель", icon: "turret.svg" },
  { id: "door", label: "Контроллер двери", icon: "door.svg" },
  { id: "alarm", label: "Панель сигнализации", icon: "alarm.svg" },
  { id: "generic", label: "Универсальная точка", icon: "generic.svg" },
]);
export const PALETTE = Object.freeze([
  "#55ddee", "#ffad55", "#c89aff", "#81e69a", "#ff7196", "#f1db62", "#6aaaff",
]);
export const DEFAULT_COLOR = "#ff0000";
export const iconPath = (type) => `modules/${MODULE_ID}/assets/scanner/${TYPES.find((t) => t.id === type)?.icon ?? TYPES[0].icon}`;
