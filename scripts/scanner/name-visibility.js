import { apData, canSeeAP, isAP } from "./model.js";
import { setting } from "./settings.js";

/** A selected character uses its own discovery, not the GM's administrative rights. */
export function knowsAP(doc, viewer) {
  const discovery = apData(doc).discovery;
  if (!discovery?.revealed) return false;
  if (discovery.public) return true;
  // Explicit token grants take precedence over shared owners of multiple characters.
  if (discovery.runners?.length) return discovery.runners.includes(viewer.uuid);
  // Older/API grants may contain only user IDs. Never inherit the GM's ownership.
  return Boolean(viewer.actor && game.users.some(user => !user.isGM
    && discovery.users?.includes(user.id)
    && viewer.actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)));
}

/** Name disclosure follows current token sight, never explored fog or scanner pulses.
 * Uses v12's basic sight/light-perception tests directly: CanvasVisibility.testVisibility
 * also accepts scanner-created vision lights, which would reveal names through walls.
 */
export function canReadAPName(token) {
  const doc = token.document;
  if (!canSeeAP(doc, game.user)) return false;
  const selected = game.user.isGM ? (canvas.tokens?.controlled ?? [])
    .filter(viewer => viewer.actor && !isAP(viewer.document)) : [];
  if (game.user.isGM && !selected.length) return true;
  const known = selected.filter(viewer => knowsAP(doc, viewer.document));
  if (selected.length && !known.length) return false;
  if (!(apData(doc).showName ?? setting("showLabels"))) return false;
  if (!canvas.ready || !canvas.scene) return false;
  if (canvas.scene.tokenVision === false) return true;

  const point = token.center;
  const rect = canvas.dimensions?.sceneRect;
  if (!point || !rect) return false;
  const inScene = rect.contains(point.x, point.y);
  // Test the physical position, not the deliberately hidden helper Token.
  const config = { object: null, tests: [{ point, elevation: doc.elevation ?? 0, los: new Map() }] };
  for (const source of canvas.effects?.visionSources?.values() ?? []) {
    // The same character must both know and see the point. Other selected tokens
    // and global GM vision cannot lend their sight to it.
    if (selected.length && !known.some(viewer => viewer.id === source.object?.id)) continue;
    if (!source.active || source.isBlinded || rect.contains(source.x, source.y) !== inScene) continue;
    const modes = source.object?.document?.detectionModes ?? [];
    for (const id of ["basicSight", "lightPerception"]) {
      const mode = modes.find(candidate => candidate.id === id);
      if (mode && CONFIG.Canvas.detectionModes?.[id]?.testVisibility(source, mode, config) === true) return true;
    }
  }
  return false;
}
