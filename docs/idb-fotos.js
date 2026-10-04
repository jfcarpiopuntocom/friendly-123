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
  /* PRIME DIRECTIVE 1AAA (JFC 2026-10-04): historial append-only de fotos por
     percha. Cambiar/renderizar/sincronizar una foto JAMAS destruye bytes previos. */
  const STORE_HISTORY = "history";
  const SOPORTADO = "indexedDB" in window;
  let dbPromise = null;

  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      // v3: agrega history APPEND-ONLY. Upgrade aditivo: nunca borra stores.
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
        if (!db.objectStoreNames.contains(STORE_HISTORY)) db.createObjectStore(STORE_HISTORY);
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
          else resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-fotos] leerTodosPorHash:", err);
      return {};
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
    if (!id || !dataUrl) return false;
    if (!SOPORTADO) {
      try {
        /* Fallback localStorage: COPY-ONLY. Nunca se elimina una version previa;
           el blob por hash queda como segunda copia direccionada por contenido. */
        localStorage.setItem(claveVieja(id), dataUrl);
        try { const h = await hashDeDataUrl(dataUrl); localStorage.setItem(claveBlob(h), dataUrl); } catch (_) {}
        return true;
      } catch (_) { return false; }
    }
    try {
      const db = await abrirDB();
      /* Antes de tocar el puntero "actual" por id, preserva ambas versiones en
         blobs + history. Si el proceso se corta, como minimo la copia anterior
         sigue en STORE hasta completar la transaccion siguiente. */
      let anterior = null;
      try {
        anterior = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch (_) {}
      const hNuevo = await hashDeDataUrl(dataUrl);
      const hAnterior = anterior ? await hashDeDataUrl(anterior).catch(() => null) : null;
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, STORE_BLOBS, STORE_HISTORY], "readwrite");
        const perchas = tx.objectStore(STORE);
        const blobs = tx.objectStore(STORE_BLOBS);
        const hist = tx.objectStore(STORE_HISTORY);
        if (hAnterior && anterior) {
          blobs.put(anterior, hAnterior);
          hist.put({ id: String(id), hash: hAnterior, dataUrl: anterior, preservadoEn: Date.now() }, String(id) + "::" + hAnterior);
        }
        blobs.put(dataUrl, hNuevo);
        hist.put({ id: String(id), hash: hNuevo, dataUrl: dataUrl, preservadoEn: Date.now() }, String(id) + "::" + hNuevo);
        perchas.put(dataUrl, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (err) {
      console.error("[idb-fotos] guardarFoto:", err);
      return false;
    }
  }

  async function leerFoto(id) {
    if (!SOPORTADO) {
      try { return localStorage.getItem(claveVieja(id)); }
      catch (_) { return null; }
    }
    try {
      const db = await abrirDB();
      const desdeIdb = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (desdeIdb) return desdeIdb;
      /* v448 GOLDEN G02: una migracion antigua pudo dejar la foto legacy en
         localStorage y aun asi marcar el flag. Nunca hagas invisible evidencia
         que todavia existe: si IDB no la tiene, lee la copia legacy. */
      return leerLegacyFoto(id);
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
            /* G02: mezcla no destructiva con el formato legacy. IDB gana si ya
               tiene esa percha; localStorage solo rescata ids que IDB no tiene. */
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

  async function borrarFoto(id) {
    /* PRIME DIRECTIVE 1AAA: nombre legado conservado por compatibilidad, pero
       desde G02 esta funcion es NO-DESTRUCTIVA. Un render, sync, fix o incluso
       borrar una percha no tiene permiso para destruir evidencia fotografica.
       Una futura purga irreversible debera ser una accion humana separada y
       explicitamente confirmada; hoy NO existe. */
    try {
      const actual = await leerFoto(id);
      if (actual) {
        const h = await hashDeDataUrl(actual).catch(() => null);
        if (h) {
          await guardarPorHash(h, actual);
          if (SOPORTADO) {
            const db = await abrirDB();
            await new Promise((resolve, reject) => {
              const tx = db.transaction(STORE_HISTORY, "readwrite");
              tx.objectStore(STORE_HISTORY).put(
                { id: String(id), hash: h, dataUrl: actual, preservadoEn: Date.now(), motivo: "borrarFoto-interceptado" },
                String(id) + "::" + h
              );
              tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
          }
        }
      }
    } catch (err) {
      console.error("[idb-fotos] preservar antes de borrar:", err);
    }
    return { preservada: true, borrada: false };
  }

  // PRIME DIRECTIVE 1AAA: migracion COPY-ONLY. Copia fotos legacy a IndexedDB
  // y JAMAS elimina la fuente de localStorage. La redundancia es deliberada.
  async function migrarSiHaceFalta() {
    if (!SOPORTADO) return;
    const FLAG = "f123_fotos_migradas_idb_v2_copyonly";
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
          const ok = await guardarFoto(id, dataUrl);
          if (!ok) todoOk = false;
        }
      }
      if (todoOk) localStorage.setItem(FLAG, "1");
      else localStorage.removeItem(FLAG); // reintenta en la proxima carga
    } catch (err) {
      console.error("[idb-fotos] migracion (se reintentara en el proximo load):", err);
    }
  }

  async function leerHistorialPorPercha() {
    const out = {};
    if (!SOPORTADO) return out;
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HISTORY, "readonly");
        const req = tx.objectStore(STORE_HISTORY).openCursor();
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) return resolve(out);
          const v = cur.value || {};
          if (v.id && v.dataUrl) {
            if (!out[v.id]) out[v.id] = [];
            out[v.id].push({ hash: v.hash || "", dataUrl: v.dataUrl, preservadoEn: Number(v.preservadoEn) || 0, motivo: v.motivo || "" });
          }
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-fotos] leerHistorialPorPercha:", err);
      return out;
    }
  }

  async function inventarioForense() {
    const perId = await leerTodas();
    const blobs = await leerTodosPorHash();
    const historial = await leerHistorialPorPercha();
    return { perId, blobs, historial, legacy: leerLegacyTodas() };
  }

  window.OCFotos = {
    guardarFoto, leerFoto, leerTodas, borrarFoto, migrarSiHaceFalta, soportado: () => SOPORTADO,
    // B1 (content-addressed): guardar/leer por hash + protocolo tengo/quiero.
    hashDeDataUrl, guardarPorHash, leerPorHash, tieneHash, hashesGuardados, leerTodosPorHash, guardarFotoContenido,
    // Prime Directive 1AAA: diagnostico/recuperacion local, siempre read/add-only.
    leerHistorialPorPercha, inventarioForense
  };
})();
