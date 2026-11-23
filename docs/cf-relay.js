/* cf-relay.js (C224, MDD-2026-10-31 #2): first durable encrypted layer on Cloudflare Durable Objects SQLite.
   Speaks the exact same opaque E2E-encrypted relay protocol as firebase-relay.js (op/ckpt -> persist-result,
   pull v2 pages, head -> head-result, ts -> tsr) so money, sales, transactions, commissions, expenses and customers
   converge on any new device without depending on Firebase/Supabase free-tier caps.
   Frames stay end-to-end AES-256-GCM encrypted in the browser; Cloudflare stores ciphertext only.
   Authenticated per store and role (dueno, admin, empleado) via one-use signed tickets from friendly123-licencias
   exchanged once for a short-lived in-memory room-bound session token (never stored in localStorage).
   Exposes window.F123CloudflareRelay = { ckptFrameBytes, connect(url), wireDown(url), leerHead(url), create }. */
(function () {
  "use strict";
  var DEFAULT_BASE = "https://friendly123-relay-privado.jfcarpio.workers.dev";
  var DEFAULT_AUTH = "https://friendly123-licencias.jfcarpio.workers.dev";
  var CKPT_CIPHER_BYTES = 1536 * 1024;
  var MAX_FRAME = 360 * 1024;
  var MAX_CKPT_FRAME = 2800 * 1024;
  var LIVE_POLL_MS = 5000;
  var SESSION_REFRESH_MARGIN_MS = 60 * 1000;
  var LICENSE_RE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
  var INSTANCE_RE = /^[A-Za-z0-9_-]{6,120}$/;
  var LOC = /^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})(-y|-ops|-fotos)?$/;
  var B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  var enc = new TextEncoder();

  function toHex(buf) {
    var b = new Uint8Array(buf), out = "";
    for (var i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
    return out;
  }
  function unb64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function qs(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(String(o[k])); }).join("&");
  }
  function decodeFrame(s) {
    if (typeof s !== "string" || !s || s.length > MAX_CKPT_FRAME || s.length % 4 !== 0 || !B64_RE.test(s)) {
      throw new Error("Invalid Cloudflare relay ciphertext encoding");
    }
    return unb64(s);
  }
  async function ypartyBaseForLicense(lic) {
    var digest = await crypto.subtle.digest("SHA-256", enc.encode("f123-yparty-v1:" + lic));
    return toHex(digest).slice(0, 32);
  }
  function readSessionCredentials() {
    if (typeof window === "undefined") return null;
    var owned = null;
    try { owned = JSON.parse(localStorage.getItem("f123_owned") || "null"); } catch (_) {}
    var lic = String((owned && owned.licenseCode) || "").trim().toUpperCase();
    var inst = String((owned && owned.instanceId) || "").trim();
    if (!LICENSE_RE.test(lic) || !INSTANCE_RE.test(inst)) return null;
    var role = window.OCAuth && typeof window.OCAuth.rolActual === "function"
      ? String(window.OCAuth.rolActual() || "").trim().toLowerCase() : "";
    if (role === "dueno") {
      var ownerPin = window.OCSecure && typeof window.OCSecure.leerPinQueAbre === "function"
        ? (window.OCSecure.leerPinQueAbre() || {}).owner : null;
      if (typeof ownerPin !== "string" || !/^[0-9]{3}$/.test(ownerPin) || ownerPin === "456" || ownerPin === "789") return null;
      return {
        role: "dueno",
        licenseCode: lic,
        instanceId: inst,
        authSuffix: "-priv",
        scopes: ["priv:read", "priv:write"],
        credentials: { kind: "owner", licenseCode: lic, instanceId: inst, pin: ownerPin }
      };
    }
    if (role === "admin" || role === "empleado") {
      var openPins = window.OCSecure && typeof window.OCSecure.leerPinQueAbre === "function"
        ? (window.OCSecure.leerPinQueAbre() || {}) : {};
      var team = openPins.team ||
        (window.__f123CentralTeamPrincipal && window.__f123CentralTeamPrincipal.role === role
          ? window.__f123CentralTeamPrincipal : null);
      if (!team || typeof team !== "object" || typeof team.subject !== "string" || typeof team.pin !== "string") return null;
      return {
        role: role,
        licenseCode: lic,
        instanceId: inst,
        authSuffix: "-cat",
        scopes: ["cat:read"],
        credentials: { kind: "team", licenseCode: lic, instanceId: inst, subject: team.subject, role: role, pin: team.pin }
      };
    }
    return null;
  }

  function create(opts) {
    var base = String((opts && opts.base) || DEFAULT_BASE).replace(/\/+$/, "");
    var authBase = String((opts && opts.authBase) || DEFAULT_AUTH).replace(/\/+$/, "");
    var fetchFn = (opts && opts.fetch) || function () { return fetch.apply(null, arguments); };
    var getCreds = (opts && opts.getCredentials) || readSessionCredentials;
    var livePollMs = (opts && typeof opts.livePollMs === "number") ? opts.livePollMs : LIVE_POLL_MS;
    var wireDown = 0;
    var wireDownRoom = Object.create(null);
    var sessions = Object.create(null); // in-memory ONLY, never localStorage
    var sessionInFlight = Object.create(null);

    function clearSessions() {
      sessions = Object.create(null);
      sessionInFlight = Object.create(null);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("oc-logout", clearSessions);
    }

    function contabilizarLectura(room, count) {
      count = Math.max(0, Number(count) || 0);
      wireDown += count;
      wireDownRoom[room] = (wireDownRoom[room] || 0) + count;
    }

    async function netFetch(url, init) {
      try {
        return await fetchFn(url, init);
      } catch (_) {
        var err = new Error("Cloudflare private relay network unavailable");
        err.f123Network = true;
        throw err;
      }
    }

    async function ensureSession(room, forceRefresh) {
      var cur = sessions[room];
      var now = Date.now();
      if (!forceRefresh && cur && cur.token && cur.expiresAt - now > SESSION_REFRESH_MARGIN_MS) {
        return cur.token;
      }
      if (!forceRefresh && sessionInFlight[room]) return sessionInFlight[room];
      var job = (async function () {
        var cred = await Promise.resolve(getCreds(room));
        if (!cred || !cred.credentials) {
          var noAuth = new Error("Cloudflare private relay session credentials unavailable");
          noAuth.status = 401;
          throw noAuth;
        }
        var yBase = await ypartyBaseForLicense(cred.licenseCode);
        var ticketRes = await netFetch(authBase + "/ws/ticket", {
          method: "POST",
          mode: "cors",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credentials: cred.credentials,
            room: yBase + cred.authSuffix,
            scopes: cred.scopes
          })
        });
        var ticketBody = await ticketRes.json().catch(function () { return null; });
        var ticketToken = (ticketRes.ok && ticketBody && ticketBody.ok === true && typeof ticketBody.token === "string")
          ? ticketBody.token : "";
        if (!ticketToken && ticketRes.status !== 404) {
          var tErr = new Error("Ticket rejected");
          tErr.status = ticketRes.status || 403;
          throw tErr;
        }
        var sessRes = await netFetch(base + "/f123/" + room + "/session", {
          method: "POST",
          mode: "cors",
          cache: "no-store",
          headers: {
            "authorization": ticketToken ? ("Bearer " + ticketToken) : "",
            "content-type": "application/json",
            "x-f123-license": cred.licenseCode,
            "x-f123-instance": cred.instanceId,
            "x-f123-role": cred.role
          },
          body: JSON.stringify({ credentials: cred.credentials, role: cred.role })
        });
        var sessBody = await sessRes.json().catch(function () { return null; });
        if (!sessRes.ok || !sessBody || sessBody.ok !== true || typeof sessBody.token !== "string") {
          var sErr = new Error("Session exchange rejected");
          sErr.status = sessRes.status || 403;
          throw sErr;
        }
        sessions[room] = {
          token: sessBody.token,
          expiresAt: Number(sessBody.expiresAt) || (Date.now() + 9 * 60 * 1000)
        };
        return sessions[room].token;
      })();
      sessionInFlight[room] = job;
      try {
        return await job;
      } finally {
        if (sessionInFlight[room] === job) delete sessionInFlight[room];
      }
    }

    async function authedRequest(room, method, action, query, body) {
      var token = await ensureSession(room, false);
      var qStr = query ? qs(query) : "";
      var url = base + "/f123/" + room + "/" + action + (qStr ? "?" + qStr : "");
      var headers = { "authorization": "Bearer " + token };
      var payload;
      if (body !== undefined) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
      }
      var res = await netFetch(url, { method: method, mode: "cors", cache: "no-store", headers: headers, body: payload });
      if (res.status === 401) {
        delete sessions[room];
        token = await ensureSession(room, true);
        headers["authorization"] = "Bearer " + token;
        res = await netFetch(url, { method: method, mode: "cors", cache: "no-store", headers: headers, body: payload });
      }
      var text = await res.text();
      contabilizarLectura(room, enc.encode(text).byteLength);
      var parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
      return { ok: res.ok, status: res.status, body: parsed };
    }

    function Socket(url) {
      var m = String(url).match(LOC);
      if (!m) throw new TypeError("Unsupported notebook locator");
      this.url = String(url);
      this.room = m[1] + (m[2] || "");
      this.readyState = 0;
      this.binaryType = "arraybuffer";
      this.bufferedAmount = 0;
      this.peerOnly = false;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this._l = {};
      this._durable = Promise.resolve();
      this._reads = Promise.resolve();
      this._seen = Object.create(null);
      this._liveTimer = null;
      this._liveSeq = 0;
      this._liveRev = 0;
      var self = this;
      Promise.resolve().then(function () { return self._open(); });
    }
    Socket.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
    Socket.prototype.removeEventListener = function (t, f) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== f; }); };
    Socket.prototype._emit = function (type, props) {
      var e = { type: type, target: this };
      for (var k in props || {}) e[k] = props[k];
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
        var r = await authedRequest(this.room, "GET", "head");
        if (this.readyState !== 0) return;
        if (!r.ok || !r.body || r.body.ok !== true) {
          var code = r.status === 401 || r.status === 403 ? 1008 : 1011;
          return this.close(code, "cloudflare private relay unavailable");
        }
        this._liveRev = Number(r.body.rev) || 0;
        this._liveSeq = Number(r.body.seq) || 0;
        this.readyState = 1;
        this._emit("open");
        this._text({ k: "peer-count", n: 1 });
        this._startLive();
      } catch (err) {
        if (this.readyState === 0) {
          this._emit("error");
          var closeCode = err && err.f123Network === true ? 1006 : (err && (err.status === 401 || err.status === 403) ? 1008 : 1011);
          this.close(closeCode, "cloudflare private relay unavailable");
        }
      }
    };
    Socket.prototype._startLive = function () {
      if (!livePollMs || livePollMs <= 0) return;
      var self = this;
      var busy = false;
      this._liveTimer = setInterval(function () {
        if (self.readyState !== 1 || busy) return;
        if (typeof document !== "undefined" && document.hidden) return;
        busy = true;
        authedRequest(self.room, "GET", "head").then(async function (h) {
          if (self.readyState !== 1 || !h.ok || !h.body) return;
          var rev = Number(h.body.rev) || 0;
          var seq = Number(h.body.seq) || 0;
          if (rev === self._liveRev && seq <= self._liveSeq) return;
          var p = await authedRequest(self.room, "GET", "pull", { rev: self._liveRev, seq: self._liveSeq, limit: 64 });
          if (self.readyState !== 1 || !p.ok || !p.body || !Array.isArray(p.body.frames)) return;
          var decoded = p.body.frames.map(decodeFrame);
          decoded.forEach(function (bytes, i) {
            var f = p.body.frames[i];
            var key = f.length + ":" + f.slice(0, 64);
            if (!self._seen[key]) { self._seen[key] = 1; self._binary(bytes, "live"); }
          });
          self._liveRev = Number(p.body.rev) || self._liveRev;
          self._liveSeq = Math.max(self._liveSeq, Number(p.body.seq) || 0);
        }).catch(function () {}).finally(function () { busy = false; });
      }, livePollMs);
      if (this._liveTimer && typeof this._liveTimer.unref === "function") this._liveTimer.unref();
    };
    Socket.prototype.send = function (data) {
      if (this.readyState !== 1) throw new DOMException("Relay is not open", "InvalidStateError");
      var size = typeof data === "string" ? enc.encode(data).byteLength : (data.byteLength != null ? data.byteLength : data.size || 0);
      var control = null;
      if (typeof data === "string") { try { control = JSON.parse(data); } catch (_) {} }
      var isCkpt = control && control.k === "ckpt" && typeof control.c === "string";
      if (size > (isCkpt ? MAX_CKPT_FRAME : MAX_FRAME)) { this.close(1009, "frame too big"); return; }
      if (!control || !control.k) return;
      var self = this;
      var durable = control.k === "op" || control.k === "ckpt";
      var lane = (durable ? this._durable : this._reads)
        .then(function () { return self._command(control); })
        .catch(function (err) { self._fail(err); });
      if (durable) this._durable = lane; else this._reads = lane;
    };
    Socket.prototype._fail = function (err) {
      if (this.readyState < 2) {
        this._emit("error");
        this.close(err && err.f123Network === true ? 1006 : 1011, "cloudflare private relay unavailable");
      }
    };
    Socket.prototype._command = async function (c) {
      if (this.readyState !== 1) return;
      if (c.k === "op") {
        var ok = false;
        if (typeof c.id === "string" && c.id && typeof c.c === "string") {
          var r = await authedRequest(this.room, "POST", "op", null, { id: c.id, c: c.c, lam: Number(c.lam) || 0 });
          ok = !!(r.ok && r.body && r.body.ok === true);
          if (ok && Number.isSafeInteger(r.body.seq)) this._liveSeq = Math.max(this._liveSeq, r.body.seq);
          if (ok) this._seen[c.c.length + ":" + c.c.slice(0, 64)] = 1;
        }
        if (c.ack === 1 && typeof c.id === "string") {
          this._text({ k: "persist-result", kind: "op", id: c.id, ok: ok, conflict: false });
        }
        return;
      }
      if (c.k === "ckpt") {
        var res = { ok: false, conflict: false };
        try {
          var w = await authedRequest(this.room, "POST", "ckpt", null, {
            rev: Number(c.v) === 2 ? Number(c.rev) : undefined,
            seq: Number(c.seq) || 0,
            lam: Number(c.lam) || 0,
            c: c.c
          });
          res.ok = !!(w.ok && w.body && w.body.ok === true);
          res.conflict = !res.ok && (w.status === 409 || !!(w.body && w.body.conflict === true));
          if (res.ok && Number.isSafeInteger(w.body.rev)) this._liveRev = Math.max(this._liveRev, w.body.rev);
          if (res.ok && typeof c.c === "string") this._seen[c.c.length + ":" + c.c.slice(0, 64)] = 1;
        } catch (_) {}
        if (c.ack === 1 && typeof c.id === "string") {
          this._text({ k: "persist-result", kind: "ckpt", id: c.id, ok: res.ok, conflict: res.conflict });
        }
        return;
      }
      if (c.k === "ts") {
        var tr = await authedRequest(this.room, "GET", "ts");
        if (tr.ok && tr.body && Number.isFinite(Number(tr.body.t1))) {
          this._text({ k: "tsr", t0: c.t0, t1: Number(tr.body.t1) });
        }
        return;
      }
      if (c.k === "head") {
        try {
          var hr = await authedRequest(this.room, "GET", "head");
          if (hr.ok && hr.body && hr.body.ok === true) {
            return this._text({ k: "head-result", v: 2, rev: Number(hr.body.rev) || 0, seq: Number(hr.body.seq) || 0 });
          }
          return this._text({ k: "head-result", v: 2, unsupported: true });
        } catch (_) {
          return this._text({ k: "head-result", v: 2, unsupported: true });
        }
      }
      if (c.k === "pull") {
        var reqRev = Number(c.v) === 2 ? Number(c.rev) : -1;
        var reqSeq = Math.max(0, Number(c.seq) || 0);
        var reqLim = Math.max(1, Math.min(192, Number(c.limit) || 64));
        var pr = await authedRequest(this.room, "GET", "pull", { rev: reqRev, seq: reqSeq, limit: reqLim });
        if (!pr.ok || !pr.body || pr.body.ok !== true || !Array.isArray(pr.body.frames)) {
          throw new Error("Cloudflare private relay pull failed");
        }
        var decoded = pr.body.frames.map(decodeFrame);
        var self = this;
        decoded.forEach(function (bytes, i) {
          var f = pr.body.frames[i];
          self._seen[f.length + ":" + f.slice(0, 64)] = 1;
          self._binary(bytes, "pull");
        });
        var curRev = Number(pr.body.rev) || 0;
        var newSeq = Number(pr.body.seq) || 0;
        this._liveRev = Math.max(this._liveRev, curRev);
        this._liveSeq = Math.max(this._liveSeq, newSeq);
        if (Number(c.v) === 2) {
          this._text({ k: "pull-page", v: 2, rev: curRev, seq: newSeq, n: Number(pr.body.n) || 0, more: !!pr.body.more });
        }
      }
    };
    Socket.prototype.close = function (code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      if (this._liveTimer) { clearInterval(this._liveTimer); this._liveTimer = null; }
      this._emit("close", { code: code || 1000, reason: reason || "", wasClean: (code || 1000) === 1000 });
    };

    return {
      ckptFrameBytes: CKPT_CIPHER_BYTES,
      connect: function (url) { return new Socket(url); },
      wireDown: function (url) {
        if (!url) return wireDown;
        var m = String(url).match(LOC);
        return m ? (wireDownRoom[m[1] + (m[2] || "")] || 0) : 0;
      },
      leerHead: async function (url) {
        var m = String(url).match(LOC);
        if (!m) return null;
        var hr = await authedRequest(m[1] + (m[2] || ""), "GET", "head");
        if (!hr.ok || !hr.body || hr.body.ok !== true) return null;
        return { rev: Number(hr.body.rev) || 0, seq: Number(hr.body.seq) || 0 };
      },
      clearSessions: clearSessions
    };
  }

  if (typeof window !== "undefined") {
    window.F123CloudflareRelay = create();
    window.F123CloudflareRelay.create = create;
  }
})();
