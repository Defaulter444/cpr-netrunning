/** Optional feature gate: no wrappers, actors or overlays when disabled. */
export function scannerAvailability(game) {
  if (!game.settings.get("cpr-netrunning", "scannerEnabled")) return { active: false, reason: "" };
  if (game.system.id !== "cyberpunk-red-core" || Number(game.release.generation) !== 12)
    return { active: false, reason: "Сканер предназначен для Foundry VTT 12 и Cyberpunk RED. Обычный нетраннинг не изменён." };
  if (!game.modules.get("lib-wrapper")?.active)
    return { active: false, reason: "Для сканера включите libWrapper и перезагрузите мир. Обычный нетраннинг доступен без сканера." };
  if (game.modules.get("pneuma-net-arch-scanner")?.active)
    return { active: false, reason: "Уже включён отдельный Pneuma NetArch Scanner. Для встроенного сканера отключите отдельный модуль и перезагрузите мир." };
  return { active: true, reason: "" };
}
