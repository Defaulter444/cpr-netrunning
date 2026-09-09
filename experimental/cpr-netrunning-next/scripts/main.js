import { ID, LabStore } from "./store.js";
import { NetrunningLabApp } from "./lab-app.js";
import { publishAllProjections } from "./projection.js";

const store = new LabStore();

Hooks.once("init", () => {
  game.settings.register(ID, "reduceMotion", {
    name: "CRNSL.Settings.ReduceMotion",
    hint: "CRNSL.Settings.ReduceMotionHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(ID, "densePrograms", {
    name: "CRNSL.Settings.DensePrograms",
    hint: "CRNSL.Settings.DenseProgramsHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", async () => {
  globalThis.CRNSL = {
    store,
    ui: new NetrunningLabApp(store),
    async importProduction() {
      if (!game.user.isGM) throw new Error("GM only.");
      const imported = await store.importProduction();
      if (imported[0]) {
        await store.mutateRuntime((runtime) => {
          runtime.activeArchitectureId = imported[0].id;
        });
      }
      await publishAllProjections(store);
      return imported;
    }
  };

  if (game.user.isGM) {
    await store.ensure();
    await publishAllProjections(store);
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find((c) => c.name === "token");
  token?.tools.push({
    name: "crnsl",
    title: "Netrunning Lab",
    icon: "fas fa-network-wired",
    visible: true,
    button: true,
    onClick: () => globalThis.CRNSL?.ui?.render(true)
  });
});

/* The private store and per-user projections are JournalEntry documents, so the
 * normal Foundry document update channel is enough to refresh the UI. No secret
 * runtime state is placed in a world setting.
 */
Hooks.on("updateJournalEntry", (doc) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  if (doc.getFlag(ID, "privateStore") === true || doc.getFlag(ID, "projectionFor")) {
    globalThis.CRNSL.ui.render(false);
  }
});

Hooks.on("deleteJournalEntry", (doc) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  if (doc.getFlag(ID, "privateStore") === true || doc.getFlag(ID, "projectionFor")) {
    globalThis.CRNSL.ui.render(false);
  }
});
