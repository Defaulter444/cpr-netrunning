// Stable references into our architecture store; no floor/ICE disclosure to players.
export const SUITE_PREFIX = "CRNS.NetArch.";
export function suiteArchitectures() {
  if (!game.user.isGM) return [];
  const saved = game.settings.get("cpr-netrunning", "netArchs") ?? {};
  return Object.entries(saved).map(([id, arch]) => ({
    uuid: `${SUITE_PREFIX}${id}`, id, name: arch.name || "Без названия",
    documentName: "Item", type: "netarch", suite: true,
  }));
}
export async function resolveArchitecture(uuid) {
  if (uuid?.startsWith(SUITE_PREFIX)) return suiteArchitectures().find(arch => arch.uuid === uuid) ?? null;
  return uuid ? fromUuid(uuid) : null;
}
export async function openArchitecture(uuid) {
  if (!game.user.isGM) throw new Error("Архитектуру точки доступа открывает мастер.");
  const arch = await resolveArchitecture(uuid);
  if (arch?.type !== "netarch") throw new Error("Архитектура недоступна. Выберите другую в списке.");
  if (!arch.suite) return arch.sheet.render(true);
  const { mutate } = await import("../data.js");
  await mutate("tabs.open", { archId: arch.id });
  globalThis.CRNS.ui.render(true);
}
