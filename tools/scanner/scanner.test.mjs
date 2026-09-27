import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/scanner/constants.js";
import { registerScannerHooks, resolveScan, wrapRollCards } from "../../scripts/scanner/scanner.js";
import { environment, makeScene, makeToken, setPath } from "./helpers.mjs";

test("native Scanner roll cards keep their result and receive context after creation", async () => {
  environment(); makeScene(); let created = false;
  const flags = {};
  const message = { async setFlag(scope, key, data) { assert.equal(created, true); setPath(flags, `${scope}.${key}`, data); } };
  const chat = { marker: 5, RenderRollCard(roll) { assert.equal(this.marker, 5); assert.equal(roll.resultTotal, 14); created = true; return Promise.resolve(message); } };
  wrapRollCards(chat);
  const result = await chat.RenderRollCard({ ability: "scanner", resultTotal: 14, entityData: { actor: "actor", token: "runner" } });
  assert.equal(result, message);
  assert.deepEqual(flags[MODULE_ID].scan, { actorId: "actor", tokenId: "runner", sceneId: "scene", total: 14 });
});
test("non-Scanner rolls return the original object unchanged", () => {
  environment(); makeScene(); const originalResult = Promise.resolve("native");
  const chat = { RenderRollCard: () => originalResult };
  wrapRollCards(chat);
  assert.equal(chat.RenderRollCard({ ability: "backdoor" }), originalResult);
});
test("wrapping twice never duplicates Scanner updates", async () => {
  environment(); makeScene(); let flags = 0;
  const chat = { RenderRollCard: async () => ({ setFlag: async () => { flags++; } }) };
  wrapRollCards(chat); wrapRollCards(chat);
  await chat.RenderRollCard({ ability: "scanner", resultTotal: 9, entityData: { actor: "actor" } });
  assert.equal(flags, 1);
});
test("a rejected metadata update never rejects a completed system roll", async () => {
  const { notices } = environment(); makeScene();
  const message = { setFlag: async () => { throw new Error("permission denied"); } };
  const chat = { RenderRollCard: async () => message }; wrapRollCards(chat);
  const oldError = console.error; console.error = () => {};
  try {
    assert.equal(await chat.RenderRollCard({ ability: "scanner", resultTotal: 9, entityData: { actor: "actor" } }), message);
    assert.equal(notices.length, 1);
  } finally { console.error = oldError; }
});
test("a missing native message does not manufacture a discovery", async () => {
  environment(); makeScene(); const chat = { RenderRollCard: async () => null }; wrapRollCards(chat);
  assert.equal(await chat.RenderRollCard({ ability: "scanner", resultTotal: 9, entityData: { actor: "actor" } }), null);
});
test("two tokens of the same Actor require an explicit origin choice", () => {
  environment(); const scene = makeScene();
  const a = makeToken(scene, "a", { ap: false }), b = makeToken(scene, "b", { ap: false }); b.actorId = a.actorId;
  const scan = { actorId: a.actorId, tokenId: null, sceneId: scene.id, total: 14 };
  const message = { getFlag: () => scan };
  assert.equal(resolveScan(message).runnerId, "");
  scan.tokenId = b.id;
  assert.equal(resolveScan(message).runnerId, "b");
  scan.sceneId = "deleted";
  assert.equal(resolveScan(message), null);
});
test("only the primary GM opens each new Scanner result once", async () => {
  const { player } = environment(); const scene = makeScene(); const runner = makeToken(scene, "runner", { ap: false });
  const scan = { actorId: runner.actorId, tokenId: runner.id, sceneId: scene.id, total: 14 };
  const message = { id: "message", getFlag: () => scan };
  let opened = 0; registerScannerHooks(() => { opened++; });
  const changes = { flags: { [MODULE_ID]: { scan } } };
  game.user = player; await Hooks.call("updateChatMessage", message, changes); assert.equal(opened, 0);
  game.user = game.users.get("gm");
  await Hooks.call("updateChatMessage", message, changes);
  await Hooks.call("updateChatMessage", message, changes);
  assert.equal(opened, 1);
});

test("Scanner context includes its original chat message", () => {
  environment(); const scene=makeScene(), runner=makeToken(scene,"runner",{ap:false});
  const message={id:"native-scanner",getFlag:()=>({actorId:runner.actorId,tokenId:runner.id,sceneId:scene.id,total:14})};
  assert.equal(resolveScan(message).messageId,"native-scanner");
});

test("roll-card integration registers an always-chained libWrapper wrapper", async () => {
  environment(); makeScene(); let called = 0;
  const chat = { RenderRollCard() { called++; return "normal-card"; } };
  wrapRollCards(chat); wrapRollCards(chat);
  assert.equal(libWrapper.registrations.length, 1);
  assert.equal(libWrapper.registrations[0].type, "WRAPPER");
  assert.equal(chat.RenderRollCard({}), "normal-card");
  assert.equal(called, 1);
});
