// sync-yjs.js — PLAN C del sync redundante (CRDT / Yjs). FASE 0, spike.
//
// POR QUÉ EXISTE (JFC 2026-09-10): el sync casero (sync-realtime.js: relay +
// Lamport + LWW + vector) funciona, pero JFC quiere REDUNDANCIA real en cascada
// de fallbacks (diseño suyo): Plan A = nube propia del usuario, Plan B = 2ª nube
// propia, Plan C = CRDT device-to-device que sirve AUNQUE todas las nubes estén
// caídas. Yjs es ese piso garantizado. Aquí se construye Plan C PRIMERO porque no
// depende de nadie y da alivio inmediato.
//
// SEGURIDAD / PRIME DIRECTIVE: ningún dato del cliente sale sin cifrar. Se usa el
// MISMO esquema del sync actual (PBKDF2 del código de sala -> AES-GCM). El código
// nunca viaja. El relay solo rebota bytes que no puede leer.
//
// ENCENDIDO POR DEFECTO (JFC 2026-09-15): es el único motor que cruza los BYTES
// de las fotos device-to-device (sala "-fotos"). Solo se apaga si el dueño guarda
// localStorage["OC_YJS_FASE0"] === "0". NO cuesta nada al que trabaja solo:
// arrancar() no hace nada sin cuaderno compartido. Corre EN PARALELO al sync casero, en una
// SALA DISTINTA del relay (sufijo "-y"), así los updates binarios de Yjs jamás
// llegan al handler JSON de sync-realtime.js.
// FASE 1 (2026-09-10): sincroniza TODAS las colecciones del catálogo (productos,
// ubicaciones, usuarios, clientes) como Y.Maps de un mismo Y.Doc.
// FASE 2 (2026-09-09, JFC "ya conectalo, world class"): Plan C YA lee/escribe el
// store REAL de la app (mock-backend.js). store->Yjs con OCSync.catalogoPropio();
// Yjs->store con OCSync.aplicarCatalogo() — el merge ADD-ONLY ya probado en
// producción: nunca borra, nunca pierde, los merges son aditivos. Ver conectarStore().
// Flag OC_YJS_FASE0 (toggle en Avanzado) ahora es escotilla de APAGADO ("0");
// corre en paralelo al sync casero y en sala de relay separada ("-y").
(function () {
  "use strict";

  var FLAG = "OC_YJS_FASE0";
  /* SYNC NUEVO ENCENDIDO POR DEFECTO (JFC 2026-09-15). Antes estaba detrás del
     flag apagado y por eso los BYTES de las fotos nunca cruzaban (solo este
     motor los mueve, sala "-fotos"). Ahora corre para todos, EN PARALELO al
     sync viejo (no lo reemplaza: menos riesgo). Escotilla de escape: si el
     toggle de Avanzado guarda "0" explícito, se apaga. Sin clave (null) = ON. */
  function activo() { try { return localStorage.getItem(FLAG) !== "0"; } catch (_) { return true; } }
  if (!activo()) return; // solo se apaga si el dueño lo puso en "0" a mano

  // Mismos parámetros que sync-realtime.js (NO cambiar sin cambiar allá también).
  var ROOM_KEY = "f123_sync_room";
  var SALT_FIJO = "amigable-sync-v1";
  var RELAY_URL = "wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/";
  var BUNDLE = "./vendor/yjs-bundle.min.js";

  function leerSala() { try { return JSON.parse(localStorage.getItem(ROOM_KEY) || "null"); } catch (_) { return null; } }
  function normalizarCodigo(c) { return String(c || "").trim().toUpperCase(); }

  async function derivarClave(codigo) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", enc.encode(codigo), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(SALT_FIJO), iterations: 100000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function idDeSala(codigo) {
    var enc = new TextEncoder();
    var hash = await crypto.subtle.digest("SHA-256", enc.encode("amigable-sala:" + codigo));
    return [].slice.call(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("").slice(0, 40);
  }
  // Cifrado BINARIO (updates de Yjs son bytes, no JSON): AES-GCM, iv de 12 al frente.
  async function cifrarBin(clave, bytes) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var cif = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, clave, bytes);
    var out = new Uint8Array(iv.length + cif.byteLength);
    out.set(iv, 0); out.set(new Uint8Array(cif), iv.length);
    return out.buffer;
  }
  async function descifrarBin(clave, buffer) {
    var bytes = new Uint8Array(buffer);
    var iv = bytes.slice(0, 12), cif = bytes.slice(12);
    var claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, clave, cif);
    return new Uint8Array(claro);
  }

  // ===================================================================
  // CANAL DE RELAY con HANDSHAKE de catch-up (JFC 2026-09-10, fix del bug
  // "no sincronizan fotos ni el nombre"). ANTES: cada aparato solo mandaba su
  // estado en onopen; un aparato YA conectado no le compartía nada al que entra
  // DESPUÉS, así que lo puesto antes (nombre, fotos) nunca llegaba (el relay solo
  // rebota, no guarda historia). AHORA: state-vector de Yjs, dos vías y loop-safe.
  //   Marco: 1 byte de tag + payload, todo cifrado.
  //     tag 0 = update binario (aplicar)
  //     tag 1 = "hola": mi state-vector. Quien lo recibe responde con lo que al
  //             otro le falta (tag 0) Y su propio SV (tag 2) para pedir lo suyo.
  //     tag 2 = respuesta de SV: se contesta SOLO con el diff (tag 0), sin re-pedir
  //             (corta el ciclo). Así ambos convergen en un ida y vuelta.
  // Un solo canal por Y.Doc (catálogo, fotos y ops usan cada uno el suyo).
  // ===================================================================
  function _frame(tag, payload) { var out = new Uint8Array(1 + payload.length); out[0] = tag; out.set(payload, 1); return out; }
  function crearCanal(Y, doc, suffix, nombre, permiteCkpt, seedFn, persistencia) {
    var canal = { ws: null, pend: [], recuperando: true };
    var MAX_OP_BYTES = 250 * 1024; // guard final, despues de base64
    var CHUNK_BYTES = 160 * 1024; // base64 + sobre JSON permanecen bajo 256KB
    /* Las ops de fotos pueden acercarse a 180 KB cada una. Cuatro por pagina
       mantienen cada rafaga acotada; catalogo/ops, mucho mas chicos, usan 64. */
    var PULL_PAGE_SIZE = nombre === "fotos" ? 4 : 64;
    var T_CONEXION_ESTABLE_MS = 30000;
    var partesEntrantes = Object.create(null), partesEnVivo = Object.create(null);
    var MAX_GRUPOS_EN_VIVO = 64, MAX_BYTES_EN_VIVO = 16 * 1024 * 1024;
    var reintentos = 0; // backoff (fix B, JFC 2026-09-10): antes reconectaba fijo
                        // cada 4s; si el relay cerraba (p.ej. frame grande), era una
                        // tormenta de upgrades -> límite diario del worker. Ahora
                        // exponencial con jitter y tope 30s, como el sync viejo.
    var _tEstable = null;
    var _colaRecepcion = Promise.resolve();
    var _pullCursorKey = "f123_yjs_pull_cursor_v2" + suffix;
    var _pullCursor = { rev: -1, seq: 0 }, _appliedPullCursor = { rev: -1, seq: 0 };
    var _pullCursorReady = Promise.resolve();
    // Encrypted durable outbox lives alongside the local Y.Doc, scoped by room/channel.
    // WebSocket.send is delivery to the network, never acknowledgement of remote storage.
    var _outboxKey = "f123_relay_outbox_v1" + suffix;
    var _outbox = { pending: [], checkpoint: "", confirmed: [] }, _durableTimer = null, _durableDelay = 2000;
    // Leave headroom under this socket's 4 MiB cap for new changes and control frames.
    var MAX_BUFFERED_BYTES = 512 * 1024, MAX_DURABLE_INFLIGHT = 4, _bufferPumpTimer = null, _durableWatchdog = null, _durableInFlight = Object.create(null);
    var _lastRelayProgressAt = 0;
    var _currentPullState = null, _tReplay = null, _replayDelay = 30000;
    var _relayPeerCount = 0, _directReceive = null;
    var _peerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var _direct = Object.create(null);
    // Ephemeral encrypted correlation only; never business IDs or plaintext telemetry.
    var _measurementPeers = Object.create(null), _measurementCounter = 0;
    var _appliedMeasurements = new Map(), _measurementRequests = new Map();
    function boundedSet(map, key, value) {
      if (!map.has(key) && map.size >= 200) map.delete(map.keys().next().value);
      map.set(key, value);
    }
    function updateHash(bytes) {
      return crypto.subtle.digest("SHA-256", bytes).then(function (hash) {
        return Array.from(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    }
    function measureUpdate(payload) {
      var meter = window.OCLatencia;
      if (!meter || typeof meter.iniciarEntrega !== "function") return;
      var peers = Object.keys(_measurementPeers).filter(function (id) { return _measurementPeers[id] === true; });
      // Unknown/older participants invalidate coverage; never certify only the fastest peer.
      if (nombre !== "catalogo" || !canal.ws || canal.ws.readyState !== 1 || _relayPeerCount < 2 || peers.length !== _relayPeerCount - 1) peers = [];
      var id = _peerId + "_" + (++_measurementCounter);
      if (!meter.iniciarEntrega(id, nombre, peers)) return;
      updateHash(payload).then(function (hash) { signal("measure", "", { id: id, hash: hash }); }).catch(function () {});
    }
    function acknowledgeVisible(hash) {
      var applied = _appliedMeasurements.get(hash);
      if (!applied || Date.now() - applied.at > 10000) return;
      _measurementRequests.forEach(function (request, key) {
        if (request.hash !== hash || request.running) return;
        request.running = true;
        // This callback is an explicit application/render contract, not a paint timer
        // pretending that decrypting a frame made its business data visible.
        Promise.resolve().then(function () {
          if (doc.store && (doc.store.pendingStructs || doc.store.pendingDs)) return false;
          return applied.receipt;
        }).then(function (ok) {
          _measurementRequests.delete(key);
          if (ok === true) signal("visible", request.from, { id: request.id });
        }).catch(function () { _measurementRequests.delete(key); });
      });
    }
    function appliedUpdate(payload, receipt) {
      if (nombre !== "catalogo" || typeof crypto === "undefined" || !crypto.subtle) return;
      updateHash(payload).then(function (hash) {
        boundedSet(_appliedMeasurements, hash, { at: Date.now(), receipt: receipt });
        acknowledgeVisible(hash);
      }).catch(function () {});
    }
    function measurementSignal(msg) {
      if (msg.kind === "visible") {
        if (msg.to === _peerId && msg.data && window.OCLatencia && window.OCLatencia.confirmarEntrega)
          window.OCLatencia.confirmarEntrega(msg.data.id, msg.from);
        return true;
      }
      if (msg.kind !== "measure") return false;
      var data = msg.data;
      if (!data || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.id) || !/^[a-f0-9]{64}$/.test(data.hash)) return true;
      var key = msg.from + ":" + data.id;
      if (_measurementRequests.has(key)) return true;
      boundedSet(_measurementRequests, key, { from: msg.from, id: data.id, hash: data.hash, running: false });
      acknowledgeVisible(data.hash);
      return true;
    }
    function signal(kind, to, data) {
      if (typeof TextEncoder === "undefined") return;
      publicar(4, new TextEncoder().encode(JSON.stringify({ from: _peerId, to: to || "", kind: kind, data: data })), false);
    }
    function attachDirect(peer, channel) {
      peer.dc = channel; channel.binaryType = "arraybuffer";
      channel.onmessage = function (ev) {
        if (_directReceive && ev.data instanceof ArrayBuffer) _directReceive(ev.data);
      };
      channel.onopen = function () { canal.paresDirectos = Object.values(_direct).filter(function (p) { return p.dc && p.dc.readyState === "open"; }).length; };
      channel.onclose = function () { canal.paresDirectos = Object.values(_direct).filter(function (p) { return p.dc && p.dc.readyState === "open"; }).length; };
    }
    function directPeer(id) {
      // v517 (informe Codex #1): limpiar ANTES de reutilizar; un par failed/closed ya no se devuelve.
      // v514: como el cierre del relay ya no vacia la lista, se limpian aqui los pares muertos.
      Object.keys(_direct).forEach(function (k) {
        var st = _direct[k].pc && _direct[k].pc.connectionState;
        if (st === "closed" || st === "failed") { try { _direct[k].pc.close(); } catch (_) {} delete _direct[k]; }
      });
      if (_direct[id]) return _direct[id];
      if (Object.keys(_direct).length >= 11) return null;
      var pc = new RTCPeerConnection({ iceServers: [] });
      var peer = _direct[id] = { pc: pc, dc: null, ice: [] };
      pc.onicecandidate = function (ev) { if (ev.candidate) signal("ice", id, ev.candidate.toJSON()); };
      pc.ondatachannel = function (ev) { attachDirect(peer, ev.channel); };
      return peer;
    }
    async function receiveSignal(msg) {
      if (!msg || typeof msg.from !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(msg.from) ||
          msg.from === _peerId || (msg.to && msg.to !== _peerId)) return;
      if (measurementSignal(msg)) return;
      if (msg.kind === "hello") {
        var first = !Object.prototype.hasOwnProperty.call(_measurementPeers, msg.from);
        if (Object.keys(_measurementPeers).length < 32 || !first) _measurementPeers[msg.from] = !!(msg.data && msg.data.measurement === 1);
        if (first) signal("hello", msg.from, { measurement: 1 });
      }
      if (typeof RTCPeerConnection === "undefined") return;
      var peer = directPeer(msg.from), known = !!(peer && peer.dc); // v517: known tras limpiar
      if (!peer) return;
      try {
        if (msg.kind === "hello") {
          // Capability hello is answered once above, independently of WebRTC.
          if (_peerId < msg.from && peer.pc.signalingState === "stable" && !peer.dc) {
            attachDirect(peer, peer.pc.createDataChannel("friendly-ciphertext"));
            await peer.pc.setLocalDescription(await peer.pc.createOffer());
            signal("offer", msg.from, peer.pc.localDescription.toJSON());
          }
        } else if (msg.kind === "offer" && msg.from < _peerId) {
          await peer.pc.setRemoteDescription(msg.data);
          for (const ice of peer.ice.splice(0)) await peer.pc.addIceCandidate(ice);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          signal("answer", msg.from, peer.pc.localDescription.toJSON());
        } else if (msg.kind === "answer" && peer.pc.signalingState === "have-local-offer") {
          await peer.pc.setRemoteDescription(msg.data);
          for (const ice of peer.ice.splice(0)) await peer.pc.addIceCandidate(ice);
        } else if (msg.kind === "ice") {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(msg.data);
          else if (peer.ice.length < 64) peer.ice.push(msg.data);
        }
      } catch (_) { try { peer.pc.close(); } catch (_) {} delete _direct[msg.from]; }
    }
    function enviarDirecto(buf) {
      var peers = Object.values(_direct).filter(function (p) { return p.dc && p.dc.readyState === "open"; });
      // v514: sin relay, se entrega en vivo a los pares directos abiertos, pero se devuelve false
      // para que el mismo cambio quede tambien en la cola del relay (nadie se queda sin el).
      if (!canal.ws || canal.ws.readyState !== 1) {
        peers.forEach(function (p) { try { if (p.dc.bufferedAmount <= 512 * 1024) p.dc.send(buf); } catch (_) {} });
        return false;
      }
      // Never omit a relay-only device. Presence comes from the relay, not a guess.
      if (_relayPeerCount < 2 || peers.length !== _relayPeerCount - 1) return false;
      if (peers.some(function (p) { return p.dc.bufferedAmount > 512 * 1024 || buf.byteLength > (p.pc.sctp && p.pc.sctp.maxMessageSize || 65536); })) return false;
      try { peers.forEach(function (p) { p.dc.send(buf); }); return true; } catch (_) { return false; }
    }
    var _unsaved = [];
    function avisarDurable() {
      canal.pendientesRelay = _outbox.pending.length + _unsaved.filter(function (entry) {
        return !_outbox.pending.some(function (x) { return x.id === entry.id; });
      }).length;
      try { window.dispatchEvent(new CustomEvent("oc-relay-durable", { detail: { canal: nombre, pendientes: canal.pendientesRelay } })); } catch (_) {}
    }
    function leerOutbox() {
      if (persistencia && typeof persistencia.get === "function") return persistencia.get(_outboxKey);
      try { return Promise.resolve(JSON.parse(localStorage.getItem(_outboxKey + API.roomId) || "null")); }
      catch (e) { return Promise.reject(e); }
    }
    function guardarOutbox() {
      if (persistencia && typeof persistencia.set === "function") return persistencia.set(_outboxKey, _outbox);
      try { localStorage.setItem(_outboxKey + API.roomId, JSON.stringify(_outbox)); return Promise.resolve(); }
      catch (e) { return Promise.reject(e); }
    }
    function mutarOutbox(change) {
      var run = function () {
        return leerOutbox().then(function (saved) {
          _outbox = saved && Array.isArray(saved.pending) ? saved : { pending: [], checkpoint: "", confirmed: [] };
          if (!Array.isArray(_outbox.confirmed)) _outbox.confirmed = [];
          var included = _unsaved.slice();
          included.forEach(function (entry) {
            if (!_outbox.pending.some(function (x) { return x.id === entry.id; })) _outbox.pending.push(entry);
          });
          change();
          return guardarOutbox().then(function () {
            // Preparation continues while IndexedDB commits. Only remove the
            // entries included in this write; later groups still need saving.
            _unsaved = _unsaved.filter(function (entry) { return !included.includes(entry); });
            avisarDurable();
          });
        });
      };
      // Tabs share this IndexedDB: serialize read/modify/write across contexts as well.
      return typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("f123-relay-outbox-" + API.roomId + suffix, run) : run();
    }
    var _durableQueue = leerOutbox().then(function (saved) {
      if (saved && Array.isArray(saved.pending)) _outbox = saved;
      avisarDurable();
    });
    // Keep a handled rejection, but do not overwrite an unread outbox after a read failure.
    _durableQueue.catch(function () { log("no se pudo leer pendientes del relay en " + nombre); });
    function programarDurable() {
      var inFlight = Object.keys(_durableInFlight);
      if (inFlight.length && !_durableWatchdog && canal.ws && canal.ws.readyState === 1) {
        var oldest = Math.min.apply(null, inFlight.map(function (id) { return _durableInFlight[id].at; }));
        _durableWatchdog = setTimeout(function () {
          _durableWatchdog = null;
          if (!canal.ws || canal.ws.readyState !== 1) return;
          Object.keys(_durableInFlight).forEach(function (id) {
            if (Date.now() - _durableInFlight[id].at >= 10000) delete _durableInFlight[id];
          });
          _durableQueue.then(drenarDurable).catch(function () { programarDurable(); });
        }, Math.max(1, oldest + 10000 - Date.now()));
      }
      if (_durableTimer || (!_outbox.pending.length && !_unsaved.length)) return;
      if (canal.ws && canal.ws.readyState === 1 && inFlight.length >= MAX_DURABLE_INFLIGHT) return;
      if (_outbox.pending.length && _outbox.pending.every(function (entry) { return !!_durableInFlight[entry.id]; })) return;
      _durableTimer = setTimeout(function () {
        _durableTimer = null;
        _durableDelay = Math.min(60000, _durableDelay * 2);
        _durableQueue = _durableQueue.then(function () { return mutarOutbox(function () {}); }).then(drenarDurable).catch(function () { programarDurable(); });
      }, Math.round(_durableDelay * (0.8 + Math.random() * 0.4)));
    }
    function bytesPendientes(value) { return typeof value === "string" ? value.length : (value && (value.byteLength || value.size)) || 0; }
    function programarBufferPump() {
      if (_bufferPumpTimer || !canal.ws || canal.ws.readyState !== 1) return;
      _bufferPumpTimer = setTimeout(function () {
        _bufferPumpTimer = null;
        if (!canal.ws || canal.ws.readyState !== 1) return;
        if (Date.now() - _lastRelayProgressAt >= 10000) {
          canal.ws.close(1013, "relay stalled; queued data retained");
          return;
        }
        _durableQueue.then(function () { drenarDurable(); drenarVivo(); }).catch(function () {});
      }, 100);
    }
    function enviarConLimite(ws, value) {
      if (!ws || ws.readyState !== 1) return "offline";
      if ((Number(ws.bufferedAmount) || 0) + bytesPendientes(value) > MAX_BUFFERED_BYTES) return "blocked";
      try { ws.send(value); _lastRelayProgressAt = Date.now(); return "sent"; }
      catch (_) { try { if (ws.readyState === 1) ws.close(1011, "relay send failed"); } catch (_) {} return "failed"; }
    }
    function encolarVivo(value, smallBusiness) {
      var ws = canal.ws;
      if (ws && ws.readyState === 1 && !canal.pend.length) {
        var result = enviarConLimite(ws, value);
        if (result === "sent") return;
        if (result !== "blocked") { canal.pend.push(value); return; }
      }
      // Yjs updates commute; let a new small update pass historical live chunks.
      if (smallBusiness) {
        var firstLarge = canal.pend.findIndex(function (frame) { return bytesPendientes(frame) >= CHUNK_BYTES; });
        canal.pend.splice(firstLarge < 0 ? canal.pend.length : firstLarge, 0, value);
      } else canal.pend.push(value);
      if (ws && ws.readyState === 1) programarBufferPump();
    }
    function drenarVivo() {
      var ws = canal.ws;
      if (!ws || ws.readyState !== 1) return;
      while (canal.pend.length) {
        var next = canal.pend[0], result = enviarConLimite(ws, next);
        if (result === "sent") { canal.pend.shift(); continue; }
        if (result === "blocked") programarBufferPump();
        break;
      }
      if (canal.pend.length && ws.readyState === 1) programarBufferPump();
    }
    function enviarDurable(entry) {
      var msg = Object.assign({}, entry); delete msg.state; delete msg.fingerprint;
      var result = enviarConLimite(canal.ws, JSON.stringify(msg));
      if (result === "sent") { _durableInFlight[entry.id] = { kind: entry.k, at: Date.now() }; return true; }
      if (result === "blocked") programarBufferPump();
      return false;
    }
    function drenarDurable() {
      var ws = canal.ws;
      if (!ws || ws.readyState !== 1) { programarDurable(); return; }
      var capacity = Math.max(0, MAX_DURABLE_INFLIGHT - Object.keys(_durableInFlight).length);
      if (!capacity) { programarDurable(); return; }
      var available = _outbox.pending.filter(function (entry) { return !_durableInFlight[entry.id]; });
      if (available.length > capacity) {
        // Reserve one in-flight slot for the newest business change behind a history backlog.
        available = available.slice(0, Math.max(0, capacity - 1)).concat(available[available.length - 1]);
      }
      for (var i = 0; i < available.length; i++) if (!enviarDurable(available[i])) break;
      if (_outbox.pending.some(function (entry) { return !_durableInFlight[entry.id]; }) && ws.readyState === 1) programarDurable();
      if (Object.keys(_durableInFlight).length) programarDurable();
    }
    function guardarSobre(entry) { guardarSobres([entry]); }
    function guardarSobres(entries) {
      var added = entries.filter(function (entry) {
        if (_outbox.confirmed && _outbox.confirmed.includes(entry.fingerprint || entry.id)) return false;
        return !_outbox.pending.concat(_unsaved).some(function (x) {
          return x.id === entry.id || (entry.fingerprint && x.fingerprint === entry.fingerprint);
        });
      });
      if (!added.length) return;
      // All siblings enter one atomic local outbox write before any durable
      // fragment is sent. A restart can then retry the complete group.
      _unsaved.push.apply(_unsaved, added);
      avisarDurable();
      var next = _durableQueue.then(function () {
        return mutarOutbox(function () {}).then(function () { drenarDurable(); programarDurable(); });
      });
      _durableQueue = next.catch(function () { log("guardado del envio pendiente en " + nombre); avisarDurable(); programarDurable(); });
    }
    function confirmarDurable(result) {
      _durableQueue = _durableQueue.then(function () {
        if (result && typeof result.id === "string" && _durableInFlight[result.id] && _durableInFlight[result.id].kind === result.kind) {
          delete _durableInFlight[result.id];
          if (!Object.keys(_durableInFlight).length) { clearTimeout(_durableWatchdog); _durableWatchdog = null; }
        }
        if (result.ok !== true && !(result.kind === "ckpt" && result.conflict === true)) { programarDurable(); return; }
        return mutarOutbox(function () {
          var entry = _outbox.pending.find(function (x) { return x.id === result.id && x.k === result.kind; });
          if (!entry) return;
          _outbox.pending = _outbox.pending.filter(function (x) { return x !== entry; });
          if (entry.k === "op" && result.ok === true) _outbox.confirmed = _outbox.confirmed.concat(entry.fingerprint || entry.id).slice(-2048);
          if (entry.k === "ckpt" && result.ok === true) _outbox.checkpoint = entry.state;
        }).then(function () {
          avisarDurable();
          if (result.conflict && canal.ws && _currentPullState) {
            pedirPagina(canal.ws, _currentPullState);
            clearTimeout(_tCkpt); _tCkpt = setTimeout(hacerCkpt, 60000);
          }
          if (!_outbox.pending.length) { clearTimeout(_durableTimer); _durableTimer = null; _durableDelay = 2000; }
          else { clearTimeout(_durableTimer); _durableTimer = null; drenarDurable(); }
        }).catch(function () { programarDurable(); });
      });
    }
    if (persistencia && typeof persistencia.get === "function") {
      _pullCursorReady = persistencia.get(_pullCursorKey).then(function (guardado) {
        if (guardado && Number.isFinite(Number(guardado.rev)) && Number.isFinite(Number(guardado.seq))) {
          _pullCursor = { rev: Math.trunc(Number(guardado.rev)), seq: Math.max(0, Math.trunc(Number(guardado.seq) || 0)) };
          _appliedPullCursor = _pullCursor;
        }
      }).catch(function () {});
    }
    function guardarPullCursor(cursor) {
      var siguiente = {
        rev: Number.isFinite(Number(cursor.rev)) ? Math.trunc(Number(cursor.rev)) : -1,
        seq: Math.max(0, Math.trunc(Number(cursor.seq) || 0))
      };
      if (siguiente.rev < _appliedPullCursor.rev ||
          (siguiente.rev === _appliedPullCursor.rev && siguiente.seq <= _appliedPullCursor.seq)) return Promise.resolve();
      _pullCursor = siguiente;
      // Continue paging in memory, but a restart must replay every fragment
      // until its complete update has entered the persisted Y.Doc. Otherwise
      // the next process could checkpoint a cursor whose bytes it never had.
      if (Object.keys(partesEntrantes).length ||
          (doc.store && (doc.store.pendingStructs || doc.store.pendingDs))) {
        // Do not persist a cursor past a page whose Yjs dependencies have not
        // actually become part of the document. Paging may continue in RAM.
        return Promise.resolve();
      }
      _appliedPullCursor = siguiente;
      if (!persistencia || typeof persistencia.set !== "function") return Promise.resolve();
      /* IndexeddbPersistence encola este write DESPUES de los updates Yjs que
         acabamos de aplicar. Cursor y estado viven en la misma base: si se
         borra la base, tambien se borra el cursor y el aparato vuelve desde 0. */
      return persistencia.set(_pullCursorKey, _pullCursor).catch(function () {});
    }
    function pedirPagina(sock, estado) {
      estado.enCurso = true; estado.fallos = 0;
      return _pullCursorReady.then(function () {
        if (sock !== canal.ws || sock.readyState !== 1) return;
        sock.send(JSON.stringify({ k: "pull", v: 2, rev: _pullCursor.rev, seq: _pullCursor.seq, limit: PULL_PAGE_SIZE }));
      }).catch(function () {});
    }
    function reprogramar() {
      reintentos++;
      var base = Math.min(30000, 1000 * Math.pow(2, Math.min(reintentos, 5))); // 2,4,8,16,32->30s
      var delay = base / 2 + Math.random() * base / 2; // jitter: no todos reconectan a la vez
      setTimeout(conectar, delay);
    }
    function enviar(tag, payload) {
      if (!API.clave) return;
      publicar(tag, payload, false);
    }
    // Delivery measurement uses encrypted update hashes and a rendered acknowledgement.
    // Old k:"lat" probes remain receive-only diagnostics and cannot approve the SLA.
    // Un update grande no cabe en el relay. Los trozos son frames cifrados
    // independientes; se reconstruyen antes de aplicar Yjs, nunca parcialmente.
    function publicar(tag, payload, persistir) {
      if (tag === 0 && persistir) {
        try { measureUpdate(payload); } catch (_) {} // diagnostics cannot block business delivery
        try {
          if (nombre === "catalogo" && window.OCLatencia && !window.OCLatencia.hayReloj() && canal.ws && canal.ws.readyState === 1)
            canal.ws.send(JSON.stringify({ k: "ts", t0: Date.now() }));
        } catch (_) {} // optional clock diagnostics must not block the update either
      }
      var piezas = Math.max(1, Math.ceil(payload.length / CHUNK_BYTES));
      if (piezas > 65535) { log("update Yjs excede limite de trozos"); return; }
      var id = Date.now().toString(36).padStart(10, "0").slice(-10) + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
      var prepared = [];
      for (var n = 0; n < piezas; n++) {
        var pedazo = payload.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES);
        let frame;
        if (piezas === 1) frame = _frame(tag, pedazo);
        else {
          frame = new Uint8Array(22 + pedazo.length);
          frame[0] = 3; frame[1] = tag;
          for (var j = 0; j < 16; j++) frame[2 + j] = id.charCodeAt(j);
          frame[18] = n >> 8; frame[19] = n & 255;
          frame[20] = piezas >> 8; frame[21] = piezas & 255;
          frame.set(pedazo, 22);
        }
        prepared.push(cifrarBin(API.clave, frame).then(async function (buf) {
          if (buf.byteLength > MAX_OP_BYTES) { log("trozo Yjs supera limite: " + buf.byteLength); return; }
          /* v514 (JFC 2026-10-14, fallos 2 y 3 que reprodujo Codex en v512): primero se GUARDA
             el pendiente y despues se envia. Antes, si fallaba la huella SHA-256 o el envio
             lanzaba justo en ese instante, el .catch vacio se tragaba el error y el cambio
             nunca quedaba pendiente para el relay. La huella es opcional: sin ella se
             deduplica por id. Prueba: test/sync-v514-fallos-codex.test.js */
          var op;
          if (persistir) {
            var stableId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8), fingerprint = "";
            try {
              if (typeof crypto !== "undefined" && crypto.subtle) {
                var digest = await crypto.subtle.digest("SHA-256", frame);
                fingerprint = Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
              }
            } catch (_) { fingerprint = ""; }
            // Content fingerprint stays local; the relay still sees a random id and ciphertext.
            op = { k: "op", ack: 1, id: stableId, fingerprint: fingerprint, lam: Date.now() + (++_lamCtr), c: _b64(buf) };
            if (JSON.stringify(op).length > MAX_OP_BYTES) { log("op Yjs supera limite"); return; }
          }
          var directo = false;
          try { directo = tag === 0 && enviarDirecto(buf); } catch (_) { directo = false; }
          if (!directo) {
            encolarVivo(buf, tag === 0 && persistir && piezas === 1);
          }
          return op;
        }).catch(function () {}));
      }
      if (persistir) Promise.all(prepared).then(function (entries) {
        if (entries.every(function (entry) { return !!entry; })) guardarSobres(entries);
        else log("grupo Yjs incompleto; no se envia historial parcial");
      }).catch(function () {});
    }
    /* PERSISTENCIA DEL SYNC NUEVO (JFC 2026-09-15, v285). EL BUG DE 3 SEMANAS: el
       relay solo REBOTA los frames binarios de Yjs en vivo, NO los guarda. Así dos
       aparatos solo convergían si estaban abiertos A LA VEZ; abiertos en momentos
       distintos nunca se ponían al día (verificado: al conectar a una sala sin nadie
       en línea llegan 0 mensajes). El relay SÍ sabe persistir, pero solo por el
       protocolo de texto op/ckpt/pull (verificado: envías op, cierras, reconectas,
       pull -> vuelve intacto). Aquí el cliente Yjs USA ese canal: cada update LOCAL
       se guarda como {k:"op"} (el mismo frame binario cifrado, en base64) y al
       conectar se pide {k:"pull"} para recibir todo lo persistido. El relay reenvía
       cada op guardada como frame binario -> cae en manejar() -> tag 0 -> applyUpdate.
       Los updates de Yjs son idempotentes y conmutativos, así que reaplicar todo en
       cada conexión converge sin duplicar. Zero-knowledge intacto: el relay guarda
       bytes cifrados, no entiende nada. */
    var _lamCtr = 0;
    function _b64(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
    canal.enviarUpdate = function (update) {
      if (!API.clave) return;
      publicar(0, update, true);
    };
    /* CHECKPOINT (v286, #1 + fix real "el catálogo viejo no cruza"). enviarUpdate
       solo persiste CAMBIOS nuevos. Pero el catálogo que ya vivía en el IndexedDB
       de Yjs (de antes de v285) nunca generó una op -> un aparato que hace pull no
       lo recibía. Por eso el item nuevo cruzaba pero el inventario existente no.
       Aquí, al conectar (tras dar tiempo al pull), se manda el ESTADO COMPLETO como
       {k:"ckpt"}: el relay lo guarda como 'latest' y sirve al que entra, y de paso
       poda las ops que resume (compactación). Guardas de seguridad:
         - Solo si el doc tiene contenido real (no pisar el ckpt del relay con un
           doc vacío recién arrancado). El relay además rechaza un ckpt de lam menor
           (C1 guard), así que un aparato que ya hizo pull manda un ckpt superset.
         - Solo en canales con permiteCkpt (catálogo y ops; NO fotos: su estado
           completo supera el frame de 256KB). */
    var _tCkpt = null;
    function hacerCkpt() {
      if (!permiteCkpt || !API.clave || !canal.ws || canal.ws.readyState !== 1) return;
      // Never compact a partly restored store, even when an old applied cursor
      // exists: a completed pull AND dependency-free document are required.
      if (canal.recuperando || (_currentPullState && _currentPullState.enCurso)) return;
      // A page may contain only part of a large update. Those chunks are not
      // represented in the Y.Doc yet and cannot be compacted by its snapshot.
      if (_appliedPullCursor.rev < 0 || Object.keys(partesEntrantes).length) return;
      // Unresolved Yjs dependencies cannot authorize compacting their source history.
      if (doc.store && (doc.store.pendingStructs || doc.store.pendingDs)) return;
      // Capture the applied cursor in the SAME synchronous turn as the bytes.
      // Encryption yields: a later page must never expand this snapshot's cut.
      var checkpointCursor = { rev: _appliedPullCursor.rev, seq: _appliedPullCursor.seq };
      var full; try { full = Y.encodeStateAsUpdate(doc); } catch (_) { return; }
      if (!full || full.length < 16) return; // doc prácticamente vacío: no pisar el ckpt bueno del relay
      var state = _b64(full);
      if (state === _outbox.checkpoint || _outbox.pending.some(function (x) { return x.k === "ckpt"; })) return;
      cifrarBin(API.clave, _frame(0, full)).then(function (buf) {
        if (Math.ceil(buf.byteLength * 4 / 3) + 128 > MAX_OP_BYTES) { try { log("ckpt grande (" + buf.byteLength + "B) omitido en " + nombre); } catch (_) {} return; }
        try {
          /* rev+seq prueban exactamente hasta que fila persistida contiene este
             estado. El relay nunca poda una operacion concurrente posterior. */
          guardarSobre({ k: "ckpt", ack: 1, id: "ck-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
            v: 2, rev: checkpointCursor.rev, seq: checkpointCursor.seq, lam: Date.now(), c: _b64(buf), state: state });
        } catch (_) {}
      }).catch(function () {});
    }
    function conectar() {
      var url = RELAY_URL + API.roomId + suffix;
      var ws; try {
        if (!window.F123Relay || typeof window.F123Relay.connect !== "function") throw new Error("native relay unavailable");
        ws = window.F123Relay.connect(url);
      } catch (_) { reprogramar(); return; }
      var pullEstado = { enCurso: false, fallos: 0 };
      _currentPullState = pullEstado;
      ws.binaryType = "arraybuffer"; canal.ws = ws;
      ws.onopen = function () {
        _lastRelayProgressAt = Date.now();
        /* Un upgrade que abre y cae enseguida NO es una conexion sana. Antes
           reseteaba el backoff aqui y el canal de fotos podia reconectar cada
           pocos segundos para repetir un pull enorme. Solo una conexion que
           sigue viva 30 s vuelve el backoff a cero. */
        clearTimeout(_tEstable);
        _tEstable = setTimeout(function () {
          if (canal.ws === ws && ws.readyState === 1) reintentos = 0;
        }, T_CONEXION_ESTABLE_MS);
        try { enviar(1, Y.encodeStateVector(doc)); } catch (_) {} // "hola": a quien esté en vivo
        // The same channel still owns its Y.Doc and fragment assembly after
        // reconnect. Keep their RAM cursor; a new process loads the durable cut.
        _colaRecepcion = _colaRecepcion.then(function () { return _pullCursorReady; }).then(function () {
          if (canal.ws !== ws) return;
          return pedirPagina(ws, pullEstado);
        });
        /* Sincroniza el reloj con el relay: UNA vez al conectar y SOLO en el canal
           "catalogo". FIX de costo (JFC 2026-09-22, v337): la v335 hacia ping cada
           60 s en LOS TRES canales (catalogo, fotos, ops). El relay usa WebSocket
           Hibernation, cuyo unico proposito es no cobrar mientras esta quieto, y
           cada mensaje entrante lo despierta: eran 3 despertares por minuto por
           aparato, para siempre, aunque nadie tocara nada. Encima era redundante:
           el desfase es del RELOJ DEL APARATO, no del canal, y OCLatencia lo
           guarda una sola vez para todos. El refresco ya no es por reloj sino por
           ACTIVIDAD: marcarSalida() pide un ping nuevo solo cuando va a sellar un
           cambio y el reloj caduco. Costo en reposo: cero.
           NO volver a poner un setInterval aqui. */
        if (nombre === "catalogo") {
          try { ws.send(JSON.stringify({ k: "ts", t0: Date.now() })); } catch (_) {}
        }
        drenarVivo();
        _durableQueue.then(drenarDurable).catch(function () {});
        signal("hello", "", { measurement: 1 });
        // Tras dar tiempo al pull (para que este aparato ya tenga lo de los demás),
        // publicar el estado COMPLETO como checkpoint: así el catálogo que ya tenía
        // (aunque nunca haya cambiado desde v285) queda disponible para el que entre.
        if (permiteCkpt) { clearTimeout(_tCkpt); _tCkpt = setTimeout(hacerCkpt, 2500); }
        // Canal sin ckpt (fotos): sembrado propio al conectar (cada foto va como
        // op individual, que sí cabe en el frame). Tras dar tiempo al pull.
        if (seedFn) setTimeout(function () { try { seedFn(); } catch (_) {} }, 3200);
      };
      function manejar(buf, source) {
        return Promise.resolve().then(function () { return descifrarBin(API.clave, buf); }).then(function (bytes) {
          var tag = bytes[0], payload = bytes.subarray(1);
          if (tag === 3) {
            if (bytes.length < 22) return false;
            var original = bytes[1], id = "";
            for (var q = 2; q < 18; q++) id += String.fromCharCode(bytes[q]);
            var indice = bytes[18] * 256 + bytes[19], total = bytes[20] * 256 + bytes[21];
            if (!total || indice >= total) return false;
            // Only locally marked broadcast/direct traffic is live-only. Missing
            // metadata is conservative: it may be durable history.
            var groups = source === "live" ? partesEnVivo : partesEntrantes;
            if (source === "live") {
              Object.keys(groups).forEach(function (key) {
                if (Date.now() - groups[key].creado > 120000) delete groups[key];
              });
              var liveBytes = Object.keys(groups).reduce(function (sum, key) { return sum + groups[key].bytes; }, 0);
              // These bytes are a latency optimization. The sender's durable
              // outbox/history is authoritative and will replay a dropped group.
              if ((!groups[id] && Object.keys(groups).length >= MAX_GRUPOS_EN_VIVO) || liveBytes + bytes.length - 22 > MAX_BYTES_EN_VIVO) return true;
            }
            var grupo = groups[id];
            if (!grupo) grupo = groups[id] = { tag: original, total: total, piezas: [], cuenta: 0, bytes: 0, creado: Date.now() };
            if (grupo.total !== total || grupo.tag !== original) return false;
            if (!grupo.piezas[indice]) { grupo.piezas[indice] = bytes.subarray(22); grupo.cuenta++; grupo.bytes += bytes.length - 22; }
            if (grupo.cuenta !== total) return true; // trozo valido; faltan sus hermanos
            delete groups[id];
            var largo = grupo.piezas.reduce(function (a, p) { return a + p.length; }, 0);
            var unido = new Uint8Array(largo), cursor = 0;
            grupo.piezas.forEach(function (p) { unido.set(p, cursor); cursor += p.length; });
            tag = original; payload = unido;
          }
          if (tag === 4) { try { receiveSignal(JSON.parse(new TextDecoder().decode(payload))); } catch (_) {} return true; }
          if (tag === 0) {
            var beforeRevision = API._catalogoRevision;
            Y.applyUpdate(doc, payload, "red");
            try {
              var receipt = Promise.resolve(false);
              if (nombre === "catalogo" && API._catalogoRevision !== beforeRevision && typeof API.confirmarCatalogoVisible === "function")
                receipt = API.confirmarCatalogoVisible();
              // Bind the receipt now, not when a delayed request happens to arrive.
              // A duplicate/no-op update cannot borrow an unrelated successful render.
              appliedUpdate(payload, receipt);
            } catch (_) {} // measurement cannot reject an otherwise valid recovery page
          }
          else if (tag === 1) { // me saludan: les mando lo que les falta + mi SV para pedir lo mío
            try { enviar(0, Y.encodeStateAsUpdate(doc, payload)); } catch (_) {}
            try { enviar(2, Y.encodeStateVector(doc)); } catch (_) {}
          } else if (tag === 2) { // respuesta a mi SV: solo el diff, sin re-pedir (corta el loop)
            try { enviar(0, Y.encodeStateAsUpdate(doc, payload)); } catch (_) {}
          }
          return true;
        }).catch(function () { return false; }); // basura o clave distinta -> no se confirma el cursor
      }
      ws.onmessage = function (ev) {
        if (!API.clave || canal.ws !== ws) return;
        var d = ev.data, source = ev.relaySource;
        // ROBUSTEZ (JFC 2026-09-10, world-class): normalmente con binaryType
        // "arraybuffer" llega un ArrayBuffer, pero algunos navegadores/proxies
        // entregan un Blob aunque se pida ArrayBuffer. Se aceptan AMBOS. Los
        // frames se encadenan: el cursor de una pagina se confirma DESPUES de
        // aplicar todos sus binarios, nunca antes.
        if (d instanceof ArrayBuffer) {
          _colaRecepcion = _colaRecepcion.then(function () { if (canal.ws !== ws) return true; return manejar(d, source); }).then(function (ok) {
            if (source !== "live" && pullEstado.enCurso && !ok) pullEstado.fallos++;
          }).catch(function (e) {
            // One corrupted or undecipherable frame must NOT poison the entire
            // serial receive queue. The failed durable page is retried from the
            // last confirmed cursor; do not ACK or silently skip its bytes.
            if (source !== "live" && pullEstado.enCurso) pullEstado.fallos++;
            try { log("frame Yjs no aplicable en " + nombre, e && e.message); } catch (_) {}
            return false;
          });
        }
        else if (typeof Blob !== "undefined" && d instanceof Blob) {
          _colaRecepcion = _colaRecepcion.then(function () { return d.arrayBuffer(); }).then(function (buf) { if (canal.ws !== ws) return true; return manejar(buf, source); }).then(function (ok) {
            if (source !== "live" && pullEstado.enCurso && !ok) pullEstado.fallos++;
          }).catch(function () { if (source !== "live" && pullEstado.enCurso) pullEstado.fallos++; });
        }
        /* MEDICION DE LATENCIA (JFC 2026-09-22). Los frames de TEXTO hasta hoy
           se ignoraban por completo, asi que engancharse aqui es 100% aditivo:
           nada de lo que ya funciona depende de esta rama. Y sobre todo, esto
           corre FUERA del camino de datos de Yjs — no lee ni escribe el doc, no
           puede corromper ni retrasar un cambio real. Si algo falla, se pierde
           el numero, nunca el dato. */
        else if (typeof d === "string") {
          try {
            var c = JSON.parse(d);
            if (c && c.k === "peer-count") { _relayPeerCount = Math.max(0, Number(c.n) || 0); }
            else if (c && c.k === "persist-result") {
              if (canal.ws === ws) confirmarDurable(c);
            }
            else if (c && c.k === "pull-page") {
              _colaRecepcion = _colaRecepcion.then(function () {
                if (canal.ws !== ws) return;
                if (pullEstado.fallos) {
                  pullEstado.enCurso = false;
                  try { ws.close(1013, "replay incomplete; retry from applied cursor"); } catch (_) {}
                  try { log("pagina de catch-up no confirmada en " + nombre); } catch (_) {}
                  return;
                }
                return guardarPullCursor(c).then(function () {
                  if (canal.ws !== ws || ws.readyState !== 1) return;
                  if (c.more && canal.ws === ws && ws.readyState === 1) return pedirPagina(ws, pullEstado);
                  pullEstado.enCurso = false;
                  if (!c.more && canal.recuperando && !Object.keys(partesEntrantes).length &&
                      !(doc.store && (doc.store.pendingStructs || doc.store.pendingDs))) {
                    canal.recuperando = false;
                    if (nombre === "catalogo" && API._store) API._store.aplicar();
                  }
                  // The last page can have no transport fragments yet Yjs may
                  // still be missing a causal parent or pending deletion.
                  // Retain EVERY encrypted operation, retain the proven cursor,
                  // and replay from that cut with exponential backoff. Never
                  // claim a complete first-join or adopt PINs from partial data.
                  var depsPendientes = !!(doc.store &&
                    (doc.store.pendingStructs || doc.store.pendingDs));
                  if (Object.keys(partesEntrantes).length || depsPendientes) {
                    clearTimeout(_tReplay);
                    _tReplay = setTimeout(function () {
                      if (canal.ws !== ws || ws.readyState !== 1) return;
                      _tReplay = null;
                      if (!pullEstado.enCurso &&
                          (Object.keys(partesEntrantes).length ||
                            (doc.store && (doc.store.pendingStructs || doc.store.pendingDs)))) {
                        /* While this SAME connection is alive, keep the RAM
                           pagination cursor: missing siblings may arrive in
                           newer rows. Otherwise 6000+ historical rows are
                           reprocessed repeatedly and cause 1013 saturation.
                           The durable cursor is NOT advanced for orphans;
                           reconnect always starts from the last proven cut. */
                        _replayDelay = Math.min(300000, _replayDelay * 2);
                        try { log("historia incompleta, relectura segura " + nombre); } catch (_) {}
                        pedirPagina(ws, pullEstado);
                      }
                    }, _replayDelay);
                  } else { clearTimeout(_tReplay); _tReplay = null; _replayDelay = 30000; }
                });
              }).catch(function (e) {
                // Recovery must remain live after a page processing error.
                // Close/replay instead of abandoning all later encrypted pages.
                pullEstado.fallos++;
                try { log("error pagina Yjs " + nombre, e && e.message); } catch (_) {}
                try { ws.close(1013, "pull page failed; replay from confirmed cursor"); } catch (_) {}
                return false;
              });
            }
            else if (c && c.k === "tsr" && window.OCLatencia) window.OCLatencia.anotarPing(c.t0, c.t1, Date.now());
            else if (c && c.k === "lat" && window.OCLatencia) window.OCLatencia.anotarMuestra(c.oTs, c.etq);
          } catch (_) {} // texto que no es nuestro: se ignora igual que antes
        }
      };
      _directReceive = function (buf) {
        _colaRecepcion = _colaRecepcion.then(function () { return manejar(buf, "live"); })
          .catch(function (e) {
            // Live-only fast path is optional; durable relay replay remains
            // authoritative and MUST keep processing subsequent frames.
            try { log("frame directo Yjs no aplicable en " + nombre, e && e.message); } catch (_) {}
            return false;
          });
      };
      ws.onclose = function () {
        if (canal.ws !== ws) return; // cierre tardio de un socket reemplazado
        clearTimeout(_tEstable); _tEstable = null;
        clearTimeout(_bufferPumpTimer); _bufferPumpTimer = null;
        clearTimeout(_durableWatchdog); _durableWatchdog = null;
        _durableInFlight = Object.create(null);
        clearTimeout(_tReplay); _tReplay = null;
        _replayDelay = 30000;
        pullEstado.enCurso = false;
        canal.ws = null;
        _relayPeerCount = 0;
        /* v514 (fallo 1 de Codex): caer el relay NO cierra las conexiones directas que siguen
           vivas entre aparatos. Siguen recibiendo cambios en vivo (enviarDirecto) y, ademas,
           todo queda en canal.pend y en el outbox para el relay cuando vuelva. Al reconectar
           no hay que renegociar con cada aparato: menos mensajes a Cloudflare. */
        reprogramar();
      };
      ws.onerror = function () { try { ws.close(); } catch (_) {} };
    }
    canal.conectar = conectar;
    return canal;
  }

  // Carga perezosa del bundle vendorizado (solo si el flag está encendido, para no
  // pagar 94kb de parse a quien no prueba). Sin CDN: es un archivo del shell.
  function cargarBundle() {
    return new Promise(function (resolve, reject) {
      if (window.Y && window.IndexeddbPersistence) return resolve();
      var s = document.createElement("script");
      s.src = BUNDLE; s.async = true;
      s.onload = function () { (window.Y && window.IndexeddbPersistence) ? resolve() : reject(new Error("bundle sin Y")); };
      s.onerror = function () { reject(new Error("no se pudo cargar " + BUNDLE)); };
      document.head.appendChild(s);
    });
  }

  // Fase 1: TODAS las colecciones del catálogo, no solo productos. Cada una es
  // un Y.Map dentro del mismo Y.Doc, así un solo update binario las cubre todas
  // y convergen juntas. La lista es la misma que viaja hoy en el sync casero
  // (ver _acumularCatalogo en sync-realtime.js): ubicaciones, productos,
  // usuarios, clientes. Agregar aquí una colección nueva es una línea.
  // JFC 2026-09-10 ("sync integral, shared notebook"): se suman las entidades
  // definicionales que faltaban — promotoras (comisionistas) y sucursales. Son
  // Las fichas editables viajan con revision logica. Ventas, gastos y
  // transferencias usan IDs estables y actualizaciones individuales; los hechos
  // de cartera y caja chica van en un mapa inmutable aparte.
  var COLECCIONES = ["productos", "ubicaciones", "usuarios", "clientes", "promotoras", "sucursales", "ventas", "gastos", "transferencias", "dispositivos", "categorias", "ajustes"]; // ajustes (v359): impuesto del cuaderno
  /* VENTAS (dinero) POR EL SYNC NUEVO (JFC 2026-09-16, aprobado). Antes el dinero
     viajaba solo por el sync viejo (sync-realtime, frágil). Ahora las ventas cruzan
     por Yjs, ADD-ONLY por id (cada venta una sola vez -> no se duplica plata). No
     hay doble descuento de stock porque el stock es LWW ABSOLUTO aparte (v289), no
     se re-deriva de estas ventas. Para NO reventar el frame de 256KB con historiales
     grandes, las ventas NO van en el batch de sembrar(); se siembran como op
     INDIVIDUAL (una mini-actualización por venta, igual que las fotos). */
  /* DISPOSITIVOS (apodos "This device") POR EL SYNC NUEVO (v298, JFC 2026-09-16).
     Antes los apodos viajaban por micelio sobre el sync VIEJO (frágil) y no cruzaban
     bien. Ahora cada aparato publica su entrada {id,apodo,rol} en la colección
     "dispositivos" (add-only por id; el aparato es dueño de SU entrada). Al recibir,
     aplicarCatalogo alimenta la lista de micelio (OCMicelio.recibir) para que el
     dueño vea sus aparatos en Advanced. Va en el batch: es diminuto. */
  var COLECCIONES_BATCH = ["productos", "ubicaciones", "usuarios", "clientes", "promotoras", "sucursales", "dispositivos", "categorias", "ajustes"]; // categorias (v344): propias vacias y ocultas, con rev y lapida
  var API = {
    estado: "apagado", doc: null, mapas: {}, clave: null, ws: null, bc: null, roomId: null, colecciones: COLECCIONES,
    // API genérica por colección (probar convergencia a mano o desde código).
    set: function (col, id, obj) { var m = this.mapas[col]; if (!m) return false; m.set(String(id), obj); return true; },
    get: function (col) { var o = {}, m = this.mapas[col]; if (m) m.forEach(function (v, k) { o[k] = v; }); return o; },
    del: function (col, id) { var m = this.mapas[col]; if (!m) return false; m.delete(String(id)); return true; },
    // Atajos retro-compatibles con la Fase 0.
    setProducto: function (id, obj) { return this.set("productos", id, obj); },
    getProductos: function () { return this.get("productos"); },
    _diag: function () {
      var n = {}, self = this; this.colecciones.forEach(function (c) { n[c] = self.mapas[c] ? self.mapas[c].size : 0; });
      var rs = function (cn) { return cn && cn.ws ? cn.ws.readyState : null; };
      return { estado: this.estado, roomId: this.roomId, n: n,
        ws: { catalogo: rs(this.canal), fotos: rs(this.fotosCanal), ops: rs(this.opsCanal) },
        meta: { nombre: this.meta ? this.meta.get("nombreNegocio") : null, esDueno: this.meta ? this.meta.get("nombreEsDueno") : null },
        fotos: this.fotosMap ? this.fotosMap.size : 0, ops: this.opsMap ? this.opsMap.size : 0 };
    }
  };
  window.OCYjs = API;

  /* PRIME DIRECTIVE 1AAA / G05 — HISTORIAL LOCAL DE PUNTEROS DE FOTO.
     y-indexeddb persiste updates del catalogo en objectStore "updates". Este
     lector abre ESA MISMA base ya abierta por IndexeddbPersistence, en modo
     readonly, y reproduce sus updates en un Y.Doc AISLADO. Despues de cada
     update anota todo fotoHash no vacio observado para cada shelf id.
     - NO aplica nada a API.doc.
     - NO escribe/borrar IndexedDB.
     - NO inventa asociaciones.
     - La compactacion de y-indexeddb puede haber eliminado historia antigua;
       en ese caso devuelve solo lo que realmente siga demostrable. */
  API.historialFotosPorPercha = async function () {
    var out = {};
    try {
      if (!API.idb || !window.Y) return out;
      try {
        if (API.idb.whenSynced && typeof API.idb.whenSynced.then === "function") {
          await API.idb.whenSynced.catch(function () {});
        }
      } catch (_) {}
      var db = API.idb.db || null;
      if (!db && API.idb._db && typeof API.idb._db.then === "function") {
        try { db = await API.idb._db; } catch (_) {}
      }
      if (!db || !db.objectStoreNames || !db.objectStoreNames.contains("updates")) return out;

      var updates = await new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction("updates", "readonly");
          var store = tx.objectStore("updates");
          var req = store.openCursor();
          var arr = [];
          req.onsuccess = function (ev) {
            var cur = ev.target.result;
            if (!cur) { resolve(arr); return; }
            arr.push(cur.value);
            cur.continue();
          };
          req.onerror = function () { reject(req.error); };
        } catch (e) { reject(e); }
      });

      var d = new window.Y.Doc();
      var mapa = d.getMap("ubicaciones");
      var ultimo = {};
      function capturar() {
        try {
          mapa.forEach(function (row, id) {
            var h = row && row.fotoHash ? String(row.fotoHash) : "";
            if (!h || ultimo[id] === h) return;
            ultimo[id] = h;
            if (!out[id]) out[id] = [];
            if (out[id].indexOf(h) < 0) out[id].push(h);
          });
        } catch (_) {}
      }
      for (var i = 0; i < updates.length; i++) {
        try {
          var u = updates[i];
          var bytes = u instanceof Uint8Array ? u : new Uint8Array(u);
          window.Y.applyUpdate(d, bytes, "forense-readonly");
          capturar();
        } catch (_) {}
      }
      /* Si y-indexeddb compacto el historial, el estado actual puede ser la unica
         evidencia restante. Se añade solo si el pointer existe de verdad. */
      try {
        var vivo = API.mapas && API.mapas.ubicaciones;
        if (vivo) vivo.forEach(function (row, id) {
          var h = row && row.fotoHash ? String(row.fotoHash) : "";
          if (!h) return;
          if (!out[id]) out[id] = [];
          if (out[id].indexOf(h) < 0) out[id].push(h);
        });
      } catch (_) {}
      try { d.destroy(); } catch (_) {}
    } catch (e) {
      try { console.warn("[OCYjs] historialFotosPorPercha:", e && e.message); } catch (_) {}
    }
    return out;
  };

  function log(/*...*/) { try { console.log.apply(console, ["[OCYjs]"].concat([].slice.call(arguments))); } catch (_) {} }

  var _arranquePromise = null;
  var _arranqueSolicitado = false;
  function arrancar() {
    if (API.estado === "activo") return Promise.resolve(true);
    if (_arranquePromise) { _arranqueSolicitado = true; return _arranquePromise; }
    _arranquePromise = arrancarInicial().catch(function (e) {
      log("arranque:", e && e.message);
    }).finally(function () {
      _arranquePromise = null;
      if (_arranqueSolicitado) { _arranqueSolicitado = false; arrancar(); }
    });
    return _arranquePromise;
  }

  async function arrancarInicial() {
    /* UNA LICENCIA = UNA SALA (v295, JFC 2026-09-16). "salas"/f123_sync_room es
       VESTIGIAL y ya NO decide nada: la sala es SIEMPRE la LICENCIA
       (f123_owned.licenseCode). Antes f123_sync_room podía quedar desalineado de la
       licencia y mandar el aparato a otra sala -> no convergía. Ya no se lee como
       fuente de sala. Si el aparato no tiene licencia (demo/sin activar), no hay
       sync. La CLAVE y la sala salen de la MISMA licencia, así todos los aparatos
       de una licencia caen en la misma sala, siempre. */
    var _licProp = "";
    try { var _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; if (_ow.licenseCode) _licProp = String(_ow.licenseCode); } catch (_) {}
    if (!_licProp) { log("sin licencia — sin sync (una licencia = una sala; f123_sync_room ya no decide)"); return; }
    var codigo = normalizarCodigo(_licProp);
    try { await cargarBundle(); } catch (e) { log("bundle:", e && e.message); return; }

    var Y = window.Y;
    API.doc = new Y.Doc();
    COLECCIONES.forEach(function (c) { API.mapas[c] = API.doc.getMap(c); });
    API.hechosMap = API.doc.getMap("hechos_financieros");
    // FASE 2 (JFC 2026-09-09): mapa aparte para el nombre del negocio y los PINs
    // de rol, que viajan CON el catálogo pero no son una colección de ítems. Así
    // Plan C converge un negocio completo por sí solo, sin depender del sync casero.
    API.meta = API.doc.getMap("_meta");
    API.clave = await derivarClave(codigo);
    /* LIMPIEZA (2026-09-16): SOLO la licencia canonica de JFC estrena sala NUEVA
       para abandonar la sala de catalogo contaminada con semilla (la vieja queda
       huerfana e hibernada, sin costo). Gated EXACTO: ninguna otra licencia
       (idiomARTE incluida) cambia de sala. La CLAVE sigue derivada de la licencia,
       asi los aparatos de JFC se entienden en la sala nueva. Ver la purga local
       gated en mock-backend.js. */
    var _salaId = ((function(str){var h1=0xdeadbeef,h2=0x41c6ce57;for(var i=0,ch;i<str.length;i++){ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return 4294967296*(2097151&h2)+(h1>>>0);})(String(codigo)) === 6583453063440131 /* huella de la licencia principal; repo PÚBLICO: nunca el texto */) ? (codigo + "::limpio-2026-09-16") : codigo;
    API.roomId = await idDeSala(_salaId);

    // Persistencia local: sobrevive recargas y sirve offline (piso del piso).
    // Guardamos la referencia: al terminar de cargar de IndexedDB ("synced")
    // hacemos el primer volcado Yjs->store, para que un aparato que arranca
    // offline ya vea lo que otro dejó, sin esperar al relay (Fase 2).
    try { API.idb = new window.IndexeddbPersistence("f123-yjs-" + API.roomId, API.doc); } catch (e) { log("idb:", e && e.message); }

    // Convergencia entre pestañas del MISMO origen: instantánea, sin red.
    try {
      API.bc = new BroadcastChannel("f123-yjs-" + API.roomId);
      API.bc.onmessage = function (ev) { try { Y.applyUpdate(API.doc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}

    // Cada cambio local -> update binario -> (a) pestañas por BroadcastChannel,
    // (b) otros dispositivos por el relay cifrado. origin !== "bc"/"red" evita eco.
    API.canal = crearCanal(Y, API.doc, "-y", "catalogo", true, null, API.idb); // ckpt: catálogo cabe
    API.doc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") return;
      try { if (API.bc) API.bc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      API.canal.enviarUpdate(update);
    });

    // B3 (JFC 2026-09-10): documento SEPARADO para los BYTES de las fotos. NO van
    // en el doc del catálogo (lo inflarían): aquí cada foto es hash -> dataURL,
    // converge por su propia sala de relay ("-fotos"), persiste en su propio
    // IndexedDB y entre pestañas por su BroadcastChannel. Content-addressed: una
    // foto (un hash) se escribe una sola vez. Así las fotos cruzan device-to-device
    // sin nube; la nube durable del dueño (Google Drive) es una fase posterior.
    API.fotosDoc = new Y.Doc();
    API.fotosMap = API.fotosDoc.getMap("blobs");
    try { API.fotosIdb = new window.IndexeddbPersistence("f123-yjs-fotos-" + API.roomId, API.fotosDoc); } catch (_) {}
    try {
      API.fotosBc = new BroadcastChannel("f123-yjs-fotos-" + API.roomId);
      API.fotosBc.onmessage = function (ev) { try { Y.applyUpdate(API.fotosDoc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}
    API.fotosCanal = crearCanal(Y, API.fotosDoc, "-fotos", "fotos", false, sembrarFotosAlRelay, API.fotosIdb); // sin ckpt (fotos exceden 256KB); siembra c/foto como op individual
    API.fotosDoc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") { pedirVolcarFotos(); return; } // llegó un blob: guardarlo local
      try { if (API.fotosBc) API.fotosBc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      API.fotosCanal.enviarUpdate(update);
    });

    // SYNC DE VENTAS/OPS (JFC 2026-09-10, "que sincronice TODO"). Doc SEPARADO de
    // eventos append-only: opId -> op. Cada venta/movimiento viaja como un hecho
    // inmutable y se aplica UNA sola vez por OCSync.aplicarOpRemota (idempotente
    // por opId). Sala de relay "-ops" aparte. Los ops PROPIOS (mismo deviceId) no
    // se re-aplican: ya se aplicaron al hacer la acción. Esto es event-sourcing
    // sobre CRDT: transporte confiable (Yjs) + aplicación segura (handler probado).
    // Va detrás del MISMO flag y en paralelo al sync viejo (respaldo), así que un
    // op duplicado por los dos transportes se aplica una vez y no dobla la plata.
    API.opsDoc = new Y.Doc();
    API.opsMap = API.opsDoc.getMap("eventos");
    try { API.opsIdb = new window.IndexeddbPersistence("f123-yjs-ops-" + API.roomId, API.opsDoc); } catch (_) {}
    try {
      API.opsBc = new BroadcastChannel("f123-yjs-ops-" + API.roomId);
      API.opsBc.onmessage = function (ev) { try { Y.applyUpdate(API.opsDoc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}
    API.opsCanal = crearCanal(Y, API.opsDoc, "-ops", "ops", true, null, API.opsIdb); // ckpt: ops es pequeño
    API.opsDoc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") { pedirProcesarEventos(); return; }
      try { if (API.opsBc) API.opsBc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      API.opsCanal.enviarUpdate(update);
    });
    // Publicar al doc de ops cada venta/movimiento local (el op EXACTO de sync-realtime).
    window.addEventListener("oc-op-local", function (ev) { try { publicarOpLocal(ev.detail); } catch (_) {} });

    API.canal.conectar();      // catálogo + _meta (nombre, pinsRol) — sala "-y"
    API.fotosCanal.conectar(); // bytes de las fotos — sala "-fotos"
    API.opsCanal.conectar();   // ventas/ops — sala "-ops"
    conectarStore(Y);   // FASE 2: leer/escribir el store REAL de la app (add-only)
    conectarHechos();    // cartera y caja chica: hechos inmutables por ID
    // Al cargar de IndexedDB los blobs ya guardados, volcarlos al store de fotos.
    if (API.fotosIdb && API.fotosIdb.once) API.fotosIdb.once("synced", pedirVolcarFotos);
    // Al cargar los eventos ya guardados, procesarlos (aplica los que falten).
    if (API.opsIdb && API.opsIdb.once) API.opsIdb.once("synced", pedirProcesarEventos);
    API.estado = "activo";
    log("Plan C activo (Fase 2 + fotos + ops). Sala:", API.roomId);
  }

  function conectarHechos() {
    var intentos = 0, importando = false, pendiente = false;
    var conocidos = Object.create(null);
    function hechos() { return window.AMG && window.AMG.Hechos; }
    function publicar(h) {
      if (!h || !h.id || !API.hechosMap) return;
      var anterior = API.hechosMap.get(h.id);
      if (anterior && JSON.stringify(anterior) !== JSON.stringify(h)) {
        log("colision de hecho financiero:", h.id); return;
      }
      if (!anterior) API.hechosMap.set(h.id, h);
    }
    function importar() {
      var ledger = hechos();
      if (!ledger) return;
      if (importando) { pendiente = true; return; }
      importando = true;
      var lista = [];
      API.hechosMap.forEach(function (h) { if (h && h.id && !conocidos[h.id]) lista.push(h); });
      Promise.allSettled(lista.map(function (h) { return ledger.importarRemoto(h); }))
        .then(function (resultados) {
          resultados.forEach(function (r, i) {
            if (r.status === "rejected") log("hecho remoto rechazado:", r.reason && r.reason.message);
            else conocidos[lista[i].id] = true;
          });
        }).finally(function () {
          importando = false;
          if (pendiente) { pendiente = false; importar(); }
        });
    }
    function arrancarPuente() {
      var ledger = hechos();
      if (!ledger) { if (++intentos < 20) setTimeout(arrancarPuente, 100); return; }
      API.hechosListos = function () {
        var ready = !importando && !pendiente;
        API.hechosMap.forEach(function (h) { if (h && h.id && !conocidos[h.id]) ready = false; });
        return ready;
      };
      window.addEventListener("oc-hecho-local", function (ev) { if (ev.detail && ev.detail.id) conocidos[ev.detail.id] = true; publicar(ev.detail); });
      ledger.todos().then(function (lista) { lista.forEach(function (h) { conocidos[h.id] = true; publicar(h); }); importar(); })
        .catch(function (e) { log("hechos locales:", e && e.message); });
      API.doc.on("update", function (_update, origin) {
        if (origin === "red" || origin === "bc" || origin === "idb") importar();
      });
      if (API.idb && API.idb.once) API.idb.once("synced", importar);
    }
    setTimeout(arrancarPuente, 0);
  }

  // ===================================================================
  // VENTAS/OPS device-to-device (event-sourcing sobre CRDT).
  // ===================================================================
  function miDeviceId() {
    try { return String((window.OCSyncControl && window.OCSyncControl.deviceIdActual && window.OCSyncControl.deviceIdActual()) || ""); } catch (_) { return ""; }
  }
  function publicarOpLocal(op) {
    if (!op || !op.opId || !API.opsMap) return;
    try { if (!API.opsMap.get(op.opId)) API.opsMap.set(op.opId, op); } catch (_) {}
  }
  var _tOps = null, _opsProcesadas = null;
  function pedirProcesarEventos() { clearTimeout(_tOps); _tOps = setTimeout(procesarEventos, 200); }
  function procesarEventos() {
    if (!window.OCSync || typeof window.OCSync.aplicarOpRemota !== "function" || !API.opsMap) return;
    if (!_opsProcesadas) _opsProcesadas = {}; // cache liviano por sesión (aplicarOpRemota ya es idempotente igual)
    var mio = miDeviceId(), aplico = false;
    API.opsMap.forEach(function (op, opId) {
      if (!op || _opsProcesadas[opId]) return;
      // ECO: un op PROPIO ya se aplicó al hacer la acción; re-aplicarlo doblaría
      // la plata (el handler NO lo tiene en su set de "vistos", porque nunca pasó
      // por aplicarOpRemota). Se salta explícitamente por deviceId, y se marca
      // procesado (no hay nada que reintentar).
      if (mio && String(op.deviceId) === mio) { _opsProcesadas[opId] = 1; return; }
      try {
        var r = window.OCSync.aplicarOpRemota(op);
        // #4 (fix 2026-09-10): marcar procesado SOLO si el handler respondió ok
        // (aplicado o repetido). Si lanzó, se deja sin marcar para reintentar en
        // el próximo pase. aplicarOpRemota ya es idempotente por opId, así que
        // reintentar es seguro.
        if (r && r.ok) {
          _opsProcesadas[opId] = 1;
          if (!r.repetida) {
            aplico = true;
            try { window.dispatchEvent(new CustomEvent("oc-sync-op-remota", { detail: op })); } catch (_) {}
          }
        }
      } catch (_) { /* sin marcar: se reintenta */ }
    });
    void aplico;
  }

  // ===================================================================
  // B3 — BYTES DE LAS FOTOS device-to-device (doc y relay separados).
  // ===================================================================
  var _tVolcar = null;
  function pedirVolcarFotos() { clearTimeout(_tVolcar); _tVolcar = setTimeout(volcarFotosAlStore, 250); }

  // Yjs(fotos) -> OCFotos (IndexedDB local). Cada hash que llegó y no esté local
  // se guarda; luego se avisa a la UI para que la percha muestre su foto.
  function volcarFotosAlStore() {
    if (!window.OCFotos || !API.fotosMap) return;
    var pend = [], hubo = false;
    API.fotosMap.forEach(function (dataUrl, hash) { pend.push([hash, dataUrl]); });
    var i = 0;
    (function next() {
      if (i >= pend.length) {
        if (hubo) {
          // v290: hidratar fotos de PRODUCTO (poner p.foto desde el hash recibido)
          // para que la UI, que pinta p.foto, muestre la foto que cruzo.
          try { if (window.OCSync && window.OCSync.hidratarFotosProductos) window.OCSync.hidratarFotosProductos(); } catch (_) {}
          try { window.dispatchEvent(new CustomEvent("oc-fotos-actualizadas")); } catch (_) {}
        }
        return;
      }
      var hash = pend[i][0], dataUrl = pend[i][1]; i++;
      Promise.resolve(window.OCFotos.tieneHash(hash)).then(function (ya) {
        if (ya) return next();
        return Promise.resolve(window.OCFotos.guardarPorHash(hash, dataUrl)).then(function () { hubo = true; next(); });
      }).catch(next);
    })();
  }

  /* SEMBRAR FOTOS AL RELAY (v287, JFC 2026-09-16). El bug: publicarFotosLocales
     salta las fotos que YA están en el fotosMap (línea "ya publicado"); pero una
     foto que ya vivía en el Yjs-IDB de fotos nunca genera un update al reconectar
     -> nunca se persiste como {k:op} -> el relay queda con 0 fotos y el otro
     aparato no la recibe (verificado: sala -fotos vacía). Y el canal fotos no tiene
     ckpt (su estado completo supera 256KB). Aquí, al conectar, se RE-manda cada
     foto EN USO como una op INDIVIDUAL (cada dataURL <180KB por la compresión de
     vista-perchas.js, así que cabe en el frame). Se arma un update mínimo (un
     Y.Doc con solo esa foto) y se pasa por enviarUpdate del canal fotos: persiste
     como op + va en vivo. Guard de sesión para no re-mandar la misma foto en cada
     reconexión. */
  var _fotosSembradas = {};
  function sembrarFotosAlRelay() {
    if (!window.OCFotos || !window.OCSync || !API.fotosCanal || !window.Y || !API.fotosDoc) return;
    // Primero: dar hash a las fotos de PRODUCTO que solo estaban inline (v290 fix:
    // la foto de producto no cruzaba porque no tenia fotoHash ni iba por el canal).
    Promise.resolve(window.OCSync.hashearFotosProductos ? window.OCSync.hashearFotosProductos() : 0).then(function () {
      var cat; try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
      var hUbic = (cat && cat.ubicaciones || []).map(function (u) { return u.fotoHash; }).filter(Boolean);
      var hProd = (cat && cat.productos || []).map(function (p) { return p.fotoHash; }).filter(Boolean);
      var hGastos = (cat && cat.gastos || []).map(function (g) { return g.facturaFotoHash; }).filter(Boolean);
      /* PRIME DIRECTIVE 1AAA / G04: no sembrar solo "lo actualmente usado".
         Un hotfix anterior pudo perder el pointer y dejar los bytes huerfanos.
         Esos blobs son EVIDENCIA del cliente y deben poder volver desde otro
         dispositivo. leerTodosPorHash() no inventa asociaciones: solo enumera
         hash->bytes. Se reenvian individualmente, igual que las fotos en uso. */
      Promise.resolve(window.OCFotos.leerTodosPorHash ? window.OCFotos.leerTodosPorHash() : {}).then(function (todos) {
        var hashes = {};
        hUbic.concat(hProd, hGastos).forEach(function (h) { if (h) hashes[String(h)] = 1; });
        Object.keys(todos || {}).forEach(function (h) { hashes[String(h)] = 1; });
        Object.keys(hashes).forEach(function (hash) {
          if (_fotosSembradas[hash]) return;
          var local = todos && todos[hash];
          Promise.resolve(local || window.OCFotos.leerPorHash(hash)).then(async function (dataUrl) {
            if (!dataUrl) return;
            try {
                // An immutable photo must not gain a new Yjs identity on every
                // page load. Include its bytes so a mismatched hash cannot hide
                // different evidence. A 52-bit digest avoids ordinary random
                // 32-bit client IDs; the encrypted wire format stays unchanged.
                var seedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
                  "friendly-photo-seed-v1:" + JSON.stringify([hash, dataUrl])));
                var seedHex = Array.from(new Uint8Array(seedDigest)).map(function (b) {
                  return b.toString(16).padStart(2, "0");
                }).join("");
              var d = new window.Y.Doc();
                d.clientID = parseInt(seedHex.slice(0, 13), 16) + 4294967296;
              d.getMap("blobs").set(hash, dataUrl);
              var u = window.Y.encodeStateAsUpdate(d);
              _fotosSembradas[hash] = 1;
              try { window.Y.applyUpdate(API.fotosDoc, u, "seed"); } catch (_) {}
                d.destroy();
            } catch (_) {}
          }).catch(function () {});
        });
      }).catch(function () {});
    }).catch(function () {});
  }

  /* SEMBRAR VENTAS (dinero) AL RELAY (v292, JFC 2026-09-16, aprobado). Cada venta
     se manda como op INDIVIDUAL al canal de CATALOGO (mini Y.Doc con esa venta en
     el map "ventas"), no en el batch de sembrar, para no reventar el frame de
     256KB con historiales grandes. Add-only por id: el receptor la suma una sola
     vez (aplicarCatalogo). No duplica plata ni stock (el stock es LWW aparte).
     Guard de sesion para no re-mandar la misma venta. */
  function sembrarVentasAlRelay() {
    if (!window.OCSync || !API.canal || !window.Y || !API.doc) return;
    var cat; try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
    var ventas = (cat && cat.ventas) || [];
    ventas.forEach(function (v) {
      if (!v || v.id == null) return;
      var id = String(v.id);
      var previo = API.mapas.ventas.get(id);
      if (previo) {
        var a = v.rev || {}, b = previo.rev || {};
        var ac = Number(a.c) || 0, bc = Number(b.c) || 0;
        if (ac < bc || (ac === bc && String(a.d || "") <= String(b.d || ""))) return;
      }
      try {
        // Y.Map.set emite un delta pequeño por venta y permite publicar una
        // corrección o anulación posterior sin re-enviar el historial entero.
        API.doc.transact(function () { API.mapas.ventas.set(id, JSON.parse(JSON.stringify(v))); }, "seed");
      } catch (_) {}
    });
  }

  function sembrarFinanzas(cat) {
    ["gastos", "transferencias"].forEach(function (col) {
      (cat[col] || []).forEach(function (r) {
        if (!r || r.id == null) return;
        var id = String(r.id), previo = API.mapas[col].get(id);
        if (previo) {
          var a = r.rev || {}, b = previo.rev || {};
          var ac = Number(a.c) || 0, bc = Number(b.c) || 0;
          if (ac < bc || (ac === bc && String(a.d || "") <= String(b.d || ""))) return;
        }
        try { API.doc.transact(function () { API.mapas[col].set(id, JSON.parse(JSON.stringify(r))); }, "seed"); } catch (_) {}
      });
    });
  }

  // OCFotos local -> Yjs(fotos). Publica los blobs de las fotos EN USO (las que
  // alguna percha referencia por fotoHash) que aún no estén en el doc de fotos.
  function publicarFotosLocales() {
    if (!window.OCFotos || !API.fotosMap || !window.OCSync) return;
    var cat; try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
    var hUbic = (cat && cat.ubicaciones || []).map(function (u) { return u.fotoHash; }).filter(Boolean);
    var hProd = (cat && cat.productos || []).map(function (p) { return p.fotoHash; }).filter(Boolean); // v290: fotos de producto tambien
    var hGastos = (cat && cat.gastos || []).map(function (g) { return g.facturaFotoHash; }).filter(Boolean);
    hUbic.concat(hProd, hGastos).forEach(function (hash) {
      if (API.fotosMap.get(hash)) return; // ya publicado
      Promise.resolve(window.OCFotos.leerPorHash(hash)).then(function (dataUrl) {
        if (dataUrl && !API.fotosMap.get(hash)) { try { API.fotosMap.set(hash, dataUrl); } catch (_) {} }
      }).catch(function () {});
    });
  }


  // ===================================================================
  // FASE 2 (JFC 2026-09-09) — PUENTE AL STORE REAL, sin perder nada.
  //
  // POR QUÉ ASÍ: el sync casero (sync-realtime.js) ya tenía el contrato bueno
  // y probado en producción. NO se reinventa el merge:
  //   store -> Yjs : window.OCSync.catalogoPropio() da la foto de las 4
  //                  colecciones; se vuelca a los Y.Map por id.
  //   Yjs -> store : window.OCSync.aplicarCatalogo(remoto, null), que es el
  //                  merge ADD-ONLY ya probado (nunca borra, nunca pisa un ítem
  //                  existente salvo edición del dueño; el equipo usa LWW con
  //                  reloj lógico + tombstones). Es exactamente lo que pidió JFC:
  //                  "los datos a salvo, los merges aditivos, nunca se pierda nada".
  //
  // rol = null a propósito: Yjs converge sin saber el rol del emisor, así que la
  // regla "el dueño pisa nombre/precio" no aplica por este canal; add-only sí, que
  // es lo que garantiza no perder datos. Si el sync casero sigue encendido, esa
  // regla la resuelve él. Ver aplicarCatalogo() en mock-backend.js.
  //
  // ANTI-BUCLE: al escribir en el store se disparan oc-catalogo-cambiado /
  // oc-equipo-cambiado, que a su vez re-vuelcan a Yjs. Con _aplicando=true durante
  // el volcado y comparando por JSON antes de cada set(), el re-vuelco no genera
  // updates nuevos (no hay diferencias) y el bucle muere solo.
  // ===================================================================
  function conectarStore(Y) {
    if (!window.OCSync || typeof window.OCSync.catalogoPropio !== "function" ||
        typeof window.OCSync.aplicarCatalogo !== "function") {
      log("store no disponible (OCSync) — Plan C queda solo como capa CRDT");
      return;
    }
    var _aplicando = false;   // guard: no re-volcar mientras aplicamos al store
    var _tSeed = null, _tAplica = null;

    // store -> Yjs. Add/update por id; nunca borra del Y.Map (add-only también
    // aguas arriba). Las bajas de equipo viajan como tombstone (borrado:true),
    // que catalogoPropio() sí incluye, así que la baja converge igual.
    function sembrar() {
      if (_aplicando) return;
      var cat;
      try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
      if (!cat) return;
      /* A newly activated, empty phone is NOT evidence that the old shop
         was deleted. Never publish its fallback name or factory-derived
         metadata to Yjs while historical pages still need replay. A real
         existing shop retains its local records and append-only outbox. */
      if (API.canal && API.canal.recuperando) {
        // Do not publish a brand-new phone's factory-only catalog. But an
        // otherwise empty shop can legitimately contain a new expense,
        // personnel record or device nickname. Those facts must not be
        // suppressed by the first-join guard (regressions in native CI).
        var _cuenta = [
          "productos", "ubicaciones", "ventas", "clientes", "gastos",
          "transferencias", "promotoras", "sucursales", "ajustes",
          "categorias", "dispositivos"
        ].reduce(function (n, col) {
          return n + (Array.isArray(cat[col]) ? cat[col].length : 0);
        }, 0);
        if (_cuenta === 0) return;
      }
      var miRol = ""; try { if (window.OCAuth && OCAuth.rolActual) miRol = OCAuth.rolActual() || ""; } catch (_) {}
      try {
        API.doc.transact(function () {
          COLECCIONES_BATCH.forEach(function (col) {
            var filas = cat[col] || [];
            filas.forEach(function (r) {
              if (!r || r.id == null) return;
              var k = String(r.id);
              var prev = API.mapas[col].get(k);
              // A locked tab may know the device profile but no longer have an authenticated role.
              // Preserve that role while still allowing nickname edits and explicit role changes.
              if (col === "dispositivos" && prev && !r.rol && prev.rol) r = Object.assign({}, r, { rol: prev.rol });
              if (prev && col === "ubicaciones") {
                var ar = r.gastoMensualRev || {}, br = prev.gastoMensualRev || {};
                var newerMonthly = (Number(ar.c) || 0) > (Number(br.c) || 0) ||
                  ((Number(ar.c) || 0) === (Number(br.c) || 0) && String(ar.d || "") > String(br.d || ""));
                if (!newerMonthly) r = Object.assign({}, r, { gastoMensual: prev.gastoMensual, gastoMensualRev: prev.gastoMensualRev });

                /* v448-golden: lifecycle CRDT independiente del rev general.
                   Un aparato rezagado puede tener nombre/meta/foto con rev general
                   mayor y aun asi una copia VIEJA de activa/borrado. Preservar en
                   el Y.Map la revision de lifecycle mas nueva evita que ese reseed
                   borre la lapida/archivo ANTES de llegar a aplicarCatalogo().
                   Compatibilidad: bajas legacy sin estadoRev usan su rev general
                   como evidencia; una copia legacy activa no puede resucitar. */
                var sr = r.estadoRev || ((r.borrado || r.activa === false) ? (r.rev || null) : null);
                var sp = prev.estadoRev || ((prev.borrado || prev.activa === false) ? (prev.rev || null) : null);
                if (sp) {
                  var src = Number(sr && sr.c) || 0, spc = Number(sp.c) || 0;
                  var stateNewer = !!sr && (src > spc || (src === spc && String(sr.d || "") > String(sp.d || "")));
                  if (!stateNewer) {
                    r = Object.assign({}, r, {
                      activa: !prev.borrado && prev.activa !== false,
                      borrado: !!prev.borrado,
                      estadoRev: sp
                    });
                  } else {
                    r = Object.assign({}, r, { estadoRev: sr });
                  }
                } else if (sr) {
                  r = Object.assign({}, r, { estadoRev: sr });
                }
              }
              if (prev && col === "productos") {
                var basePrev = prev.stockBase == null ? null : Number(prev.stockBase);
                var baseMia = r.stockBase == null ? null : Number(r.stockBase);
                /* v515: con bases distintas ANTES se hacia `return`: este aparato dejaba de publicar
                   el producto entero (stock, nombre, precio) para siempre. Ahora gana el cambio de
                   stock mas reciente; el resto de la ficha se publica igual. Regla identica a
                   _ganaEpocaStockRemota en mock-backend.js. Prueba: test/stock-base-conflicto-v515. */
                var conflictoBase = basePrev !== null && baseMia !== null && basePrev !== baseMia;
                if (conflictoBase) {
                  var claveEp = function (x) {
                    var q = x && x.stockPN && typeof x.stockPN === "object" ? x.stockPN : {};
                    return JSON.stringify([Number(x && x.stockBase), Object.keys(q).sort().map(function (k) { return [k, Number(q[k].add) || 0, Number(q[k].sub) || 0]; })]);
                  };
                  var tMio = Number(r.stockTs) || 0, tDoc = Number(prev.stockTs) || 0;
                  // v517 (informe Codex #2): mismo filtro que mock-backend: un sello >5 min en el futuro del reloj comun no gana.
                  var ahoraC = (window.OCLatencia && window.OCLatencia.ahoraRelay) ? Number(window.OCLatencia.ahoraRelay()) : NaN;
                  var futuroMio = Number.isFinite(ahoraC) && tMio > ahoraC + 300000, futuroDoc = Number.isFinite(ahoraC) && tDoc > ahoraC + 300000;
                  var ganoYo = futuroMio !== futuroDoc ? !futuroMio : (tMio !== tDoc ? tMio > tDoc : claveEp(r) > claveEp(prev));
                  if (!ganoYo) r = Object.assign({}, r, { stockBase: prev.stockBase, stockPN: prev.stockPN, stockActual: prev.stockActual, stockTs: prev.stockTs, stockDeficit: prev.stockDeficit });
                }
                var base = baseMia !== null ? baseMia : basePrev;
                if (!conflictoBase && base !== null && Number.isFinite(base)) {
                  var pn = Object.assign({}, prev.stockPN || {});
                  Object.keys(r.stockPN || {}).forEach(function (id) {
                    var antes = pn[id] || {}, nuevo = r.stockPN[id] || {};
                    pn[id] = { add: Math.max(Number(antes.add) || 0, Number(nuevo.add) || 0),
                               sub: Math.max(Number(antes.sub) || 0, Number(nuevo.sub) || 0) };
                  });
                  r = Object.assign({}, r, { stockBase: base, stockPN: pn });
                  r.stockActual = Math.max(0, base + Object.keys(pn).reduce(function (n, id) {
                    return n + (Number(pn[id].add) || 0) - (Number(pn[id].sub) || 0);
                  }, 0));
                }
              }
              // Una réplica rezagada no debe volver a publicar una ficha anterior
              // encima de una edición o baja que ya llegó al documento común.
              if (prev && (col === "clientes" || col === "promotoras" || col === "sucursales" || col === "ubicaciones" || col === "productos" || col === "gastos" || col === "transferencias" || col === "categorias" || col === "ajustes") &&
                  (r.rev || prev.rev)) {
                var a = r.rev || {}, b = prev.rev || {};
                var ac = Number(a.c) || 0, bc = Number(b.c) || 0;
                if (ac < bc || (ac === bc && String(a.d || "") <= String(b.d || ""))) {
                  if (col === "productos") {
                    /* P0 v558: metadata rev and stock revision are INDEPENDENT.
                       Before: stale local metadata preserved prev.name but ALWAYS
                       overwrote prev.stockActual, even if local was old ZERO;
                       then it forged stockTs=max(old,new), making it appear current.
                       Choose stock only by its own ledger/clock evidence. */
                    var _rt = Number(r.stockTs) || 0, _pt = Number(prev.stockTs) || 0;
                    var _rb = r.stockBase != null && Number.isFinite(Number(r.stockBase)) ? Number(r.stockBase) : null;
                    var _pb = prev.stockBase != null && Number.isFinite(Number(prev.stockBase)) ? Number(prev.stockBase) : null;
                    var _rp = r.stockPN && typeof r.stockPN === "object" ? r.stockPN : null;
                    var _pp = prev.stockPN && typeof prev.stockPN === "object" ? prev.stockPN : null;
                    var _nowRaw = (window.OCLatencia && window.OCLatencia.ahoraRelay) ?
                      window.OCLatencia.ahoraRelay() : null;
                    // Number(null) === 0: a fresh phone without a relay clock
                    // must not treat every genuine epoch-millisecond sale as future.
                    var _now = typeof _nowRaw === "number" && Number.isFinite(_nowRaw) &&
                      _nowRaw > 0 ? _nowRaw : null;
                    var _notFuture = _now === null || _rt <= _now + 300000;
                    var _sameLedger = _rb !== null && _pb !== null && _rb === _pb && !!_rp && !!_pp;
                    var _epochNewer = _rb !== null && !!_rp && _rt > _pt && _notFuture;
                    var _legacyNewer = _rb === null && _pb === null && _rt > _pt && _notFuture &&
                      Number.isFinite(Number(r.stockActual)) && Number(r.stockActual) >= 0 &&
                      !(Number(r.stockActual) === 0 && Number(prev.stockActual) > 0);
                    /* The FIRST real PN sale must not be discarded merely
                       because a just-synced legacy product has a clock a few
                       milliseconds newer. Require matching physical base,
                       nonempty positive operation counters, plausible relay
                       time and a narrow skew window. Ancient PN remains blocked. */
                    var _pnEntries = Object.keys(_rp || {});
                    var _pnValid = _pnEntries.length > 0 && _pnEntries.every(function (id) {
                      var fact = _rp[id] || {}, add = Number(fact.add), sub = Number(fact.sub);
                      return Number.isSafeInteger(add) && Number.isSafeInteger(sub) &&
                        add >= 0 && sub >= 0;
                    });
                    var _pnNet = _pnValid ? _pnEntries.reduce(function (sum, id) {
                      return sum + Number(_rp[id].add) - Number(_rp[id].sub);
                    }, 0) : NaN;
                    var _pnProof = _pnValid && Number.isSafeInteger(_rb + _pnNet) &&
                      Math.max(0, _rb + _pnNet) === Number(r.stockActual) &&
                      _pnEntries.some(function (id) {
                        return Number(_rp[id].add) > 0 || Number(_rp[id].sub) > 0;
                      });
                    var _firstLedger = _rb !== null && _pb === null && _pnProof &&
                      Number(prev.stockActual) === _rb && _rt > 0 &&
                      _rt >= _pt - 2000 && _notFuture;
                    var _stockValido = _sameLedger || _epochNewer || _legacyNewer || _firstLedger;
                    r = Object.assign({}, prev, _stockValido ? {
                      stockBase: r.stockBase, stockPN: r.stockPN, stockActual: r.stockActual,
                      stockTs: Math.max(_pt, _rt), stockDeficit: r.stockDeficit
                    } : {
                      stockBase: prev.stockBase, stockPN: prev.stockPN, stockActual: prev.stockActual,
                      stockTs: _pt, stockDeficit: prev.stockDeficit
                    });
                  }
                  else if (col === "ubicaciones") r = Object.assign({}, prev, { gastoMensual: r.gastoMensual, gastoMensualRev: r.gastoMensualRev });
                  else return;
                }
              }
              var js = JSON.stringify(r);
              // Solo si cambió: evita tormenta de updates binarios por el relay.
              if (!prev || JSON.stringify(prev) !== js) API.mapas[col].set(k, JSON.parse(js));
            });
          });
          /* NOMBRE DEL NEGOCIO (A1, JFC 2026-09-10). No mergeaba porque el
             puente aplicaba con rol=null y aplicarCatalogo solo adopta el nombre
             si el local está vacío. Ahora el nombre del DUEÑO gana, como la regla
             de jerarquía de siempre: guardamos junto al nombre si quien lo puso es
             el dueño; el otro aparato aplica con rolRemoto="dueno" y lo adopta.
             Un no-dueño no pisa un nombre ya marcado como del dueño. */
          /* P0: local name may come from f123_owned on a just-purged phone,
             while the remote CRDT history and credentials are still loading.
             Never give that stale bootstrap name owner authority in the
             shared doc. Resume ordinary name changes after confirmed pull. */
          if (cat.nombreNegocio && !(API.canal && API.canal.recuperando)) {
            var soyDueno = miRol === "dueno";
            var yaEsDueno = API.meta.get("nombreEsDueno") === true;
            /* DESEMPATE DETERMINISTA (v283, JFC 2026-09-15). Antes un dueño pisaba
               el nombre compartido cada vez que sembraba -> con DOS aparatos dueño
               era una guerra de nombres que nunca convergía. Ahora gana el rename
               de dueño MÁS RECIENTE por sello de tiempo: un dueño solo escribe el
               nombre si su ts es >= al del doc (o si el doc aún no es de dueño). */
            // v290 (#2): desempate PRIMARIO por rev monotónico (inmune a relojes
            // desfasados), secundario por ts.
            var revMeta = Number(API.meta.get("nombreRev")) || 0;
            var revMio = Number(cat.nombreNegocioRev) || 0;
            var tsMeta = Number(API.meta.get("nombreTs")) || 0;
            var tsMio = Number(cat.nombreNegocioTs) || 0;
            if (soyDueno) {
              var _gano = !yaEsDueno || revMio > revMeta || (revMio === revMeta && tsMio >= tsMeta);
              if (_gano) {
                if (API.meta.get("nombreNegocio") !== cat.nombreNegocio) API.meta.set("nombreNegocio", cat.nombreNegocio);
                // Y.Map.set emits an update even for the same value. Idle scans
                // must not create another encrypted operation in the relay.
                if (revMio && revMeta !== revMio) API.meta.set("nombreRev", revMio);
                if (tsMio && tsMeta !== tsMio) API.meta.set("nombreTs", tsMio);
                if (!yaEsDueno) API.meta.set("nombreEsDueno", true);
              }
            } else if (!yaEsDueno && !API.meta.get("nombreNegocio")) {
              API.meta.set("nombreNegocio", cat.nombreNegocio);
              API.meta.set("nombreEsDueno", false);
            }
          }
          if (cat.pinsRol && miRol && !(API.canal && API.canal.recuperando)) {
            var pinsPrev = API.meta.get("pinsRol") || {}, pinsNext = Object.assign({}, pinsPrev);
            // A fresh device must never publish factory/demo PINs over the team's credentials.
            [["owner", "789"], ["emp", "260"], ["acct", "357"]].forEach(function (role) {
              var p = String(cat.pinsRol[role[0]] || "");
              if (/^\d{3}$/.test(p) && p !== role[1] && p !== "456") pinsNext[role[0]] = p;
            });
            if (JSON.stringify(pinsNext) !== JSON.stringify(pinsPrev)) API.meta.set("pinsRol", pinsNext);
          }
        }, "seed"); // origin "seed": estos updates no deben re-aplicarse al store
      } catch (e) { log("sembrar:", e && e.message); }
      // B3: publicar al doc de fotos los blobs de perchas Y productos que tienen
      // foto. Antes se asegura que las fotos de PRODUCTO tengan hash (v290): una
      // foto recien puesta se hashea y se publica sin esperar a reconectar.
      try {
        if (window.OCSync && window.OCSync.hashearFotosProductos) {
          window.OCSync.hashearFotosProductos().then(function () { try { publicarFotosLocales(); } catch (_) {} }).catch(function () { try { publicarFotosLocales(); } catch (_) {} });
        } else { publicarFotosLocales(); }
      } catch (_) { try { publicarFotosLocales(); } catch (_) {} }
      // v292: sembrar las ventas (dinero) como ops individuales (add-only).
      try { sembrarVentasAlRelay(); } catch (_) {}
      try { sembrarFinanzas(cat); } catch (_) {}
    }

    // Yjs -> store. Reconstruye el catálogo desde los Y.Map y llama al merge
    // add-only probado. Síncrono: aplicarCatalogo no es async.
    var ultimaAplicacionVisible = Promise.resolve(false);
    API._catalogoRevision = 0;
    API.confirmarCatalogoVisible = function () {
      if (_tAplica) { clearTimeout(_tAplica); _tAplica = null; aplicar(); }
      var receipt = ultimaAplicacionVisible, revision = API._catalogoRevision;
      if (!API.hechosListos || !API.hechosListos()) return Promise.resolve(false);
      return Promise.resolve(receipt).then(function (ok) {
        return ok === true && receipt === ultimaAplicacionVisible && revision === API._catalogoRevision &&
          !_tAplica && API.hechosListos();
      });
    };
    function aplicar() {
      if (_aplicando) return;
      ultimaAplicacionVisible = Promise.resolve(false);
      // Genérico sobre COLECCIONES: agregar una colección nueva (promotoras,
      // sucursales…) es una sola línea allá arriba, aquí ya viaja sola.
      var remoto = { nombreNegocio: API.meta.get("nombreNegocio") || "", nombreNegocioTs: Number(API.meta.get("nombreTs")) || 0, nombreNegocioRev: Number(API.meta.get("nombreRev")) || 0, pinsRol: API.canal && API.canal.recuperando ? null : API.meta.get("pinsRol") || null, deviceNombre: "sync" };
      var hay = false;
      COLECCIONES.forEach(function (c) { remoto[c] = valores(c); if (remoto[c].length) hay = true; });
      // #2 (fix 2026-09-10): un update de SOLO el nombre (o pinsRol) también debe
      // aplicarse aunque no haya entidades — antes se descartaba y el nombre nunca
      // llegaba a un aparato que recibió primero el _meta.
      if (!hay && !remoto.nombreNegocio && !remoto.pinsRol) return;
      // rolRemoto="dueno" si el nombre lo puso un dueño (A1): así aplicarCatalogo
      // adopta el nombre del negocio aunque el local ya tenga otro. Para el resto
      // de reglas (nombre/precio de ítems) esto solo habilita que el nombre del
      // dueño gane; el add-only del catálogo no cambia.
      var rolRemoto = (API.meta.get("nombreEsDueno") === true) ? "dueno" : null;
      _aplicando = true;
      try {
        var r = window.OCSync.aplicarCatalogo(remoto, rolRemoto);
        // A2/A3 (JFC 2026-09-10): si el merge sumó algo, avisar a la UI para que
        // (a) lo muestre como alerta dentro de "Today's alerts", no como banner
        // suelto, y (b) re-pinte la vista Hoy (si no, el hero se queda en
        // "Loading your business..."). La UI escucha oc-sync-merge en index.html.
        // v289: incluir r.actualizados -> una actualizacion SOLO de stock/precio
        // (sin altas) tambien re-pinta la UI: es el refresco "en segundos" del CDC.
        if (r && r.ok && (r.agregadasU || r.agregadosP || r.actualizados || r.ventasAgregadas || r.miembrosAgregados || r.miembrosActualizados || r.miembrosQuitados || r.clientesAgregados || r.promotorasAgregadas || r.sucursalesAgregadas)) {
          // Una fusión de dos ledgers de stock debe volver al doc de inmediato;
          // esperar al barrido de 2 s dejaría a un tercer aparato con una sola venta.
          setTimeout(sembrar, 0);
          try {
            window.dispatchEvent(new CustomEvent("oc-sync-merge", { detail: {
              perchas: r.agregadasU || 0, productos: r.agregadosP || 0, actualizados: r.actualizados || 0, ventas: r.ventasAgregadas || 0,
              miembros: (r.miembrosAgregados || 0) + (r.miembrosActualizados || 0) + (r.miembrosQuitados || 0), clientes: r.clientesAgregados || 0,
              promotoras: r.promotorasAgregadas || 0, sucursales: r.sucursalesAgregadas || 0
            } }));
            if (window.OCSyncRender && typeof window.OCSyncRender.esperar === "function")
              ultimaAplicacionVisible = window.OCSyncRender.esperar();
          } catch (_) {}
        }
      }
      catch (e) { log("aplicar:", e && e.message); }
      _aplicando = false;
    }
    function valores(col) { var o = API.get(col), a = []; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) a.push(o[k]); return a; }

    // Cambios locales del catálogo / equipo -> re-volcar a Yjs (con rebote).
    // Son las MISMAS señales que escucha el sync casero (mock-backend las emite).
    /* v516 (JFC 2026-10-14: "app + dashboard tan reactive como entre subsecciones... INSTANTANEO").
       Medido con el relay real entre dos aparatos: ~530 ms de los cuales 400 eran esta espera y
       100 la del que recibe; la red ~30 ms. Ahora 30 ms: junta los eventos de una misma venta
       (salen en el mismo instante) sin frenar el cambio. Una espera que NO se reinicia con cada
       evento, para que una rafaga no lo posponga. Prueba: test/sync-instantaneo-v516.test.js */
    function pedirSeed() { if (_tSeed) return; _tSeed = setTimeout(function () { _tSeed = null; sembrar(); }, 0); } // v517: 0 ms (JFC: "40 ms o menos"); junta lo del mismo instante
    window.addEventListener("oc-catalogo-cambiado", pedirSeed);
    window.addEventListener("oc-equipo-cambiado", pedirSeed);

    // Convergencia remota (relay) o de otra pestaña (BroadcastChannel) -> aplicar.
    // Los updates propios de sembrar() llevan origin "seed" y se ignoran aquí.
    API.doc.on("update", function (update, origin) {
      if (origin !== "red" && origin !== "bc") return;
      API._catalogoRevision++;
      /* Coalescer con espera máxima acotada. El debounce anterior reiniciaba
         300 ms con CADA update y una ráfaga podía posponer indefinidamente el
         nombre/stock visible. El primer update agenda una aplicación próxima;
         los siguientes quedan incluidos en el mismo documento Yjs. */
      if (!_tAplica) _tAplica = setTimeout(function () {
        _tAplica = null;
        aplicar();
      }, 0); // v517: 0 ms (v516: 20, antes 100). Junta las rafagas del mismo instante
    });

    // Arranque: cuando IndexedDB termina de cargar, primero APLICAMOS lo que ya
    // había guardado localmente (por si este aparato arrancó offline) y luego
    // SEMBRAMOS lo local que aún no esté en Yjs. Ambos son idempotentes.
    function primerCruce() { aplicar(); sembrar(); }
    if (API.idb && typeof API.idb.on === "function") API.idb.once ? API.idb.once("synced", primerCruce) : API.idb.on("synced", primerCruce);
    else setTimeout(primerCruce, 800);
    // Red de seguridad si "synced" no llega (idb deshabilitado en algún navegador).
    setTimeout(function () { if (API.estado === "activo") sembrar(); }, 2500);
    /* RE-PUBLICACION PERIODICA (v302). Barata: el batch de sembrar() solo escribe
       al Y.Map "si cambió", asi que si nada cambio NO manda nada. Sirve de red: si
       un cambio local (stock por cualquier ruta, etc.) no disparo oc-catalogo-
       cambiado, igual se publica en <=10 s. Asi el stock y todo cambio cruzan sin
       depender de que cada ruta emita el evento. */
    // Recovery sweep every 2s for a missed local event, not an SLA certificate.
    // The live event path publishes immediately. The current 150ms diagnostic
    // starts at publication and cannot certify time spent before that boundary.
    // This local sweep sends nothing when the catalog is unchanged.
    if (!API._tSembraPeriodica) API._tSembraPeriodica = setInterval(function () { try { if (API.estado === "activo") sembrar(); } catch (_) {} }, 2000);

    API._store = { sembrar: sembrar, aplicar: aplicar }; // para diagnóstico manual
  }

  window.addEventListener("oc-licencia-disponible", arrancar);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
