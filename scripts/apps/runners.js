/* GM right slide-out runner panel + actor drag&drop roster. Phase C.
 *
 * The roster is the union of (a) session runner participants and (b) every
 * player-owned/assigned eligible netrunner actor not yet in the session. GM may
 * connect a roster entry to the active tab, disconnect, remove, or "act as" it. */

import { loc } from "../constants.js";
import { getWorld, mutate } from "../data.js";
import { eligibleNetrunner, getInterfaceRank, netActionsMax } from "../cpr-bridge.js";
import { confirmDisconnect } from "./actions.js";

/* participantId for an actor-backed runner. MUST NOT contain ":" — pids are
 * embedded in colon-delimited entityRefs ("runner:<pid>", "prog:<pid>:<progId>")
 * and parsed with split(":") all over the module. */
function runnerPid(actorUuid) {
  return `a_${(actorUuid || "").replace(/[^\w-]/g, "_")}`;
}

/* Owner user (first non-GM owner) + colour for an actor. */
function ownerChrome(actor) {
  const owner = game.users?.find((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER")) || null;
  if (!owner) return { userId: "", color: "#8f8f8f", name: loc("CRNS.Runners.NPC") };
  return { userId: owner.id, color: owner.color || "#8f8f8f", name: owner.name };
}

function positionLabel(part, archs) {
  if (!part?.archId) return "—";
  const arch = archs[part.archId];
  if (!arch) return "—";
  return loc("CRNS.Runners.Position", { arch: arch.name, floor: (part.floorIndex || 0) + 1 });
}

export function getData(app) {
  if (!game.user.isGM) return { runners: null };

  const session = getWorld("session") || {};
  const archs = getWorld("netArchs") || {};
  const parts = session.participants || {};
  const activeTab = session.activeTab || "";
  const selection = app.state.selection || "";

  const rows = [];
  const seenUuids = new Set();

  // (a) Session runner participants.
  for (const [pid, p] of Object.entries(parts)) {
    if (p.kind !== "runner") continue;
    const actor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
    if (p.actorUuid) seenUuids.add(p.actorUuid);
    const chrome = actor ? ownerChrome(actor) : { color: "#8f8f8f", name: loc("CRNS.Runners.NPC") };
    const rank = actor ? getInterfaceRank(actor) : 0;
    rows.push({
      pid,
      inSession: true,
      actorUuid: p.actorUuid || "",
      userId: p.userId || "",
      name: actor?.name || loc("CRNS.Runners.NPC"),
      img: actor?.img || "icons/svg/mystery-man.svg",
      color: chrome.color,
      owner: chrome.name,
      rank,
      actionsValue: p.actions?.value ?? 0,
      actionsMax: p.actions?.max ?? netActionsMax(rank),
      position: positionLabel(p, archs),
      connected: !!p.archId,
      hasActiveTab: !!activeTab,
      hasReveal: Object.keys((session.reveal || {})[pid] || {}).length > 0,
      selected: selection === `runner:${pid}`,
    });
  }

  // (b) Auto-listed eligible actors not already in session.
  const actors = game.actors?.filter((a) => eligibleNetrunner(a)
    && a.hasPlayerOwner) || [];
  const dismissed = new Set(Array.isArray(session.dismissed) ? session.dismissed : []);
  for (const actor of actors) {
    if (seenUuids.has(actor.uuid)) continue;
    const pid = runnerPid(actor.uuid);
    if (parts[pid]) continue;
    // Taken out of the column by the GM. Without this the auto-list undid every
    // removal a frame later.
    if (dismissed.has(pid)) continue;
    const chrome = ownerChrome(actor);
    const rank = getInterfaceRank(actor);
    rows.push({
      pid,
      inSession: false,
      actorUuid: actor.uuid,
      userId: chrome.userId,
      name: actor.name,
      img: actor.img || "icons/svg/mystery-man.svg",
      color: chrome.color,
      owner: chrome.name,
      rank,
      actionsValue: 0,
      actionsMax: netActionsMax(rank),
      position: "—",
      connected: false,
      hasActiveTab: !!activeTab,
      hasReveal: false,
      selected: selection === `runner:${pid}`,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  // Two sources feed this column: participants of the live session, and every
  // eligible actor in the world that could join one. They used to be poured
  // into a single flat list, which made the delete button look broken — the GM
  // removed a participant and the very same actor reappeared a frame later from
  // the auto-list, same name, same portrait. The removal HAD worked; nothing on
  // screen said so.
  //
  // So the two states are now separated and labelled. Deleting a runner moves
  // its row from one group to the other, which is visible, and the meaning of
  // the button becomes "take out of the session" rather than "delete", which is
  // all it ever did.
  rows.sort((a, b) => Number(b.inSession) - Number(a.inSession));
  let seenAvailable = false;
  for (const row of rows) {
    row.groupHead = false;
    if (!row.inSession && !seenAvailable) {
      seenAvailable = true;
      row.groupHead = true;
    }
  }
  const anyInSession = rows.some((r) => r.inSession);
  const anyDismissed = (Array.isArray(session.dismissed) ? session.dismissed : []).length > 0;
  if (rows.length && rows[0].inSession) rows[0].sessionHead = true;

  return {
    runners: {
      anyInSession,
      anyDismissed,
      collapsed: !!app.state.collapsedRight,
      rows,
    },
  };
}

export function activateListeners(app, html) {
  if (!game.user.isGM) return;

  /* ---- collapse / expand rail ---- */
  html.find('[data-action="runners-toggle"]').on("click", () => {
    app.state.collapsedRight = !app.state.collapsedRight;
    app.render(false);
  });

  const rowPid = (ev) => ev.currentTarget.closest("[data-pid]")?.dataset.pid;
  const rowData = (ev) => {
    const el = ev.currentTarget.closest("[data-pid]");
    return { pid: el?.dataset.pid, actorUuid: el?.dataset.actorUuid || "", userId: el?.dataset.userId || "" };
  };

  html.find('[data-action="runner-connect"]').on("click", (ev) => {
    const session = getWorld("session") || {};
    const archId = session.activeTab || "";
    if (!archId) { ui.notifications.warn(loc("CRNS.Runners.NoActiveTab")); return; }
    const { pid, actorUuid, userId } = rowData(ev);
    mutate("session.connect", { pid, actorUuid, userId, archId });
  });

  html.find('[data-action="runner-disconnect"]').on("click", async (ev) => {
    const pid = rowPid(ev);
    if (!(await confirmDisconnect(pid))) return;
    mutate("session.disconnect", { pid });
  });

  html.find('[data-action="runner-restore-all"]').on("click", () => {
    mutate("runner.restore", {});
  });

  html.find('[data-action="runner-remove"]').on("click", (ev) => {
    mutate("runner.remove", { pid: rowPid(ev) });
  });

  html.find('[data-action="runner-act"]').on("click", (ev) => {
    app.state.selection = `runner:${rowPid(ev)}`;
    app.render(false);
  });

  // Hide (clear) a runner's pathfinder reveal (SPEC §14.7).
  html.find('[data-action="runner-hide-reveal"]').on("click", (ev) => {
    mutate("run.clearReveal", { pid: rowPid(ev) });
  });

  /* ---- drag & drop: drop an Actor anywhere on the app → roster ---- */
  // .crns-root is the template's top-level element — it lives in the jQuery
  // set itself, so find() (descendants only) misses it.
  const rootEl = html.filter(".crns-root")[0] || html.find(".crns-root")[0];
  if (rootEl) {
    rootEl.addEventListener("dragover", (ev) => {
      // Only react to Actor drags from the sidebar.
      if (Array.from(ev.dataTransfer?.types || []).includes("text/plain")) ev.preventDefault();
    });
    rootEl.addEventListener("drop", async (ev) => {
      let data = null;
      try { data = TextEditor.getDragEventData(ev); } catch (e) { return; }
      if (!data || data.type !== "Actor") return;
      ev.preventDefault();
      const actor = await fromUuid(data.uuid);
      if (!eligibleNetrunner(actor)) { ui.notifications.warn(loc("CRNS.Runners.NotEligible")); return; }
      const chrome = ownerChrome(actor);
      mutate("session.connect", { pid: runnerPid(actor.uuid), actorUuid: actor.uuid, userId: chrome.userId, archId: "" });
    });
  }
}
