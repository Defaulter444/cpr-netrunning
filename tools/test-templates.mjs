/* Template scope check — compiled by the real Handlebars.
 *
 *   node tools/test-templates.mjs
 *
 * Why this exists. `{{#each canvas.floors as |floor|}}` binds `floor` as a
 * BLOCK PARAMETER, which is lexically scoped and reachable at any depth. Written
 * as `{{../floor.floorId}}` from inside a nested `{{#each}}`, it resolves to
 * NOTHING — `../` pops a frame and looks the name up in that frame's context,
 * where a block parameter of the inner block does not live.
 *
 * The failure is silent and total: the attribute renders empty, so
 * `data-floor-id=""` reaches the handler, the operation is asked to clear
 * "nothing", and the button does nothing at all. Two GM controls sat broken this
 * way — undoing a virus and taking a runner's file access away — and two editor
 * dropdowns never showed the value they had stored, because their `selected`
 * test compared against an empty string.
 *
 * `../` pointing at a TOP-LEVEL key is fine and common in these templates
 * (`{{../actions.pid}}`), so this cannot be a blanket ban on `../`. The
 * distinction is what the name is: a block parameter or a context key. So the
 * check compiles each template for real and asserts the two cases behave as the
 * templates assume.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
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

/* Handlebars ships with Foundry. Without it this check cannot run honestly, so
 * it says so and stops rather than pretending to have passed. */
const FOUNDRY = [
  "C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json",
  "C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json",
  "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/package.json",
].find((p) => fs.existsSync(p));

if (!FOUNDRY) {
  console.log("Handlebars not found (Foundry is not installed here) — skipping.\n");
  process.exit(0);
}
const Handlebars = createRequire(FOUNDRY)("handlebars");

console.log("Template scope\n");
console.log(`  Handlebars ${Handlebars.VERSION}`);

/* The rule this codebase relies on, asserted rather than assumed. */
console.log("\n`../` reaches a context key, not a block parameter");
{
  const blockParam = Handlebars.compile(
    "{{#each rows as |row|}}{{#each row.items as |item|}}[{{../row.id}}]{{/each}}{{/each}}"
  );
  const lexical = Handlebars.compile(
    "{{#each rows as |row|}}{{#each row.items as |item|}}[{{row.id}}]{{/each}}{{/each}}"
  );
  const topLevel = Handlebars.compile(
    "{{#each panel.rows as |row|}}[{{../panel.id}}]{{/each}}"
  );
  const data = { rows: [{ id: "R1", items: [{}] }], panel: { id: "P1", rows: [{}] } };

  expect(blockParam(data) === "[]", "a block parameter through ../ unexpectedly resolved");
  expect(lexical(data) === "[R1]", "a block parameter did not resolve lexically");
  expect(topLevel(data) === "[P1]", "a top-level key through ../ did not resolve");
}

/* Now the templates themselves: every `../name` must be a top-level getData key,
 * never a block parameter declared by an enclosing `as |name|`. */
console.log("\nNo template reaches a block parameter through `../`");
{
  const files = fs.readdirSync(path.join(ROOT, "templates")).filter((f) => f.endsWith(".hbs"));
  expect(files.length > 0, "no templates found — the scan did not run");

  let offenders = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, "templates", file), "utf-8");

    // Block parameters declared anywhere in this template.
    const params = new Set();
    for (const m of text.matchAll(/as\s*\|([^|]+)\|/g)) {
      for (const name of m[1].trim().split(/\s+/)) params.add(name);
    }

    for (const m of text.matchAll(/\.\.\/([A-Za-z_$][\w$]*)/g)) {
      const name = m[1];
      const line = text.slice(0, m.index).split("\n").length;
      if (params.has(name)) {
        offenders += 1;
        expect(
          false,
          `${file}:${line} — "../${name}" reaches a block parameter and renders empty; ` +
          `drop the "../" (block parameters are already in scope)`
        );
      }
    }

    // And the template must still compile.
    try {
      Handlebars.precompile(text);
      checks += 1;
    } catch (err) {
      expect(false, `${file}: does not compile — ${err.message}`);
    }
  }
  console.log(`  templates: ${files.length}, offending references: ${offenders}`);
}

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
