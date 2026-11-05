/* firebase-relay.js (JFC 2026-11-02): second durable layer. Speaks the same opaque relay protocol as the Supabase
   transport (op/ckpt → persist-result, pull v2 pages, head, ts) on a free Firebase Realtime Database through REST,
   so a device that connects alone still catches up when Supabase is unavailable. Frames stay end-to-end encrypted;
   Firebase only stores ciphertext. Photos come here at last priority (v661: relay-selector gives them only half of the daily cap). Exposes
   window.F123FirebaseRelay = { ckptFrameBytes, connect(url) } with a WebSocket-shaped socket. */
(function () {
  "use strict";
  var DB = "https://friendly-123-ab7b3-default-rtdb.firebaseio.com";
  var CKPT_CIPHER_BYTES = 768 * 1024, MAX_FRAME = 256 * 1024, PAGE_BUDGET = 1048576;
  // A single timestamp group must not trigger an unbounded Firebase REST download.
  // The numeric wire cursor cannot skip a partial group: fail closed if it exceeds this cap.
  var MAX_TIE_ITEMS = 256, MAX_TIE_JSON_BYTES = 4 * 1024 * 1024;
  // v661 (JFC 2026-11-04: photos at last priority but with the cascade): the photo room is accepted too.
  var LOC = /^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})(-y|-ops|-fotos)?$/;
  var enc = new TextEncoder();
  function b64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); }
  function unb64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function keyOf(id) { return String(id).replace(/[.#$\[\]\/%]/g, function (c) { return "%" + c.charCodeAt(0).toString(16); }); }
  function q(o) { return Object.keys(o).map(function (k) { return k + "=" + encodeURIComponent(o[k]); }).join("&"); }

  function create(opts) {
    var base = (opts && opts.db) || DB, fetchFn = (opts && opts.fetch) || function () { return fetch.apply(null, arguments); };
    var ES = (opts && "EventSource" in opts) ? opts.EventSource : (typeof EventSource === "function" ? EventSource : null);
    /* v663 (sync3 speed 2026-11-04): a cross-origin PUT with a JSON content type needs a CORS preflight, and Firebase
       sends no Access-Control-Max-Age, so browsers re-ask every ~5 s: one extra round trip (~140 ms from Ecuador) on
       almost every sale. Firebase REST accepts POST + ?x-http-method-override=PUT with a text/plain body (same PUT
       semantics, verified 2026-11-04), which is a "simple" request with no preflight. To undo: send method PUT again. */
    function http(method, path, body, query) {
      var simple = method === "PUT" && body !== undefined;
      var qs = (query ? q(query) : "") + (simple ? (query ? "&" : "") + "x-http-method-override=PUT" : "");
      return fetchFn(base + path + ".json" + (qs ? "?" + qs : ""), {
        method: simple ? "POST" : method, headers: {},
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }
    // shortcut: counts response bodies and live events read; headers and the echo of a PUT are not visible here. Upgrade if billing data is ever exposed to the client.
    var wireDown = 0;
    async function getJson(path, query, maxBytes) {
      var r = await http("GET", path, undefined, query), t = "";
      if (!r.ok) throw new Error("read " + r.status);
      if (maxBytes && r.body && typeof r.body.getReader === "function") {
        // Abort oversized responses *during download*, rather than holding the whole body in memory.
        var reader = r.body.getReader(), parts = [], total = 0;
        try {
          while (true) {
            var next = await reader.read(); if (next.done) break;
            total += next.value.byteLength;
            if (total > maxBytes) throw new Error("Firebase timestamp group exceeds safe byte budget");
            parts.push(next.value);
          }
          var bytes = new Uint8Array(total), offset = 0;
          parts.forEach(function (part) { bytes.set(part, offset); offset += part.byteLength; });
          t = new TextDecoder().decode(bytes);
        } catch (err) { try { await reader.cancel(); } catch (_) {} throw err; }
        finally { try { reader.releaseLock(); } catch (_) {} }
      } else {
        t = await r.text();
        if (maxBytes && t.length > maxBytes) throw new Error("Firebase timestamp group exceeds safe byte budget");
      }
      wireDown += t.length;
      return JSON.parse(t);
    }
    function decodeFrame(s) {
      // Do not silently discard a corrupt record while advancing the timestamp cursor.
      if (typeof s !== "string" || !s || s.length > 1450000 ||
          s.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))
        throw new Error("Invalid Firebase ciphertext encoding");
      return unb64(s);
    }
    // Firebase orders equal server timestamps by child key. Preserve that tie-breaker
    // even though REST JSON itself is unordered; incomplete ties must never advance a durable cursor.
    function sorted(obj) { return Object.keys(obj || {}).map(function (k) {
      var v = obj[k]; return v && typeof v.s === "number" && typeof v.c === "string" ?
        Object.assign({ _firebaseKey: k }, v) : null;
    }).filter(Boolean).sort(function (a, b) {
      return a.s - b.s || (a._firebaseKey < b._firebaseKey ? -1 : a._firebaseKey > b._firebaseKey ? 1 : 0);
    }); }

    function Socket(url) {
      var m = String(url).match(LOC);
      if (!m) throw new TypeError("Unsupported notebook locator");
      this.url = String(url); this.room = m[1] + (m[2] || ""); this.root = "/f123/" + this.room;
      this.readyState = 0; this.binaryType = "arraybuffer"; this.bufferedAmount = 0; this.peerOnly = false;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this._l = {}; this._durable = Promise.resolve(); this._reads = Promise.resolve(); this._seen = Object.create(null); this._es = null;
      this._tie = null; // in-socket staging only: on reconnect, replay starts from last completely durable timestamp
      var self = this;
      Promise.resolve().then(function () { return self._open(); });
    }
    Socket.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
    Socket.prototype.removeEventListener = function (t, f) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== f; }); };
    Socket.prototype._emit = function (type, props) {
      var e = { type: type, target: this }; for (var k in props || {}) e[k] = props[k];
      (this._l[type] || []).slice().forEach(function (f) { try { f(e); } catch (_) {} });
      if (typeof this["on" + type] === "function") try { this["on" + type](e); } catch (_) {}
    };
    Socket.prototype._text = function (v) { if (this.readyState === 1) this._emit("message", { data: JSON.stringify(v) }); };
    Socket.prototype._binary = function (bytes, source) {
      if (this.readyState !== 1) return;
      var data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      this._emit("message", { data: this.binaryType === "blob" ? new Blob([data]) : data, relaySource: source });
    };
    Socket.prototype._open = async function () {
      try {
        var r = await http("GET", this.root + "/k", undefined, { shallow: "true" }); // probes reachability and the room rule
        if (this.readyState !== 0) return;
        if (!r.ok) return this.close(r.status === 401 ? 1008 : 1011, "firebase relay unavailable");
        this.readyState = 1; this._emit("open"); this._text({ k: "peer-count", n: 1 });
        this._live();
      } catch (_) { if (this.readyState === 0) { this._emit("error"); this.close(1011, "firebase relay unavailable"); } }
    };
    // Other devices' durable writes arrive live through the REST event stream (new entries only).
    Socket.prototype._live = function () {
      if (!ES) return;
      var self = this, since = Date.now() - 1000;
      try {
        var es = new ES(base + this.root + "/o.json?" + q({ orderBy: '"s"', startAt: since }));
        this._es = es;
        var take = function (ev) {
          wireDown += String(ev.data || "").length;
          var msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
          if (!msg || !msg.data) return;
          var items = msg.path === "/" ? sorted(msg.data) : (msg.data.c ? [msg.data] : []);
          items.forEach(function (it) { if (!self._seen[it.c.length + ":" + it.c.slice(0, 64)]) { self._seen[it.c.length + ":" + it.c.slice(0, 64)] = 1; self._binary(unb64(it.c), "live"); } });
        };
        es.addEventListener("put", take); es.addEventListener("patch", take);
      } catch (_) {}
    };
    Socket.prototype.send = function (data) {
      if (this.readyState !== 1) throw new DOMException("Relay is not open", "InvalidStateError");
      var size = typeof data === "string" ? enc.encode(data).byteLength : (data.byteLength != null ? data.byteLength : data.size || 0);
      var control = null;
      if (typeof data === "string") { try { control = JSON.parse(data); } catch (_) {} }
      var ckpt = control && control.k === "ckpt" && typeof control.c === "string";
      if (size > (ckpt ? 1088 * 1024 : MAX_FRAME)) { this.close(1009, "frame too big"); return; }
      if (!control || !control.k) return; // live-only frames: durable ops already reach other devices
      var self = this, durable = control.k === "op" || control.k === "ckpt";
      var lane = (durable ? this._durable : this._reads).then(function () { return self._command(control); }).catch(function () { self._fail(); });
      if (durable) this._durable = lane; else this._reads = lane;
    };
    Socket.prototype._fail = function () { if (this.readyState < 2) { this._emit("error"); this.close(1011, "firebase relay unavailable"); } };
    Socket.prototype._rev = async function () {
      var ks = await getJson(this.root + "/k", { shallow: "true" });
      var revs = Object.keys(ks || {}).map(Number).filter(function (n) { return n > 0; });
      return revs.length ? Math.max.apply(null, revs) : 0;
    };
    Socket.prototype._command = async function (c) {
      if (this.readyState !== 1) return;
      if (c.k === "op") {
        var ok = false;
        if (typeof c.id === "string" && c.id && typeof c.c === "string") {
          var r = await http("PUT", this.root + "/o/" + keyOf(c.id), { s: { ".sv": "timestamp" }, c: c.c, lam: Number(c.lam) || 0 });
          // Append-only rule: an existing id is a retry of a stored op (same as the server's duplicate=true).
          ok = r.ok || (r.status === 401 && !!(await getJson(this.root + "/o/" + keyOf(c.id)).catch(function () { return null; })));
        }
        if (c.ack === 1 && typeof c.id === "string") this._text({ k: "persist-result", kind: "op", id: c.id, ok: ok, conflict: false });
        return;
      }
      if (c.k === "ckpt") {
        var res = { ok: false, conflict: false };
        try {
          var rev = await this._rev();
          if (Number(c.v) === 2 && Number(c.rev) !== rev) res.conflict = true;
          else {
            var w = await http("PUT", this.root + "/k/" + (rev + 1), { s: Number(c.seq) || 0, c: c.c, lam: Number(c.lam) || 0 });
            res.ok = w.ok; res.conflict = !w.ok && w.status === 401; // someone else wrote this revision first
          }
        } catch (_) {}
        if (c.ack === 1 && typeof c.id === "string") this._text({ k: "persist-result", kind: "ckpt", id: c.id, ok: res.ok, conflict: res.conflict });
        return;
      }
      if (c.k === "ts") {
        // Clock witness must be the server's, never the device's: use the HTTP Date header (1 s precision).
        var tr = await http("GET", this.root + "/k", undefined, { shallow: "true" });
        var t1 = Date.parse(tr.headers && tr.headers.get ? tr.headers.get("date") || "" : "");
        if (tr.ok && Number.isFinite(t1)) this._text({ k: "tsr", t0: c.t0, t1: t1 + 500 });
        return;
      }
      if (c.k === "head") {
        try {
          var hr = await this._rev(), last = sorted(await getJson(this.root + "/o", { orderBy: '"s"', limitToLast: 1 }));
          return this._text({ k: "head-result", v: 2, rev: hr, seq: last.length ? last[0].s : 0 });
        } catch (_) { return this._text({ k: "head-result", v: 2, unsupported: true }); }
      }
      if (c.k === "pull") {
        var curRev = await this._rev(), seq = Math.max(0, Number(c.seq) || 0), frames = [], budget = PAGE_BUDGET;
        var size = Math.min(128, Math.max(1, Number(c.limit) || 64));
        if (Number(c.v) !== 2 || Number(c.rev) !== curRev) {
          var yaLeido = seq; seq = 0;
          if (curRev > 0) {
            var k = await getJson(this.root + "/k/" + curRev);
            if (k && typeof k.c === "string") { frames.push(k.c); budget = Math.max(0, budget - k.c.length * 3 / 4); seq = Number(k.s) || 0; }
          }
          seq = Math.max(seq, yaLeido); // v651: a new photo must not replay ops this reader already has
        }
        // v668 safety: the protocol has a numeric timestamp cursor, not a per-key cursor.
        // Advancing it after only SOME operations at one millisecond loses every omitted
        // encrypted fragment forever. Consume complete timestamp groups only; when a
        // single group exceeds the frame budget, stage it in socket RAM, keep the OLD
        // cursor and acknowledge its timestamp only when EVERY member was sent.
        // A disconnect discards the staging and replays the entire group (Yjs is idempotent).
        var tie = this._tie;
        if (tie && (tie.rev !== curRev || tie.seq !== seq)) { this._tie = null; tie = null; }
        var page = tie ? [] : sorted(await getJson(this.root + "/o", { orderBy: '"s"', startAt: seq + 1, limitToFirst: size }));
        var lleno = page.length === size, kept = [], used = 0, more = false, newSeq = seq;
        if (!tie && lleno && page.length && page[0].s !== page[page.length - 1].s) {
          // A truncated final group is unproven: retry it on the next page.
          var lastS = page[page.length - 1].s;
          page = page.filter(function (it) { return it.s !== lastS; });
          more = true;
        }
        if (!tie) {
          for (var i = 0; i < page.length;) {
            var j = i + 1, groupBytes = page[i].c.length * 3 / 4;
            while (j < page.length && page[j].s === page[i].s) { groupBytes += page[j].c.length * 3 / 4; j++; }
            // A full page with one timestamp might hide arbitrarily many siblings;
            // likewise an oversized group cannot be cut after its first fragment.
            if ((lleno && page[0].s === page[page.length - 1].s) ||
                (i === 0 && groupBytes > budget)) {
              var entire = sorted(await getJson(this.root + "/o", {
                orderBy: '"s"', equalTo: page[i].s, limitToFirst: MAX_TIE_ITEMS + 1
              }, MAX_TIE_JSON_BYTES));
              if (entire.length > MAX_TIE_ITEMS) throw new Error("Firebase timestamp group exceeds safe item budget");
              if (!entire.length) throw new Error("Firebase timestamp group vanished");
              tie = this._tie = { rev: curRev, seq: seq, time: page[i].s, items: entire, index: 0 };
              break;
            }
            if (used + groupBytes > budget) { more = true; break; }
            for (var n = i; n < j; n++) kept.push(page[n]);
            used += groupBytes; newSeq = page[j - 1].s; i = j;
          }
          if (kept.length < page.length || lleno) more = true;
        }
        if (tie) {
          // Bound each returned page to PAGE_BUDGET without persisting a partial
          // timestamp. The group's in-memory offset is intentionally NOT durable.
          while (tie.index < tie.items.length) {
            var item = tie.items[tie.index], bytes = item.c.length * 3 / 4;
            if (used + bytes > budget) break;
            kept.push(item); used += bytes; tie.index++;
          }
          if (tie.index === tie.items.length) {
            newSeq = tie.time;
            this._tie = null;
          } else {
            newSeq = seq;
          }
          more = true; // verify later timestamps (and the HEAD) on the next pull
        }
        var self = this;
        // Validate ALL ciphertext before delivering any frame or advancing the cursor.
        var ready = frames.concat(kept.map(function (it) { return it.c; })).map(decodeFrame);
        ready.forEach(function (bytes, i) {
          var f = i < frames.length ? frames[i] : kept[i - frames.length].c;
          self._seen[f.length + ":" + f.slice(0, 64)] = 1;
          self._binary(bytes, "pull");
        });
        if (Number(c.v) === 2) this._text({ k: "pull-page", v: 2, rev: curRev, seq: newSeq, n: kept.length, more: more });
      }
    };
    Socket.prototype.close = function (code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 3; try { if (this._es) this._es.close(); } catch (_) {}
      this._emit("close", { code: code || 1000, reason: reason || "", wasClean: (code || 1000) === 1000 });
    };
    return {
      ckptFrameBytes: CKPT_CIPHER_BYTES,
      connect: function (url) { return new Socket(url); },
      wireDown: function () { return wireDown; },
      // Read-only head with no socket and no event stream, for diagnostics.
      leerHead: async function (url) {
        var m = String(url).match(LOC);
        if (!m) return null;
        var root = "/f123/" + m[1] + (m[2] || ""), last = sorted(await getJson(root + "/o", { orderBy: '"s"', limitToLast: 1 }));
        var revs = Object.keys((await getJson(root + "/k", { shallow: "true" })) || {}).map(Number).filter(function (n) { return n > 0; });
        return { rev: revs.length ? Math.max.apply(null, revs) : 0, seq: last.length ? last[0].s : 0 };
      }
    };
  }
  if (typeof window !== "undefined") { window.F123FirebaseRelay = create(); window.F123FirebaseRelay.create = create; }
})();
