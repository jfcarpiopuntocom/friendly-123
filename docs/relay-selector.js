/* relay-selector.js (JFC 2026-11-02): a device that connects catches up alone. Durable layers in order:
   Supabase relay, then Firebase relay (firebase-relay.js), then the Hugging Face relay (hf-relay.js, owner order
   2026-11-04; to drop it remove its script tag); direct peers are the last fallback, never the only path.
   Every layer keeps the same encrypted frames, so they never conflict (Yjs merges any order, any repetition).
   Each durable layer has its own per-device daily byte budget so a free plan cannot burn again: past it, or when
   the layer refuses the room before opening (inactive room, 402, network), that layer pauses and the next one is
   used; pending writes stay in the caller's outbox. Photos are each business's responsibility: peers only.
   Load after peer-sync.js, supabase-relay.min.js, firebase-relay.js and hf-relay.js. */
(function () {
  "use strict";
  var sb = window.F123Relay, fb = window.F123FirebaseRelay, hf = window.F123RelayHF;
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
  // Third layer: same caps as Supabase (it is not exempt from the upload budget like the Firebase reserved lane).
  if (hf && typeof hf.connect === "function") capas.push({ relay: hf, key: "f123_relay_cupo_hf_v1" });
  function hoy() { return new Date().toISOString().slice(0, 10); }
  function leer(key) {
    var c = null; try { c = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
    var pausa = c && Number(c.pausaHasta) || 0;
    return c && c.dia === hoy() ? c : { dia: hoy(), up: 0, down: 0, pausaHasta: pausa };
  }
  function guardar(key, c) { try { localStorage.setItem(key, JSON.stringify(c)); } catch (_) {} }
  function bytes(v) { return v == null ? 0 : v.byteLength != null ? v.byteLength : v.size != null ? v.size : String(v).length; }
  function usable(capa) { var c = leer(capa.key); return Date.now() >= c.pausaHasta && (capa.relay === fb || c.up < CAP_UP) && c.down < CAP_DOWN; }
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
    if (capa.relay === fb) {
      delete _headFb[url]; // this device writes there now: its own writes must not count later
      // v657: when this Firebase session ends, remember the head it left so its own writes are not taken for another device's.
      ws.addEventListener("close", function () { try { Promise.resolve(fb.leerHead(url)).then(function (h) { if (h) anotarHead(url, h.rev + ":" + h.seq); }).catch(function () {}); } catch (_) {} });
    }
    else if (capa.relay !== hf) sondaOtraCapa(url, ws);
    var t = setInterval(function () {
      if (ws.readyState >= 2) return clearInterval(t);
      if (ws.readyState !== 1 || (typeof document !== "undefined" && document.hidden)) return;
      if (leer(capa.key).up + HEAD.length <= CAP_UP) ws.send(HEAD);
      if (capa.relay !== fb && capa.relay !== hf) sondaOtraCapa(url, ws);
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
    if (capa.relay === fb || capa.relay === hf || !fb || typeof fb.leerHead !== "function" || h.unsupported || Number(h.rev) || Number(h.seq)) return;
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
    // v646: the last durable layer retries in 60 s: a device that opened with no signal must catch up as soon as it returns.
    // v651: the app closing its own socket mid-open is no refusal (refusals carry a code). It paused Firebase 60 s at startup and dropped the base room to peers.
    var cerrar = ws.close.bind(ws), soltado = false, fallo = false, sinRespuesta = false;
    ws.addEventListener("error", function () { fallo = true; }); // the app answers an error by closing with no code: that is still a refusal
    ws.close = function (code, motivo) { if (code === undefined) soltado = true; return cerrar(code, motivo); };
    /* v656 (sync3 QA 2026-11-03): a layer whose server cannot be reached (network cut, no answer within 8 s) is an outage,
       not a refusal. Measured before: Supabase unreachable took 54 s to hand over, and a short internet cut parked
       Supabase 15 min / Firebase 60 s, so a sale made in that window and the app closed reached no durable layer.
       Now: no open within 3 s -> hand over (JFC 2026-11-04: «3 segundos y punto», sequential 1 Supabase -> 2 Firebase -> 3 direct); network-type failures pause the layer only 5 s. Server refusals (codes
       such as 1011/1013/4xxx: inactive room, 402 quota) keep the 15 min / 60 s pause that protects the free plans. */
    if (typeof setTimeout === "function") setTimeout(function () { if (!abierto && ws.readyState < 2) { sinRespuesta = true; fallo = true; try { cerrar(); } catch (_) {} } }, 3000);
    ws.addEventListener("close", function (e) {
      if (abierto || !(fallo || !soltado || (e && e.code && e.code !== 1000))) return;
      var red = sinRespuesta || (fallo && !(e && e.code && e.code !== 1006)); // no answer, or an error with no server code
      var c = leer(key); c.pausaHasta = Date.now() + (red ? PAUSA_RED_MS : (capa.relay === fb || capa.relay === hf ? 60000 : PAUSA_MS)); guardar(key, c);
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
        var limite = n <= FRAME_RESERVADO || !/-(y|ops|fotos)$/.test(String(url)) ? CAP_UP_RESERVA : CAP_UP;
        if (c.up + n > limite) throw new DOMException("Daily relay budget reached", "QuotaExceededError");
        c.up += n; guardar(key, c); return enviar(v);
      }
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
      avisarSync("solo-peers");
      var directo = viaPeers(url);
      reprobar(directo, capas); // peers are the last fallback, never where a device stays once a durable layer is back
      return directo;
    }
  };
})();
