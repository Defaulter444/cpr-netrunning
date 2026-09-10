/* The GM's workshop for Black ICE and demons the core book does not have.
 *
 * The pickers only ever offered the twelve ICE and three demons printed in the
 * book, and the entity record already carried an `actorId` field nothing filled
 * in — the shape was there, the way to author one was not. This is that way.
 *
 * Everything the GM types goes through `custom.save`, which validates GM-side.
 * The dialog checks nothing itself on purpose: a type that reached the registry
 * malformed would be referenced by architectures, and arch validation would then
 * refuse to save the whole architecture.
 */

import {
  loc, esc, ENTITY_ICONS, iceName, demonName,
  readCustomEntities, DEFAULT_ICE_IMG, DEFAULT_DEMON_IMG,
} from "../constants.js";
import { mutate } from "../data.js";

const isIce = (kind) => kind === "ice";

/** The GM-authored types of one kind, as rows ready to render. */
export function customRows(kind) {
  const store = readCustomEntities();
  const bucket = (isIce(kind) ? store.ice : store.demons) || {};
  return Object.entries(bucket).map(([key, def]) => ({
    key,
    def,
    name: isIce(kind) ? iceName(key) : demonName(key),
    img: ENTITY_ICONS[key] || (isIce(kind) ? DEFAULT_ICE_IMG : DEFAULT_DEMON_IMG),
    stats: isIce(kind)
      ? `PER ${def.per} · SPD ${def.spd} · ATK ${def.atk} · DEF ${def.def} · REZ ${def.rez}`
      : `REZ ${def.rez} · INT ${def.interface} · NA ${def.actions} · CN ${def.combatNumber}`,
  }));
}

/* ------------------------------------------------------------------ */
/* Create / edit form                                                  */
/* ------------------------------------------------------------------ */

const num = (id, label, value, min, max) =>
  `<label class="crns-forge-num"><span>${esc(label)}</span>` +
  `<input type="number" data-f="${id}" value="${esc(value)}" min="${min}" max="${max}" step="1" /></label>`;

function formHtml(kind, def) {
  const d = def || {};
  const img = esc(d.img || (isIce(kind) ? DEFAULT_ICE_IMG : DEFAULT_DEMON_IMG));
  const stats = isIce(kind)
    ? [
      num("per", loc("CRNS.Forge.Per"), d.per ?? 4, 0, 20),
      num("spd", loc("CRNS.Forge.Spd"), d.spd ?? 4, 0, 20),
      num("atk", loc("CRNS.Forge.Atk"), d.atk ?? 4, 0, 20),
      num("def", loc("CRNS.Forge.Def"), d.def ?? 2, 0, 20),
      num("rez", loc("CRNS.Forge.Rez"), d.rez ?? 15, 1, 100),
    ].join("")
    : [
      num("rez", loc("CRNS.Forge.Rez"), d.rez ?? 15, 1, 100),
      num("interface", loc("CRNS.Forge.Interface"), d.interface ?? 3, 0, 10),
      num("actions", loc("CRNS.Forge.Actions"), d.actions ?? 2, 1, 10),
      num("combatNumber", loc("CRNS.Forge.CombatNumber"), d.combatNumber ?? 14, 0, 30),
    ].join("");

  const iceOnly = isIce(kind)
    ? `<label class="crns-forge-row"><span>${esc(loc("CRNS.Forge.Target"))}</span>
         <select data-f="tgt">
           <option value="N"${d.tgt === "P" ? "" : " selected"}>${esc(loc("CRNS.Forge.TargetRunner"))}</option>
           <option value="P"${d.tgt === "P" ? " selected" : ""}>${esc(loc("CRNS.Forge.TargetProgram"))}</option>
         </select></label>
       <label class="crns-forge-row"><span>${esc(loc("CRNS.Forge.Damage"))}</span>
         <input type="text" data-f="damage" value="${esc(d.damage || "")}" placeholder="2d6" /></label>`
    : "";

  return `<div class="crns-forge">
    <label class="crns-forge-row"><span>${esc(loc("CRNS.Forge.Name"))}</span>
      <input type="text" data-f="name" value="${esc(d.name || "")}" /></label>
    <div class="crns-forge-stats">${stats}</div>
    ${iceOnly}
    <label class="crns-forge-row"><span>${esc(loc("CRNS.Forge.Image"))}</span>
      <span class="crns-forge-img">
        <input type="text" data-f="img" value="${img}" />
        <button type="button" class="crns-icon-btn crns-forge-pick" title="${esc(loc("CRNS.Forge.Pick"))}"><i class="fas fa-file-import"></i></button>
      </span></label>
    <label class="crns-forge-row crns-forge-effect"><span>${esc(loc("CRNS.Forge.Effect"))}</span>
      <textarea data-f="effect" rows="3" placeholder="${esc(loc("CRNS.Forge.EffectHint"))}">${esc(d.effect || "")}</textarea></label>
  </div>`;
}

function readForm(root, kind) {
  const val = (f) => root.querySelector(`[data-f="${f}"]`)?.value ?? "";
  const base = { name: val("name"), img: val("img"), effect: val("effect") };
  if (isIce(kind)) {
    return {
      ...base,
      tgt: val("tgt"),
      damage: val("damage"),
      per: val("per"), spd: val("spd"), atk: val("atk"), def: val("def"), rez: val("rez"),
    };
  }
  return {
    ...base,
    rez: val("rez"), interface: val("interface"),
    actions: val("actions"), combatNumber: val("combatNumber"),
  };
}

/** Create or edit one type. Resolves with the saved key, or null if cancelled. */
export function openForgeForm(kind, { key = "", def = null } = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn(loc("CRNS.Errors.GmOnly"));
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const titleKey = key
      ? "CRNS.Forge.TitleEdit"
      : (isIce(kind) ? "CRNS.Forge.TitleNewIce" : "CRNS.Forge.TitleNewDemon");

    const dlg = new Dialog({
      title: loc(titleKey),
      content: formHtml(kind, def),
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: loc("CRNS.Forge.Save"),
          // A Dialog button always closes the dialog, so a rejected save cannot
          // simply keep the window open. It reopens instead, seeded with exactly
          // what the GM typed — nothing is retyped after a validation warning.
          callback: async (html) => {
            const root = html[0] ?? html;
            const draft = readForm(root, kind);
            const res = await mutate("custom.save", { kind, key, def: draft });
            if (res?.error) {
              ui.notifications.warn(loc(res.error));
              finish(await openForgeForm(kind, { key, def: draft }));
              return;
            }
            finish(res?.key || null);
          },
        },
        cancel: {
          icon: '<i class="fas fa-xmark"></i>',
          label: loc("CRNS.Tree.Cancel"),
          callback: () => finish(null),
        },
      },
      default: "save",
      close: () => finish(null),
      render: (html) => {
        const root = html[0] ?? html;
        root.querySelector('.crns-forge-pick')?.addEventListener("click", (ev) => {
          ev.preventDefault();
          const field = root.querySelector('[data-f="img"]');
          // `FilePicker` is a bare global in v12 — same note as in editor.js.
          new FilePicker({
            type: "image",
            current: field?.value || "",
            callback: (chosen) => { if (field) field.value = chosen; },
          }).render(true);
        });
      },
    });
    dlg.render(true);
  });
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

/** List, edit and delete the GM's own types. Reopens itself after every change
 *  so the list always shows what the registry actually holds. */
export function openForgeManager(kind) {
  if (!game.user?.isGM) { ui.notifications.warn(loc("CRNS.Errors.GmOnly")); return; }
  const rows = customRows(kind);
  const body = rows.length
    ? rows.map((r) => `<div class="crns-forge-item" data-key="${esc(r.key)}">
        <img src="${esc(r.img)}" alt="${esc(r.name)}" />
        <span class="crns-forge-item-name">${esc(r.name)}</span>
        <span class="crns-forge-item-stats">${esc(r.stats)}</span>
        <button type="button" class="crns-icon-btn crns-forge-edit" title="${esc(loc("CRNS.Forge.Edit"))}"><i class="fas fa-pen"></i></button>
        <button type="button" class="crns-icon-btn crns-forge-delete" title="${esc(loc("CRNS.Forge.Delete"))}"><i class="fas fa-trash"></i></button>
      </div>`).join("")
    : `<p class="crns-forge-empty">${esc(loc("CRNS.Forge.Empty"))}</p>`;

  const dlg = new Dialog({
    title: loc(isIce(kind) ? "CRNS.Forge.ManagerIce" : "CRNS.Forge.ManagerDemon"),
    content: `<div class="crns-forge-list">${body}</div>`,
    buttons: {
      create: {
        icon: '<i class="fas fa-plus"></i>',
        label: loc("CRNS.Forge.Create"),
        callback: async () => { await openForgeForm(kind); openForgeManager(kind); },
      },
      close: { icon: '<i class="fas fa-xmark"></i>', label: loc("CRNS.Tree.Cancel") },
    },
    default: "close",
    render: (html) => {
      const root = html[0] ?? html;
      root.querySelectorAll('.crns-forge-edit').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const key = btn.closest("[data-key]")?.dataset.key;
          const row = customRows(kind).find((r) => r.key === key);
          dlg.close();
          await openForgeForm(kind, { key, def: row?.def || null });
          openForgeManager(kind);
        });
      });
      root.querySelectorAll('.crns-forge-delete').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const key = btn.closest("[data-key]")?.dataset.key;
          const res = await mutate("custom.delete", { kind, key });
          if (res?.error) {
            // Naming the architectures turns "cannot delete" into something the
            // GM can act on, instead of a hunt for the last reference by hand.
            const where = (res.archs || []).join(", ");
            ui.notifications.warn(where ? `${loc(res.error)} — ${where}` : loc(res.error));
            return;
          }
          dlg.close();
          openForgeManager(kind);
        });
      });
    },
  });
  dlg.render(true);
}
