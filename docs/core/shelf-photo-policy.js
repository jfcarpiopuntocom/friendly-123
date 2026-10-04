/* shelf-photo-policy.js — DOMAIN CORE puro para fotos de perchas.
 * v448 GOLDEN G07.
 *
 * REGLA HEXAGONAL: este archivo no conoce DOM, fetch, IndexedDB, localStorage,
 * Yjs, Service Worker ni UI. Recibe hechos y devuelve decisiones.
 *
 * Invariantes:
 * 1. Nunca destruir evidencia fotografica.
 * 2. Un fotoHash vigente nunca se reemplaza por un fallback local.
 * 3. Si falta el pointer, solo se reatacha evidencia EXACTA de la misma shelf:
 *    Yjs actual -> historial exacto (nuevo a viejo) -> bytes por-id de esa shelf.
 * 4. Un espejo por-id puede mostrarse como fallback mientras llega el blob del
 *    pointer vigente, pero NO cambia el pointer.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.F123Core = root.F123Core || {};
    root.F123Core.ShelfPhotoPolicy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function hash(x) {
    var s = String(x || "").trim();
    return s || null;
  }

  function unicos(candidatos) {
    var vistos = Object.create(null), out = [];
    (candidatos || []).forEach(function (c) {
      if (!c) return;
      var h = hash(c.hash);
      if (!h || vistos[h]) return;
      vistos[h] = true;
      out.push({ hash: h, fuente: String(c.fuente || "desconocida") });
    });
    return out;
  }

  function planear(input) {
    input = input || {};
    var actual = hash(input.currentHash);
    var perId = hash(input.perIdHash);
    var historial = Array.isArray(input.historyHashes) ? input.historyHashes : [];

    if (actual) {
      return {
        modo: "pointer-vigente",
        pointerActual: actual,
        buscar: [{ hash: actual, fuente: "pointer-vigente" }],
        fallbackPerIdHash: perId,
        puedeReatachar: false,
        candidatosReatachar: [],
        destruir: []
      };
    }

    var candidatos = [{ hash: input.yjsHash, fuente: "yjs-actual" }];
    historial.forEach(function (h) { candidatos.push({ hash: h, fuente: "yjs-historial" }); });
    candidatos.push({ hash: perId, fuente: "bytes-por-id" });

    return {
      modo: "pointer-perdido",
      pointerActual: null,
      buscar: [],
      fallbackPerIdHash: null,
      puedeReatachar: true,
      candidatosReatachar: unicos(candidatos),
      destruir: []
    };
  }

  function decidirPointerVigente(plan, evidencia) {
    evidencia = evidencia || {};
    if (!plan || plan.modo !== "pointer-vigente") return null;
    var disponible = evidencia.hashDisponible === true;
    if (disponible) {
      return {
        mostrarHash: plan.pointerActual,
        reatacharHash: null,
        usarFallbackPorId: false,
        razon: "pointer-vigente-disponible",
        destruir: []
      };
    }
    if (evidencia.perIdDisponible === true) {
      return {
        mostrarHash: plan.fallbackPerIdHash,
        reatacharHash: null,
        usarFallbackPorId: true,
        razon: "pointer-vigente-en-transito",
        destruir: []
      };
    }
    return {
      mostrarHash: null,
      reatacharHash: null,
      usarFallbackPorId: false,
      razon: "sin-bytes-disponibles",
      destruir: []
    };
  }

  function primerCandidatoDisponible(plan, hashesDisponibles) {
    if (!plan || plan.modo !== "pointer-perdido") return null;
    var set = Object.create(null);
    (hashesDisponibles || []).forEach(function (h) { h = hash(h); if (h) set[h] = true; });
    for (var i = 0; i < plan.candidatosReatachar.length; i++) {
      var c = plan.candidatosReatachar[i];
      if (set[c.hash]) return { hash: c.hash, fuente: c.fuente };
    }
    return null;
  }

  function permiteDestruirEvidencia() {
    return false; // Prime Directive 1AAA: este dominio no expone una orden destructiva.
  }

  return {
    planear: planear,
    decidirPointerVigente: decidirPointerVigente,
    primerCandidatoDisponible: primerCandidatoDisponible,
    permiteDestruirEvidencia: permiteDestruirEvidencia
  };
});
