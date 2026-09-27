import test from "node:test";
import assert from "node:assert/strict";
import { environment, makeScene, makeToken, Collection } from "./helpers.mjs";
import { isNetrunner } from "../../scripts/scanner/runners.js";
import { scannerAvailability } from "../../scripts/scanner/availability.js";
import { suiteArchitectures, resolveArchitecture } from "../../scripts/scanner/architectures.js";
import { saveAP } from "../../scripts/scanner/actions.js";
import { MODULE_ID } from "../../scripts/scanner/constants.js";

test("Russian roles and Babele original names work without a literal English role name", () => {
  environment(); const doc = makeToken(makeScene(), "runner", {ap:false});
  const role = doc.actor.items.get("netrunner-role");
  role.name = "Нетраннер"; assert.equal(isNetrunner(doc),true);
  role.name = "Оператор"; role.flags = {babele:{originalName:"Netrunner"}};
  assert.equal(isNetrunner(doc),true);
  role.flags = {}; doc.actor.system={roleInfo:{activeNetRole:role.id}};
  assert.equal(isNetrunner(doc),true);
  doc.actor.system={}; assert.equal(isNetrunner(doc),false);
});
test("suite architectures link by stable ID; renaming preserves links and deletion is rejected", async () => {
  const {values, player}=environment(); const ap=makeToken(makeScene());
  values.set("netArchs",{lab:{name:"Лаборатория",floors:[{secret:true}]}});
  const [arch]=suiteArchitectures(); assert.equal(arch.uuid,"CRNS.NetArch.lab");
  assert.equal(arch.floors,undefined);
  await saveAP(ap,{name:"Камера",type:"camera",netarch:arch.uuid,color:"#123456"});
  assert.equal(ap.flags[MODULE_ID].netarch,arch.uuid);
  values.get("netArchs").lab.name="Склад";
  assert.equal((await resolveArchitecture(arch.uuid)).name,"Склад");
  delete values.get("netArchs").lab;
  assert.equal(await resolveArchitecture(arch.uuid),null);
  await assert.rejects(saveAP(ap,{name:"x",type:"camera",netarch:"CRNS.NetArch.missing",color:"#123456"}),/существующую/);
  game.user=player; assert.deepEqual(suiteArchitectures(),[]);
});
test("disabled scanner has no hard dependency; enabling requires v12 and libWrapper", () => {
  const {values}=environment(); game.modules=new Collection();
  assert.equal(scannerAvailability(game).active,false);
  values.set("enabled",true); // Mock normalizes scanner-prefixed settings.
  assert.match(scannerAvailability(game).reason,/libWrapper/);
  game.modules.set("lib-wrapper",{active:true});
  assert.equal(scannerAvailability(game).active,true);
  game.modules.set("pneuma-net-arch-scanner",{active:true});
  assert.equal(scannerAvailability(game).active,false);
  game.modules.delete("pneuma-net-arch-scanner"); game.release.generation=13;
  assert.equal(scannerAvailability(game).active,false);
});
test("disabled bootstrap registers no gameplay wrappers or templates and preserves host API", async () => {
  environment();
  game.modules=new Collection([{id:MODULE_ID,api:{existing:true}}]);
  const registrations=[];
  game.settings.register=(_module,key,data)=>registrations.push({key,...data});
  globalThis.Application=class {};
  globalThis.FormApplication=class {};
  await import(`../../scripts/scanner/main.js?disabled=${Date.now()}`);
  await Hooks.call("init"); await Hooks.call("ready");
  assert.equal(registrations.find(s=>s.key==="scannerEnabled").default,false);
  assert.equal(game.modules.get(MODULE_ID).api.existing,true);
  assert.equal(game.modules.get(MODULE_ID).api.scanner.enabled,false);
  assert.equal(game.modules.get(MODULE_ID).api.scanner.reveal,undefined);
  assert.equal(game.actors.size,0);
  assert.equal(libWrapper.registrations.length,0);
  const scene = makeScene();
  const ap = makeToken(scene);
  const before = structuredClone(ap.flags);
  await registrations.find(s=>s.key==="scannerPulseDuration").onChange(2);
  assert.deepEqual(ap.flags,before);
  assert.equal(scene.updates.length,0);
});
