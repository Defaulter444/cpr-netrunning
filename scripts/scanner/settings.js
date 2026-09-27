import { ensureTemplates } from "./templates.js";
import { MODULE_ID } from "./constants.js";

export const scannerKey = key => `scanner${key[0].toUpperCase()}${key.slice(1)}`;
export const setting = key => game.settings.get(MODULE_ID, scannerKey(key));

export function pulseCount() {
  const count = Number(setting("pulseCount"));
  return Number.isFinite(count) ? Math.max(1, Math.min(20, Math.floor(count))) : 5;
}
export const pulseLabel = () => { const count = pulseCount(); return `Импульсы: ${count}`; };

export function registerSettings(onChange) {
  const register = (key, data) => game.settings.register(MODULE_ID, scannerKey(key), {
    scope: "world", config: true, onChange, ...data,
  });
  register("apTypes", { config: false, type: Object, default: {} });
  Hooks.on("renderSettingsConfig", (_app, html) => groupRevealSettings(html));
  register("revealStyle", {
    name: "Сканер: отображение точек доступа", hint: "Показывать значок поверх тумана или дополнительно открывать небольшой круг обзора вокруг точки.",
    type: String, default: "fog", choices: { fog: "Значок поверх тумана", vision: "Значок и круг обзора" },
  });
  register("visionRadius", {
    name: "Сканер: радиус обзора", hint: "В единицах расстояния сцены. Значение 0,5 — полметра на карте с метрами.",
    type: Number, default: 0.5, range: { min: 0.1, max: 10, step: 0.1 },
  });
  register("scannerRadius", {
    name: "Сканер: фильтр расстояния", hint: "Фильтр списка для мастера. При нуле видны все точки. Это не ограничение способности по правилам.",
    type: Number, default: 0,
  });
  // Use the former preference as the default until the positive option is saved.
  register("hideRevealAll", { config: false, type: Boolean, default: false });
  register("showRevealAll", { name: "Сканер: разрешить показ всем", hint: "Добавляет переключатель «Показать всем». Уже открытые точки сохраняются.", type: Boolean, default: !setting("hideRevealAll") });
  register("autoPulse", { name: "Сканер: импульс при обнаружении", type: Boolean, default: true });
  register("pulseCount", { name: "Сканер: число импульсов", hint: "Число вспышек при кратком сигнале. Непрерывный сигнал включается отдельно для каждой точки.", type: Number, default: 5, range: { min: 1, max: 20, step: 1 } });
  register("pulseDuration", { name: "Сканер: длительность импульса (сек.)", hint: "Меньшее значение ускоряет сигнал. Настройка действует также на уже запущенные импульсы.", onChange: async value => {
    if (!game.modules?.get(MODULE_ID)?.api?.scanner?.enabled) return;
    try { const { updateActivePulseSpeed } = await import("./actions.js"); await updateActivePulseSpeed(value); }
    catch (error) { ui.notifications.error(error.message); }
    finally { onChange?.(); }
  }, type: Number, default: 1.4, range: { min: 0.4, max: 5, step: 0.1 } });
  // Retained only as the fallback for APs created before per-token name controls.
  register("showLabels", { config: false, type: Boolean, default: true });
  register("autoScanner", { name: "Сканер: открыть панель после броска «Сканера»", type: Boolean, default: true });
  register("netarchColors", { config: false, type: Object, default: { entries: [] } });
}

export function groupRevealSettings(html) {
  const root = html[0] ?? html;
  const style = root.querySelector(`[name="${MODULE_ID}.scannerRevealStyle"]`);
  const radius = root.querySelector(`[name="${MODULE_ID}.scannerVisionRadius"]`);
  if (!style || !radius || style.closest(".crns-ap-ap-reveal-settings")) return;
  const styleRow = style.closest(".form-group"), radiusRow = radius.closest(".form-group");
  if (!styleRow || !radiusRow) return;
  const group = document.createElement("fieldset");
  group.className = "crns-ap-ap-reveal-settings";
  const legend = document.createElement("legend");
  legend.textContent = "Видимость точек доступа";
  group.append(legend);
  styleRow.before(group);
  group.append(styleRow, radiusRow);
  if (game.user.isGM && game.settings.get(MODULE_ID, "scannerEnabled")) {
    const row = document.createElement("div");
    row.className = "form-group";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Восстановить шаблоны точек";
    button.title = "Создать недостающие шаблоны. Существующие актёры и их изменения сохраняются.";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const count = await ensureTemplates({ defaults: true, manual: true });
        ui.notifications.info(count ? `Создано шаблонов: ${count}.` : "Все стандартные шаблоны уже созданы.");
      } catch (error) { ui.notifications.error(error.message); }
      finally { button.disabled = false; }
    });
    row.append(button);
    group.after(row);
  }
  const sync = () => {
    const disabled = style.value !== "vision";
    radiusRow.querySelectorAll("input").forEach(input => { input.disabled = disabled; });
    radiusRow.classList.toggle("ap-radius-disabled", disabled);
  };
  style.addEventListener("change", sync);
  sync();
}
