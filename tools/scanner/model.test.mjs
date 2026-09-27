import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/scanner/constants.js";
import { architectureColor, blankDiscovery, canSeeAP, canSeePulse, freshAP, mergeDiscovery, pulseProgress, sceneDistance, validateRadius, withinRadius } from "../../scripts/scanner/model.js";

const gm = { id: "gm", isGM: true };
const runner = { id: "runner", isGM: false };
const other = { id: "other", isGM: false };
const ap = (data = {}) => ({ flags: { [MODULE_ID]: { ...freshAP(), ...data } } });

test("new APs are independent and concealed", () => {
  const a = freshAP("camera"), b = freshAP("camera");
  a.discovery.users.push("runner");
  assert.deepEqual(b.discovery.users, []);
  assert.equal(canSeeAP(ap(), runner), false);
  assert.equal(canSeeAP(ap(), gm), true);
  assert.equal(canSeeAP({ flags: {} }, gm), false);
});
test("private discovery excludes unrelated players even with all-player pulses", () => {
  const doc = ap({ discovery: { revealed: true, public: false, users: ["runner"] }, pulse: { started: 0, duration: 1000, count: 3, audience: { public: true } } });
  assert.equal(canSeeAP(doc, runner), true);
  assert.equal(canSeeAP(doc, other), false);
  assert.equal(canSeePulse(doc, runner, 500), true);
  assert.equal(canSeePulse(doc, other, 500), false);
  assert.equal(canSeePulse(doc, gm, 500), true);
});
test("public AP can have a private pulse", () => {
  const doc = ap({ discovery: { revealed: true, public: true }, pulse: { started: 0, duration: 1000, count: 3, audience: { public: false, users: ["runner"] } } });
  assert.equal(canSeeAP(doc, other), true);
  assert.equal(canSeePulse(doc, other, 500), false);
});
test("hiding an AP suppresses its pulse for everyone including the GM", () => {
  const doc = ap({ pulse: { started: 0, duration: 1000, count: 3, audience: { public: true } } });
  assert.equal(canSeePulse(doc, gm, 500), false);
});
test("discoveries accumulate recipients without losing earlier knowledge", () => {
  const first = mergeDiscovery(blankDiscovery(), { public: false, users: ["runner"] }, "Actor.a");
  const second = mergeDiscovery(first, { public: false, users: ["other"] }, "Actor.b");
  assert.deepEqual(second.users, ["runner", "other"]);
  assert.deepEqual(second.runners, ["Actor.a", "Actor.b"]);
  assert.equal(mergeDiscovery({ ...first, public: true }, { public: false, users: [] }).public, true);
});
test("finite pulses finish exactly at the requested count, including reloads", () => {
  const pulse = { started: 1000, duration: 1000, count: 3, loop: false };
  assert.equal(pulseProgress(pulse, 999), null);
  assert.equal(pulseProgress(pulse, 1000), 0);
  assert.equal(pulseProgress(pulse, 2500), 0.5);
  assert.equal(pulseProgress(pulse, 4000), null);
  assert.equal(pulseProgress(pulse, 9000), null);
  assert.equal(pulseProgress({ ...pulse, loop: true }, 9500), 0.5);
  assert.equal(pulseProgress({ ...pulse, duration: 0 }, 9500), null);
});
test("Architecture colors are stable, shared and allow a valid override", () => {
  assert.equal(architectureColor("Item.arch1"), architectureColor("Item.arch1"));
  assert.equal(architectureColor("Item.arch1", [{ uuid: "Item.arch1", color: "#123abc" }]), "#123abc");
  assert.notEqual(architectureColor("Item.arch1", [{ uuid: "Item.arch1", color: "red;display:none" }]), "red;display:none");
});
test("radius uses centers and scene units, including a 3-4-5 diagonal", () => {
  const a = { x: 0, y: 0, width: 1, height: 1 }, b = { x: 300, y: 400, width: 1, height: 1 };
  const distance = sceneDistance(a, b, { size: 100, distance: 2, measurePath: ([a,b]) => ({ distance: Math.hypot(b.x-a.x,b.y-a.y)*0.02 }) });
  assert.equal(distance, 10);
  assert.equal(withinRadius(distance, 10), true);
  assert.equal(withinRadius(distance, 9.9), false);
  assert.equal(withinRadius(null, 0), true);
  assert.equal(withinRadius(null, 3), false);
  assert.equal(sceneDistance(null, b, { size: 100, distance: 2, measurePath: ([a,b]) => ({ distance: Math.hypot(b.x-a.x,b.y-a.y)*0.02 }) }), null);
});
test("invalid radius values are rejected instead of revealing everything", () => {
  for (const value of ["", null, -1, Infinity, "oops"]) assert.throws(() => validateRadius(value));
  assert.equal(validateRadius("0"), 0);
  assert.equal(validateRadius("0.5"), 0.5);
});

test("scene distance uses the grid result rather than Euclidean distance", () => {
  const a={x:0,y:0,width:1,height:1}, b={x:300,y:400,width:1,height:1};
  const grid={size:100,measurePath(points){assert.deepEqual(points,[{x:50,y:50},{x:350,y:450}]);return {distance:8,euclidean:10};}};
  assert.equal(sceneDistance(a,b,grid),8);
  assert.equal(withinRadius(sceneDistance(a,b,grid),9),true);
  grid.measurePath=()=>({distance:14,euclidean:10});
  assert.equal(sceneDistance(a,b,grid),14);
  assert.equal(withinRadius(sceneDistance(a,b,grid),9),false);
});

test("grid measurement uses native token centers and rejects unavailable measurements", () => {
  const a={object:{center:{x:12,y:18}}},b={object:{center:{x:31,y:49}}};
  const grid={size:100,measurePath(points){assert.deepEqual(points,[a.object.center,b.object.center]);return {distance:6};}};
  assert.equal(sceneDistance(a,b,grid),6);
  assert.equal(sceneDistance(a,b,{size:100}),null);
  assert.equal(sceneDistance(a,b,{size:100,measurePath:()=>({distance:NaN})}),null);
});
