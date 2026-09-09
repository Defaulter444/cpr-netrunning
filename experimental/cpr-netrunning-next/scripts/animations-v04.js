import { ID } from "./store.js";

const appSnapshots = new WeakMap();
const MOTION = Object.freeze({ OFF: "off", SUBTLE: "subtle", CINEMATIC: "cinematic" });

Hooks.once("init", () => {
  game.settings.register(ID, "motionLevel", {
    name: "Netrunning Lab: motion",
    hint: "Off disables decorative motion. Subtle animates state changes only. Cinematic also enables ambient NET flow.",
    scope: "client",
    config: true,
    type: String,
    default: MOTION.SUBTLE,
    choices: {
      [MOTION.OFF]: "Off",
      [MOTION.SUBTLE]: "Subtle",
      [MOTION.CINEMATIC]: "Cinematic"
    },
    onChange: () => globalThis.CRNSL?.ui?.render?.(false)
  });
});

function rootFor(app, html) {
  const host = html?.[0] || html;
  return host?.matches?.(".crnsl-root")
    ? host
    : host?.querySelector?.(".crnsl-root") || app?.element?.[0]?.querySelector?.(".crnsl-root") || null;
}

function prefersReducedMotion() {
  try {
    return !!game.settings.get(ID, "reduceMotion") || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch (_error) {
    return true;
  }
}

function motionLevel() {
  if (prefersReducedMotion()) return MOTION.OFF;
  try {
    const value = game.settings.get(ID, "motionLevel");
    return Object.values(MOTION).includes(value) ? value : MOTION.SUBTLE;
  } catch (_error) {
    return MOTION.SUBTLE;
  }
}

function applyMotionClass(root) {
  const level = motionLevel();
  root.classList.remove("v04-motion-off", "v04-motion-subtle", "v04-motion-cinematic");
  root.classList.add(`v04-motion-${level}`);
  root.dataset.v04Motion = level;
  return level;
}

function snapshot(root) {
  const nodes = {};
  root.querySelectorAll(".crnsl-node[data-node-id]").forEach((node) => {
    const statuses = [...node.querySelectorAll(".crnsl-node-statuses .status")]
      .map((el) => [...el.classList].filter((name) => name !== "status").sort().join("."))
      .filter(Boolean);
    nodes[node.dataset.nodeId] = {
      unknown: node.classList.contains("unknown"),
      statuses
    };
  });

  const programs = {};
  root.querySelectorAll(".crnsl-program-row").forEach((row) => {
    const control = row.querySelector("[data-program-id]");
    if (!control?.dataset.programId) return;
    programs[control.dataset.programId] = { rezzed: row.classList.contains("rezzed") };
  });

  return {
    currentNodeId: root.querySelector(".crnsl-node.current[data-node-id]")?.dataset.nodeId || "",
    nodes,
    pips: [...root.querySelectorAll(".crnsl-action-pips .pip")].map((pip) => pip.classList.contains("used")),
    programs
  };
}

function transient(el, className, duration = 760) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), duration);
}

function animateRoutePacket(root, fromId, toId, level) {
  if (level === MOTION.OFF || !fromId || !toId || fromId === toId) return;
  const from = root.querySelector(`.crnsl-node[data-node-id="${CSS.escape(fromId)}"]`);
  const to = root.querySelector(`.crnsl-node[data-node-id="${CSS.escape(toId)}"]`);
  if (!to) return;

  transient(to, "v04-arrival", level === MOTION.CINEMATIC ? 840 : 560);
  if (!from || typeof document.body?.append !== "function") return;

  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const start = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const end = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const packet = document.createElement("div");
  packet.className = `crnsl-v04-packet ${level}`;
  packet.style.left = `${start.x}px`;
  packet.style.top = `${start.y}px`;
  document.body.append(packet);

  const duration = level === MOTION.CINEMATIC ? 520 : 340;
  const animation = packet.animate([
    { transform: "translate(-50%, -50%) scale(.55)", opacity: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.22}px), calc(-50% + ${dy * 0.22}px)) scale(1)`, opacity: 1, offset: .24 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.72)`, opacity: .08 }
  ], { duration, easing: "cubic-bezier(.2,.72,.2,1)", fill: "forwards" });
  animation.finished.catch(() => {}).finally(() => packet.remove());
}

function animateReveal(root, id, level) {
  if (level === MOTION.OFF) return;
  const node = root.querySelector(`.crnsl-node[data-node-id="${CSS.escape(id)}"]`);
  transient(node, "v04-decrypted", level === MOTION.CINEMATIC ? 980 : 680);
}

function animateStatuses(root, id) {
  const node = root.querySelector(`.crnsl-node[data-node-id="${CSS.escape(id)}"]`);
  transient(node, "v04-status-change", 620);
}

function animatePips(root, previous, current) {
  const pips = [...root.querySelectorAll(".crnsl-action-pips .pip")];
  const length = Math.min(previous.length, current.length, pips.length);
  for (let i = 0; i < length; i++) {
    if (previous[i] === current[i]) continue;
    transient(pips[i], current[i] ? "v04-pip-spent" : "v04-pip-ready", 540);
  }
}

function animatePrograms(root, previous, current) {
  for (const [id, now] of Object.entries(current)) {
    const before = previous[id];
    if (!before || before.rezzed === now.rezzed) continue;
    const button = root.querySelector(`[data-program-id="${CSS.escape(id)}"]`);
    const row = button?.closest(".crnsl-program-row");
    transient(row, now.rezzed ? "v04-program-rez" : "v04-program-derez", 720);
  }
}

function animateDiff(root, before, after, level) {
  if (!before || level === MOTION.OFF) return;
  animateRoutePacket(root, before.currentNodeId, after.currentNodeId, level);

  for (const [id, now] of Object.entries(after.nodes)) {
    const previous = before.nodes[id];
    if (!previous) continue;
    if (previous.unknown && !now.unknown) animateReveal(root, id, level);
    const oldStatuses = new Set(previous.statuses || []);
    if ((now.statuses || []).some((status) => !oldStatuses.has(status))) animateStatuses(root, id);
  }

  animatePips(root, before.pips || [], after.pips || []);
  animatePrograms(root, before.programs || {}, after.programs || {});
}

function enhance(app, html) {
  if (app?.options?.id !== "crnsl-window") return;
  const root = rootFor(app, html);
  if (!root) return;
  const level = applyMotionClass(root);
  const next = snapshot(root);
  const previous = appSnapshots.get(app) || null;
  appSnapshots.set(app, next);
  if (!previous || level === MOTION.OFF) return;
  requestAnimationFrame(() => requestAnimationFrame(() => animateDiff(root, previous, next, level)));
}

Hooks.on("renderApplication", enhance);
Hooks.on("renderNetrunningLabApp", enhance);

Hooks.once("ready", () => {
  globalThis.CRNSL ||= {};
  globalThis.CRNSL.motion = Object.freeze({
    version: "0.4",
    level: motionLevel,
    reduced: prefersReducedMotion
  });
});
