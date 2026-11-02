/* relay-selector.js (JFC 2026-11-02): a device that connects catches up alone. Durable layers in order:
   Supabase relay, then Firebase relay (firebase-relay.js); direct peers are the last fallback, never the only path.
   Every layer keeps the same encrypted frames, so they never conflict (Yjs merges any order, any repetition).
   Each durable layer has its own per-device daily byte budget so a free plan cannot burn again: past it, or when
   the layer refuses the room before opening (inactive room, 402, network), that layer pauses and the next one is
   used; pending writes stay in the caller's outbox. Photos are each business's responsibility: peers only.
   Load after peer-sync.js, supabase-relay.min.js and firebase-relay.js. */
(function () {
  "use strict";
  var sb = window.F123Relay, fb = window.F123FirebaseRelay;
  var peer = null;
  // Fail closed for photos and fallback: if peer-sync did not load, throw (the caller retries) instead of
  // leaving the relays without their daily budget or sending photos through a relay.
  function viaPeers(url) {
    if (!peer && window.F123Peer && typeof window.F123Peer.create === "function") peer = window.F123Peer.create();
    if (!peer) throw new Error("Direct peer connections are unavailable");
    return peer.connect(url);
  }
  var CAP_UP = 2 * 1024 * 1024, CAP_DOWN = 20 * 1024 * 1024, PAUSA_MS = 15 * 60 * 1000;
  var CIERRE = "daily relay budget reached; local data retained";
  var capas = [];
  if (sb && sb !== fb && typeof sb.connect === "function") capas.push({ relay: sb, key: "f123_relay_cupo_v1" });
  if (fb && typeof fb.connect === "function") capas.push({ relay: fb, key: "f123_relay_cupo_fb_v1" });
  function hoy() { return new Date().toISOString().slice(0, 10); }
  function leer(key) {
    var c = null; try { c = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
    var pausa = c && Number(c.pausaHasta) || 0;
    return c && c.dia === hoy() ? c : { dia: hoy(), up: 0, down: 0, pausaHasta: pausa };
  }
  function guardar(key, c) { try { localStorage.setItem(key, JSON.stringify(c)); } catch (_) {} }
  function bytes(v) { return v == null ? 0 : v.byteLength != null ? v.byteLength : v.size != null ? v.size : String(v).length; }
  function usable(capa) { var c = leer(capa.key); return Date.now() >= c.pausaHasta && c.up < CAP_UP && c.down < CAP_DOWN; }
  // A layer that reports its real read bytes (Firebase) is charged those, and only the new ones: its frames are inside them.
  function sumarBajada(capa, e) {
    var c = leer(capa.key);
    if (typeof capa.relay.wireDown === "function") { var w = capa.relay.wireDown(); c.down += w - (capa.wireVisto || 0); capa.wireVisto = w; }
    else if (e) c.down += bytes(e.data);
    guardar(capa.key, c);
    return c;
  }
  /* v644 probes. They only read and report: no retry, no layer change, no business data, never block the caller.
     rev/seq are never compared across layers: Firebase seq is a server timestamp, Supabase seq an identity.
     To retire them: delete this block, the sonda lines in envolver() and connect(), and estadoSondas. */
  var SONDA_MS = 300000, ATRASO_MS = 600000, OTRA_CAPA_MS = 1800000, HEAD = JSON.stringify({ k: "head", v: 2 });
  var _sondasWs = {}, _headFb = {}, _sondaFbEn = {}, _otraCapaEn = 0;
  // The durable head moved, this device sent nothing, and no frame reached it: live delivery is failing here.
  function sondaAtraso(s, h) {
    var seq = Number(h.seq);
    if (h.unsupported || !Number.isSafeInteger(seq)) return;
    if (s.frames) s.desde = 0;
    else if (s.seq !== null && seq !== s.seq && !s.enviados && !s.desde) s.desde = Date.now();
    s.seq = seq; s.frames = 0; s.enviados = 0;
  }
  // While this device is on Supabase, its Firebase head moving means another device is writing where this one does not read.
  // shortcut: a split older than the first reading is not seen, and a device on Firebase does not read Supabase. Comparing content would need the ciphertext.
  function sondaOtraCapa(url) {
    var capaFb = capas.filter(function (x) { return x.relay === fb; })[0];
    if (!capaFb || typeof fb.leerHead !== "function" || Date.now() - (_sondaFbEn[url] || 0) < 60000) return;
    var c = leer(capaFb.key);
    if (c.up >= CAP_UP || c.down >= CAP_DOWN) return; // an exhausted budget is never spent on a probe
    _sondaFbEn[url] = Date.now();
    Promise.resolve().then(function () { return fb.leerHead(url); }).then(function (h) {
      sumarBajada(capaFb);
      if (!h) return;
      var antes = _headFb[url], ahora = h.rev + ":" + h.seq;
      _headFb[url] = ahora;
      if (antes && antes !== ahora) _otraCapaEn = Date.now();
    }).catch(function () { try { sumarBajada(capaFb); } catch (_) {} });
  }
  function arrancarSondas(ws, capa, url) {
    if (capa.relay === fb) delete _headFb[url]; // this device writes there now: its own writes must not count later
    else sondaOtraCapa(url);
    var t = setInterval(function () {
      if (ws.readyState >= 2) return clearInterval(t);
      if (ws.readyState !== 1 || (typeof document !== "undefined" && document.hidden)) return;
      if (leer(capa.key).up + HEAD.length <= CAP_UP) ws.send(HEAD);
      if (capa.relay !== fb) sondaOtraCapa(url);
    }, SONDA_MS);
    if (t && t.unref) t.unref();
  }
  // Re-probe the earlier layers when their pause ends: the app reconnects, the earlier layer gets this device's
  // full-state checkpoint, and devices split across layers converge again.
  function reprobar(s, previas) {
    var t = setInterval(function () {
      if (s.readyState >= 2) return clearInterval(t);
      if (previas.some(usable)) { clearInterval(t); try { s.close(1012, "earlier durable layer available again"); } catch (_) {} }
    }, 60000);
    if (t && t.unref) t.unref();
  }
  // A layer with nothing at all must not pass for "up to date" while the next one holds the store. Zero against
  // non-zero only: rev/seq are never compared across layers. Yjs merges any repetition, so moving on cannot conflict.
  function capaVaciaSigue(capa, ws, url, h) {
    if (capa.relay === fb || !fb || typeof fb.leerHead !== "function" || h.unsupported || Number(h.rev) || Number(h.seq)) return;
    var capaFb = capas.filter(function (x) { return x.relay === fb; })[0];
    if (!capaFb || !usable(capaFb)) return;
    fb.leerHead(url).then(function (n) {
      sumarBajada(capaFb);
      if (!n || !(n.rev || n.seq) || ws.readyState !== 1) return;
      var c = leer(capa.key); c.pausaHasta = Date.now() + PAUSA_MS; guardar(capa.key, c);
      try { ws.close(1013, "layer empty; next durable layer has data"); } catch (_) {}
    }).catch(function () {});
  }
  function envolver(capa, url) {
    var key = capa.key, ws = capa.relay.connect(url), abierto = false, sonda = { ws: ws, seq: null, frames: 0, enviados: 0, desde: 0 };
    _sondasWs[url] = sonda;
    ws.addEventListener("open", function () { abierto = true; });
    ws.addEventListener("message", function (e) {
      if (typeof e.data !== "string") sonda.frames++;
      else if (e.data.indexOf('"head-result"') !== -1) try { var cabeza = JSON.parse(e.data); sondaAtraso(sonda, cabeza); capaVaciaSigue(capa, ws, url, cabeza); } catch (_) {}
      var c = sumarBajada(capa, e);
      if (c.down >= CAP_DOWN) { c.pausaHasta = Date.now() + PAUSA_MS; guardar(key, c); try { ws.close(1013, CIERRE); } catch (_) {} }
    });
    // Refused before opening (inactive room, quota 402, route error): pause this layer, the next one takes over.
    ws.addEventListener("close", function () { if (!abierto) { var c = leer(key); c.pausaHasta = Date.now() + PAUSA_MS; guardar(key, c); } });
    var enviar = ws.send.bind(ws);
    ws.send = function (v) {
      if (v !== HEAD) sonda.enviados++;
      // Firebase discards binary live copies; only its HTTP-backed commands spend relay quota.
      if (capa.relay === fb && typeof v !== "string") return enviar(v);
      var c = leer(key), n = bytes(v);
      if (c.up + n > CAP_UP) { c.up = CAP_UP; guardar(key, c); try { ws.close(1013, CIERRE); } catch (_) {} throw new DOMException("Daily relay budget reached", "QuotaExceededError"); }
      c.up += n; guardar(key, c); return enviar(v);
    };
    return ws;
  }
  window.F123Relay = {
    ckptFrameBytes: (capas[0] && capas[0].relay.ckptFrameBytes) || undefined,
    estadoCupo: function () { return capas.map(function (capa) { var c = leer(capa.key); return { capa: capa.key, dia: c.dia, up: c.up, down: c.down, usable: usable(capa) }; }); },
    estadoSondas: function () {
      var ahora = Date.now();
      return {
        otraCapa: !!_otraCapaEn && ahora - _otraCapaEn < OTRA_CAPA_MS,
        sinRecibir: Object.keys(_sondasWs).some(function (u) { var s = _sondasWs[u]; return s.ws.readyState === 1 && s.desde && ahora - s.desde >= ATRASO_MS; })
      };
    },
    connect: function (url) {
      if (/-fotos$/.test(String(url))) return viaPeers(url); // photos never use a relay budget
      for (var i = 0; i < capas.length; i++) if (usable(capas[i])) {
        var ws; try { ws = envolver(capas[i], url); } catch (_) { continue; }
        // On a fallback layer, re-probe the earlier layers when their pause ends: the app reconnects, the earlier
        // layer gets this device's full-state checkpoint, and devices split across layers converge again.
        if (i > 0) reprobar(ws, capas.slice(0, i));
        try { arrancarSondas(ws, capas[i], url); } catch (_) {}
        return ws;
      }
      var directo = viaPeers(url);
      reprobar(directo, capas); // peers are the last fallback, never where a device stays once a durable layer is back
      return directo;
    }
  };
})();
