import { MODULE_ID } from "../../scripts/scanner/constants.js";
import { freshAP } from "../../scripts/scanner/model.js";

export class Collection extends Map {
  constructor(entries = []) { super(entries.map((entry) => [entry.id, entry])); }
  [Symbol.iterator]() { return this.values(); }
  find(fn) { return [...this.values()].find(fn); }
  filter(fn) { return [...this.values()].filter(fn); }
  some(fn) { return [...this.values()].some(fn); }
  map(fn) { return [...this.values()].map(fn); }
  get contents() { return [...this.values()]; }
}

export function setPath(object, path, value) {
  const parts = path.split(".");
  let pointer = object;
  for (const key of parts.slice(0, -1)) pointer = pointer[key] ??= {};
  pointer[parts.at(-1)] = value;
}
export function getPath(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); }
export function applyChanges(object, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (key.includes(".")) setPath(object, key, structuredClone(value));
    else if (value && typeof value === "object" && !Array.isArray(value)) applyChanges(object[key] ??= {}, value);
    else object[key] = structuredClone(value);
  }
}

export function environment() {
  // Contract mock: retain this/arguments and call through previously registered handlers.
  globalThis.libWrapper = {
    registrations: [],
    register(module, target, wrapper, type) {
      const parts = target.split(".");
      const key = parts.pop();
      const object = parts.reduce((value, part) => value[part], globalThis);
      const previous = object[key];
      this.registrations.push({ module, target, type });
      object[key] = function(...args) { return wrapper.call(this, previous.bind(this), ...args); };
    },
  };
  const callbacks = new Map();
  globalThis.Hooks = {
    on: (name, fn) => { if (!callbacks.has(name)) callbacks.set(name, []); callbacks.get(name).push(fn); },
    call: async (name, ...args) => { for (const fn of callbacks.get(name) ?? []) await fn(...args); },
  };
  Hooks.once = Hooks.on;
  const notices = [];
  globalThis.ui = { notifications: { error: (text) => notices.push(text), warn: (text) => notices.push(text), info: (text) => notices.push(text) } };
  const values = new Map(Object.entries({
    revealStyle: "fog", visionRadius: 0.5, scannerRadius: 0,
    revealAudience: "all", pulseAudience: "all", autoPulse: true,
    pulseDuration: 1.4,
    showLabels: true, autoScanner: true, netarchColors: { entries: [] },
  }));
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const player = { id: "player", name: "Netrunner player", isGM: false, active: true };
  const other = { id: "other", name: "Other player", isGM: false, active: true };
  const offline = { id: "offline", name: "Offline owner", isGM: false, active: false };
  globalThis.game = {
    user: gm, users: new Collection([gm, player, other, offline]),
    actors: new Collection(), items: new Collection(), folders: new Collection(), scenes: new Collection(),
    documentTypes: { Actor: ["character", "container", "mook"] },
    settings: { get: (_module, key) => values.get(key.replace(/^scanner([A-Z])/, (_, c) => c.toLowerCase())), set: async (_module, key, value) => values.set(key.replace(/^scanner([A-Z])/, (_, c) => c.toLowerCase()), value), register: () => {} },
    time: { serverTime: 10000 }, system: { id: "cyberpunk-red-core" }, release: { generation: 12 },
  };
  globalThis.foundry = { utils: { randomID: () => "random-id", hasProperty: (object, path) => getPath(object, path) !== undefined, mergeObject: (a, b) => ({ ...a, ...b }) } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, TOKEN_DISPLAY_MODES: { OWNER_HOVER: 20, NONE: 0 } };
  const docs = new Map();
  globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
  globalThis.canvas = { ready: true, scene: null, tokens: { controlled: [], placeables: [], get: (id) => canvas.tokens.placeables.find((token) => token.id === id) }, grid: { size: 100 } };
  globalThis.Actor = {
    updateDocuments: async (updates) => updates.map((changes) => {
      const actor = game.actors.get(changes._id); applyChanges(actor, changes); return actor;
    }),
    createDocuments: async (data) => data.map((entry, index) => {
      const actor = { ...structuredClone(entry), id: `template-${game.actors.size}-${index}`, getFlag(scope, key) { return this.flags?.[scope]?.[key]; } };
      game.actors.set(actor.id, actor); return actor;
    }),
  };
  globalThis.Folder = { create: async (data) => {
    const folder = { ...data, id: "folder", getFlag(scope, key) { return this.flags?.[scope]?.[key]; } };
    game.folders.set(folder.id, folder); return folder;
  } };
  return { gm, player, other, offline, values, notices, docs };
}

export function makeScene(id = "scene") {
  const scene = {
    id, name: "Test Scene", documentName: "Scene", grid: { size: 100, distance: 2, units: "m", measurePath([a,b]) { return { distance: Math.hypot(b.x-a.x,b.y-a.y)*this.distance/this.size }; } }, tokens: new Collection(),
    updates: [], async updateEmbeddedDocuments(type, updates) {
      if (type !== "Token") throw new Error("Unexpected document type");
      this.updates.push(structuredClone(updates));
      return Promise.all(updates.map((changes) => this.tokens.get(changes._id).update(changes)));
    },
  };
  game.scenes.set(id, scene); canvas.scene = scene;
  return scene;
}

export function makeToken(scene, id = "ap", { ap = true, owners = ["player"], ...extra } = {}) {
  const actor = { id: `actor-${id}`, type: ap ? "container" : "character", name: id, items: new Collection(), testUserPermission: (user) => user.isGM || owners.includes(user.id) };
  if (!ap) actor.items.set("netrunner-role", { id: "netrunner-role", type: "role", name: "Netrunner" });
  const doc = {
    id, uuid: `Scene.${scene.id}.Token.${id}`, parent: scene, documentName: "Token", name: id,
    actor, actorId: actor.id, actorLink: false, hidden: true, x: 0, y: 0, width: 0.5, height: 0.5,
    texture: { src: `modules/${MODULE_ID}/assets/scanner/computer.svg`, scaleX: 1, scaleY: 1 },
    flags: ap ? { [MODULE_ID]: freshAP() } : {},
    updateSource(changes) { applyChanges(this, changes); },
    async update(changes) { await Hooks.call("preUpdateToken", this, changes); applyChanges(this, changes); await Hooks.call("updateToken", this, changes); return this; },
    ...extra,
  };
  scene.tokens.set(id, doc); game.actors.set(actor.id, actor);
  const token = { id, document: doc, actor, center: { x: doc.x + doc.width * 50, y: doc.y + doc.height * 50 }, w: doc.width * 100, h: doc.height * 100 };
  canvas.tokens.placeables.push(token);
  return doc;
}
