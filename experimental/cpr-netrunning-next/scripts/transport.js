import { ID } from "./store.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const CHANNEL = `module.${ID}`;

function b64(bytes) {
  const a = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < a.length; i += 8192) text += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(text);
}

function un64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function uid() {
  return foundry.utils.randomID(20);
}

export function authority() {
  return game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export class SecureTransport {
  constructor() {
    this.secure = false;
    this.pair = null;
    this.keys = new Map();
    this.seen = new Map();
    this.pending = new Map();
    this.handler = null;
  }

  async initialize(handler) {
    this.handler = handler;
    game.socket.on(CHANNEL, (packet) => this.receive(packet).catch((error) => console.debug(`${ID} | rejected packet`, error.message)));
    if (!globalThis.crypto?.subtle) return false;

    this.pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    const publicKey = await crypto.subtle.exportKey("jwk", this.pair.publicKey);
    await game.user.setFlag(ID, "transportKey", publicKey);
    this.secure = true;
    return true;
  }

  async key(userId) {
    if (!this.secure || !this.pair) throw new Error("Secure NET controls require HTTPS (or localhost).");
    const jwk = game.users.get(userId)?.getFlag(ID, "transportKey");
    if (!jwk) throw new Error("The other client has not initialized secure NET controls yet.");
    const fingerprint = JSON.stringify(jwk);
    const cached = this.keys.get(userId);
    if (cached?.fingerprint === fingerprint) return cached.key;

    const remote = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const key = await crypto.subtle.deriveKey(
      { name: "ECDH", public: remote },
      this.pair.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    this.keys.set(userId, { fingerprint, key });
    return key;
  }

  async send(to, body) {
    const header = { from: game.user.id, to, id: uid(), time: Date.now() };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(JSON.stringify(header)) },
      await this.key(to),
      enc.encode(JSON.stringify(body))
    );
    game.socket.emit(CHANNEL, { ...header, iv: b64(iv), data: b64(data) });
  }

  async receive(packet) {
    if (!this.secure || !packet || packet.to !== game.user.id || typeof packet.data !== "string") return;
    const { from, to, id, time } = packet;
    if (!game.users.get(from)?.active) throw new Error("Sender is not active.");
    if (typeof id !== "string" || !Number.isFinite(time) || Math.abs(Date.now() - time) > 120000) throw new Error("Expired packet.");
    const replayKey = `${from}:${id}`;
    if (this.seen.has(replayKey)) throw new Error("Replay rejected.");

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: un64(packet.iv), additionalData: enc.encode(JSON.stringify({ from, to, id, time })) },
      await this.key(from),
      un64(packet.data)
    );
    this.seen.set(replayKey, time);
    for (const [key, ts] of this.seen) if (Date.now() - ts > 120000) this.seen.delete(key);
    const body = JSON.parse(dec.decode(plaintext));

    if (body.kind === "request") {
      if (authority()?.id !== game.user.id) throw new Error("Not the authoritative GM.");
      try {
        const result = await this.handler(game.users.get(from), body.request);
        await this.send(from, { kind: "reply", requestId: body.requestId, ok: true, result });
      } catch (error) {
        await this.send(from, { kind: "reply", requestId: body.requestId, ok: false, error: error.message });
      }
      return;
    }

    if (from !== authority()?.id) throw new Error("Only the authoritative GM can reply.");
    if (body.kind === "reply") {
      const pending = this.pending.get(body.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(body.requestId);
      if (body.ok) pending.resolve(body.result);
      else pending.reject(new Error(body.error || "GM rejected the NET request."));
    }
  }

  async request(request) {
    const gm = authority();
    if (!gm) throw new Error("No active GM. The NET session is preserved.");
    if (gm.id === game.user.id) return this.handler(game.user, request);
    if (!this.secure) throw new Error("Player NET controls require HTTPS (or localhost). The GM can still operate the lab locally.");

    const requestId = uid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("GM request timed out. Reopen the NET view and retry."));
      }, 60000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send(gm.id, { kind: "request", requestId, request }).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }
}
