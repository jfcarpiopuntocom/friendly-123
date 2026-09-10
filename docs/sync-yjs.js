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
// NO ROMPE NADA: apagado por defecto. Solo hace algo si
// localStorage["OC_YJS_FASE0"] === "1". Corre EN PARALELO al sync casero, en una
// SALA DISTINTA del relay (sufijo "-y"), así los updates binarios de Yjs jamás
// llegan al handler JSON de sync-realtime.js. Fase 0 sincroniza solo la colección
// "productos" para probar convergencia entre 2 pestañas/dispositivos.
(function () {
  "use strict";

  var FLAG = "OC_YJS_FASE0";
  function activo() { try { return localStorage.getItem(FLAG) === "1"; } catch (_) { return false; } }
  if (!activo()) return; // costo cero para todos los que no probamos el spike

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

  var API = {
    estado: "apagado", doc: null, productos: null, clave: null, ws: null, bc: null, roomId: null,
    // API mínima para probar convergencia a mano desde la consola.
    setProducto: function (id, obj) { if (!this.productos) return false; this.productos.set(String(id), obj); return true; },
    getProductos: function () { var o = {}; if (this.productos) this.productos.forEach(function (v, k) { o[k] = v; }); return o; },
    _diag: function () { return { estado: this.estado, roomId: this.roomId, n: this.productos ? this.productos.size : 0, ws: this.ws ? this.ws.readyState : null }; }
  };
  window.OCYjs = API;

  function log(/*...*/) { try { console.log.apply(console, ["[OCYjs]"].concat([].slice.call(arguments))); } catch (_) {} }

  async function arrancar() {
    var sala = leerSala();
    if (!sala || !sala.codigo) { log("sin sala — Plan C en espera (esto es normal si el sync no está configurado)"); return; }
    var codigo = normalizarCodigo(sala.codigo);
    try { await cargarBundle(); } catch (e) { log("bundle:", e && e.message); return; }

    var Y = window.Y;
    API.doc = new Y.Doc();
    API.productos = API.doc.getMap("productos");
    API.clave = await derivarClave(codigo);
    API.roomId = await idDeSala(codigo);

    // Persistencia local: sobrevive recargas y sirve offline (piso del piso).
    try { new window.IndexeddbPersistence("f123-yjs-" + API.roomId, API.doc); } catch (e) { log("idb:", e && e.message); }

    // Convergencia entre pestañas del MISMO origen: instantánea, sin red.
    try {
      API.bc = new BroadcastChannel("f123-yjs-" + API.roomId);
      API.bc.onmessage = function (ev) { try { Y.applyUpdate(API.doc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}

    // Cada cambio local -> update binario -> (a) pestañas por BroadcastChannel,
    // (b) otros dispositivos por el relay cifrado. origin !== "bc"/"red" evita eco.
    API.doc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") return;
      try { if (API.bc) API.bc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      enviarRelay(update);
    });

    conectarRelay(Y);
    API.estado = "activo";
    log("Plan C activo. Sala:", API.roomId, "— probar: OCYjs.setProducto('p1',{nombre:'test'}) y OCYjs.getProductos() en el otro aparato");
  }

  // --- Relay device-to-device (sala separada "-y" para no chocar con el sync casero) ---
  var pendientes = [];
  function enviarRelay(update) {
    if (!API.clave) return;
    cifrarBin(API.clave, update).then(function (buf) {
      if (API.ws && API.ws.readyState === 1) API.ws.send(buf);
      else pendientes.push(buf); // se drenan al reconectar
    }).catch(function () {});
  }
  function conectarRelay(Y) {
    var url = RELAY_URL + API.roomId + "-y"; // sufijo -y: aislado del sync casero
    var ws;
    try { ws = new WebSocket(url); } catch (_) { setTimeout(function () { conectarRelay(Y); }, 5000); return; }
    ws.binaryType = "arraybuffer";
    API.ws = ws;
    ws.onopen = function () {
      // Al entrar: manda mi estado completo para que un par nuevo converja rápido.
      try { enviarRelay(Y.encodeStateAsUpdate(API.doc)); } catch (_) {}
      while (pendientes.length && ws.readyState === 1) ws.send(pendientes.shift());
    };
    ws.onmessage = function (ev) {
      if (!(ev.data instanceof ArrayBuffer) || !API.clave) return;
      descifrarBin(API.clave, ev.data).then(function (bytes) {
        Y.applyUpdate(API.doc, bytes, "red"); // origin "red": no re-difundir (evita eco)
      }).catch(function () {}); // basura o clave distinta -> se ignora (relay sordo)
    };
    ws.onclose = function () { API.ws = null; setTimeout(function () { conectarRelay(Y); }, 4000); };
    ws.onerror = function () { try { ws.close(); } catch (_) {} };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
