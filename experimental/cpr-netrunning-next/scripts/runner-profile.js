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

export function profileFor(actor) {
  const deck = equippedDeck(actor);
  const rank = interfaceRank(actor);
  const programs = (actor?.itemTypes?.program || []).filter((program) => {
    const ids = deck?.system?.installedPrograms || [];
    return ids.some((entry) => (typeof entry === "string" ? entry : entry?._id || entry?.id) === program.id);
  });
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
      def: Number(program.system?.def ?? 0)
    }))
  };
}
