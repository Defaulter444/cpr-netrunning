/* Every script parses as an ES MODULE, which is how the browser loads them.
 *
 *   node tools/test-parse.mjs
 *
 * Why this exists, and why the obvious check is not enough.
 *
 * `node --check some-file.js` parses the file as a CommonJS SCRIPT, because
 * that is what the `.js` extension means without a `type: module` package.
 * Foundry loads these same files as ES modules. The two goals do not agree on
 * everything, and a file can pass the first and fail the second.
 *
 * That is not theoretical. A patch once wrote a regular expression with REAL
 * control characters where the escapes belonged:
 *
 *     safe.replace(/<CR>?<LF>/g, "<br />")     instead of   /\r?\n/g
 *
 * A regex literal cannot contain a line terminator, so the module goal rejects
 * it — "Invalid regular expression: missing /". `node --check` on the `.js`
 * file accepted it without a word. The file was imported by arch-canvas, which
 * is imported by suite-app, which is imported by main: the whole module failed
 * to load, and the only visible symptom was that the toolbar button had
 * disappeared. Everything else — tests included — kept passing, because the
 * test harness copies the sources and imports them by URL rather than by the
 * path Foundry uses.
 *
 * So: copy each script to a `.mjs` file, which forces the module goal, and let
 * the parser have the last word.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CRNS_SOURCE_ROOT || path.resolve(HERE, "..");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  FAIL: ${message}`);
}

/** Every .js/.mjs file under a directory, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walk(at)); continue; }
    if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) out.push(at);
  }
  return out;
}

console.log("Module-goal parse\n");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crns-parse-"));
const targets = [
  ...walk(path.join(ROOT, "scripts")),
  ...walk(path.join(ROOT, "tools")),
];

for (const file of targets) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  // The extension is the whole point: `.mjs` makes the parser use the module
  // goal, the same one the browser uses for an `esmodules` entry.
  const probe = path.join(tmp, `${rel.replace(/[^A-Za-z0-9]/g, "_")}.mjs`);
  fs.copyFileSync(file, probe);
  let error = "";
  try {
    execFileSync(process.execPath, ["--check", probe], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    error = String(e.stderr || e.message).split("\n").find((l) => l.includes("Error")) || "parse failed";
  }
  expect(!error, `${rel} does not parse as a module — ${error}`);
}

console.log(`  files: ${targets.length}`);

/* The guard needs its own guard: if the probe ever stops rejecting bad input,
 * every file above would pass for the wrong reason. */
{
  const bad = path.join(tmp, "deliberately-broken.mjs");
  // Built from character codes so no amount of escaping between here and the
  // file can quietly turn it back into something valid.
  const cr = String.fromCharCode(13);
  const lf = String.fromCharCode(10);
  fs.writeFileSync(bad, `export const re = /${cr}?${lf}/g;${lf}`, "utf-8");
  let rejected = false;
  try {
    execFileSync(process.execPath, ["--check", bad], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    rejected = true;
  }
  expect(rejected, "the parse gate accepted a regex broken across a line — it would catch nothing");
}

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
