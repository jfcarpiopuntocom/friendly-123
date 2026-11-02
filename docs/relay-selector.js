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
  function envolver(capa, url) {
    var key = capa.key, ws = capa.relay.connect(url), abierto = false;
    ws.addEventListener("open", function () { abierto = true; });
    ws.addEventListener("message", function (e) {
      var c = leer(key); c.down += bytes(e.data); guardar(key, c);
      if (c.down >= CAP_DOWN) { c.pausaHasta = Date.now() + PAUSA_MS; guardar(key, c); try { ws.close(1013, CIERRE); } catch (_) {} }
    });
    // Refused before opening (inactive room, quota 402, route error): pause this layer, the next one takes over.
    ws.addEventListener("close", function () { if (!abierto) { var c = leer(key); c.pausaHasta = Date.now() + PAUSA_MS; guardar(key, c); } });
    var enviar = ws.send.bind(ws);
    ws.send = function (v) {
      var c = leer(key), n = bytes(v);
      if (c.up + n > CAP_UP) { c.up = CAP_UP; guardar(key, c); try { ws.close(1013, CIERRE); } catch (_) {} throw new DOMException("Daily relay budget reached", "QuotaExceededError"); }
      c.up += n; guardar(key, c); return enviar(v);
    };
    return ws;
  }
  window.F123Relay = {
    ckptFrameBytes: (capas[0] && capas[0].relay.ckptFrameBytes) || undefined,
    estadoCupo: function () { return capas.map(function (capa) { var c = leer(capa.key); return { capa: capa.key, dia: c.dia, up: c.up, down: c.down, usable: usable(capa) }; }); },
    connect: function (url) {
      if (/-fotos$/.test(String(url))) return viaPeers(url); // photos never use a relay budget
      for (var i = 0; i < capas.length; i++) if (usable(capas[i])) {
        var ws; try { ws = envolver(capas[i], url); } catch (_) { continue; }
        // On a fallback layer, re-probe the earlier layers when their pause ends: the app reconnects, the earlier
        // layer gets this device's full-state checkpoint, and devices split across layers converge again.
        if (i > 0) (function (s, previas) {
          var t = setInterval(function () {
            if (s.readyState >= 2) return clearInterval(t);
            if (previas.some(usable)) { clearInterval(t); try { s.close(1012, "earlier durable layer available again"); } catch (_) {} }
          }, 60000);
        })(ws, capas.slice(0, i));
        return ws;
      }
      return viaPeers(url);
    }
  };
})();
