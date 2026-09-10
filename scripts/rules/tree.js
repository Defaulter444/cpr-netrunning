/* Architecture topology — the floor tree.
 *
 * Upstream modelled an architecture as a straight chain: `floors` is an array
 * and "deeper" meant "higher index". The rulebook does not work that way — a
 * NET architecture forks (Corebook p. 210, branches a–h), and a runner picks
 * which way to go. This module turns the flat array into a tree without
 * changing its storage shape: every Floor gains a `parent` field holding the id
 * of the floor above it, and the array keeps its old meaning as "the set of
 * floors", not "the order of them".
 *
 * Keeping the array is deliberate. Everything upstream addresses floors by
 * index (`part.floorIndex`, `ice:<archId>:<floorId>:<iceId>`, editor rows), and
 * a tree stored as nested objects would have forced all of it to change at
 * once. With `parent` the index stays valid and only the *questions* change:
 * "what is below me" is no longer `index + 1` but `childrenOf(...)`.
 *
 * Everything here is pure: no Foundry, no world state, no I/O. That is what
 * makes `tools/test-tree.mjs` possible.
 */

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Give every floor a usable `parent`, migrating legacy chains in place.
 *
 * Architectures saved before branching existed have no `parent` anywhere. Such
 * an array IS a chain, so floor i descends from floor i-1 and floor 0 is the
 * entry point. Detecting that case by "nobody declares a parent" is safe: a
 * branched architecture always has at least one, because only the root may be
 * parentless.
 *
 * Called on every read path, so old worlds keep working without a migration
 * step the GM has to remember to run.
 *
 * @param {Array<Object>} floors - floors as stored
 * @returns {Array<Object>} - the same array, mutated
 */
export function normalizeFloors(floors) {
  if (!Array.isArray(floors) || !floors.length) return floors || [];

  const ids = new Set(floors.map((f) => f?.id).filter(Boolean));
  const declared = floors.some((f) => f && typeof f.parent === "string" && f.parent);

  floors.forEach((floor, i) => {
    if (!floor) return;
    if (!declared) {
      floor.parent = i === 0 ? "" : (floors[i - 1]?.id || "");
      return;
    }
    // A parent pointing at a floor that no longer exists would orphan the
    // subtree and hide it from the canvas entirely. Re-root instead: visible
    // and obviously wrong beats invisible and silently wrong.
    if (typeof floor.parent !== "string" || (floor.parent && !ids.has(floor.parent))) {
      floor.parent = "";
    }
    if (floor.parent === floor.id) floor.parent = "";

    // Extra entrances: drop the ones that point nowhere, at the floor itself,
    // or duplicate the primary parent.
    if (Array.isArray(floor.alsoFrom)) {
      floor.alsoFrom = [...new Set(floor.alsoFrom)]
        .filter((id) => id && id !== floor.id && id !== floor.parent && ids.has(id));
    } else if (floor.alsoFrom !== undefined) {
      floor.alsoFrom = [];
    }
  });

  breakCycles(floors);
  ensureSingleRoot(floors);
  return floors;
}

/**
 * Cut any parent link that closes a loop.
 *
 * A cycle cannot be drawn and cannot be walked — every traversal here would
 * spin forever. The GM can only create one by editing raw data, but a corrupt
 * world should degrade into a strange-looking tree, not a frozen tab.
 *
 * @param {Array<Object>} floors - floors with `parent` set
 */
function breakCycles(floors) {
  const byId = new Map(floors.map((f) => [f?.id, f]).filter(([id]) => id));
  for (const floor of floors) {
    if (!floor?.parent) continue;
    const seen = new Set([floor.id]);
    let up = byId.get(floor.parent);
    while (up) {
      if (seen.has(up.id)) {
        floor.parent = "";
        break;
      }
      seen.add(up.id);
      up = up.parent ? byId.get(up.parent) : null;
    }
  }
}

/**
 * Keep exactly one entry point.
 *
 * The runner jacks into one place, so a second parentless floor is not a second
 * architecture — it is a floor that lost its link. Hang the extras off the
 * first root so they stay reachable and the GM can see what happened.
 *
 * @param {Array<Object>} floors - floors with `parent` set
 */
function ensureSingleRoot(floors) {
  const roots = floors.filter((f) => f && !f.parent);
  if (roots.length <= 1) return;
  const keep = roots[0];
  for (const extra of roots.slice(1)) extra.parent = keep.id;
}

/* ------------------------------------------------------------------ */
/* Topology questions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Index of the entry floor, or -1 for an empty architecture.
 *
 * @param {Array<Object>} floors - normalised floors
 * @returns {Number}
 */
export function rootIndex(floors) {
  if (!Array.isArray(floors)) return -1;
  const at = floors.findIndex((f) => f && !f.parent);
  return at >= 0 ? at : (floors.length ? 0 : -1);
}

/**
 * Indices of the floors directly below this one.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - floor to look under
 * @returns {Array<Number>} - in array order, which is the GM's editor order
 */
export function childrenOf(floors, index) {
  const id = floors?.[index]?.id;
  if (!id) return [];
  const out = [];
  floors.forEach((f, i) => {
    if (f && f.parent === id) out.push(i);
  });
  return out;
}

/**
 * Index of the floor directly above, or -1 at the entry.
 *
 * This is the PRIMARY parent — the one the layout hangs the card from. A floor
 * may have more ways in (see `alsoFrom`); those are edges, not position.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - floor to look above
 * @returns {Number}
 */
export function parentOf(floors, index) {
  const parent = floors?.[index]?.parent;
  if (!parent) return -1;
  const at = floors.findIndex((f) => f?.id === parent);
  return at;
}

/**
 * Every floor that leads into this one — the primary parent and any extras.
 *
 * Two branches that fork apart and meet again is a shape the strict tree could
 * not express: one `parent` meant one way in, so the second branch had nowhere
 * to attach and the GM could not build a loop back to a shared floor. Extra
 * entrances live in `alsoFrom`, a list of floor ids.
 *
 * Only the primary parent decides where the card is drawn. The extras are drawn
 * as additional connectors, which is honest — the shape on screen then shows
 * exactly what the architecture is: two ways down into one place.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - floor to look above
 * @returns {Array<Number>} - primary first
 */
export function entrancesOf(floors, index) {
  const out = [];
  const primary = parentOf(floors, index);
  if (primary >= 0) out.push(primary);
  for (const id of floors?.[index]?.alsoFrom || []) {
    const at = floors.findIndex((f) => f?.id === id);
    if (at >= 0 && !out.includes(at)) out.push(at);
  }
  return out;
}

/**
 * Floors directly below this one by any route: children plus the floors that
 * name this one as an extra entrance.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - floor to look under
 * @returns {Array<Number>}
 */
export function exitsOf(floors, index) {
  const id = floors?.[index]?.id;
  const out = childrenOf(floors, index);
  if (!id) return out;
  floors.forEach((f, i) => {
    if (!f || out.includes(i)) return;
    if ((f.alsoFrom || []).includes(id)) out.push(i);
  });
  return out;
}

/**
 * How far below the entry this floor sits. Entry is 0.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - floor to measure
 * @returns {Number}
 */
export function depthOf(floors, index) {
  let depth = 0;
  let at = index;
  const guard = floors?.length ?? 0;
  while (at >= 0 && depth <= guard) {
    const up = parentOf(floors, at);
    if (up < 0) break;
    at = up;
    depth += 1;
  }
  return depth;
}

/**
 * Floors a runner standing here may step to: the one above and the ones below.
 *
 * This replaces upstream's `index ± 1`. Sideways moves are not a thing — the
 * rulebook's lift metaphor only goes up and down (Corebook p. 208).
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - where the runner stands
 * @returns {Array<Number>}
 */
export function adjacentOf(floors, index) {
  const out = [...entrancesOf(floors, index)];
  for (const at of exitsOf(floors, index)) {
    if (!out.includes(at)) out.push(at);
  }
  return out;
}

/**
 * Is this a dead end? The Virus ability only works at the bottom.
 *
 * A forked architecture has several bottoms, one per branch, and the rulebook
 * is explicit that the virus goes on "the lowest level" — which in a tree means
 * a leaf, not the last array element as upstream assumed.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - floor to test
 * @returns {Boolean}
 */
export function isLeaf(floors, index) {
  return exitsOf(floors, index).length === 0;
}

/**
 * Every floor below this one, breadth-first.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - subtree root
 * @returns {Array<Number>} - excludes `index` itself
 */
export function descendantsOf(floors, index) {
  const out = [];
  const queue = childrenOf(floors, index);
  const seen = new Set(queue);
  while (queue.length) {
    const at = queue.shift();
    out.push(at);
    for (const child of childrenOf(floors, at)) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * The chain of floors from the entry down to this one, inclusive.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} index - destination floor
 * @returns {Array<Number>} - entry first
 */
export function pathFromRoot(floors, index) {
  const out = [];
  let at = index;
  const guard = floors?.length ?? 0;
  while (at >= 0 && out.length <= guard) {
    out.unshift(at);
    at = parentOf(floors, at);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pathfinder                                                          */
/* ------------------------------------------------------------------ */

/**
 * Which floors a Pathfinder roll uncovers.
 *
 * The rules: you see as many levels down as your roll, or up to the first
 * obstacle you could not have beaten, whichever comes first (Corebook p. 201).
 * On a tree that means walking every branch below you and stopping each branch
 * on its own — one locked door does not blind the other corridor.
 *
 * The blocking floor is itself revealed. The runner learns that something is in
 * the way; what he does not learn is what lies beyond it.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Number} from - where the runner stands
 * @param {Number} total - the Pathfinder roll total
 * @param {Function} blocks - (floor) => Boolean, true when it stops the sweep
 * @returns {Array<Number>} - revealed floors, excluding `from`
 */
export function revealFrom(floors, from, total, blocks) {
  const depth = Math.max(0, Number(total) || 0);
  if (!depth) return [];

  const out = [];
  const seen = new Set([from]);
  let frontier = exitsOf(floors, from);

  for (let step = 1; step <= depth && frontier.length; step += 1) {
    const next = [];
    for (const at of frontier) {
      if (seen.has(at)) continue;
      seen.add(at);
      out.push(at);
      // Revealed, but the sweep does not continue past it.
      if (blocks?.(floors[at])) continue;
      next.push(...exitsOf(floors, at));
    }
    frontier = next;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Slide a floor that several branches join to the midpoint between them.
 *
 * The post-order pass centres a parent over its children, which is the right
 * rule going down. It says nothing about going back UP: a floor reachable from
 * two parents is the child of exactly one of them, so it is placed under that
 * branch and the second entrance reaches it sideways. On screen the join looks
 * like an afterthought hanging off the left-hand branch rather than the seam
 * between the two.
 *
 * So move it, and everything under it, to the average of its entrances — but
 * only while the move keeps every card in the affected rows a full column
 * apart. A tidy tree whose cards overlap is worse than one merely off-centre,
 * and refusing the slide is always safe: the layout stays exactly as the
 * post-order left it.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Array<Number>} row - depth per floor, filled by the caller
 * @param {Array<Number>} col - fractional column per floor, mutated in place
 * @param {Set<Number>} placed - floors the post-order actually reached
 */
function centreMergeFloors(floors, row, col, placed) {
  const merges = [];
  for (let i = 0; i < floors.length; i += 1) {
    if (!floors[i] || !placed.has(i)) continue;
    if (entrancesOf(floors, i).length > 1) merges.push(i);
  }
  if (!merges.length) return;
  // Shallowest first: moving an upper join changes where the lower ones want to
  // sit, and the deeper pass then measures against the settled position.
  merges.sort((a, b) => row[a] - row[b]);

  for (const at of merges) {
    const parents = entrancesOf(floors, at).filter((p) => placed.has(p));
    if (parents.length < 2) continue;
    const target = parents.reduce((sum, p) => sum + col[p], 0) / parents.length;
    const delta = target - col[at];
    if (Math.abs(delta) < 1e-6) continue;

    const moving = new Set([at, ...descendantsOf(floors, at)]);
    let clear = true;
    for (const i of moving) {
      if (!clear) break;
      const want = col[i] + delta;
      for (let j = 0; j < floors.length; j += 1) {
        if (moving.has(j) || !placed.has(j) || !floors[j]) continue;
        if (row[j] !== row[i]) continue;
        if (Math.abs(col[j] - want) < 1 - 1e-6) { clear = false; break; }
      }
    }
    if (!clear) continue;
    for (const i of moving) col[i] += delta;
  }
}

/* Distance between neighbouring leaves, in card widths.
 *
 * One would be enough to lay out a plain tree, and that is what this was. But a
 * packed row has no slack anywhere, and a floor two branches join wants to sit
 * at the MIDPOINT between them — half a step, which in a packed row is always
 * somebody else's cell. Every join in a real architecture was refused for want
 * of a gap that only ever measured half a card.
 *
 * Two gives every midpoint a cell of its own. It does not cost width: the grid
 * scales fractional columns up to whole tracks afterwards, and coarser columns
 * need less of that — on the architectures this was measured against the finished
 * map came out NARROWER than with a step of one, not wider.
 */
const LEAF_STEP = 2;

/**
 * Place the tree on a grid: row = depth, column = horizontal slot.
 *
 * A tidy-tree pass. Leaves take the next free column left to right; a parent
 * centres itself over its children. Columns come out fractional on purpose —
 * a node above two children sits at 0.5, which is exactly where a drawn
 * connector wants it.
 *
 * @param {Array<Object>} floors - normalised floors
 * @returns {Object} - {cells: [{index, row, col}], rows, cols}
 */
export function layoutTree(floors) {
  const cells = [];
  if (!Array.isArray(floors) || !floors.length) return { cells, rows: 0, cols: 0 };

  const col = new Array(floors.length).fill(0);
  const row = new Array(floors.length).fill(0);
  let nextLeaf = 0;

  // Iterative post-order: a parent needs its children placed first, and a deep
  // architecture would otherwise risk the call stack.
  const root = rootIndex(floors);
  const stack = [[root, false]];
  const placed = new Set();

  while (stack.length) {
    const [at, expanded] = stack.pop();
    if (at < 0 || placed.has(at)) continue;
    const kids = childrenOf(floors, at);

    if (!expanded && kids.length) {
      stack.push([at, true]);
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push([kids[i], false]);
      continue;
    }

    placed.add(at);
    row[at] = depthOf(floors, at);
    if (!kids.length) {
      col[at] = nextLeaf;
      nextLeaf += LEAF_STEP;
    } else {
      const first = col[kids[0]];
      const last = col[kids[kids.length - 1]];
      col[at] = (first + last) / 2;
    }
  }

  centreMergeFloors(floors, row, col, placed);

  // Floors that never got placed are orphans normalisation could not save.
  // Park them in their own columns rather than stacking them all at zero.
  floors.forEach((floor, i) => {
    if (placed.has(i) || !floor) return;
    row[i] = 0;
    col[i] = nextLeaf;
    nextLeaf += 1;
  });

  floors.forEach((floor, i) => {
    if (!floor) return;
    cells.push({ index: i, row: row[i], col: col[i] });
  });

  // Columns come out fractional: a parent over two children sits at 0.5, and a
  // grandparent over 0.5 and 2 sits at 1.25. CSS grid lines are integers, so a
  // fractional placement silently collapses and the cards land on top of each
  // other. Scale everything up until the values ARE integers, and let a card
  // span `unit` tracks instead of one.
  let unit = 1;
  const offGrid = (m) => cells.some((c) => Math.abs(c.col * m - Math.round(c.col * m)) > 1e-6);
  while (unit < 64 && offGrid(unit)) unit *= 2;

  const rows = cells.reduce((m, c) => Math.max(m, c.row), 0) + 1;
  for (const cell of cells) cell.col = Math.round(cell.col * unit);
  const widest = cells.reduce((m, c) => Math.max(m, c.col), 0);

  // `tracks` counts the scaled columns the grid needs: the rightmost card
  // starts at `widest` and is `unit` wide.
  return { cells, rows, unit, tracks: widest + unit, cols: Math.max(1, nextLeaf) };
}

/**
 * Connector segments between floors, in the same grid coordinates as `layout`.
 *
 * @param {Array<Object>} floors - normalised floors
 * @param {Object} layout - result of `layoutTree`
 * @returns {Array<Object>} - [{from, to, fromRow, fromCol, toRow, toCol}]
 */
export function linksOf(floors, layout) {
  const at = new Map(layout.cells.map((c) => [c.index, c]));
  const out = [];
  const push = (up, i, extra) => {
    const a = at.get(up);
    const b = at.get(i);
    if (!a || !b) return;
    out.push({
      from: up, to: i,
      fromRow: a.row, fromCol: a.col, toRow: b.row, toCol: b.col,
      // An extra entrance is a real way down, but not the one the card hangs
      // from. Drawn differently so a convergence reads as a convergence rather
      // than as two floors that happen to be near each other.
      extra: !!extra,
    });
  };
  floors.forEach((floor, i) => {
    if (!floor) return;
    const up = parentOf(floors, i);
    if (up >= 0) push(up, i, false);
    for (const id of floor.alsoFrom || []) {
      const other = floors.findIndex((f) => f?.id === id);
      if (other >= 0) push(other, i, true);
    }
  });
  return out;
}
