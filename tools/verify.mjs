/* Static verification harness for the Netrunning Suite (zero external deps).
 * Run: node tools/verify.mjs
 * Exits non-zero and prints every failure. Checks per SPEC §11. */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];
const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);

/* ---- helpers ---- */
function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === ".git" || name === "node_modules") continue;
      walk(full, filter, out);
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join("/");
const read = (p) => readFileSync(p, "utf8");

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/* ---- 1. node --check every script ---- */
const scripts = walk(join(ROOT, "scripts"), (f) => f.endsWith(".js"));
for (const f of scripts) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fail(`[1] syntax error in ${rel(f)}:\n${e.stderr?.toString() || e.message}`);
  }
}

/* ---- 2. en/ru key parity ---- */
const enPath = join(ROOT, "lang", "en.json");
const ruPath = join(ROOT, "lang", "ru.json");
let en = {};
let ru = {};
try { en = flatten(JSON.parse(read(enPath))); } catch (e) { fail(`[2] en.json parse: ${e.message}`); }
try { ru = flatten(JSON.parse(read(ruPath))); } catch (e) { fail(`[2] ru.json parse: ${e.message}`); }
for (const k of Object.keys(en)) if (!(k in ru)) fail(`[2] key missing in ru.json: ${k}`);
for (const k of Object.keys(ru)) if (!(k in en)) fail(`[2] key missing in en.json: ${k}`);

/* ---- template + script corpora ---- */
const templates = walk(join(ROOT, "templates"), (f) => f.endsWith(".hbs"));
const tplText = templates.map((f) => ({ f, t: read(f) }));
const scriptText = scripts.map((f) => ({ f, t: read(f) }));
const allScripts = scriptText.map((s) => s.t).join("\n");
const allTpl = tplText.map((s) => s.t).join("\n");

/* ---- 3. data-action handlers ---- */
const tplActions = new Set();
for (const { t } of tplText) {
  for (const m of t.matchAll(/data-action="([^"]+)"/g)) tplActions.add(m[1]);
}
const jsActions = new Set();
for (const m of allScripts.matchAll(/\[data-action=["'`]([^"'`]+)["'`]\]/g)) jsActions.add(m[1]);
for (const m of allScripts.matchAll(/data-action=["'`]([^"'`]+)["'`]/g)) jsActions.add(m[1]);
for (const a of tplActions) {
  // Accept if referenced as a literal anywhere in JS (handler string match).
  if (!jsActions.has(a) && !allScripts.includes(`"${a}"`) && !allScripts.includes(`'${a}'`)) {
    fail(`[3] template data-action="${a}" has no handler in scripts`);
  }
}
for (const a of jsActions) {
  if (!tplActions.has(a)) warn(`[3] scripts reference [data-action=${a}] not present in any template`);
}

/* ---- 4. HBS block balance + partial paths ---- */
for (const { f, t } of tplText) {
  for (const block of ["if", "each", "unless"]) {
    const open = (t.match(new RegExp(`{{#${block}\\b`, "g")) || []).length;
    const close = (t.match(new RegExp(`{{/${block}}}`, "g")) || []).length;
    if (open !== close) fail(`[4] ${rel(f)}: {{#${block}}} (${open}) / {{/${block}}} (${close}) unbalanced`);
  }
  for (const m of t.matchAll(/{{>\s*"?([^"} \t]+)"?\s*}}/g)) {
    const p = m[1];
    if (!p.startsWith("modules/")) continue;
    const abs = join(ROOT, "..", "..", p.replace(/^modules\//, "modules/"));
    // Resolve relative to the Data root (two levels up from module root).
    const dataRoot = join(ROOT, "..", "..");
    const full = join(dataRoot, p);
    if (!existsSync(full) && !existsSync(abs)) fail(`[4] ${rel(f)}: partial not found: ${p}`);
  }
}

/* ---- 5. i18n keys referenced exist in both lang files ---- */
const refKeys = new Set();
for (const m of allScripts.matchAll(/loc\(\s*["'`](CRNS\.[^"'`]+)["'`]/g)) refKeys.add(m[1]);
for (const m of allTpl.matchAll(/localize\s+["'`](CRNS\.[^"'`]+)["'`]/g)) refKeys.add(m[1]);
for (const m of allTpl.matchAll(/{{localize\s+["'`](CRNS\.[^"'`]+)["'`]/g)) refKeys.add(m[1]);
for (const k of refKeys) {
  if (k.includes("${")) continue; // dynamic/interpolated key — can't be checked statically
  if (!(k in en)) fail(`[5] i18n key referenced but missing in en.json: ${k}`);
  if (!(k in ru)) fail(`[5] i18n key referenced but missing in ru.json: ${k}`);
}

/* ---- 6. CSS brace balance + class coverage (warning) ---- */
const cssPath = join(ROOT, "styles", "netrunning.css");
if (existsSync(cssPath)) {
  const css = read(cssPath);
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  if (opens !== closes) fail(`[6] netrunning.css brace imbalance: { ${opens} / } ${closes}`);
  const cssClasses = new Set();
  for (const m of css.matchAll(/\.(crns-[a-z0-9-]+)/g)) cssClasses.add(m[1]);
  const tplClasses = new Set();
  for (const { t } of tplText) {
    for (const m of t.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith("crns-")) tplClasses.add(c.replace(/{{.*}}/g, ""));
    }
  }
  for (const c of tplClasses) {
    if (c && !cssClasses.has(c)) warn(`[6] class ${c} used in templates but not styled in CSS`);
  }

  /* A custom property that was never declared. `var(--typo)` with no fallback
     makes the whole declaration invalid at computed-value time, so the rule
     silently does nothing — a border simply is not there, and nothing anywhere
     says why. This has happened twice. */
  const declared = new Set();
  for (const m of css.matchAll(/(--crns-[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  for (const m of css.matchAll(/var\(\s*(--crns-[a-z0-9-]+)\s*([,)])/g)) {
    // A fallback (`var(--x, #fff)`) makes it survive, so only the bare form counts.
    if (m[2] === ")" && !declared.has(m[1])) fail(`[6] ${m[1]} is used but never declared`);
  }
} else {
  fail("[6] styles/netrunning.css missing");
}

/* ---- 7. module.json validity + referenced paths + SPEC deviations ---- */
const mjPath = join(ROOT, "module.json");
try {
  const mj = JSON.parse(read(mjPath));
  const paths = [
    ...(mj.esmodules || []),
    ...(mj.styles || []),
    ...(mj.languages || []).map((l) => l.path),
  ];
  for (const p of paths) {
    if (!existsSync(join(ROOT, p))) fail(`[7] module.json references missing path: ${p}`);
  }
} catch (e) {
  fail(`[7] module.json parse: ${e.message}`);
}
const spec = existsSync(join(ROOT, "SPEC.md")) ? read(join(ROOT, "SPEC.md")) : "";
if (!/##\s*13\.\s*Deviations/i.test(spec)) fail("[7] SPEC.md missing Deviations section (§13)");

/* ---- 8. every templates/*.hbs must be preloaded in main.js loadTemplates ----
 * Partials referenced with {{> "modules/.../x.hbs"}} resolve only when preloaded;
 * a missing entry fails at RUNTIME ("partial could not be found"), which static
 * file-existence checks (check 4) cannot catch. */
try {
  const mainSrc = read(join(ROOT, "scripts", "main.js"));
  const ltMatch = mainSrc.match(/loadTemplates\(\[([\s\S]*?)\]/);
  const loaded = new Set([...(ltMatch?.[1] || "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]));
  for (const f of walk(join(ROOT, "templates"), (p) => p.endsWith(".hbs"))) {
    const base = rel(f).replace(/^templates\//, "").replace(/\.hbs$/, "");
    if (!loaded.has(base)) fail(`[8] templates/${base}.hbs is not preloaded in main.js loadTemplates`);
  }
} catch (e) {
  fail(`[8] loadTemplates check: ${e.message}`);
}

/* ---- report ---- */
for (const w of warnings) console.warn(`WARN  ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} failure(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`OK — all checks passed (${warnings.length} warning(s)).`);
