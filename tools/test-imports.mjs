/* Import shadowing check.
 *
 *   node tools/test-imports.mjs
 *
 * Why this exists. `data.js` imported the topology helpers as `tree`, and the
 * same file already used `const tree = getWorld("netTree")` inside half its
 * operations for a completely different tree — the GM's folder list. A `const`
 * is hoisted to the top of its block in the temporal dead zone, so the earlier
 * call to `tree.normalizeFloors(...)` did not reach the import at all: it
 * reached the not-yet-initialised local and threw.
 *
 * What made it expensive was the shape of the failure. The throw aborted the
 * save; the editor then re-read the architecture from storage and found the
 * stored copy unchanged — empty, for a freshly created one — so every floor the
 * GM had just typed in vanished on clicking Save. Nothing in the message said
 * "import", and nothing in the module's own verifier looked for it.
 *
 * A namespace import and a local of the same name in one file is always a
 * mistake, whether or not it happens to throw today. This finds them statically.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  FAIL: ${message}`);
}

/** Every .js under scripts/, recursively. */
function scripts(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scripts(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

console.log("Import shadowing\n");

const files = scripts(path.join(ROOT, "scripts"));
expect(files.length > 0, "no scripts found — the scan did not run");

for (const file of files) {
  const text = fs.readFileSync(file, "utf-8");
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");

  // Names bound by an import: `import * as X`, `import X from`, `import {A, B}`.
  const bound = new Set();
  for (const m of text.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) bound.add(m[1]);
  for (const m of text.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.split(/\s+as\s+/).pop().trim();
      if (name) bound.add(name);
    }
  }

  // Names re-declared locally somewhere in the same file.
  const declared = new Map();
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (!declared.has(m[1])) {
      declared.set(m[1], text.slice(0, m.index).split("\n").length);
    }
  }
  // Function parameters count too: a parameter shadows for the whole body.
  for (const m of text.matchAll(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.trim().split(/[\s=]/)[0].replace(/^\.\.\./, "");
      if (!name || declared.has(name)) continue;
      declared.set(name, text.slice(0, m.index).split("\n").length);
    }
  }

  for (const name of bound) {
    const at = declared.get(name);
    expect(
      at === undefined,
      `${rel}: "${name}" is imported and also declared locally (line ~${at}) — ` +
      `the import is unreachable wherever the local is in scope`
    );
  }
}

console.log(`  files scanned: ${files.length}`);
console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
