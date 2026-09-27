import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/scanner/constants.js";
import { apData } from "../../scripts/scanner/model.js";
import { updateActivePulseSpeed, applyAPControls, audienceFor, colorFor, hideAPs, pulseAPs, revealAPs, saveAP, stopPulses } from "../../scripts/scanner/actions.js";
import { environment, makeScene, makeToken } from "./helpers.mjs";

test("private reveal resolves all player owners, including offline owners", async () => {
  environment(); const scene = makeScene();
  const runner = makeToken(scene, "runner", { ap: false, owners: ["player", "offline"] });
  const ap = makeToken(scene);
  await revealAPs([ap], { runner, audience: "runner", pulseAudience: "all" });
  assert.deepEqual(apData(ap).discovery.users, ["player", "offline"]);
  assert.equal(apData(ap).discovery.public, false);
  assert.equal(ap.hidden, true);
  assert.equal(apData(ap).pulse.audience.public, true);
});
test("a missing private recipient aborts before any document update", async () => {
  environment(); const scene = makeScene(), ap = makeToken(scene);
  await assert.rejects(revealAPs([ap], { audience: "runner" }), /Выберите токен нетраннера/);
  await assert.rejects(revealAPs([ap], { audience: "all", pulseAudience: "runner" }), /Выберите токен нетраннера/);
  assert.equal(scene.updates.length, 0);
  assert.equal(apData(ap).discovery.revealed, false);
});
test("private recipients must own the selected runner", () => {
  environment(); const scene = makeScene();
  const runner = makeToken(scene, "runner", { ap: false, owners: [] });
  assert.throws(() => audienceFor("runner", runner), /нет владельца-игрока/);
  assert.throws(() => audienceFor("bogus", runner), /кому показать/);
});
test("players cannot mutate AP state through the public API", async () => {
  const { player } = environment(); const scene = makeScene(), ap = makeToken(scene);
  game.user = player;
  for (const operation of [revealAPs, hideAPs, pulseAPs, stopPulses]) await assert.rejects(operation([ap]), /только мастер/);
  await assert.rejects(saveAP(ap, { name: "x" }), /только мастер/);
  assert.equal(scene.updates.length, 0);
});
test("hide resets every audience and stops continuous pulses", async () => {
  environment();
  const scene = makeScene(), ap = makeToken(scene);
  await applyAPControls([ap], { reveal: "all", pulse: "loop" });
  assert.equal(apData(ap).pulse.loop, true);
  await hideAPs([ap]);
  assert.deepEqual(apData(ap).discovery.users, []);
  assert.equal(apData(ap).discovery.public, false);
  assert.equal(apData(ap).pulse, null);
});
test("pulsing skips undiscovered points and stopping does not hide discoveries", async () => {
  environment(); const scene = makeScene(), a = makeToken(scene, "a"), b = makeToken(scene, "b");
  await assert.rejects(pulseAPs([a, b]), /Сначала покажите/);
  await revealAPs([a], { pulse: false });
  await pulseAPs([a, b]);
  assert.notEqual(apData(a).pulse, null);
  assert.equal(apData(b).pulse, null);
  await stopPulses([a]);
  assert.equal(apData(a).discovery.revealed, true);
  assert.equal(apData(a).pulse, null);
});
test("batch updates stay within each AP's actual scene", async () => {
  environment(); const sceneA = makeScene("A"), a = makeToken(sceneA, "a"), sceneB = makeScene("B"), b = makeToken(sceneB, "b");
  await revealAPs([a, b, a], { pulse: false });
  assert.equal(sceneA.updates[0].length, 1);
  assert.equal(sceneB.updates[0].length, 1);
});
test("editing type changes built-in artwork and leaves other APs alone", async () => {
  environment(); const scene = makeScene(), a = makeToken(scene, "a"), b = makeToken(scene, "b");
  await saveAP(a, { name: "Lobby camera", type: "camera", netarch: "" });
  assert.equal(a.name, "Lobby camera");
  assert.ok(a.texture.src.endsWith("camera.svg"));
  assert.equal(apData(b).type, "computer");
  assert.equal(b.name, "b");
});
test("changing type preserves custom token artwork", async () => {
  environment(); const scene = makeScene(), ap = makeToken(scene);
  ap.texture.src = "custom/camera.webp";
  await saveAP(ap, { name: "Камера", type: "camera", netarch: "" });
  assert.equal(ap.texture.src, "custom/camera.webp");
});
test("NET Architecture assignment shares a color without changing Item permissions", async () => {
  const { docs } = environment(); const scene = makeScene(), ap = makeToken(scene);
  const item = { uuid: "Item.arch", documentName: "Item", type: "netarch", ownership: { default: 0 } }; docs.set(item.uuid, item);
  await saveAP(ap, { name: "Terminal", type: "computer", netarch: item.uuid, color: "#ff1122" });
  assert.equal(apData(ap).netarch, "Item.arch");
  assert.equal(colorFor("Item.arch"), "#ff1122");
  assert.deepEqual(item.ownership, { default: 0 });
});
test("invalid names, types, and Architecture references do not update APs", async () => {
  environment(); const scene = makeScene(), ap = makeToken(scene);
  for (const data of [
    { name: " ", type: "computer" }, { name: "x", type: "nonsense" },
    { name: "x", type: "computer", netarch: "Item.missing", color: "#000000" },
  ]) await assert.rejects(saveAP(ap, data));
  assert.equal(ap.name, "ap");
  assert.equal(ap.flags[MODULE_ID].netarch, "");
});

test("speed changes retime active pulses without restarting their count or reviving expired pulses", async () => {
  environment(); const scene = makeScene();
  const finite = makeToken(scene, "finite"), loop = makeToken(scene, "loop"), expired = makeToken(scene, "expired");
  await revealAPs([finite, loop, expired], { pulse: false });
  for (const doc of [finite, loop, expired]) apData(doc).pulse = { started: 7000, duration: 1000, count: 5, loop: false, audience: { public: true }, id: doc.id };
  apData(loop).pulse.loop = true;
  apData(expired).pulse.started = 0;
  await updateActivePulseSpeed(0.5);
  assert.equal(apData(finite).pulse.duration, 500);
  assert.equal(apData(finite).pulse.started, 8500);
  assert.equal(apData(finite).pulse.count, 5);
  assert.equal(apData(loop).pulse.loop, true);
  assert.equal(apData(loop).pulse.duration, 500);
  assert.equal(apData(expired).pulse.duration, 1000);
  game.time.serverTime = 11000;
  await updateActivePulseSpeed(2);
  assert.equal(apData(finite).pulse.duration, 500);
  assert.equal(apData(loop).pulse.duration, 2000);
});