/* Which chips light up where.
 *
 *   node tools/test-abilities.mjs
 *
 * Three bugs of the same shape came out of these rules while they were written
 * inline in the actions panel, and every one of them reached the table:
 *
 *   * Eye-Dee lit only on a floor of kind "file", while the GM puts his file on
 *     a floor he named himself.
 *   * A floor's named check was a plain assignment, so it did not merely light a
 *     chip — it put one out. A cracked file went dark at the moment it was
 *     cracked; a control node went dark for good once taken, so a runner whose
 *     hold the GM had just stripped could not take it back.
 *
 * The rules are pure now, so they can simply be asked.
 */

import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const A = await import(pathToFileURL(path.join(ROOT, "scripts", "rules", "abilities.js")).href);

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  FAIL: ${message}`);
}

const ME = "actor:Actor_me";
const THEM = "actor:Actor_them";
const lit = (args) => A.availabilityFor({ pid: ME, ...args });

console.log("Ability availability\n");

console.log("A file is anything the GM put something in");
{
  expect(A.floorHoldsFile({ kind: "file" }) === true, "a file floor holds no file");
  expect(A.floorHoldsFile({ kind: "custom", contents: "смены охраны" }) === true,
    "written contents do not count");
  expect(A.floorHoldsFile({ kind: "custom", contentsImage: "badge.webp" }) === true,
    "a picture does not count");
  expect(A.floorHoldsFile({ kind: "custom", contents: "  \n " }) === false,
    "whitespace counted as contents");
  expect(A.floorHoldsFile({ kind: "custom" }) === false, "an empty floor holds a file");
  expect(A.floorHoldsFile(null) === false, "a missing floor holds a file");

  expect(lit({ floor: { kind: "custom", contents: "x" } }).eyedee === true,
    "Eye-Dee is dark on a custom floor holding a file");
  expect(lit({ floor: { kind: "file" }, fx: { eyedee: [ME] } }).eyedee === false,
    "Eye-Dee stays lit on a file already read");
  expect(lit({ floor: { kind: "file" }, fx: { eyedee: [THEM] } }).eyedee === true,
    "someone else's read closed the file for me");
}

console.log("A password opens once");
{
  expect(lit({ floor: { kind: "password" } }).backdoor === true, "Backdoor is dark on a password");
  expect(lit({ floor: { kind: "password" }, fx: { breached: true } }).backdoor === false,
    "Backdoor stays lit on an open password");
  expect(lit({ floor: { kind: "custom" } }).backdoor === false, "Backdoor lit on a plain floor");
}

console.log("A node is worth taking while somebody else holds it");
{
  const node = { kind: "controlnode" };
  expect(lit({ floor: node }).control === true, "Control is dark on a free node");
  expect(lit({ floor: node, fx: { control: { pid: THEM, dv: 14 } } }).control === true,
    "Control is dark on a node held by someone else");
  expect(lit({ floor: node, fx: { control: { pid: ME, dv: 14 } } }).control === false,
    "Control is lit on a node I already hold");

  // The reported bug: the GM strips the hold, and the runner must be able to
  // take it again. `breached` is still true from the roll that took it.
  expect(lit({ floor: { ...node, check: "control" }, fx: { breached: true, control: null } }).control === true,
    "after the GM stripped the hold, Control stayed dark");
}

console.log("A floor's named check lights a chip and never puts one out");
{
  // Lighting: a custom floor asking for Backdoor.
  expect(lit({ floor: { kind: "custom", check: "backdoor" } }).backdoor === true,
    "a named check did not light its chip");

  // Not putting out: a file whose check is Eye-Dee, cracked open.
  const cracked = lit({ floor: { kind: "file", check: "eyedee" }, fx: { breached: true, eyedee: [] } });
  expect(cracked.eyedee === true, "opening the floor put out the chip that reads it");

  // But a check that is only satisfied by breaching still goes dark once
  // breached — nothing else keeps it lit.
  expect(lit({ floor: { kind: "custom", check: "backdoor" }, fx: { breached: true } }).backdoor === false,
    "an opened floor still asks to be opened");
}

console.log("Virus goes at the bottom of a branch");
{
  expect(lit({ floor: { kind: "custom" }, isLeaf: true }).virus === true, "Virus is dark at a dead end");
  expect(lit({ floor: { kind: "custom" }, isLeaf: false }).virus === false, "Virus is lit mid-branch");
}

console.log("Slide needs something to slide against");
{
  expect(lit({ floor: {}, targetKind: "ice" }).slide === true, "Slide is dark against ICE");
  expect(lit({ floor: {}, targetKind: "prog", targetIsBlackIce: true }).slide === true,
    "Slide is dark against placed Black ICE");
  expect(lit({ floor: {}, targetKind: "prog", targetIsBlackIce: false }).slide === false,
    "Slide is lit against an ordinary program");
  expect(lit({ floor: {}, targetKind: "" }).slide === false, "Slide is lit at nothing");
}

console.log("Scanner is not an in-architecture ability");
{
  expect(!("scanner" in lit({ floor: { kind: "custom" } })),
    "Scanner is still judged as if it belonged inside an architecture");
}

console.log("Nothing throws on an empty floor");
{
  const out = A.availabilityFor({});
  expect(out && out.cloak === true && out.zap === true, "the free abilities went missing");
  expect(out.backdoor === false && out.eyedee === false && out.control === false,
    "a missing floor offered something");
}

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
