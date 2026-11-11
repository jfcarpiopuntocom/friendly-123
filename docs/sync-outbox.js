/*!
 * sync-outbox.js — R2: outbox persistente en IndexedDB (JFC 2026-08-20)
 *
 * QUE RESUELVE: la cola de operaciones pendientes de sincronizar (cambios
 * hechos offline, esperando a que el otro dispositivo las reciba) vivia
 * SOLO en localStorage ("f123_sync_pending"), con el cupo chico (~5-10MB)
 * compartido con TODO lo demas de la app. En un telefono viejo con el
 * storage casi lleno, guardar la cola podia fallar en silencio y una venta
 * offline se perdia sin que nadie lo notara.
 *
 * COMO SE USA: mismo par de funciones que ya existian
 * (guardarColaCifrada/restaurarCola en avanzado-extra.js), pero ahora
 * escriben primero en IndexedDB (cupo ordenes de magnitud mayor, mismo
 * motor que ya usa idb-archivo.js/idb-fotos.js) y SOLO si eso falla caen a
 * localStorage -- exactamente el comportamiento de hoy, sin regresion.
 * Nunca al reves: preferir localStorage cuando IndexedDB si esta
 * disponible perderia el beneficio del cupo grande.
 *
 * FALLA ABIERTO: si IndexedDB no esta soportado (Safari privado viejo,
 * algunos navegadores embebidos), se usa localStorage tal cual se hacia
 * antes de este archivo existir. Ningun camino nuevo puede dejar la app
 * peor que como estaba.
 */
(function () {
  "use strict";

  var DB_NAME = "f123_outbox";
  var STORE = "cola";
  var LS_KEY = "f123_sync_pending";
  var SOPORTADO = typeof indexedDB !== "undefined";
  var dbPromise = null;

  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB bloqueado (otra pestaña con una version vieja abierta)")); };
    });
    return dbPromise;
  }

  async function guardar(blobCifrado) {
    if (SOPORTADO) {
      try {
        var db = await abrirDB();
        await new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put({ id: LS_KEY, blob: blobCifrado, guardado: Date.now() });
          tx.oncomplete = resolve;
          tx.onerror = function () { reject(tx.error); };
        });
        // Limpieza best-effort del rastro viejo en localStorage: si IndexedDB
        // ya tiene el dato fresco, no hace falta duplicarlo ahi tambien.
        try { localStorage.removeItem(LS_KEY); } catch (_) {}
        return true;
      } catch (e) {
        try { console.warn("[sync-outbox] IndexedDB fallo, cae a localStorage:", e && e.message); } catch (_) {}
      }
    }
    try { localStorage.setItem(LS_KEY, blobCifrado); return true; } catch (_) { return false; }
  }

  async function leer() {
    if (SOPORTADO) {
      try {
        var db = await abrirDB();
        var fila = await new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readonly");
          var req = tx.objectStore(STORE).get(LS_KEY);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
        if (fila && fila.blob) return fila.blob;
      } catch (e) {
        try { console.warn("[sync-outbox] IndexedDB no disponible para leer, prueba localStorage:", e && e.message); } catch (_) {}
      }
    }
    // Migracion silenciosa: si el dato viejo esta solo en localStorage
    // (dispositivo que aun no habia corrido este archivo), se lee de ahi
    // una vez -- la proxima escritura ya cae en IndexedDB.
    try { return localStorage.getItem(LS_KEY); } catch (_) { return null; }
  }

  // Checksums are calculated in memory. Never log/export a real license,
  // PIN, decrypted operation body, or identifying customer data.
  async function sha256Hex(value) {
    if (!crypto || !crypto.subtle || typeof TextEncoder !== "function")
      throw new Error("P0 SHA-256 unavailable");
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  function sortedOpIds(ops) {
    return ops.map(x => x.opId).sort();
  }

  // Explicit staging operation only; NEVER invoked automatically on startup.
  // Legacy "cola" is ONE encrypted blob containing an array of ops with .id,
  // NOT per-op IDB records. Re-encrypt each validated operation without ever
  // persisting the plaintext or destroying the original source.
  async function prepararMigracionAlEstado() {
    const state=window.OCEstadoIDB,secure=window.OCSecure;
    if(!state||!state.importarOutboxPreparado||!state.leerOutboxMigrado||
       !secure||!secure.descifrarSync||!secure.cifrarSync)
      return {status:"blocked",reason:"capability-unavailable"};
    try {
      const source=await leer();
      if(!source)return {status:"empty",count:0};
      const sourceCipherHash=await sha256Hex(source);
      const plain=await secure.descifrarSync(source);
      if(typeof plain!=="string")return {status:"blocked",reason:"decrypt-unavailable"};
      const operations=JSON.parse(plain);
      if(!Array.isArray(operations))return {status:"blocked",reason:"not-array"};
      const unique=new Set(),newRows=[];
      const originals=[];
      for(const op of operations){
        if(!op||typeof op!=="object"||Array.isArray(op)||
           (op.opId&&op.id&&op.opId!==op.id))
          return {status:"blocked",reason:"identity-ambiguous"};
        const key=op.opId||op.id;
        if(typeof key!=="string"||!key||key.length>160||unique.has(key))
          return {status:"blocked",reason:"identity-invalid"};
        unique.add(key);
        const encoded=JSON.stringify(op);
        originals.push({opId:key,plain:encoded});
        const prior=await state.leerOutboxMigrado(key);
        if(prior){
          const recovered=await secure.descifrarSync(prior.blob);
          if(recovered!==encoded)return {status:"blocked",reason:"identity-conflict"};
          continue;
        }
        const encrypted=await secure.cifrarSync(encoded);
        if(typeof encrypted!=="string"||!encrypted)
          return {status:"blocked",reason:"encrypt-unavailable"};
        newRows.push({opId:key,blob:encrypted});
      }
      const originalOpIdHash=await sha256Hex(JSON.stringify(sortedOpIds(originals)));
      if(newRows.length && !(await state.importarOutboxPreparado(newRows)))
        return {status:"blocked",reason:"copy-not-confirmed"};
      // Read back EVERY logical operation and compare bytes after decrypting.
      // Do not rely on raw IDB row count or request.onsuccess as migration ACK.
      const verifiedOps=[];
      for(const original of originals){
        const row=await state.leerOutboxMigrado(original.opId);
        if(!row||typeof row.blob!=="string")
          return {status:"blocked",reason:"read-back-missing"};
        const decoded=await secure.descifrarSync(row.blob);
        if(decoded!==original.plain)
          return {status:"blocked",reason:"read-back-payload-mismatch"};
        let parsed;
        try{parsed=JSON.parse(decoded);}catch(_){
          return {status:"blocked",reason:"read-back-parse"};
        }
        const recoveredId=parsed&&(parsed.opId||parsed.id);
        if(recoveredId!==original.opId)
          return {status:"blocked",reason:"read-back-opid-mismatch"};
        verifiedOps.push({opId:recoveredId});
      }
      const verifiedOpIdHash=await sha256Hex(JSON.stringify(sortedOpIds(verifiedOps)));
      if(verifiedOpIdHash!==originalOpIdHash||verifiedOps.length!==originals.length)
        return {status:"blocked",reason:"opid-set-hash-mismatch"};
      // An old writer could change the single legacy blob after we read it.
      // Hash both ciphertext snapshots and require raw equality as well;
      // idempotent staging is NOT a write cutover or global outbox equality.
      const after=await leer();
      if(!after||after!==source||await sha256Hex(after)!==sourceCipherHash)
        return {status:"stale-source",count:originals.length,sourcePreserved:true};
      return {status:"staged-only",count:originals.length,
        copiedThisPass:newRows.length,sourceCipherHashMatches:true,
        opIdSetHashMatches:true,sourcePreserved:true};
    }catch(_){
      return {status:"blocked",reason:"staging-error"};
    }
  }

  window.OCOutbox = { guardar: guardar, leer: leer, prepararMigracionAlEstado: prepararMigracionAlEstado };
})();
