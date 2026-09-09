import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
let checks = 0, failures = 0;
const expect = (ok, message) => { checks++; if (!ok) { failures++; console.error(`FAIL: ${message}`); } };
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const moduleJson = JSON.parse(read("module.json"));
expect(moduleJson.version === "0.4.0", "module version is not 0.4.0");
for (const m of ["scripts/rules-v04-runtime.js","scripts/request-v04.js","scripts/animations-v04.js"]) expect(moduleJson.esmodules.includes(m), `${m} is not loaded`);
expect(moduleJson.styles.includes("styles/animations-v04.css"), "0.4 animation CSS is not loaded");

const animation = read("scripts/animations-v04.js");
for (const feature of ["motionLevel","prefers-reduced-motion","renderApplication","currentNodeId","v04-decrypted","v04-pip-spent","v04-program-rez","v04-motion-subtle"]) expect(animation.includes(feature), `animation feature missing: ${feature}`);
expect(animation.includes("packet.animate("), "route packet does not use a bounded Web Animations call");
expect(!animation.includes("setInterval("), "animation layer must not run a permanent JS interval");
expect(!/game\.settings\.set\(\s*["']cpr-netrunning["']/.test(animation), "animation layer writes to production namespace");

const css = read("styles/animations-v04.css");
for (const feature of ["v04-motion-off","v04-motion-cinematic","crnsl-v04-flow","crnsl-v04-decrypt","prefers-reduced-motion"]) expect(css.includes(feature), `motion CSS missing: ${feature}`);

const runtime = read("scripts/rules-v04-runtime.js");
for (const feature of ["reserveControlledNodeActivation","rollbackControlledNodeActivation","controlActivations","this._spend(runner, 1)"]) expect(runtime.includes(feature), `Control Node reservation missing: ${feature}`);

const request = read("scripts/request-v04.js");
expect(request.includes('request?.op !== "executeControl"'), "0.4 controller does not intercept Control Node execution");
expect(request.indexOf("reserveControlledNodeActivation") < request.lastIndexOf("executeSceneControl(control)"), "scene control is executed before the NET Action reservation");
expect(request.includes("rollbackControlledNodeActivation"), "failed Foundry Scene update does not refund the reserved activation");
expect(request.includes("cprNetrunningLabControlExecuted"), "successful scene-control event hook missing");

const doc = read("ANIMATION-DESIGN.md");
for (const phrase of ["Foundry VTT v12","Animation follows truth","No fake combat","prefers-reduced-motion","Slide","Black ICE"]) expect(doc.includes(phrase), `animation design note missing: ${phrase}`);

const matrix = read("RULES-MATRIX.md");
expect(matrix.includes("A Control Node can be activated only once per Turn"), "rules matrix lost the Control Node once-per-Turn rule");

for (const file of ["scripts/rules-v04-runtime.js","scripts/request-v04.js","scripts/animations-v04.js"]) {
  const source = read(file);
  expect(!/game\.settings\.set\(\s*["']cpr-netrunning["']/.test(source), `${file} writes to production namespace`);
}

console.log(`Lab 0.4 checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
