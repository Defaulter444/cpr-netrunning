/* Direct runner connection from the console's left column.
 *
 * The console's empty profile panel used to send the GM off to "Manage Run" to
 * find the one control that mattered. This panel puts the same existing
 * operations next to the profile: session.connect and tabs.open for the GM,
 * runner.request / runner.unrequest for a player. Nothing here decides who may
 * do what — the GM-side ops re-check every call. This file only avoids offering
 * what would be refused, and never shows a player more than their own runner.
 *
 *   connectionData(app, data)   → plain view-model for console-connect.hbs
 *   activateConnection(app, root) → native listeners inside `root` only */

import { MODULE_ID, esc, loc } from "../constants.js";
import { getWorld, mutate } from "../data.js";
import { eligibleNetrunner, getInterfaceRank } from "../cpr-bridge.js";

/* Same scheme as runnerPid in runners.js: a pid must never contain ":" (it is
 * embedded in "runner:<pid>" / "prog:<pid>:<id>"). Duplicated because that one
 * is not exported; tools/test-console-connect.mjs compares the two. */
export function runnerPid(actorUuid) {
  return `a_${(actorUuid || "").replace(/[^\w-]/g, "_")}`;
}

function actorOf(uuid) {
  return uuid ? (fromUuidSync?.(uuid) ?? null) : null;
}

/** First non-GM owner, as the roster assigns it. "" keeps the runner GM-run. */
function playerOwnerId(actor) {
  return game.users?.find((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER"))?.id || "";
}

/** What the ops layer counts as success: `true`, or a result object without an
 *  error. `false` is a refusal, `null` a relay timeout. */
function succeeded(result) {
  return result === true || (!!result && typeof result === "object" && !result.error);
}

function failText(result, fallback) {
  const key = result && typeof result === "object" ? result.error : "";
  return key ? loc(key) : fallback;
}

function statusText(c, archName) {
  if (c.jackedIn) return `В СЕТИ · ${archName}`;
  if (c.connected) return `Вне СЕТИ · ${archName}`;
  if (c.asking) return "Просит подключения";
  return "Не подключён";
}

/* ------------------------------------------------------------------ */
/* GM                                                                   */
/* ------------------------------------------------------------------ */

function candidate(pid, actor, part, userId, asking) {
  return {
    pid,
    actorUuid: actor.uuid,
    userId,
    name: actor.name || "—",
    img: actor.img || "icons/svg/mystery-man.svg",
    npc: !actor.hasPlayerOwner,
    rank: getInterfaceRank(actor),
    archId: part?.archId || "",
    floorIndex: Number.isInteger(part?.floorIndex) ? part.floorIndex : 0,
    connected: !!part?.archId,
    jackedIn: !!part?.jackedIn,
    asking: asking.has(pid),
  };
}

/** Every runner the GM can put into a network: the session's runner
 *  participants under their existing pid, then every eligible actor — player
 *  owned or NPC — that has no participant yet. */
function gmCandidates(session) {
  const parts = session.participants || {};
  const asking = new Set((Array.isArray(session.requests) ? session.requests : []).map((r) => r.pid));
  const seen = new Set();
  const out = [];
  for (const [pid, p] of Object.entries(parts)) {
    if (p?.kind !== "runner") continue;
    if (p.actorUuid) seen.add(p.actorUuid);
    const actor = actorOf(p.actorUuid);
    // No actor, no deck: the action bar could not drive it either.
    if (!actor) continue;
    out.push(candidate(pid, actor, p, p.userId || "", asking));
  }
  for (const actor of game.actors?.filter?.((a) => eligibleNetrunner(a)) ?? []) {
    if (seen.has(actor.uuid)) continue;
    const pid = runnerPid(actor.uuid);
    if (parts[pid]) continue;
    out.push(candidate(pid, actor, null, playerOwnerId(actor), asking));
  }
  // Someone asking to be let in comes first; then who is already in a network.
  const rank = (c) => (c.asking && !c.connected ? 0 : c.jackedIn ? 1 : c.connected ? 2 : 3);
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return out;
}

function resolvePick(app, list) {
  const state = app.state || {};
  const selected = (state.selection || "").startsWith("runner:") ? state.selection.slice("runner:".length) : "";
  return list.find((c) => c.pid === state.consoleConnectPick)
    || list.find((c) => c.pid === selected)
    || list.find((c) => c.archId && c.archId === (getWorld("session") || {}).activeTab)
    || list[0]
    || null;
}

/** The architecture the button will use. An explicit choice wins; otherwise
 *  follow the runner's own network, then the one on screen. */
function resolveArch(app, pick, archs, session) {
  const chosen = app.state?.consoleConnectArch || "";
  if (chosen && archs[chosen]) return chosen;
  if (pick?.connected && archs[pick.archId]) return pick.archId;
  if (session.activeTab && archs[session.activeTab]) return session.activeTab;
  return sortedArchs(archs)[0]?.id || "";
}

function sortedArchs(archs) {
  return Object.entries(archs)
    .map(([id, a]) => ({ id, name: a?.name || id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function optionLabel(c) {
  const bits = [c.name];
  if (c.npc) bits.push("НИП");
  if (c.rank) bits.push(`ИНТ ${c.rank}`);
  if (c.jackedIn) bits.push("в СЕТИ");
  else if (c.connected) bits.push("вне СЕТИ");
  else if (c.asking) bits.push("просит подключения");
  return bits.join(" · ");
}

function gmData(app, busy) {
  const session = getWorld("session") || {};
  const archs = getWorld("netArchs") || {};
  const list = gmCandidates(session);
  const pick = resolvePick(app, list);
  const archId = resolveArch(app, pick, archs, session);
  const acting = !!pick && app.state?.selection === `runner:${pick.pid}`;
  const sameArch = !!pick?.connected && pick.archId === archId;
  const inView = !!pick && pick.archId === (session.activeTab || "");

  let hint = "";
  if (!list.length) hint = "Нет персонажей или НИП с кибердекой. Экипируйте кибердеку, чтобы подключить нетраннера.";
  else if (!archId) hint = "Сначала создайте архитектуру СЕТИ.";

  return {
    gm: true,
    player: false,
    busy,
    runners: list.map((c) => ({ pid: c.pid, label: optionLabel(c), selected: c.pid === pick?.pid })),
    archs: sortedArchs(archs).map((a) => ({ ...a, selected: a.id === archId })),
    pick: pick ? {
      pid: pick.pid,
      name: pick.name,
      img: pick.img,
      status: statusText(pick, archs[pick.archId]?.name || ""),
      online: pick.jackedIn,
      connected: pick.connected,
      acting,
    } : null,
    canConnect: !!pick && !pick.connected && !!archId,
    // A connected runner is taken over, not connected again: session.connect
    // would send him back to the entry floor with fresh actions and no map.
    canSwitch: sameArch && !(acting && inView),
    canReconnect: !!pick?.connected && !!archId && !sameArch,
    hint,
  };
}

/* ------------------------------------------------------------------ */
/* Player                                                               */
/* ------------------------------------------------------------------ */

/** Only the player's own participant, and only the name of the network he is
 *  in. The architecture list and the other runners stay GM-side. */
function playerData(app, busy) {
  const me = app.myParticipant?.() ?? null;
  const base = { gm: false, player: true, busy };
  if (me?.kind !== "runner") {
    return {
      ...base,
      me: null,
      canAsk: false,
      canCancel: false,
      hint: me?.kind === "spectator"
        ? "Вы наблюдаете за СЕТЬЮ. Нетраннера подключает ГМ."
        : "ГМ ещё не назначил вам нетраннера.",
    };
  }
  const session = getWorld("session") || {};
  const actor = actorOf(me.actorUuid);
  const request = (Array.isArray(session.requests) ? session.requests : []).find((r) => r.pid === me.pid);
  const archName = me.archId ? ((getWorld("netArchs") || {})[me.archId]?.name || "") : "";
  const c = { connected: !!me.archId, jackedIn: !!me.jackedIn, asking: !!request };
  return {
    ...base,
    me: {
      pid: me.pid,
      name: actor?.name || "—",
      img: actor?.img || "icons/svg/mystery-man.svg",
      status: c.asking && !c.connected ? "Запрос отправлен ГМ" : statusText(c, archName),
      online: c.jackedIn,
      connected: c.connected,
    },
    canAsk: !c.connected && !request && !!actor,
    // runner.unrequest lets only the asker withdraw; do not offer it otherwise.
    canCancel: !c.connected && request?.userId === game.user.id,
    hint: "",
  };
}

export function connectionData(app, data = {}) {
  // `data` is the shell's view-model. Nothing is read from it on purpose: this
  // panel must stay correct whatever the other sub-modules decided to show.
  void data;
  const busy = !!app._consoleConnectBusy;
  return game.user?.isGM ? gmData(app, busy) : playerData(app, busy);
}

/* ------------------------------------------------------------------ */
/* Operations                                                           */
/* ------------------------------------------------------------------ */

/** Put the runner's network on the GM's screen. The GM canvas draws the
 *  active tab, so an acting runner elsewhere would be driven blind. */
async function showArch(archId) {
  if ((getWorld("session") || {}).activeTab === archId) return true;
  const result = await mutate("tabs.open", { archId });
  if (succeeded(result)) return true;
  ui.notifications.warn("Архитектуру нетраннера не удалось открыть на экране.");
  return false;
}

/** The runner the GM is looking at: the rendered select when there is one —
 *  a pid that has since vanished is refused, never swapped for another. */
function chosenRunner(app, list, chosen) {
  return chosen.pid !== undefined ? (list.find((c) => c.pid === chosen.pid) ?? null) : resolvePick(app, list);
}

async function gmSwitch(app, chosen = {}) {
  const pick = chosenRunner(app, gmCandidates(getWorld("session") || {}), chosen);
  if (!pick?.connected) { ui.notifications.warn("Этот нетраннер не подключён."); return; }
  app.state.consoleConnectPick = pick.pid;
  app.state.selection = `runner:${pick.pid}`;
  app.state.consoleFloorArch=pick.archId;
  app.state.consoleFloor=pick.floorIndex;
  app.state.consoleFocusFloor=pick.floorIndex;
  await showArch(pick.archId);
}

async function gmConnect(app, chosen = {}) {
  const session = getWorld("session") || {};
  const archs = getWorld("netArchs") || {};
  const pick = chosenRunner(app, gmCandidates(session), chosen);
  const archId = chosen.archId !== undefined ? chosen.archId : resolveArch(app, pick, archs, session);
  if (!pick) { ui.notifications.warn("Этот нетраннер больше недоступен."); return; }
  if (!archId || !archs[archId]) { ui.notifications.warn("Выберите архитектуру СЕТИ."); return; }
  // Already there: take control. Never re-run session.connect on the same
  // network — it resets floor, actions and the explored map.
  if (pick.connected && pick.archId === archId) { await gmSwitch(app, { pid: pick.pid }); return; }
  if (pick.connected) {
    const from = esc(archs[pick.archId]?.name || "");
    const ok = await Dialog.confirm({
      title: "Переподключение",
      content: `<p>${esc(pick.name)} покинет «${from}», прогресс забега там будет сброшен. Подключить к «${esc(archs[archId].name || archId)}»?</p>`,
    });
    if (ok !== true) return;
  }
  const result = await mutate("session.connect", {
    pid: pick.pid, actorUuid: pick.actorUuid, userId: pick.userId, archId,
  });
  if (!succeeded(result)) { ui.notifications.error(failText(result, "Не удалось подключить нетраннера.")); return; }
  app.state.consoleConnectPick = pick.pid;
  app.state.consoleConnectArch = "";
  app.state.selection = `runner:${pick.pid}`;
  await showArch(archId);
}

async function playerAsk(app) {
  const me = app.myParticipant?.();
  if (me?.kind !== "runner" || me.archId) return;
  const result = await mutate("runner.request", { pid: me.pid, actorUuid: me.actorUuid || "", userId: game.user.id });
  if (!succeeded(result)) { ui.notifications.error(failText(result, "Запрос не отправлен: ГМ не ответил.")); return; }
  ui.notifications.info(loc("CRNS.Runners.Asked"));
}

async function playerCancel(app) {
  const me = app.myParticipant?.();
  if (me?.kind !== "runner") return;
  const result = await mutate("runner.unrequest", { pid: me.pid });
  if (!succeeded(result)) ui.notifications.error(failText(result, "Не удалось отменить запрос."));
}

const ACTIONS = {
  connect: (app, chosen) => (game.user.isGM ? gmConnect(app, chosen) : null),
  switch: (app, chosen) => (game.user.isGM ? gmSwitch(app, chosen) : null),
  ask: (app) => (game.user.isGM ? null : playerAsk(app)),
  cancel: (app) => (game.user.isGM ? null : playerCancel(app)),
};

/** A select only moves local state; picking a runner already in the network
 *  on screen takes control of him at once — no world change, nothing reset. */
function onSelect(app, kind, value) {
  if (!game.user.isGM || app._consoleConnectBusy) return;
  if (kind === "runner") {
    app.state.consoleConnectPick = value;
    app.state.consoleConnectArch = "";
    const session = getWorld("session") || {};
    const c = gmCandidates(session).find((x) => x.pid === value);
    if (c?.connected && c.archId === session.activeTab) {app.state.selection = `runner:${c.pid}`;app.state.consoleFloorArch=c.archId;app.state.consoleFloor=c.floorIndex;app.state.consoleFocusFloor=c.floorIndex;}
  } else if (kind === "arch") {
    app.state.consoleConnectArch = value;
  } else return;
  app.render(false);
}

export function activateConnection(app, root) {
  const box = root?.querySelector?.("[data-console-connect]");
  if (!box || box.dataset.connectBound) return;
  box.dataset.connectBound = "1";

  const controls = () => box.querySelectorAll("[data-connect-action], [data-connect-select]");
  // One operation at a time per window. The flag lives on the app so the
  // re-render a world update triggers mid-await is drawn disabled too.
  const run = async (task) => {
    if (app._consoleConnectBusy) return;
    app._consoleConnectBusy = true;
    for (const el of controls()) el.disabled = true;
    try { await task(); }
    catch (e) {
      console.error(`${MODULE_ID} | console connect`, e);
      ui.notifications.error("Не удалось выполнить подключение.");
    } finally {
      app._consoleConnectBusy = false;
      app.render(false);
    }
  };

  const selects = [...box.querySelectorAll("[data-connect-select]")];
  // Read at click time: an absent select leaves the field to the view-model.
  const chosen = () => {
    const value = (kind) => selects.find((s) => s.dataset.connectSelect === kind)?.value;
    return { pid: value("runner"), archId: value("arch") };
  };
  for (const select of selects) {
    select.addEventListener("change", () => onSelect(app, select.dataset.connectSelect, select.value));
  }
  for (const button of box.querySelectorAll("[data-connect-action]")) {
    const action = ACTIONS[button.dataset.connectAction];
    if (!action) continue;
    button.addEventListener("click", (ev) => {
      ev?.preventDefault?.();
      return run(() => action(app, chosen()));
    });
  }
}
