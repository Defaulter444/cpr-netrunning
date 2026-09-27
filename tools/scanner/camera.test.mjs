import test from "node:test";
import assert from "node:assert/strict";
import { cameraConfig, cameraController, cameraSourceData, validateCameraInput } from "../../scripts/scanner/camera-rules.js";
import { CameraVision } from "../../scripts/scanner/camera-vision.js";
import { environment, Collection } from "./helpers.mjs";

function fixture() {
  const doc = { id: "cam", x: 100, y: 200, width: 0.5, height: 0.5, rotation: 270, flags: { "cpr-netrunning": {
    accessPoint: true, type: "camera", netarch: "CRNS.NetArch.a",
    camera: { enabled: true, online: true, floorId: "f", range: 20, angle: 90, nightVision: false },
  } } };
  const runner = { kind: "runner", userId: "p", actorUuid: "Actor.runner", jackedIn: true, archId: "a" };
  const context = { user: { id: "p", isGM: false }, archs: { a: { floors: [{ id: "f", kind: "controlnode" }] } },
    session: { participants: { r: runner }, floorState: { "a:f": { control: { pid: "r" } } } } };
  return { doc, runner, context };
}

test("control grants a camera to its runner, not other users or a public discovery", () => {
  const {doc, runner, context}=fixture();
  assert.equal(cameraController(doc, context), runner);
  doc.flags["cpr-netrunning"].discovery={revealed:true,public:true};
  assert.equal(cameraController(doc,{...context,user:{id:"other"}}), null);
  delete context.session.floorState["a:f"].control;
  assert.equal(cameraController(doc,context), null);
});

test("release, disconnect, handover, missing node, and power loss revoke camera access", () => {
  for (const edit of [
    ({runner})=>runner.jackedIn=false,
    ({runner})=>runner.archId="b",
    ({runner})=>runner.kind="spectator",
    ({context})=>context.session.floorState["a:f"].control={pid:"missing"},
    ({context})=>context.archs.a.floors=[],
    ({context})=>context.archs.a.floors[0].kind="password",
    ({doc})=>doc.flags["cpr-netrunning"].camera.online=false,
    ({doc})=>doc.flags["cpr-netrunning"].camera.enabled=false,
    ({doc})=>doc.flags["cpr-netrunning"].camera.range=NaN,
  ]) { const f=fixture(); edit(f); assert.equal(cameraController(f.doc,f.context),null); }
});

test("GM preview follows the selected controller, never another character's access", () => {
  const {doc,runner,context}=fixture(); context.user={isGM:true};
  assert.equal(cameraController(doc,context),null);
  assert.equal(cameraController(doc,{...context,selectedActors:["Actor.other"]}),null);
  assert.equal(cameraController(doc,{...context,selectedActors:[runner.actorUuid]}),runner);
});

test("actor ownership fallback applies only to unassigned runners", () => {
  const {doc,runner,context}=fixture(); context.user={id:"other"}; context.ownsActor=()=>true;
  assert.equal(cameraController(doc,context),null);
  runner.userId=""; assert.equal(cameraController(doc,context),runner);
  context.ownsActor=()=>false; assert.equal(cameraController(doc,context),null);
});

test("camera optics limit illuminated and night vision, use scene scale, never save fog", () => {
  const {doc}=fixture(); const config=cameraConfig(doc);
  const data=cameraSourceData(doc,config,{size:100,distance:2,maxR:5000});
  assert.equal(data.x,125); assert.equal(data.y,225);
  assert.equal(data.radius,0); assert.equal(data.lightRadius,1000);
  assert.equal(data.angle,90); assert.equal(data.rotation,270); assert.equal(data.externalRadius,0);
  assert.equal(data.preview,true);
  config.nightVision=true; assert.equal(cameraSourceData(doc,config,{size:100,distance:2,maxR:500}).radius,500);
});

test("configuration rejects missing nodes, native architecture links and invalid optics", () => {
  const {context}=fixture(); const data={cameraEnabled:true,cameraOnline:true,cameraFloor:"f",cameraRange:20,cameraAngle:90,cameraRotation:270,netarch:"CRNS.NetArch.a"};
  assert.equal(validateCameraInput(data,context.archs).config.floorId,"f");
  for(const change of [{netarch:"Item.arch"},{cameraFloor:"x"},{cameraRange:0},{cameraRange:10001},{cameraAngle:0},{cameraAngle:361},{cameraRotation:360}]) {
    assert.throws(()=>validateCameraInput({...data,...change},context.archs));
  }
  assert.doesNotThrow(()=>validateCameraInput({...data,cameraEnabled:false,netarch:""},{}));
});

test("camera source lifecycle never changes actor ownership or real token sight", () => {
  const {values}=environment(); const {doc,context}=fixture();
  values.set("netArchs",context.archs); values.set("session",context.session); game.user=context.user;
  const token={id:doc.id,document:doc}; doc.sight={enabled:false}; doc.hidden=true;
  canvas.tokens.placeables=[token]; canvas.scene={tokenVision:true}; canvas.dimensions={size:100,distance:2,maxR:5000};
  canvas.effects={visionSources:new Collection()};
  globalThis.CONFIG={Canvas:{visionSourceClass:class {
    constructor({sourceId}) {this.sourceId=sourceId;}
    initialize(data){this.data=data;}
    add(){canvas.effects.visionSources.set(this.sourceId,this);}
    destroy(){canvas.effects.visionSources.delete(this.sourceId);}
  }}};
  const saved=structuredClone(doc); const vision=new CameraVision();
  vision.refresh(); assert.equal(vision.sources.size,1);
  const source=[...vision.sources.values()][0].source;
  assert.equal(source.object.document.detectionModes[1].range,20);
  assert.equal(source.object.getLightRadius(20),1000);
  assert.deepEqual(doc,saved);
  context.session.participants.r.jackedIn=false;
  vision.refresh(); assert.equal(vision.sources.size,0); assert.equal(canvas.effects.visionSources.size,0);
  context.session.participants.r.jackedIn=true;
  vision.refresh(); assert.equal(vision.sources.size,1);
  vision.destroy(); assert.equal(canvas.effects.visionSources.size,0);
});
