/* Every button is wired to something.
 *
 *   node tools/test-actions.mjs
 *
 * A control in a template announces itself with `data-action="…"`, and a
 * handler somewhere in `scripts/` binds that name. Nothing enforces the pair.
 * A button whose handler was never written — or was renamed on one side only —
 * renders, highlights on hover, and does nothing at all when pressed. That is
 * indistinguishable from a bug in the logic behind it, and it has already cost
 * a round of "I press it and nothing happens".
 *
 * The reverse is worth knowing too: a handler bound to a name no template
 * emits is dead code, usually the remains of a rename.
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

/** All files under `dir` with the given extension, recursively. */
function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

console.log("Wired controls\n");

/* Names emitted by templates, and where. A name built at runtime (inside a
 * Handlebars expression) is skipped — it cannot be resolved statically. */
const emitted = new Map();
for (const file of walk(path.join(ROOT, "templates"), ".hbs")) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const text = fs.readFileSync(file, "utf-8");
  for (const m of text.matchAll(/data-action="([^"{}]+)"/g)) {
    if (!emitted.has(m[1])) emitted.set(m[1], rel);
  }
}
expect(emitted.size > 10, `only ${emitted.size} controls found — the scan did not work`);

/* Names a handler binds. Both spellings the codebase uses are accepted:
 *   html.find('[data-action="x"]')      — the common one
 *   ev.currentTarget.dataset.action     — a dispatcher, which we cannot resolve
 *                                         and therefore do not count against.  */
const boundText = walk(path.join(ROOT, "scripts"), ".js")
  .map((f) => fs.readFileSync(f, "utf-8"))
  .join("\n");
const bound = new Set([...boundText.matchAll(/data-action=\\?"([^"\\]+)\\?"/g)].map((m) => m[1]));

for (const [name, where] of emitted) {
  expect(bound.has(name), `${where}: "${name}" is rendered but nothing binds it — the control is dead`);
}
console.log(`  controls: ${emitted.size}, handlers: ${bound.size}`);

/* Handlers with no control left to fire them. Reported, not failed: a name may
 * legitimately be bound ahead of the markup that will use it. */
const orphans = [...bound].filter((name) => !emitted.has(name));
if (orphans.length) console.log(`  bound but never rendered: ${orphans.join(", ")}`);

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
