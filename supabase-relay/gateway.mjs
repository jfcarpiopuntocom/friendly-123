// Supabase is the only data backend for the existing WebSocket-shaped callers.
// The old URL is a local room locator only; it is never opened as a socket.
// Route lookup happens only at connection time; no background polling is added.
export function createRelayGateway({ resolveRoute, native }) {
  const routes = new Map();
  function route(base) {
    const previous = routes.get(base), now = Date.now();
    if (previous && previous.until > now) return previous.promise;
    const promise = Promise.resolve().then(() => resolveRoute(base));
    routes.set(base, { until: now + 1000, promise });
    return promise;
  }
  class GatewaySocket extends EventTarget {
    readyState = 0; onopen = null; onmessage = null; onerror = null; onclose = null;
    #socket; #binaryType = 'blob';
    constructor(url) {
      super(); this.url = String(url);
      const match = this.url.match(/^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})(-y|-ops|-fotos)?$/);
      if (!match) throw new TypeError('Unsupported Friendly relay URL');
      route(match[1]).then(result => {
        if (this.readyState !== 0) return;
        // The route RPC authorizes native transport only when all four imported
        // channels are active. Never bypass that gate or send data to Cloudflare.
        if (result?.mode === 'legacy') {
          this.#closed(1013, 'native migration pending; local data retained', false);
          return;
        }
        if (result?.mode !== 'supabase') throw new Error('Unknown relay route');
        const socket = native(match[1] + (match[2] || ''));
        this.#socket = socket; socket.binaryType = this.#binaryType;
        socket.addEventListener('open', () => { if (this.readyState === 0) { this.readyState = 1; this.#emit('open'); } });
        socket.addEventListener('message', e => { if (this.readyState === 1) this.#emit('message', { data: e.data }); });
        socket.addEventListener('error', () => this.#emit('error'));
        socket.addEventListener('close', e => this.#closed(e.code, e.reason, e.wasClean));
        if (socket.readyState === 1) { this.readyState = 1; this.#emit('open'); }
      }).catch(() => { if (this.readyState !== 0) return; this.#emit('error'); this.#closed(1011, 'relay route unavailable', false); });
    }
    get binaryType() { return this.#binaryType; }
    set binaryType(value) { this.#binaryType = value; if (this.#socket) this.#socket.binaryType = value; }
    get bufferedAmount() { return this.#socket?.bufferedAmount || 0; }
    get protocol() { return this.#socket?.protocol || ''; }
    #emit(type, p = {}) {
      const e = type === 'message' ? new MessageEvent(type, p) : new Event(type);
      if (type !== 'message') for (const [key, value] of Object.entries(p)) Object.defineProperty(e, key, { value });
      this.dispatchEvent(e); if (typeof this['on' + type] === 'function') this['on' + type](e);
    }
    #closed(code = 1000, reason = '', wasClean = true) {
      if (this.readyState === 3) return;
      this.readyState = 3; this.#emit('close', { code, reason, wasClean });
    }
    send(value) {
      if (this.readyState !== 1) throw new DOMException('Relay is not open', 'InvalidStateError');
      this.#socket.send(value);
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      if (this.#socket) this.#socket.close(code, reason);
      else queueMicrotask(() => this.#closed(code, reason));
    }
  }
  return { connect(url) { return new GatewaySocket(url); } };
}
