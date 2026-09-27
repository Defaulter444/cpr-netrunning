import { MODULE_ID, iconPath } from "./constants.js";
import { accessPointTypes, validateTypes } from "./types.js";
import { ensureTemplates } from "./templates.js";

export class APTypeManager extends FormApplication {
  constructor(...args) { super(...args); this.types = accessPointTypes({ includeDisabled: true }); }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "Типы точек доступа", classes: ["crns-ap-scanner", "crns-ap-type-manager"],
      template: `modules/${MODULE_ID}/templates/scanner/type-manager.hbs`, width: 640, height: "auto",
      closeOnSubmit: true, submitOnChange: false, submitOnClose: false,
    });
  }
  getData() {
    if (!game.user.isGM) throw new Error("Настраивать типы точек доступа может только мастер.");
    return { types: this.types };
  }
  capture(root) {
    this.types = [...root.querySelectorAll("[data-type-row]")].map(row => ({
      id: row.dataset.typeRow, label: row.querySelector('[data-field="label"]').value,
      img: row.querySelector('[data-field="img"]').value,
      enabled: row.querySelector('[data-field="enabled"]').checked,
    }));
  }
  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    root.querySelector('[data-action="add-type"]').addEventListener("click", () => {
      this.capture(root);
      this.types.push({ id: foundry.utils.randomID(), label: "", img: iconPath("generic"), enabled: true });
      this.render(false);
    });
    root.querySelectorAll('[data-action="browse-type"]').forEach(button => button.addEventListener("click", () => {
      const input = button.closest("[data-type-row]").querySelector('[data-field="img"]');
      new FilePicker({ type: "image", current: input.value, callback: path => { input.value = path; } }).browse();
    }));
  }
  async _updateObject() {
    if (!game.user.isGM) throw new Error("Настраивать типы точек доступа может только мастер.");
    try {
      this.capture(this.element[0]);
      const entries = validateTypes(this.types);
      await game.settings.set(MODULE_ID, "scannerApTypes", { entries });
      await ensureTemplates();
    } catch (error) { ui.notifications.error(error.message); throw error; }
  }
}
