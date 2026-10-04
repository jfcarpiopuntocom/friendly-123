// idb-fotos.js — fotos de percha en IndexedDB, no en localStorage (JFC 2026-07-18).
//
// POR QUÉ: localStorage tiene un techo practico de ~5-10MB por origen. Cada
// foto de percha (resize a 640px, JPEG 0.8) pesa 200-800KB en base64. Con
// 10-15 perchas con foto, localStorage ya revienta — bug real reportado esta
// sesion: "No se pudo guardar la foto (espacio lleno)". IndexedDB no tiene ese
// techo practico (tipicamente cientos de MB a varios GB) y es async nativo:
// no bloquea el hilo principal como localStorage.setItem() de un blob grande.
//
// COMPATIBILIDAD: IndexedDB es tecnologia baseline (soporte >96% global,
// Chrome 23+/Firefox 10+/Safari 10+ — MDN/caniuse, verificado 2026-07-18). Aun
// asi, TODA funcion de este archivo hace feature-detection y cae de vuelta a
// localStorage si "indexedDB" no existe en window — nunca asume soporte.
//
// CONTRATO: mismo shape de funciones que el getFoto()/FOTO_KEY() que
// reemplaza en vista-perchas.js, para que el swap sea interno — nadie mas
// necesita cambiar. Las lecturas siguen siendo SINCRONAS desde el punto de
// vista de quien llama gracias al cache en memoria de vista-perchas.js (ver
// precargarFotos() ahi); este archivo solo expone la capa de persistencia.
(function () {
  const DB_NAME = "f123_fotos";
  const STORE = "perchas";
  /* B1 (JFC 2026-09-10): almacen direccionado por CONTENIDO. La foto se guarda
     con clave = SHA-256 de sus bytes (hex). Asi la MISMA foto se guarda una sola
     vez (dedup) y el sync solo mueve el hash como puntero: los bytes viajan
     aparte (a la nube del dueno, B3). El store "perchas" (por id) se mantiene
     intacto para no romper la vista actual; los dos conviven. */
  const STORE_BLOBS = "blobs";
  const SOPORTADO = "indexedDB" in window;
  let dbPromise = null;
  let _ultimoRescate = {
    at: 0,
    dbPreAislamiento: { encontrada:false, encontradasPerchas:0, encontradosBlobs:0, perchas:0, blobs:0 },
    rawLocalStorage: { encontrada:false, encontradasPerchas:0, encontradosBlobs:0, perchas:0, blobs:0 }
  };

  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      // v2: agrega el store "blobs" sin tocar "perchas" (nada se pierde).
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB bloqueado (otra pestaña con una version vieja abierta)"));
    });
    return dbPromise;
  }

  // --- Direccionamiento por contenido (SHA-256) ---
  function _dataUrlABytes(dataUrl) {
    const i = String(dataUrl).indexOf(",");
    const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
    return u;
  }
  async function hashDeDataUrl(dataUrl) {
    // crypto.subtle exige contexto seguro (https o localhost); Pages es https.
    const h = await crypto.subtle.digest("SHA-256", _dataUrlABytes(dataUrl));
    return [].slice.call(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const claveBlob = (hash) => "f123_fotoblob_" + hash;

  async function guardarPorHash(hash, dataUrl) {
    if (!hash) return false;
    if (!SOPORTADO) { try { localStorage.setItem(claveBlob(hash), dataUrl); return true; } catch (_) { return false; } }
    try {
      const db = await abrirDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, "readwrite");
        tx.objectStore(STORE_BLOBS).put(dataUrl, hash); // put idempotente = dedup
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (err) { console.error("[idb-fotos] guardarPorHash:", err); return false; }
  }
  async function leerPorHash(hash) {
    if (!hash) return null;
    if (!SOPORTADO) { try { return localStorage.getItem(claveBlob(hash)); } catch (_) { return null; } }
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, "readonly");
        const req = tx.objectStore(STORE_BLOBS).get(hash);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) { console.error("[idb-fotos] leerPorHash:", err); return null; }
  }
  async function tieneHash(hash) { return !!(await leerPorHash(hash)); }
  // Lista de hashes que este aparato YA tiene — base del protocolo "tengo/quiero"
  // que usara B3 para pedir a la nube solo lo que falta.
  async function hashesGuardados() {
    if (!SOPORTADO) {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("f123_fotoblob_") === 0) out.push(k.slice("f123_fotoblob_".length)); } } catch (_) {}
      return out;
    }
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, "readonly");
        const req = tx.objectStore(STORE_BLOBS).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (err) { console.error("[idb-fotos] hashesGuardados:", err); return []; }
  }

  // v449: export forense read-only del almacen content-addressed completo.
  // Conserva hash -> bytes aunque el puntero de una percha ya se haya perdido.
  // NO intenta asociar hashes huerfanos a ninguna percha.
  async function leerTodosPorHash() {
    if (!SOPORTADO) {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("f123_fotoblob_") === 0) {
            const hash = k.slice("f123_fotoblob_".length);
            const dataUrl = localStorage.getItem(k);
            if (dataUrl) out[hash] = dataUrl;
          }
        }
      } catch (_) {}
      return out;
    }
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, "readonly");
        const store = tx.objectStore(STORE_BLOBS);
        const out = {};
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { out[String(cursor.key)] = cursor.value; cursor.continue(); }
          else {
            /* Port adapter, fail-safe: IndexedDB disponible NO implica que sea
               el unico lugar donde haya evidencia. Una sesion antigua pudo dejar
               blobs content-addressed en localStorage; se fusionan sin borrar ni
               pisar lo que IDB ya conoce. */
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || k.indexOf("f123_fotoblob_") !== 0) continue;
                const hash = k.slice("f123_fotoblob_".length);
                const dataUrl = localStorage.getItem(k);
                if (dataUrl && !out[hash]) out[hash] = dataUrl;
              }
            } catch (_) {}
            resolve(out);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-fotos] leerTodosPorHash:", err);
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("f123_fotoblob_") === 0) {
            const hash = k.slice("f123_fotoblob_".length);
            const dataUrl = localStorage.getItem(k);
            if (dataUrl) out[hash] = dataUrl;
          }
        }
      } catch (_) {}
      return out;
    }
  }
  // Guarda una foto por su hash y DEVUELVE el hash — atajo para quien captura.
  async function guardarFotoContenido(dataUrl) {
    const hash = await hashDeDataUrl(dataUrl);
    await guardarPorHash(hash, dataUrl);
    return hash;
  }

  // Clave localStorage que usaba el formato viejo (antes de esta migracion).
  const claveVieja = (id) => "f123_foto_percha_" + id;
  function leerLegacyFoto(id) {
    try { return localStorage.getItem(claveVieja(id)); } catch (_) { return null; }
  }
  function leerLegacyTodas() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("f123_foto_percha_") === 0) {
          const dataUrl = localStorage.getItem(k);
          if (dataUrl) out[k.slice("f123_foto_percha_".length)] = dataUrl;
        }
      }
    } catch (_) {}
    return out;
  }

  async function guardarFoto(id, dataUrl) {
    if (!SOPORTADO) {
      try { localStorage.setItem(claveVieja(id), dataUrl); return true; }
      catch (_) { return false; }
    }
    try {
      const db = await abrirDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(dataUrl, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (err) {
      console.error("[idb-fotos] guardarFoto:", err);
      return false;
    }
  }

  async function leerFotoSoloIdb(id) {
    if (!SOPORTADO) return null;
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (_) { return null; }
  }

  async function leerFoto(id) {
    if (!SOPORTADO) return leerLegacyFoto(id);
    try {
      const db = await abrirDB();
      const desdeIdb = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      return desdeIdb || leerLegacyFoto(id);
    } catch (err) {
      console.error("[idb-fotos] leerFoto:", err);
      return leerLegacyFoto(id);
    }
  }

  // Lee TODAS las fotos guardadas de una vez — usado por vista-perchas.js para
  // precargar el cache en memoria antes de pintar el grid (evita N lecturas
  // async individuales, una por tarjeta).
  async function leerTodas() {
    if (!SOPORTADO) {
      return leerLegacyTodas();
    }
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const out = {};
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
          else {
            const legacy = leerLegacyTodas();
            Object.keys(legacy).forEach((id) => { if (!out[id]) out[id] = legacy[id]; });
            resolve(out);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-fotos] leerTodas:", err);
      return leerLegacyTodas();
    }
  }

  /* PRIME DIRECTIVE 1AAA (JFC 2026-10-04): esta capa NO destruye fotos.
     Históricamente borrarFoto() eliminaba la copia por-id y la migración quitaba
     el original de localStorage. Un hotfix/render/sync no puede decidir que bytes
     del cliente "sobran". Se conserva el nombre borrarFoto por compatibilidad,
     pero ahora significa "dejar de usar en UI" y NO toca persistencia. Los bytes
     quedan como evidencia recuperable en el dispositivo. */
  async function borrarFoto(id) {
    try { console.warn("[idb-fotos] Prime Directive: foto preservada, no se elimina", String(id || "")); } catch (_) {}
    return true;
  }

  /* Copia cada foto por-id al store content-addressed y devuelve la relacion
     exacta id -> hash. Es idempotente: nunca borra ni renombra nada. Esto blinda
     evidencia vieja ANTES de cualquier self-heal, sync o render. */
  async function blindarEvidencia() {
    const porId = await leerTodas();
    const legacy = leerLegacyTodas();
    const mapaIdHash = {};
    for (const id of Object.keys(porId || {})) {
      const dataUrl = porId[id];
      if (!dataUrl) continue;
      try {
        const hash = await guardarFotoContenido(dataUrl);
        if (hash) mapaIdHash[id] = hash;
      } catch (_) {}
    }
    /* Si el mismo shelf id conserva una foto legacy distinta de la copia IDB,
       ambas son evidencia. La legacy se blinda por hash para que el Recovery
       Vault pueda mostrarla; nunca reemplaza automaticamente la copia vigente. */
    for (const id of Object.keys(legacy || {})) {
      const dataUrl = legacy[id];
      if (!dataUrl) continue;
      try { await guardarFotoContenido(dataUrl); } catch (_) {}
    }
    return mapaIdHash;
  }

  async function inventariarEvidencia() {
    const porId = await leerTodas();
    const porHash = await leerTodosPorHash();
    const mapaIdHash = {};
    for (const id of Object.keys(porId || {})) {
      try {
        const dataUrl = porId[id];
        if (dataUrl) mapaIdHash[id] = await hashDeDataUrl(dataUrl);
      } catch (_) {}
    }
    return { porId: porId || {}, porHash: porHash || {}, mapaIdHash };
  }

  /* G10: rescate copy-only de la DB fisica pre-aislamiento.
     aislamiento.js conserva la unica capacidad autorizada para leer esa DB
     antigua y devuelve solo {perchas, blobs}. Esta capa copia evidencia a la
     DB namespaced actual sin borrar la fuente ni pisar una foto actual. */
  async function rescatarDbPreAislamiento() {
    try {
      const a = window.AMG && window.AMG.Aislamiento;
      if (!a || typeof a.leerFotosDbPreAislamiento !== "function") return { encontrada:false, perchas:0, blobs:0 };
      const vieja = await a.leerFotosDbPreAislamiento();
      if (!vieja) return { encontrada:false, perchas:0, blobs:0 };
      let perchas = 0, blobs = 0;
      const porId = vieja.perchas || {};
      const porHash = vieja.blobs || {};
      const encontradasPerchas = Object.keys(porId).length;
      const encontradosBlobs = Object.keys(porHash).length;

      for (const id of Object.keys(porId)) {
        const bytes = porId[id];
        if (!bytes) continue;
        try {
          // Toda foto vieja se preserva por hash, incluso si el mismo id ya tiene
          // una foto mas nueva en la DB actual.
          await guardarFotoContenido(bytes);
          const actual = await leerFotoSoloIdb(id);
          if (!actual && await guardarFoto(id, bytes)) perchas++;
        } catch (_) {}
      }

      for (const hash of Object.keys(porHash)) {
        const bytes = porHash[hash];
        if (!hash || !bytes) continue;
        try {
          const actual = await leerPorHash(hash);
          if (!actual && await guardarPorHash(hash, bytes)) blobs++;
        } catch (_) {}
      }

      try {
        localStorage.setItem("f123_fotos_db_preaislamiento_v1", JSON.stringify({
          copiadaEn: Date.now(), perchas: perchas, blobs: blobs
        }));
      } catch (_) {}
      return {
        encontrada:true,
        encontradasPerchas:encontradasPerchas,
        encontradosBlobs:encontradosBlobs,
        perchas:perchas,
        blobs:blobs
      };
    } catch (err) {
      try { console.warn("[idb-fotos] G10 rescate pre-aislamiento pendiente:", err && err.message ? err.message : err); } catch (_) {}
      return { encontrada:false, perchas:0, blobs:0 };
    }
  }

  /* G10b: rescate copy-only de fotos raw en localStorage fisico que pudieron
     aparecer DESPUES del marcador one-shot del aislamiento. La lectura raw la
     hace aislamiento.js mediante una capability allowlisted; esta capa valida de
     nuevo, blinda por hash y llena el slot por-id solo si sigue vacio. */
  async function rescatarLocalStoragePreAislamiento() {
    try {
      const a = window.AMG && window.AMG.Aislamiento;
      if (!a || typeof a.leerFotosLocalStoragePreAislamiento !== "function") {
        return { encontrada:false, encontradasPerchas:0, encontradosBlobs:0, perchas:0, blobs:0 };
      }
      const vieja = a.leerFotosLocalStoragePreAislamiento() || { perchas:{}, blobs:{} };
      const porId = vieja.perchas || {}, porHash = vieja.blobs || {};
      const encontradasPerchas = Object.keys(porId).length;
      const encontradosBlobs = Object.keys(porHash).length;
      let perchas = 0, blobs = 0;

      for (const id of Object.keys(porId)) {
        const bytes = porId[id];
        if (!id || typeof bytes !== "string" || !bytes.startsWith("data:image/")) continue;
        try {
          // Conserva SIEMPRE la evidencia por su hash real; nunca confia en un
          // nombre de clave para decidir el contenido.
          await guardarFotoContenido(bytes);
          const actual = await leerFotoSoloIdb(id);
          if (!actual && await guardarFoto(id, bytes)) perchas++;
        } catch (_) {}
      }

      for (const hash of Object.keys(porHash)) {
        const bytes = porHash[hash];
        if (!/^[a-f0-9]{64}$/i.test(hash) || typeof bytes !== "string" || !bytes.startsWith("data:image/")) continue;
        try {
          const real = await hashDeDataUrl(bytes);
          // Si la clave legacy estaba corrupta/mal rotulada, preserva bajo el
          // hash REAL y no perpetua una asociacion falsa.
          const objetivo = real || hash;
          const actual = await leerPorHash(objetivo);
          if (!actual && await guardarPorHash(objetivo, bytes)) blobs++;
        } catch (_) {}
      }

      return {
        encontrada: encontradasPerchas > 0 || encontradosBlobs > 0,
        encontradasPerchas,
        encontradosBlobs,
        perchas,
        blobs
      };
    } catch (err) {
      try { console.warn("[idb-fotos] G10b rescate raw localStorage pendiente:", err && err.message ? err.message : err); } catch (_) {}
      return { encontrada:false, encontradasPerchas:0, encontradosBlobs:0, perchas:0, blobs:0 };
    }
  }

  async function diagnosticoRecuperacion() {
    const porId = await leerTodas();
    const porHash = await leerTodosPorHash();
    return {
      at: _ultimoRescate.at || 0,
      current: {
        perchas: Object.keys(porId || {}).length,
        blobs: Object.keys(porHash || {}).length
      },
      dbPreAislamiento: Object.assign({}, _ultimoRescate.dbPreAislamiento),
      rawLocalStorage: Object.assign({}, _ultimoRescate.rawLocalStorage)
    };
  }

  // PRIME DIRECTIVE 1AAA: migración COPY-ONLY. Se copia el formato legacy a
  // IndexedDB, pero el original f123_foto_percha_* se conserva como segunda
  // evidencia. El escaneo se repite de forma idempotente por si aparece una
  // copia legacy después de una restauración/importación.
  async function migrarSiHaceFalta() {
    if (!SOPORTADO) return;
    // G10/G10b primero: rescatar ambas ventanas historicas en cada arranque.
    // Ambas son idempotentes y copy-only: no borran ni pisan una foto actual.
    const dbPre = await rescatarDbPreAislamiento();
    const rawLs = await rescatarLocalStoragePreAislamiento();
    _ultimoRescate = {
      at: Date.now(),
      dbPreAislamiento: dbPre || { encontrada:false, encontradasPerchas:0, encontradosBlobs:0, perchas:0, blobs:0 },
      rawLocalStorage: rawLs || { encontrada:false, encontradasPerchas:0, encontradosBlobs:0, perchas:0, blobs:0 }
    };
    try { localStorage.setItem("f123_fotos_recovery_diag_v1", JSON.stringify(_ultimoRescate)); } catch (_) {}
    const FLAG = "f123_fotos_migradas_idb_v1";
    try {
      const claves = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("f123_foto_percha_") === 0) claves.push(k);
      }
      let todoOk = true;
      for (const k of claves) {
        const id = k.slice("f123_foto_percha_".length);
        const dataUrl = localStorage.getItem(k);
        if (dataUrl) {
          /* COPY-ONLY de verdad: no pisar una foto IDB mas nueva con la sombra
             legacy que conservamos por seguridad. Primero blindamos esos bytes
             por hash; despues llenamos el slot por-id solo si esta vacio. */
          try { await guardarFotoContenido(dataUrl); } catch (_) {}
          const yaIdb = await leerFotoSoloIdb(id);
          if (!yaIdb) {
            const ok = await guardarFoto(id, dataUrl);
            if (!ok) todoOk = false;
          }
        }
      }
      if (todoOk) localStorage.setItem(FLAG, "copy-only");
    } catch (err) {
      console.error("[idb-fotos] migracion copy-only (se reintentara):", err);
    }
  }

  window.OCFotos = {
    guardarFoto, leerFoto, leerTodas, borrarFoto, migrarSiHaceFalta,
    rescatarDbPreAislamiento, rescatarLocalStoragePreAislamiento,
    blindarEvidencia, inventariarEvidencia, diagnosticoRecuperacion,
    soportado: () => SOPORTADO,
    // B1 (content-addressed): guardar/leer por hash + protocolo tengo/quiero.
    hashDeDataUrl, guardarPorHash, leerPorHash, tieneHash, hashesGuardados, leerTodosPorHash, guardarFotoContenido
  };
})();
