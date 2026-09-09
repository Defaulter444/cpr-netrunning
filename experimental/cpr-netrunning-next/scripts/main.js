import { ID, LabStore } from "./store.js";
import { NetrunningLabApp } from "./lab-app.js";
import { publishAllProjections } from "./projection.js";
import { LabRuntimeService } from "./runtime-service.js";
import { LabRequestController } from "./request-controller.js";
import { SecureTransport, authority } from "./transport.js";

const store = new LabStore();
const runtime = new LabRuntimeService(store);
const controller = new LabRequestController(store, runtime);
const transport = new SecureTransport();

Hooks.once("init", () => {
  game.settings.register(ID, "reduceMotion", {
    name: "CRNSL.Settings.ReduceMotion",
    hint: "CRNSL.Settings.ReduceMotionHint",
    scope: "client", config: true, type: Boolean, default: false
  });
  game.settings.register(ID, "densePrograms", {
    name: "CRNSL.Settings.DensePrograms",
    hint: "CRNSL.Settings.DenseProgramsHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(ID, "theme", {
    name: "CRNSL.Settings.Theme",
    hint: "CRNSL.Settings.ThemeHint",
    scope: "client", config: true, type: String, default: "redline",
    choices: { redline: "CRNSL.Theme.Redline", neon: "CRNSL.Theme.Neon", mono: "CRNSL.Theme.Mono" }
  });
});

Hooks.once("ready", async () => {
  const secure = await transport.initialize((user, request) => controller.handle(user, request));
  globalThis.CRNSL = {
    store, runtime, controller, transport, secure,
    ui: new NetrunningLabApp(store, { runtime, transport }),
    async importProduction() {
      if (!game.user.isGM) throw new Error("GM only.");
      const imported = await store.importProduction();
      if (imported[0]) await store.mutateRuntime((state) => { state.activeArchitectureId = imported[0].id; state.floorState = {}; });
      await publishAllProjections(store);
      return imported;
    }
  };
  if (game.user.isGM) { await store.ensure(); await publishAllProjections(store); }
});

Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find((c) => c.name === "token");
  token?.tools.push({ name: "crnsl", title: "Netrunning Lab", icon: "fas fa-network-wired", visible: true, button: true, onClick: () => globalThis.CRNSL?.ui?.render(true) });
});

Hooks.on("updateJournalEntry", (doc) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  if (doc.getFlag(ID, "privateStore") === true || doc.getFlag(ID, "projectionFor")) globalThis.CRNSL.ui.render(false);
});
Hooks.on("deleteJournalEntry", (doc) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  if (doc.getFlag(ID, "privateStore") === true || doc.getFlag(ID, "projectionFor")) globalThis.CRNSL.ui.render(false);
});

Hooks.on("updateActor", (actor) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  globalThis.CRNSL.ui.onActorUpdated?.(actor).catch((error) => console.debug(`${ID} | actor refresh`, error));
});
Hooks.on("updateItem", (item) => {
  if (!globalThis.CRNSL?.ui?.rendered || !item.parent) return;
  globalThis.CRNSL.ui.onActorUpdated?.(item.parent).catch((error) => console.debug(`${ID} | item refresh`, error));
});

/* Foundry combat is the authoritative Turn clock. When the active combatant
 * changes to a connected Netrunner, their NET Action pool refreshes exactly once.
 * The GM-only NEW TURN button remains a fallback for scenes run without Combat.
 */
async function syncCombatTurn(combat) {
  if (!game.user.isGM || authority()?.id !== game.user.id || !combat?.started) return;
  const actorUuid = combat.combatant?.actor?.uuid;
  if (!actorUuid) return;
  const key = `${combat.id}:${combat.round ?? 0}:${combat.turn ?? -1}:${actorUuid}`;
  const state = await store.getRuntime();
  if (!state || state.combatKey === key) return;
  const runner = Object.values(state.runners || {}).find((r) => r.actorUuid === actorUuid && r.jackedIn);
  await store.mutateRuntime((next) => {
    next.combatKey = key;
    if (!runner) return;
    const current = next.runners[runner.id];
    if (!current) return;
    current.actionsUsed = 0;
    current.slideUsed = false;
    next.turnSerial = Number(next.turnSerial || 0) + 1;
  });
  if (runner) await publishAllProjections(store);
}
Hooks.on("updateCombat", (combat) => syncCombatTurn(combat).catch((error) => console.debug(`${ID} | combat sync`, error)));
Hooks.on("createCombat", (combat) => syncCombatTurn(combat).catch((error) => console.debug(`${ID} | combat sync`, error)));
