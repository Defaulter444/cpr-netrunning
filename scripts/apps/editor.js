/* Architecture editor (floor chain editing). Phase B.
 * Operates on a local DRAFT (app.state.draft) — a deep clone of the arch taken
 * when the editor opens. All edits mutate the draft and re-render locally; the
 * explicit Save button commits via arch.update (which reconciles actors);
 * Cancel/close discards. GM only, shown when state.editorArchId is a tab-open
 * arch. */

import { loc, uid, BLACK_ICE, DEMONS, FLOOR_KINDS, FLOOR_ICONS, ENTITY_ICONS, MAX_ICE_PER_FLOOR, maxDemons } from "../constants.js";
import { getWorld, mutate } from "../data.js";

const ICE_TYPES = Object.keys(BLACK_ICE);
const DEMON_TYPES = Object.keys(DEMONS);

/* The draft this editor works on, guaranteeing it matches editorArchId. */
function currentDraft(app) {
  const archId = app.state.editorArchId;
  if (!archId) return null;
  const session = getWorld("session") || {};
  if (!(session.tabs || []).includes(archId)) return null;
  const stored = (getWorld("netArchs") || {})[archId];
  if (!stored) return null;
  let draft = app.state.draft;
  if (!draft || draft.id !== archId) {
    draft = foundry.utils.deepClone(stored);
    app.state.draft = draft;
  }
  return draft;
}

/* Count demons already placed in the draft. */
function demonCount(draft) {
  return (draft.floors || []).reduce((n, f) => n + (f.demon ? 1 : 0), 0);
}

export function getData(app) {
  if (!game.user.isGM) return {};
  const draft = currentDraft(app);
  if (!draft) return {};

  const floorCount = (draft.floors || []).length;
  const demons = demonCount(draft);
  const demonMax = maxDemons(floorCount);

  const stored = (getWorld("netArchs") || {})[draft.id];
  const dirty = JSON.stringify(stored) !== JSON.stringify(draft);

  const kinds = FLOOR_KINDS.map((k) => ({ id: k, label: loc(`CRNS.Floor.${k}`) }));

  const floors = (draft.floors || []).map((f, idx) => {
    const iceSlots = [];
    for (let s = 0; s < MAX_ICE_PER_FLOOR; s++) {
      const def = f.ice?.[s] ?? null;
      iceSlots.push(def
        ? { filled: true, uid: def.id, type: def.type, name: loc(`${BLACK_ICE[def.type].effectKey}.name`), img: ENTITY_ICONS[def.type] }
        : { filled: false });
    }
    const demon = f.demon
      ? { uid: f.demon.id, type: f.demon.type, name: loc(`CRNS.Demon.${f.demon.type}.name`), img: ENTITY_ICONS[f.demon.type] }
      : null;
    return {
      id: f.id,
      index: idx,
      number: idx + 1,
      kind: f.kind,
      kindIcon: FLOOR_ICONS[f.kind] || FLOOR_ICONS.custom,
      isCustom: f.kind === "custom",
      label: f.label || "",
      dv: f.dv ?? 0,
      description: f.description || "",
      iceSlots,
      demon,
      isFirst: idx === 0,
      isLast: idx === floorCount - 1,
      canDelete: floorCount > 1,
    };
  });

  const icePicker = ICE_TYPES.map((t) => ({
    type: t, name: loc(`${BLACK_ICE[t].effectKey}.name`), img: ENTITY_ICONS[t],
    per: BLACK_ICE[t].per, spd: BLACK_ICE[t].spd, atk: BLACK_ICE[t].atk, def: BLACK_ICE[t].def, rez: BLACK_ICE[t].rez,
  }));
  const demonPicker = DEMON_TYPES.map((t) => ({
    type: t, name: loc(`CRNS.Demon.${t}.name`), img: ENTITY_ICONS[t],
    rez: DEMONS[t].rez, iface: DEMONS[t].interface, actions: DEMONS[t].actions, cn: DEMONS[t].combatNumber,
  }));

  return {
    editor: {
      archId: draft.id,
      name: draft.name,
      floors,
      floorCount,
      demons,
      demonMax,
      demonBudgetFull: demons >= demonMax,
      dirty,
      kinds,
      icePicker,
      demonPicker,
    },
  };
}

/* ---- draft mutators (all local, followed by app.render(false)) ---- */
function floorAt(app, floorId) {
  return (app.state.draft?.floors || []).find((f) => f.id === floorId) ?? null;
}
function reRender(app) { app.render(false); }

export function activateListeners(app, html) {
  if (!game.user.isGM) return;
  const root = html.find(".crns-editor-body")[0];
  if (!root) return;
  const draft = app.state.draft;
  if (!draft || draft.id !== app.state.editorArchId) return;

  /* ---- header ---- */
  html.find('[data-action="editor-name"]').on("change", (ev) => {
    draft.name = ev.currentTarget.value.trim() || draft.name;
    reRender(app);
  });
  html.find('[data-action="editor-save"]').on("click", async () => {
    const result = await mutate("arch.update", { archId: draft.id, arch: draft });
    if (result && typeof result === "object" && result.error) {
      ui.notifications.warn(loc(result.error));
      return;
    }
    // Re-sync the draft from the (reconciled) stored arch so actorIds land.
    app.state.draft = foundry.utils.deepClone((getWorld("netArchs") || {})[draft.id] || draft);
    reRender(app);
  });
  html.find('[data-action="editor-cancel"]').on("click", () => {
    app.state.editorArchId = "";
    app.state.draft = {};
    reRender(app);
  });

  /* ---- floor field edits ---- */
  html.find('[data-action="floor-kind"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.kind = ev.currentTarget.value; reRender(app); }
  });
  html.find('[data-action="floor-label"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.label = ev.currentTarget.value; reRender(app); }
  });
  html.find('[data-action="floor-dv"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.dv = Math.max(0, Number(ev.currentTarget.value) || 0); reRender(app); }
  });
  html.find('[data-action="floor-desc"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.description = ev.currentTarget.value; reRender(app); }
  });

  /* ---- floor structure ---- */
  const floorIndex = (floorId) => (app.state.draft?.floors || []).findIndex((f) => f.id === floorId);
  html.find('[data-action="floor-up"]').on("click", (ev) => {
    const id = ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId;
    const i = floorIndex(id);
    const floors = app.state.draft.floors;
    if (i > 0) { [floors[i - 1], floors[i]] = [floors[i], floors[i - 1]]; reRender(app); }
  });
  html.find('[data-action="floor-down"]').on("click", (ev) => {
    const id = ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId;
    const i = floorIndex(id);
    const floors = app.state.draft.floors;
    if (i >= 0 && i < floors.length - 1) { [floors[i + 1], floors[i]] = [floors[i], floors[i + 1]]; reRender(app); }
  });
  html.find('[data-action="floor-insert"]').on("click", (ev) => {
    const id = ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId;
    const i = floorIndex(id);
    const nf = { id: uid("f"), kind: "password", label: "", dv: 6, description: "", ice: [], demon: null };
    app.state.draft.floors.splice(i + 1, 0, nf);
    reRender(app);
  });
  html.find('[data-action="floor-delete"]').on("click", (ev) => {
    const id = ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId;
    const floors = app.state.draft.floors;
    if (floors.length <= 1) return;
    const i = floorIndex(id);
    if (i >= 0) floors.splice(i, 1);
    reRender(app);
  });

  /* ---- ICE add / remove ---- */
  html.find('[data-action="ice-add"]').on("click", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (!f) return;
    if ((f.ice?.length ?? 0) >= MAX_ICE_PER_FLOOR) return;
    openIcePicker(app, f);
  });
  html.find('[data-action="ice-remove"]').on("click", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    const iceId = ev.currentTarget.closest("[data-ice-id]")?.dataset.iceId;
    if (f && iceId) { f.ice = (f.ice || []).filter((i) => i.id !== iceId); reRender(app); }
  });

  /* ---- Demon add / remove ---- */
  html.find('[data-action="demon-add"]').on("click", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (!f || f.demon) return;
    if (demonCount(app.state.draft) >= maxDemons(app.state.draft.floors.length)) {
      ui.notifications.warn(loc("CRNS.Editor.DemonBudgetFull"));
      return;
    }
    openDemonPicker(app, f);
  });
  html.find('[data-action="demon-remove"]').on("click", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.demon = null; reRender(app); }
  });
}

/* ---- pickers (Dialog with portrait grid + stats) ---- */
function openIcePicker(app, floor) {
  const rows = Object.keys(BLACK_ICE).map((t) => {
    const d = BLACK_ICE[t];
    const name = loc(`${d.effectKey}.name`);
    return `<button type="button" class="crns-pick" data-type="${t}">
      <img src="${ENTITY_ICONS[t]}" alt="${name}" />
      <span class="crns-pick-name">${name}</span>
      <span class="crns-pick-stats">PER ${d.per} · SPD ${d.spd} · ATK ${d.atk} · DEF ${d.def} · REZ ${d.rez}</span>
    </button>`;
  }).join("");
  const dlg = new Dialog({
    title: loc("CRNS.Editor.PickIce"),
    content: `<div class="crns-pick-grid">${rows}</div>`,
    buttons: { close: { label: loc("CRNS.Tree.Cancel") } },
    default: "close",
    render: (html) => {
      html[0].querySelectorAll(".crns-pick").forEach((btn) => {
        btn.addEventListener("click", () => {
          if ((floor.ice?.length ?? 0) < MAX_ICE_PER_FLOOR) {
            (floor.ice ||= []).push({ id: uid("i"), type: btn.dataset.type, actorId: "" });
            app.render(false);
          }
          dlg.close();
        });
      });
    },
  });
  dlg.render(true);
}

function openDemonPicker(app, floor) {
  const rows = Object.keys(DEMONS).map((t) => {
    const d = DEMONS[t];
    const name = loc(`CRNS.Demon.${t}.name`);
    return `<button type="button" class="crns-pick" data-type="${t}">
      <img src="${ENTITY_ICONS[t]}" alt="${name}" />
      <span class="crns-pick-name">${name}</span>
      <span class="crns-pick-stats">REZ ${d.rez} · INT ${d.interface} · NA ${d.actions} · CN ${d.combatNumber}</span>
    </button>`;
  }).join("");
  const dlg = new Dialog({
    title: loc("CRNS.Editor.PickDemon"),
    content: `<div class="crns-pick-grid">${rows}</div>`,
    buttons: { close: { label: loc("CRNS.Tree.Cancel") } },
    default: "close",
    render: (html) => {
      html[0].querySelectorAll(".crns-pick").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!floor.demon) {
            floor.demon = { id: uid("d"), type: btn.dataset.type, actorId: "" };
            app.render(false);
          }
          dlg.close();
        });
      });
    },
  });
  dlg.render(true);
}
