/* Topology tests — no Foundry, no world state.
 *
 *   node tools/test-tree.mjs
 *
 * Everything the branching feature rests on lives in `scripts/rules/tree.js` as
 * pure functions precisely so it can be checked here: a wrong `childrenOf` is a
 * runner walking through a wall, and that is not something to discover at the
 * table.
 */

import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const T = await import(pathToFileURL(path.join(ROOT, "scripts", "rules", "tree.js")).href);

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  FAIL: ${message}`);
}

function eq(a, b, message) {
  expect(JSON.stringify(a) === JSON.stringify(b), `${message} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/** Floors named by letter; `p` is the parent letter, "" for the entry. */
function build(spec) {
  return spec.map(([id, p, extra = {}]) => ({ id, parent: p, kind: "custom", dv: 0, ...extra }));
}

console.log("Architecture topology\n");

console.log("Legacy chains migrate to a tree");
{
  // Saved before branching existed: no `parent` anywhere.
  const legacy = [{ id: "a" }, { id: "b" }, { id: "c" }];
  T.normalizeFloors(legacy);
  eq(legacy.map((f) => f.parent), ["", "a", "b"], "chain did not become a spine");
  eq(T.rootIndex(legacy), 0, "root of a migrated chain");
  eq(T.childrenOf(legacy, 0), [1], "children in a migrated chain");
  eq(T.adjacentOf(legacy, 1), [0, 2], "neighbours in a migrated chain");
  expect(T.isLeaf(legacy, 2), "last floor of a chain is a leaf");
  expect(!T.isLeaf(legacy, 1), "middle floor of a chain is not a leaf");
}

console.log("A declared tree is left alone");
{
  //        a
  //      /   \
  //     b     c
  //    / \     \
  //   d   e     f
  const floors = build([["a", ""], ["b", "a"], ["c", "a"], ["d", "b"], ["e", "b"], ["f", "c"]]);
  T.normalizeFloors(floors);
  eq(floors.map((f) => f.parent), ["", "a", "a", "b", "b", "c"], "parents were rewritten");
  eq(T.childrenOf(floors, 0), [1, 2], "root has two branches");
  eq(T.childrenOf(floors, 1), [3, 4], "left branch forks again");
  eq(T.parentOf(floors, 5), 2, "parent of a leaf");
  eq(T.depthOf(floors, 5), 2, "depth of a leaf");
  eq(T.pathFromRoot(floors, 4), [0, 1, 4], "path from the entry");
  eq(T.descendantsOf(floors, 0).sort(), [1, 2, 3, 4, 5], "everything below the entry");
  eq(T.adjacentOf(floors, 1), [0, 3, 4], "neighbours are the parent and the children");
}

console.log("A branch can be grown from its end");
{
  // The bug this guards. The editor's "+" created a floor with no parent. On a
  // tree where everybody else HAS one, a parentless floor is treated as a
  // second entry point and re-hung under the root — so every attempt to extend
  // a branch flung the new floor back to the top, and a branch could never grow
  // past its first floor.
  const floors = build([["a", ""], ["b", "a"], ["c", "a"]]);
  T.normalizeFloors(floors);

  // What the fix does: name the parent explicitly.
  floors.push({ id: "d", parent: "c", kind: "custom", dv: 0 });
  T.normalizeFloors(floors);
  eq(floors.find((f) => f.id === "d").parent, "c", "a floor added under a leaf did not stay there");
  eq(T.childrenOf(floors, 2), [3], "the leaf did not become a parent");
  eq(T.depthOf(floors, 3), 2, "the grown floor sits at the wrong depth");
  expect(!T.isLeaf(floors, 2), "the old leaf still counts as a branch bottom");

  // Pressing "+" twice on the same floor is how a fork is made.
  floors.push({ id: "e", parent: "c", kind: "custom", dv: 0 });
  T.normalizeFloors(floors);
  eq(T.childrenOf(floors, 2), [3, 4], "a second child did not create a fork");

  // And the old behaviour, kept as a statement of what goes wrong without a
  // parent: the floor is treated as a stray entry and re-rooted.
  floors.push({ id: "f", parent: "", kind: "custom", dv: 0 });
  T.normalizeFloors(floors);
  eq(floors.find((x) => x.id === "f").parent, "a", "a parentless addition was not re-rooted");
}

console.log("Deleting a middle floor does not orphan its branch");
{
  //   a → b → c   with d hanging off b as well
  const floors = build([["a", ""], ["b", "a"], ["c", "b"], ["d", "b"]]);
  T.normalizeFloors(floors);

  // The editor splices `b` out of the TREE, not just out of the array: its
  // children move up to its parent. Dropping it without that would leave c and
  // d parentless, and normalisation would fling both to the entry.
  const gone = floors[1];
  for (const f of floors) if (f.parent === gone.id) f.parent = gone.parent;
  floors.splice(1, 1);
  T.normalizeFloors(floors);

  eq(floors.map((f) => f.id), ["a", "c", "d"], "wrong floors survived");
  eq(T.childrenOf(floors, 0).sort(), [1, 2], "the branch did not move up to the parent");
  eq(T.depthOf(floors, 1), 1, "a surviving floor kept the deleted floor's depth");
}

console.log("Broken data degrades instead of hanging");
{
  // A parent that does not exist: the floor must not vanish from the canvas.
  const orphan = build([["a", ""], ["b", "ghost"]]);
  T.normalizeFloors(orphan);
  expect(orphan[1].parent === "" || orphan[1].parent === "a", "orphan was not re-rooted");

  // A loop: every traversal here would spin forever if it survived.
  const loop = build([["a", "b"], ["b", "a"]]);
  T.normalizeFloors(loop);
  const roots = loop.filter((f) => !f.parent).length;
  expect(roots >= 1, "cycle left no entry point at all");
  eq(T.depthOf(loop, 1) <= loop.length, true, "depth walk did not terminate");

  // Two entry points: the second is a floor that lost its link, not a second
  // architecture — the runner jacks into one place.
  const twoRoots = build([["a", ""], ["b", ""], ["c", "b"]]);
  T.normalizeFloors(twoRoots);
  eq(twoRoots.filter((f) => !f.parent).length, 1, "more than one entry survived");

  // Self-parent.
  const self = build([["a", "a"]]);
  T.normalizeFloors(self);
  eq(self[0].parent, "", "a floor stayed its own parent");
}

console.log("Pathfinder stops per branch, not globally");
{
  //        a
  //      /   \
  //   lock     c        lock = password DV 10
  //     |       \
  //     d        e
  //              |
  //              f
  const floors = build([
    ["a", ""],
    ["lock", "a", { kind: "password", dv: 10 }],
    ["c", "a"],
    ["d", "lock"],
    ["e", "c"],
    ["f", "e"],
  ]);
  T.normalizeFloors(floors);
  const blocks = (f) => f.kind === "password" && f.dv > 8;

  // Roll of 8: the lock is seen but not passed; the open branch keeps going.
  const seen = T.revealFrom(floors, 0, 8, blocks).sort();
  eq(seen, [1, 2, 4, 5], "reveal did not follow both branches independently");
  expect(!seen.includes(3), "reveal walked past a lock it could not beat");

  // Depth limit, with nothing blocking.
  const shallow = T.revealFrom(floors, 0, 1, () => false).sort();
  eq(shallow, [1, 2], "a roll of 1 saw more than one level");

  // A roll of 0 shows nothing.
  eq(T.revealFrom(floors, 0, 0, () => false), [], "a failed roll still revealed floors");

  // From a leaf there is nothing below.
  eq(T.revealFrom(floors, 5, 9, () => false), [], "reveal from a dead end found floors");
}

console.log("Every branch has its own bottom");
{
  const floors = build([["a", ""], ["b", "a"], ["c", "a"], ["d", "b"]]);
  T.normalizeFloors(floors);
  const leaves = floors.map((_, i) => i).filter((i) => T.isLeaf(floors, i));
  eq(leaves, [2, 3], "leaves of a fork");
  // Upstream treated "last element of the array" as the bottom. On a tree that
  // is simply wrong, and the Virus ability depends on getting it right.
  expect(!T.isLeaf(floors, 1), "a forking floor was mistaken for a bottom");
}

console.log("Layout puts parents over their children");
{
  const floors = build([["a", ""], ["b", "a"], ["c", "a"], ["d", "b"], ["e", "b"]]);
  T.normalizeFloors(floors);
  const layout = T.layoutTree(floors);
  const at = new Map(layout.cells.map((c) => [c.index, c]));

  eq(at.get(0).row, 0, "entry is not on the top row");
  eq(at.get(1).row, 1, "first branch row");
  eq(at.get(3).row, 2, "leaf row");

  // b sits over d and e; a sits over b and c.
  const mid = (x, y) => (at.get(x).col + at.get(y).col) / 2;
  eq(at.get(1).col, mid(3, 4), "a forking floor is not centred over its children");
  eq(at.get(0).col, mid(1, 2), "the entry is not centred over its branches");

  // Leaves must not share a column, or the cards would overlap.
  const leafCols = [3, 4, 2].map((i) => at.get(i).col);
  eq(new Set(leafCols).size, leafCols.length, "two leaves landed in the same column");

  const links = T.linksOf(floors, layout);
  eq(links.length, 4, "wrong number of connectors");
  expect(links.every((l) => l.toRow === l.fromRow + 1), "a connector skipped a row");
}

console.log("A single floor is a valid architecture");
{
  const one = build([["a", ""]]);
  T.normalizeFloors(one);
  eq(T.rootIndex(one), 0, "root of a one-floor arch");
  expect(T.isLeaf(one, 0), "the only floor is both entry and bottom");
  eq(T.adjacentOf(one, 0), [], "a lone floor has neighbours");
  const layout = T.layoutTree(one);
  eq(layout.rows, 1, "one floor made more than one row");
  eq(T.linksOf(one, layout), [], "one floor produced a connector");
}

console.log("An empty architecture answers instead of throwing");
{
  eq(T.normalizeFloors([]), [], "empty floors");
  eq(T.rootIndex([]), -1, "root of nothing");
  eq(T.childrenOf([], 0), [], "children of nothing");
  eq(T.layoutTree([]).cells, [], "layout of nothing");
}

console.log(`\nChecks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
