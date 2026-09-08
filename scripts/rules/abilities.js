/* Which interface abilities are worth pressing where the runner is standing.
 *
 * This lived inline in the actions panel, and three separate bugs came out of
 * it — every one of them the same shape. A rule was written twice, once in the
 * chip that OFFERS the ability and once in the code that APPLIES the roll, and
 * the two copies drifted:
 *
 *   * Eye-Dee was lit only on a floor of kind "file", while the GM at the table
 *     puts his file on a floor he named himself. Dim, and inert if pressed.
 *   * A floor's named check was written as a plain assignment, so it did not
 *     only light a chip — it put one out. A file whose check is Eye-Dee went
 *     dark at the moment it was cracked, and a node whose check is Control went
 *     dark for good once taken, so a runner whose hold the GM had just stripped
 *     could not take it again.
 *
 * So the rules live here, alone, with no Foundry underneath them: pure inputs,
 * a plain object out, and `tools/test-abilities.mjs` to hold them to it.
 *
 * "Available" means LIT — worth spending a NET action on right now. An ability
 * that is not available is dimmed but still clickable: the fiction is allowed to
 * want a roll the rules did not predict.
 */

/**
 * Whether a floor holds something a runner could read — the condition behind
 * Eye-Dee.
 *
 * Not "is this floor of kind file": the GM builds a terminal, names it himself
 * and types what is inside. If he put something there, it can be read.
 *
 * @param {Object} floor
 * @returns {boolean}
 */
export function floorHoldsFile(floor) {
  if (!floor) return false;
  if (floor.kind === "file") return true;
  return !!String(floor.contents || "").trim() || !!String(floor.contentsImage || "").trim();
}

/**
 * Availability of every interface ability on one floor.
 *
 * @param {Object} args
 * @param {Object|null} args.floor      - the floor the runner stands on
 * @param {Object|null} args.fx         - that floor's session state {breached, control, eyedee}
 * @param {string} args.pid             - the runner's participant id
 * @param {boolean} args.isLeaf         - is this the bottom of its branch (Virus)
 * @param {string} [args.targetKind]    - kind of the current target ref ("ice", "prog", …)
 * @param {boolean} [args.targetIsBlackIce] - target is a player-placed Black ICE
 * @returns {Object} ability key → boolean
 */
export function availabilityFor({
  floor = null,
  fx = null,
  pid = "",
  isLeaf = false,
  targetKind = "",
  targetIsBlackIce = false,
} = {}) {
  const kind = floor?.kind || "";
  const breached = !!(fx && fx.breached);
  const eyedeeList = (fx && fx.eyedee) || [];

  const availability = {
    backdoor: kind === "password" && !breached,
    cloak: true,
    control: kind === "controlnode" && (fx?.control?.pid ?? null) !== pid,
    eyedee: floorHoldsFile(floor) && !eyedeeList.includes(pid),
    pathfinder: true,
    virus: !!isLeaf,
    // Slide vs an architecture's ICE, or a player-placed Black ICE (Addendum 2).
    // Demons are not slideable.
    slide: targetKind === "ice" || (targetKind === "prog" && !!targetIsBlackIce),
    zap: true,
  };

  // A floor may name the ability that opens it, and that naming WINS over the
  // guess made from its kind: a custom floor asking for Backdoor would otherwise
  // be judged by `kind === "password"` and sit dimmed over a DV nothing could be
  // rolled against.
  //
  // It may only ever LIGHT a chip, never put one out — see the note at the top.
  const check = floor?.check || "";
  if (check) availability[check] = !breached || availability[check] === true;

  return availability;
}
