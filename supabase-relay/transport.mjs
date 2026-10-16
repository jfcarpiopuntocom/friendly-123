// Infrastructure adapter for the existing encrypted relay protocol.
// Inject one Supabase client per device. Each room uses a private channel on
// that client's shared connection; this module never opens or edits business data.
const MAX_FRAME = 256 * 1024;
const MAX_BUFFER = 4 * 1024 * 1024;
const encoder = new TextEncoder();

export function createRelayTransport({ client, maxPeers = 12 }) {
  if (!client?.rpc || !client?.channel) throw new TypeError('Supabase client required');
  const sockets = new Set();
  let disposed = false;

  class RelaySocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3;
    readyState = 0; binaryType = 'arraybuffer'; bufferedAmount = 0;
    onopen = null; onmessage = null; onclose = null; onerror = null;
    #channel; #serial = Promise.resolve(); #liveSerial = Promise.resolve(); #remove = Promise.resolve();
    #key = crypto.randomUUID();

    constructor(room) {
      super();
      if (disposed) throw new Error('Relay transport disposed');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(room)) throw new TypeError('Invalid relay room');
      this.room = room;
      sockets.add(this);
      queueMicrotask(() => this.#join());
    }

    #emit(type, properties = {}) {
      const event = type === 'message' ? new MessageEvent(type, properties) : new Event(type);
      if (type === 'message' && properties.relaySource) Object.defineProperty(event, 'relaySource', { value: properties.relaySource });
      if (type !== 'message') for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
      this.dispatchEvent(event);
      if (typeof this['on' + type] === 'function') this['on' + type](event);
    }

    async #join() {
      try {
        const gate = await client.rpc('f123_relay_has_topic', { p_topic: 'friendly:' + this.room });
        if (this.readyState !== 0) return;
        if (gate.error || gate.data !== true) return this.close(1008, 'room unavailable');
        this.#channel = client.channel('friendly:' + this.room, {
          config: { private: true, broadcast: { ack: true, self: false }, presence: { key: this.#key } }
        });
        this.#channel
          .on('broadcast', { event: 'opaque-frame' }, ({ payload }) => {
            if (this.readyState !== 1) return;
            if (typeof payload === 'string') {
              if (encoder.encode(payload).byteLength <= MAX_FRAME) this.#emit('message', { data: payload });
              return;
            }
            const bytes = asBytes(payload);
            if (bytes && bytes.byteLength <= MAX_FRAME) this.#binary(bytes);
          })
          .on('presence', { event: 'sync' }, () => this.#presence())
          .subscribe(async status => {
            if (this.readyState >= 2) return;
            if (status === 'SUBSCRIBED') {
              if (this.readyState === 1) return;
              try {
                const tracked = await this.#channel.track({ connected: true });
                if (this.readyState !== 0) return;
                if (tracked !== 'ok') return this.close(1011, 'presence unavailable');
                this.readyState = 1;
                this.#emit('open');
                this.#presence();
              } catch (_) { this.#fail(); }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.#fail();
          });
      } catch (_) { this.#fail(); }
    }

    #presence() {
      if (this.readyState !== 1) return;
      const state = this.#channel.presenceState();
      const keys = Object.keys(state).sort();
      // Deterministic admission: a transient excess cannot eject every peer.
      if (keys.indexOf(this.#key) >= maxPeers) return this.close(1013, 'room full');
      const n = Math.max(1, keys.reduce((sum, key) => sum + state[key].length, 0));
      this.#text({ k: 'peer-count', n });
    }

    #text(value) { if (this.readyState === 1) this.#emit('message', { data: JSON.stringify(value) }); }
    #binary(value, relaySource = 'live') {
      const bytes = asBytes(value);
      if (!bytes || this.readyState !== 1) return;
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      this.#emit('message', { data: this.binaryType === 'blob' ? new Blob([data]) : data, relaySource });
    }
    #fail() {
      if (this.readyState >= 2) return;
      this.#emit('error');
      this.close(1011, 'relay unavailable');
    }

    send(data) {
      if (this.readyState !== 1) throw new DOMException('Relay is not open', 'InvalidStateError');
      // Match WebSocket.send: copy mutable buffers at call time.
      const copied = typeof data === 'string' || data instanceof Blob ? data : asBytes(data)?.slice();
      if (copied === undefined) throw new TypeError('Unsupported relay frame');
      const size = typeof copied === 'string' ? encoder.encode(copied).byteLength : copied.size ?? copied.byteLength;
      if (size > MAX_FRAME) { this.close(1009, 'frame too big'); return; }
      if (this.bufferedAmount + size > MAX_BUFFER) {
        this.close(1013, 'relay buffer full');
        throw new DOMException('Relay buffer full', 'QuotaExceededError');
      }
      this.bufferedAmount += size;
      let control;
      if (typeof copied === 'string') {
        try { control = JSON.parse(copied); } catch (_) { /* legacy text is forwarded */ }
      }
      // Keep RPC writes/checkpoints/replay ordered, but never hold immediate
      // encrypted frames behind a slow HTTP response. Both lanes share backpressure.
      const durableLane = control && ['op', 'ckpt', 'pull', 'ts'].includes(control.k);
      const queued = (durableLane ? this.#serial : this.#liveSerial).then(async () => {
        if (this.readyState !== 1) return;
        const frame = copied instanceof Blob ? new Uint8Array(await copied.arrayBuffer()) : copied;
        if (this.readyState !== 1) return;
        if (control && typeof control === 'object' && control.k) return this.#command(control);
        // Realtime's WS serializer accepts ArrayBuffer for binary; typed arrays
        // would become a JSON object and no longer be the original wire bytes.
        const payload = typeof frame === 'string' ? frame : frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
        const sent = await this.#channel.send({ type: 'broadcast', event: 'opaque-frame', payload });
        if (sent !== 'ok') this.#fail();
      }).catch(() => this.#fail()).finally(() => { this.bufferedAmount = Math.max(0, this.bufferedAmount - size); });
      if (durableLane) this.#serial = queued; else this.#liveSerial = queued;
    }

    async #command(command) {
      if (command.k === 'lat') {
        const sent = await this.#channel.send({ type: 'broadcast', event: 'opaque-frame', payload: JSON.stringify({
          k: 'lat', oTs: command.oTs, etq: typeof command.etq === 'string' ? command.etq.slice(0, 24) : ''
        }) });
        if (sent !== 'ok') this.#fail();
        return;
      }
      if (!['op', 'ckpt', 'pull', 'ts'].includes(command.k)) return;
      const durable = command.k === 'op' || command.k === 'ckpt';
      let data, error;
      try {
        ({ data, error } = await client.rpc('f123_relay_command', {
          p_room: this.room, p_action: command.k, p_message: command
        }));
      } catch (caught) { error = caught; }
      if (this.readyState !== 1) return;
      if (durable) {
        if (command.ack === 1 && typeof command.id === 'string') this.#text({
          k: 'persist-result', kind: command.k, id: command.id,
          ok: !error && data?.ok === true, conflict: !error && data?.conflict === true
        });
        return;
      }
      if (error || !data) return this.#fail();
      if (command.k === 'ts') return this.#text(data);
      for (const encoded of data.frames || []) this.#binary(fromBase64(encoded), 'pull');
      if (Number(command.v) === 2) this.#text({ k: 'pull-page', v: 2, rev: data.rev, seq: data.seq, more: data.more, n: data.n });
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      this.#remove = this.#channel ? Promise.resolve(client.removeChannel(this.#channel)).catch(() => {}) : Promise.resolve();
      sockets.delete(this);
      this.readyState = 3;
      this.#emit('close', { code, reason, wasClean: code === 1000 });
    }
    async settled() { await Promise.all([this.#serial, this.#liveSerial, this.#remove]); }
  }

  return {
    connect(room) { return new RelaySocket(room); },
    async dispose() {
      disposed = true;
      const active = [...sockets];
      for (const socket of active) socket.close();
      await Promise.all(active.map(socket => socket.settled()));
      client.realtime.disconnect();
    }
  };
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
function fromBase64(value) {
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
