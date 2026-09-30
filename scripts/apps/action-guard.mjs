/* One pending runner action per app per participant.
 *
 * A CPR roll dialog is asynchronous and the button that opened it stays live, so
 * a second click on the same runner used to open a second dialog and spend a
 * second NET action. The claim lives on the app instance, not on the DOM, so a
 * re-render (fresh listeners on fresh elements) does not release it. */

const busy = new WeakMap(); // app -> Set<pid>

function claims(app) {
  let set = busy.get(app);
  if (!set) { set = new Set(); busy.set(app, set); }
  return set;
}

/** Whether this app already has a runner action in flight for `pid`. */
export function runnerBusy(app, pid) {
  return !!app && !!pid && claims(app).has(pid);
}

/** Run `fn` while holding the runner's claim. A click that arrives while the
 *  claim is held is dropped (resolves undefined, `fn` never runs). The claim is
 *  released however `fn` ends — returns, cancels or throws. */
export async function withRunnerGuard(app, pid, fn) {
  if (!app || !pid) return fn();
  const set = claims(app);
  if (set.has(pid)) return undefined;
  set.add(pid);
  try { return await fn(); }
  finally { set.delete(pid); }
}
