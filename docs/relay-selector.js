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
  var CAP_UP = 2 * 1024 * 1024, CAP_DOWN = 20 * 1024 * 1024, PAUSA_MS = 15 * 60 * 1000, PAUSA_RED_MS = 5 * 1000;
  var CAP_UP_RESERVA = 10 * 1024 * 1024, FRAME_RESERVADO = 16 * 1024;
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
  function usable(capa) { var c = leer(capa.key); return Date.now() >= c.pausaHasta && (capa.relay === fb || c.up < CAP_UP) && c.down < CAP_DOWN; }
  /* v661 (JFC 2026-11-04, literal: «No dije que no pasen por ninguna capa ... Dije que son prioridad ultima. TODO DEBE TENER
     CASCADA DE FALLBACKS»): photos ride the same cascade (Supabase -> Firebase -> direct) at LAST priority: they only use
     a layer while this device's daily use there is under half the cap, so inventory and money always keep the other
     half. Over that, photos stay direct between devices. To return to peers-only photos: make esFoto() return false. */
  var FOTO_PARTE = 0.5;
  function esFoto(url) { return /-fotos$/.test(String(url)); }
  /* v661 band quarantine (OpenCode review 2026-11-04): a refusal on the photo room pauses ONLY the photo band of that
     layer (its own key); inventory and money keep using the layer. The business band pausing still stops photos there. */
  function pausaFotos(capa) { try { return Number((JSON.parse(localStorage.getItem(capa.key + "_fotos") || "null") || {}).pausaHasta) || 0; } catch (_) { return 0; } }
  function pausarFotos(capa, ms) { try { localStorage.setItem(capa.key + "_fotos", JSON.stringify({ pausaHasta: Date.now() + ms })); } catch (_) {} }
  function usableFotos(capa) { var c = leer(capa.key); return usable(capa) && Date.now() >= pausaFotos(capa) && (capa.relay === fb || c.up < CAP_UP * FOTO_PARTE) && c.down < CAP_DOWN * FOTO_PARTE; }
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
  /* v657 (sync3 QA 2026-11-03, Directiva Prima 1): each device writes to ONE durable layer. A device parked on Firebase
     (Supabase refused it) and a device on Supabase never saw each other's writes until the first one reopened: a device
     that opened alone did not catch up. Now the Firebase head seen is remembered across sessions; if it moved while this
     device was reading only Supabase, it reads Firebase for a few minutes (Supabase paused 3 min, the app reconnects),
     then the existing re-probe brings it back to Supabase, where it uploads its full checkpoint and everyone converges.
     Costs one small head read per connection (already made by this probe). To disable: set OTRA_CAPA_LEER_MS = 0. */
  var OTRA_CAPA_LEER_MS = 3 * 60 * 1000;
  function claveHead(url) { return "f123_fb_head_" + String(url).slice(-48); }
  function headVisto(url) { try { return _headFb[url] || localStorage.getItem(claveHead(url)) || null; } catch (_) { return _headFb[url] || null; } }
  function anotarHead(url, v) { _headFb[url] = v; try { localStorage.setItem(claveHead(url), v); } catch (_) {} }
  function leerFirebase(ws) {
    var cs = capas[0];
    if (!OTRA_CAPA_LEER_MS || !ws || !cs || cs.relay === fb) return;
    var c = leer(cs.key); c.pausaHasta = Math.max(Number(c.pausaHasta) || 0, Date.now() + OTRA_CAPA_LEER_MS); guardar(cs.key, c);
    var ir = function () { try { ws.close(1012, "another device wrote on the next durable layer"); } catch (_) {} };
    if (ws.readyState === 1) ir(); else if (ws.readyState === 0) ws.addEventListener("open", ir);
  }
  function sondaOtraCapa(url, ws) {
    var capaFb = capas.filter(function (x) { return x.relay === fb; })[0];
    if (!capaFb || typeof fb.leerHead !== "function" || Date.now() - (_sondaFbEn[url] || 0) < 60000) return;
    var c = leer(capaFb.key);
    if (c.up >= CAP_UP || c.down >= CAP_DOWN) return; // an exhausted budget is never spent on a probe
    _sondaFbEn[url] = Date.now();
    Promise.resolve().then(function () { return fb.leerHead(url); }).then(function (h) {
      sumarBajada(capaFb);
      if (!h) return;
      var antes = headVisto(url), ahora = h.rev + ":" + h.seq;
      anotarHead(url, ahora);
      if (antes && antes !== ahora) { _otraCapaEn = Date.now(); leerFirebase(ws); }
    }).catch(function () { try { sumarBajada(capaFb); } catch (_) {} });
  }
  // v649: silent sync trouble reaches the team through Sentry: fixed codes only, no business data, once per device per day.
  function avisarSync(codigo) {
    try {
      if (!window.OCCanarios) return;
      var k = "f123_canario_sync_" + codigo;
      if (localStorage.getItem(k) === hoy()) return;
      localStorage.setItem(k, hoy());
      window.OCCanarios.fallo("sync", codigo);
    } catch (_) {}
  }
  function revisarAvisos(capa) {
    var e = window.F123Relay.estadoSondas(), c = leer(capa.key), y = window.OCYjs;
    if (e.otraCapa) avisarSync("otra-capa-escribiendo");
    if (e.sinRecibir) avisarSync("relay-sin-entregar");
    if (c.up >= CAP_UP) avisarSync("cupo-subida-lleno");
    if (c.up >= CAP_UP_RESERVA) avisarSync("reserva-subida-llena");
    if (c.down >= CAP_DOWN * 0.8) avisarSync("cupo-bajada-alto");
    if (window.__ocMezcla) avisarSync("shell-no-actualizado");
    if (y && y.canal && y.canal.recuperando === true) avisarSync("historia-incompleta");
    // Stores near the checkpoint limit must surface before they stop populating new devices. Measured at most once a day.
    if (y && y.medirTamanoCanales && localStorage.getItem("f123_canario_tamano") !== hoy()) {
      localStorage.setItem("f123_canario_tamano", hoy());
      var med = y.medirTamanoCanales()[0], margen = med && Number(med.margenBytes), limite = med && Number(med.limiteCifradoBytes);
      if (margen < 0) avisarSync("catalogo-excede-checkpoint");
      else if (limite && margen < limite * 0.3) avisarSync("catalogo-cerca-del-limite");
    }
  }
  function arrancarSondas(ws, capa, url) {
    if (esFoto(url)) return; // v661: photos ride the cascade but never spend head/probe reads
    if (capa.relay === fb) {
      delete _headFb[url]; // this device writes there now: its own writes must not count later
      // v657: when this Firebase session ends, remember the head it left so its own writes are not taken for another device's.
      ws.addEventListener("close", function () { try { Promise.resolve(fb.leerHead(url)).then(function (h) { if (h) anotarHead(url, h.rev + ":" + h.seq); }).catch(function () {}); } catch (_) {} });
    }
    else sondaOtraCapa(url, ws);
    var t = setInterval(function () {
      if (ws.readyState >= 2) return clearInterval(t);
      if (ws.readyState !== 1 || (typeof document !== "undefined" && document.hidden)) return;
      if (leer(capa.key).up + HEAD.length <= CAP_UP) ws.send(HEAD);
      if (capa.relay !== fb) sondaOtraCapa(url, ws);
      try { revisarAvisos(capa); } catch (_) {}
    }, SONDA_MS);
    if (t && t.unref) t.unref();
  }
  // Re-probe the earlier layers when their pause ends: the app reconnects, the earlier layer gets this device's
  // full-state checkpoint, and devices split across layers converge again.
  function reprobar(s, previas) {
    var t = setInterval(function () {
      if (s.readyState >= 2) return clearInterval(t);
      if (previas.some(usable)) { clearInterval(t); try { s.close(1012, "earlier durable layer available again"); } catch (_) {} }
    }, 5000); // v656: local check only (no traffic); 5 s so a short outage does not keep a device off its first layer
    if (t && t.unref) t.unref();
  }
  // A layer with nothing at all must not pass for "up to date" while the next one holds the store. Zero against
  // non-zero only: rev/seq are never compared across layers. Yjs merges any repetition, so moving on cannot conflict.
  function capaVaciaSigue(capa, ws, url, h) {
    if (esFoto(url) || capa.relay === fb || !fb || typeof fb.leerHead !== "function" || h.unsupported || Number(h.rev) || Number(h.seq)) return;
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
      if (esFoto(url) && c.down >= CAP_DOWN * FOTO_PARTE) { pausarFotos(capa, PAUSA_MS); try { ws.close(1013, CIERRE); } catch (_) {} return; }
      if (c.down >= CAP_DOWN) { c.pausaHasta = Date.now() + PAUSA_MS; guardar(key, c); try { ws.close(1013, CIERRE); } catch (_) {} }
    });
    // Refused before opening (inactive room, quota 402, route error): pause this layer, the next one takes over.
    // v646: the last durable layer retries in 60 s: a device that opened with no signal must catch up as soon as it returns.
    // v651: the app closing its own socket mid-open is no refusal (refusals carry a code). It paused Firebase 60 s at startup and dropped the base room to peers.
    var cerrar = ws.close.bind(ws), soltado = false, fallo = false;
    ws.addEventListener("error", function () { fallo = true; }); // the app answers an error by closing with no code: that is still a refusal
    ws.close = function (code, motivo) { if (code === undefined) soltado = true; return cerrar(code, motivo); };
    /* v656 (sync3 QA 2026-11-03): a layer whose server cannot be reached is an outage, not a refusal: network-type
       failures pause the layer only 5 s. Server refusals (codes such as 1011/1013/4xxx: inactive room, 402 quota)
       keep the 15 min / 60 s pause that protects the free plans.
       v659 (JFC 2026-11-04, literal): «no dije que abandones NADA a los 3 segundos ... Dije que desde los 3 segundos
       ya nutras desde el siguiente fallback». The v656/v658 timer that CLOSED a layer silent for 3 s is gone: a layer
       keeps trying on its own. The 3 s hand-over now lives in cascada() (connect), which ADDS the next layer without
       closing this one. */
    ws.addEventListener("close", function (e) {
      if (abierto || !(fallo || !soltado || (e && e.code && e.code !== 1000))) return;
      var red = fallo && !(e && e.code && e.code !== 1006); // an error with no server code
      if (esFoto(url)) { pausarFotos(capa, red ? PAUSA_RED_MS : (capa.relay === fb ? 60000 : PAUSA_MS)); return; } // band quarantine
      var c = leer(key); c.pausaHasta = Date.now() + (red ? PAUSA_RED_MS : (capa.relay === fb ? 60000 : PAUSA_MS)); guardar(key, c);
    });
    var enviar = ws.send.bind(ws);
    ws.send = function (v) {
      if (v !== HEAD) sonda.enviados++;
      // Firebase discards binary live copies; only its HTTP-backed commands spend relay quota.
      if (capa.relay === fb && typeof v !== "string") return enviar(v);
      var c = leer(key), n = bytes(v);
      /* v647: a full budget never stops the last durable layer. Reads cost no upload. Small changes and the compact photo
         (the room with no channel suffix) ride a reserved lane. Only heavy frames wait, in the caller's outbox, with the
         connection open. */
      if (capa.relay === fb) {
        if (typeof v === "string" && n <= 4096 && /^\{"k":"(head|pull|ts)"/.test(v)) return enviar(v);
        // v661: first photo upload of a store (~150 KB each) must finish in a day or two: 5 MB/day/device on Firebase.
        var limite = esFoto(url) ? CAP_UP_RESERVA * FOTO_PARTE : n <= FRAME_RESERVADO || !/-(y|ops)$/.test(String(url)) ? CAP_UP_RESERVA : CAP_UP;
        if (c.up + n > limite) throw new DOMException("Daily relay budget reached", "QuotaExceededError");
        c.up += n; guardar(key, c); return enviar(v);
      }
      // v661: a photo over its share waits in the caller's outbox; the layer stays open for inventory and money.
      if (esFoto(url) && c.up + n > CAP_UP * FOTO_PARTE) throw new DOMException("Daily relay budget reached", "QuotaExceededError");
      if (c.up + n > CAP_UP) { c.up = CAP_UP; guardar(key, c); try { ws.close(1013, CIERRE); } catch (_) {} throw new DOMException("Daily relay budget reached", "QuotaExceededError"); }
      c.up += n; guardar(key, c); return enviar(v);
    };
    return ws;
  }
  /* v659 cascade (JFC 2026-11-04: «3 segundos y punto. recuerda que debe ser secuencial»: 1 Supabase -> 2 Firebase -> 3 direct peers).
     cascada() gives the app ONE WebSocket-shaped object (H) over the layers started so far. The first layer is never
     closed by the timer: if it has not opened after 3 s (or closed before opening) the NEXT layer is started too and
     the app is fed from whichever delivers. When a more preferred layer opens, the less preferred ones stop
     (close 1000 "first layer answered") so free daily quotas are not spent twice. A preferred layer that closes after
     opening leaves H open while a fallback is open. Frames from a peer-only layer reach the app only when
     peerAccepted === true. Writes go to every open layer (Yjs merges repeats).
     To disable: set CASCADA_MS = 0 (connect() then returns the first layer alone, as in v657). */
  var CASCADA_MS = 3000;
  function cascada(url, ws0, i0) {
    var H = new EventTarget(), subs = [], emitidoOpen = false, emitidoClose = false, cerradoH = false, hubError = false, bin = "blob", tried = {}, ultimo = i0;
    function emitir(tipo, props) {
      var ev = new Event(tipo), k; for (k in props) ev[k] = props[k];
      try { H.dispatchEvent(ev); } catch (_) {}
      var h = H["on" + tipo]; if (typeof h === "function") try { h.call(H, ev); } catch (_) {}
    }
    function abiertas() { return subs.filter(function (x) { return x.ws.readyState === 1; }); }
    function vivas() { return subs.filter(function (x) { return x.ws.readyState < 2; }); }
    function terminar(code, reason, limpio) {
      if (emitidoClose) return; emitidoClose = true; cerradoH = true;
      if (hubError && !emitidoOpen) emitir("error", {});
      emitir("close", { code: code, reason: reason, wasClean: !!limpio, peerAccepted: false });
    }
    /* v659 review (critic B #1/#3, debug d2, 2026-11-04): H restarts from layer 1 instead of staying on a lower layer:
       the app's reconnect runs its full catch-up (state vector, checkpoint) on the preferred layer. Never-opened subs
       close with no code so envolver() does not count a refusal. */
    function reiniciar(motivo) {
      if (cerradoH) return;
      cerradoH = true;
      subs.forEach(function (x) { try { if (x.ws.readyState === 1) x.ws.close(1000, motivo); else if (x.ws.readyState === 0) x.ws.close(); } catch (_) {} });
      cerradoH = false; terminar(1012, motivo, true);
    }
    // Every 5 s (local check, no traffic): an earlier durable layer usable again and not already trying in H -> restart.
    function reprobarH(x, j) {
      var t = setInterval(function () {
        if (cerradoH || x.ws.readyState >= 2) return clearInterval(t);
        for (var n = 0; n < j && n < capas.length; n++) {
          var viva = subs.some(function (o) { return o.orden === n && o.ws.readyState < 2; });
          if (!viva && usable(capas[n])) { clearInterval(t); reiniciar("earlier durable layer available again"); return; }
        }
      }, 5000);
      if (t && t.unref) t.unref();
    }
    function agregar(ws, orden) {
      var x = { ws: ws, orden: orden, abrio: false };
      subs.push(x);
      try { ws.binaryType = bin; } catch (_) {}
      ws.addEventListener("open", function () {
        x.abrio = true;
        // A more preferred layer answered: the less preferred ones stop. A never-opened one is closed with no code
        // so envolver() does not count it as a refusal and pause that layer.
        subs.forEach(function (o) {
          if (o.orden <= orden || o.ws.readyState > 1) return;
          try { if (o.ws.readyState === 1) o.ws.close(1000, "first layer answered"); else o.ws.close(); } catch (_) {}
        });
        // The app already opened on a lower layer: restart so its catch-up and checkpoint reach this preferred layer.
        if (emitidoOpen && !cerradoH) { reiniciar("first layer answered"); return; }
        if (!emitidoOpen && !cerradoH) { emitidoOpen = true; emitir("open", {}); }
      });
      ws.addEventListener("message", function (e) {
        // peer-sync.js emits "peer-ready" (a peer connected; no business data) without peerAccepted; sync-yjs needs it.
        var listo = typeof e.data === "string" && e.data.indexOf('"k":"peer-ready"') !== -1;
        if (cerradoH || (ws.peerOnly === true && e.peerAccepted !== true && !listo)) return;
        emitir("message", { data: e.data, peerAccepted: e.peerAccepted === true });
      });
      ws.addEventListener("error", function () { hubError = true; });
      ws.addEventListener("close", function (e) {
        if (cerradoH) return;
        if (!x.abrio && vivas().length === 0) siguiente(); // every layer started closed before opening: do not wait the 3 s
        // The layer feeding the app dropped while another is still only connecting: restart instead of a silent H.
        if (emitidoOpen && !abiertas().length && vivas().length) { reiniciar("layer lost"); return; }
        if (vivas().length) return;
        terminar(e && e.code, e && e.reason, e && e.wasClean);
      });
    }
    // Start the next usable layer after the last one started (peers when none is left).
    function siguiente() {
      if (cerradoH || ultimo >= capas.length) return false;
      for (var j = ultimo + 1; j < capas.length; j++) if (usable(capas[j])) {
        var ws; try { ws = envolver(capas[j], url); } catch (_) { continue; }
        ultimo = j; tried[j] = true;
        // Re-probe only layers H is not already running (the primary is still trying: it must not close the fallback).
        try { arrancarSondas(ws, capas[j], url); } catch (_) {}
        agregar(ws, j); reprobarH(subs[subs.length - 1], j); armar(); return true;
      }
      ultimo = capas.length;
      try {
        var p = viaPeers(url);
        agregar(p, capas.length); reprobarH(subs[subs.length - 1], capas.length); armar(); return true;
      } catch (_) { return false; }
    }
    // One 3 s timer per started layer: still nothing open -> start the next one (never closes the earlier ones).
    function armar() {
      if (typeof setTimeout !== "function" || !CASCADA_MS) return;
      var t = setTimeout(function () { if (!cerradoH && abiertas().length === 0) siguiente(); }, CASCADA_MS);
      if (t && t.unref) t.unref();
    }
    tried[i0] = true; agregar(ws0, i0); armar();
    Object.defineProperties(H, {
      capaPrincipal: { get: function () { return ws0; } },
      readyState: { get: function () { return cerradoH ? 3 : abiertas().length ? 1 : 0; } },
      peerOnly: { get: function () { var l = abiertas(); if (!l.length) l = subs; return l.length > 0 && l.every(function (x) { return x.ws.peerOnly === true; }); } },
      signalingReady: { get: function () { return subs.some(function (x) { return x.ws.signalingReady === true; }); } },
      bufferedAmount: { get: function () { return subs.reduce(function (n, x) { return n + (Number(x.ws.bufferedAmount) || 0); }, 0); } },
      binaryType: { get: function () { return bin; }, set: function (v) { bin = v; subs.forEach(function (x) { try { x.ws.binaryType = v; } catch (_) {} }); } }
    });
    ["onopen", "onmessage", "onclose", "onerror"].forEach(function (n) { H[n] = null; });
    H.send = function (v) {
      var l = abiertas(), ok = false, err = null;
      if (cerradoH || !l.length) throw new DOMException("Socket is not open", "InvalidStateError");
      l.forEach(function (x) { try { x.ws.send(v); ok = true; } catch (e) { err = e; } });
      if (!ok) throw err; // e.g. QuotaExceededError must reach the caller
    };
    H.close = function (code, reason) {
      if (cerradoH) return;
      cerradoH = true; // before the subs close, so their close events do not start a fallback
      subs.forEach(function (x) { try { if (x.ws.readyState < 2) x.ws.close(code, reason); } catch (_) {} });
      cerradoH = false; terminar(code === undefined ? 1005 : code, reason || "", true);
    };
    ["confirmPeerReceipt", "acceptPeerAck"].forEach(function (n) {
      H[n] = function () {
        var args = arguments, r;
        subs.forEach(function (x) { if (typeof x.ws[n] === "function") { var v = x.ws[n].apply(x.ws, args); if (r === undefined) r = v; } });
        return r;
      };
    });
    return H;
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
      var apta = esFoto(url) ? usableFotos : usable;
      for (var i = 0; i < capas.length; i++) if (apta(capas[i])) {
        var ws; try { ws = envolver(capas[i], url); } catch (_) { continue; }
        // On a fallback layer, re-probe the earlier layers when their pause ends: the app reconnects, the earlier
        // layer gets this device's full-state checkpoint, and devices split across layers converge again.
        if (i > 0) reprobar(ws, capas.slice(0, i));
        try { arrancarSondas(ws, capas[i], url); } catch (_) {}
        // v659: with no timers the first layer stands alone (nothing could ever start the fallback).
        return typeof setTimeout === "function" && CASCADA_MS ? cascada(url, ws, i) : ws;
      }
      avisarSync("solo-peers");
      var directo = viaPeers(url);
      reprobar(directo, capas); // peers are the last fallback, never where a device stays once a durable layer is back
      return directo;
    }
  };
})();
