import { ID } from "./store.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function resolveActor(actorId) {
  const actor = game.actors?.get(actorId) || null;
  if (!actor) throw new Error("NET entity Actor is missing.");
  return actor;
}

async function whisperResult(actor, label, total) {
  const whisper = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper,
    content: `<div class="crnsl-chat-roll"><strong>${esc(label)}</strong><span>${Number(total) || 0}</span></div>`,
    flags: { [ID]: { entityRoll: true } }
  });
}

export async function rollEntityStat(actorId, stat, { label = "NET entity", whisper = true } = {}) {
  const actor = await resolveActor(actorId);
  const roll = actor.createStatRoll?.(stat);
  if (!roll) throw new Error(`${actor.name} cannot roll ${stat}.`);
  await roll.roll();
  const total = Number(roll.resultTotal ?? roll.total ?? 0);
  if (whisper) await whisperResult(actor, label, total);
  return { actor, total, roll };
}

export async function rollWatcherInterface(entity) {
  if (entity.kind !== "demon") throw new Error("Demon watcher required.");
  return rollEntityStat(entity.actorId, "interface", { label: `${entity.label}: Interface`, whisper: true });
}

export async function rollBlackIcePerception(entity) {
  if (entity.kind !== "blackice") throw new Error("Black ICE required.");
  return rollEntityStat(entity.actorId, "per", { label: `${entity.label}: PER`, whisper: true });
}

export async function rollBlackIceSpeed(entity) {
  if (entity.kind !== "blackice") throw new Error("Black ICE required.");
  return rollEntityStat(entity.actorId, "spd", { label: `${entity.label}: SPD`, whisper: true });
}

export async function rollTargetDefense(entity) {
  if (entity.kind === "blackice") return rollEntityStat(entity.actorId, "def", { label: `${entity.label}: DEF`, whisper: true });
  if (entity.kind === "demon") return rollEntityStat(entity.actorId, "interface", { label: `${entity.label}: Interface defense`, whisper: true });
  throw new Error("This target has no supported native NET defense roll.");
}

export async function applyEntityRezDamage(entity, amount) {
  const actor = await resolveActor(entity.actorId);
  const damage = Math.max(0, Math.trunc(Number(amount) || 0));
  const current = Number(actor.system?.stats?.rez?.value ?? 0);
  const next = Math.max(0, current - damage);
  await actor.update({ "system.stats.rez.value": next });
  return { actor, before: current, after: next, damage };
}
