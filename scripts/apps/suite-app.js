/* NetrunningSuiteApp — the shell window. Composes its content from the
 * sub-modules (tree / tabs / canvas / editor / runners / actions), each of which
 * exports getData(app) and activateListeners(app, html) and guards its own
 * visibility. Application v1 (Foundry v12), resizable + pop-out. */

import { MODULE_ID, TPL, loc, esc } from "../constants.js";
import { getWorld, mutate } from "../data.js";
import { userNetrunnerActor } from "../cpr-bridge.js";

import * as Tree from "./tree.js";
import * as Tabs from "./tabs.js";
import * as Editor from "./editor.js";
import * as Canvas from "./arch-canvas.js";
import * as Runners from "./runners.js";
import * as Actions from "./actions.js";

const SUBMODULES = [Tree, Tabs, Editor, Canvas, Runners, Actions];

/** Small modal prompting for a single line of text. Resolves to the trimmed
 *  string, or null if cancelled/empty. Shared helper for rename/create dialogs. */
export function promptText(title, initial = "") {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div class="crns-prompt"><input type="text" name="value" value="${esc(initial)}" autofocus /></div>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: loc("CRNS.Tree.OK"),
          callback: (html) => {
            const v = String(html[0].querySelector("input[name=value]")?.value ?? "").trim();
            resolve(v || null);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: loc("CRNS.Tree.Cancel"), callback: () => resolve(null) },
      },
      default: "ok",
      render: (html) => {
        const input = html[0].querySelector("input[name=value]");
        input?.focus();
        input?.select();
        input?.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); html[0].closest(".dialog")?.querySelector("button.ok")?.click(); }
        });
      },
    }).render(true);
  });
}

export default class NetrunningSuiteApp extends Application {
  constructor(options = {}) {
    super(options);
    // Transient per-client UI state (not persisted).
    this.state = {
      selection: "",
      editorArchId: "",
      collapsedLeft: false,
      collapsedRight: true,
      cam: {},
      draft: {},
    };
    // Currently hovered entity ref (set by the canvas), used by the T handler.
    this.hovered = "";
    // rAF id for the matrix-rain loop (owned by the canvas module in Phase C).
    this._rainRaf = null;
    // Callback the canvas module registers to handle targeting (Phase C).
    this.onTarget = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "crns-suite",
      classes: ["crns-window"],
      template: TPL("shell"),
      popOut: true,
      resizable: true,
      minimizable: true,
      width: 1180,
      height: 760,
      title: loc("CRNS.Button.Open"),
      // Core Application v1 preserves these containers' scrollTop across
      // re-renders — without this every mutation snapped all lists to the top.
      scrollY: [
        ".crns-tree-list", ".crns-runners-list", ".crns-zone-center",
        ".crns-prog-list", ".crns-floor-chain", ".crns-editor",
        ".crns-left", ".crns-right",
      ],
    });
  }

  /** Which participant record represents me: my runner, else my spectator, else null. */
  myParticipant() {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const uid = game.user.id;
    // A runner I own (by userId, or by owning the actor).
    for (const [pid, p] of Object.entries(parts)) {
      if (p.kind !== "runner") continue;
      if (p.userId && p.userId === uid) return { pid, ...p };
      if (p.actorUuid) {
        const actor = fromUuidSync?.(p.actorUuid) ?? null;
        if (actor?.testUserPermission?.(game.user, "OWNER") && p.userId === "" && !game.user.isGM) {
          // GM-added NPC runners (userId "") are GM-controlled, not "mine".
          continue;
        }
        if (actor?.testUserPermission?.(game.user, "OWNER") && p.userId === uid) return { pid, ...p };
      }
    }
    // My spectator record.
    for (const [pid, p] of Object.entries(parts)) {
      if (p.kind === "spectator" && p.userId === uid) return { pid, ...p };
    }
    return null;
  }

  get theme() {
    try { return game.settings.get(MODULE_ID, "theme") || "green"; }
    catch (e) { return "green"; }
  }

  /** Per-client persisted action-bar height (px). Read as a user flag; falsy →
   *  the CSS default (290px) applies. Clamped to the same 200..window range the
   *  drag handle enforces so a stale flag can't wedge the bar off-screen. */
  get barHeight() {
    try {
      const h = Number(game.user.getFlag(MODULE_ID, "barHeight"));
      return Number.isFinite(h) && h > 0 ? h : 0;
    } catch (e) { return 0; }
  }

  getData() {
    const isGM = game.user.isGM;
    const data = {
      isGM,
      theme: this.theme,
      state: this.state,
      hasNetrunner: !!userNetrunnerActor(game.user),
      barHeight: this.barHeight,
    };
    // Compose from sub-modules; each guards its own visibility internally.
    for (const mod of SUBMODULES) {
      try { Object.assign(data, mod.getData(this) || {}); }
      catch (e) { console.error(`${MODULE_ID} | getData`, e); }
    }
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0]?.closest?.(".window-app") ?? html[0];

    // Make the app focusable so keydown works. NOTE: the template's top-level
    // element IS .crns-root, so it sits in the jQuery set itself — find() only
    // searches descendants and would miss it.
    const rootEl = html.filter(".crns-root")[0] || html.find(".crns-root")[0];
    if (rootEl) {
      rootEl.setAttribute("tabindex", "0");
      rootEl.addEventListener("keydown", (ev) => this._onKeyDown(ev));
      // Any pointerdown inside the window (except on a form field) focuses the
      // root, so the T targeting key arms as soon as the user clicks anywhere in
      // the app — not only after clicking a chip.
      rootEl.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest("input, textarea, select")) return;
        rootEl.focus({ preventScroll: true });
      });
    }

    for (const mod of SUBMODULES) {
      try { mod.activateListeners(this, html); }
      catch (e) { console.error(`${MODULE_ID} | activateListeners`, e); }
    }
  }

  _onKeyDown(ev) {
    // Never hijack keystrokes while the user is typing in a form field
    // (rename inputs, REZ boxes, chat, contenteditable, etc.).
    if (ev.target?.closest?.("input, textarea, select, [contenteditable]")) return;

    // T — target the hovered entity (toggle). Bind by physical key code so it
    // works on non-Latin keyboard layouts (Foundry core binds by code too; on
    // the Russian ЙЦУКЕН layout the physical T key emits "е", not "t"/"т").
    if (ev.code === "KeyT") {
      ev.preventDefault();
      if (typeof this.onTarget === "function") {
        this.onTarget(this.hovered);
      } else if (this.hovered) {
        mutate("session.setTarget", { entityRef: this.hovered });
      }
      return;
    }
    // Escape — clear local selection.
    if (ev.key === "Escape") {
      if (this.state.selection) {
        this.state.selection = "";
        this.render(false);
      }
    }
  }

  async close(options) {
    // Tear down the matrix-rain rAF loop + ResizeObserver (owned by the canvas).
    try { Canvas.stopRain?.(this); } catch (e) { /* noop */ }
    if (this._rainRaf) { cancelAnimationFrame(this._rainRaf); this._rainRaf = null; }
    return super.close(options);
  }
}
