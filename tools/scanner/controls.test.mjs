import test from "node:test";
import assert from "node:assert/strict";
import { environment, makeScene, makeToken } from "./helpers.mjs";
import { applyAPControls } from "../../scripts/scanner/actions.js";
import { apData, canSeePulse } from "../../scripts/scanner/model.js";
import { bulkControls, controlState, controlChange } from "../../scripts/scanner/controls.js";

test("private checkbox replaces public audience without automatic pulse", async () => {
  environment(); const scene = makeScene(), ap = makeToken(scene), runner = makeToken(scene, "runner", { ap: false });
  await applyAPControls([ap], { reveal: "all" });
  await applyAPControls([ap], { reveal: "runner" }, { runner });
  assert.equal(apData(ap).discovery.public, false);
  assert.deepEqual(apData(ap).discovery.users, ["player"]);
  assert.equal(apData(ap).pulse, null);
});
test("five pulses expire and looping replaces finite; hiding stops either", async () => {
  environment(); const ap = makeToken(makeScene());
  await applyAPControls([ap], { reveal: "all", pulse: "five" });
  const pulse = apData(ap).pulse;
  assert.equal(pulse.count, 5); assert.equal(pulse.loop, false);
  assert.equal(controlState(ap, pulse.started).five, true);
  assert.equal(controlState(ap, pulse.started + pulse.duration * 5).five, false);
  await applyAPControls([ap], { pulse: "loop" });
  assert.equal(controlState(ap, 100000).loop, true);
  assert.equal(controlState(ap, 100000).five, false);
  await applyAPControls([ap], { reveal: "hidden" });
  assert.equal(apData(ap).pulse, null); assert.equal(apData(ap).discovery.revealed, false);
});
test("bulk untouched groups preserve pulse and mixed reveal states", async () => {
  environment(); const scene = makeScene(), a = makeToken(scene,"a"), b = makeToken(scene,"b");
  await applyAPControls([a], { reveal: "all", pulse: "loop" });
  const states = bulkControls([a,b], {}, 10000);
  assert.equal(states.find(x=>x.key === "all").mixed, true);
  assert.equal(states.find(x=>x.key === "loop").mixed, true);
  const pulse = structuredClone(apData(a).pulse);
  await applyAPControls([a,b], { reveal: "all" });
  assert.deepEqual(apData(a).pulse, pulse); assert.equal(apData(b).pulse, null);
  assert.equal(await applyAPControls([a,b], {}), 0);
  assert.deepEqual(apData(a).pulse, pulse);
});
test("bulk pulse validation rejects hidden APs before any mutation", async () => {
  environment(); const scene=makeScene(), a=makeToken(scene,"a"), b=makeToken(scene,"b");
  await applyAPControls([a], { reveal: "all" });
  await assert.rejects(applyAPControls([a,b], { pulse: "loop" }), /Сначала откройте/);
  assert.equal(apData(a).pulse, null); assert.equal(apData(b).discovery.revealed, false);
  await assert.rejects(applyAPControls([a,b], { reveal: "runner", pulse: "five" }), /Выберите токен нетраннера/);
  assert.equal(apData(a).discovery.public, true);
});
test("public pulses do not expose private APs and pulse-off preserves discovery", async () => {
  environment(); const scene=makeScene(), ap=makeToken(scene), runner=makeToken(scene,"runner",{ap:false});
  await applyAPControls([ap], { reveal:"runner", pulse:"five" }, {runner});
  assert.equal(canSeePulse(ap, game.users.get("other"), 10000), false);
  const discovery=structuredClone(apData(ap).discovery);
  await applyAPControls([ap], { pulse:"off" });
  assert.deepEqual(apData(ap).discovery, discovery);
});
test("bulk choices are exclusive per group and leave the other group untouched", () => {
  environment(); const ap=makeToken(makeScene());
  const changes={...controlChange("reveal","all",true),...controlChange("pulse","loop",true)};
  assert.deepEqual(bulkControls([ap],changes,10000).map(x=>x.checked),[false,true,false,true,false]);
  assert.deepEqual(controlChange("reveal","all",false),{reveal:"hidden"});
  assert.deepEqual(controlChange("pulse","five",false),{pulse:"off"});
});

test("AP name visibility is independent and bulk name edits preserve discoveries and pulses", async () => {
  environment(); const scene=makeScene(), a=makeToken(scene,"a"), b=makeToken(scene,"b");
  await applyAPControls([a], { reveal:"all", pulse:"loop", showName:true });
  assert.equal(bulkControls([a,b],{},10000).find(x=>x.key==="showName").mixed,true);
  const before=structuredClone(apData(a));
  await applyAPControls([a,b], {showName:false});
  assert.equal(apData(a).showName,false);
  assert.deepEqual(apData(a).discovery,before.discovery);
  assert.deepEqual(apData(a).pulse,before.pulse);
  assert.equal(apData(b).discovery.revealed,false);
  assert.deepEqual(controlChange("showName","showName",true),{showName:true});
});

test("configured pulse counts drive row and bulk labels, effects, and expiration", async () => {
  const { values } = environment();
  const { CONTROL_OPTIONS } = await import("../../scripts/scanner/controls.js");
  const { makePulse } = await import("../../scripts/scanner/actions.js");
  const scene=makeScene(), a=makeToken(scene,"a"), b=makeToken(scene,"b");
  for (const count of [1, 3, 8]) {
    values.set("pulseCount",count);
    const label=`Импульсы: ${count}`;
    assert.equal(CONTROL_OPTIONS.find(option=>option.key==="five").label,label);
    assert.equal(bulkControls([a,b],{},10000).find(option=>option.key==="five").label,label);
    await applyAPControls([a,b],{reveal:"all",pulse:"five"});
    for (const ap of [a,b]) {
      const pulse=apData(ap).pulse;
      assert.equal(pulse.count,count);
      assert.equal(controlState(ap,pulse.started+pulse.duration*count-1).five,true);
      assert.equal(controlState(ap,pulse.started+pulse.duration*count).five,false);
    }
    assert.equal(makePulse({public:true,users:[]}).count,count);
  }
});

test("private reveals accumulate and selected removal preserves other runners and shared owners", async () => {
  environment(); const scene = makeScene();
  const a = makeToken(scene, "a"), b = makeToken(scene, "b");
  const first = makeToken(scene, "first", { ap: false, owners: ["player", "offline"] });
  const second = makeToken(scene, "second", { ap: false, owners: ["other", "offline"] });
  await applyAPControls([a,b], { reveal: "runner", pulse: "loop" }, { runner: first });
  await applyAPControls([a,b], { reveal: "runner" }, { runner: second });
  for (const doc of [a,b]) {
    assert.deepEqual(new Set(apData(doc).discovery.users), new Set(["player", "other", "offline"]));
    assert.equal(controlState(doc, 10000, first.uuid).runner, true);
    assert.equal(controlState(doc, 10000, second.uuid).runner, true);
  }
  const remove = controlChange("reveal", "runner", false);
  await applyAPControls([a,b], remove, { runner: first });
  for (const doc of [a,b]) {
    assert.deepEqual(new Set(apData(doc).discovery.users), new Set(["other", "offline"]));
    assert.deepEqual(apData(doc).discovery.runners, [second.uuid]);
    assert.equal(apData(doc).pulse.loop, true);
  }
  await applyAPControls([a,b], remove, { runner: second });
  for (const doc of [a,b]) {
    assert.equal(apData(doc).discovery.revealed, false);
    assert.equal(apData(doc).pulse, null);
  }
});

test("legacy private discoveries retain their first runner when adding another", async () => {
  environment(); const scene = makeScene(); const ap = makeToken(scene);
  const first = makeToken(scene, "first", { ap: false });
  const second = makeToken(scene, "second", { ap: false, owners: ["other"] });
  apData(ap).discovery = { revealed: true, public: false, users: ["player"], runners: [first.uuid] };
  await applyAPControls([ap], { reveal: "runner" }, { runner: second });
  await applyAPControls([ap], { reveal: "removeRunner" }, { runner: second });
  assert.deepEqual(apData(ap).discovery.users, ["player"]);
  assert.deepEqual(apData(ap).discovery.runners, [first.uuid]);
});
