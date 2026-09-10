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
  // Guarda una foto por su hash y DEVUELVE el hash — atajo para quien captura.
  async function guardarFotoContenido(dataUrl) {
    const hash = await hashDeDataUrl(dataUrl);
    await guardarPorHash(hash, dataUrl);
    return hash;
  }

  // Clave localStorage que usaba el formato viejo (antes de esta migracion) —
  // se mantiene aqui SOLO como fallback si IndexedDB no esta disponible.
  const claveVieja = (id) => "f123_foto_percha_" + id;

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

  async function leerFoto(id) {
    if (!SOPORTADO) {
      try { return localStorage.getItem(claveVieja(id)); }
      catch (_) { return null; }
    }
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-fotos] leerFoto:", err);
      return null;
    }
  }

  // Lee TODAS las fotos guardadas de una vez — usado por vista-perchas.js para
  // precargar el cache en memoria antes de pintar el grid (evita N lecturas
  // async individuales, una por tarjeta).
  async function leerTodas() {
    if (!SOPORTADO) {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("f123_foto_percha_") === 0) out[k.slice("f123_foto_percha_".length)] = localStorage.getItem(k);
        }
      } catch (_) {}
      return out;
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
          else resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-fotos] leerTodas:", err);
      return {};
    }
  }

  async function borrarFoto(id) {
    if (!SOPORTADO) {
      try { localStorage.removeItem(claveVieja(id)); } catch (_) {}
      return;
    }
    try {
      const db = await abrirDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error("[idb-fotos] borrarFoto:", err);
    }
  }

  // Migracion silenciosa y de una sola vez: copia fotos ya guardadas en el
  // formato viejo (localStorage, f123_foto_percha_*) a IndexedDB y las borra
  // de localStorage. No pierde nada — si algo falla a medio camino, el flag
  // NO se marca y se reintenta en el proximo load (las fotos ya migradas se
  // sobrescriben con el mismo valor, sin duplicar ni corromper).
  async function migrarSiHaceFalta() {
    if (!SOPORTADO) return;
    const FLAG = "f123_fotos_migradas_idb_v1";
    if (localStorage.getItem(FLAG)) return;
    try {
      const claves = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("f123_foto_percha_") === 0) claves.push(k);
      }
      for (const k of claves) {
        const id = k.slice("f123_foto_percha_".length);
        const dataUrl = localStorage.getItem(k);
        if (dataUrl) {
          const ok = await guardarFoto(id, dataUrl);
          if (ok) localStorage.removeItem(k);
        }
      }
      localStorage.setItem(FLAG, "1");
    } catch (err) {
      console.error("[idb-fotos] migracion (se reintentara en el proximo load):", err);
    }
  }

  window.OCFotos = {
    guardarFoto, leerFoto, leerTodas, borrarFoto, migrarSiHaceFalta, soportado: () => SOPORTADO,
    // B1 (content-addressed): guardar/leer por hash + protocolo tengo/quiero.
    hashDeDataUrl, guardarPorHash, leerPorHash, tieneHash, hashesGuardados, guardarFotoContenido
  };
})();
