import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL: ${msg}`); };
const ok = (msg) => console.log(`OK: ${msg}`);

const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
if (moduleJson.id !== "cpr-netrunning-next") fail("module id must stay isolated");
else ok("isolated module id");

const scripts = fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".js")).map((f) => path.join(ROOT, "scripts", f));
for (const file of scripts) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail(`${path.basename(file)} syntax: ${result.stderr}`);
}
if (!failures) ok("JavaScript syntax");

const allText = [...scripts.map((f) => fs.readFileSync(f, "utf8")), fs.readFileSync(path.join(ROOT, "templates", "lab.hbs"), "utf8")].join("\n");
const forbidden = [/game\.settings\.set\s*\(\s*["']cpr-netrunning["']/, /setFlag\s*\(\s*["']cpr-netrunning["']/];
for (const rx of forbidden) if (rx.test(allText)) fail(`production write pattern found: ${rx}`);
if (!forbidden.some((rx) => rx.test(allText))) ok("no production namespace writes");

const en = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "en.json"), "utf8"));
const ru = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "ru.json"), "utf8"));
const keys = [...allText.matchAll(/[\"'](CRNSL\.[A-Za-z0-9_.]+)[\"']/g)].map((m) => m[1]);
for (const key of new Set(keys)) {
  if (!(key in en)) fail(`missing EN localization: ${key}`);
  if (!(key in ru)) fail(`missing RU localization: ${key}`);
}
if (!failures) ok("localization parity");

const iconText = fs.readFileSync(path.join(ROOT, "assets", "icons.svg"), "utf8");
const iconIds = new Set([...iconText.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
const refs = [...allText.matchAll(/icons\.svg#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
for (const ref of new Set(refs)) if (!iconIds.has(ref)) fail(`missing SVG symbol: ${ref}`);
if (!failures) ok("SVG references");

console.log(`\nFailures: ${failures}`);
process.exit(failures ? 1 : 0);
