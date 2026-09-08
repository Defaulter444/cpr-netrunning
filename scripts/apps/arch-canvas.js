/* Architecture viewport: floor chain, pan/zoom camera, selection & targeting,
 * and the matrix-rain canvas. Phase C.
 *
 * Pan/zoom is ported from the sibling agent-os map.js (applyTransform / zoomAt /
 * wireMapViewport) WITHOUT the chassis CSS-zoom correction — this app uses no
 * CSS `zoom`, so the screen↔local scale divisor is always 1. */

import { MODULE_ID, FLOOR_ICONS, ENTITY_ICONS, loc, abbrFor } from "../constants.js";
import * as archTree from "../rules/tree.js";
import { getWorld, mutate } from "../data.js";
import { getDeck, installedPrograms } from "../cpr-bridge.js";

/* Floor width + gap must match the CSS so the "fit" camera can centre floor 0. */
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;

/* ------------------------------------------------------------------ */
/* View-model                                                          */
/* ------------------------------------------------------------------ */

/** Which arch should this client display, and in what role. */
function resolveDisplay(app) {
  const session = getWorld("session") || {};
  if (game.user.isGM) {
    // Editor takes the centre; otherwise the active tab.
    if (app.state.editorArchId) return { archId: app.state.editorArchId, role: "gm" };
    return { archId: session.activeTab || "", role: "gm" };
  }
  const me = app.myParticipant();
  if (me?.archId) return { archId: me.archId, role: me.kind, me };
  return { archId: "", role: me?.kind || "none", me };
}

/** Colour + display name for a user. */
function userChrome(userId) {
  const user = game.users.get(userId);
  return { color: user?.color || "#8f8f8f", name: user?.name || loc("CRNS.Runners.NPC") };
}

/** Whether this client may select a given entityRef. */
function canSelect(ref, meRunnerPid) {
  if (game.user.isGM) return true;
  if (!ref) return false;
  const [kind, a] = ref.split(":");
  if (kind === "runner") return !!meRunnerPid && a === meRunnerPid;
  if (kind === "prog") return !!meRunnerPid && a === meRunnerPid;
  return false; // players cannot select arch ICE/Demons.
}

/** Per-user target markers pointing at a given entityRef. */
function targetsFor(session, ref) {
  const out = [];
  for (const [userId, tRef] of Object.entries(session.targets || {})) {
    if (tRef && tRef === ref) out.push(userChrome(userId));
  }
  return out;
}

export function getData(app) {
  const { archId, role, me } = resolveDisplay(app);
  const archs = getWorld("netArchs") || {};
  const arch = archs[archId];

  if (!arch) {
    let hint = "CRNS.Canvas.EmptyGM";
    if (role === "runner") hint = "CRNS.Canvas.EmptyRunner";
    else if (role === "spectator") hint = "CRNS.Canvas.EmptySpectator";
    else if (role === "none") {
      // A user with no participant record yet: if spectating is allowed, point
      // them at the spectator switcher instead of the generic no-access hint.
      let allowSpec = false;
      try { allowSpec = !!game.settings.get(MODULE_ID, "allowSpectators"); } catch (e) { /* noop */ }
      hint = allowSpec ? "CRNS.Canvas.EmptySpectator" : "CRNS.Canvas.EmptyNone";
    }
    return { canvas: { empty: true, emptyHint: hint } };
  }

  const session = getWorld("session") || {};
  const parts = session.participants || {};
  const selection = app.state.selection || "";
  // Normalised on read: a world saved before branching existed is a chain, and
  // this is what turns it into a spine so the layout below has a tree to draw.
  const floors = archTree.normalizeFloors(arch.floors || []);
  const lastIndex = floors.length - 1;
  const myRunnerPid = me?.kind === "runner" ? me.pid : "";
  const myFloor = me?.kind === "runner" ? (me.floorIndex || 0) : -1;
  const isGM = game.user.isGM;
  const floorState = session.floorState || {};
  const attachments = session.attachments || [];
  const slid = session.slid || [];
  const progState = session.progState || {};

  // Fog of war, in two grades rather than upstream's single depth cutoff.
  //
  //   KNOWN  — floors the runner has stood on or uncovered with Pathfinder.
  //            Drawn in full: name, contents, who is there.
  //   SENSED — the floors hanging directly off a known one. Drawn as a locked
  //            stub. Standing at a fork you can SEE that it forks and how many
  //            ways it goes; what is down each way stays encrypted until you
  //            step in or scout it.
  //
  // Anything else is not drawn at all. The GM and spectators see everything.
  const fogActive = role === "runner" && !isGM;
  const known = new Set();
  const sensed = new Set();
  if (fogActive) {
    const byId = new Map(floors.map((f, i) => [f.id, i]));
    const add = (i) => { if (Number.isInteger(i) && i >= 0) known.add(i); };

    for (const id of Array.isArray(me?.visited) ? me.visited : []) add(byId.get(id));
    const revealed = (session.reveal || {})[myRunnerPid]?.[archId];
    for (const id of Array.isArray(revealed) ? revealed : []) add(byId.get(id));
    add(myFloor);
    // A runner who has never moved still stands somewhere: without this the
    // very first frame after jacking in would be an empty screen.
    if (!known.size) add(archTree.rootIndex(floors));

    for (const i of known) {
      for (const child of archTree.childrenOf(floors, i)) {
        if (!known.has(child)) sensed.add(child);
      }
    }
  }
  const runnersOnArch = isGM ? runnersOnArchList(session, archId) : [];

  const progFloors = session.progFloors || {};

  /** Owning-runner badge for a prog chip: the participant's actor name/img and
   *  the owning user's colour (GM/NPC runners fall back to the GM colour). */
  const ownerBadge = (p, actor) => {
    let color = "#8f8f8f";
    const user = p.userId ? game.users.get(p.userId) : null;
    if (user?.color) color = String(user.color);
    else {
      const gm = game.users?.find((u) => u.isGM && u.active) || game.users?.find((u) => u.isGM);
      if (gm?.color) color = String(gm.color);
    }
    const name = actor?.name || loc("CRNS.Runners.NPC");
    return {
      name,
      img: actor?.img || "icons/svg/mystery-man.svg",
      color,
      title: loc("CRNS.Canvas.OwnedBy", { name }),
    };
  };

  /** Build the prog-chip view-models grouped by the floor index they render on
   *  (progFloors override, clamped, else the owning runner's floor). */
  const progChipsByFloor = {};
  for (const [pid, p] of Object.entries(parts)) {
    if (p.kind !== "runner" || p.archId !== archId) continue;
    const actor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
    const deck = actor ? getDeck(actor) : null;
    if (!deck) continue;
    for (const prog of installedPrograms(deck) || []) {
      if (prog.system?.class !== "blackice" || !prog.system?.isRezzed) continue;
      const ref = `prog:${pid}:${prog.id}`;
      // Trap/deployed state (SPEC §14.12) takes precedence over progFloors and
      // the runner's own floor for the render index.
      const ps = progState[`${pid}|${prog.id}`] || null;
      // While rezzed the backing prog-ICE ACTOR is the source of truth for
      // name/img/REZ (SPEC §14.12 / Task 1); legacy prog entities without an
      // actorId fall back to the program item.
      const progActor = ps?.actorId ? (game.actors?.get(ps.actorId) ?? null) : null;
      const rezMax = progActor
        ? (progActor.system?.stats?.rez?.max ?? 0)
        : (prog.system?.rez?.max ?? 0);
      const rez = progActor
        ? (progActor.system?.stats?.rez?.value ?? 0)
        : (prog.system?.rez?.value ?? 0);
      const dispName = progActor?.name || prog.name;
      const key = (dispName || "").toLowerCase();
      const override = progFloors[`${pid}|${prog.id}`];
      // Deployed and trap BI ALWAYS render at their stored floor — no owner
      // escort/standby movement (rework per §13). Legacy prog-floor override only
      // applies when there is no progState entry.
      let renderIndex = p.floorIndex || 0;
      if (ps && Number.isInteger(Number(ps.floorIndex))) renderIndex = Number(ps.floorIndex);
      else if (!ps && Number.isInteger(override)) renderIndex = override;
      renderIndex = Math.max(0, Math.min(lastIndex, renderIndex));
      // A trap that has an attachment is CHASING the runner that triggered it —
      // it left "lying in wait" mode; swap the mine badge for a chase badge.
      const progKey = `${pid}|${prog.id}`;
      const chaseAtt = ps?.mode === "trap"
        ? attachments.find((a) => a.progKey === progKey) : null;
      const chasedPart = chaseAtt ? parts[chaseAtt.pid] : null;
      const chasedActor = chasedPart?.actorUuid ? (fromUuidSync?.(chasedPart.actorUuid) ?? null) : null;
      (progChipsByFloor[renderIndex] = progChipsByFloor[renderIndex] || []).push({
        ref,
        isDemon: false,
        isProgram: true,
        actorId: progActor?.id || "",
        name: dispName,
        code: abbrFor(dispName),
        img: progActor?.img || ENTITY_ICONS[key] || actor?.img || "icons/svg/mystery-man.svg",
        rez, rezMax,
        rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
        derezzed: rez <= 0,
        isChasing: !!chaseAtt,
        chaseTitle: chaseAtt ? loc("CRNS.Canvas.Chasing", { name: chasedActor?.name || loc("CRNS.Runners.NPC") }) : "",
        selected: selection === ref,
        selectable: canSelect(ref, myRunnerPid),
        targets: targetsFor(session, ref),
        owner: ownerBadge(p, actor),
        gmDraggable: game.user.isGM,
        isTrap: ps?.mode === "trap",
        isDeployed: ps?.mode === "deployed",
        targetRef: ps?.mode === "deployed" ? (ps.targetRef || "") : "",
        tip: `${dispName} · blackice${rezMax > 0 ? ` · REZ ${rez}/${rezMax}` : ""}`,
      });
    }
  }

  /** Class icon for a non-blackice rezzed program shown as a mini-chip. */
  const progMiniIcon = (cls) => {
    if (cls === "booster") return "fa-arrow-trend-up";
    if (cls === "defender") return "fa-shield-halved";
    return "fa-burst"; // antipersonnelattacker / antiprogramattacker.
  };

  /** Compact mini-chips: every rezzed NON-blackice program of a runner (boosters,
   *  defenders, attackers) rendered under that runner's participant chip. They
   *  are targetable by anyone (same prog: ref format) but selectable only by the
   *  owner (canSelect already allows prog for the owner). Not draggable. */
  const progMinisForPid = (pid, actor, deck) => {
    const out = [];
    if (!deck) return out;
    for (const prog of installedPrograms(deck) || []) {
      const cls = prog.system?.class || "";
      if (cls === "blackice" || !prog.system?.isRezzed) continue; // full chips handle blackice.
      const ref = `prog:${pid}:${prog.id}`;
      const rezMax = prog.system?.rez?.max ?? 0;
      const rez = prog.system?.rez?.value ?? 0;
      out.push({
        ref,
        name: prog.name,
        code: abbrFor(prog.name),
        cls,
        icon: progMiniIcon(cls),
        hasRez: rezMax > 0,
        rez, rezMax,
        derezzed: rezMax > 0 && rez <= 0,
        selected: selection === ref,
        selectable: canSelect(ref, myRunnerPid),
        targets: targetsFor(session, ref),
      });
    }
    return out;
  };

  const buildEntity = (def, kind, floor, isDemon) => {
    const ref = `${kind}:${archId}:${floor.id}:${def.id}`;
    const actor = def.actorId ? game.actors?.get(def.actorId) : null;
    const rezMax = actor?.system?.stats?.rez?.max ?? 0;
    const rez = actor?.system?.stats?.rez?.value ?? 0;
    const derezzed = rez <= 0;

    // Attachment (SPEC §14.11): ICE following a runner gets a link icon + a
    // tether dot in that runner's colour ("привязан к <runner>").
    let tether = null;
    if (kind === "ice") {
      const att = attachments.find((a) => a.archId === archId && a.iceId === def.id);
      if (att) {
        const rp = parts[att.pid];
        const rActor = rp?.actorUuid ? (fromUuidSync?.(rp.actorUuid) ?? null) : null;
        const rName = rActor?.name || loc("CRNS.Runners.NPC");
        tether = { color: userChrome(rp?.userId).color, title: loc("CRNS.Canvas.AttachedTo", { name: rName }) };
      }
    }
    // Slid badge (SPEC §14.7): a crossed-eye visible to the runner who slid + GM.
    let slidHere = false;
    if (kind === "ice") {
      slidHere = slid.some((s) => s.archId === archId && s.iceId === def.id
        && (game.user.isGM || s.pid === myRunnerPid));
    }

    return {
      ref,
      isDemon,
      actorId: def.actorId || "",
      name: actor?.name || def.type,
      img: actor?.img || "icons/svg/mystery-man.svg",
      rez, rezMax,
      rezPct: rezMax > 0 ? Math.round((rez / rezMax) * 100) : 0,
      derezzed,
      selected: selection === ref,
      selectable: canSelect(ref, myRunnerPid),
      targets: targetsFor(session, ref),
      gmDraggable: game.user.isGM,
      tether,
      slid: slidHere,
    };
  };

  /** Floor-marker view-models (SPEC §14.7): breach / cloak / virus / control /
   *  eyedee. DV is GM-only (hidden everywhere for non-GM). */
  const floorMarkers = (floor) => {
    const fx = floorState[`${archId}:${floor.id}`] || null;
    const isPassword = floor.kind === "password";
    const isFile = floor.kind === "file";
    const breached = !!(fx && fx.breached);

    // Cloaks are ARCH-level now (Addendum 6) — rendered as a strip, not per floor.
    const viruses = (fx?.viruses || []).map((v) => ({ id: v.id, title: loc("CRNS.Canvas.Virus"), gm: isGM }));

    // Control tint: controlled floor gets the controller's user-colour + chip.
    let control = null;
    if (fx?.control?.pid) {
      const rp = parts[fx.control.pid];
      const rActor = rp?.actorUuid ? (fromUuidSync?.(rp.actorUuid) ?? null) : null;
      const name = rActor?.name || loc("CRNS.Runners.NPC");
      control = { pid: fx.control.pid, name, color: userChrome(rp?.userId).color,
        title: loc("CRNS.Canvas.Controlled", { name }), gm: isGM };
    }

    // Eyedee accessors: file glow + accessor avatars (GM removable).
    const eyedee = (fx?.eyedee || []).map((epid) => {
      const rp = parts[epid];
      const rActor = rp?.actorUuid ? (fromUuidSync?.(rp.actorUuid) ?? null) : null;
      const name = rActor?.name || loc("CRNS.Runners.NPC");
      return { pid: epid, name, img: rActor?.img || "icons/svg/mystery-man.svg",
        title: loc("CRNS.Canvas.AccessedBy", { name }), gm: isGM };
    });

    return {
      isPassword,
      isFile,
      breached,
      lockTitle: breached ? loc("CRNS.Canvas.Breached") : loc("CRNS.Canvas.Locked"),
      viruses, control,
      eyedeeAccessed: isFile && eyedee.length > 0,
      eyedee,
    };
  };

  // Arch-level cloak strip (Addendum 6): GM sees all cloaks; a player sees only
  // their own (pid matches a runner participant they own); spectators see none.
  const myCloakPids = new Set();
  if (!isGM) {
    for (const [pid, p] of Object.entries(parts)) {
      if (p.kind !== "runner") continue;
      const rActor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
      const ownsIt = (p.userId && p.userId === game.user.id)
        || rActor?.testUserPermission?.(game.user, "OWNER");
      if (ownsIt) myCloakPids.add(pid);
    }
  }
  const cloakStrip = ((session.cloaks || {})[archId] || [])
    .filter((c) => isGM || myCloakPids.has(c.pid))
    .map((c) => {
      const rp = parts[c.pid];
      const rActor = rp?.actorUuid ? (fromUuidSync?.(rp.actorUuid) ?? null) : null;
      const owner = rActor?.name || loc("CRNS.Runners.NPC");
      return {
        id: c.id, n: c.n,
        title: isGM
          ? loc("CRNS.Canvas.CloakGM", { n: c.n, owner, dv: c.dv })
          : loc("CRNS.Canvas.CloakOwner", { n: c.n, dv: c.dv }),
        gm: isGM,
      };
    });

  const layout = archTree.layoutTree(floors);
  const cellOf = new Map(layout.cells.map((c) => [c.index, c]));
  const entryIndex = archTree.rootIndex(floors);

  const floorVMs = floors.map((floor, index) => {
    // "Root" here means the bottom of a branch — where a Virus may be left —
    // not the array's last element, which on a tree is an accident of order.
    const isRoot = archTree.isLeaf(floors, index);
    const entities = [];
    for (const ice of floor.ice || []) entities.push(buildEntity(ice, "ice", floor, false));
    if (floor.demon) entities.push(buildEntity(floor.demon, "demon", floor, true));

    // Runner participants standing on this floor of this arch.
    const participants = [];
    for (const [pid, p] of Object.entries(parts)) {
      if (p.kind !== "runner" || p.archId !== archId) continue;
      if ((p.floorIndex || 0) !== index) continue;
      const actor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
      const deck = actor ? getDeck(actor) : null;
      const ref = `runner:${pid}`;
      const isMine = myRunnerPid === pid;
      participants.push({
        pid, ref,
        name: actor?.name || loc("CRNS.Runners.NPC"),
        img: actor?.img || "icons/svg/mystery-man.svg",
        color: userChrome(p.userId).color,
        isMine,
        selected: selection === ref,
        gmDraggable: game.user.isGM,
        progMinis: progMinisForPid(pid, actor, deck),
      });
    }

    // Rezzed Black-ICE programs render as prog: chips on their owning runner's
    // floor, or on a GM-assigned override floor (progFloors). They act like arch
    // ICE (select → runner's own program panel).
    for (const chip of progChipsByFloor[index] || []) entities.push(chip);

    const kindLabel = floor.kind === "custom" && floor.label
      ? floor.label
      : loc(`CRNS.Floor.${floor.kind}`);

    // A runner may step to the floor above or to any floor below. Upstream
    // asked whether the indices differed by one, which stops being the same
    // question as soon as an architecture forks.
    const showMoveHere = myFloor >= 0 && archTree.adjacentOf(floors, myFloor).includes(index);

    const markers = floorMarkers(floor);
    const cell = cellOf.get(index) || { row: 0, col: 0 };
    return {
      index,
      number: index + 1,
      row: cell.row,
      col: cell.col,
      depth: cell.row,
      isEntry: index === entryIndex,
      isRoot,
      rootIcon: isRoot ? FLOOR_ICONS.root : "",
      icon: FLOOR_ICONS[floor.kind] || FLOOR_ICONS.custom,
      label: kindLabel,
      // DV is GM-only (SPEC §14.7 — hide DV from ALL non-GM everywhere).
      dv: isGM ? (floor.dv || 0) : 0,
      showDv: isGM && !!floor.dv,
      description: isGM ? (floor.description || "") : "",
      floorId: floor.id,
      entities,
      participants,
      showMoveHere,
      markers,
      // GM gear popover (breach toggle / control set-clear). Controls are gated
      // by floor kind: breach only means something on password floors, control
      // only on control nodes — hide the irrelevant widgets elsewhere.
      gmGear: isGM && (floor.kind === "password" || floor.kind === "controlnode"),
      // Every floor is editable, gear or not: the pencil is how the GM gets
      // from "I can see the problem" to "I am fixing it" without leaving the map.
      gmEdit: isGM,
      isPassword: floor.kind === "password",
      isControlNode: floor.kind === "controlnode",
      controlPid: markers.control?.pid || "",
      controlColor: markers.control?.color || "",
      controlChip: markers.control ? { name: markers.control.name, color: markers.control.color } : null,
      runnersForControl: runnersOnArch,
    };
  });

  // Assemble what actually reaches the screen. Known floors keep their full
  // card; sensed ones are replaced by a stub that admits nothing but its own
  // existence — no name, no contents, no DV, no idea who is standing there.
  let visibleFloors = floorVMs;
  if (fogActive) {
    const stepTo = myFloor >= 0 ? archTree.adjacentOf(floors, myFloor) : [];
    visibleFloors = floorVMs
      .filter((f) => known.has(f.index) || sensed.has(f.index))
      .map((f) => {
        if (known.has(f.index)) return f;
        return {
          index: f.index,
          number: f.number,
          row: f.row,
          col: f.col,
          depth: f.depth,
          floorId: f.floorId,
          encrypted: true,
          label: loc("CRNS.Canvas.Encrypted"),
          icon: FLOOR_ICONS.custom,
          entities: [],
          participants: [],
          markers: { cloaks: [], viruses: [], eyedee: [] },
          // Reachable in one step: the server still has the last word, this
          // only decides whether the button is worth drawing.
          showMoveHere: stepTo.includes(f.index),
        };
      });
  }

  // Connectors, drawn only where both ends survived the fog — a line into
  // nothing would tell the player more than the stub does.
  const shown = new Set(visibleFloors.map((f) => f.index));
  const links = archTree.linksOf(floors, layout).filter((l) => shown.has(l.from) && shown.has(l.to));

  // Stashed on the app because the drawing pass runs after the template has
  // been rendered and no longer has the view-model in hand.
  app._crnsLinks = links;

  return {
    canvas: {
      empty: false,
      archId,
      floors: visibleFloors,
      links,
      rows: layout.rows,
      cols: layout.cols,
      branching: layout.cols > 1,
      cloakStrip,
      hasCloaks: cloakStrip.length > 0,
    },
  };
}

/** Runner participants on an arch (for the GM control-set select). Built once. */
function runnersOnArchList(session, archId) {
  const out = [];
  for (const [pid, p] of Object.entries(session.participants || {})) {
    if (p.kind !== "runner" || p.archId !== archId) continue;
    const actor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
    out.push({ pid, name: actor?.name || loc("CRNS.Runners.NPC") });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pan / zoom (ported from agent-os map.js, no CSS-zoom correction)     */
/* ------------------------------------------------------------------ */

function applyTransform(cam, stage) {
  if (!stage) return;
  stage.style.transform =
    `translate(-50%, -50%) translate(${cam.x || 0}px, ${cam.y || 0}px) scale(${cam.z || 1})`;
}

function zoomAt(cam, stage, factor, ax = 0, ay = 0) {
  const z = cam.z || 1;
  const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor));
  if (nz === z) return;
  const ratio = nz / z;
  cam.x = ax - (ax - (cam.x || 0)) * ratio;
  cam.y = ay - (ay - (cam.y || 0)) * ratio;
  cam.z = nz;
  applyTransform(cam, stage);
}

/** Recentre so the first floor sits near the top of the viewport. The stage is
 *  centred via translate(-50%,-50%); pushing it down by ~half its height brings
 *  floor 0 into view. */
function fitCam(cam, viewport, stage) {
  cam.z = 1;
  cam.x = 0;
  const vh = viewport?.clientHeight || 0;
  const sh = stage?.scrollHeight || 0;
  cam.y = Math.max(0, sh / 2 - vh / 2 + 40);
  applyTransform(cam, stage);
}

function wireViewport(app, cam, viewport, stage) {
  if (!viewport || !stage) return;
  applyTransform(cam, stage);

  viewport.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const rect = viewport.getBoundingClientRect();
    const ax = ev.clientX - (rect.left + rect.width / 2);
    const ay = ev.clientY - (rect.top + rect.height / 2);
    zoomAt(cam, stage, factor, ax, ay);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    // Don't start a pan when grabbing a chip / button / runner token.
    if (ev.target.closest(".crns-chip, .crns-runner-chip, .crns-prog-mini, button, .crns-zoom-overlay")) return;
    ev.preventDefault();
    const startX = ev.clientX, startY = ev.clientY;
    const baseX = cam.x || 0, baseY = cam.y || 0;
    let moved = false;
    const move = (e) => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      cam.x = baseX + dx;
      cam.y = baseY + dy;
      applyTransform(cam, stage);
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // A click on empty stage (no drag) clears the local selection.
      if (!moved && app.state.selection) {
        app.state.selection = "";
        app.render(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

/* ------------------------------------------------------------------ */
/* Matrix rain                                                          */
/* ------------------------------------------------------------------ */

const RAIN_GLYPHS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

function startRain(app, canvas, viewport) {
  if (!canvas || !viewport) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let cols = [];
  const sizeCanvas = () => {
    const w = viewport.clientWidth || 300;
    const h = viewport.clientHeight || 300;
    canvas.width = w;
    canvas.height = h;
    const fontSize = 14;
    const n = Math.max(1, Math.floor(w / fontSize));
    cols = new Array(n).fill(0).map(() => Math.random() * h);
    canvas._fontSize = fontSize;
  };
  sizeCanvas();

  // Re-fit the drawing buffer to viewport size changes.
  const ro = new ResizeObserver(() => sizeCanvas());
  ro.observe(viewport);
  app._rainRO = ro;

  const accent = (getComputedStyle(document.documentElement)
    .getPropertyValue("--crns-accent") || "#00ff6a").trim() || "#00ff6a";

  let last = 0;
  const step = (ts) => {
    app._rainRaf = requestAnimationFrame(step);
    if (ts - last < 40) return; // ~25fps throttle.
    last = ts;
    const fs = canvas._fontSize || 14;
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fs}px monospace`;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = accent;
    for (let i = 0; i < cols.length; i++) {
      const ch = RAIN_GLYPHS[(Math.random() * RAIN_GLYPHS.length) | 0];
      ctx.fillText(ch, i * fs, cols[i]);
      cols[i] = cols[i] > canvas.height && Math.random() > 0.975 ? 0 : cols[i] + fs;
    }
    ctx.globalAlpha = 1;
  };
  app._rainRaf = requestAnimationFrame(step);
}

/** Stop the rain loop + observer. Safe to call repeatedly. */
export function stopRain(app) {
  if (app._rainRaf) { cancelAnimationFrame(app._rainRaf); app._rainRaf = null; }
  if (app._rainRO) { try { app._rainRO.disconnect(); } catch (e) { /* noop */ } app._rainRO = null; }
}

/* ------------------------------------------------------------------ */
/* Listeners                                                            */
/* ------------------------------------------------------------------ */

export function activateListeners(app, html) {
  // A fresh render replaces the canvas element — always tear the old loop down.
  stopRain(app);

  const viewport = html.find(".crns-viewport")[0];
  const stage = html.find(".crns-stage")[0];
  if (!viewport || !stage) return;

  const { archId } = resolveDisplay(app);
  app.state.cam = app.state.cam || {};
  let cam = app.state.cam[archId];
  if (!cam) {
    cam = { x: 0, y: 0, z: 1 };
    app.state.cam[archId] = cam;
    // Defer the fit until the stage has laid out (scrollHeight known).
    requestAnimationFrame(() => fitCam(cam, viewport, stage));
  }
  wireViewport(app, cam, viewport, stage);

  // Matrix rain behind the stage.
  const canvas = html.find(".crns-rain")[0];
  startRain(app, canvas, viewport);

  /* ---- zoom overlay ---- */
  html.find('[data-action="cam-zoom-in"]').on("click", (ev) => { ev.stopPropagation(); zoomAt(cam, stage, 1.3); });
  html.find('[data-action="cam-zoom-out"]').on("click", (ev) => { ev.stopPropagation(); zoomAt(cam, stage, 1 / 1.3); });
  html.find('[data-action="cam-reset"]').on("click", (ev) => { ev.stopPropagation(); fitCam(cam, viewport, stage); });

  const myRunnerPid = (() => {
    const me = app.myParticipant();
    return me?.kind === "runner" ? me.pid : "";
  })();

  /* ---- entity chip: select / target / hover / sheet ---- */
  const chips = html.find(".crns-chip, .crns-runner-chip, .crns-prog-mini");

  chips.on("click", (ev) => {
    ev.stopPropagation();
    const ref = ev.currentTarget.dataset.entityRef;
    if (!ref) return;
    if (!canSelect(ref, myRunnerPid)) return;
    app.state.selection = app.state.selection === ref ? "" : ref;
    app.render(false);
  });

  chips.on("mouseenter", (ev) => {
    app.hovered = ev.currentTarget.dataset.entityRef || "";
    // Arm the T targeting key on hover alone: if focus is on the page body or
    // has drifted outside this app window, pull it back onto the .crns-root
    // WITHOUT scrolling — so hovering a chip is enough to target, but we never
    // steal focus from chat/dialog typing (activeElement inside the window).
    const rootEl = ev.currentTarget.closest(".crns-root");
    const winEl = rootEl?.closest(".window-app") || rootEl;
    const active = document.activeElement;
    if (rootEl && (active === document.body || !winEl || !winEl.contains(active))) {
      rootEl.focus({ preventScroll: true });
    }
  });
  chips.on("mouseleave", (ev) => { if (app.hovered === ev.currentTarget.dataset.entityRef) app.hovered = ""; });

  chips.on("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const ref = ev.currentTarget.dataset.entityRef;
    if (ref) mutate("session.setTarget", { entityRef: ref });
  });

  // GM: double-click a backing-actor chip opens its native sheet.
  html.find(".crns-chip[data-actor-id]").on("dblclick", (ev) => {
    ev.stopPropagation();
    if (!game.user.isGM) return;
    // Keep this chip selected so the click/dblclick sequence doesn't leave it
    // deselected (the two clicks would otherwise toggle selection off).
    const ref = ev.currentTarget.dataset.entityRef;
    if (ref && app.state.selection !== ref) { app.state.selection = ref; app.render(false); }
    const actor = game.actors?.get(ev.currentTarget.dataset.actorId);
    actor?.sheet?.render(true);
  });

  /* ---- participant movement ---- */
  // Runner: chevron button moves them onto an adjacent floor. Surface any
  // rejection ({error}: PasswordBlocked / MoveStep) via a warn (SPEC §14.7 G2).
  html.find('[data-action="floor-move-here"]').on("click", async (ev) => {
    ev.stopPropagation();
    const me = app.myParticipant();
    if (me?.kind !== "runner") return;
    const floorIndex = Number(ev.currentTarget.dataset.floorIndex);
    const res = await mutate("session.move", { pid: me.pid, floorIndex });
    if (res && res.error) ui.notifications.warn(loc(res.error));
  });

  // GM: drag a runner chip onto any floor card → move it there; drag an entity
  // chip (ice/demon/prog) onto a floor → move that entity / place the program.
  if (game.user.isGM) {
    html.find(".crns-runner-chip[draggable=true]").on("dragstart", (ev) => {
      const pid = ev.currentTarget.dataset.pid;
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ crnsRunner: pid }));
      ev.originalEvent.dataTransfer.effectAllowed = "move";
    });

    html.find(".crns-chip[draggable=true]").on("dragstart", (ev) => {
      ev.stopPropagation();
      const ref = ev.currentTarget.dataset.entityRef;
      if (!ref) return;
      ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ crns: "ent", ref }));
      ev.originalEvent.dataTransfer.effectAllowed = "move";
    });

    const readPayload = (ev) => {
      try { return JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); }
      catch (e) { return null; }
    };

    html.find(".crns-floor").on("dragover", (ev) => {
      ev.preventDefault();
      ev.currentTarget.classList.add("crns-drop-hover");
    }).on("dragleave", (ev) => {
      ev.currentTarget.classList.remove("crns-drop-hover");
    }).on("drop", async (ev) => {
      ev.preventDefault();
      ev.currentTarget.classList.remove("crns-drop-hover");
      const data = readPayload(ev);
      if (!data) return;
      const floorIndex = Number(ev.currentTarget.dataset.floorIndex);

      // Participant chip → move the runner.
      if (data.crnsRunner) { mutate("session.move", { pid: data.crnsRunner, floorIndex }); return; }

      // Entity chip → move ICE/Demon, or place a rezzed program on a floor.
      if (data.crns === "ent" && typeof data.ref === "string") {
        const [kind, refArchId, , entId] = data.ref.split(":");
        let result = null;
        if (kind === "ice" || kind === "demon") {
          result = await mutate("ent.move", { archId: refArchId, entId, toFloorIndex: floorIndex });
        } else if (kind === "prog") {
          // prog:<pid>:<programId> — pid may itself contain ":".
          const rest = data.ref.slice("prog:".length);
          const cut = rest.lastIndexOf(":");
          const pid = rest.slice(0, cut);
          const programId = rest.slice(cut + 1);
          result = await mutate("run.progFloor", { pid, programId, floorIndex });
        }
        if (result && result.error) ui.notifications.warn(loc(result.error));
      }
    });

    /* ---- GM floor-marker overrides (SPEC §14.7) ---- */

    // ✕ a virus marker (per-floor).
    html.find('[data-action="fx-clear-marker"]').on("click", (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      mutate("fx.clear", { archId, floorId: el.dataset.floorId, kind: el.dataset.kind, id: el.dataset.id });
    });
    // ✕ an arch-level cloak marker (no floorId; Addendum 6).
    html.find('[data-action="fx-clear-cloak"]').on("click", (ev) => {
      ev.stopPropagation();
      mutate("fx.clear", { archId, kind: "cloak", id: ev.currentTarget.dataset.cloakId });
    });
    // Remove an eyedee accessor.
    html.find('[data-action="fx-clear-eyedee"]').on("click", (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      mutate("fx.clear", { archId, floorId: el.dataset.floorId, kind: "eyedee", pid: el.dataset.pid });
    });
    // Toggle breached.
    html.find('[data-action="fx-toggle-breach"]').on("click", (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      mutate("fx.clear", { archId, floorId: el.dataset.floorId, kind: "breach", value: el.dataset.value === "true" });
    });
    // Clear control.
    html.find('[data-action="fx-clear-control"]').on("click", (ev) => {
      ev.stopPropagation();
      mutate("fx.clear", { archId, floorId: ev.currentTarget.dataset.floorId, kind: "control", pid: null });
    });
    // Set controller (runner select).
    html.find('[data-action="fx-set-control"]').on("change", (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      if (!el.value) return;
      mutate("fx.clear", { archId, floorId: el.dataset.floorId, kind: "control", pid: el.value });
    });
    // Toggle the per-floor gear popover open/closed (local UI only).
    /* Click a floor card to drop into its settings.
     *
     * The map is where the GM actually thinks about the architecture — it is
     * the only view that shows the shape — so the floor he wants to change is
     * the one he is looking at. Until now the card was inert and he had to
     * open the editor and hunt for the same floor in a flat list.
     *
     * Bound on the card, not the wrap, and ignored when the click landed on a
     * chip or a button so it does not steal targeting or the move gesture. */
    const openFloor = (ev) => {
      if (!game.user.isGM) return;
      if (ev.target.closest("button, a, select, input, .crns-ent, .crns-prog-mini, .crns-runner-chip")) return;
      const card = ev.currentTarget.closest("[data-floor-id]") || ev.currentTarget;
      const floorId = card?.dataset?.floorId;
      if (!floorId) return;
      const { archId } = resolveDisplay(app);
      if (!archId) return;
      app.state.editorArchId = archId;
      app.state.draft = foundry.utils.deepClone((getWorld("netArchs") || {})[archId] || {});
      app.state.focusFloorId = floorId;
      app.render(false);
    };
    html.find(".crns-floor").on("dblclick", openFloor);
    html.find('[data-action="floor-open"]').on("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openFloor(ev);
    });

    html.find('[data-action="floor-gear"]').on("click", (ev) => {
      ev.stopPropagation();
      const pop = ev.currentTarget.closest(".crns-floor")?.querySelector(".crns-floor-gearpop");
      if (pop) pop.classList.toggle("open");
    });
  }

  // Deployed Black-ICE target lines + one-time nodePulse listener. Defer the
  // line draw one frame so the stage has laid out (chip rects are known).
  requestAnimationFrame(() => {
    // Order matters: the tree edges clear the overlay, the deploy tethers
    // add themselves on top of it.
    drawTreeEdges(app, html);
    drawDeployLines(app, html);
  });
  ensureNodePulseHook();
}

/* ------------------------------------------------------------------ */
/* Deployed Black-ICE target lines (SPEC §14.12)                        */
/* ------------------------------------------------------------------ */

/** Draw a dashed accent line from each deployed BI chip to its target chip.
 *  Both endpoints live inside the transformed stage, so the SVG overlay is also
 *  inside the stage and needs no recompute on pan/zoom — redraw is per-render. */
function drawDeployLines(app, html) {
  const stage = html.find(".crns-stage")[0];
  const svg = html.find(".crns-lines")[0];
  if (!stage || !svg) return;
  // Only our own tethers: the tree edges were drawn first and must survive.
  for (const old of Array.from(svg.querySelectorAll(".crns-deploy-glow, .crns-deploy-line, defs"))) {
    old.remove();
  }

  const cam = app.state.cam?.[resolveDisplay(app).archId] || { z: 1 };
  const z = cam.z || 1;
  const stageRect = stage.getBoundingClientRect();

  // Chip centre in stage-local coordinates (rect math ÷ cam.z, SPEC §14.12).
  const centreOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - stageRect.left) / z,
      y: (r.top + r.height / 2 - stageRect.top) / z,
    };
  };
  const findChip = (ref) => stage.querySelector(`[data-entity-ref="${cssEscape(ref)}"]`);

  const NS = "http://www.w3.org/2000/svg";

  // Arrowhead marker (defined once per redraw) so the accent line points AT the
  // target. userSpaceOnUse keeps the head a constant stage-space size.
  const defs = document.createElementNS(NS, "defs");
  const marker = document.createElementNS(NS, "marker");
  marker.setAttribute("id", "crns-deploy-arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8"); marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7"); marker.setAttribute("markerHeight", "7");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("orient", "auto-start-reverse");
  const head = document.createElementNS(NS, "path");
  head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  head.setAttribute("class", "crns-deploy-arrowhead");
  marker.appendChild(head);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const src of stage.querySelectorAll('[data-deploy-target]')) {
    const targetRef = src.getAttribute("data-deploy-target");
    if (!targetRef) continue;
    const dst = findChip(targetRef);
    if (!dst) continue; // missing / fogged / vanished endpoint — line just isn't drawn.
    const a = centreOf(src);
    const b = centreOf(dst);
    // Wide, blurred underglow line beneath the bright marching-dash line, so the
    // tether reads clearly against busy floor art (user: the old line was too faint).
    const glow = document.createElementNS(NS, "line");
    glow.setAttribute("x1", a.x); glow.setAttribute("y1", a.y);
    glow.setAttribute("x2", b.x); glow.setAttribute("y2", b.y);
    glow.setAttribute("class", "crns-deploy-glow");
    svg.appendChild(glow);
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    line.setAttribute("class", "crns-deploy-line");
    line.setAttribute("marker-end", "url(#crns-deploy-arrow)");
    svg.appendChild(line);
  }
}

/** Draw the parent → child connectors of the floor tree.
 *
 *  Measured rather than computed. Floor cards do not have a fixed height — a
 *  floor with three ICE and two runners standing on it is far taller than an
 *  empty one — so the only way to land a line on the right edge of the right
 *  card is to ask the browser where the cards actually ended up. Both endpoints
 *  live inside the transformed stage, so the overlay needs no recompute on
 *  pan/zoom; it is redrawn per render like the deploy tethers below.
 *
 *  Each connector is an elbow: straight down out of the parent, across at the
 *  midpoint of the gap, straight down into the child. A direct diagonal would
 *  cut through the cards standing between them on a wide fork.
 */
function drawTreeEdges(app, html) {
  const stage = html.find(".crns-stage")[0];
  const svg = html.find(".crns-lines")[0];
  if (!stage || !svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const links = app._crnsLinks || [];
  if (!links.length) return;

  const cam = app.state.cam?.[resolveDisplay(app).archId] || { z: 1 };
  const z = cam.z || 1;
  const stageRect = stage.getBoundingClientRect();

  /** Card box in stage-local coordinates. */
  const boxOf = (index) => {
    const el = stage.querySelector(`.crns-floor-wrap[data-floor-index="${index}"] .crns-floor`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cx: (r.left + r.width / 2 - stageRect.left) / z,
      top: (r.top - stageRect.top) / z,
      bottom: (r.bottom - stageRect.top) / z,
    };
  };

  const NS = "http://www.w3.org/2000/svg";
  for (const link of links) {
    const a = boxOf(link.from);
    const b = boxOf(link.to);
    // A fogged endpoint simply has no card; drawing half a line into empty space
    // would leak the fact that something is there.
    if (!a || !b) continue;

    const midY = a.bottom + (b.top - a.bottom) / 2;
    const d = `M ${a.cx} ${a.bottom} V ${midY} H ${b.cx} V ${b.top}`;

    const glow = document.createElementNS(NS, "path");
    glow.setAttribute("d", d);
    glow.setAttribute("class", "crns-edge-glow");
    svg.appendChild(glow);

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "crns-edge-path");
    svg.appendChild(path);
  }
}

/** Minimal CSS.escape fallback for attribute-selector safety. */
function cssEscape(s) {
  if (window.CSS?.escape) return window.CSS.escape(s);
  return String(s).replace(/["\\\]]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* nodePulse notify → transient floor highlight (SPEC §14.7)            */
/* ------------------------------------------------------------------ */

let _nodePulseHooked = false;
/** Register once: on a nodePulse notify, find that arch's floor card in the open
 *  app and toggle a CSS class for ~2s (no re-render). */
function ensureNodePulseHook() {
  if (_nodePulseHooked) return;
  _nodePulseHooked = true;
  Hooks.on(`${MODULE_ID}.notify`, (data) => {
    if (data?.kind !== "nodePulse") return;
    const app = Object.values(ui.windows || {}).find((w) => w?.constructor?.name === "NetrunningSuiteApp");
    const el = app?.element?.[0];
    if (!el) return;
    // Match the floor card directly (floor ids are unique; the app shows one arch).
    const card = el.querySelector(`.crns-floor[data-floor-id="${cssEscape(data.floorId)}"]`);
    if (!card) return;
    card.classList.add("crns-node-pulse");
    setTimeout(() => card.classList.remove("crns-node-pulse"), 2000);
  });
}
