import { netActionsMax } from "./rules.js";

export function activeNetRole(actor) {
  return actor?.itemTypes?.role?.find((role) => role.id === actor.system?.roleInfo?.activeNetRole) ?? null;
}

export function interfaceRank(actor) {
  return Number(activeNetRole(actor)?.system?.rank ?? 0);
}

export function equippedDeck(actor) {
  try {
    return actor?.getEquippedCyberdeck?.() ?? null;
  } catch (_error) {
    return null;
  }
}

export function eligibleRunner(actor) {
  return !!actor && ["character", "mook"].includes(actor.type) && interfaceRank(actor) > 0 && !!equippedDeck(actor);
}

export function candidateRunners() {
  return (game.actors || []).filter(eligibleRunner);
}

export function installedProgramDocs(actor, deck = equippedDeck(actor)) {
  const entries = deck?.system?.installedPrograms || [];
  return entries.map((entry) => {
    const id = typeof entry === "string" ? entry : (entry?._id || entry?.id || entry?.programId || "");
    return actor?.getOwnedItem?.(id) ?? actor?.items?.get?.(id) ?? null;
  }).filter(Boolean);
}

export function profileFor(actor) {
  const deck = equippedDeck(actor);
  const rank = interfaceRank(actor);
  const programs = installedProgramDocs(actor, deck);
  return {
    actorUuid: actor?.uuid || "",
    actorId: actor?.id || "",
    name: actor?.name || "Netrunner",
    img: actor?.img || "icons/svg/mystery-man.svg",
    rank,
    actionsMax: netActionsMax(rank),
    deckId: deck?.id || "",
    deckName: deck?.name || "Cyberdeck",
    programs: programs.map((program) => ({
      id: program.id,
      name: program.name,
      img: program.img,
      class: String(program.system?.class || ""),
      rezzed: !!program.system?.isRezzed,
      rez: Number(program.system?.rez?.value ?? 0),
      rezMax: Number(program.system?.rez?.max ?? 0),
      atk: Number(program.system?.atk ?? 0),
      def: Number(program.system?.def ?? 0),
      hasDamage: !!(program.system?.damage?.blackIce || program.system?.damage?.standard)
    }))
  };
}

async function nativeChat() {
  return (await import("../../../../systems/cyberpunk-red-core/modules/chat/cpr-chat.js")).default;
}

function clickEvent(event) {
  return event ?? { type: "click", ctrlKey: false, metaKey: false };
}

export async function rollInterface(actor, ability, event = null) {
  const deck = equippedDeck(actor);
  const role = activeNetRole(actor);
  if (!deck || !role) throw new Error("Runner needs an active NET Role and equipped Cyberdeck.");
  const roll = deck.createRoll("interfaceAbility", actor, {
    interfaceAbility: ability,
    cyberdeck: deck,
    netRoleItem: role
  });
  if (!roll) return null;
  if (!(await roll.handleRollDialog(clickEvent(event), actor, deck))) return null;
  await roll.roll();
  roll.entityData = { actor: actor.id, item: deck.id };
  await (await nativeChat()).RenderRollCard(roll);
  return {
    total: Number(roll.resultTotal ?? 0),
    die: Number(roll.initialRoll ?? 0),
    criticalSuccess: !!roll.wasCritSuccess?.(),
    criticalFailure: !!roll.wasCritFail?.(),
    roll
  };
}

export async function rollProgram(actor, programId, executionType, event = null) {
  const deck = equippedDeck(actor);
  const role = activeNetRole(actor);
  const program = installedProgramDocs(actor, deck).find((p) => p.id === programId);
  if (!deck || !role || !program) throw new Error("Program is not installed in the equipped Cyberdeck.");
  if (!program.system?.isRezzed) throw new Error("REZ the Program first.");
  const roll = deck.createRoll("cyberdeckProgram", actor, {
    cyberdeckId: deck.id,
    programId,
    executionType,
    netRoleItem: role
  });
  if (!roll) return null;
  if (!(await roll.handleRollDialog(clickEvent(event), actor, deck))) return null;
  await roll.roll();
  roll.entityData = { actor: actor.id, item: deck.id };
  await (await nativeChat()).RenderRollCard(roll);
  return {
    total: Number(roll.resultTotal ?? 0),
    die: Number(roll.initialRoll ?? 0),
    criticalSuccess: !!roll.wasCritSuccess?.(),
    criticalFailure: !!roll.wasCritFail?.(),
    roll
  };
}

export async function setProgramRezzed(actor, programId, rezzed) {
  const deck = equippedDeck(actor);
  const program = installedProgramDocs(actor, deck).find((p) => p.id === programId);
  if (!deck || !program) throw new Error("Program is not installed in the equipped Cyberdeck.");
  if (!!program.system?.isRezzed === !!rezzed) return true;

  if (rezzed) {
    if (program.system?.class === "blackice") await program.setRezzed();
    else await deck.rezProgram(program, actor.token ?? null);
  } else {
    if (program.system?.class === "blackice") program.unsetRezzed?.();
    else await deck.derezProgram(program);
    await deck.resetRezProgram?.(program);
  }

  const updates = [];
  if (deck.isOwned && deck.isEmbedded) updates.push({ _id: deck.id, system: deck.system });
  if (program.isOwned && program.isEmbedded) updates.push({ _id: program.id, system: program.system });
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return true;
}
