import { ID, LabStore } from "./store.js";
import { NetrunningLabApp } from "./lab-app.js";
import { publishAllProjections } from "./projection.js";
import { LabRuntimeService } from "./runtime-service.js";
import { LabRequestController } from "./request-controller.js";
import { SecureTransport } from "./transport.js";

const store = new LabStore();
const runtime = new LabRuntimeService(store);
const controller = new LabRequestController(store, runtime);
const transport = new SecureTransport();

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
  game.settings.register(ID, "theme", {
    name: "CRNSL.Settings.Theme",
    hint: "CRNSL.Settings.ThemeHint",
    scope: "client",
    config: true,
    type: String,
    default: "redline",
    choices: {
      redline: "CRNSL.Theme.Redline",
      neon: "CRNSL.Theme.Neon",
      mono: "CRNSL.Theme.Mono"
    }
  });
});

Hooks.once("ready", async () => {
  const secure = await transport.initialize((user, request) => controller.handle(user, request));

  globalThis.CRNSL = {
    store,
    runtime,
    controller,
    transport,
    secure,
    ui: new NetrunningLabApp(store, { runtime, transport }),
    async importProduction() {
      if (!game.user.isGM) throw new Error("GM only.");
      const imported = await store.importProduction();
      if (imported[0]) {
        await store.mutateRuntime((state) => {
          state.activeArchitectureId = imported[0].id;
          state.floorState = {};
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

Hooks.on("updateActor", (actor) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  const app = globalThis.CRNSL.ui;
  app.onActorUpdated?.(actor).catch((error) => console.debug(`${ID} | actor refresh`, error));
});

Hooks.on("updateItem", (item) => {
  if (!globalThis.CRNSL?.ui?.rendered || !item.parent) return;
  globalThis.CRNSL.ui.onActorUpdated?.(item.parent).catch((error) => console.debug(`${ID} | item refresh`, error));
});
