/* Module socket router. */

import { MODULE_ID, SOCKET_NAME } from "./constants.js";
import { applyOp, isPrimaryGM, resolveMutation } from "./data.js";

export function initSocket() {
  game.socket.on(SOCKET_NAME, async (data) => {
    if (!data?.action) return;
    switch (data.action) {
      case "mutate": {
        // Only the primary GM applies relayed mutations (avoids double-writes).
        if (!isPrimaryGM()) break;
        const result = await applyOp(data.op, data.payload, data.userId);
        if (data.requestId) {
          game.socket.emit(SOCKET_NAME, {
            action: "mutateResult",
            requestId: data.requestId,
            targetUserId: data.userId,
            result: (typeof result === "string" || typeof result === "boolean" || typeof result === "object")
              ? result
              : !!result,
          });
        }
        break;
      }
      case "mutateResult":
        if (data.targetUserId === game.user.id) resolveMutation(data.requestId, data.result);
        break;
      case "notify":
        Hooks.callAll(`${MODULE_ID}.notify`, data);
        break;
      default:
        break;
    }
  });
}

export function emitSocket(data) {
  game.socket.emit(SOCKET_NAME, data);
}
