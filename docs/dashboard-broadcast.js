/* Dashboard-only encrypted ephemeral bridge. Reuses the already-loaded Supabase Realtime SDK.
   App and dashboard exchange ONLY AES-GCM ciphertext from sync-realtime.js; no business persistence.
   Feature rollback: set window.F123_DASH_BROADCAST=false BEFORE this script. */
(function () {
  "use strict";
  var LOC = /^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})$/;
  var MAX_CIPHER_BYTES = 256 * 1024, PART_CHARS = 8192, MAX_PARTS = 64;
  function id() {
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b, function (n) { return n.toString(16).padStart(2, "0"); }).join("");
  }
  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }
  function raw64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  class Socket extends EventTarget {
    constructor(url) {
      super();
      var match = String(url).match(LOC);
      if (!match) throw new TypeError("Unsupported dashboard notebook locator");
      var client = window.F123DashboardRealtime;
      if (!client || typeof client.channel !== "function") throw new Error("Dashboard transient transport unavailable");
      this.readyState = 0; this.binaryType = "arraybuffer"; this.bufferedAmount = 0; this.peerOnly = false;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this._id = id(); this._groups = new Map(); this._queue = Promise.resolve(); this._closed = false;
      this._channel = client.channel("f123-dash-" + match[1], { config: { broadcast: { self: false, ack: false }, private: false } });
      this._channel.on("broadcast", { event: "frame" }, (m) => this._receive(m && m.payload));
      this._channel.subscribe((status) => {
        if (this._closed) return;
        if (status === "SUBSCRIBED") {
          if (this.readyState !== 1) { this.readyState = 1; this._emit("open"); }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this._emit("error"); this.close(1011, "dashboard transient channel unavailable");
        }
      });
    }
    _emit(type, detail) {
      var e = type === "message" ? new MessageEvent("message", { data: detail }) : new Event(type);
      this.dispatchEvent(e);
      var fn = this["on" + type]; if (typeof fn === "function") try { fn(e); } catch (_) {}
    }
    _receive(p) {
      if (this.readyState !== 1 || !p || typeof p !== "object" || p.from === this._id ||
          !/^[a-f0-9]{32}$/.test(p.from) || !/^[a-f0-9]{32}$/.test(p.id) ||
          !Number.isSafeInteger(p.n) || p.n < 1 || p.n > MAX_PARTS ||
          !Number.isSafeInteger(p.i) || p.i < 0 || p.i >= p.n ||
          typeof p.c !== "string" || p.c.length < 1 || p.c.length > PART_CHARS ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.c)) return;
      var now = Date.now();
      for (var [key, value] of this._groups) if (now - value.when > 45000) this._groups.delete(key);
      var key = p.from + ":" + p.id, g = this._groups.get(key);
      if (!g) {
        if (this._groups.size >= 32) return;
        g = { n: p.n, parts: new Array(p.n), count: 0, len: 0, when: now };
        this._groups.set(key, g);
      }
      if (g.n !== p.n || g.parts[p.i]) return;
      g.parts[p.i] = p.c; g.count++; g.len += p.c.length;
      if (g.len > Math.ceil(MAX_CIPHER_BYTES * 4 / 3) + 4) { this._groups.delete(key); return; }
      if (g.count !== g.n) return;
      this._groups.delete(key);
      try {
        var text = g.parts.join("");
        // A ciphertext packet remains opaque and is decrypted by existing PIN-gated code only.
        var bytes = raw64(text);
        if (bytes.byteLength <= MAX_CIPHER_BYTES) this._emit("message", bytes);
      } catch (_) {}
    }
    send(data) {
      if (this.readyState !== 1) throw new DOMException("Dashboard socket is not open", "InvalidStateError");
      if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new TypeError("Dashboard transport requires encrypted binary");
      var bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (!bytes.length || bytes.length > MAX_CIPHER_BYTES) throw new RangeError("Dashboard ciphertext too large");
      var body = b64(bytes), count = Math.ceil(body.length / PART_CHARS);
      if (count > MAX_PARTS) throw new RangeError("Dashboard ciphertext exceeds chunk budget");
      var chunkId = id(), channel = this._channel, ownId = this._id, self = this;
      this._queue = this._queue.then(async function () {
        for (var i = 0; i < count; i++) {
          if (self.readyState !== 1) return;
          var result = await channel.send({ type: "broadcast", event: "frame", payload: {
            from: ownId, id: chunkId, i: i, n: count, c: body.slice(i * PART_CHARS, (i + 1) * PART_CHARS)
          } });
          if (result !== "ok") throw new Error("Dashboard broadcast not accepted");
        }
      }).catch(function () { if (self.readyState === 1) { self._emit("error"); self.close(1011); } });
    }
    close(code, reason) {
      if (this._closed) return;
      this._closed = true; this.readyState = 3; this._groups.clear();
      try { this._channel.unsubscribe(); } catch (_) {}
      var e = new CloseEvent("close", { code: code === 1011 ? 1011 : 1000, reason: String(reason || "") });
      this.dispatchEvent(e);
      if (typeof this.onclose === "function") try { this.onclose(e); } catch (_) {}
    }
  }
  window.F123DashboardBroadcast = { connect: function (url) {
    if (window.F123_DASH_BROADCAST === false) throw new Error("Dashboard broadcast disabled");
    return new Socket(url);
  } };
})();