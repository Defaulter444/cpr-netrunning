import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
let checks = 0, failures = 0;
const expect = (ok, message) => { checks++; if (!ok) { failures++; console.error(`FAIL: ${message}`); } };
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const moduleJson = JSON.parse(read("module.json"));
expect(moduleJson.id === "cpr-netrunning-next", "experimental module id changed");
expect(moduleJson.version === "0.3.0", "module version is not 0.3.0");
for (const m of ["scripts/rules-v03-runtime.js","scripts/request-v03.js","scripts/ux-v03.js"]) expect(moduleJson.esmodules.includes(m), `${m} is not loaded`);
expect(moduleJson.styles.includes("styles/v03.css"), "v03 CSS is not loaded after base CSS");

const runtime = read("scripts/rules-v03-runtime.js");
expect(runtime.includes("controlActivations"), "Control Node once-per-Turn state is missing");
expect(runtime.includes("turnSerial"), "Control Node activation is not keyed to Turn");
expect(runtime.includes("this._spend(runner, 1)"), "Control Node activation no longer spends a NET Action");

const projection = read("scripts/projection.js");
expect(!projection.includes('"slide", "zap"'), "unfinished Slide/Zap leaked into player action projection");
expect(!projection.includes("dv: node.dv"), "player projection appears to expose node DV");

const plain = read("scripts/plain-interface-v03.js");
expect(plain.includes("CPRInterfaceRoll"), "Going Quiet does not use native CPRInterfaceRoll");
expect(!plain.includes('rollInterface(actor, "scanner"'), "Scanner is still substituted for plain Interface");
expect(plain.includes("allActions"), "plain Interface Check lost universal action modifiers");

const request = read("scripts/request-v03.js");
expect(request.includes("rollPlainInterfaceV03"), "Going Quiet controller is not using 0.3 plain Interface bridge");
expect(request.includes("total) > Number(watcher.total"), "Quiet Jack tie handling is not strict");

const ux = read("scripts/ux-v03.js");
for (const word of ["fitMap", "Space+drag", "programs-toggle", "inspectorCollapsed", "focusMode"]) expect(ux.includes(word), `UX feature missing: ${word}`);

const sprite = read("assets/icons-v03.svg");
for (const id of ["fit","plus","minus","panel","focus","help","rules","scanner","warning","shield"]) expect(sprite.includes(`id="${id}"`), `v03 icon missing: ${id}`);

const css = read("styles/v03.css");
expect(css.includes("v03-inspector-collapsed"), "inspector collapse CSS missing");
expect(css.includes("v03-focus"), "focus mode CSS missing");
expect(css.includes("prefers-reduced-motion"), "reduced-motion fallback missing");
expect(css.includes(":focus-visible"), "keyboard focus styling missing");

const matrix = read("RULES-MATRIX.md");
for (const rule of ["Scanner", "Control Node", "Slide", "Zap", "Pathfinder", "Going Quiet"]) expect(matrix.includes(rule), `rules matrix missing ${rule}`);

const newFiles = ["scripts/rules-v03-runtime.js","scripts/plain-interface-v03.js","scripts/request-v03.js","scripts/ux-v03.js"];
for (const file of newFiles) {
  const source = read(file);
  expect(!/game\.settings\.set\(\s*["']cpr-netrunning["']/.test(source), `${file} writes to production namespace`);
}

console.log(`Lab 0.3 checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
