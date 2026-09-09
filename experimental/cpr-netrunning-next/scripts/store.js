const ID = "cpr-netrunning-next";
const PROD_ID = "cpr-netrunning";
const STORE_FLAG = "privateStore";

function clone(value) {
  return foundry.utils.deepClone(value);
}

function uid(prefix = "lab") {
  return `${prefix}_${foundry.utils.randomID(12)}`;
}

export function defaultRuntime() {
  return {
    revision: 0,
    activeArchitectureId: "",
    activeRunnerId: "",
    runners: {},
    floorState: {},
    turnSerial: 0
  };
}

function normalizeFloors(rawFloors = []) {
  const floors = clone(Array.isArray(rawFloors) ? rawFloors : []);
  if (!floors.length) return [];

  const hasDeclaredParents = floors.some((f) => typeof f?.parent === "string" && f.parent);
  if (!hasDeclaredParents) {
    floors.forEach((f, i) => {
      if (!f) return;
      f.parent = i === 0 ? "" : (floors[i - 1]?.id ?? "");
    });
  }

  const ids = new Set(floors.map((f) => f?.id).filter(Boolean));
  for (const floor of floors) {
    if (!floor) continue;
    if (!floor.id) floor.id = uid("floor");
    if (floor.parent && !ids.has(floor.parent)) floor.parent = "";
    floor.alsoFrom = Array.isArray(floor.alsoFrom)
      ? [...new Set(floor.alsoFrom)].filter((id) => id && id !== floor.id && ids.has(id))
      : [];
  }
  return floors;
}

function convertProductionArchitecture(sourceId, source) {
  const floors = normalizeFloors(source?.floors);
  const nodes = floors.map((f, index) => ({
    id: f.id,
    index,
    label: String(f.label || f.name || "").trim() || `Floor ${index + 1}`,
    kind: f.kind || "custom",
    dv: Number(f.dv) || 0,
    check: f.check || "",
    gate: !!f.gate,
    parent: f.parent || "",
    alsoFrom: [...(f.alsoFrom || [])],
    contents: String(f.contents || ""),
    contentsImage: String(f.contentsImage || ""),
    gmNotes: String(f.description || ""),
    attachments: [],
    controls: []
  }));

  return {
    id: uid("arch"),
    sourceId,
    sourceModule: PROD_ID,
    name: String(source?.name || "Imported Architecture"),
    importedAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    nodes
  };
}

function demoArchitecture() {
  const a = { id: uid("floor"), parent: "", alsoFrom: [] };
  const b = { id: uid("floor"), parent: a.id, alsoFrom: [] };
  const c = { id: uid("floor"), parent: a.id, alsoFrom: [] };
  const d = { id: uid("floor"), parent: b.id, alsoFrom: [c.id] };

  return {
    id: uid("arch"),
    sourceId: "",
    sourceModule: "",
    name: "Kiroshi Lab Prototype",
    importedAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    nodes: [
      {
        ...a, index: 0, label: "Access Point", kind: "custom", dv: 0, check: "",
        gate: false, contents: "", contentsImage: "", gmNotes: "Entry point",
        attachments: [], controls: []
      },
      {
        ...b, index: 1, label: "Security Gate", kind: "password", dv: 8, check: "backdoor",
        gate: true, contents: "", contentsImage: "", gmNotes: "Blocks the left branch",
        attachments: [], controls: []
      },
      {
        ...c, index: 2, label: "Camera Router", kind: "controlnode", dv: 7, check: "control",
        gate: false, contents: "", contentsImage: "", gmNotes: "Meatspace test node",
        attachments: [], controls: []
      },
      {
        ...d, index: 3, label: "Shipping Manifest", kind: "file", dv: 8, check: "eyedee",
        gate: false, contents: "Prototype cargo manifest. Player-visible only after Eye-Dee.",
        contentsImage: "", gmNotes: "Both branches converge here",
        attachments: [], controls: []
      }
    ]
  };
}

export class LabStore {
  constructor() {
    this.doc = null;
  }

  async ensure() {
    if (!game.user.isGM) return null;

    const existing = game.journal?.find((j) => j.getFlag(ID, STORE_FLAG) === true);
    if (existing) {
      this.doc = existing;
      if (!existing.getFlag(ID, "runtime")) await existing.setFlag(ID, "runtime", defaultRuntime());
      return existing;
    }

    this.doc = await JournalEntry.create({
      name: "[CRNS LAB] Private Store",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: {
        [ID]: {
          [STORE_FLAG]: true,
          architectures: {},
          runtime: defaultRuntime()
        }
      }
    });
    return this.doc;
  }

  async all() {
    if (!game.user.isGM) return {};
    const doc = await this.ensure();
    return clone(doc?.getFlag(ID, "architectures") || {});
  }

  async get(id) {
    return (await this.all())[id] || null;
  }

  async save(architecture) {
    if (!game.user.isGM) throw new Error("GM only.");
    const doc = await this.ensure();
    const all = clone(doc.getFlag(ID, "architectures") || {});
    const next = clone(architecture);
    next.modifiedAt = new Date().toISOString();
    all[next.id] = next;
    await doc.setFlag(ID, "architectures", all);
    return next;
  }

  async remove(id) {
    if (!game.user.isGM) throw new Error("GM only.");
    const doc = await this.ensure();
    const all = clone(doc.getFlag(ID, "architectures") || {});
    delete all[id];
    await doc.setFlag(ID, "architectures", all);
  }

  async getRuntime() {
    if (!game.user.isGM) return null;
    const doc = await this.ensure();
    return { ...defaultRuntime(), ...clone(doc?.getFlag(ID, "runtime") || {}) };
  }

  async saveRuntime(runtime) {
    if (!game.user.isGM) throw new Error("GM only.");
    const doc = await this.ensure();
    const next = { ...defaultRuntime(), ...clone(runtime) };
    next.revision = Number(next.revision || 0) + 1;
    await doc.setFlag(ID, "runtime", next);
    return next;
  }

  async mutateRuntime(mutator) {
    const runtime = await this.getRuntime();
    await mutator(runtime);
    return this.saveRuntime(runtime);
  }

  async importProduction() {
    if (!game.user.isGM) throw new Error("GM only.");

    let production;
    try {
      production = game.settings.get(PROD_ID, "netArchs");
    } catch (_error) {
      throw new Error("cpr-netrunning is not available or its netArchs setting is missing.");
    }

    const values = Object.entries(production || {});
    if (!values.length) throw new Error("No production architectures found.");

    const current = await this.all();
    const imported = [];
    for (const [sourceId, source] of values) {
      const copy = convertProductionArchitecture(sourceId, source);
      current[copy.id] = copy;
      imported.push(copy);
    }

    const doc = await this.ensure();
    await doc.setFlag(ID, "architectures", current);
    return imported;
  }

  async createDemo() {
    const demo = demoArchitecture();
    await this.save(demo);
    return demo;
  }

  async mutateNode(architectureId, nodeId, mutator) {
    const arch = await this.get(architectureId);
    if (!arch) throw new Error("Architecture not found.");
    const node = arch.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error("Node not found.");
    await mutator(node, arch);
    return this.save(arch);
  }
}

export { ID, PROD_ID };
