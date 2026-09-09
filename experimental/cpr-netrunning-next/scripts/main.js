import { ID, LabStore } from "./store.js";
import { NetrunningLabApp } from "./lab-app.js";
import { publishProjection } from "./projection.js";

const store = new LabStore();

Hooks.once("init", () => {
  game.settings.register(ID, "runtime", {
    scope: "world",
    config: false,
    type: Object,
    default: { activeArchitectureId: "", currentNodeId: "", discoveredNodeIds: [] }
  });

  game.settings.register(ID, "publicProjection", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
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
        const root = imported[0].nodes[0]?.id || "";
        await game.settings.set(ID, "runtime", {
          activeArchitectureId: imported[0].id,
          currentNodeId: root,
          discoveredNodeIds: root ? [root] : []
        });
        await publishProjection(store, imported[0].id);
      }
      return imported;
    }
  };

  if (game.user.isGM) {
    await store.ensure();
    const runtime = game.settings.get(ID, "runtime") || {};
    if (runtime.activeArchitectureId) await publishProjection(store, runtime.activeArchitectureId);
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find((c) => c.name === "token");
  token?.tools.push({
    name: "crnsl",
    title: "NET Lab",
    icon: "fas fa-flask",
    visible: true,
    button: true,
    onClick: () => globalThis.CRNSL?.ui?.render(true)
  });
});

Hooks.on("updateSetting", (setting) => {
  if (!globalThis.CRNSL?.ui?.rendered) return;
  if (setting.key === `${ID}.runtime` || setting.key === `${ID}.publicProjection`) {
    globalThis.CRNSL.ui.render(false);
  }
});
