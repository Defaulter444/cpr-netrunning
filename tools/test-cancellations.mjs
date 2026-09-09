/* Execute the real GM reply handlers with a cancelled system roll. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = process.env.CRNS_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts/main.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert(start >= 0, `handler ${name} exists`);
  const nextComment = source.indexOf("\n/**", start);
  return source.slice(start, nextComment);
}
let failures = 0;
const results = [];
for (const kind of ["ice", "demon", "runner", "prog"]) {
  let cards = 0, derezzes = 0;
  const context = vm.createContext({
    game: { settings: { get: () => true } }, MODULE_ID: "cpr-netrunning",
    refToActor: () => ({ kind, actor: { name: "Target" } }),
    runnerIsPlayerControlled: () => false,
    bridge: { rollEntityStat: async () => null, rollInterface: async () => null },
    postComparisonCard: () => { cards++; }, derezAttackerProg: () => { derezzes++; },
  });
  vm.runInContext(extract("handleRollRequest"), context);
  await context.handleRollRequest({ targetRef: `${kind}:target`, total: -1 });
  const pass = cards === 0 && derezzes === 0;
  results.push({ name: `Cancelled ${kind} defence: no verdict or program deactivation`, pass });
  if (!pass) failures++;
}
{
  let cards = 0, clears = 0;
  const context = vm.createContext({
    getWorld: () => ({ pendingTests: [{ id: "t1", pid: "p1", iceActorId: "i1" }] }),
    game: { actors: { get: () => ({ name: "ICE" }) } },
    bridge: { rollEntityStat: async () => null },
    mutate: async () => { clears++; }, postComparisonCard: () => { cards++; },
    participantName: () => "Runner", loc: x => x,
    refToActor: () => null,
  });
  vm.runInContext(extract("handleSpeedTest"), context);
  await context.handleSpeedTest({ testId: "t1", runnerTotal: 10 });
  const pass = cards === 0 && clears === 0;
  results.push({ name: "Cancelled ICE SPEED: encounter remains pending", pass });
  if (!pass) failures++;
}
{
  let cards = 0, resolutions = 0;
  const context = vm.createContext({
    getWorld: () => ({ participants: { p1: { slidePending: { id: "a1", testRef: "ice:x" } } } }),
    refToActor: () => ({ kind: "ice", actor: { name: "ICE" } }),
    bridge: { rollEntityStat: async () => null },
    postComparisonCard: () => { cards++; }, mutate: async () => { resolutions++; },
    participantName: () => "Runner", loc: x => x,
  });
  // Before the fix the logic was inside handleSlideTest itself.
  const name = source.includes("async function resolveSlideTest(") ? "resolveSlideTest" : "handleSlideTest";
  vm.runInContext(extract(name), context);
  await context[name]({ pid: "p1", testRef: "ice:x", runnerTotal: 12, attemptId: "a1" });
  const pass = cards === 0 && resolutions === 0;
  results.push({ name: "Cancelled ICE PER: no automatic successful Slide", pass });
  if (!pass) failures++;
}
console.log(JSON.stringify({ checks: results.length, failures, scenarios: results }, null, 2));
process.exitCode = failures ? 1 : 0;
