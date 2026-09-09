import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL: ${msg}`); };
const ok = (msg) => console.log(`OK: ${msg}`);

const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
if (moduleJson.id !== "cpr-netrunning-next") fail("module id must stay isolated"); else ok("isolated module id");
if (moduleJson.socket !== true) fail("rules-aware multiplayer lab must declare socket:true"); else ok("module socket enabled");
if (moduleJson.version !== "0.4.0") fail("experimental module version should be 0.4.0"); else ok("module version 0.4.0");

const scripts = fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".js")).map((f) => path.join(ROOT, "scripts", f));
for (const file of scripts) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail(`${path.basename(file)} syntax: ${result.stderr.trim()}`);
}
if (!failures) ok(`JavaScript syntax (${scripts.length} modules)`);

const template = fs.readFileSync(path.join(ROOT, "templates", "lab.hbs"), "utf8");
const style = fs.readFileSync(path.join(ROOT, "styles", "lab.css"), "utf8");
const scriptText = scripts.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const allText = `${scriptText}\n${template}`;

const forbidden = [
  /game\.settings\.set\s*\(\s*["']cpr-netrunning["']/,
  /setFlag\s*\(\s*["']cpr-netrunning["']/,
  /game\.settings\.register\s*\(\s*ID\s*,\s*["'](?:runtime|publicProjection)["']/
];
for (const rx of forbidden) if (rx.test(allText)) fail(`unsafe/legacy storage pattern found: ${rx}`);
if (!forbidden.some((rx) => rx.test(allText))) ok("production namespace and secret world-setting writes are absent");

if (!/ownership:\s*\{\s*default:\s*CONST\.DOCUMENT_OWNERSHIP_LEVELS\.NONE/.test(scriptText)) fail("private store/projection defaults must be NONE");
else ok("private documents default to no access");
if (!/projectionFor/.test(scriptText) || !/payload/.test(scriptText)) fail("per-user projection pipeline missing");
else ok("per-user projection pipeline present");
if (!/ECDH/.test(scriptText) || !/AES-GCM/.test(scriptText)) fail("authenticated encrypted player control transport missing");
else ok("ECDH/AES-GCM control transport present");

const en = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "en.json"), "utf8"));
const ru = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "ru.json"), "utf8"));
const enKeys = Object.keys(en).sort(), ruKeys = Object.keys(ru).sort();
if (JSON.stringify(enKeys) !== JSON.stringify(ruKeys)) {
  const missingRu = enKeys.filter((k) => !(k in ru));
  const missingEn = ruKeys.filter((k) => !(k in en));
  fail(`localization key mismatch; missing RU=${missingRu.join(",")}; missing EN=${missingEn.join(",")}`);
} else ok(`EN/RU localization parity (${enKeys.length} keys)`);

const usedKeys = [...allText.matchAll(/["'](CRNSL\.[A-Za-z0-9_.]+)["']/g)].map((m) => m[1]);
for (const key of new Set(usedKeys)) {
  if (!(key in en)) fail(`missing EN localization: ${key}`);
  if (!(key in ru)) fail(`missing RU localization: ${key}`);
}

const iconText = fs.readFileSync(path.join(ROOT, "assets", "icons.svg"), "utf8");
const iconIds = new Set([...iconText.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
const staticRefs = [...allText.matchAll(/icons\.svg#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
for (const ref of new Set(staticRefs)) if (!iconIds.has(ref)) fail(`missing SVG symbol: ${ref}`);
for (const required of ["backdoor","cloak","control","eyedee","pathfinder","slide","virus","zap","program","jackin","jackout","stealth","move","intel","data"]) if (!iconIds.has(required)) fail(`rules cockpit icon missing: ${required}`);
if (!failures) ok(`SVG system (${iconIds.size} symbols)`);

for (const requiredClass of ["crnsl-commandbar","crnsl-sessionbar","crnsl-action-dock","crnsl-inspector-tabs","crnsl-program-drawer","reduced-motion"]) {
  if (!style.includes(`.${requiredClass}`)) fail(`CSS component missing: ${requiredClass}`);
}
if (!style.includes(":focus-visible")) fail("keyboard focus treatment missing");
if (!style.includes("prefers-reduced-motion")) fail("prefers-reduced-motion support missing");
if (!failures) ok("cockpit component/accessibility CSS");

const rules = spawnSync(process.execPath, [path.join(ROOT, "tools", "test-rules.mjs")], { encoding: "utf8" });
process.stdout.write(rules.stdout || "");
process.stderr.write(rules.stderr || "");
if (rules.status !== 0) fail("pure RED rules regression suite"); else ok("pure RED rules regression suite");

const v03 = spawnSync(process.execPath, [path.join(ROOT, "tools", "test-v03.mjs")], { encoding: "utf8" });
process.stdout.write(v03.stdout || ""); process.stderr.write(v03.stderr || "");
if (v03.status !== 0) fail("0.3 UX/rules regression suite"); else ok("0.3 UX/rules regression suite");

const v04 = spawnSync(process.execPath, [path.join(ROOT, "tools", "test-v04.mjs")], { encoding: "utf8" });
process.stdout.write(v04.stdout || ""); process.stderr.write(v04.stderr || "");
if (v04.status !== 0) fail("0.4 motion/rules regression suite"); else ok("0.4 motion/rules regression suite");

console.log(`\nFailures: ${failures}`);
process.exit(failures ? 1 : 0);
