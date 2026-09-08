/* Architecture editor (floor chain editing). Phase B.
 * Operates on a local DRAFT (app.state.draft) — a deep clone of the arch taken
 * when the editor opens. All edits mutate the draft and re-render locally; the
 * explicit Save button commits via arch.update (which reconciles actors);
 * Cancel/close discards. GM only, shown when state.editorArchId is a tab-open
 * arch. */

import { loc, uid, BLACK_ICE, DEMONS, FLOOR_KINDS, FLOOR_ICONS, ENTITY_ICONS, MAX_ICE_PER_FLOOR, maxDemons, CHECK_ABILITIES } from "../constants.js";
import * as archTree from "../rules/tree.js";
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

  // Every floor needs a parent before the pickers below can describe the tree.
  archTree.normalizeFloors(draft.floors || []);

  /* What a floor is called in the "hangs below" picker.
   *
   * A bare number is useless once an architecture forks — the GM is choosing
   * between "2. Password" and "2. Server room", not between indices — so the
   * label carries the floor's own name. */
  const floorTitle = (f, idx) => {
    const own = f.label || loc(`CRNS.Floor.${f.kind}`);
    return `${idx + 1}. ${own}`;
  };

  /* Which floors may legally sit above this one.
   *
   * Everything except itself and its own descendants: hanging a floor under its
   * own branch would close a loop, and a loop is an architecture with no bottom
   * — the runner could descend forever and the Virus ability would have nowhere
   * to land. `normalizeFloors` would cut such a link on the next read anyway;
   * refusing to offer it is friendlier than silently undoing the GM's choice. */
  const parentChoices = (idx) => {
    const banned = new Set([idx, ...archTree.descendantsOf(draft.floors, idx)]);
    const out = [{ id: "", label: loc("CRNS.Editor.ParentNone") }];
    (draft.floors || []).forEach((other, i) => {
      if (banned.has(i)) return;
      out.push({ id: other.id, label: floorTitle(other, i) });
    });
    return out;
  };

  /* Floors that may ALSO lead into this one.
   *
   * Same exclusions as the primary parent — itself and everything below it,
   * which would close a loop — plus the primary parent, which is already a way
   * in and would only draw a second line on top of the first.
   *
   * This is what makes a diamond possible: one floor forks into two, and both
   * of those name the same floor below. The strict tree had one `parent` per
   * floor, so the second branch had nowhere to attach and simply could not be
   * drawn. */
  const mergeChoices = (idx) => {
    const floor = draft.floors[idx];
    const banned = new Set([idx, ...archTree.descendantsOf(draft.floors, idx)]);
    const also = new Set(floor.alsoFrom || []);
    const out = [];
    (draft.floors || []).forEach((other, i) => {
      if (banned.has(i) || other.id === floor.parent) return;
      out.push({ id: other.id, label: floorTitle(other, i), on: also.has(other.id) });
    });
    return out;
  };

  /* The interface abilities a floor's DV can be rolled against.
   *
   * Upstream inferred this from the floor kind — password meant Backdoor, file
   * meant Eye-Dee — which leaves a custom floor with a DV and no way to beat it.
   * Naming the ability explicitly also makes the runner's bonuses land: a deck
   * running Worm adds +2 to Backdoor, and the roll only picks that up if it
   * knows it IS a Backdoor roll. */
  const checkChoices = [
    { id: "", label: loc("CRNS.Editor.CheckNone") },
    ...CHECK_ABILITIES.map((a) => ({ id: a, label: loc(`CPR.global.role.netrunner.interfaceAbility.${a}`) })),
  ];

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
    const kids = archTree.childrenOf(draft.floors, idx);
    return {
      focused: app.state.focusFloorId === f.id,
      id: f.id,
      index: idx,
      number: idx + 1,
      parent: f.parent || "",
      parentChoices: parentChoices(idx),
      mergeChoices: mergeChoices(idx),
      alsoFrom: f.alsoFrom || [],
      mergeCount: (f.alsoFrom || []).length,
      depth: archTree.depthOf(draft.floors, idx),
      forks: kids.length > 1 ? kids.length : 0,
      virusPlan: f.virusPlan || {},
      check: f.check || "",
      contents: f.contents || "",
      contentsImage: f.contentsImage || "",
      checkChoices,
      // A password gates by its nature; anything else gates only if the GM says
      // so. Showing the switch as already-on for a password keeps the card
      // honest instead of implying the floor is open.
      gate: f.gate === true || f.kind === "password",
      gateForced: f.kind === "password",
      kind: f.kind,
      kindIcon: FLOOR_ICONS[f.kind] || FLOOR_ICONS.custom,
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
  // Drilled in from the map: bring that card into view once, then forget it, so
  // the next ordinary render does not keep yanking the list back.
  const focusId = app.state.focusFloorId;
  if (focusId) {
    app.state.focusFloorId = "";
    const card = html.find(`.crns-floor-card[data-floor-id="${focusId}"]`)[0];
    if (card) requestAnimationFrame(() => card.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

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
  html.find('[data-action="floor-merge"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (!f) return;
    const picked = Array.from(ev.currentTarget.selectedOptions).map((o) => o.value);
    f.alsoFrom = picked.filter(Boolean);
    reRender(app);
  });

  html.find('[data-action="floor-parent"]').on("change", (ev) => {
    const card = ev.currentTarget.closest("[data-floor-id]");
    const f = floorAt(app, card?.dataset.floorId);
    if (!f) return;
    const wanted = ev.currentTarget.value || "";
    f.parent = wanted;
    // Re-normalise straight away: if the pick somehow closed a loop the tree is
    // repaired here, while the GM is still looking at it, rather than silently
    // on the next read.
    archTree.normalizeFloors(app.state.draft?.floors || []);
    reRender(app);
  });
  html.find('[data-action="floor-gate"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.gate = !!ev.currentTarget.checked; reRender(app); }
  });
  html.find('[data-action="floor-image"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) f.contentsImage = ev.currentTarget.value.trim();
  });

  html.find('[data-action="floor-image-pick"]').on("click", (ev) => {
    ev.preventDefault();
    const row = ev.currentTarget.closest("[data-floor-id]");
    const field = row?.querySelector('[data-action="floor-image"]');
    const f = floorAt(app, row?.dataset.floorId);
    if (!f || !field) return;
    // `FilePicker` is a BARE global in v12: it is declared with `class` in a
    // classic script, which creates a lexical binding rather than a property of
    // globalThis. `globalThis.FilePicker` finds nothing.
    new FilePicker({
      type: "image",
      current: f.contentsImage || "",
      callback: (chosen) => {
        f.contentsImage = chosen;
        // Write the field directly as well: the draft is only re-rendered on
        // demand, and the GM should see what he just picked.
        field.value = chosen;
        reRender(app);
      },
    }).render(true);
  });

  html.find('[data-action="floor-contents"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) f.contents = ev.currentTarget.value;
  });

  html.find('[data-action="floor-check"]').on("change", (ev) => {
    const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
    if (f) { f.check = ev.currentTarget.value || ""; reRender(app); }
  });
  const changeVirusPlan = (field) => (ev) => {
      const f = floorAt(app, ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId);
      if (!f) return;
      f.virusPlan ||= {};
      f.virusPlan[field] = field === "effect" ? ev.currentTarget.value :
        (ev.currentTarget.value.trim() === "" ? null : Number(ev.currentTarget.value));
      reRender(app);
  };
  html.find('[data-action="virus-dv"]').on("change", changeVirusPlan("dv"));
  html.find('[data-action="virus-actions"]').on("change", changeVirusPlan("actions"));
  html.find('[data-action="virus-effect"]').on("change", changeVirusPlan("effect"));
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
    // The new floor hangs UNDER the one whose "+" was pressed. Without an
    // explicit parent it would be parentless, and normalisation would hang it
    // off the entry instead — which is why a branch could not be grown: every
    // floor added at the end of a branch jumped back to the top.
    //
    // This also makes forking a single gesture: press "+" twice on the same
    // floor and it now has two children.
    const nf = {
      id: uid("f"), parent: id || "", kind: "password", label: "", dv: 6,
      check: "backdoor", gate: false, description: "", contents: "", contentsImage: "",
      ice: [], demon: null,
    };
    app.state.draft.floors.splice(i + 1, 0, nf);
    reRender(app);
  });
  html.find('[data-action="floor-delete"]').on("click", (ev) => {
    const id = ev.currentTarget.closest("[data-floor-id]")?.dataset.floorId;
    const floors = app.state.draft.floors;
    if (floors.length <= 1) return;
    const i = floorIndex(id);
    if (i < 0) return;
    // Splice the floor out of the tree, not just out of the array: its children
    // move up to its parent. Leaving them parentless would fling a whole branch
    // back to the entry, which is never what deleting a middle floor means.
    const gone = floors[i];
    for (const child of floors) {
      if (child.parent === gone.id) child.parent = gone.parent || "";
    }
    floors.splice(i, 1);
    archTree.normalizeFloors(floors);
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
