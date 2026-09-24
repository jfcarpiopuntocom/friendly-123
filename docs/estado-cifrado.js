/*!
 * estado-cifrado.js — Estado de cuenta del comisionista (JFC 2026-09-24, Opus 5.5).
 * Ver PLAN-ESTADO-DE-CUENTA-COMISIONISTA-2026-09-24.md.
 *
 * POR QUE ASI: sin servidor que guarde ventas. El estado viaja DENTRO del enlace,
 * cifrado con AES-GCM y una clave aleatoria de 128 bits, todo en el fragmento (#),
 * que el navegador nunca envia a ningun servidor. El vencimiento va dentro de lo
 * cifrado: cambiarlo rompe la autenticacion de AES-GCM.
 *
 * REGLAS QUE NO SE ROMPEN:
 *  - armar() acepta SOLO los campos de la lista blanca; nunca clientes, costos,
 *    otras perchas, PIN, licencia ni instanceId.
 *  - leer() valida tipos y largos antes de devolver nada; quien pinta usa textContent.
 *  - Sin dependencias: WebCrypto del navegador (y de Node 18+ para los tests).
 */
(function (global) {
  "use strict";
  var VENCE_DIAS_DEFECTO = 7;          // decision pendiente de JFC: 7 o 30
  var MAX_LINEAS = 60;
  var C = (global.crypto && global.crypto.subtle) ? global.crypto : null;

  function b64u(bytes) {
    var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return (global.btoa ? global.btoa(s) : Buffer.from(s, "binary").toString("base64")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    str = String(str || "").replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "=";
    var bin = global.atob ? global.atob(str) : Buffer.from(str, "base64").toString("binary");
    var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
  var txt = function (v, max) { return String(v == null ? "" : v).slice(0, max || 80); };
  var num = function (v) { var n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  var MEDIOS = { efectivo: 1, transferencia: 1, "credito-tienda": 1, otro: 1 };

  /* Lista blanca: lo unico que puede viajar. */
  function armar(d, ahora) {
    ahora = ahora || Date.now();
    d = d || {};
    var lineas = (Array.isArray(d.lineas) ? d.lineas : []).slice(0, MAX_LINEAS).map(function (l) {
      return { f: txt(l.fecha, 10), p: txt(l.producto, 60), q: num(l.cantidad), c: num(l.comision), pg: !!l.pagada, m: MEDIOS[l.medio] ? l.medio : null };
    });
    var ajustes = (Array.isArray(d.ajustes) ? d.ajustes : []).slice(0, 20).map(function (a) {
      return { f: txt(a.fecha, 10), p: txt(a.producto, 60), c: num(a.comision) };
    });
    return {
      v: 1, n: txt(d.nombre, 40), b: txt(d.negocio, 60), mes: txt(d.mes, 7),
      l: lineas, a: ajustes,
      t: { vendido: num(d.totalVendido), comision: num(d.totalComision), pagado: num(d.totalPagado), pendiente: num(d.totalPendiente) },
      exp: ahora + (Number(d.venceDias) > 0 ? Number(d.venceDias) : VENCE_DIAS_DEFECTO) * 86400000,
      recortado: (Array.isArray(d.lineas) && d.lineas.length > MAX_LINEAS) || false
    };
  }

  async function cifrar(datos, ahora) {
    if (!C) throw new Error("WebCrypto no disponible");
    var claro = new TextEncoder().encode(JSON.stringify(armar(datos, ahora)));
    var claveBytes = C.getRandomValues(new Uint8Array(16));
    var iv = C.getRandomValues(new Uint8Array(12));
    var clave = await C.subtle.importKey("raw", claveBytes, "AES-GCM", false, ["encrypt"]);
    var cif = new Uint8Array(await C.subtle.encrypt({ name: "AES-GCM", iv: iv }, clave, claro));
    var todo = new Uint8Array(iv.length + cif.length); todo.set(iv, 0); todo.set(cif, iv.length);
    return b64u(todo) + "." + b64u(claveBytes);
  }

  /* Devuelve {ok, datos} o {ok:false, motivo}. Nunca lanza hacia la pagina. */
  async function leer(fragmento, ahora) {
    try {
      if (!C) return { ok: false, motivo: "navegador" };
      ahora = ahora || Date.now();
      var partes = String(fragmento || "").replace(/^#/, "").split(".");
      if (partes.length !== 2) return { ok: false, motivo: "enlace" };
      var todo = unb64u(partes[0]), claveBytes = unb64u(partes[1]);
      if (claveBytes.length !== 16 || todo.length < 13) return { ok: false, motivo: "enlace" };
      var clave = await C.subtle.importKey("raw", claveBytes, "AES-GCM", false, ["decrypt"]);
      var claro = await C.subtle.decrypt({ name: "AES-GCM", iv: todo.slice(0, 12) }, clave, todo.slice(12));
      var d = JSON.parse(new TextDecoder().decode(claro));
      if (!d || d.v !== 1 || typeof d.exp !== "number") return { ok: false, motivo: "enlace" };
      if (ahora > d.exp) return { ok: false, motivo: "vencido" };
      /* Revalida con la misma lista blanca (defensa en profundidad). */
      var limpio = armar({ nombre: d.n, negocio: d.b, mes: d.mes,
        lineas: (d.l || []).map(function (l) { return { fecha: l.f, producto: l.p, cantidad: l.q, comision: l.c, pagada: l.pg, medio: l.m }; }),
        ajustes: (d.a || []).map(function (a) { return { fecha: a.f, producto: a.p, comision: a.c }; }),
        totalVendido: d.t && d.t.vendido, totalComision: d.t && d.t.comision, totalPagado: d.t && d.t.pagado, totalPendiente: d.t && d.t.pendiente }, ahora);
      limpio.exp = d.exp; limpio.recortado = !!d.recortado;
      return { ok: true, datos: limpio };
    } catch (_) { return { ok: false, motivo: "enlace" }; }
  }

  global.OCEstado = { armar: armar, cifrar: cifrar, leer: leer, VENCE_DIAS_DEFECTO: VENCE_DIAS_DEFECTO, MAX_LINEAS: MAX_LINEAS };
})(typeof window !== "undefined" ? window : globalThis);
