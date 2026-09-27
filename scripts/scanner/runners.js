import { isAP } from "./model.js";

export function isNetrunner(doc) {
  if (!doc?.actor || isAP(doc)) return false;
  const activeRole = doc.actor.system?.roleInfo?.activeNetRole;
  return Boolean(doc.actor.items?.some(item => item.type === "role" && (
    (activeRole && item.id === activeRole)
    || item.system?.mainRoleAbility === "interface"
    || [item.name, item.flags?.babele?.originalName].some(name => /^(netrunner|нетраннер|нетраннёр)$/i.test(String(name ?? "").trim()))
  )));
}

export function isPlayerOwned(doc) {
  return Boolean(doc?.actor && game.users.some(user => !user.isGM
    && doc.actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)));
}
