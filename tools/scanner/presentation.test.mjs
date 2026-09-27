import test from "node:test";
import assert from "node:assert/strict";
import { APPresentation } from "../../scripts/scanner/presentation.js";
import { apData } from "../../scripts/scanner/model.js";
import { canReadAPName } from "../../scripts/scanner/name-visibility.js";
import { environment, makeScene, makeToken } from "./helpers.mjs";

function renderingEnvironment() {
  const env = environment(); makeScene();
  const tickers = new Set();
  class Display {
    constructor(texture) { this.children = []; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; this.anchor = { set: () => {} }; this.texture = texture; this.visible = true; this.lines = []; }
    addChild(child) { this.children.push(child); return child; }
    clear() { this.lines = []; return this; }
    lineStyle(...args) { this.lines.push(args); return this; }
    drawCircle(...args) { this.circle = args; return this; }
    drawRoundedRect() { return this; }
    destroy() { this.destroyed = true; for (const child of this.children) child.destroy(); }
  }
  class Text extends Display { constructor(text, style) { super(); this.text = text; this.style = style; } }
  globalThis.PIXI = { Container: Display, Graphics: Display, Sprite: Display, Text, Texture: { EMPTY: {} } };
  globalThis.loadTexture = async (path) => ({ path });
  canvas.interface = new Display();
  const sight = { active: true, isBlinded: false, x: 0, y: 0, seesPoint: true,
    object: { document: { detectionModes: [{ id: "basicSight", enabled: true, range: 60 }] } } };
  canvas.effects = { lightSources: new Map(), visionSources: new Map([["runner", sight]]) };
  canvas.dimensions = { sceneRect: { contains: (x,y) => x >= 0 && y >= 0 && x < 1000 && y < 1000 } };
  canvas.scene.tokenVision = true;
  canvas.app = { ticker: { add: (fn) => tickers.add(fn), remove: (fn) => tickers.delete(fn) } };
  canvas.perception = { update: () => {} };
  globalThis.CONFIG = { Canvas: { detectionModes: {
    basicSight: { testVisibility: (source, mode, config) => {
      assert.equal(config.object, null); // AP helper tokens stay hidden; test their position.
      assert.ok(config.tests[0].los instanceof Map);
      return mode.enabled && source.seesPoint;
    } },
  }, lightSourceClass: class {
    constructor({ sourceId }) { this.sourceId = sourceId; }
    initialize(data) { this.data = data; return this; }
    add() { canvas.effects.lightSources.set(this.sourceId, this); }
    destroy() { this.destroyed = true; canvas.effects.lightSources.delete(this.sourceId); }
  } } };
  return { ...env, tickers, sight };
}

test("private circles create only local permitted light sources with the correct radius", () => {
  const { values, player, other } = renderingEnvironment(); values.set("revealStyle", "vision");
  const ap = makeToken(canvas.scene);
  apData(ap).discovery = { revealed: true, public: false, users: [player.id] };
  const display = new APPresentation();
  game.user = other; display.initializeLights(); assert.equal(canvas.effects.lightSources.size, 0);
  game.user = player; display.initializeLights(); assert.equal(canvas.effects.lightSources.size, 1);
  const source = [...display.lights.values()][0];
  assert.equal(source.data.radius, 25); // 0.5 m, 2 m grid, 100 px square.
  assert.equal(source.data.vision, true);
  assert.equal(source.data.walls, true);
  assert.equal(canvas.scene.updates.length, 0);
  game.user = other; display.initializeLights(); assert.equal(canvas.effects.lightSources.size, 0);
  assert.equal(source.destroyed, true);
});
test("switching to above-fog mode destroys circle sources", () => {
  const { values } = renderingEnvironment(); values.set("revealStyle", "vision");
  const ap = makeToken(canvas.scene); apData(ap).discovery = { revealed: true, public: true };
  const display = new APPresentation(); display.initializeLights();
  assert.equal(display.lights.size, 1);
  values.set("revealStyle", "fog"); display.initializeLights(); assert.equal(display.lights.size, 0);
});
test("unknown or invalid vision radius never produces an unbounded light", () => {
  const { values } = renderingEnvironment(); values.set("revealStyle", "vision");
  const ap = makeToken(canvas.scene); apData(ap).discovery = { revealed: true, public: true };
  const display = new APPresentation();
  for (const radius of [-1, 0, Infinity, NaN]) { values.set("visionRadius", radius); display.initializeLights(); assert.equal(display.lights.size, 0); }
});
test("private artwork never gets created for an unrelated player", async () => {
  const { player, other } = renderingEnvironment(); const ap = makeToken(canvas.scene);
  apData(ap).discovery = { revealed: true, public: false, users: [player.id] };
  const display = new APPresentation();
  game.user = other; await display.refresh(); assert.equal(display.entries.size, 0);
  game.user = player; await display.refresh(); await Promise.resolve(); assert.equal(display.entries.size, 1);
  const entry = display.entries.get(ap.id);
  assert.equal(entry.sprite.visible, true);
  assert.equal(entry.sprite.width, 50);
  assert.ok(entry.sprite.texture.path.endsWith("/generic.svg"));
});
test("hiding an AP removes both its art and vision source", async () => {
  const { player, values } = renderingEnvironment(); values.set("revealStyle", "vision");
  const ap = makeToken(canvas.scene); apData(ap).discovery = { revealed: true, public: true };
  game.user = player;
  const display = new APPresentation(); await display.refresh(); display.initializeLights();
  const entry = display.entries.get(ap.id); apData(ap).discovery.revealed = false;
  display.tick(); assert.equal(entry.group.visible, false);
  await display.refresh(); display.initializeLights();
  assert.equal(display.entries.size, 0); assert.equal(display.lights.size, 0);
});
test("late texture loads cannot revive a deleted or concealed AP", async () => {
  const { player } = renderingEnvironment(); const ap = makeToken(canvas.scene);
  apData(ap).discovery = { revealed: true, public: true }; game.user = player;
  let finish; globalThis.loadTexture = () => new Promise((resolve) => { finish = resolve; });
  const display = new APPresentation(); await display.refresh();
  apData(ap).discovery.revealed = false; await display.refresh();
  finish({ path: "old" }); await Promise.resolve();
  assert.equal(display.entries.size, 0);
});
test("scene teardown removes ticker callbacks and all local sources", async () => {
  const { values, tickers } = renderingEnvironment(); values.set("revealStyle", "vision");
  const ap = makeToken(canvas.scene); apData(ap).discovery = { revealed: true, public: true };
  const display = new APPresentation(); await display.refresh(); display.initializeLights();
  assert.equal(tickers.size, 1); display.destroy();
  assert.equal(tickers.size, 0); assert.equal(display.entries.size, 0); assert.equal(display.lights.size, 0);
});

test("GM AP artwork uses full color opacity without unhiding the token", async () => {
  const {values}=renderingEnvironment();
  const ap=makeToken(canvas.scene); apData(ap).netarch="Item.red";
  values.set("netarchColors",{entries:[{uuid:"Item.red",color:"#ff0000"}]});
  const token=canvas.tokens.get(ap.id); token.mesh={alpha:0.5,tint:0xffffff};
  const display=new APPresentation(); await display.refresh();
  assert.equal(token.mesh.alpha,1); assert.equal(token.mesh.tint,0xff0000);
  assert.equal(ap.hidden,true); assert.equal(apData(ap).discovery.revealed,false);
  assert.equal(canvas.scene.updates.length,0);
  display.destroy();
});

test("hidden AP names use generic artwork and revealing names restores actual token art", async () => {
  const { player } = renderingEnvironment();
  const ap = makeToken(canvas.scene);
  ap.texture.src = "custom/turret.webp";
  apData(ap).discovery = { revealed: true, public: true };
  game.user = player;
  const display = new APPresentation();
  await display.refresh();
  const entry = display.entries.get(ap.id);
  assert.ok(entry.sprite.texture.path.endsWith("/generic.svg"));
  assert.equal(entry.label.visible, false);
  apData(ap).showName = true;
  await display.refresh();
  assert.equal(entry.sprite.texture.path, "custom/turret.webp");
  assert.equal(entry.label.visible, true);
  apData(ap).showName = false;
  await display.refresh();
  assert.ok(entry.sprite.texture.path.endsWith("/generic.svg"));
  assert.equal(ap.texture.src, "custom/turret.webp");
});

test("revealed AP names follow live sight across fog, movement and door changes; icons remain", async () => {
  const { player, sight } = renderingEnvironment();
  const ap = makeToken(canvas.scene); ap.name = "Секретный терминал";
  Object.assign(apData(ap), {showName:true, discovery:{revealed:true, public:true}});
  game.user = player;
  const display = new APPresentation(); display.registerHooks();
  sight.seesPoint = false;
  // Explored fog and a generic visibility shortcut must not grant name disclosure.
  canvas.fog = { explored: true }; canvas.visibility = { testVisibility: () => true };
  await display.refresh();
  const entry = display.entries.get(ap.id);
  assert.equal(entry.group.visible, true); assert.equal(entry.sprite.visible, true);
  assert.equal(entry.label.visible, false); assert.equal(entry.label.text, "");
  sight.seesPoint = true; await Hooks.call("sightRefresh");
  assert.equal(entry.label.visible, true); assert.equal(entry.label.text, ap.name);
  sight.seesPoint = false; await Hooks.call("visibilityRefresh");
  assert.equal(entry.label.visible, false); assert.equal(entry.label.text, "");
  assert.equal(entry.sprite.visible, true);
  sight.seesPoint = true; await Hooks.call("sightRefresh");
  apData(ap).showName = false; await display.refresh();
  assert.equal(entry.label.visible, false);
  display.destroy();
});

test("scanner vision circles and pulses do not grant names without an active unblinded viewer", async () => {
  const { player, sight, values } = renderingEnvironment();
  values.set("revealStyle", "vision");
  const ap = makeToken(canvas.scene);
  Object.assign(apData(ap), {showName:true, discovery:{revealed:true, public:true},
    pulse:{started:9000,duration:1400,count:5,loop:true,audience:{public:true}}});
  game.user = player;
  const display = new APPresentation();
  sight.active = false;
  display.initializeLights(); await display.refresh();
  const entry = display.entries.get(ap.id);
  assert.equal(display.lights.size, 1);
  assert.equal(entry.label.visible, false); assert.ok(entry.pulse.lines.length > 0);
  sight.active = true; sight.isBlinded = true; display.refreshNames();
  assert.equal(entry.label.visible, false);
  canvas.effects.visionSources.clear(); display.refreshNames();
  assert.equal(entry.label.visible, false);
  display.destroy();
});

test("GM labels and scenes without token vision remain usable without leaking undiscovered APs", async () => {
  const { player, other } = renderingEnvironment();
  const ap = makeToken(canvas.scene);
  canvas.effects.visionSources.clear();
  const display = new APPresentation(); await display.refresh();
  assert.equal(display.entries.get(ap.id).label.visible, true);
  Object.assign(apData(ap), {showName:true, discovery:{revealed:true, public:false,users:[player.id]}});
  game.user = player; canvas.scene.tokenVision = false; await display.refresh();
  assert.equal(display.entries.get(ap.id).label.visible, true);
  game.user = other; await display.refresh(); assert.equal(display.entries.size, 0);
  display.destroy();
});

test("GM viewing a selected character cannot read undiscovered AP names; deselection restores overview", async () => {
  const { sight } = renderingEnvironment();
  const ap = makeToken(canvas.scene); apData(ap).showName = true;
  const runner = makeToken(canvas.scene, "runner", {ap:false});
  const viewer = canvas.tokens.get(runner.id), token = canvas.tokens.get(ap.id);
  sight.object.id = viewer.id;
  token.nameplate = {visible:true};
  canvas.tokens.controlled = [viewer];
  const display = new APPresentation(); display.registerHooks(); await display.refresh();
  const entry = display.entries.get(ap.id);
  assert.equal(entry.label.visible, false); assert.equal(entry.label.text, "");
  assert.equal(token.nameplate.visible, false);
  apData(ap).discovery = {revealed:true,public:true}; await display.refresh();
  assert.equal(entry.label.visible, true);
  sight.seesPoint = false; await Hooks.call("sightRefresh");
  assert.equal(entry.label.visible, false);
  canvas.tokens.controlled = []; await Hooks.call("controlToken");
  assert.equal(entry.label.visible, true);
  canvas.tokens.controlled = [viewer]; await Hooks.call("controlToken");
  assert.equal(entry.label.visible, false);
  canvas.tokens.controlled = [token]; await Hooks.call("controlToken");
  assert.equal(entry.label.visible, true); // Selecting an AP is map administration.
  display.destroy();
});

test("GM character preview requires explicit discovery for that token, even with the same player owner", () => {
  const { sight, player } = renderingEnvironment();
  const ap = makeToken(canvas.scene); apData(ap).showName = true;
  const first = makeToken(canvas.scene, "first", {ap:false});
  const second = makeToken(canvas.scene, "second", {ap:false});
  sight.object.id = second.id;
  canvas.tokens.controlled = [canvas.tokens.get(second.id)];
  apData(ap).discovery = {revealed:true, public:false, users:[player.id], runners:[first.uuid]};
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), false);
  apData(ap).discovery.runners.push(second.uuid);
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), true);
  apData(ap).showName = false;
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), false);
});

test("multiple GM-selected characters cannot combine one character's discovery with another's sight", () => {
  const { sight } = renderingEnvironment();
  const ap = makeToken(canvas.scene); apData(ap).showName = true;
  const informed = makeToken(canvas.scene, "informed", {ap:false});
  const seeing = makeToken(canvas.scene, "seeing", {ap:false});
  apData(ap).discovery = {revealed:true,public:false,runners:[informed.uuid]};
  canvas.tokens.controlled = [canvas.tokens.get(informed.id),canvas.tokens.get(seeing.id)];
  sight.object.id = seeing.id;
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), false);
  sight.object.id = informed.id;
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), true);
  sight.active = false;
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), false);
});

test("legacy user-only discovery supports real owners but GM ownership alone never reveals names", () => {
  const { sight, player, gm } = renderingEnvironment();
  const ap = makeToken(canvas.scene); apData(ap).showName = true;
  const runner = makeToken(canvas.scene, "runner", {ap:false});
  canvas.tokens.controlled = [canvas.tokens.get(runner.id)]; sight.object.id = runner.id;
  apData(ap).discovery = {revealed:true,public:false,users:[gm.id]};
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), false);
  apData(ap).discovery.users = [player.id];
  assert.equal(canReadAPName(canvas.tokens.get(ap.id)), true);
});
