/* recover-shelf-photo.js — APPLICATION USE CASE (ports & adapters).
 * v448 GOLDEN G07.
 *
 * Este caso de uso depende SOLO del domain core y de puertos inyectados.
 * No sabe si los bytes vienen de IndexedDB, Yjs, memoria, un test o cualquier
 * infraestructura futura.
 */
(function (root, factory) {
  var policy = null;
  if (typeof module === "object" && module.exports) {
    policy = require("../core/shelf-photo-policy.js");
    module.exports = factory(policy);
    return;
  }
  policy = root && root.F123Core && root.F123Core.ShelfPhotoPolicy;
  var api = factory(policy);
  if (root) {
    root.F123Application = root.F123Application || {};
    root.F123Application.recoverShelfPhoto = api.recoverShelfPhoto;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (policy) {
  "use strict";
  if (!policy) throw new Error("ShelfPhotoPolicy no disponible");

  async function recoverShelfPhoto(shelf, ports) {
    shelf = shelf || {};
    ports = ports || {};
    var id = String(shelf.id || "");
    if (!id) return { estado: "sin-id", displayBytes: null, pointerChanged: false };

    var currentHash = String(shelf.fotoHash || "") || null;
    var yjsHash = ports.currentMappedHash ? await ports.currentMappedHash(id) : null;
    var history = ports.historyHashes ? await ports.historyHashes(id) : [];
    if (!Array.isArray(history)) history = [];

    var perIdBytes = ports.readPerId ? await ports.readPerId(id) : null;
    var perIdHash = null;
    if (perIdBytes && ports.hashBytes) {
      try { perIdHash = await ports.hashBytes(perIdBytes); } catch (_) {}
    }

    var plan = policy.planear({
      currentHash: currentHash,
      yjsHash: yjsHash,
      historyHashes: history,
      perIdHash: perIdHash
    });

    async function readHash(hash) {
      if (!hash) return null;
      var bytes = null;
      if (ports.readByHash) {
        try { bytes = await ports.readByHash(hash); } catch (_) {}
      }
      if (!bytes && ports.readSyncByHash) {
        try { bytes = await ports.readSyncByHash(hash); } catch (_) {}
      }
      return bytes || null;
    }

    async function preserve(id, hash, bytes) {
      if (!bytes) return;
      if (hash && ports.preserveByHash) {
        try { await ports.preserveByHash(hash, bytes); } catch (_) {}
      }
      if (ports.preserveById) {
        try { await ports.preserveById(id, bytes); } catch (_) {}
      }
    }

    if (plan.modo === "pointer-vigente") {
      var vigente = await readHash(plan.pointerActual);
      var decision = policy.decidirPointerVigente(plan, {
        hashDisponible: !!vigente,
        perIdDisponible: !!perIdBytes
      });

      if (vigente) {
        await preserve(id, plan.pointerActual, vigente);
        return {
          estado: "pointer-vigente",
          displayBytes: vigente,
          displayHash: plan.pointerActual,
          pointerChanged: false,
          pointerHash: plan.pointerActual,
          fuente: "pointer-vigente"
        };
      }

      if (decision && decision.usarFallbackPorId && perIdBytes) {
        if (ports.warn) {
          try { ports.warn("foto-hash-pendiente"); } catch (_) {}
        }
        // Se preserva evidencia, pero NO se toca el pointer vigente.
        if (perIdHash) await preserve(id, perIdHash, perIdBytes);
        return {
          estado: "fallback-local",
          displayBytes: perIdBytes,
          displayHash: perIdHash,
          pointerChanged: false,
          pointerHash: plan.pointerActual,
          fuente: "bytes-por-id"
        };
      }

      return {
        estado: "pointer-sin-bytes",
        displayBytes: null,
        displayHash: null,
        pointerChanged: false,
        pointerHash: plan.pointerActual,
        fuente: null
      };
    }

    // Pointer perdido: solo evidencia exacta de la MISMA shelf puede repararlo.
    var disponibles = [];
    var bytesPorHash = Object.create(null);
    for (var i = 0; i < plan.candidatosReatachar.length; i++) {
      var cand = plan.candidatosReatachar[i];
      var bytes = null;
      if (cand.fuente === "bytes-por-id" && perIdHash === cand.hash && perIdBytes) {
        bytes = perIdBytes;
      } else {
        bytes = await readHash(cand.hash);
      }
      if (bytes) {
        disponibles.push(cand.hash);
        bytesPorHash[cand.hash] = bytes;
      }
    }

    var elegido = policy.primerCandidatoDisponible(plan, disponibles);
    if (!elegido) {
      return {
        estado: "sin-evidencia-exacta",
        displayBytes: perIdBytes || null,
        displayHash: perIdHash,
        pointerChanged: false,
        pointerHash: null,
        fuente: perIdBytes ? "bytes-por-id-sin-hash" : null
      };
    }

    var elegidosBytes = bytesPorHash[elegido.hash] || (elegido.hash === perIdHash ? perIdBytes : null);
    if (!elegidosBytes) {
      return { estado: "evidencia-inconsistente", displayBytes: null, pointerChanged: false };
    }

    await preserve(id, elegido.hash, elegidosBytes);
    var aceptado = true;
    if (ports.setPointer) {
      try { aceptado = (await ports.setPointer(id, elegido.hash)) !== false; }
      catch (_) { aceptado = false; }
    }
    if (!aceptado) {
      // Fallo de escritura: mostrar evidencia sigue siendo seguro; no fingir que el pointer cambió.
      return {
        estado: "pointer-no-confirmado",
        displayBytes: elegidosBytes,
        displayHash: elegido.hash,
        pointerChanged: false,
        pointerHash: null,
        fuente: elegido.fuente
      };
    }

    return {
      estado: "recuperada",
      displayBytes: elegidosBytes,
      displayHash: elegido.hash,
      pointerChanged: true,
      pointerHash: elegido.hash,
      fuente: elegido.fuente
    };
  }

  return { recoverShelfPhoto: recoverShelfPhoto };
});
