import test from "node:test";
import assert from "node:assert/strict";
import { cameraDraft, cameraCenter, directionTo, bindingChanges, saveCameraBinding } from "../../scripts/scanner/camera-setup.js";
import { environment, makeScene, makeToken } from "./helpers.mjs";

function setup() {
  const env = environment(), scene = makeScene();
  const doc = makeToken(scene, "camera");
  doc.name = "Камера входа"; doc.rotation = 270;
  doc.flags["cpr-netrunning"].type = "camera";
  const archs = { a: { floors: [{ id: "n", kind: "controlnode", label: "Камеры" }] } };
  env.values.set("netArchs", archs);
  return { env, doc, scene, archs };
}

test("cursor direction matches Foundry's four cardinal directions and handles the camera centre", () => {
  const origin = {x:50,y:50};
  assert.equal(directionTo(origin,{x:50,y:100}),0);
  assert.equal(directionTo(origin,{x:0,y:50}),90);
  assert.equal(directionTo(origin,{x:50,y:0}),180);
  assert.equal(directionTo(origin,{x:100,y:50}),270);
  assert.equal(directionTo(origin,origin,123),123);
  assert.equal(directionTo(origin,{x:NaN,y:0},123),123);
  assert.deepEqual(cameraCenter({x:100,y:200,width:.5,height:.5},100),{x:125,y:225});
});

test("drafting and aiming do not mutate the existing camera or its discovery state", () => {
  const {doc,archs}=setup(); const before=JSON.stringify(doc.flags);
  const draft=cameraDraft(doc,archs); draft.rotation=30; draft.range=12; draft.floorId="n";
  assert.equal(draft.archId,"a");
  assert.equal(JSON.stringify(doc.flags),before);
  const changes=bindingChanges(doc,draft,archs,true);
  assert.deepEqual(Object.keys(changes).sort(),["name","rotation","flags.cpr-netrunning.netarch","flags.cpr-netrunning.camera"].sort());
  assert.equal(changes["flags.cpr-netrunning.camera"].enabled,true);
  assert.equal(doc.rotation,270);
});

test("existing links are retained; multiple architectures require an explicit choice", () => {
  const {doc,archs}=setup();
  archs.b={floors:[{id:"b",kind:"controlnode"}]};
  assert.equal(cameraDraft(doc,archs).archId,"");
  doc.flags["cpr-netrunning"].netarch="CRNS.NetArch.a";
  doc.flags["cpr-netrunning"].camera={enabled:true,floorId:"n",range:45,angle:135,online:false,nightVision:true};
  const draft=cameraDraft(doc,archs);
  assert.equal(draft.archId,"a"); assert.equal(draft.floorId,"n");
  assert.equal(draft.range,45); assert.equal(draft.online,false); assert.equal(draft.nightVision,true);
});

test("binding rejects player writes, removed or wrong-kind nodes, invalid names and optics", () => {
  const {doc,archs}=setup(), draft={...cameraDraft(doc,archs),floorId:"n"};
  assert.throws(()=>bindingChanges(doc,draft,archs,false),/мастер/);
  for(const patch of [{floorId:"missing"},{range:0},{angle:361},{rotation:NaN},{name:"  "},{name:"x".repeat(121)}]) {
    assert.throws(()=>bindingChanges(doc,{...draft,...patch},archs,true));
  }
  archs.a.floors[0].kind="password";
  assert.throws(()=>bindingChanges(doc,draft,archs,true),/узел/);
});

test("saving one camera preserves disclosures and all other cameras", async () => {
  const {doc,scene,archs}=setup(); const other=makeToken(scene,"other");
  const previous=JSON.stringify(other), discovery=structuredClone(doc.flags["cpr-netrunning"].discovery);
  const draft={...cameraDraft(doc,archs),floorId:"n",range:17};
  await saveCameraBinding(doc,draft);
  assert.equal(doc.flags["cpr-netrunning"].camera.range,17);
  assert.deepEqual(doc.flags["cpr-netrunning"].discovery,discovery);
  assert.equal(JSON.stringify(other),previous);
  scene.tokens.delete(doc.id);
  await assert.rejects(saveCameraBinding(doc,draft),/удалена/);
});
