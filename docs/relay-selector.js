/* relay-selector.js (JFC 2026-11-02): Supabase is the durable relay so a device that connects catches up alone;
   direct peers are the fallback, never the only path. A per-device daily byte budget keeps the free plan from
   burning again: past the budget, or when Supabase refuses the room (inactive/402), the device stays on peers
   and keeps every pending write locally until the next day. Load after peer-sync.js and supabase-relay.min.js. */
(function () {
  "use strict";
  var sb = window.F123Relay, peer = window.F123Peer && typeof window.F123Peer.create === "function" ? window.F123Peer.create() : null;
  if (!sb || !peer || typeof sb.connect !== "function") return;
  var CAP_UP = 2 * 1024 * 1024, CAP_DOWN = 20 * 1024 * 1024, PAUSA_MS = 15 * 60 * 1000, KEY = "f123_relay_cupo_v1";
  function hoy() { return new Date().toISOString().slice(0, 10); }
  function leer() {
    var c = null; try { c = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
    var pausa = c && Number(c.pausaHasta) || 0;
    return c && c.dia === hoy() ? c : { dia: hoy(), up: 0, down: 0, pausaHasta: pausa };
  }
  function guardar(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) {} }
  function bytes(v) { return v == null ? 0 : v.byteLength != null ? v.byteLength : v.size != null ? v.size : String(v).length; }
  function usarSupabase() { var c = leer(); return Date.now() >= c.pausaHasta && c.up < CAP_UP && c.down < CAP_DOWN; }
  var CIERRE = "daily relay budget reached; local data retained";
  window.F123Relay = {
    ckptFrameBytes: sb.ckptFrameBytes,
    estadoCupo: function () { var c = leer(); return { dia: c.dia, up: c.up, down: c.down, capUp: CAP_UP, capDown: CAP_DOWN, supabase: usarSupabase() }; },
    connect: function (url) {
      // Photos are each business's responsibility (JFC 2026-11-01): direct peers only, never the relay budget.
      if (/-fotos$/.test(String(url)) || !usarSupabase()) return peer.connect(url);
      var ws = sb.connect(url), abierto = false;
      ws.addEventListener("open", function () { abierto = true; });
      ws.addEventListener("message", function (e) {
        var c = leer(); c.down += bytes(e.data); guardar(c);
        if (c.down >= CAP_DOWN) { c.pausaHasta = Date.now() + PAUSA_MS; guardar(c); try { ws.close(1013, CIERRE); } catch (_) {} }
      });
      // Refused before opening (inactive room, quota 402, route error): use peers for a while, then retry Supabase.
      ws.addEventListener("close", function () { if (!abierto) { var c = leer(); c.pausaHasta = Date.now() + PAUSA_MS; guardar(c); } });
      var enviar = ws.send.bind(ws);
      ws.send = function (v) {
        var c = leer(), n = bytes(v);
        if (c.up + n > CAP_UP) { c.up = CAP_UP; guardar(c); try { ws.close(1013, CIERRE); } catch (_) {} throw new DOMException("Daily relay budget reached", "QuotaExceededError"); }
        c.up += n; guardar(c); return enviar(v);
      };
      return ws;
    }
  };
})();
