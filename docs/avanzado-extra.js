// avanzado-extra.js — Reestructura la vista "Avanzado" del dueño en dos capas:
//   1) Gestión (gastos, correo de recuperación, claves) — visible al dueño.
//   2) Contable (cuentas T, P&G, balance, valorizado) — detrás de la SUBCLAVE.
// Depende de window.OCAuth (auth-ui.js).
(function () {
  // FIX preventivo 2026-07-07: escHtml vive en index.html; si algun dia
  // cambia el orden de los <script>, todo Avanzado moriria con
  // ReferenceError. Fallback local identico, cero dependencia de orden.
  const escHtml = window.escHtml || ((s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  function $(id) { return document.getElementById(id); }
  const API = "/api";
  let desbloqueadaSesion = false;

  function ubic() { const s = $("selectUbicacion"); return s ? s.value : "todas"; }
  // 2026-08-19, aprobado JFC: money() localizado. Antes "$1234.56" siempre;
  // ahora "$1,234.56" en EN y "$ 1.234,56" en ES (o lo que el navegador use
  // para es-US). Cae al formato viejo si Intl no esta o el locale no existe.
  const money = (n) => {
    const v = Number(n || 0);
    /* JFC 2026-08-28 (microbug): un valor no-finito (NaN/Infinity) mostraba
       "$NaN" en la UI. Se cae a $0.00 en vez de pintar basura. */
    if (!isFinite(v)) return "$0.00";
    try {
      const loc = (window.OCI18n && window.OCI18n.locale && window.OCI18n.locale()) || "en-US";
      return new Intl.NumberFormat(loc, { style: "currency", currency: "USD" }).format(v);
    } catch (_) { return "$" + v.toFixed(2); }
  };
  // Distingue "primer registro libre de correo" de "re-registro tras código
  // maestro" (SÍ debe encadenar directo a poner un PIN nuevo). Ver mismo
  // patrón en Olimpo Control.
  let reasignacionViaMaestro = false;

  // ===========================================================================
  // SINCRONIZACIÓN ENTRE DISPOSITIVOS (lazy sync, JFC 2026-07-04)
  // ---------------------------------------------------------------------------
  // Modelo "relay ciego" al estilo nostr: cada dispositivo lleva un LOG DE
  // OPERACIONES (no una foto del negocio) — toda escritura (POST/PUT/PATCH/
  // DELETE a /api/*) que YA se aplicó con éxito en este dispositivo queda
  // anotada con quién (deviceId), cuándo (ts) y qué (método+url+body). Ese
  // log se cifra con AES-256-GCM (crypto-store.js, llave derivada del PIN del
  // dueño) y sale por dos caminos, ninguno obligatorio:
  //   1) Automático — POST /api/sync/push y GET /api/sync/pull, si el backend
  //      tiene esas rutas (relay ciego: solo guarda y reenvía bytes, nunca los
  //      descifra). Si no existen, falla en silencio: el negocio sigue 100%
  //      funcional en modo local.
  //   2) Manual — botón "Copiar cambios" / "Pegar cambios". Cero servidor,
  //      cero mantenimiento, sirve por WhatsApp o cualquier medio.
  // En ambos casos, al recibir el log de otro dispositivo, sus operaciones se
  // REPRODUCEN contra el backend local (fetch real, en orden cronológico) —
  // así "lo más reciente manda" a nivel de cada operación, no de un documento
  // completo.
  //
  // LIMITACIÓN HONESTA — léela antes de operar con 2+ dispositivos a la vez:
  // reproducir un POST que CREA un registro (ej. una venta) dos veces —porque
  // llegó por los dos caminos, o porque se pegó el mismo paquete manual dos
  // veces— puede duplicarlo. Este archivo no puede saber por sí solo si tu
  // backend es idempotente. Se mitiga marcando la última operación ya
  // aplicada POR DISPOSITIVO (oc_sync_last) para no reproducir el mismo log
  // dos veces, y cada operación lleva un id propio por si más adelante quieres
  // que el servidor real valide duplicados con la cabecera X-Sync-Op-Id. Sin
  // esa validación del lado del servidor, esto es "suficientemente bueno" para
  // un par de dispositivos que casi nunca escriben en el mismo minuto exacto —
  // no es una garantía matemática de cero duplicados.
  // ===========================================================================
  const OCSync = (function () {
    const MET_ESCRITURA = ["POST", "PUT", "PATCH", "DELETE"];
    const RUTAS_EXCLUIDAS = ["/api/sync", "/api/respaldo"]; // el propio sync, y el respaldo completo (muy pesado para ir en el log)
    const fetchOriginal = window.fetch.bind(window);
    let cola = [];             // operaciones pendientes de enviar, en memoria
    let temporizador = null;
    let syncOn = localStorage.getItem("f123_sync_on") === "1";

    function deviceId() {
      let id = localStorage.getItem("f123_device_id");
      if (!id) { id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); localStorage.setItem("f123_device_id", id); }
      return id;
    }
    function opId() { return deviceId() + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }
    function urlDe(input) { return typeof input === "string" ? input : (input && input.url) || ""; }

    // Intercepta fetch UNA sola vez para todo el sitio — no hace falta tocar
    // cada botón de index.html. Solo ANOTA; nunca bloquea ni retrasa la
    // petición real, que sigue su camino normal contra el backend local.
    if (!window.__ocSyncPatched) {
      window.__ocSyncPatched = true;
      window.fetch = async function (input, init) {
        const res = await fetchOriginal(input, init);
        try {
          if (syncOn && res.ok) {
            const url = urlDe(input);
            const method = ((init && init.method) || "GET").toUpperCase();
            const excluida = RUTAS_EXCLUIDAS.some((r) => url.indexOf(r) !== -1);
            if (url.indexOf("/api/") !== -1 && !excluida && MET_ESCRITURA.includes(method)) {
              cola.push({ id: opId(), ts: Date.now(), dev: deviceId(), method, url, body: (init && init.body) || null });
              await guardarColaCifrada();
            }
          }
        } catch (_) { /* nunca romper la petición real por un fallo de logging */ }
        return res;
      };
    }

    async function guardarColaCifrada() {
      if (!window.OCSecure.syncActiva()) return;
      const blob = await window.OCSecure.cifrarSync(JSON.stringify(cola));
      if (blob) {
        /* M4 (2026-08-27, auditoría): verificar que la cola se persistió. Antes
           se ignoraba el retorno de OCOutbox.guardar()/localStorage.setItem: si
           el storage estaba lleno, la cola de cambios offline se perdía en
           silencio. Ahora, si no se pudo persistir, se avisa (evento + console)
           para que una venta offline no desaparezca sin que nadie lo note. */
        let ok = false;
        if (window.OCOutbox) ok = await window.OCOutbox.guardar(blob);
        else { try { localStorage.setItem("f123_sync_pending", blob); ok = true; } catch (_) { ok = false; } }
        if (!ok) {
          try { console.warn("[sync] no se pudo persistir la cola de cambios (" + cola.length + " pendientes) — storage lleno?"); } catch (_) {}
          try { window.dispatchEvent(new CustomEvent("oc-sync-cola-perdida", { detail: { n: cola.length } })); } catch (_) {}
        }
      }
    }
    async function restaurarCola() {
      if (!window.OCSecure.syncActiva()) return;
      const blob = window.OCOutbox ? await window.OCOutbox.leer() : localStorage.getItem("f123_sync_pending");
      if (!blob) return;
      const texto = await window.OCSecure.descifrarSync(blob);
      if (texto) { try { cola = JSON.parse(texto) || []; } catch { cola = []; } }
    }

    // Ledger de op.id ya aplicados (no solo "último ts por dispositivo"):
    // dos operaciones con timestamps iguales o paquetes parciales/reenviados
    // ya no se saltan ni se duplican, porque el ledger es por id exacto.
    function idsAplicados() {
      try { return new Set(JSON.parse(localStorage.getItem("f123_sync_ids_aplicados") || "[]")); } catch { return new Set(); }
    }
    function guardarIdsAplicados(set) {
      localStorage.setItem("f123_sync_ids_aplicados", JSON.stringify(Array.from(set).slice(-3000)));
    }

    // Reproduce las operaciones de OTROS dispositivos contra el backend
    // local, en orden cronológico, saltando lo ya aplicado (por id, no por
    // fecha). Si una operación falla, se DETIENE ese dispositivo ahí (no
    // sigue con las siguientes) para no dejar el inventario en un estado a
    // medias — las que quedaron pendientes se reintentan en la próxima
    // sincronización, en el mismo orden.
    async function reproducir(ops) {
      const aplicados = idsAplicados();
      /* A1 (2026-08-27, auditoría): unificar el dedup con el relay. El lazy sync
         deduplica por op.id (f123_sync_ids_aplicados) y el relay por op.opId
         (f123_sync_ops_aplicadas). Si un mismo cambio viaja por ambos motores,
         se aplicaba dos veces (doble conteo de stock). Ahora reproducir():
         1) salta ops cuyo opId ya aplicó el relay (mismo ledger compartido), y
         2) registra en el ledger del relay las ops que aplica aquí, para que el
         relay no las re-aplique. Así ambos motores comparten un único dedup. */
      const relayAplicados = (function () {
        try { return new Set(JSON.parse(localStorage.getItem("f123_sync_ops_aplicadas") || "[]")); } catch (_) { return new Set(); }
      })();
      const porDispositivo = {};
      ops.forEach((op) => {
        if (op.dev === deviceId()) return;
        if (op.id && aplicados.has(op.id)) return;
        if (op.opId && relayAplicados.has(op.opId)) return; // ya lo aplicó el relay
        (porDispositivo[op.dev] = porDispositivo[op.dev] || []).push(op);
      });
      for (const dev in porDispositivo) {
        const pendientes = porDispositivo[dev].sort((a, b) => a.ts - b.ts);
        for (const op of pendientes) {
          // Nunca reproducir contra otra cosa que no sea nuestra propia API —
          // un paquete manipulado o corrupto no debe poder hacer fetch a
          // cualquier URL arbitraria.
          if (typeof op.url !== "string" || op.url.indexOf("/api/") !== 0) break;
          /* M2 (2026-08-27, auditoría): normalizar el body antes de reproducir.
             El interceptor guarda el body tal cual; si era un objeto JS (no
             string) o un FormData, al cifrar la cola (JSON.stringify) se
             corrompe. Antes se reenviaba ese body corrupto y el backend local
             lo degradaba a {} (mock-backend.js:2200) → la op se aplicaba mal.
             Ahora: si es objeto, se stringifica; si es string no-JSON, se
             salta la op (break) en vez de corromper el estado. */
          let body = op.body;
          if (body !== null && body !== undefined && typeof body !== "string") {
            try { body = JSON.stringify(body); } catch (_) { break; }
          }
          if (body !== null && body !== undefined && typeof body === "string") {
            try { JSON.parse(body); } catch (_) { break; } // body no-JSON corrupto: no reproducir
          }
          try {
            await fetchOriginal(op.url, { method: op.method, headers: { "Content-Type": "application/json" }, body });
            aplicados.add(op.id);
            /* A1: registrar en el ledger del relay para que no re-aplique. */
            if (op.opId) relayAplicados.add(op.opId);
          } catch (_) { break; /* se detiene aquí: preserva el orden para el próximo intento */ }
        }
      }
      guardarIdsAplicados(aplicados);
      /* A1: persistir el ledger compartido del relay. */
      try { localStorage.setItem("f123_sync_ops_aplicadas", JSON.stringify(Array.from(relayAplicados).slice(-2000))); } catch (_) {}
    }

    async function activar(pin) {
      const ok = await window.OCSecure.activarSync(pin);
      if (!ok) return false;
      syncOn = true;
      localStorage.setItem("f123_sync_on", "1");
      await restaurarCola();
      arrancarIntervalo();
      return true;
    }
    function desactivar() {
      syncOn = false;
      localStorage.removeItem("f123_sync_on");
      window.OCSecure.desactivarSync();
      if (temporizador) clearInterval(temporizador);
    }
    function activa() { return syncOn; }
    function requiereReactivar() { return syncOn && !window.OCSecure.syncActiva(); }
    function pendientes() { return cola.length; }

    // ---- Automático (si el backend tiene /api/sync/push y /api/sync/pull) ----
    async function push() {
      if (!syncOn || !window.OCSecure.syncActiva() || !cola.length) return { ok: true, enviado: 0 };
      // Snapshot por cantidad (no por referencia): si mientras esperamos la
      // respuesta del servidor se agregan operaciones nuevas (venta hecha en
      // paralelo), NO deben perderse al limpiar la cola después.
      const n = cola.length;
      const paraEnviar = cola.slice(0, n);
      const blob = await window.OCSecure.cifrarSync(JSON.stringify(paraEnviar));
      try {
        const res = await fetchOriginal(`${API}/sync/push`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: deviceId(), blob }) });
        if (!res.ok) return { ok: false, motivo: "Your sync server rejected the upload." };
        cola = cola.slice(n);
        await guardarColaCifrada();
        return { ok: true, enviado: n };
      } catch (_) { return { ok: false, motivo: "No connection to your sync server (did you add the /api/sync routes?)." }; }
    }
    async function pull() {
      if (!syncOn || !window.OCSecure.syncActiva()) return { ok: true, recibido: 0 };
      try {
        const res = await fetchOriginal(`${API}/sync/pull?device=${encodeURIComponent(deviceId())}`, { method: "GET" });
        if (!res.ok) return { ok: false, motivo: "Your sync server rejected the query." };
        const paquetes = (await res.json()) || []; // [{device, blob}, ...] de otros dispositivos
        let recibido = 0;
        for (const p of paquetes) {
          if (p.device === deviceId()) continue;
          const texto = await window.OCSecure.descifrarSync(p.blob);
          if (!texto) continue;
          let ops = []; try { ops = JSON.parse(texto); } catch (_) {}
          if (ops.length) { await reproducir(ops); recibido += ops.length; }
        }
        return { ok: true, recibido };
      } catch (_) { return { ok: false, motivo: "No connection to your sync server." }; }
    }
    let onlineListenerListo = false;
    /* A2 (2026-08-27, auditoría): el push/pull automático apunta a
       /api/sync/push|pull que el backend local NO implementa (mock-backend.js
       devuelve 404). Antes el intervalo (cada 4 min) y el listener "online"
       intentaban push/pull en silencio — trabajo inútil y falsa sensación de
       redundancia. Ahora se comprueba UNA vez si el servidor de sync existe; si
       no, el automático se salta (el botón manual "Auto sync" sigue intentando
       y mostrando el motivo). El relay WebSocket (licencia) es el camino
       principal; este lazy sync es un respaldo manual (copiar/pegar). */
    let _syncServerDisponible = null; // null = sin comprobar, true/false = resultado cacheado
    async function _comprobarSyncServer() {
      if (_syncServerDisponible !== null) return _syncServerDisponible;
      try {
        const res = await fetchOriginal(`${API}/sync/pull?device=probe`, { method: "GET" });
        _syncServerDisponible = res.ok;
      } catch (_) { _syncServerDisponible = false; }
      return _syncServerDisponible;
    }
    function arrancarIntervalo() {
      if (temporizador) clearInterval(temporizador);
      temporizador = setInterval(() => {
        if (window.OCAuth && !window.OCAuth.rolActual()) return;
        _comprobarSyncServer().then((disp) => { if (disp) push().then(pull); });
      }, 4 * 60 * 1000); // sin sesion no hay trabajo
      if (!onlineListenerListo) {
        onlineListenerListo = true;
        window.addEventListener("online", () => { if (syncOn) _comprobarSyncServer().then((disp) => { if (disp) push().then(pull); }); });
      }
    }

    // ---- Manual (copiar/pegar, sin servidor) ----
    // NO vacía la cola: si el dueño copia el texto pero no llega a pegarlo en
    // el otro dispositivo (se cerró WhatsApp, se distrajo), esas operaciones
    // NO deben perderse — siguen disponibles para el próximo "Copiar" o para
    // el envío automático por servidor. El receptor deduplica por op.id, así
    // que compartir de más nunca duplica nada del lado de quien recibe.
    async function generarPaqueteManual() {
      if (!cola.length) return null;
      const blob = await window.OCSecure.cifrarSync(JSON.stringify(cola));
      const paquete = { v: 1, device: deviceId(), blob };
      return "OCSYNC1:" + btoa(unescape(encodeURIComponent(JSON.stringify(paquete))));
    }
    const MANUAL_MAX_BYTES = 2 * 1024 * 1024; // 2MB: un paquete manual razonable jamás debería pesar más
    async function importarPaqueteManual(texto) {
      texto = (texto || "").trim();
      if (texto.indexOf("OCSYNC1:") !== 0) return { ok: false, motivo: "This text is not a valid sync package." };
      if (texto.length > MANUAL_MAX_BYTES) return { ok: false, motivo: "This package is too large to be valid." };
      let paquete;
      try { paquete = JSON.parse(decodeURIComponent(escape(atob(texto.slice(8))))); } catch (_) { return { ok: false, motivo: "The package is corrupted or incomplete." }; }
      if (!paquete || paquete.v !== 1 || typeof paquete.blob !== "string" || typeof paquete.device !== "string") return { ok: false, motivo: "The package does not have the expected format." };
      if (paquete.device === deviceId()) return { ok: false, motivo: "This package is from this same device." };
      const texto2 = await window.OCSecure.descifrarSync(paquete.blob);
      if (!texto2) return { ok: false, motivo: "Could not decrypt (is this from the same business, with the same owner PIN activated here?)." };
      let ops = []; try { ops = JSON.parse(texto2); } catch (_) {}
      if (!Array.isArray(ops)) return { ok: false, motivo: "The package content is not a valid list of operations." };
      if (!ops.length) return { ok: true, recibido: 0 };
      await reproducir(ops);
      return { ok: true, recibido: ops.length };
    }

    if (syncOn) restaurarCola();

    return { activar, desactivar, activa, requiereReactivar, pendientes, push, pull, generarPaqueteManual, importarPaqueteManual, deviceId };
  })();

  function init() {
    const vista = $("vista-avanzado");
    if (!vista || vista.dataset.ocReady) return;
    vista.dataset.ocReady = "1";

    // --- Mover los bloques contables a un contenedor cerrable ---
    const cont = document.createElement("div");
    cont.id = "oc-contable";
    cont.style.display = "none";
    // T-accounts arriba
    const tboxes = document.createElement("div");
    tboxes.id = "oc-taccounts";
    tboxes.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:6px 0 22px;";
    cont.appendChild(tboxes);

    // Gráfico comparativo por ubicación (brote 3): ventas, margen,
    // cumplimiento de meta y comisión efectiva pagada — una barra por
    // ubicación, en divs puros con CSS (sin librerías de gráficos).
    const chartBox = document.createElement("div");
    chartBox.className = "tag-card";
    chartBox.style.cssText = "margin-bottom:22px;text-align:left;";
    chartBox.innerHTML = `<h3 class="seccion" style="margin-top:0;">${window.t("adv.locComparison")}</h3><div id="oc-chart"></div>`;
    cont.appendChild(chartBox);

    // Mover PL / balance / valorizado (h3 + tabla-wrap + su Back to top) al contenedor
    const marcadores = ["tablaPL", "tablaBalance", "tablaValorizado"];
    marcadores.forEach((idTabla) => {
      const tabla = $(idTabla);
      if (!tabla) return;
      const wrap = tabla.closest(".tabla-wrap");
      const h3 = wrap && wrap.previousElementSibling;
      if (h3 && h3.tagName === "H3") cont.appendChild(h3);
      if (wrap) cont.appendChild(wrap);
      const nxt = wrap && wrap.nextElementSibling;
      if (nxt && nxt.querySelector && nxt.querySelector('[data-i18n="adv.backToTop"]')) {
        cont.appendChild(nxt);
      }
    });

    // --- Descarga formal para el contador (JFC, 2026-07-01) ---
    // CSV (no JSON) porque un contador real lo abre en Excel/Sheets, no en un
    // editor de código. Incluye el desglose de IVA que pidió JFC. A propósito
    // NO se presenta como una declaración válida ante el SRI — es un insumo
    // limpio para que el contador humano haga su trabajo, la responsabilidad
    // de declarar sigue siendo de él.
    const descargaBox = document.createElement("div");
    descargaBox.className = "tag-card";
    descargaBox.style.cssText = "text-align:left;margin-top:22px;";
    descargaBox.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Accounting report</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">P&amp;L, balance sheet, and valued inventory in one file, ready for Excel. Not a tax declaration — it's the input your accountant needs.</p>
      <button id="oc-descargar-csv" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Download accounting report (.csv)</button>
    `;
    cont.appendChild(descargaBox);

    // --- Respaldo exportable/importable (tronco 3, JFC 2026-07-01) ---
    // Vive DENTRO de "cont" (detrás de la subclave contable): exportar/
    // importar el negocio completo es una acción sensible, no debe estar al
    // alcance de un encargado ni de cualquiera que abra Avanzado.
    const respaldo = document.createElement("div");
    respaldo.className = "tag-card";
    respaldo.style.cssText = "text-align:left;margin-top:22px;";
    respaldo.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Backup</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Download your full business data (products, sales, movements, costs, keys, and shelf photos) in one file. Save it to your email, Drive, or anywhere — it's your backup if the cache is cleared or the device fails.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="oc-exportar" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">⬇️ Export backup</button>
        <label class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);display:inline-flex;align-items:center;cursor:pointer;">⬆️ Import backup
          <input id="oc-importar-file" type="file" accept=".json" style="display:none;">
        </label>
      </div>
      <p id="oc-respaldo-msg" style="font-size:14px;margin-top:10px;font-weight:700;"></p>
      <p id="oc-respaldo-free" style="font-size:13px;margin-top:6px;display:none;"></p>
      <hr style="border:none;border-top:1px solid var(--azul-suave,#dde5ec);margin:16px 0;">
      <h4 style="margin:0 0 6px;font-size:14px;">Local safe (automatic)</h4>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">
        In addition to the manual backup above, friendly-123 saves a snapshot of your data here (in this browser) periodically,
        in case you delete something by accident. This does NOT replace the manual backup — if the browser cache is cleared, these checkpoints are lost too.
        <em>Coming soon: automatic replication of these checkpoints across your devices. In the meantime, you can copy your data to another device via Advanced → QR Sync.</em></p>
      <p id="oc-caja-alerta" style="font-size:13px;font-weight:700;"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="oc-caja-guardar" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">⟳ Save checkpoint now</button>
        <button id="oc-caja-ver" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">View saved checkpoints</button>
      </div>
      <div id="oc-caja-lista" style="display:none;margin-top:10px;"></div>
      <p id="oc-storage-info" style="font-size:13px;color:var(--ink-soft);margin:10px 0 0;font-family:monospace;"></p>
    `;
    cont.appendChild(respaldo);

    // Mostrar usage/quota en el panel de checkpoints — util para diagnostico remoto
    // (JFC puede pedir screenshot de esta linea para saber si el problema es espacio).
    (async () => {
      try {
        if (!navigator.storage || !navigator.storage.estimate) return;
        const { usage, quota } = await navigator.storage.estimate();
        const el = document.getElementById("oc-storage-info");
        if (!el || !quota) return;
        const mb = n => (n / 1048576).toFixed(1) + " MB";
        el.textContent = "Storage: " + mb(usage) + " used / " + mb(quota) + " quota ("
          + Math.round((usage / quota) * 100) + "%)";
      } catch (_) {}
    })();

    // --- Candado ---
    const lock = document.createElement("div");
    lock.id = "oc-acct-lock";
    lock.className = "tag-card";
    lock.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><button id="oc-acct-open">View accounting layer</button><button id="oc-sync-tablero" class="ir" style="background:#0F1923;border-color:#0F1923;color:#FFFFFF;">Open my control board</button></div>`;
    // Boton al inicio, justo bajo el blurb de "Modo avanzado" (JFC 2026-07-04:
    // "no moviste el boton mismo de 'ver capa contable' al inicio, animal").
    const aviso = vista.querySelector(".avanzado-aviso");
    if (aviso) aviso.insertAdjacentElement("afterend", lock);
    else vista.appendChild(lock);
    vista.appendChild(cont);

    // --- Automatic backup scheduler (JFC 2026-07-21) ---
    // Mounted on vista directly (NOT inside cont) so the owner can configure
    // their backup without needing to unlock the accounting layer first.
    const bkMount = document.createElement("div");
    bkMount.id = "f123-backup-scheduler-mount";
    vista.appendChild(bkMount);
    if (window.OCBackupScheduler) window.OCBackupScheduler.montar(bkMount);

    // === MY WORK RECORD (JFC 2026-07-28, point 13) ==========================
    // The owner's backup protects the BUSINESS; this one protects the PERSON
    // at the counter. montar() limits itself to the employee role, so there is
    // no need to filter here. See docs/respaldo-empleado.js: costs do NOT
    // travel in that package, and that boundary is deliberate.
    const reMount = document.createElement("div");
    reMount.id = "oc-respaldo-empleado-mount";
    vista.appendChild(reMount);
    if (window.OCRespaldoEmpleado) window.OCRespaldoEmpleado.montar(reMount);

    // === RESTORE POINTS (mycelium phase B) =================================
    // The div is built here in JS rather than in index.html: friendly-123 has
    // no accounting section like AMIGABLE, so there is no equivalent HTML
    // anchor to hang it from.
    const recMount = document.createElement("div");
    recMount.id = "oc-reconciliacion-mount";
    vista.appendChild(recMount);
    if (window.AMG && window.AMG.Reconciliacion) window.AMG.Reconciliacion.montarPanel(recMount);

    // === ACCOUNTING EDUTIP =================================================
    // Blue box at the foot. Color rule: blue lives ONLY here, never as a state
    // color on inventory cards (there the Simon color language rules).
    const edMount = document.createElement("div");
    edMount.id = "oc-edutip-contable";
    edMount.className = "tag-card";
    edMount.style.cssText = "text-align:left;border-left:5px solid var(--sim-azul,#2E6278);margin-top:26px;";
    vista.appendChild(edMount);
    if (window.OCEdutips) window.OCEdutips.montar();

    /* TABLERO DE CONTROL (portado de amigable-123, 2026-08-18).
       Solo dueno y admin. El boton oculto NO es la seguridad: la seguridad es
       que el tablero exige la licencia Y el PIN, que un encargado no tiene.
       Son dos capas independientes, como el resto de la app. */
    (function () {
      try {
        var b = document.getElementById("oc-sync-tablero");
        if (!b) return;
        var rol = (window.OCAuth && window.OCAuth.rolActual) ? window.OCAuth.rolActual() : "";
        if (rol !== "dueno" && rol !== "admin") { b.style.display = "none"; return; }
        b.addEventListener("click", function () {
          /* La licencia viaja en el hash para no reteclearla en el telefono.
             tablero.html la limpia de la barra apenas la lee. */
          var cod = "";
          try { cod = (JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).licenseCode || ""; } catch (_) {}
          var url = "./tablero.html" + (/^F123-/i.test(cod) ? "#c=" + encodeURIComponent(cod) : "");
          window.open(url, "_blank");
        });
      } catch (_) {}
    })();
    $("oc-acct-open").addEventListener("click", async () => {
      if (!desbloqueadaSesion) {
        const ok = await window.OCAuth.pedirSubclaveContable();
        if (!ok) return;
        desbloqueadaSesion = true;
      }
      lock.style.display = "none";
      cont.style.display = "block";
      await render();
    });

    // --- Panel de gestión (correo recuperación + claves) ---
    const gestion = document.createElement("div");
    gestion.className = "panel-escaner tag-card";
    gestion.style.cssText = "text-align:left;margin-top:22px;";
    gestion.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">${window.t("auth.act.accessRecoveryTitle")}</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">${window.t("auth.act.ownerEmailIntro")}</p>
      <div id="oc-email-row"></div>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:18px;">${window.t("auth.act.whatsappLabel")} — ${window.t("auth.act.whatsappHint")}</p>
      <div id="oc-whatsapp-row"></div>
      <div id="oc-clave-block" style="margin-top:18px;">
        <p style="font-size:14px;color:var(--ink-soft);">PINs identify who does what (owner / staff / accounting). Not your business's security — your license is that.</p>
      </div>
      <!-- PINs VISIBLES + APODO DEL DISPOSITIVO (JFC 2026-08-27). JFC (master
           admin / soporte) necesita VER los PINs actuales y el apodo del
           dispositivo, sin opacarlos, para controlar sus estructuras y equipo.
           Los PINs se leen de las copias XOR (leerPinsVisibles); si el PIN se
           fijó antes de este cambio, no hay copia y se avisa. El apodo usa
           OCMicelio (ya se sincroniza con el equipo). -->
      <div id="oc-pins-visibles" style="margin-top:18px;padding:12px;border:1px solid var(--hairline,#dde5ec);border-radius:8px;background:var(--paper-deep,#E2E8ED);">
        <p style="font-size:14px;font-weight:700;color:var(--ink);margin:0 0 8px;">Current access codes (visible to you, the owner)</p>
        <div id="oc-pins-visibles-cuerpo" style="font-size:14px;line-height:1.7;color:var(--ink);"></div>
        <p style="font-size:13px;color:var(--ink-soft);margin:8px 0 0;">PINs are stored as hashes; the visible copy is only for your support. Codes set before this update can't be shown — re-save them above to make them visible.</p>
        <p style="font-size:13px;color:var(--ink-soft);margin:6px 0 0;">PINs only identify a role in the activity log (who did what). They are not the security of your business — your license is. Anyone with the license can open the notebook.</p>
        <p id="oc-codes-msg" style="font-size:14px;margin-top:8px;"></p>
      </div>
      <div id="oc-apodo-device" style="margin-top:12px;font-size:14px;color:var(--ink);">
        <span id="oc-apodo-device-txt"></span>
        <button type="button" id="oc-apodo-device-btn" data-i18n-attr="title:device.name,aria-label:device.name" title="Name this device" style="background:none;border:none;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;cursor:pointer;font-size:15px;padding:0 2px;">✎</button>
      </div>`;
    vista.appendChild(gestion);
    // i18n (2026-09-01): el motor solo traduce con applyStatic; esta vista se
    // inyecta después del load, así que se re-aplica sobre el scope inyectado
    // para que title/aria-label (data-i18n-attr) del apodo salgan traducidos.
    try { if (window.OCI18n && window.OCI18n.applyStatic) window.OCI18n.applyStatic(gestion); } catch (_) {}

    // === SINCRONIZAR EQUIPO (tiempo real, homologado de AMIGABLE, 2026-07-23) ==
    // Solo dueño. Si nunca hay codigo de sync, la app funciona exactamente igual
    // que siempre (solo local) - este panel es 100% opcional, cero dependencia.
    // Sync corre 24/7 desde que se activa (automatico al licenciarse) - este
    // panel es de ESTADO, no de switch on/off manual del flujo normal.
    (function () {
      if (!window.OCSyncControl) return;
      const panel = document.createElement("div");
      panel.className = "tag-card";
      panel.id = "oc-sync-panel";
      panel.style.cssText = "text-align:left;margin-top:22px;";
      /* LICENCIA != CODIGO DE SALA (JFC 2026-08-19).
         El codigo de sala se DERIVA de la licencia del negocio, pero no es lo
         mismo: la licencia identifica al negocio para siempre; la sala es la
         llave de cuarto con la que los telefonos del equipo se hablan. Aqui se
         muestra la sala, asi que una sala de OTRA app (AMG-, las tres apps
         comparten origen en Pages) se leia como si fuera la licencia propia.
         Se filtra: si no empieza con F123-, se trata como si no hubiera sala. */
      const _salaCruda = window.OCSyncControl.salaActiva();
      const salaActiva = /^F123-/i.test(String(_salaCruda || "")) ? _salaCruda : "";
      if (_salaCruda && !salaActiva) {
        try { console.warn("[sync] sala de otra app, se ignora:", _salaCruda); } catch (_) {}
      }
      const codigoPrecargado = (function () {
        try { return (JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).syncCode || ""; } catch (_) { return ""; }
      })();
      panel.innerHTML = `
        <h3 class="seccion" style="margin-top:0;">${window.t("sync.panel.title")}</h3>
        <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">${window.t("sync.panel.body")}</p>
        <p style="font-size:13px;color:var(--sim-verde-dk,#1a6e3c);font-weight:700;margin-top:0;">${window.t("sync.panel.privacy")}</p>
        <div id="oc-sync-estado" style="font-size:13px;font-weight:700;margin-bottom:10px;"></div>
        <!-- REENGANCHE SELF-HELP (JFC 2026-08-28). Según el checkpoint del
             autodiagnóstico, el botón del punto donde está trabado se pone
             NARANJA (highlight = aquí se atascó) y es el desatorador/forzador;
             los demás quedan inertes. Así el dueño/admin/encargado se desatasca
             solo, sin llamar a soporte. -->
        <div id="oc-sync-reenganche" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>
        <!-- DIAGNÓSTICO REAL (JFC 2026-08-26): hechos crudos del estado de sync,
             para no adivinar. Solo el dueño lo ve (panel Avanzado). No es un popup
             ni toca la UI del cliente. -->
        <details id="oc-sync-diag-wrap" style="margin-bottom:12px;">
          <summary style="font-size:13px;font-weight:700;color:var(--azul-medio);cursor:pointer;">Sync diagnostics (show the real state)</summary>
          <div style="position:relative;margin-top:8px;">
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:6px;">
              <button id="oc-sync-diag-fix" type="button" title="Align this device's identity to the license you entered"
                style="font-size:11px;padding:4px 10px;border:1px solid #00805A;border-radius:5px;background:#fff;color:#00805A;cursor:pointer;">Fix split identity</button>
              <button id="oc-sync-diag-copy" type="button" title="Copy diagnostics"
                style="font-size:11px;padding:4px 10px;border:1px solid var(--azul-medio,#2c4a68);border-radius:5px;background:#fff;color:var(--azul-medio,#2c4a68);cursor:pointer;">Copy</button>
            </div>
            <pre id="oc-sync-diag" style="font-size:12px;line-height:1.5;background:var(--paper-deep,#E2E8ED);color:#0F1923;padding:10px 12px;border-radius:6px;margin:0;white-space:pre-wrap;word-break:break-word;">loading...</pre>
          </div>
        </details>
        <div id="oc-sync-apagado" style="display:${salaActiva ? "none" : "flex"};gap:8px;flex-wrap:wrap;align-items:center;">
          <input id="oc-sync-codigo" type="text" value="${escHtml(codigoPrecargado)}" placeholder="${window.t("sync.panel.codePlaceholder")}" maxlength="40"
            style="flex:1;min-width:220px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;font-size:14px;">
          <button id="oc-sync-activar" class="ir">${window.t("sync.panel.activate")}</button>
        </div>
        <div id="oc-sync-activo" style="display:${salaActiva ? "block" : "none"};">
          <p style="font-size:13px;color:var(--ink-soft);">${window.t("sync.panel.shareHint")}</p>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <code id="oc-sync-codigo-actual" style="font-size:16px;font-weight:700;background:var(--paper-deep,#E2E8ED);padding:6px 12px;border-radius:6px;">${escHtml((window.OCSyncControl.paraMostrar ? window.OCSyncControl.paraMostrar(salaActiva) : salaActiva) || "")}</code>
            <span id="oc-sync-huella" style="font-family:var(--font-mono,monospace);font-size:15px;font-weight:700;color:#0F1923;"></span>
            <!-- QR DE UNIRSE — DORMANT (JFC 2026-08-21). NO BORRAR.
                 Se retiro porque no cerraba el circulo: la app no tiene lector,
                 y al escanearlo con la camara del telefono abria la web pero
                 igual habia que pasar por el PIN, asi que no ahorraba ningun
                 paso y hacia creer que existia un canal aparte. La licencia se
                 comparte por WhatsApp con el boton de abajo, que si funciona.
                 Para re-encenderlo: SYNC_QR_VISIBLE = true mas abajo y
                 devolver este div. -->
          </div>
          <p style="font-size:14px;line-height:1.5;color:#2C3E50;margin:10px 0 0;">Every device that activates with this license is the same shared notebook. They keep each other up to date on their own: there is no separate team code to hand out.</p>
          <p style="font-size:13px;line-height:1.5;color:#7a4a00;background:#FFF4D6;border-left:4px solid #E8A33D;padding:10px 12px;border-radius:0 8px 8px 0;margin:10px 0 0;">Your license is the key to your business. Anyone who has it can open your notebook, so guard it like a password: only share it one-to-one with people on your team, and never post it publicly.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button id="oc-sync-compartir" class="ir" style="background:#25D366;border-color:#1da851;">${window.t("sync.panel.share")}</button>
            <!-- SIMPLIFICACION DE BOTONES (JFC 2026-08-28, pedido explicito):
                 solo deben quedar visibles Share (WhatsApp) y Join notebook.
                 Resync/Merge/Rotate/Deactivate NO se borraron del DOM ni de
                 la logica (los handlers siguen atados mas abajo por getElementById,
                 asi que si algun dia hace falta reactivarlos basta con quitar
                 display:none) -- solo se ocultan/apagan para bajar el ruido
                 visual del panel Advanced. -->
            <button id="oc-sync-resincronizar" style="display:none;">${window.t("sync.panel.resync")}</button>
            <button id="oc-sync-mergear" class="ir" style="display:none;background:#2C3E50;border-color:#0F1923;color:#FFFFFF;border-left:5px solid var(--azul-medio,#2c4a68);">Merge inventory with my team</button>
            <button id="oc-sync-rotar" style="display:none;border-color:#E86040;color:#E86040;">Rotate team license</button>
        <button id="oc-sync-desactivar" style="display:none;border-color:var(--rojo);color:var(--rojo);">${window.t("sync.panel.deactivate")}</button>
          </div>
        </div>
        <!-- UNIRSE — plegado a proposito (JFC 2026-08-21). Antes esto estaba
             ABIERTO y arriba, asi que el panel PEDIA un codigo antes de
             ofrecer el propio, y la gente creia que le faltaba conseguir algo.
             Ahora primero se ve la licencia propia; esto es para el caso menos
             comun: un dispositivo que llega a un negocio que ya existe. -->
        <details id="oc-sync-unirse" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--azul-suave,#dde5ec);">
          <summary style="font-size:14px;font-weight:700;color:var(--azul-medio);cursor:pointer;min-height:44px;display:flex;align-items:center;">This device belongs to another business — enter its license</summary>
          <p style="font-size:14px;color:var(--ink-soft);margin:8px 0;">Paste the license of the notebook you want to join. It is the same code the owner sees on their device.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input id="oc-sync-codigo2" type="text" placeholder="F123-XXXX-XXXX-XXXX-XXXXX" maxlength="40"
              style="flex:1;min-width:220px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-size:15px;">
            <button id="oc-sync-unirme" class="ir" style="min-height:44px;">Join this notebook</button>
          </div>
        </details>
        <!-- CLAIM / MERGE DE DISPOSITIVOS PROPIOS (JFC 2026-08-27). Cuando una
             persona queda con dos aparatos sueltos (ej. "James Bond Store" en la
             PC y "007 Store" en el cel), cada uno con su instanceId y a veces con
             licenseCode/syncCode/sala divergentes, este bloque re-apunta ESTE
             aparato a la licencia canónica SIN vaciar sus datos locales. Al
             reconectar, el sync add-only junta los datos de ambos. -->
        <details id="oc-sync-claim" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--azul-suave,#dde5ec);">
          <summary style="font-size:14px;font-weight:700;color:var(--azul-medio);cursor:pointer;min-height:44px;display:flex;align-items:center;">This is also MY device — claim it and merge its data</summary>
          <p style="font-size:14px;color:var(--ink-soft);margin:8px 0;">Enter the license your OTHER device shows. Both will point to the same notebook and their data merges (nothing is deleted — merge only adds).</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input id="oc-sync-claim-cod" type="text" placeholder="F123-XXXX-XXXX-XXXX-XXXXX" maxlength="40" style="flex:1;min-width:220px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-size:15px;">
            <button id="oc-sync-claim-btn" class="ir" style="min-height:44px;">Claim &amp; merge</button>
          </div>
        </details>
        <p id="oc-sync-msg" style="font-size:13px;margin-top:8px;font-weight:700;"></p>`;
      vista.appendChild(panel);

      /* M5 (2026-08-27, auditoría): las acciones de sync SENSIBLES (rotar la
         licencia del negocio, re-emitir una licencia completa, claim/merge de
         dispositivos, merge de inventario) son del DUEÑO. Un admin puede ver el
         estado de sync y unirse a un notebook, pero NO debe poder rotar la
         licencia del dueño ni re-apuntar la identidad del negocio. El botón
         "avanzado" ya se oculta para empleados (auth-ui.js); esto cierra el
         hueco del admin.
         FIX (JFC 2026-08-28): el panel se construye ANTES del login, cuando
         rolActual() es null, así que el gate ocultaba claim/merge/rotar/fixlic/
         mergear para siempre. Ahora es una función re-ejecutable que se vuelve
         a aplicar al hacer login (evento oc-login). */
      function _aplicarGateSync() {
        try {
          var _rolSync = (window.OCAuth && window.OCAuth.rolActual) ? window.OCAuth.rolActual() : "";
          /* A2 (2026-08-28): JFC es el lord/master admin y su panel ya separa sus
             aparatos con esMio. Antes el claim/merge se ocultaba si el rol no era
             "dueno", así que JFC (que entra como lord/soporte) no veía el botón
             para re-apuntar su propia PC a la canónica. El lord también puede
             rotar/re-emitir licencias (es quien las emite). */
          var _esLordSync = false;
          try { _esLordSync = localStorage.getItem("f123_lord") === "1"; } catch (_) {}
          /* JFC 2026-08-28: rotar la licencia del equipo es SOLO del lord (o de
             sus agentes AI). Un dueño de licencia normal NO debe poder rotar la
             licencia de su negocio — eso es license handling, cosa del lord.
             Claim/merge de dispositivos propios SÍ es del dueño (re-apuntar su
             propio aparato a la canónica), así que esos dos siguen con la regla
             de dueño/lord. */
          var _ocultarRotar = !_esLordSync;
          var _ocultarClaim = _rolSync !== "dueno" && !_esLordSync;
          /* SIMPLIFICACION DE BOTONES (JFC 2026-08-28, pedido explicito): esta
             funcion se re-ejecuta en cada login y ANTES pisaba el display:none
             puesto en el HTML (linea ~611-614) apenas el usuario era dueno o
             lord -- volvia a mostrar Resync/Merge/Rotate/Deactivate/Claim que
             se querian ocultar siempre. Ahora esos 5 quedan SIEMPRE ocultos
             (sin importar rol); _ocultarRotar/_ocultarClaim se conservan sin
             usar por si se reactivan mas adelante. Solo Share queda SIEMPRE
             visible cuando hay sala activa. */
          ["oc-sync-rotar", "oc-sync-claim", "oc-sync-mergear", "oc-sync-resincronizar", "oc-sync-desactivar"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = "none";
          });
          var _compartir = document.getElementById("oc-sync-compartir");
          if (_compartir) _compartir.style.display = "";
        } catch (_) {}
      }
      _aplicarGateSync();
      try { window.addEventListener("oc-login", _aplicarGateSync); } catch (_) {}

      /* CAJA AUTOFORMATEADA en los DOS campos de codigo (JFC 2026-08-19:
         "es penoso tener que poner las - manualmente o las mayusculas
         manualmente"). Es la MISMA mascara del modal de unirse, exportada
         desde auth-ui.js: mayusculas y guiones al escribir Y al pegar. */
      try {
        if (window.OCAuth && window.OCAuth.mascaraCodigo) {
          ["oc-sync-codigo", "oc-sync-codigo2", "oc-sync-claim-cod"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) { el.dataset.ocPrefijo = "F123"; window.OCAuth.mascaraCodigo(el); }
          });
        }
      } catch (_) {}

      const pillTexto = (estado, n) => {
        if (estado === "conectado") return window.t("sync.panel.statusOn") + (n != null ? ` · ${n}` : "");
        if (window.OCSyncControl.problemaPersistente && window.OCSyncControl.problemaPersistente()) {
          return window.t("sync.panel.statusFailed");
        }
        return ({
          apagado: window.t("sync.panel.statusOff"),
          conectando: window.t("sync.panel.statusConnecting"),
          reconectando: window.t("sync.panel.statusReconnecting"),
        }[estado] || estado);
      };
      /* Escala de grises, sin colores (JFC 2026-08-25). SEMANTICA en un PUNTO
         (el color no va en el texto, que en blanco seria invisible sobre el
         panel claro): BLANCO BRILLOSO = al dia (vivo); NEGRO = offline / sin
         conectar hace rato; gris = sincronizando. Igual que el punto junto a
         Ayuda. Nada de verde/ambar/rojo. */
      const _prob = () => !!(window.OCSyncControl.problemaPersistente && window.OCSyncControl.problemaPersistente());
      const dotSpec = (estado) => {
        // Misma escala negro->blanco que el punto junto a Help (4 tonos).
        if (estado === "conectado") return { bg: "#ffffff", bd: "#7f93a4", glow: "0 0 5px 1px rgba(255,255,255,.95), 0 0 0 2px rgba(127,147,164,.30)" };
        if (estado === "conectando" && !_prob()) return { bg: "#c8c8c8", bd: "#b0b0b0", glow: "none" };
        if (estado === "reconectando" && !_prob()) return { bg: "#6a6a6a", bd: "#5a5a5a", glow: "none" };
        return { bg: "#141414", bd: "#141414", glow: "none" }; // offline / problema
      };

      function pintarEstado(estado, n) {
        const el = document.getElementById("oc-sync-estado");
        if (!el) return;
        const e = estado || window.OCSyncControl.estado();
        const d = dotSpec(e);
        const txt = pillTexto(e, n != null ? n : window.OCSyncControl.presencia());
        el.style.color = "#3a3a3a"; // texto siempre legible
        el.innerHTML = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;box-sizing:border-box;vertical-align:middle;margin-right:6px;background:' +
          d.bg + ';border:1.5px solid ' + d.bd + ';box-shadow:' + d.glow + ';"></span>' +
          '<span style="vertical-align:middle;"></span>';
        el.lastChild.textContent = txt;
      }
      pintarEstado();
      window.OCSyncControl.onEstado(pintarEstado);

      /* REENGANCHE SELF-HELP (JFC 2026-08-28). Determina el checkpoint actual
         del autodiagnóstico y pinta una fila de botones: el del punto donde
         está trabado se pone NARANJA (highlight) y es el desatorador/forzador;
         los demás quedan inertes (grises, sin click). El naranja es a la vez
         indicador ("aquí se atascó") y parámetro de acción ("púlsame para
         desatascarte"). */
      function pintarReenganche() {
        const box = document.getElementById("oc-sync-reenganche");
        if (!box) return;
        const S = window.OCSyncControl || {};
        const _estado = (S.estado && S.estado()) || "?";
        const _sala = (S.salaActiva && S.salaActiva()) || "";
        const _prob = !!(S.problemaPersistente && S.problemaPersistente());
        const _relayOk = window.__f123RelayOk; // lo setea pintarDiag()
        // Checkpoint actual: el punto donde está trabado.
        let activo = "conectar"; // default
        if (!_sala) activo = "activar";
        else if (_relayOk === false) activo = "relay";
        else if (_estado === "conectado") activo = "resincronizar";
        else if (_prob) activo = "reingresar";
        else activo = "conectar";
        const defs = [
          { id: "activar",      label: "🔑 Activate sync",        hint: "No room code yet — enter your license" },
          { id: "relay",        label: "📡 Test relay",           hint: "Relay unreachable from this device" },
          { id: "conectar",     label: "🔌 Reconnect now",        hint: "Not connected to the room yet" },
          { id: "reingresar",   label: "✏️ Re-enter license",     hint: "Failing to connect — check the code" },
          { id: "resincronizar",label: "🔄 Resync now",           hint: "Connected — force a fresh sync" },
        ];
        box.innerHTML = "";
        defs.forEach(function (d) {
          const esActivo = d.id === activo;
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = d.label;
          b.title = d.hint;
          b.style.cssText = "font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;cursor:" + (esActivo ? "pointer" : "not-allowed") + ";border:2px solid " + (esActivo ? "#E86040" : "#C9D2DA") + ";background:" + (esActivo ? "#E86040" : "#F0F3F6") + ";color:" + (esActivo ? "#FFFFFF" : "#9AA7B2") + ";opacity:" + (esActivo ? "1" : "0.6") + ";";
          if (esActivo) {
            b.addEventListener("click", function () {
              if (d.id === "activar") {
                const campo = document.getElementById("oc-sync-codigo");
                if (campo) { campo.focus(); campo.scrollIntoView({ behavior: "smooth", block: "center" }); }
                const btn = document.getElementById("oc-sync-activar");
                if (btn) btn.style.boxShadow = "0 0 0 3px rgba(232,96,64,.5)";
              } else if (d.id === "relay") {
                const pre = document.getElementById("oc-sync-diag");
                if (pre) pre.textContent = "Testing relay from this device...";
                try { pintarDiag(); } catch (_) {}
              } else if (d.id === "reingresar") {
                const campo = document.getElementById("oc-sync-codigo");
                if (campo) { campo.focus(); campo.scrollIntoView({ behavior: "smooth", block: "center" }); }
              } else {
                // conectar / resincronizar → forzar reconexión ya
                if (S.resincronizar) { try { S.resincronizar(); } catch (_) {} }
              }
            });
          }
          box.appendChild(b);
        });
      }
      try { pintarReenganche(); } catch (_) {}
      try { window.OCSyncControl.onEstado(function () { try { pintarReenganche(); } catch (_) {} }); } catch (_) {}

      /* DIAGNÓSTICO REAL DE SYNC (JFC 2026-08-26). Muestra los HECHOS crudos para
         no adivinar: con qué licencia está activado ESTE aparato, en qué tienda
         estás, a qué sala apunta el sync, si hay conexión y cuántos peers, y
         cuántos datos hay. Así se ve al instante si "poner la licencia" cambió de
         tienda o no, y si el relay está entregando algo. */
      async function pintarDiag() {
        const pre = document.getElementById("oc-sync-diag");
        if (!pre) return;
        const S = window.OCSyncControl || {};
        const T = window.OCTienda || {};
        let owned = {}; try { owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; } catch (_) {}
        let marcador = ""; try { marcador = localStorage.getItem("f123_tienda_activa") || "(propia \"\")"; } catch (_) {}
        let esLord = false; try { esLord = localStorage.getItem("f123_lord") === "1"; } catch (_) {}
        let accesos = []; try { accesos = JSON.parse(localStorage.getItem("f123_accesos") || "[]"); if (!Array.isArray(accesos)) accesos = []; } catch (_) { accesos = []; }
        const cnt = async (u) => { try { const r = await fetch(u); const a = await r.json(); return Array.isArray(a) ? a.length : "?"; } catch (_) { return "err"; } };
        const [nProd, nUbic, nCli, nUsu] = await Promise.all([cnt("/api/productos?todas=1"), cnt("/api/ubicaciones?todas=1"), cnt("/api/clientes"), cnt("/api/usuarios")]);
        const ultAcceso = accesos.length ? accesos[accesos.length - 1] : null;
        const _sala = (S.salaActiva && S.salaActiva()) || "";
        const _lic = owned.licenseCode || "";
        const _syncCode = owned.syncCode || "";
        // Los tres deberían ser el MISMO código. Si divergen, el estado quedó
        // enredado (típico tras probar/cambiar de tienda) y la UI muestra cosas
        // incoherentes — se marca aquí para que se vea el porqué (JFC 2026-08-27).
        const _norm = (x) => String(x || "").toUpperCase().replace(/\s+/g, "");
        const _presentes = [_lic, _syncCode, _sala].filter(Boolean).map(_norm);
        const _coherente = _presentes.length <= 1 || _presentes.every((x) => x === _presentes[0]);
        /* AUTODIAGNÓSTICO EN VIVO (JFC 2026-08-28). El usuario lleva días con
           dispositivos "desconectados entre sí" y el relay estaba bien. Para
           saber QUÉ se rompe en cada aparato, este bloque prueba el relay DESDE
           ESTE dispositivo (no desde el servidor) y cruza eso con el estado de
           sync local. El veredicto dice en una línea qué falla y qué hacer. */
        let relayOk = null; // null = probando, true/false = resultado
        /* CHECK DEL RELAY POR WEBSOCKET (JFC 2026-08-28). Antes se usaba
           fetch("/health"), pero el Worker no manda cabeceras CORS y el
           navegador (github.io) bloqueaba el fetch → reportaba "RELAY
           UNREACHABLE" en falso aunque el relay estuviera bien. Los WebSocket
           NO están sujetos a CORS, así que este check abre una conexión real a
           una sala de prueba: si abre, el relay es alcanzable desde ESTE
           dispositivo (que es exactamente lo que el sync usa). */
        try {
          relayOk = await new Promise(function (res) {
            let ws = null;
            const t = setTimeout(function () { try { ws && ws.close(); } catch (_) {} res(false); }, 6000);
            try {
              ws = new WebSocket("wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/__diag__" + Math.random().toString(36).slice(2, 8));
            } catch (_) { clearTimeout(t); res(false); return; }
            ws.onopen = function () { clearTimeout(t); try { ws.close(); } catch (_) {} res(true); };
            ws.onerror = function () { clearTimeout(t); try { ws.close(); } catch (_) {} res(false); };
            ws.onclose = function () { clearTimeout(t); res(false); };
          });
        } catch (_) { relayOk = false; }
        window.__f123RelayOk = relayOk; // lo consume pintarReenganche()
        const _estado = (S.estado && S.estado()) || "?";
        const _peers = (S.presencia && S.presencia()) || 0;
        const _prob = !!(S.problemaPersistente && S.problemaPersistente());
        // Última actividad de sync (check mutuo): la op más reciente del log,
        // y si vino de OTRO dispositivo (prueba de que el equipo se habla).
        let ultimaOp = null, ultimaOpAjena = null;
        try {
          const _log = JSON.parse(localStorage.getItem("f123_sync_log") || "[]");
          if (Array.isArray(_log) && _log.length) {
            const _miId = (S.deviceIdActual && S.deviceIdActual()) || "";
            const _orden = _log.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
            ultimaOp = _orden[0] || null;
            ultimaOpAjena = _orden.find((o) => o.deviceId && o.deviceId !== _miId) || null;
          }
        } catch (_) {}
        // Veredicto: una línea clara de qué está mal y qué hacer.
        let veredicto;
        if (!_sala) veredicto = "SYNC OFF: this device has no room code. Enter your license above and press Activate.";
        else if (relayOk === false) veredicto = "RELAY UNREACHABLE from this device: check this device's internet / firewall. The relay itself is up (verified from the server).";
        else if (_estado === "conectado") veredicto = "CONNECTED: this device is on the relay room. " + (_peers > 0 ? ("Peers online: " + _peers + ". " + (ultimaOpAjena ? "Last data from a teammate: " + (ultimaOpAjena.fecha || "?") + "." : "No data from a teammate yet — their device must be on and synced.")) : "No peers online right now — the other device(s) must be open and connected to sync.");
        else if (_prob) veredicto = "FAILING: this device has tried to connect many times without success. Check the room code matches your other device exactly (F123-...).";
        else veredicto = "NOT CONNECTED (" + _estado + "): this device is not on the relay yet. If it stays like this, check the room code and this device's internet.";
        const lineas = [
          "VERDICT: " + veredicto,
          "",
          "Relay reachable from THIS device: " + (relayOk === null ? "checking..." : (relayOk ? "YES" : "NO")),
          "Connection:   " + _estado + "   (peers online: " + _peers + ")",
          "Sync room (where data actually syncs): " + (_sala || "(off)"),
          "License (this is your sync code & password): " + (_lic || "(none)"),
          (_coherente ? "→ COHERENT: this device's identity, share code and sync room all match." :
            "→ ⚠ SPLIT: this device's identity is split across different codes. Enter your true license in the field above, then press 'Fix split identity'."),
          "Last sync activity: " + (ultimaOp ? (ultimaOp.fecha || "?") + (ultimaOp.deviceId === ((S.deviceIdActual && S.deviceIdActual()) || "") ? " (this device)" : " (teammate)") : "none yet"),
          "Business name (this device): " + (owned.nombreNegocio || "(none)"),
          "Active store:  " + (T.esUnida && T.esUnida() ? ("JOINED  " + ((T.licenciaActual && T.licenciaActual()) || "?")) : "OWN (\"\")") ,
          "Store marker:  " + marcador,
          "Data here:     products " + nProd + " · shelves " + nUbic + " · customers " + nCli + " · team " + nUsu,
          (esLord ? ("Observed stores (audit log): " + accesos.length + (ultAcceso ? "  · last: " + ultAcceso.licencia + " @ " + ultAcceso.cuando : "")) : ""),
          "",
          "Reading this: if you paste another business's license and 'Active store' still says OWN and the counts are YOUR numbers, the switch did NOT happen (that license is being treated as this device's own). If it says JOINED but counts are 0, you switched but their data has not synced in yet (needs their device to have pushed to the relay).",
        ];
        pre.textContent = lineas.join("\n");
        // Tras actualizar el diagnóstico (p. ej. prueba de relay), re-pintar el
        // reenganche para que el botón naranja refleje el checkpoint real.
        try { pintarReenganche(); } catch (_) {}
      }
      try { pintarDiag(); } catch (_) {}
      /* AUTO-REFRESCO DEL DIAGNÓSTICO (JFC 2026-08-28): el estado de sync cambia
         solo (reconexión, peers que entran/salen). Re-pintar cada 5s mantiene el
         veredicto al día sin que el usuario tenga que abrir/cerrar el desplegable.
         Solo se pinta si el desplegable está abierto (no malgastar fetchs). */
      try {
        setInterval(function () {
          const _wrap = document.getElementById("oc-sync-diag-wrap");
          if (_wrap && _wrap.open) { try { pintarDiag(); } catch (_) {} }
        }, 5000);
      } catch (_) {}
      /* BOTÓN COPIAR (JFC 2026-08-28): copiar el diagnóstico a mano era
         doloroso. Un clic copia todo el texto al portapapeles y avisa. */
      try {
        const _copyBtn = document.getElementById("oc-sync-diag-copy");
        if (_copyBtn) _copyBtn.addEventListener("click", function () {
          const pre = document.getElementById("oc-sync-diag");
          if (!pre) return;
          const txt = pre.textContent || "";
          const _ok = function () { const o = _copyBtn.textContent; _copyBtn.textContent = "Copied ✓"; setTimeout(function () { _copyBtn.textContent = o; }, 1600); };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(_ok, function () { _copiarFallback(pre, txt, _ok); });
            } else { _copiarFallback(pre, txt, _ok); }
          } catch (_) { _copiarFallback(pre, txt, _ok); }
        });
      } catch (_) {}
      function _copiarFallback(pre, txt, ok) {
        try {
          const ta = document.createElement("textarea");
          ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } catch (_) {}
          document.body.removeChild(ta); ok();
        } catch (_) { ok(); }
      }
      /* REPARAR IDENTIDAD PARTIDA (JFC 2026-08-28). Un clic alinea licenseCode,
         syncCode y sala de sync al código que el usuario puso en el campo de
         arriba. Reutiliza reconciliar(), que ya deja los tres campos en el MISMO
         código sin vaciar datos locales.
         JFC 2026-08-28: ANTES, si el campo estaba vacío, caía silenciosamente al
         licenseCode actual — que puede ser el EQUIVOCADO (ej. una trunca vieja
         como F123-5HSG-JENF) — y reconciliaba al código malo, empeorando el
         SPLIT. Ahora exige la licencia verdadera en el campo: no reconciliar a
         ciegas. */
      try {
        const _fixBtn = document.getElementById("oc-sync-diag-fix");
        if (_fixBtn) _fixBtn.addEventListener("click", function () {
          const campo = document.getElementById("oc-sync-codigo");
          const cod = campo ? (campo.value || "").trim() : "";
          if (!/^F123-/i.test(cod)) {
            alert("Enter your true license in the field above first, then press 'Fix split identity'.");
            return;
          }
          const msg = document.getElementById("oc-sync-msg");
          try {
            const r = (window.OCTienda && window.OCTienda.reconciliar) ? window.OCTienda.reconciliar(cod) : null;
            if (msg) { msg.style.color = "#00805A"; msg.textContent = (r && r.ok) ? "Identity aligned to " + cod + ". Reconnecting..." : ((r && r.error) || "Could not fix."); }
            if (r && r.ok) { setTimeout(function () { try { location.reload(); } catch (_) {} }, 1200); }
          } catch (_) { if (msg) { msg.style.color = "var(--rojo,#a3392a)"; msg.textContent = "Could not fix the identity."; } }
        });
      } catch (_) {}
      /* Refrescar el diagnóstico cada 4s mientras el panel esté montado. Si el
         usuario está seleccionando texto dentro del pre (para copiar a mano),
         NO se pisa el contenido a mitad de selección — se espera al siguiente
         tick. (JFC 2026-08-28: "no lo hagas que se cierre apenas hago select
         text"). */
      try { if (window._ocSyncDiagTimer) clearInterval(window._ocSyncDiagTimer); window._ocSyncDiagTimer = setInterval(() => {
        const pre = document.getElementById("oc-sync-diag");
        if (!pre) { clearInterval(window._ocSyncDiagTimer); return; }
        const sel = window.getSelection && window.getSelection();
        const dentro = sel && sel.rangeCount > 0 && pre.contains(sel.anchorNode) && pre.contains(sel.focusNode);
        if (dentro) return; // hay selección activa dentro del pre: no pisar
        pintarDiag();
      }, 4000); } catch (_) {}

      /* QR DE UNIRSE — DORMANT (JFC 2026-08-21). NO BORRAR: ver el comentario
         en el HTML de arriba. Poner en true para re-encenderlo (y devolver el
         div #oc-sync-qr). El generador qrcode-local.js SE QUEDA: lo usan las
         etiquetas de producto, que no tienen nada que ver con esto. */
      var SYNC_QR_VISIBLE = false;
      function pintarQR(codigo) {
        if (!SYNC_QR_VISIBLE) return;
        const cont = document.getElementById("oc-sync-qr");
        if (!cont || !window.qrcode) return;
        try {
          /* BUG EN VIVO (JFC 2026-08-19): el QR llevaba el texto suelto
             "AMIGABLE123-SYNC:<codigo>". La camara de cualquier telefono lo lee
             pero no sabe que hacer con el y responde "No usable data found".
             Ahora lleva una URL de verdad: la camara abre friendly-123 y la app
             ve ?join=<codigo> y ofrece unirse. Un solo escaneo, sin teclear. */
          /* El QR lleva el codigo de EQUIPO (TEAM-...), no la licencia. Un QR no puede
             emitir licencias: solo mete a este telefono en el equipo que ya existe. */
          const url = "https://jfcarpiopuntocom.github.io/friendly-123/?join=" + encodeURIComponent(window.OCSyncControl.paraMostrar ? window.OCSyncControl.paraMostrar(codigo) : codigo);
          const q = window.qrcode(0, "M");
          q.addData(url);
          q.make();
          cont.innerHTML = `<img src="${q.createDataURL(4, 4)}" width="140" height="140" alt="QR" style="border-radius:6px;">`;
        } catch (_) { /* QR es un extra visual */ }
      }
      /* PASO 3 (JFC 2026-08-19): el codigo de equipo se comparte CON su huella.
         Quien se une, al terminar de mergear, recalcula la suya: si le da la
         misma, el merge quedo verificado y se le puede decir en pantalla. Es
         un recibo que una persona puede comprobar, sin tener que confiar en
         que "seguro se sincronizo". */
      function pintarHuella() {
        try {
          const el = document.getElementById("oc-sync-huella");
          if (!el) return;
          const h = window.OCSync && window.OCSync.huella ? window.OCSync.huella() : null;
          el.textContent = h && h.corta ? " · " + h.corta : "";
          /* JFC 2026-08-28: aclarar que #XXXX es la HUELLA DEL INVENTARIO (cambia
             con tus datos), NO el id del dispositivo. El id firme del aparato es
             su apodo/número estable. Antes el tooltip solo decía "N shelves, M
             products" y la gente leía #XXXX como un id de device que "cambiaba". */
          el.title = h ? ("Inventory fingerprint (changes with your data): " + h.perchas + " shelves, " + h.productos + " products. Your device's stable id is its nickname.") : "";
        } catch (_) {}
      }
      pintarHuella();
      try { window.addEventListener("oc-micelio-cambio", pintarHuella); } catch (_) {}
      if (salaActiva) pintarQR(salaActiva);

      /* ENTER activa (JFC 2026-08-25): en un campo unico, Enter dispara la
         accion principal — es lo estandar y da el "sense of completion". */
      (function () {
        var _campo = document.getElementById("oc-sync-codigo");
        if (_campo) _campo.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); var b = document.getElementById("oc-sync-activar"); if (b) b.click(); }
        });
      })();
      /* JFC 2026-08-28: detecta si el dispositivo está PARTIDO (licenseCode,
         syncCode y sala de sync divergen). Es el mismo criterio que usa el
         autodiagnóstico (pintarDiag) para marcar SPLIT. Se usa para que
         "Activate" reconcilie del todo cuando el aparato está partido. */
      function _estadoPartido() {
        try {
          const _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
          const _lic = _ow.licenseCode || "";
          const _sync = _ow.syncCode || "";
          const _sala = (window.OCSyncControl && window.OCSyncControl.salaActiva) ? (window.OCSyncControl.salaActiva() || "") : "";
          const _norm = (x) => String(x || "").toUpperCase().replace(/\s+/g, "");
          const _presentes = [_lic, _sync, _sala].filter(Boolean).map(_norm);
          return _presentes.length > 1 && !_presentes.every((x) => x === _presentes[0]);
        } catch (_) { return false; }
      }
      document.getElementById("oc-sync-activar").addEventListener("click", (ev) => {
        const btn = ev.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, 1200);
        const codigo = document.getElementById("oc-sync-codigo").value;
        /* Guard (portado de amigable-123, 23ce907): pegar por error el codigo
           de la app hermana metia este negocio en la sala de otro. */
        if (codigo.trim() && !/^(TEAM|F123)-/i.test(codigo.trim())) {
          const m0 = document.getElementById("oc-sync-msg");
          m0.style.color = "var(--rojo,#a3392a)";
          m0.textContent = window.t("sync.panel.badCode");
          btn.disabled = false;
          return;
        }
        const msg = document.getElementById("oc-sync-msg");
        /* JFC 2026-08-28: si el dispositivo está PARTIDO, "Activate" debe
           RECONCILIAR del todo (alinear licenseCode+syncCode+sala+namespace de
           tienda y resincronizar), no solo fijar la sala. Antes, un aparato
           partido que entraba su licencia verdadera y pulsaba Activate seguía
           mostrando el VERDICT viejo (SPLIT) porque activar() no alineaba el
           namespace ni resincronizaba. reconcile() es el mismo fix que usa
           "Fix split identity", y es seguro: para la licencia propia no cambia
           de tienda (cambiar() devuelve mismo:true). */
        const partido = _estadoPartido();
        let r;
        if (partido && /^F123-/i.test(codigo.trim()) && window.OCTienda && window.OCTienda.reconciliar) {
          const rc = window.OCTienda.reconciliar(codigo.trim());
          r = { ok: !!rc.ok, error: rc.error || "", warning: rc.error ? rc.error : "" };
        } else {
          r = window.OCSyncControl.activar(codigo);
        }
        if (!r.ok) { msg.style.color = "var(--rojo,#a3392a)"; msg.textContent = r.error; return; }
        /* AVISO, NO BLOQUEO (JFC 2026-08-27, refuerzo P1): si la licencia es
           corta o no pasa el checksum, se acepta igual pero se informa. */
        if (r.warning) { msg.style.color = "var(--gold,#9c7a35)"; msg.textContent = r.warning; }
        else msg.textContent = "";
        document.getElementById("oc-sync-apagado").style.display = "none";
        document.getElementById("oc-sync-activo").style.display = "block";
        document.getElementById("oc-sync-codigo-actual").textContent = (window.OCSyncControl.paraMostrar ? window.OCSyncControl.paraMostrar(codigo.trim()) : codigo.trim());
        pintarQR(codigo.trim());
        /* Refrescar el diagnóstico al instante para que el VERDICT deje de
           mostrar el estado viejo (JFC 2026-08-28). */
        try { pintarDiag(); } catch (_) {}
      });
      const btnCompartir = document.getElementById("oc-sync-compartir");
      if (btnCompartir) btnCompartir.addEventListener("click", () => {
        const _c = (window.OCSyncControl.salaActiva() || "").trim();
        /* Se comparte la licencia tal cual (JFC 2026-08-21): ES lo que el otro
           va a teclear. Antes se traducia a TEAM- para que "no pareciera una
           licencia" — y era exactamente eso, asi que el disfraz solo hacia
           dudar a quien lo recibia. */
        const codigo = /^F123-/i.test(_c) ? _c : "";
        const negocio = (function () { try { const s = document.getElementById("oc-negocio-nombre"); return s ? s.textContent.trim() : ""; } catch (_) { return ""; } })();
        const _h = (function () { try { const x = window.OCSync && window.OCSync.huella ? window.OCSync.huella() : null; return x && x.corta ? x.corta : ""; } catch (_) { return ""; } })();
        const texto = window.t("sync.panel.shareText")
          .replace("{business}", negocio ? " (" + negocio + ")" : "")
          .replace("{code}", codigo + (_h ? " · " + _h : ""));
        window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
      });
      /* PASO 5 — JUNTAR LOS CATALOGOS, mostrando el cambio ANTES de aplicarlo.
         Este es el boton que le faltaba a JFC: sus dos dispositivos estaban
         conectados y hablando, pero no habia forma de decirles "y ahora junten
         sus perchas". Nada se aplica solo: se pide, se junta lo que llega, se
         ensena el conteo exacto, y recien ahi decide una persona. */
      (function () {
        const btnM = document.getElementById("oc-sync-mergear");
        if (!btnM) return;
        let piezas = null, temporizador = null;

        function cerrarModal() { const m = document.getElementById("oc-merge-modal"); if (m) m.remove(); }

        function pintarPrevio(cat, rolRemoto) {
          const dif = window.OCSync.compararCatalogo(cat, rolRemoto);
          cerrarModal();
          const m = document.createElement("div");
          m.id = "oc-merge-modal";
          m.style.cssText = "position:fixed;inset:0;z-index:10006;background:#0F1923EE;display:flex;align-items:center;justify-content:center;padding:20px;";
          if (!dif) {
            m.innerHTML = '<div style="background:#FFF;border-radius:14px;padding:22px;max-width:420px;"><p style="font-size:16px;color:#0F1923;margin:0 0 14px;">The catalog received is not readable. Nothing was changed.</p><button type="button" id="oc-merge-x" style="width:100%;min-height:48px;border:none;border-radius:10px;background:#2C3E50;color:#FFF;font-size:16px;font-weight:700;cursor:pointer;">Close</button></div>';
          } else {
            const nada = !dif.nuevasPerchas.length && !dif.nuevosProductos.length && !dif.conflictos.length &&
                         !dif.nuevosMiembros.length && !dif.miembrosActualizados.length;
            const nota = "New products arrive with <strong>stock 0</strong> on purpose. Stock is a physical fact of each shelf: copying it from another device would invent units that are not here. Count them yourself.";
            m.innerHTML =
              '<div style="background:#FFF;border-radius:14px;padding:24px 22px;max-width:470px;width:100%;text-align:left;max-height:86vh;overflow-y:auto;">' +
              '<h3 style="font-size:20px;font-weight:800;margin:0 0 12px;color:#0F1923;">Merge inventory</h3>' +
              (nada
                ? '<p style="font-size:16px;line-height:1.5;color:#2C3E50;margin:0 0 16px;">Nothing to merge: this device already has the same products and shelves as your team.</p>'
                : '<p style="font-size:15px;line-height:1.55;color:#2C3E50;margin:0 0 14px;">This is exactly what will change on THIS device:</p>' +
                  '<ul style="font-size:16px;line-height:1.7;color:#0F1923;margin:0 0 14px;padding-left:20px;">' +
                  (dif.nuevasPerchas.length ? "<li><strong>+ " + dif.nuevasPerchas.length + "</strong> shelf(s): " + dif.nuevasPerchas.map(function (x) { return escHtml(x.nombre); }).join(", ") + "</li>" : "") +
                  (dif.nuevosProductos.length ? "<li><strong>+ " + dif.nuevosProductos.length + "</strong> product(s), each arriving with stock 0</li>" : "") +
                  (dif.conflictos.length ? "<li><strong>" + dif.conflictos.length + "</strong> item(s) differ in name or price" + (dif.ganaElOtro ? " — theirs wins (higher role)" : " — yours is kept") + "</li>" : "") +
                  /* El equipo se lista aparte y con nombres: un cambio de rol o
                     de PIN decide quien entra y con cuanto peso, y eso no puede
                     ir escondido dentro de un conteo generico. */
                  (dif.nuevosMiembros.length ? "<li><strong>+ " + dif.nuevosMiembros.length + "</strong> team member(s): " + dif.nuevosMiembros.map(function (x) { return escHtml(x.nombre) + " (" + (x.rol === "admin" ? "Admin" : "Employee") + ")"; }).join(", ") + "</li>" : "") +
                  (dif.miembrosActualizados.length ? "<li><strong>" + dif.miembrosActualizados.length + "</strong> team member(s) updated: " + dif.miembrosActualizados.map(function (x) { return escHtml(x.nombre) + (x.rolAntes !== x.rolDespues ? " (" + (x.rolAntes === "admin" ? "Admin" : "Employee") + " &rarr; " + (x.rolDespues === "admin" ? "Admin" : "Employee") + ")" : " (PIN/details)"); }).join(", ") + "</li>" : "") +
                  '<li style="color:#1a6e3c;"><strong>Nothing will be deleted.</strong>' + (dif.soloMios ? " Your " + dif.soloMios + " own product(s) stay." : "") + "</li>" +
                  "</ul>" +
                  '<p style="font-size:14px;line-height:1.5;color:#2C3E50;margin:0 0 16px;padding:10px 12px;background:#F8F9FB;border-left:4px solid #2C3E50;border-radius:0 8px 8px 0;">' + nota + "</p>") +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              (nada ? "" : '<button type="button" id="oc-merge-ok" style="flex:1;min-width:150px;min-height:48px;border:none;border-radius:10px;background:#E86040;color:#FFF;font-size:16px;font-weight:700;cursor:pointer;">Merge now</button>') +
              '<button type="button" id="oc-merge-x" style="flex:1;min-width:110px;min-height:48px;border:2px solid #2C3E50;border-radius:10px;background:transparent;color:#0F1923;font-size:16px;font-weight:700;cursor:pointer;">' + (nada ? "Close" : "Cancel") + "</button>" +
              '</div><p id="oc-merge-msg" style="font-size:14px;font-weight:700;margin:12px 0 0;"></p></div>';
          }
          document.body.appendChild(m);
          document.getElementById("oc-merge-x").addEventListener("click", cerrarModal);
          const ok = document.getElementById("oc-merge-ok");
          if (ok) ok.addEventListener("click", function () {
            ok.disabled = true;
            const r = window.OCSync.aplicarCatalogo(cat, rolRemoto);
            const msg = document.getElementById("oc-merge-msg");
            if (!r.ok) { msg.style.color = "var(--rojo,#a3392a)"; msg.textContent = r.error; ok.disabled = false; return; }
            msg.style.color = "var(--sim-verde-dk,#1a6e3c)";
            /* El recibo del paso 3: si la huella quedo igual a la del que
               mando, el merge esta verificado y se puede decir. */
            const igual = r.huella && cat.huella && r.huella.corta === cat.huella;
            msg.textContent = "Merged: +" + r.agregadasU + " shelf(s), +" + r.agregadosP + " product(s), "
              + "+" + (r.miembrosAgregados || 0) + " member(s), " + (r.miembrosActualizados || 0) + " member(s) updated."
              + (igual ? " Fingerprints now match (" + r.huella.corta + "): verified." : " This device is now " + (r.huella ? r.huella.corta : "?") + ".");
            setTimeout(function () { location.reload(); }, 2600);
          });
        }

        btnM.addEventListener("click", function () {
          const msg = document.getElementById("oc-sync-msg");
          if (!window.OCSyncControl.pedirCatalogo || !window.OCSync || !window.OCSync.compararCatalogo) {
            msg.style.color = "var(--rojo,#a3392a)"; msg.textContent = "This device cannot merge catalogs yet."; return;
          }
          piezas = { ubicaciones: [], productos: [], usuarios: [], rol: "", huella: "", esperados: 0, vistos: 0, porDev: {} };
          msg.style.color = "var(--ink-soft)";
          msg.textContent = "Asking your team for their inventory…";
          window.OCSyncControl.pedirCatalogo();
          clearTimeout(temporizador);
          temporizador = setTimeout(function () {
            if (!piezas) return;
            const devs = Object.keys(piezas.porDev || {});
            const todosCompletos = devs.length > 0 && devs.every((d) => piezas.porDev[d].recibidos >= piezas.porDev[d].total);
            if (!piezas.vistos) {
              msg.style.color = "var(--rojo,#a3392a)";
              msg.textContent = "No other device answered. Open the app on the other device, activated with this same license, and try again.";
            } else if (!todosCompletos) {
              /* A3: algún dispositivo empezó a mandar su inventario pero no terminó
                 (se desconectó a mitad). No disparar el preview con datos a medias. */
              msg.style.color = "var(--rojo,#a3392a)";
              msg.textContent = "Some devices did not finish sending their inventory. Try again.";
            }
          }, 9000);
        });

        window.addEventListener("oc-catalogo-trozo", function (ev) {
          try {
            if (!piezas) return;
            const pl = ev.detail && ev.detail.payload; if (!pl) return;
            const dev = ev.detail && ev.detail.deviceId;
            piezas.rol = pl.rol || piezas.rol;
            piezas.huella = pl.huella || piezas.huella;
            if (Array.isArray(pl.filas)) {
              if (pl.tabla === "ubicaciones") piezas.ubicaciones = piezas.ubicaciones.concat(pl.filas);
              if (pl.tabla === "productos") piezas.productos = piezas.productos.concat(pl.filas);
              if (pl.tabla === "usuarios") piezas.usuarios = piezas.usuarios.concat(pl.filas);
            }
            /* A3 (2026-08-27, auditoría): agrupar por dispositivo. Antes
               `piezas.esperados` se sobreescribía con el deTotal de cada trozo y
               `piezas.vistos` contaba los trozos de TODOS los dispositivos, así
               que con 2+ aparatos respondiendo el preview se disparaba prematuro
               con datos mezclados/incompletos. Ahora cada dispositivo se cuenta
               por separado (recibidos vs su propio total) y el preview espera a
               que TODOS los que respondieron hayan completado. */
            if (dev) {
              if (!piezas.porDev[dev]) piezas.porDev[dev] = { recibidos: 0, total: 0 };
              piezas.porDev[dev].total = pl.deTotal || piezas.porDev[dev].total;
              piezas.porDev[dev].recibidos++;
            }
            piezas.vistos++;
            const devs = Object.keys(piezas.porDev);
            const todosCompletos = devs.length > 0 && devs.every((d) => piezas.porDev[d].recibidos >= piezas.porDev[d].total);
            if (todosCompletos) {
              clearTimeout(temporizador);
              const cat = { ubicaciones: piezas.ubicaciones, productos: piezas.productos, usuarios: piezas.usuarios, huella: piezas.huella };
              const rol = piezas.rol; piezas = null;
              document.getElementById("oc-sync-msg").textContent = "";
              pintarPrevio(cat, rol);
            }
          } catch (_) {}
        });
      })();

      const btnResync = document.getElementById("oc-sync-resincronizar");
      if (btnResync) btnResync.addEventListener("click", () => {
        const msg = document.getElementById("oc-sync-msg");
        window.OCSyncControl.resincronizar();
        msg.style.color = "var(--sim-verde-dk,#1a6e3c)";
        msg.textContent = window.t("sync.panel.resyncing");
        setTimeout(() => { if (msg.textContent === window.t("sync.panel.resyncing")) msg.textContent = ""; }, 3000);
      });
      /* UNIRSE DESDE ESTE MISMO SUBSEGMENTO (JFC 2026-08-19): antes no habia
         donde pegar el codigo si la sala ya estaba activa, y el unico boton a
         mano ("Change the code") ROTABA el codigo — que es lo contrario de lo
         que quiere quien llega a unirse. Este input une sin rotar nada. */
      (function () {
        const bu = document.getElementById("oc-sync-unirme");
        if (!bu) return;
        bu.addEventListener("click", () => {
          const m2 = document.getElementById("oc-sync-msg");
          const cod = (document.getElementById("oc-sync-codigo2").value || "").trim();
          if (!cod) { m2.style.color = "var(--rojo,#a3392a)"; m2.textContent = window.t("sync.panel.pasteCodeFirst"); return; }
          if (!/^(TEAM|F123)-/i.test(cod)) { m2.style.color = "var(--rojo,#a3392a)"; m2.textContent = window.t("sync.panel.badCode"); return; }
          /* A4 (2026-08-27, auditoría de integridad): antes usaba activar(), que
             solo guarda la sala y conecta — el aparato sincronizaba a la sala
             correcta pero NO adoptaba la licencia ni cambiaba de tienda (quedaba
             "partido": identidad demo/otra, datos en el namespace viejo). unirse()
             es el flujo de equipo completo: marca instanceId (sale de demo), fija
             licenseCode (cuenta como device del negocio) y cambia de tienda vía
             OCTienda.cambiar(). Si cambia de tienda, cambiar() recarga la página
             (el código de abajo no se ejecuta, correcto). Si ya estás en esa
             tienda (mismo:true), no recarga y mostramos el aviso de re-sync. */
          const r2 = window.OCSyncControl.unirse(cod);
          if (!r2.ok) { m2.style.color = "var(--rojo,#a3392a)"; m2.textContent = r2.error; return; }
          m2.style.color = "var(--sim-verde-dk,#1a6e3c)";
          m2.textContent = r2.mismo ? r2.error : window.t("sync.panel.joined");
          document.getElementById("oc-sync-apagado").style.display = "none";
          document.getElementById("oc-sync-activo").style.display = "block";
          document.getElementById("oc-sync-codigo-actual").textContent = (window.OCSyncControl.paraMostrar ? window.OCSyncControl.paraMostrar(cod) : cod);
          pintarQR(cod);
        });
        /* Si llego por el QR (?join=CODIGO), el campo viene ya lleno: solo toca
           el boton. Lo pone el bloque de index.html que lee el parametro. */
        try {
          const pre = sessionStorage.getItem("f123_join_pendiente");
          if (pre) { document.getElementById("oc-sync-codigo2").value = pre; }
        } catch (_) {}
      })(),
      (function(){var _r=document.getElementById("oc-sync-rotar");if(_r&&!_r.dataset.listo){_r.dataset.listo="1";_r.addEventListener("click",ocRotarCodigoSala);}})(),
      /* CLAIM / MERGE (JFC 2026-08-27). Re-apunta ESTE aparato a la licencia
         canónica que muestra el otro aparato, conservando los datos locales.
         El merge add-only ocurre después, al reconectar ambos a la misma sala. */
      (function () {
        const cb = document.getElementById("oc-sync-claim-btn");
        if (!cb) return;
        cb.addEventListener("click", () => {
          const m3 = document.getElementById("oc-sync-msg");
          const lic = (document.getElementById("oc-sync-claim-cod").value || "").trim();
          if (!/^F123-/i.test(lic)) {
            m3.style.color = "var(--rojo,#a3392a)";
            m3.textContent = "Enter the full license of your other device (F123-XXXX-XXXX-XXXX-XXXXX).";
            return;
          }
          const r3 = window.OCTienda.reconciliar(lic);
          if (!r3.ok) { m3.style.color = "var(--rojo,#a3392a)"; m3.textContent = r3.error; return; }
          m3.style.color = "var(--sim-verde-dk,#1a6e3c)";
          m3.textContent = "Done. Open your other device online; the two notebooks are merging now.";
        });
      })(),
      document.getElementById("oc-sync-desactivar").addEventListener("click", () => {
        window.OCSyncControl.desactivar();
        document.getElementById("oc-sync-apagado").style.display = "flex";
        document.getElementById("oc-sync-activo").style.display = "none";
      });
    })();
    // === FIN SINCRONIZAR EQUIPO ==================================================

    // === EQUIPO (multi-usuario, admins + encargados, 2026-07-22) ===========
    // Panel de gestión del Equipo: admins + encargados con PINs y correos.
    // - Dueño: crea admins y encargados, cambia cualquier PIN, desactiva cualquiera.
    // - Admin: crea y gestiona encargados (NO puede crear otros admins ni editar el PIN de admins).
    // - Límite free: 1 encargado (admins exentos — son co-dueños, no personal).
    const isDueno = () => window.OCAuth && window.OCAuth.rolActual() === "dueno";
    const isAdmin = () => window.OCAuth && window.OCAuth.rolActual() === "admin";

    const equipoPanel = document.createElement("div");
    equipoPanel.className = "tag-card";
    equipoPanel.id = "oc-emp-panel";
    equipoPanel.style.cssText = "text-align:left;margin-top:22px;";
    equipoPanel.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Team</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Each member has their own 3-digit PIN. Their sales, adjustments and movements are
        recorded under their name in the history. The owner's PIN does not appear here.
      </p>
      <!-- JERARQUIA VISIBLE (JFC 2026-08-21): "pon una jerarquia o se va a
           hacer mierda todo, y ponla visible en la lista donde sale el team,
           ellos necesitan saber quien tiene mas peso sobre los apuntes
           conjuntos". Cuando dos dispositivos editan lo mismo, el merge
           propone lo del rol mas alto: si eso no se ve en pantalla, el equipo
           no entiende por que gano un dato y no el otro. -->
      <div style="background:var(--paper-deep,#E2E8ED);border-left:4px solid var(--azul-medio,#2c4a68);border-radius:0 8px 8px 0;padding:12px 14px;margin:0 0 16px;">
        <p style="font-size:14px;font-weight:700;color:#0F1923;margin:0 0 6px;">Who carries more weight on the shared notebook</p>
        <p style="font-size:14px;line-height:1.6;color:#2C3E50;margin:0;">
          <strong>Owner</strong> &rarr; <strong>Admin</strong> &rarr; <strong>Employee</strong>.
          Everyone writes in the same notebook. When two devices change the same thing,
          the higher role's version is the one proposed. Stock is never overwritten by
          rank: it is a physical fact of each shelf, counted by whoever has it in front of them.
        </p>
        <p style="font-size:14px;line-height:1.6;color:#2C3E50;margin:6px 0 0;">
          <strong>Admin</strong> does everything day to day: products, shelves, sales, customers.
          Only the <strong>owner</strong> handles the license, the recovery email, who is promoted
          or removed, and the commission splits.
        </p>
      </div>
      <div id="oc-emp-lista" style="margin-bottom:18px;overflow-x:auto;-webkit-overflow-scrolling:touch;"></div>
      <details id="oc-emp-form-wrap" style="margin-bottom:6px;">
        <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--azul-medio);margin-bottom:10px;">
          + Add a team member
        </summary>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:340px;margin-top:10px;">
          <label style="font-size:13px;">Name
            <input id="oc-emp-nombre" maxlength="60" placeholder="e.g. Maria Auquilla"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;box-sizing:border-box;">
          </label>
          <label style="font-size:13px;">Email (optional — for notifications)
            <input id="oc-emp-email" type="email" maxlength="160" placeholder="name@example.com"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;box-sizing:border-box;">
          </label>
          <label style="font-size:13px;">PIN (3 digits)<!-- Microcirugia 7 (2026-07-08): aviso de colisión. El mock no puede verificar contra el PIN del dueño/contador (esos hashes viven en crypto-store). Si colisionan, el miembro queda bloqueado silenciosamente. -->
            <span style="display:block;font-size:13px;color:var(--rojo,#a3392a);margin-top:3px;font-weight:400;">
              Do not reuse the PIN of the owner, the general staff login or the bookkeeper.
            </span>
            <input id="oc-emp-pin" maxlength="3" inputmode="numeric" placeholder="•••"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;text-align:center;font-family:var(--font-mono);
                     box-sizing:border-box;letter-spacing:.2em;">
          </label>
          <label id="oc-emp-rol-label" style="font-size:13px;">Role
            <select id="oc-emp-rol"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;box-sizing:border-box;background:var(--blanco-calido,#fbf5e8);">
              <option value="empleado">Employee — day-to-day access (sales, inventory, shelves)</option>
              <option value="admin">Admin — full access except the owner's credentials</option>
            </select>
            <span style="display:block;font-size:13px;color:var(--ink-soft);margin-top:3px;">
              Only the owner can create admins.
            </span>
          </label>
          <button id="oc-emp-agregar" class="ir"
            style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">
            Add to the team
          </button>
          <p id="oc-emp-msg" style="font-size:14px;margin:0;font-weight:700;"></p>
        </div>
      </details>`;
    vista.appendChild(equipoPanel);

    // Renderiza la tabla del equipo (llama al endpoint cada vez que hay cambio).
    // También actualiza la visibilidad del selector de rol (dueño vs admin),
    // porque init() corre antes del login y el rol real no está disponible aún.
    async function renderEmpleados() {
      const rolLabel = document.getElementById("oc-emp-rol-label");
      if (rolLabel) rolLabel.style.display = isDueno() ? "" : "none";
      const lista = document.getElementById("oc-emp-lista");
      if (!lista) return;
      // B-02 (2026-08-26): rescatar aviso de colisión antes de que innerHTML lo borre.
      // Si aplicarCatalogo disparó oc-pin-colision, el mensaje lleva dataset.colisionPendiente.
      const msgElPre = document.getElementById("oc-emp-msg");
      const colisionPendiente = msgElPre && msgElPre.dataset.colisionPendiente ? msgElPre.dataset.colisionPendiente : null;
      let equipo = [];
      // ?pins=1 solo para owner/admin (JFC 2026-09-01): la lista unificada del
      // Team muestra los PINs para no repetirlos al crear otros. Es local.
      const _verPins = (isDueno() || isAdmin());
      try {
        const r = await fetch("/api/usuarios" + (_verPins ? "?pins=1" : ""));
        if (r.ok) equipo = await r.json();
      } catch (_) {}

      if (!equipo.length) {
        lista.innerHTML = `<p style="font-size:14px;color:var(--ink-soft);margin:0;">${window.t("team.noMembers")}</p>`;
        return;
      }

      // "Última ubicación" (JFC 2026-07-28): geo-ping.js es un archivo aparte
      // y opcional (ver ese archivo) — si no cargó, o no hay AMG.GeoPing, o
      // falla la lectura de IndexedDB, esto se degrada a un mapa vacío sin
      // romper el resto de Mi Equipo. Solo dueño/admin ven esto — un
      // encargado viendo a sus compañeros no necesita saber dónde estuvieron.
      let ultimasUbic = {};
      if ((isDueno() || isAdmin()) && window.AMG && window.AMG.GeoPing && window.AMG.GeoPing.ultimosPorPin) {
        try { ultimasUbic = await window.AMG.GeoPing.ultimosPorPin(); } catch (_) { ultimasUbic = {}; }
      }
      const hacetiempo = (ts) => {
        const min = Math.round((Date.now() - ts) / 60000);
        if (min < 1) return window.t("geo.time.now");
        if (min < 60) return window.tf("geo.time.minAgo", { n: min });
        const h = Math.round(min / 60);
        if (h < 24) return window.tf("geo.time.hAgo", { n: h });
        return window.tf("geo.time.dAgo", { n: Math.round(h / 24) });
      };

      // ===== Lista unificada del Team — TARJETAS mobile-first (JFC 2026-09-01) =====
      // Una sola lista de todo el equipo (dueño + admins + encargados), tarjetas
      // que se leen bien en vertical (nada de tablas), PIN visible a owner/admin
      // (para no repetir al crear otros), y lapicito por miembro. Sincroniza con
      // Access & recovery: ambos leen /api/usuarios (misma fuente de verdad).
      const _cardCss = "display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;padding:12px 14px;margin-bottom:8px;";
      const _badge = (txt, bg) => `<span style="font-size:12px;font-weight:700;background:${bg};color:#fff;padding:2px 8px;border-radius:10px;white-space:nowrap;">${txt}</span>`;
      const _pinChip = (pin) => `<span title="PIN" style="font-size:13px;font-weight:700;font-family:var(--font-mono);letter-spacing:.12em;background:var(--paper-deep,#E2E8ED);color:var(--ink,#0F1923);padding:2px 8px;border-radius:6px;border:1px solid var(--azul-suave,#dde5ec);">PIN ${escHtml(pin)}</span>`;
      const cards = [];
      // Tarjeta del DUEÑO (encabeza; su PIN vive cifrado en crypto-store, no aquí).
      cards.push(`
        <div class="tag-card" style="${_cardCss}background:var(--paper-deep,#E2E8ED);">
          <div style="flex:1;min-width:160px;">
            <div style="font-weight:700;font-size:15px;">${isDueno() ? "You" : "The owner"}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">
              ${_badge("Owner", "#E87A10")}
              <span style="font-size:13px;color:var(--sim-verde-dk,#1a6e3c);font-weight:700;">Active</span>
            </div>
          </div>
          <div style="font-size:13px;color:#4A5A6A;align-self:center;">Highest authority</div>
        </div>`);

      equipo.forEach((u) => {
        const estadoColor  = u.activo ? "var(--sim-verde-dk,#1a6e3c)" : "var(--rojo,#a3392a)";
        const estadoTxt    = u.activo ? "Active" : "Inactive";
        const btnEstLabel  = u.activo ? "Deactivate" : "Activate";
        const btnEstColor  = u.activo ? "var(--rojo,#a3392a)" : "var(--sim-verde-dk,#1a6e3c)";
        const rolBadge     = _badge(u.rol === "admin" ? "Admin" : "Employee", "#E87A10");
        const esMiFila = window.OCCurrentUser && String(window.OCCurrentUser.id) === String(u.id);
        const puedeEditar = isDueno() || (isAdmin() && (u.rol === "empleado" || esMiFila));
        const puedePromover = isDueno();
        const ping = ultimasUbic["u:" + u.id];
        const ubicHtml = (isDueno() || isAdmin())
          ? (ping
              ? `<div style="font-size:13px;color:var(--ink-soft);margin-top:4px;">📍 ${window.tf("geo.emp.lastSeen", { when: hacetiempo(ping.ts) })}${
                  (ping.lat != null && ping.lon != null)
                    ? ` · <a href="https://www.google.com/maps?q=${ping.lat},${ping.lon}" target="_blank" rel="noopener" style="color:var(--azul-medio);">${window.t("geo.panel.viewMap")}</a>` +
                      (ping.precision != null && ping.precision > 300
                        ? ` <span style="color:#E8A020;">(approximate, ±${ping.precision}m — not exact)</span>`
                        : ping.precision != null ? ` (±${ping.precision}m)` : "")
                    : " · " + window.t("geo.emp.noLocationThatTime")
                }</div>`
              : `<div style="font-size:13px;color:var(--ink-soft);margin-top:4px;">📍 ${window.t("geo.emp.none")}</div>`)
          : "";
        const pinChip = (_verPins && u.pin) ? _pinChip(u.pin) : "";
        const acciones = puedeEditar ? `
              <button data-toggle-id="${escHtml(u.id)}" data-activo="${u.activo}"
                style="font-size:13px;padding:6px 12px;border:2px solid ${btnEstColor};border-radius:6px;background:transparent;color:${btnEstColor};cursor:pointer;">${btnEstLabel}</button>
              <button data-cambiar-pin="${escHtml(u.id)}" title="${window.t ? window.t("team.editPin") : "Edit PIN"}" aria-label="${window.t ? window.t("team.editPin") : "Edit PIN"}"
                style="font-size:15px;padding:5px 11px;border:2px solid var(--azul-medio);border-radius:6px;background:transparent;color:var(--azul-medio);cursor:pointer;">✎ PIN</button>
              ${puedePromover ? `
                <select data-cambiar-rol="${escHtml(u.id)}" data-rol-actual="${escHtml(u.rol)}" title="Change role"
                  style="font-size:13px;padding:6px 8px;border:2px solid #E87A10;border-radius:6px;background:#fff;color:#7a4a00;cursor:pointer;">
                  <option value="empleado" ${u.rol === "empleado" ? "selected" : ""}>Employee</option>
                  <option value="admin" ${u.rol === "admin" ? "selected" : ""}>Admin</option>
                </select>` : ""}
          ` : `<span style="font-size:13px;color:var(--ink-soft);align-self:center;">Owner only</span>`;
        const pinEditor = puedeEditar ? `
          <div id="oc-pin-row-${escHtml(u.id)}" style="display:none;flex-basis:100%;background:var(--azul-suave,#EEF3F7);border-radius:8px;padding:10px 12px;margin-top:4px;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span style="font-size:13px;font-weight:700;">${window.t ? window.t("team.newPinFor") : "New PIN for"} ${escHtml(u.nombre)}:</span>
              <input data-pin-input="${escHtml(u.id)}" maxlength="3" inputmode="numeric" placeholder="3 digits"
                style="width:80px;padding:7px 10px;border:2px solid var(--azul-medio);border-radius:6px;font-size:14px;text-align:center;font-family:var(--font-mono);letter-spacing:.15em;">
              <button data-guardar-pin="${escHtml(u.id)}"
                style="padding:7px 14px;border:2px solid var(--azul-medio);border-radius:6px;background:var(--azul-medio);color:var(--blanco-calido);font-size:13px;font-weight:700;cursor:pointer;">${window.t ? window.t("team.save") : "Save"}</button>
              <span data-pin-msg="${escHtml(u.id)}" style="font-size:13px;font-weight:700;"></span>
            </div>
          </div>` : "";
        cards.push(`
          <div class="tag-card" style="${_cardCss}">
            <div style="flex:1;min-width:160px;">
              <div style="font-weight:700;font-size:15px;">${escHtml(u.nombre)}</div>
              ${u.email ? `<div style="font-size:13px;color:var(--ink-soft);">${escHtml(u.email)}</div>` : ""}
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">
                ${rolBadge}
                <span style="font-size:13px;color:${estadoColor};font-weight:700;">${estadoTxt}</span>
                ${pinChip}
              </div>
              ${ubicHtml}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;">
              ${acciones}
            </div>
            ${pinEditor}
          </div>`);
      });
      lista.innerHTML = cards.join("");
      // Alias para conservar TODOS los bindings existentes (antes era el <tbody>).
      const tbody = lista;

      // Bind: toggle activo/inactivo
      tbody.querySelectorAll("[data-toggle-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.toggleId;
          const activo = btn.dataset.activo === "true";
          try {
            const r = await fetch("/api/usuarios/" + id, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ activo: !activo }),
            });
            if (!r.ok) { const e = await r.json(); alert(e.error || "Could not update."); return; }
            await renderEmpleados();
          } catch (_) { alert("Error de red."); }
        });
      });

      // Bind: promover/degradar (solo dueño ve el selector, ver puedePromover arriba)
      tbody.querySelectorAll("[data-cambiar-rol]").forEach((btn) => {
        btn.addEventListener("change", async () => {
          const id = btn.dataset.cambiarRol;
          const rolNuevo = btn.value;
          if (rolNuevo === btn.dataset.rolActual) return;
          try {
            const r = await fetch("/api/usuarios/" + id, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rol: rolNuevo }),
            });
            if (!r.ok) { const e = await r.json(); alert(e.error || "Could not change the role."); return; }
            await renderEmpleados();
          } catch (_) { alert("Error de red."); }
        });
      });

      // Bind: mostrar/ocultar fila de cambio de PIN
      tbody.querySelectorAll("[data-cambiar-pin]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = document.getElementById("oc-pin-row-" + btn.dataset.cambiarPin);
          if (row) row.style.display = row.style.display === "none" ? "" : "none";
        });
      });

      // Bind: guardar nuevo PIN
      tbody.querySelectorAll("[data-guardar-pin]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id  = btn.dataset.guardarPin;
          const inp = tbody.querySelector(`[data-pin-input="${id}"]`);
          const msg = tbody.querySelector(`[data-pin-msg="${id}"]`);
          const pin = (inp ? inp.value : "").trim();
          msg.style.color = "var(--rojo,#a3392a)";
          if (!/^\d{3}$/.test(pin)) { msg.textContent = window.t("team.pinMustBe3Digits"); return; }
          try {
            const r = await fetch("/api/usuarios/" + id, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin }),
            });
            const data = await r.json();
            if (!r.ok) { msg.textContent = data.error || "Could not save the PIN."; return; }
            msg.style.color = "var(--sim-verde-dk,#1a6e3c)";
            msg.textContent = window.t ? window.t("team.pinUpdated") : "PIN updated.";
            // Entrega por correo (JFC 2026-07-30): mailto abre EL PROPIO cliente
            // de correo del dueño con el mensaje listo — sin backend, sin nube,
            // cumple la regla dura NUNCA CLOUD. El PIN nunca se guarda en claro
            // en ningún servidor; solo pasa por esta URL local hacia el mailer.
            const miembro = equipo.find((x) => x.id === id);
            if (miembro && miembro.email) {
              const asunto = encodeURIComponent(`Tu PIN de acceso — ${miembro.nombre}`);
              const cuerpo = encodeURIComponent(`Hola ${miembro.nombre},\n\nTu nuevo PIN de acceso es: ${pin}\n\nGuárdalo en un lugar seguro.`);
              const linkMail = document.createElement("a");
              linkMail.href = `mailto:${miembro.email}?subject=${asunto}&body=${cuerpo}`;
              linkMail.textContent = " Enviar por correo";
              linkMail.style.cssText = "margin-left:8px;color:var(--azul-medio);font-weight:700;";
              msg.appendChild(linkMail);
            }
            if (inp) inp.value = "";
            setTimeout(() => renderEmpleados(), 4000);
          } catch (_) { msg.textContent = "Error de red."; }
        });
      });

      // B-02 (2026-08-26): restaurar aviso de colisión si se perdió durante el render.
      // renderEmpleados solo toca #oc-emp-lista, pero una segunda llamada concurrente
      // puede haber limpiado #oc-emp-msg; al terminar, si había colisión pendiente, se vuelve a poner.
      if (colisionPendiente) {
        try {
          const msgElPost = document.getElementById("oc-emp-msg");
          if (msgElPost && !msgElPost.textContent) {
            msgElPost.style.color = "var(--rojo,#a3392a)";
            msgElPost.textContent = colisionPendiente;
            msgElPost.dataset.colisionPendiente = colisionPendiente;
          }
        } catch (_) {}
      }
    }

    // Bind form: agregar miembro del equipo
    document.getElementById("oc-emp-agregar").addEventListener("click", async () => {
      const nombre = (document.getElementById("oc-emp-nombre").value || "").trim();
      const email  = (document.getElementById("oc-emp-email").value  || "").trim();
      const pin    = (document.getElementById("oc-emp-pin").value    || "").trim();
      const rolSel = document.getElementById("oc-emp-rol");
      // Admin que llega aquí solo puede crear encargados; dueño puede elegir admin
      const rol = (isDueno() && rolSel) ? (rolSel.value || "empleado") : "empleado";
      const msgEl = document.getElementById("oc-emp-msg");
      msgEl.style.color = "var(--rojo,#a3392a)";
      if (!nombre) { msgEl.textContent = "El nombre es obligatorio."; return; }
      if (!/^\d{3}$/.test(pin)) { msgEl.textContent = window.t("team.pinMustBeExactly3Digits"); return; }
      try {
        const r = await fetch("/api/usuarios", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, pin, email: email || undefined, rol }),
        });
        const data = await r.json();
        if (!r.ok) { msgEl.textContent = data.error || "Could not add the team member."; return; }
        msgEl.style.color = "var(--sim-verde-dk,#1a6e3c)";
        msgEl.textContent = `${data.rol === "admin" ? "Admin" : "Employee"} "${data.nombre}" added.`;
        if (email) {
          const asunto = encodeURIComponent(`Your access PIN — ${data.nombre}`);
          const cuerpo = encodeURIComponent(`Hi ${data.nombre},

Your access PIN is: ${pin}

Keep it somewhere safe.`);
          const linkMail = document.createElement("a");
          linkMail.href = `mailto:${email}?subject=${asunto}&body=${cuerpo}`;
          linkMail.textContent = " Enviar por correo";
          linkMail.style.cssText = "margin-left:8px;color:var(--azul-medio);font-weight:700;";
          msgEl.appendChild(linkMail);
        }
        document.getElementById("oc-emp-nombre").value = "";
        document.getElementById("oc-emp-email").value  = "";
        document.getElementById("oc-emp-pin").value    = "";
        if (rolSel) rolSel.value = "empleado";
        document.getElementById("oc-emp-form-wrap").open = false;
        await renderEmpleados();
      } catch (_) { msgEl.textContent = "Error de red."; }
    });

    // Cargar equipo al montar la vista Avanzado + refrescar en cada login
    renderEmpleados();
    window.addEventListener("oc-login", renderEmpleados);

    /* REFRESH EN VIVO (2026-08-26, code-review finding #4b): cuando llega un
       cambio de equipo por sync (promote, nuevo miembro, edición de rol/PIN),
       mock-backend.js dispara oc-equipo-sync. Sin este listener la tabla
       queda estancada hasta que el usuario navega fuera y vuelve. Con él,
       cualquier cambio remoto actualiza la pantalla al instante. */
    // B-03 + B-06 (2026-08-26): renderEmpleados es async — el wrapper atrapa la Promise.
    // Debounce de 300 ms: un sync de catálogo con varios chunks puede disparar
    // oc-equipo-sync varias veces seguidas; solo re-renderizar una vez al final.
    let _renderEmpDebTimer = null;
    window.addEventListener("oc-equipo-sync", () => {
      clearTimeout(_renderEmpDebTimer);
      _renderEmpDebTimer = setTimeout(() => renderEmpleados().catch(() => {}), 300);
    });

    /* AVISO DE COLISIÓN DE PIN EN SYNC (2026-08-26, code-review finding #3b).
       aplicarCatalogo dispara oc-pin-colision cuando un miembro que llega
       por sync tiene el mismo PIN que uno ya registrado en este dispositivo.
       El merge descarta al miembro remoto (política: gana el PIN de casa),
       pero sin este aviso el dueño no sabe por qué no apareció.
       Se muestra el mensaje en el panel de equipo si está visible, o como
       alert de último recurso para que nunca pase desapercibido. */
    window.addEventListener("oc-pin-colision", function (ev) {
      try {
        const d = ev.detail || {};
        /* B-01 (2026-08-26): nunca mostrar el PIN real — es una credencial.
           B-04: si el panel de equipo no está visible, usar un toast en vez de
           alert() bloqueante (que cortaría una venta en curso). */
        const msg = `PIN conflict: ${d.nombre || "A team member"} uses a PIN that is already taken here. Change their PIN before syncing.`;
        const msgEl = document.getElementById("oc-emp-msg");
        if (msgEl) {
          msgEl.style.color = "var(--rojo,#a3392a)";
          msgEl.textContent = msg;
          // B-02: marcar el aviso con atributo para que renderEmpleados lo restaure.
          msgEl.dataset.colisionPendiente = msg;
        } else {
          // Toast no bloqueante: crear un banner temporal sobre la UI.
          try {
            const toast = document.createElement("div");
            toast.setAttribute("role", "alert");
            toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:#a3392a;color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:90vw;text-align:center;";
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => { try { document.body.removeChild(toast); } catch (_) {} }, 6000);
          } catch (_) {}
        }
      } catch (_) {}
    });
    // === FIN EQUIPO ========================================================

    // === LOG DE ACTIVIDAD (2026-07-22) =====================================
    // Disponible para dueño y admins. Muestra los últimos 100 movimientos con
    // quién los hizo, cuándo y qué (tipo + detalle). El log es append-only
    // y sellado (anti-tamper via mock-backend.js). Este panel solo LEE.
    const logPanel = document.createElement("div");
    logPanel.className = "tag-card";
    logPanel.id = "oc-log-panel";
    logPanel.style.cssText = "text-align:left;margin-top:22px;";
    logPanel.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Activity log</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Últimos 100 movimientos registrados en este dispositivo. Cada entrada incluye
        quién lo hizo y cuándo. El historial es de solo lectura — no se puede editar.
      </p>
      <button id="oc-log-cargar"
        style="font-size:13px;padding:7px 14px;border:2px solid var(--azul-medio);
               border-radius:6px;background:transparent;color:var(--azul-medio);cursor:pointer;margin-bottom:12px;">
        Cargar historial
      </button>
      <div id="oc-log-body"></div>`;
    vista.appendChild(logPanel);

    document.getElementById("oc-log-cargar").addEventListener("click", async () => {
      const logBody = document.getElementById("oc-log-body");
      logBody.innerHTML = '<p style="font-size:13px;color:var(--ink-soft);">Cargando...</p>';
      try {
        const r = await fetch("/api/actividad");
        if (!r.ok) { logBody.innerHTML = '<p style="color:var(--rojo,#a3392a);">No se pudo cargar el historial.</p>'; return; }
        const movs = await r.json();
        if (!movs.length) { logBody.innerHTML = `<p style="font-size:14px;color:var(--ink-soft);">${window.t("log.noMovementsYet")}</p>`; return; }
        const tipoLabel = (t) => {
          const m = {
            alta: window.t("log.type.alta"), venta: window.t("log.type.venta"), ajuste: window.t("log.type.ajuste"),
            edicion: window.t("log.type.edicion"), baja: window.t("log.type.baja"),
            "usuario-alta": window.t("log.type.usuarioAlta"), "usuario-editar": window.t("log.type.usuarioEditar"),
            transferencia: window.t("log.type.transferencia"), liquidacion: window.t("log.type.liquidacion"), estrella: window.t("log.type.estrella")
          };
          return m[t] || t;
        };
        /* Scroll al resultado (2026-08-26, UX sweep L5 / B-10 fix): usar el
           contenedor scroll del riel flex si existe, y caer a scrollIntoView
           solo si no hay un panel con overflow-y:auto más cercano. */
        setTimeout(function () {
          try {
            // El riel flex pone el contenido en #oc-riel-cont (o similar); buscar
            // el primer ancestro scrolleable para hacer scrollTop en vez de scrollIntoView.
            let scrollEl = logBody.parentElement;
            while (scrollEl && scrollEl !== document.body) {
              const ov = getComputedStyle(scrollEl).overflowY;
              if (ov === "auto" || ov === "scroll") { scrollEl.scrollTop = logBody.offsetTop; return; }
              scrollEl = scrollEl.parentElement;
            }
            logBody.scrollIntoView({ behavior: "smooth", block: "start" });
          } catch (_) {}
        }, 80);
        logBody.innerHTML = `<div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="border-bottom:2px solid var(--azul-suave,#dde5ec);">
              <th style="text-align:left;padding:5px 8px;font-weight:700;white-space:nowrap;">Cuándo</th>
              <th style="text-align:left;padding:5px 8px;font-weight:700;">Quién</th>
              <th style="text-align:left;padding:5px 8px;font-weight:700;">Qué</th>
            </tr></thead>
            <tbody>${movs.slice(0, 100).map((m) => {
              const fecha = new Date(m.fecha).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
              const det   = m.detalle ? Object.entries(m.detalle).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
              return `<tr style="border-bottom:1px solid var(--azul-suave,#dde5ec);">
                <td style="padding:5px 8px;white-space:nowrap;color:var(--ink-soft);">${escHtml(fecha)}</td>
                <td style="padding:5px 8px;font-weight:700;">${escHtml(m.usuarioNombre || "Sistema")}</td>
                <td style="padding:5px 8px;">${escHtml(tipoLabel(m.tipo))}${det ? ` — <span style="color:var(--ink-soft);">${escHtml(det)}</span>` : ""}</td>
              </tr>`;
            }).join("")}</tbody>
          </table></div>`;
      } catch (_) { logBody.innerHTML = '<p style="color:var(--rojo,#a3392a);">Error de red.</p>'; }
    });
    // === FIN LOG ===========================================================

    // === CONTROL ANTI FRAUDE (2026-07-08) ==================================
    // Integridad del historial (cadena de sellos anti-tamper) + señales de las
    // 3 vias tipicas de falseo del encargado: anular ventas para quedarse el
    // efectivo, bajar stock a mano ("merma") para tapar un robo, y editar/borrar
    // el propio log para ocultar lo anterior. Todo el bloque va en su propio
    // try/catch: si algo falla, NO tumba el resto de Avanzado (wall defensiva).
    try {
      const afPanel = document.createElement("div");
      afPanel.className = "tag-card";
      afPanel.id = "oc-antifraude-panel";
      afPanel.style.cssText = "text-align:left;margin-top:22px;";
      afPanel.innerHTML = `
        <h3 class="seccion" style="margin-top:0;">Fraud control</h3>
        <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">History integrity and daily risk signals. Every movement is sealed: if someone edits or deletes the history on this device, it shows here.</p>
        <div id="oc-af-integridad" style="margin-bottom:14px;"></div>
        <div id="oc-af-senales"></div>
        <button id="oc-af-refrescar" class="ir" style="margin-top:12px;background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Verify now</button>
        <p style="font-size:13px;color:var(--ink-soft);margin:10px 0 0;">The seal detects casual tampering. It's not expert-proof (the device is local), but it leaves evidence of any common edit.</p>`;
      vista.appendChild(afPanel);

      async function renderAntiFraude() {
        // 1) Integridad del historial
        const cont = $("oc-af-integridad");
        if (cont) {
          try {
            const d = await (await fetch("/api/integridad")).json();
            if (d.ok) {
              cont.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:#e7f7ee;border:2px solid #1a6e3c;"><strong style="color:#1a6e3c;">✓ History intact</strong> <span style="color:#0F1923;font-size:14px;">— ${d.sellados} movement(s) sealed${d.historico ? ", " + d.historico + " unsealed historic(s)" : ""}.</span></div>`;
            } else {
              const det = d.ruptura
                ? `at position ${d.ruptura.index} (${escHtml(d.ruptura.tipo)} · ${escHtml(d.ruptura.usuarioNombre)} · ${escHtml(new Date(d.ruptura.fecha).toLocaleString())}) — ${escHtml(d.ruptura.motivo)}`
                : (d.colaOk === false ? "end of history was trimmed" : "inconsistency detected");
              cont.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:#fdecea;border:2px solid #a3392a;"><strong style="color:#a3392a;">History has been altered</strong> <span style="color:#0F1923;font-size:14px;">— ${det}.</span></div>`;
            }
          } catch (_) { cont.innerHTML = ""; }
        }
        // 2) Señales del día por persona
        const sen = $("oc-af-senales");
        if (sen) {
          try {
            const movs = await (await fetch("/api/actividad")).json();
            /* BUG DE ATRIBUCION (JFC 2026-08-19). Habia DOS errores de zona
               horaria encadenados, y juntos dejaban este panel en blanco cada
               noche:
                 1. "hoy" salia de toISOString(), que es UTC. En Guayaquil
                    (UTC-5), a partir de las 19:00 locales el UTC ya es el dia
                    siguiente, asi que "hoy" apuntaba a manana.
                 2. m.fecha es un ISO en UTC, y cortarlo con slice(0,10) da el
                    dia UTC, no el dia del negocio.
               Resultado: despues de las 19:00 el panel antifraude decia "sin
               actividad hoy" con el local lleno de ventas. Justo la hora en que
               un dueno revisa anulaciones y mermas.
               Se usa la MISMA zona que el resto de la app (f123_timezone, la
               que el dueno fija en Avanzado), igual que hoyISO() en
               mock-backend.js. Misma zona en los dos lados de la comparacion. */
            const _zona = (function () {
              try {
                const tz = localStorage.getItem("f123_timezone");
                if (!tz) return Intl.DateTimeFormat().resolvedOptions().timeZone;
                Intl.DateTimeFormat(undefined, { timeZone: tz });
                return tz;
              } catch (_) { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
            })();
            const _diaLocal = (d) => {
              try {
                return new Intl.DateTimeFormat("en-CA", { timeZone: _zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
              } catch (_) { return ""; }
            };
            const hoy = _diaLocal(new Date());
            const delHoy = (Array.isArray(movs) ? movs : []).filter((m) => m && m.fecha && _diaLocal(new Date(m.fecha)) === hoy);
            const anul = {}, merma = {};
            delHoy.forEach((m) => {
              const q = m.usuarioNombre || "Sistema";
              if (m.tipo === "anulacion") anul[q] = (anul[q] || 0) + 1;
              if (m.tipo === "ajuste" && m.detalle && Number(m.detalle.delta) < 0) merma[q] = (merma[q] || 0) + Math.abs(Number(m.detalle.delta));
            });
            const bloque = (titulo, obj, unidad) => {
              const ents = Object.entries(obj);
              if (!ents.length) return `<p style="font-size:14px;color:var(--ink-soft);margin:6px 0;">${titulo}: no activity today.</p>`;
              return `<p style="font-size:14px;font-weight:700;color:var(--ink);margin:10px 0 2px;">${titulo}:</p>` +
                ents.map(([n, v]) => `<div style="font-size:14px;color:#0F1923;padding:2px 0;">• ${escHtml(n)}: <strong>${v}</strong> ${unidad}</div>`).join("");
            };
            sen.innerHTML =
              bloque("Voided sales per person (today)", anul, "void(s)") +
              bloque("Manual stock reductions / shrinkage per person (today)", merma, "unit(s)");
          } catch (_) { sen.innerHTML = ""; }
        }
      }
      const btnAF = $("oc-af-refrescar");
      if (btnAF) btnAF.addEventListener("click", renderAntiFraude);
      renderAntiFraude();
      window.addEventListener("oc-login", renderAntiFraude);
    } catch (e) { console.error("Panel anti fraude no cargó (aislado, no rompe Avanzado):", e); }
    // === FIN CONTROL ANTI FRAUDE ===========================================


    // FIX (JFC 2026-07-03): el gestor de perchas (crear/renombrar/desactivar)
    // vivia duplicado aqui en Avanzado ("mala idea mia" -- JFC). Se quito: el
    // gestor canonico vive en Inventario -> Perchas (mismo alcance + sucursales
    // + mover/borrar, que este duplicado no tenia). Ver renderPerchaCard()/
    // cargarPerchas() en index.html.

    // --- Transferencias MOVIDAS A PERCHAS (JFC 2026-08-28). Eran una operación
    // de inventario entre ubicaciones que vivía en Advanced (configuración
    // técnica). El usuario piensa en perchas cuando mueve stock, así que el
    // panel y su render viven ahora en vista-perchas.js (sección #vp-transfers).

    // --- Sync remoto (PocketBase) ELIMINADO DE AVANZADO (JFC 2026-08-28).
    // Era una 3ª forma de sync (conectar con el panel central de JFC) que
    // abrumaba al usuario. El sync en tiempo real (relay, panel oc-sync-panel)
    // ya mantiene los dispositivos al día solo. La conexión PocketBase es una
    // herramienta del lord/panel central, no del usuario normal — se gestiona
    // desde el panel del lord (panel.html), no desde Advanced. El adaptador
    // sigue en docs/pocketbase-client.js (backend), solo se quita la UI aquí.

    // --- Sync entre dispositivos (lazy sync cifrado, JFC 2026-07-04) ---
    // Distinto del panel de arriba: aquel es para recibir actualizaciones
    // desde EL PANEL CENTRAL de JFC (PocketBase); este es para que DOS
    // DISPOSITIVOS DEL MISMO NEGOCIO (ej. caja + bodega) se pongan al día
    // entre ellos, cifrado de punta a punta con el PIN del dueño.
    /* MICELIO VIVO — portado de amigable-123 (595bc18), 2026-08-19.
       En friendly-123 este panel NO SE DIBUJABA NUNCA: micelio-ui.js hace
       pintarPanel() buscando #oc-micelio-panel y aqui no habia contenedor
       ninguno, asi que "quien esta en el loop y quien anda a ciegas" existia
       en el codigo pero era invisible para el usuario.

       Va como TARJETA PROPIA, no anidada dentro del panel de sync: el riel de
       navegacion de Avanzado arma su menu con los hijos DIRECTOS de la vista,
       y meterla dentro de otro panel lo descoloca (ese fue el bug de amigable).
       NO volver a anidarla. Si micelio-ui.js no carga, el try deja el hueco
       vacio y Avanzado sigue entero. */
    try {
      const micPanel = document.createElement("div");
      micPanel.className = "tag-card";
      micPanel.style.cssText = "text-align:left;margin-top:22px;";
      micPanel.innerHTML = '<h3 class="seccion" style="margin-top:0;">' + window.t("adv.teamNow") + '</h3><div id="oc-micelio-panel"></div>';
      vista.appendChild(micPanel);
      if (window.OCMicelioUI) window.OCMicelioUI.pintarPanel();
      /* ESTADO VACÍO (2026-08-26, UX sweep P6): pintarPanel() puede poblar el div de
         forma asíncrona (datos de red), así que esperamos 2s antes de verificar.
         Si el div sigue vacío, mostramos un texto en vez de dejar el panel en blanco —
         un panel vacío parece roto; el texto deja claro que es el estado normal. */
      setTimeout(function () {
        try {
          const mp = document.getElementById("oc-micelio-panel");
          if (mp && !mp.children.length && !mp.textContent.trim()) {
            mp.innerHTML = '<p style="font-size:14px;color:var(--ink-soft);">No other devices connected right now.</p>';
          }
        } catch (_) {}
      }, 2000);
    } catch (e) { console.error("Panel micelio no cargo (aislado, no rompe Avanzado):", e); }

    // --- Device sync (lazy manual) ELIMINADO DE AVANZADO (JFC 2026-08-28).
    // Era la 2ª forma de sync visible (copiar/pegar/WhatsApp/merge) que
    // abrumaba y sugería que el sync automático no bastaba. El sync en tiempo
    // real (relay, panel oc-sync-panel) ya mantiene los dispositivos al día
    // solo, cada pocos segundos, por la licencia. La redundancia manual vive
    // en el backend (OCSync), no como opciones que el usuario deba tocar.

    // === RIEL FLEX (JFC 2026-07-30, importado de su avance en otra sesion,
    // "SOLO el menu de Avanzados en cascada/texto, be surgical") ===========
    // Menu izquierdo fijo + columna de contenido a la derecha. TODO el
    // contenido sigue visible (scroll), un click en el menu hace scrollIntoView
    // a esa seccion — no hay display:none escondiendo nada. No reconstruye
    // ningun panel, solo reparenta nodos DOM ya vivos y con sus listeners
    // atados. "Como funciona?" nunca es su propia entrada del menu. Cada
    // seccion reconocida se explica con un hint breve. Si el riel falla,
    // los paneles ya armados quedan visibles tal cual estaban - cero riesgo
    // (ver feedback_aislar_fallos_ui_nunca_datos).
    function enlaceArriba() {
      const d = document.createElement("div");
      d.className = "oc-back-top";
      d.style.cssText = "text-align:right;margin:8px 0 20px;";
      const label = (window.t ? window.t("adv.backToTop") : "Back to top");
      d.innerHTML = '<a href="#vista-avanzado" onclick="volverArribaAvanzado();return false;" style="font-size:13px;font-weight:700;color:var(--azul-medio,#2c4a68);text-decoration:none;cursor:pointer;">↑ <span data-i18n="adv.backToTop">' + label + "</span></a>";
      return d;
    }
    function quitarTops(scope) {
      if (!scope) return;
      Array.from(scope.querySelectorAll('[data-i18n="adv.backToTop"]')).forEach(function (span) {
        const box = span.closest("div");
        if (box && box.parentNode) box.parentNode.removeChild(box);
      });
    }
    function esInicioSeccion(n) {
      if (!n || n.nodeType !== 1) return false;
      if (n.classList && n.classList.contains("oc-back-top")) return false;
      if (n.tagName === "H3") return true;
      if (n.id === "oc-contable" || n.id === "oc-acct-lock" || n.id === "oc-firststeps") return true;
      if (n.querySelector && n.querySelector(":scope > h3, :scope > h4")) return true;
      return false;
    }
    function repartirBackToTop(scope) {
      if (!scope) return;
      quitarTops(scope);
      const raw = Array.from(scope.children);
      let i = 0;
      while (i < raw.length) {
        const ch = raw[i];
        if (!ch || !ch.parentNode) { i++; continue; }
        if (ch.id === "oc-contable") { repartirBackToTop(ch); i++; continue; }
        if (ch.tagName === "DETAILS") { i++; continue; }
        if (ch.classList && ch.classList.contains("oc-back-top")) { i++; continue; }
        if (!esInicioSeccion(ch)) { i++; continue; }
        let last = ch;
        let k = i + 1;
        while (k < raw.length) {
          const nx = raw[k];
          if (!nx) break;
          if (nx.id === "oc-contable") break;
          if (esInicioSeccion(nx) || nx.tagName === "H3") break;
          last = nx;
          k++;
        }
        last.insertAdjacentElement("afterend", enlaceArriba());
        i = k;
      }
    }
    (function () {
      try {
        quitarTops(vista);
        const HINTS = {
          "Accounting": "T-accounts, P&L, balance sheet, valued inventory. Needs a passcode.",
          "Recent activity": "Today's operational history.",
          "Timezone": "Sets what counts as \"today\" for sales and closes.",
          "Monthly expenses": "Rent, payroll, utilities… prorated into the P&L.",
          "Access & recovery": "Email, WhatsApp, PINs and password.",
          "Sync your team": "Live sync across every device on your team.",
          "Team": "Team members, roles and PINs for this business.",
          "Activity log": "Who did what, and when.",
          "Your team right now": "Who is synced and who is not.",
          "Fraud control": "Integrity of sensitive operations.",
          "Where the team has been": "Location pings while a session is open.",
        };
        /* ICONOS DEL RIEL (2026-08-26, UX sweep H1): un carácter Unicode geométrico
           antes de cada label mejora el escaneado vertical en desktop y horizontal
           en mobile. Solo aquí en Advanced — no afecta al nav principal de la app.
           Claves en inglés Y español para que funcione en ambos idiomas.
           Unicode geométrico básico (BMP): renderiza igual en iOS, Android, Chrome y Safari. */
        const ICONS = {
          "First Steps": "â—Ž", "Primeros Pasos": "â—Ž",
          "Sync your team": "⇄", "Sincronizar equipo": "⇄",
          "Team": "⊕", "Equipo": "⊕",
          "Activity log": "≡", "Actividad reciente": "≡", "Recent activity": "≡",
          "Fraud control": "⊙", "Control antifraude": "⊙",
          "Your team right now": "●", "Tu equipo ahora": "●",
          "Access & recovery": "◈", "Acceso y recuperación": "◈",
          "Accounting": "â–¤", "Contabilidad": "â–¤",
          "Backup": "â—‰", "Respaldo": "â—‰",
          "Accounting report": "â–¦", "Reporte contable": "â–¦",
          "Location comparison (this month)": "▧", "Comparación de perchas": "▧",
          "Where the team has been": "⊛",
        };
        function esComo(t) { t = (t || "").trim(); return /^¿?Cómo funciona/i.test(t) || /^How does it work/i.test(t); }
        function tituloDe(n) {
          if (!n || n.nodeType !== 1) return null;
          if (n.id === "oc-acct-lock") return (window.t ? window.t("adv.acct.tab", "Accounting") : "Accounting");
          if (n.id === "oc-contable" || n.id === "oc-riel-fila" || n.id === "oc-riel-nav" || n.id === "oc-riel-contenido") return null;
          if (/^H[1-6]$/.test(n.tagName)) { const t = n.textContent.trim(); return esComo(t) ? null : (t || null); }
          if (n.tagName === "DETAILS") { const s = n.querySelector("summary"); if (!s) return null; const ts = s.textContent.trim(); return esComo(ts) ? null : (ts || null); }
          let h = null; try { h = n.querySelector(":scope > h3, :scope > h4"); } catch (_) {}
          if (!h) h = n.querySelector("h3,h4");
          if (!h) return null;
          const th = h.textContent.trim(); return esComo(th) ? null : (th || null);
        }
        function idDe(n, i) { if (n.id === "oc-acct-lock" || n.id === "amg-geo-caja") return n.id; if (!n.id) n.id = "oc-riel-a" + i; return n.id; }
        function hint(n, t) {
          if (!HINTS[t] || n.querySelector(".oc-riel-hint")) return;
          const p = document.createElement("p");
          p.className = "oc-riel-hint";
          p.style.cssText = "font-size:13px;color:var(--ink-soft,#5d5340);margin:0 0 10px;line-height:1.45;";
          p.textContent = HINTS[t];
          try { const h = n.querySelector("h3,h4"); if (h) h.insertAdjacentElement("afterend", p); else n.insertBefore(p, n.firstChild); } catch (_) {}
        }

        const prev = document.getElementById("oc-riel-fila");
        if (prev) { const c0 = document.getElementById("oc-riel-contenido"); if (c0) { while (c0.firstChild) vista.appendChild(c0.firstChild); } prev.remove(); }

        const fila = document.createElement("div"); fila.id = "oc-riel-fila";
        fila.style.cssText = "display:flex;align-items:flex-start;gap:0;margin:8px 0 12px;width:100%;box-sizing:border-box;";
        const rNav = document.createElement("div"); rNav.id = "oc-riel-nav"; rNav.setAttribute("role", "navigation"); rNav.setAttribute("aria-label", "Advanced sections");
        rNav.style.cssText = "flex:0 0 148px;width:148px;position:sticky;top:8px;align-self:flex-start;padding:0 10px 0 0;margin:0 14px 0 0;border-right:2px solid var(--azul-suave,#dde5ec);display:flex;flex-direction:column;max-height:calc(100vh - 24px);overflow-y:auto;background:var(--blanco-calido,#F8F9FB);z-index:3;box-sizing:border-box;";
        const contR = document.createElement("div"); contR.id = "oc-riel-contenido";
        contR.style.cssText = "flex:1 1 0%;min-width:0;box-sizing:border-box;";

        const kids = Array.prototype.slice.call(vista.children);
        const mover = [], secciones = []; let idx = 0;
        kids.forEach((n, i) => {
          if (i < 3) return; // titulo + intro + "how does it work" quedan fuera del riel
          if (n.id === "oc-riel-fila" || n.id === "oc-firststeps") return;
          if (n.tagName === "DETAILS") { const sm = n.querySelector("summary"); if (sm && esComo(sm.textContent)) return; }
          /* Huérfanos "Back to top": el riel los trata como hijos sueltos y
             los apila al final (4 seguidos). Se redistribuyen después. */
          if (n.querySelector && n.querySelector('[data-i18n="adv.backToTop"]') && !n.querySelector("h3,h4") && n.children.length <= 1) return;
          mover.push(n);
        });

        /* PRIMEROS PASOS + ORDEN DEL RIEL (JFC 2026-08-25).
           1) Se inyecta una seccion "First Steps / Primeros Pasos" que va SIEMPRE
              primera: es lo que orienta a quien recien entra.
           2) Las demas se ordenan de lo mas indispensable (Team) a lo mas arcano
              (sync entre dispositivos, PocketBase). El orden NO se puede basar en
              el texto del titulo porque "Sync your team" viaja traducido; se
              detecta por id o por un hijo estable, asi funciona en EN y ES.
           Lo que no reconozcamos conserva su orden original (sort estable). */
        (function () {
          try {
            {
              /* Siempre se reconstruye: asi el riel lo vuelve a tomar en cada
                 render (cambio de idioma, re-abrir Avanzado) y el texto queda en
                 el idioma actual. El skip en kids.forEach evita duplicarlo. */
              const viejo = document.getElementById("oc-firststeps");
              if (viejo && viejo.parentNode) viejo.parentNode.removeChild(viejo);
              const T = (k, f) => (window.t ? window.t(k, f) : f);
              const fs = document.createElement("div");
              fs.id = "oc-firststeps"; fs.className = "tag-card"; fs.style.cssText = "text-align:left;";
              const pasos = [1, 2, 3, 4, 5].map((i) =>
                `<li style="margin:0 0 12px;line-height:1.5;">` +
                  `<strong style="color:var(--ink,#211c14);">${T("firststeps.s" + i + "t", "")}</strong><br>` +
                  `<span style="color:var(--ink-soft,#5d5340);">${T("firststeps.s" + i, "")}</span></li>`
              ).join("");
              /* La guia paso a paso es un EXTRA, no el camino. Va en una caja aparte
                 con borde punteado y marcada "optional / opcional": quien sabe leer
                 sigue la lista; quien prefiere que le muestren, toca el tour. El
                 tour reusa el OCTutorial bilingue que ya existe (no se porto el de
                 amigable, que es solo-ES y va por detras — regla 1b). */
              fs.innerHTML =
                `<h3 class="seccion" style="margin-top:0;">${T("firststeps.title", "First Steps")}</h3>` +
                `<p style="font-size:14px;color:var(--ink-soft,#5d5340);margin-top:0;">${T("firststeps.intro", "")}</p>` +
                `<ol style="font-size:14px;color:var(--ink,#211c14);padding-left:20px;margin:0 0 4px;">${pasos}</ol>` +
                `<div style="margin-top:14px;padding:12px 14px;border:1px dashed var(--azul-suave,#c9d6e2);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">` +
                  `<span style="font-size:13px;color:var(--ink-soft,#5d5340);">${T("firststeps.tourNote", "")}</span>` +
                  `<button type="button" id="oc-fs-tour" style="flex:0 0 auto;font-size:13px;font-weight:700;padding:8px 14px;border:2px solid var(--azul-medio,#2c4a68);border-radius:8px;background:transparent;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;cursor:pointer;">${T("firststeps.tourBtn", "Take the guided tour")} <span style="opacity:.7;font-weight:400;">· ${T("firststeps.tourOptional", "optional")}</span></button>` +
                `</div>`;
              try {
                const bTour = fs.querySelector("#oc-fs-tour");
                if (bTour) bTour.addEventListener("click", function () {
                  try { if (window.OCTutorial && window.OCTutorial.iniciar) window.OCTutorial.iniciar(); } catch (_) {}
                });
              } catch (_) {}
              mover.unshift(fs);
            }
          } catch (_) {}
        })();

        function rangoRiel(n) {
          try {
            if (n.id === "oc-firststeps") return 0;
            const q = (sel) => { try { return !!n.querySelector(sel); } catch (_) { return false; } };
            const th = (function () { const h = (n.querySelector && n.querySelector("h3,h4")); return h ? h.textContent.trim() : ""; })();
            if (/^Team$/i.test(th)) return 10;                      // equipo: lo primero util
            if (q("#oc-sync-codigo") || q("#oc-sync-activar")) return 20; // Sync your team (traducido)
            if (/Access & recovery/i.test(th)) return 25;
            if (n.id === "oc-acct-lock" || n.id === "oc-contable") return 30; // Accounting
            if (/Recent activity/i.test(th)) return 40;
            if (/Activity log/i.test(th)) return 45;
            if (q("#oc-micelio-panel")) return 50;                  // Your team right now
            if (/Timezone/i.test(th)) return 60;
            if (/Monthly expenses/i.test(th)) return 65;
            if (/Fraud control/i.test(th)) return 75;
            if (n.id === "amg-geo-caja") return 80;                 // Where the team has been
            if (q("#oc-sync-panel")) return 90;                    // Sync (real-time)
          } catch (_) {}
          return 500; // desconocido: se queda donde estaba (sort estable)
        }
        mover.map((n, i) => ({ n, i, r: rangoRiel(n) }))
             .sort((a, b) => (a.r - b.r) || (a.i - b.i))
             .forEach((o, j) => { mover[j] = o.n; });

        mover.forEach((n) => {
          contR.appendChild(n);
          if (n.id === "oc-contable") return;
          const t = tituloDe(n); if (!t) return;
          const id = idDe(n, idx++); hint(n, t); secciones.push({ id, label: t });
        });
        rNav.innerHTML = secciones.map((s) => {
          const ico = ICONS[s.label] ? `<span aria-hidden="true" style="display:inline-block;width:1.4em;text-align:center;opacity:.75;">${ICONS[s.label]}</span>` : "";
          return `<button type="button" data-riel-go="${s.id}" style="display:block;width:100%;text-align:left;background:none;border:none;border-left:3px solid transparent;padding:9px 8px;margin:0;font-size:13px;font-weight:700;cursor:pointer;line-height:1.3;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;">${ico}${s.label}</button>`;
        }).join("");
        fila.appendChild(rNav); fila.appendChild(contR); vista.appendChild(fila);

        function activo(id) {
          /* ESTADO ACTIVO (2026-08-26, UX sweep L1): en desktop el indicador
             es la barra izquierda (border-left) + fondo azul suave. En mobile
             los chips son horizontales y border-left no es visible, así que el
             chip activo toma fondo naranja (#E87A10) con texto blanco — mismo
             naranja que los badges del equipo (coherencia de paleta). */
          const angosto = window.matchMedia && window.matchMedia("(max-width:720px)").matches;
          rNav.querySelectorAll("[data-riel-go]").forEach((b) => {
            const a = b.getAttribute("data-riel-go") === id;
            b.style.borderLeftColor = (!angosto && a) ? "var(--azul-medio,#2c4a68)" : "transparent";
            b.style.background = a ? (angosto ? "#E87A10" : "var(--azul-suave,#dde5ec)") : "none";
            b.style.color = a ? (angosto ? "#fff" : "var(--azul-medio,#2c4a68)") : "var(--ink-soft,#5d5340)";
            b.style.setProperty("-webkit-text-fill-color", a ? (angosto ? "#fff" : "var(--azul-medio,#2c4a68)") : "var(--ink-soft,#5d5340)");
            if (angosto && a) b.style.borderRadius = "20px";
            else if (angosto) b.style.borderRadius = "";
          });
        }
        rNav.addEventListener("click", (e) => {
          const b = e.target.closest("[data-riel-go]"); if (!b) return;
          const id = b.getAttribute("data-riel-go"), el = document.getElementById(id);
          if (el) { try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { el.scrollIntoView(true); } activo(id); try { localStorage.setItem("f123_riel_tab", id); } catch (_) {} }
        });
        try { const last = localStorage.getItem("f123_riel_tab"); if (last && document.getElementById(last)) activo(last); else if (secciones[0]) activo(secciones[0].id); } catch (_) { if (secciones[0]) activo(secciones[0].id); }

        const obs = new MutationObserver((muts) => {
          muts.forEach((m) => {
            m.addedNodes.forEach((n) => {
              if (n.nodeType !== 1 || n === fila) return;
              if (n.parentNode === vista) contR.appendChild(n);
              if (n.parentNode !== contR && n.parentNode !== vista) return;
              const t = tituloDe(n); if (!t) return;
              const id = idDe(n, secciones.length);
              if (secciones.some((s) => s.id === id)) return;
              hint(n, t); secciones.push({ id, label: t });
              const b = document.createElement("button"); b.type = "button"; b.setAttribute("data-riel-go", id);
              b.style.cssText = "display:block;width:100%;text-align:left;background:none;border:none;border-left:3px solid transparent;padding:9px 8px;margin:0;font-size:13px;font-weight:700;cursor:pointer;line-height:1.3;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;";
              /* Inyectar icono del mapa ICONS al botón agregado tardíamente (MutationObserver) */
              const ico2 = ICONS[t] ? `<span aria-hidden="true" style="display:inline-block;width:1.4em;text-align:center;opacity:.75;">${ICONS[t]}</span>` : "";
              b.innerHTML = ico2 + escHtml(t); rNav.appendChild(b);
              // B-11 (2026-08-26): re-aplicar estado activo después de agregar el
              // chip; de lo contrario el chip tardío aparece sin resaltar aunque
              // su sección sea la activa en este momento.
              try { const cur = localStorage.getItem("f123_riel_tab"); if (cur) activo(cur); } catch (_) {}
            });
          });
        });
        obs.observe(vista, { childList: true });
        obs.observe(contR, { childList: true });

        function resp() {
          try {
            const angosto = window.matchMedia && window.matchMedia("(max-width:720px)").matches;
            if (angosto) {
              fila.style.flexDirection = "column";
              fila.style.overflow = "hidden";
              /* DOS BUGS que hacian "retazos encima de retazos" en el telefono.
                 Portado de amigable-123 (23ce907, 2026-08-16), reproducido
                 igual en friendly-123 el 2026-08-19:

                 1. Faltaba display:flex. cssText REEMPLAZA todo el estilo, y el
                    modo ancho si lo pone: al pasar a angosto el nav perdia el
                    flex y los chips se desbordaban unos sobre otros.
                 2. position:sticky con overflow:visible dejaba el nav FLOTANDO
                    sobre el contenido al hacer scroll. En angosto va estatico.

                 Y con tope de alto: 18 chips sin limite empujaban el contenido
                 tan abajo que parecia que la seccion estaba vacia. */
              rNav.style.cssText = "display:flex;flex:0 0 auto;width:100%;box-sizing:border-box;position:static;top:auto;max-height:34vh;overflow-y:auto;-webkit-overflow-scrolling:touch;flex-direction:row;flex-wrap:wrap;gap:6px;align-content:flex-start;border-right:none;border-bottom:2px solid var(--azul-suave,#dde5ec);padding:8px 0;margin:0 0 14px 0;background:var(--blanco-calido,#F8F9FB);";
              rNav.querySelectorAll("[data-riel-go]").forEach((b) => { b.style.width = "auto"; b.style.flex = "0 0 auto"; b.style.borderLeft = "none"; b.style.margin = "0"; b.style.padding = "9px 12px"; b.style.whiteSpace = "nowrap"; });
            } else {
              fila.style.flexDirection = "row";
              fila.style.overflow = "";
              rNav.style.cssText = "flex:0 0 148px;width:148px;position:sticky;top:8px;align-self:flex-start;padding:0 10px 0 0;margin:0 14px 0 0;border-right:2px solid var(--azul-suave,#dde5ec);display:flex;flex-direction:column;max-height:calc(100vh - 24px);overflow-y:auto;background:var(--blanco-calido,#F8F9FB);z-index:3;box-sizing:border-box;";
              rNav.querySelectorAll("[data-riel-go]").forEach((b) => { b.style.width = "100%"; b.style.padding = "9px 8px"; });
            }
          } catch (_) {}
        }
        /* GUARDS (portado de amigable-123, 23ce907): el layout se recalcula en
           cada evento que puede cambiarlo. Antes se calculaba SOLO al arrancar,
           asi que girar el telefono, o que el MutationObserver agregara una
           entrada nueva al riel, lo dejaba con las medidas viejas. */
        resp();
        try { window.addEventListener("resize", resp); } catch (_) {}
        try { window.addEventListener("orientationchange", resp); } catch (_) {}
        try {
          const mq = window.matchMedia && window.matchMedia("(max-width:720px)");
          if (mq && mq.addEventListener) mq.addEventListener("change", resp);
          else if (mq && mq.addListener) mq.addListener(resp);
        } catch (_) {}
        try { obs.observe(rNav, { childList: true }); new MutationObserver(resp).observe(rNav, { childList: true }); } catch (_) {}
        try { repartirBackToTop(contR); } catch (_) {}
      } catch (_) { /* si el riel falla, los paneles ya armados arriba siguen visibles tal cual estaban - cero riesgo */ }
    })();

    window.OCAuth.listo().then(() => { pintarEmail(); pintarWhatsapp(); });

    // NOTA (JFC 2026-08-29, fusión de listas de PIN): el flujo de "rotar los
    // 3 PINs a ciegas" (oc-save-codes / oc-c-owner / oc-c-owner2 / oc-c-emp /
    // oc-c-acct) se retiró — quedaba redundante con el panel de PINs visibles
    // de abajo, que ya permite editar cada PIN por separado con su lápiz. Los
    // dos resguardos que solo tenía este flujo (confirmación doble del PIN del
    // dueño y exigir email de recuperación antes de cambiarlo) se movieron al
    // editor individual del PIN del dueño (ver pintarPinsVisibles → rol==="owner").

    /* PINs VISIBLES + APODO (JFC 2026-08-27). Solo para el dueño (soporte de
       JFC). Pinta los PINs actuales desde las copias XOR y el apodo del
       dispositivo con lapicito. */
    function _esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function pintarPinsVisibles() {
      const cuerpo = $("oc-pins-visibles-cuerpo");
      if (!cuerpo) return;
      let pins = null;
      try { pins = window.OCSecure.leerPinsVisibles(); } catch (_) {}
      /* Defaults (JFC 2026-08-28): si no hay copia visible de un PIN (se fijó
         antes de que existieran las copias XOR), se muestra el default del
         sistema — Staff 260, Accounting 357 — en vez de un guión vacío. El
         dueño/admin puede cambiarlos con los lapicitos de abajo. */
      const emp = (pins && pins.empleados && pins.empleados.length) ? pins.empleados.join(", ") : "260";
      const acct = (pins && pins.acct) ? pins.acct : "357";
      const abre = (window.OCSecure && window.OCSecure.leerPinQueAbre) ? (window.OCSecure.leerPinQueAbre() || {}) : {};
      let owner = abre.owner || (pins && pins.owner) || "";
      if (owner === "888" && abre.owner !== "888") owner = abre.owner || "789";
      if (!owner) owner = "789";
      /* LAPICITOS DE EDICIÓN INDIVIDUAL (JFC 2026-08-28). Cada PIN se edita
         por separado con su lapicito, en la cascada de jerarquía: el dueño
         edita los tres; el admin edita SOLO el de encargado (no el del dueño
         ni el contable). El lapicito pide el PIN nuevo (3 dígitos) y llama a
         la función individual de crypto-store (fijarOwnerPin/fijarEmpleadoPin/
         fijarAcctPin), que NO rota los otros PINs. */
      const _rolPin = (window.OCAuth && window.OCAuth.rolActual) ? window.OCAuth.rolActual() : "";
      const _puedeOwner = _rolPin === "dueno";
      const _puedeEmp = _rolPin === "dueno" || _rolPin === "admin";
      const _puedeAcct = _rolPin === "dueno";
      const _lapiz = (rol, fn, actual) =>
        (_puedeOwner || (rol === "emp" && _puedeEmp) || (rol === "acct" && _puedeAcct))
          ? '<button type="button" data-pin-edit="' + rol + '" title="Change this PIN" style="background:none;border:none;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;cursor:pointer;font-size:15px;padding:0 2px;margin-left:4px;">✎</button>'
          : "";
      cuerpo.innerHTML =
        '<div><strong>Owner:</strong> <code style="font-family:var(--font-mono);letter-spacing:.1em;">' + _esc(owner) + "</code>" + _lapiz("owner", "fijarOwnerPin", owner) + "</div>" +
        '<div><strong>Staff:</strong> <code style="font-family:var(--font-mono);letter-spacing:.1em;">' + _esc(emp) + "</code>" + _lapiz("emp", "fijarEmpleadoPin", emp) + "</div>" +
        '<div><strong>Accounting:</strong> <code style="font-family:var(--font-mono);letter-spacing:.1em;">' + _esc(acct) + "</code>" + _lapiz("acct", "fijarAcctPin", acct) + "</div>" +
        /* Demo (JFC 2026-09-01): 456 es permanente y reservado — muestra la app
           completa con datos de ejemplo antes de comprar. No lleva lapicito
           porque no se cambia nunca. Faltaba en esta lista. */
        '<div><strong>Demo:</strong> <code style="font-family:var(--font-mono);letter-spacing:.1em;">456</code> <span style="font-size:13px;color:var(--ink-soft);">— permanent demo (mock data), can\'t be changed</span></div>';
      /* Bind de los lapicitos. Se re-bindea en cada pintado (los botones son
         nuevos). */
      cuerpo.querySelectorAll("[data-pin-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const rol = btn.dataset.pinEdit;
          const fn = rol === "owner" ? "fijarOwnerPin" : (rol === "emp" ? "fijarEmpleadoPin" : "fijarAcctPin");
          const etiqueta = rol === "owner" ? "Owner" : (rol === "emp" ? "Staff" : "Accounting");
          if (window.OCAuth.esDemo && window.OCAuth.esDemo()) { alert("Demo mode: PINs can't be changed here."); return; }
          const nuevo = prompt("New " + etiqueta + " PIN (3 digits):");
          if (nuevo == null) return;
          const v = String(nuevo).trim();
          if (!/^[0-9]{3}$/.test(v)) { alert("The PIN must be 3 digits (0-9)."); return; }
          if (["456", "789"].indexOf(v) !== -1) { alert("That PIN is reserved (demo or activation). Pick another one."); return; }
          if (rol !== "owner" && ["260", "357"].indexOf(v) !== -1) { alert("That PIN is reserved. Pick another one."); return; }
          /* RESGUARDOS DEL DUEÑO (JFC 2026-08-29, fusión de listas de PIN):
             el flujo viejo de "rotar los 3 a ciegas" exigía confirmación doble
             y correo de recuperación ANTES de cambiar el PIN del dueño — es la
             llave maestra, un typo aquí puede dejarlo fuera de su propio
             negocio. Se portan esos dos resguardos al editor individual,
             SOLO para "owner": Staff/Accounting no arriesgan sacar al dueño. */
          if (rol === "owner") {
            const confirmacion = prompt("Confirm the new Owner PIN (type it again):");
            if (confirmacion == null) return;
            if (String(confirmacion).trim() !== v) { alert("The PINs don't match — nothing was changed."); return; }
            const correoActual = window.OCSecure.leerCorreo();
            if (!correoActual) { alert("Before changing the Owner PIN, register a recovery email above (without one, a forgotten PIN can't be recovered)."); return; }
          }
          try {
            const ok = await window.OCSecure[fn](v);
            if (!ok) { msg("oc-codes-msg", "Could not update the " + etiqueta + " PIN.", "var(--rojo)"); return; }
            try {
              if (window.OCSecure.recordarPinQueAbre) {
                window.OCSecure.recordarPinQueAbre(v, rol === "owner" ? "dueno" : (rol === "emp" ? "empleado" : "contador"));
              }
            } catch (_) {}
            try { window.dispatchEvent(new CustomEvent("oc-catalogo-cambiado")); } catch (_) {}
            /* DIRECTORIO DE ACCESO (JFC 2026-08-28): al cambiar un PIN, se
               asocia a una persona (nombre, correo opcional, notas). Es la base
               para "quién hizo qué" y el control de acceso de cada dueño. */
            try {
              const dir = window.OCSecure.directorioNormalizado();
              const nombre = prompt("Who uses this " + etiqueta + " PIN? (name)", "");
              if (nombre != null) {
                const correo = prompt("Their email (optional):", "");
                const notas = prompt("Notes (optional, e.g. 'runs Shelf1', 'works Thursdays'):", "");
                if (rol === "owner") { dir.owner.nombre = String(nombre).trim(); dir.owner.correo = String(correo || "").trim(); dir.owner.notas = String(notas || "").trim(); }
                else if (rol === "acct") { dir.acct.nombre = String(nombre).trim(); dir.acct.correo = String(correo || "").trim(); dir.acct.notas = String(notas || "").trim(); }
                else {
                  const e = dir.empleados.find((x) => String(x.pin) === String(v)) || { pin: String(v), nombre: "", correo: "", notas: "" };
                  e.nombre = String(nombre).trim(); e.correo = String(correo || "").trim(); e.notas = String(notas || "").trim();
                  if (!dir.empleados.some((x) => String(x.pin) === String(v))) dir.empleados.push(e);
                }
                window.OCSecure.guardarDirectorio(dir);
              }
            } catch (_) {}
            pintarPinsVisibles();
            msg("oc-codes-msg", etiqueta + " PIN updated.", "var(--verde)");
          } catch (_) { msg("oc-codes-msg", "Could not update the " + etiqueta + " PIN.", "var(--rojo)"); }
        });
      });
    }
    function pintarApodoDevice() {
      const txt = $("oc-apodo-device-txt");
      if (!txt) return;
      let apodo = "";
      try { apodo = (window.OCMicelio && window.OCMicelio.miApodo) ? (window.OCMicelio.miApodo() || "") : ""; } catch (_) {}
      txt.textContent = apodo ? window.tf("device.current", { name: apodo }) : window.t("device.name");
    }
    const _apBtn = $("oc-apodo-device-btn");
    if (_apBtn) {
      _apBtn.addEventListener("click", () => {
        let actual = "";
        try { actual = (window.OCMicelio && window.OCMicelio.miApodo) ? (window.OCMicelio.miApodo() || "") : ""; } catch (_) {}
        const v = prompt(window.t("device.namePrompt"), actual);
        if (v === null) return;
        try { if (window.OCMicelio && window.OCMicelio.ponerApodo) window.OCMicelio.ponerApodo(v); } catch (_) {}
        pintarApodoDevice();
      });
    }
    pintarPinsVisibles();
    pintarApodoDevice();
    try { window.addEventListener("oc-micelio-cambio", pintarApodoDevice); } catch (_) {}
    /* FIX (JFC 2026-08-28): init() construye este panel ANTES del login, cuando
       rolActual() es null, así que los lapicitos de edición individual de PINs
       se renderizaban con rol vacío y NO aparecían nunca. Se re-pinta al hacer
       login (evento oc-login) para que el dueño/admin vea sus lapicitos. */
    try { window.addEventListener("oc-login", pintarPinsVisibles); } catch (_) {}

    $("oc-descargar-csv").addEventListener("click", async () => {
      const u = ubic();
      const [pl, bal, val] = await Promise.all([
        fetch(`${API}/reportes/pl?ubicacionId=${u}`).then((r) => r.json()),
        fetch(`${API}/reportes/balance?ubicacionId=${u}`).then((r) => r.json()),
        fetch(`${API}/reportes/valorizado?ubicacionId=${u}`).then((r) => r.json()),
      ]);
      const fila = (a, b) => `"${a}","${b}"`;
      const filas = [
        fila("Accounting report — friendly-123", new Date().toLocaleString(window.OCI18n ? window.OCI18n.locale() : "en-US")),
        fila("NOTICE", "Input for your accountant. Not a valid tax declaration."),
        fila("", ""),
        fila("PROFIT & LOSS (today)", ""),
        fila("Sales collected (incl. VAT)", money(pl.ingresosConIva)),
        fila("VAT collected (15%, remitted to tax authority)", money(pl.ivaCobrado)),
        fila("Net revenue (excl. VAT)", money(pl.ingresos)),
        fila("Cost of sales", money(pl.costoVentas)),
        fila("Gross profit", money(pl.utilidadBruta)),
        fila("Operating expenses", money(pl.gastosOperativos)),
        fila("Net profit", money(pl.utilidadNeta)),
        fila("", ""),
        fila("SIMPLIFIED BALANCE", ""),
        fila("Estimated daily revenue", money(bal.activos.efectivoEstimado)),
        fila("Valued inventory", money(bal.activos.inventarioValorizado)),
        fila("Total assets", money(bal.activos.total)),
        fila("", ""),
        fila("VALUED INVENTORY BY PRODUCT", ""),
        fila("Product", "Stock,Costo,Venta,Utilidad potencial"),
        ...val.productos.map((p) => fila(p.nombre, `${p.stockActual},${money(p.valorCosto)},${money(p.valorVenta)},${money(p.utilidadPotencial)}`)),
      ];
      const csv = "" + filas.join("\n"); // BOM para que Excel abra tildes bien
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `reporte-contable-friendly-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    // El respaldo incluye TANTO los datos del negocio (server/mock, vía
    // /api/respaldo/exportar) COMO el estado de acceso cifrado
    // (localStorage["oc_secure"]: hashes de PIN + correo) — sin esto último,
    // restaurar en otra tablet dejaría al dueño sin sus propias claves.
    // Free-tier (JFC 2026-07-15): sin dispositivo activado (PIN 789) el
    // export queda bloqueado — la proteccion REAL vive en el servidor
    // (server.js / mock-backend.js), esto es solo cortesia visual.
    fetch(`${API}/instancia`).then((r) => r.json()).then(({ apropiada }) => {
      if (!apropiada) {
        const b = $("oc-exportar");
        if (b) { b.disabled = true; b.title = "Activate this device (PIN 789) to export backups."; b.style.opacity = "0.5"; b.style.cursor = "not-allowed"; }
        const p = $("oc-respaldo-free");
        if (p) { p.style.display = "block"; p.style.color = "var(--rojo,#a3392a)"; p.textContent = "Activate this device (PIN 789) to enable backup export."; }
      }
    }).catch(() => {});

    $("oc-exportar").addEventListener("click", async () => {
      try {
        const { apropiada } = await (await fetch(`${API}/instancia`)).json();
        if (!apropiada) { msg("oc-respaldo-msg", "Activate this device (PIN 789) to export.", "var(--rojo)"); return; }
        const respExp = await fetch(`${API}/respaldo/exportar`);
        const datos = await respExp.json();
        if (!respExp.ok) { msg("oc-respaldo-msg", datos.error || "Activate this device (PIN 789) to export.", "var(--rojo)"); return; }
        // Fase 2 (2026-08-04): el respaldo debe incluir el historial archivado
        // en IndexedDB (movido ahi cuando localStorage se llenaba), no solo la
        // ventana caliente — un respaldo incompleto no es un respaldo.
        try { if (window.OCArchivo) { const arch = await window.OCArchivo.leerTodos(); if (arch.length) datos.movimientos = [...arch, ...(datos.movimientos || [])]; } } catch (_) {}
        const fotosPerchas = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("f123_foto_percha_") === 0) fotosPerchas[k] = localStorage.getItem(k);
        }
        const paquete = { schemaVersion: 2, fecha: new Date().toISOString(), datos, oc_secure: (function () {
          // SEGURIDAD 2026-07-17: ownerPinR va XOR-ofuscado con clave fija visible
          // en el fuente — cualquiera con el archivo recuperaria el PIN del dueno.
          // Se quita del export; la recuperacion "Olvidaste?" se re-arma sola en
          // el proximo cambio de PIN tras restaurar.
          try { const s = JSON.parse(localStorage.getItem("f123_secure")); if (s) delete s.ownerPinR; return s ? JSON.stringify(s) : null; } catch (_) { return localStorage.getItem("f123_secure"); }
        })(), fotosPerchas };
        const contenidoPlano = JSON.stringify(paquete);
        const checksum = await window.OCSecure.hashTexto(contenidoPlano);
        // Contraseña de exportación OPCIONAL: si el dueño la pone, el archivo
        // completo (incluye oc_secure: hashes de PIN + correo) sale cifrado
        // con AES-256-GCM real, no solo "protegido por no compartirlo". Si la
        // deja vacía, se exporta igual que antes (compatibilidad).
        const clave = prompt("Key to protect this backup (minimum 8 characters). Leave blank to export unencrypted:");
        // FIX 2026-07-07: "Cancelar" devolvia null y caia al camino sin cifrar —
        // exportaba un archivo CON oc_secure adentro sin que el dueno lo pidiera.
        // Cancelar ahora cancela de verdad.
        if (clave === null) {
          if (window.dialogosBloqueados && window.dialogosBloqueados()) { msg("oc-respaldo-msg", "Your browser blocks dialogs (happens in WhatsApp's browser). Open friendly-123 in Chrome or Safari to export with a key.", "var(--rojo)"); return; }
          msg("oc-respaldo-msg", "Export cancelled.", "var(--ink)");
          return;
        }
        let archivoFinal;
        if (clave && clave.trim()) {
          const cifrado = await window.OCSecure.cifrarTextoConClave(contenidoPlano, clave.trim());
          archivoFinal = JSON.stringify({ amigableRespaldoCifrado: true, checksum, ...cifrado }, null, 2);
        } else {
          archivoFinal = JSON.stringify({ ...paquete, checksum }, null, 2);
        }
        // Fase 4 (2026-08-04): "un respaldo que no abre no es un respaldo" — en
        // vez de solo CALCULAR el checksum y confiar, se vuelve a leer el
        // archivo que se va a ofrecer para descarga y se confirma que abre y
        // que su contenido cuadra con el checksum, ANTES de mostrarlo como
        // exitoso. Si esto falla, es mejor decirlo ahora que dejar que el
        // dueño descubra un respaldo roto el dia que de verdad lo necesita.
        try {
          const relectura = JSON.parse(archivoFinal);
          let textoParaVerificar;
          if (relectura.amigableRespaldoCifrado) {
            if (!clave || !clave.trim()) throw new Error("the passphrase to re-verify is missing");
            textoParaVerificar = await window.OCSecure.descifrarTextoConClave(relectura, clave.trim());
            if (!textoParaVerificar) throw new Error("could not be decrypted back with the same passphrase");
          } else {
            const { checksum: _c, ...resto } = relectura;
            textoParaVerificar = JSON.stringify(resto);
          }
          const checksumRelectura = await window.OCSecure.hashTexto(textoParaVerificar);
          if (checksumRelectura !== checksum) throw new Error("the checksum does not match after re-reading the file");
        } catch (eVerif) {
          msg("oc-respaldo-msg", "The backup did not pass its own check (" + eVerif.message + ") — it was not downloaded. Try again; if it keeps happening, contact support.", "var(--rojo)");
          return;
        }
        const blob = new Blob([archivoFinal], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `respaldo-friendly-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        localStorage.setItem("f123_ultimo_export_manual", String(Date.now()));
        localStorage.setItem("f123_ultimo_export_verificado", String(Date.now())); // Fase 4: distingue "se hizo" de "se verifico que abre"
        msg("oc-respaldo-msg", "Backup downloaded and verified" + (clave ? " and encrypted" : "") + ". Save it somewhere safe.", "var(--verde)");
      } catch (e) { msg("oc-respaldo-msg", "Export failed: " + e.message, "var(--rojo)"); }
    });

    $("oc-importar-file").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        let paquete = JSON.parse(await file.text());
        if (paquete.amigableRespaldoCifrado) {
          const clave = prompt("This backup is encrypted. Enter the key it was exported with:");
          if (!clave) { e.target.value = ""; return; }
          const texto = await window.OCSecure.descifrarTextoConClave(paquete, clave.trim());
          if (!texto) { msg("oc-respaldo-msg", "Wrong key or damaged file.", "var(--rojo)"); e.target.value = ""; return; }
          const checksumOk = paquete.checksum ? (await window.OCSecure.hashTexto(texto)) === paquete.checksum : true;
          if (!checksumOk) { msg("oc-respaldo-msg", "Content does not match its checksum — file may be corrupted.", "var(--rojo)"); e.target.value = ""; return; }
          paquete = JSON.parse(texto);
        } else if (paquete.checksum) {
          const { checksum, ...resto } = paquete;
          const ok = (await window.OCSecure.hashTexto(JSON.stringify(resto))) === checksum;
          if (!ok) { msg("oc-respaldo-msg", "Content does not match its checksum — file may be corrupted.", "var(--rojo)"); e.target.value = ""; return; }
        }
        if (!paquete.datos) { msg("oc-respaldo-msg", "This file does not look like a friendly-123 backup.", "var(--rojo)"); return; }
        if ((paquete.schemaVersion || 1) > 2) { msg("oc-respaldo-msg", "This backup is from a newer version of friendly-123 — update the app before importing it.", "var(--rojo)"); return; }
        if (!confirm("This REPLACES all current data (products, sales, keys) with the backup data. Continue?")) return;
        const res = await fetch(`${API}/respaldo/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquete.datos) });
        const r = await res.json();
        if (!res.ok) { msg("oc-respaldo-msg", r.error, "var(--rojo)"); return; }
        let secretoOk = true;
        if (paquete.oc_secure) {
          secretoOk = false;
          try { localStorage.setItem("f123_secure", paquete.oc_secure); secretoOk = true; }
          catch (_) {
            // Guard G4 (2026-08-04): sin este purge-and-retry, un dispositivo con poco
            // espacio importaba productos/ventas OK pero perdia el PIN en silencio.
            try {
              const rm = [];
              for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("vp_foto_percha_") === 0) rm.push(k); }
              rm.forEach((kk) => { try { localStorage.removeItem(kk); } catch (_) {} });
              localStorage.setItem("f123_secure", paquete.oc_secure);
              secretoOk = true;
            } catch (_) { secretoOk = false; }
          }
        }
        if (paquete.fotosPerchas) Object.entries(paquete.fotosPerchas).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} });
        window.dispatchEvent(new CustomEvent("oc-datos-importados")); // index re-sincroniza la UI solo
        if (secretoOk) {
          msg("oc-respaldo-msg", "Backup imported. Screen now shows restored data.", "var(--verde)");
        } else {
          msg("oc-respaldo-msg", "Products and sales imported, but your PIN keys could NOT be saved (device storage full). You keep using this device's current PIN. Free up space and try importing again, or change the keys manually in Access codes.", "var(--rojo)");
        }
      } catch (err) { msg("oc-respaldo-msg", "Import failed: " + err.message, "var(--rojo)"); }
      e.target.value = "";
    });

    // ==========================================================================
    // CAJA FUERTE LOCAL — Alternativa B (JFC, aprobado 2026-07-05)
    // --------------------------------------------------------------------------
    // Snapshots automáticos ROTATIVOS en localStorage (últimos 7), cada uno
    // con checksum SHA-256 (window.OCSecure.hashTexto) para detectar
    // corrupción antes de restaurar. Protege contra "borré algo sin querer" y
    // errores humanos recientes — NO contra perder el dispositivo/caché
    // completo (para eso sigue siendo indispensable el respaldo manual de
    // arriba, que sí sale del navegador).
    //
    // APUNTES PARA LA FASE C (NO IMPLEMENTADA — solo queda anotado para
    // cuando se decida construirla, tal cual se aprobó):
    //   - Empaquetar cada snapshot en un paquete QR/texto dividido en partes
    //     (mismo formato "OCSYNC1:" ya usado en sync manual) para poder
    //     copiarlo a OTRO dispositivo sin depender de este navegador.
    //   - "Modo simulacro": importar en memoria y comparar conteos/totales
    //     (productos, ventas, valor de inventario) contra el estado actual
    //     ANTES de reemplazar nada — hoy el respaldo manual reemplaza directo
    //     tras un simple confirm().
    //   - Manifest con checksum POR TABLA (productos, ventas, movimientos,
    //     claves, fotos) en vez de un checksum único del archivo completo —
    //     permite saber cuál tabla se corrompió, no solo que "algo" falló.
    // ==========================================================================
    const CAJA_MAX_SNAPSHOTS = 7;
    const CAJA_INTERVALO_MS = 30 * 60 * 1000; // cada 30 min mientras la pestaña esté abierta
    const CAJA_ALERTA_DIAS = 7; // avisa si el ÚLTIMO RESPALDO MANUAL tiene más de esto

    function cajaLeer() {
      try { return JSON.parse(localStorage.getItem("f123_caja_snapshots") || "[]"); } catch { return []; }
    }
    function cajaGuardar(lista) {
      try { localStorage.setItem("f123_caja_snapshots", JSON.stringify(lista.slice(-CAJA_MAX_SNAPSHOTS))); return true; }
      catch { return false; } // localStorage lleno: no rompe la app, solo no guarda este punto
    }
    async function cajaGuardarPunto(silencioso) {
      try {
        const datos = await (await fetch(`${API}/respaldo/exportar`)).json();
        const contenido = JSON.stringify({ fecha: new Date().toISOString(), datos });
        const checksum = await window.OCSecure.hashTexto(contenido);
        const lista = cajaLeer();
        lista.push({ fecha: new Date().toISOString(), contenido, checksum });
        const guardado = cajaGuardar(lista);
        if (!silencioso) {
          msg("oc-respaldo-msg", guardado ? "Checkpoint saved in this browser." : "Could not save checkpoint (localStorage full? Try exporting a manual backup to free space).", guardado ? "var(--verde)" : "var(--rojo)");
        }
      } catch (_) { if (!silencioso) msg("oc-respaldo-msg", "Could not take a checkpoint.", "var(--rojo)"); }
    }
    async function cajaRestaurar(idx) {
      const lista = cajaLeer();
      const punto = lista[idx];
      if (!punto) return;
      const okChecksum = (await window.OCSecure.hashTexto(punto.contenido)) === punto.checksum;
      if (!okChecksum) { msg("oc-respaldo-msg", "This checkpoint failed the checksum check — may be corrupted. Nothing was restored.", "var(--rojo)"); return; }
      if (!confirm(`This REPLACES current data with the checkpoint from ${new Date(punto.fecha).toLocaleString()}. Continue?`)) return;
      let paquete; try { paquete = JSON.parse(punto.contenido); } catch { msg("oc-respaldo-msg", "This checkpoint is corrupted.", "var(--rojo)"); return; }
      const res = await fetch(`${API}/respaldo/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquete.datos) });
      if (!res.ok) { const r = await res.json(); msg("oc-respaldo-msg", r.error || "Could not restore.", "var(--rojo)"); return; }
      window.dispatchEvent(new CustomEvent("oc-datos-importados"));
      msg("oc-respaldo-msg", "Restored. Screen now shows data from the chosen checkpoint.", "var(--verde)");
    }
    function cajaPintarAlerta() {
      const ultimo = Number(localStorage.getItem("f123_ultimo_export_manual") || 0);
      const el = $("oc-caja-alerta");
      if (!el) return;
      if (!ultimo) { el.textContent = "You have not made a manual backup yet (the one above) — do it at least once."; el.style.color = "var(--rust)"; return; }
      const dias = Math.floor((Date.now() - ultimo) / 86400000);
      if (dias >= CAJA_ALERTA_DIAS) { el.textContent = `Your last manual backup is ${dias} days old — consider making a new one.`; el.style.color = "var(--rust)"; }
      else { el.textContent = `Last manual backup: ${dias} day(s) ago.`; el.style.color = "var(--verde)"; }
    }
    cajaPintarAlerta();

    // StorageManager: aviso preventivo si el dispositivo ya uso >80% de la cuota.
    // Solo corre una vez al abrir Avanzado, silencioso si la API no existe o falla.
    // El elemento se inyecta ANTES del primer hijo de #vista-avanzado para que sea
    // lo primero visible — si hay problema de espacio, el dueno lo ve de inmediato.
    // AVISO DE CUOTA: SOLO CONSOLA (JFC 2026-08-26). El banner café/rojo de
    // "Storage at X%" NO fue autorizado y no debe alterar la experiencia. Se
    // conserva el dato en consola para diagnóstico remoto, pero NUNCA se pinta.
    (async () => {
      try {
        if (!navigator.storage || !navigator.storage.estimate) return;
        const { usage, quota } = await navigator.storage.estimate();
        if (!quota) return;
        const pct = Math.round((usage / quota) * 100);
        if (pct < 80) return;
        try { console.warn("[storage] uso al " + pct + "% (aviso solo en consola, sin banner)"); } catch (_) {}
      } catch (_) {}
    })();

    // Fase 1 (2026-08-04): aviso de PERSISTENCIA, distinto del aviso de cuota
    // de arriba. Cuota = "te estas quedando sin espacio". Persistencia =
    // "el sistema operativo puede borrar tus datos sin avisar si no usas la
    // app por unos dias" (tipico en iOS Safari sin instalar la PWA). Es el
    // riesgo mas serio de perdida total de datos y el mas barato de evitar:
    // instalar la app en la pantalla de inicio sube mucho la probabilidad de
    // que el navegador conceda persistencia.
    // PERSISTENCIA: se SIGUE solicitando (verificarYSolicitar sube la
    // probabilidad de que el navegador NO borre los datos — es beneficioso y
    // silencioso), pero el banner rojo NO fue autorizado y no se pinta.
    // (JFC 2026-08-26: "no alteres la experiencia esencial de usuario").
    (async () => {
      try {
        if (!window.OCStorageDurable) return;
        await window.OCStorageDurable.verificarYSolicitar();
      } catch (_) {}
    })();

    // FIX 2026-07-07: los timers ya no trabajan con la sesion cerrada
    // (trabajo fantasma y bateria en tablets que quedan encendidas).
    setInterval(() => { if (window.OCAuth && window.OCAuth.rolActual()) cajaGuardarPunto(true); }, CAJA_INTERVALO_MS);
    setTimeout(() => cajaGuardarPunto(true), 5000); // primer punto poco después de abrir Avanzado

    $("oc-caja-guardar").addEventListener("click", () => cajaGuardarPunto(false));
    $("oc-caja-ver").addEventListener("click", () => {
      const cont = $("oc-caja-lista");
      if (cont.style.display !== "none") { cont.style.display = "none"; return; }
      const lista = cajaLeer();
      cont.innerHTML = lista.length
        ? lista.slice().reverse().map((p, i) => {
            const idxReal = lista.length - 1 - i;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--azul-suave,#dde5ec);font-size:13px;">
              <span>${escHtml(new Date(p.fecha).toLocaleString())}</span>
              <button data-caja-restaurar="${idxReal}" style="font-size:13px;padding:6px 10px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Restore</button>
            </div>`;
          }).join("")
        : `<p style="font-size:13px;color:var(--ink-soft);">No checkpoints saved yet.</p>`;
      cont.style.display = "block";
      cont.querySelectorAll("[data-caja-restaurar]").forEach((b) => b.addEventListener("click", () => cajaRestaurar(Number(b.dataset.cajaRestaurar))));
    });
  }


  // Cambiar un correo YA registrado exige el código maestro (solo JFC lo
  // conoce) — pedido explícito de JFC como "master admin": evita que
  // cualquiera con el dispositivo del dueño secuestre la cuenta apuntando la
  // recuperación a un correo propio. Si NO hay correo (primera vez), el
  // dueño lo registra libre, sin master. Ver nota larga en crypto-store.js.
  function pintarEmail() {
    const email = window.OCSecure.leerCorreo();
    const row = $("oc-email-row");
    if (email) {
      row.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-family:var(--font-mono);font-size:15px;color:var(--ink);">${window.OCAuth.enmascarar(email)}</span>
        <button id="oc-email-edit" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Change (requires master code)</button></div>`;
      $("oc-email-edit").addEventListener("click", pedirMaestroYCambiarCorreo);
    } else {
      row.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="oc-email-in" type="email" placeholder="email@domain.com" style="flex:1;min-width:200px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);">
        <button id="oc-email-save" class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);">Save</button></div>
        <p id="oc-email-msg" style="font-size:14px;margin-top:8px;"></p>`;
      $("oc-email-save").addEventListener("click", () => {
        if (window.OCAuth.esDemo && window.OCAuth.esDemo()) return; // demo: sin cambio de correo
        const v = $("oc-email-in").value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { msg("oc-email-msg", "Invalid email.", "var(--rojo)"); return; }
        window.OCSecure.actualizarCorreo(v);
        pintarEmail();
        if (reasignacionViaMaestro) {
          reasignacionViaMaestro = false;
          window.OCAuth.abrirFlujoReset(v);
        }
      });
    }
  }

  // WhatsApp del dueno (Mejora #5, JFC 2026-07-16). A diferencia del correo,
  // SIEMPRE editable — no es via de recuperacion de acceso, solo un dato de
  // contacto/notificacion. Se guarda local (crypto-store.js) Y se manda al
  // worker (mismo endpoint que el registro de licencia) para que aparezca
  // en el panel de JFC con un link clickeable a wa.me. Primer contacto
  // deliberadamente unidireccional (JFC -> dueno): la copia de este campo
  // NUNCA invita al dueno a escribirle a JFC por WhatsApp, solo explica el
  // beneficio para el/ella (resumenes + sync). Soporte sigue siendo solo
  // por correo — no cambiar esta redaccion sin que JFC lo pida.
  function pintarWhatsapp() {
    const wa = window.OCSecure.leerWhatsapp();
    const row = $("oc-whatsapp-row");
    row.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;">
      <input id="oc-whatsapp-in" type="tel" inputmode="tel" placeholder="${window.t("auth.act.whatsappPlaceholder")}" value="${escHtml(wa)}" style="flex:1;min-width:200px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);">
      <button id="oc-whatsapp-save" class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);">${window.t("auth.act.whatsappSave")}</button></div>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:6px;">${window.t("auth.act.whatsappCountryHint")}</p>
      <p id="oc-whatsapp-msg" style="font-size:14px;margin-top:8px;"></p>`;
    $("oc-whatsapp-save").addEventListener("click", async () => {
      if (window.OCAuth.esDemo && window.OCAuth.esDemo()) return;
      const v = $("oc-whatsapp-in").value.trim();
      if (v && !/^\+?[0-9 ()-]{7,20}$/.test(v)) { msg("oc-whatsapp-msg", window.t("auth.act.whatsappInvalid"), "var(--rojo)"); return; }
      const waOk = window.OCSecure.actualizarWhatsapp(v); // Fix-7: false si f123_secure ausente/corrupto
      if (!waOk) { msg("oc-whatsapp-msg", "Could not save (storage issue — try reloading).", "var(--rojo)"); return; }
      msg("oc-whatsapp-msg", window.t("auth.act.whatsappSaved"), "var(--verde)");
      // Sube el numero al mismo worker de registro de licencia — asi JFC
      // lo ve en su panel con un link directo. Best-effort: si falla (sin
      // conexion, worker no configurado), el dato local ya quedo guardado.
      try {
        const url = window.OCAuth.workerUrl();
        let owned = {};
        try { owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; } catch (_) {}
        if (url && owned.instanceId) {
          fetch(url.replace(/\/+$/, "") + "/checkin", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId: owned.instanceId, licenseCode: owned.licenseCode || "", email: window.OCSecure.leerCorreo() || "", whatsapp: v, nombreNegocio: owned.nombreNegocio || "", accion: "update" }),
          }).catch(() => {});
        }
      } catch (_) {}
    });
  }

  // Pide el código maestro (candado de JFC) antes de dejar editar un correo
  // ya registrado. Reutiliza el mismo patrón visual del candado contable.
  function pedirMaestroYCambiarCorreo() {
    const cont = document.createElement("div");
    cont.className = "oc-subgate";
    cont.innerHTML = `<div class="caja" style="background:var(--blanco-calido);border:2px solid var(--brass);border-radius:8px;padding:26px 22px;max-width:420px;width:100%;text-align:center;">
      <h2 style="font-family:var(--font-display);color:var(--ink);font-size:20px;margin:0 0 4px;">Master code</h2>
      <p style="font-size:14px;color:var(--ink-soft);margin-bottom:14px;">Only JFC has this. Verify the owner's identity in person or via video call before sharing it.</p>
      <input id="mst-codigo" type="text" style="width:100%;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);text-align:center;">
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="mst-cancelar" style="flex:1;padding:10px;border-radius:6px;border:2px solid var(--azul-medio);background:transparent;color:var(--azul-medio);cursor:pointer;">Cancel</button>
        <button id="mst-ok" class="ir" style="flex:1;">Verify</button>
      </div>
      <p id="mst-msg" style="font-size:14px;margin-top:10px;font-weight:700;color:var(--rojo);"></p>
    </div>`;
    document.body.appendChild(cont);
    cont.querySelector("#mst-cancelar").addEventListener("click", () => cont.remove());
    cont.querySelector("#mst-ok").addEventListener("click", async () => {
      const codigo = cont.querySelector("#mst-codigo").value.trim();
      const ok = await window.OCSecure.verificarMaestro(codigo);
      if (!ok) { cont.querySelector("#mst-msg").textContent = "Incorrect master code."; return; }
      window.OCSecure.actualizarCorreo("");
      reasignacionViaMaestro = true;
      cont.remove();
      pintarEmail();
    });
  }

  function msg(id, txt, color) { const el = $(id); if (el) { el.style.color = color; el.textContent = txt; } }

  // Solo el dueño ve/activa esto (vive dentro de "Avanzado", ya restringido).
  // La llave de cifrado nunca se persiste — por eso, si ya estaba activado en
  // este navegador pero se recargó la página, hay que reingresar el PIN antes
  // de poder cifrar/descifrar de nuevo (mismo patrón que la subclave contable).
  async function render() {
    const u = ubic();
    // Reforzado (JFC 2026-07-18): render() se llama tras desbloquear la capa
    // contable con PIN (click handler sin try/catch propio) — sin este guard,
    // un fallo de red aqui dejaba el panel VISIBLE pero VACIO, justo despues
    // de que el dueño tecleara su clave. Ahora se avisa claro en vez de
    // quedarse en blanco.
    let pl, bal;
    try {
      [pl, bal] = await Promise.all([
        fetch(`${API}/reportes/pl?ubicacionId=${u}`).then((r) => r.json()),
        fetch(`${API}/reportes/balance?ubicacionId=${u}`).then((r) => r.json()),
      ]);
    } catch (err) {
      console.error("[render/oc-taccounts]", err);
      $("oc-taccounts").innerHTML = `<p style="color:var(--rojo,#a3392a);font-size:14px;">Could not load. Check your connection and try again.</p>`;
      return;
    }
    // Cuentas T derivadas del día (partida doble simplificada). El IVA
    // cobrado NO es ingreso del negocio — es un pasivo (se le debe al SRI),
    // por eso tiene su propia cuenta en vez de mezclarse con Ventas.
    const cuentas = [
      { nombre: "Cash (Asset)", debe: [["Collected today (incl. VAT)", pl.ingresosConIva]], haber: [["Operating expenses", pl.gastosOperativos]] },
      { nombre: "Sales (Revenue)", debe: [], haber: [["Net revenue today", pl.ingresos]] },
      { nombre: "VAT Payable (Liability)", debe: [], haber: [["VAT collected today (15%)", pl.ivaCobrado]] },
      { nombre: "Cost of Sales (Expense)", debe: [["Cost of goods sold", pl.costoVentas]], haber: [] },
      { nombre: "Inventory (Asset)", debe: [["Valued balance", bal.activos.inventarioValorizado]], haber: [["Sold outflow", pl.costoVentas]] },
      { nombre: "Operating Expenses (Expense)", debe: [["Daily allocation", pl.gastosOperativos]], haber: [] },
    ];
    $("oc-taccounts").innerHTML = cuentas.map(tAccount).join("");
    await renderChart();
  }

  // Una barra por ubicación no-propia: % de meta cumplida (la métrica que
  // más le importa al socio) + la comisión efectiva que terminó pagándose
  // (revela el efecto de las escalas dinámicas: no es un % fijo, sube con
  // el desempeño). Divs + CSS, cero librerías de gráficos.
  async function renderChart() {
    const box = $("oc-chart");
    if (!box) return;
    // Reforzado (JFC 2026-07-18): sin este guard, un fallo de red aqui dejaba
    // el grafico de comisiones vacio/roto sin ningun aviso.
    let filas;
    try {
      filas = await (await fetch(`${API}/liquidaciones`)).json();
    } catch (err) {
      console.error("[renderChart]", err);
      box.innerHTML = `<p style="font-size:14px;color:var(--rojo,#a3392a);">Could not load. Check your connection and try again.</p>`;
      return;
    }
    if (!filas.length) { box.innerHTML = `<p style="font-size:14px;color:var(--ink-soft);">No partner/franchise/consignment locations yet.</p>`; return; }
    const maxCumplimiento = Math.max(100, ...filas.map((f) => f.cumplimientoMeta || 0));
    box.innerHTML = filas.map((f) => {
      const comisionEfectivaPct = f.ventasBrutas > 0 ? (f.comisionSocio / f.ventasBrutas) * 100 : 0;
      const anchoMeta = Math.min(100, ((f.cumplimientoMeta || 0) / maxCumplimiento) * 100);
      return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
          <strong>${escHtml(f.ubicacion)}</strong>
          <span style="color:var(--ink-soft);">${fmtVentas(f.ventasBrutas)} sold · ${f.cumplimientoMeta ?? 0}% of target</span>
        </div>
        <div style="background:var(--sim-azul-bg,#D4ECF5);border-radius:6px;overflow:hidden;height:22px;position:relative;">
          <div style="background:${(f.cumplimientoMeta || 0) >= 100 ? "var(--sim-verde,#00C87A)" : "var(--sim-azul,#5294AC)"};height:100%;width:${anchoMeta}%;transition:width .3s;"></div>
        </div>
        <div style="font-size:13px;color:var(--ink-soft);margin-top:3px;">Effective commission paid: ${comisionEfectivaPct.toFixed(1)}% (${money(f.comisionSocio)})</div>
      </div>`;
    }).join("");
  }
  function fmtVentas(n) { const v = Number(n || 0); return "$" + (isFinite(v) ? v.toFixed(2) : "0.00"); }

  // tAccount: acento azul en la T (azul = sabiduria/contable por semantica Simon).
  // Espina dorsal: el trazo vertical de la T es azul. Header en azul-dk.
  // Cero cambios de estructura — solo color intencional del codigo aprobado.
  function tAccount(c) {
    const filas = Math.max(c.debe.length, c.haber.length, 1);
    let rows = "";
    for (let i = 0; i < filas; i++) {
      const d = c.debe[i], h = c.haber[i];
      rows += `<tr>
        <td style="width:50%;padding:4px 6px;font-size:13px;border-right:1.5px solid var(--sim-azul);">${d ? d[0] + " " + money(d[1]) : ""}</td>
        <td style="width:50%;padding:4px 6px;font-size:13px;">${h ? h[0] + " " + money(h[1]) : ""}</td></tr>`;
    }
    return `<div class="tag-card" style="padding:12px;border-left:3px solid var(--sim-azul);">
      <div style="font-family:var(--font-display);font-weight:700;font-size:14px;text-align:center;color:var(--sim-azul-dk);border-bottom:2px solid var(--sim-azul);padding-bottom:6px;margin-bottom:4px;">${escHtml(c.nombre)}</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <th style="font-size:13px;color:var(--sim-azul);border-right:1.5px solid var(--sim-azul);border-bottom:1px solid var(--sim-azul);">DEBIT</th>
          <th style="font-size:13px;color:var(--sim-azul);border-bottom:1px solid var(--sim-azul);">CREDIT</th>
        </tr>
        ${rows}
      </table></div>`;
  }

  // Si la ubicación cambia mientras está desbloqueada, re-render
  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "selectUbicacion" && desbloqueadaSesion && $("oc-contable") && $("oc-contable").style.display !== "none") render();
  });

  // Wall defensiva (2026-07-08): si init() lanzara al construir Avanzado, el
  // error queda aislado aquí — no rompe el resto de la app ni el arranque.
  function initSeguro() { try { init(); } catch (e) { console.error("Avanzado init falló (aislado):", e); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSeguro);
  else initSeguro();

  // ===========================================================================
  // ROL CONTADOR (JFC 2026-07-15): PIN 357 directo en el candado principal.
  // init() SIEMPRE construye #oc-contable dentro de #vista-avanzado (arriba),
  // sin importar el rol — aqui solo lo TRASLADAMOS a una vista propia
  // "contable" (nav + section creados al vuelo, mismo mecanismo de clase
  // .activo/.activa que usa index.html para el resto del nav) y lo mostramos
  // sin candado (la subclave YA se verifico en auth-ui.js via verificarAcct).
  // No se duplica logica de render: se reusa render() tal cual.
  // ===========================================================================
  function activarVistaContable() {
    let btn = document.querySelector('nav button[data-vista="contable"]');
    const nav = document.querySelector("nav");
    const main = document.querySelector("main");
    if (!btn && nav && main) {
      btn = document.createElement("button");
      btn.dataset.vista = "contable";
      btn.innerHTML = `<span>${window.t ? window.t("nav.contable") : "Accounting"}</span>`;
      nav.appendChild(btn);
      const sec = document.createElement("section");
      sec.id = "vista-contable";
      sec.className = "vista";
      main.appendChild(sec);
      const cont = $("oc-contable");
      const lock = $("oc-acct-lock");
      if (lock) lock.style.display = "none";
      if (cont) { sec.appendChild(cont); cont.style.display = "block"; }
      btn.addEventListener("click", () => {
        document.querySelectorAll("nav button").forEach((b) => b.classList.remove("activo"));
        btn.classList.add("activo");
        document.querySelectorAll(".vista").forEach((v) => v.classList.remove("activa"));
        sec.classList.add("activa");
      });
      render();
    }
    btn.click();
  }
  window.addEventListener("oc-login", (e) => {
    if (e.detail && e.detail.rol === "contador") activarVistaContable();
  });

  /* ==========================================================================
     B3 (JFC, 2026-08-14): cambiar el codigo de la sala. CASO EXTREMO.
     Ver el comentario largo del parche: dar de baja a un ex encargado resuelve
     el 95% y es mucho menos molesto. Esto es para cuando el codigo SE FILTRO.
     El panel de control BLOQUEA instancias; el dueno ROTA el codigo. No al
     reves: rotar desde el panel dejaria al dueno fuera de su propia sala.
     ========================================================================== */
  function ocRotarCodigoSala() {
    if (document.getElementById("oc-rot-modal")) return;
    var m = document.createElement("div");
    m.className = "oc-subgate";
    m.id = "oc-rot-modal";
    m.innerHTML =
      '<div class="caja" style="background:#FFFFFF;border:2px solid #E86040;border-radius:16px;padding:24px 20px;max-width:460px;width:100%;text-align:left;margin:auto;">' +
      '<h2 style="font-size:21px;font-weight:800;margin:0 0 12px;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">Change your business code</h2>' +
      '<p style="font-size:16px;line-height:1.5;margin:0 0 12px;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">A new code is generated and the current one stops working. Every phone on your team will have to join again with the new one, including yours if you use more than one device.</p>' +
      '<p style="font-size:15px;line-height:1.5;margin:0 0 12px;padding:11px 13px;background:#F8F9FB;border-left:4px solid #2C3E50;border-radius:0 8px 8px 0;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">Only do this if the code leaked: someone posted it, dropped it in a group chat, or left the company with it written down. For a regular ex-employee it is enough to deactivate them under Users, which is far less disruptive for everyone else.</p>' +
      '<p style="font-size:15px;line-height:1.5;margin:0 0 18px;padding:11px 13px;background:#FFF6F2;border-left:4px solid #E86040;border-radius:0 8px 8px 0;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">This cuts off access from here on. Whatever that person already saw or copied cannot be taken back.</p>' +
      '<button type="button" id="oc-rot-ok" style="width:100%;min-height:48px;padding:13px;border:none;border-radius:12px;background:#E86040;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-weight:800;font-size:16px;cursor:pointer;">Yes, rotate the team license</button>' +
      '<button type="button" id="oc-rot-no" style="width:100%;min-height:44px;margin-top:10px;background:none;border:none;font-size:15px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;cursor:pointer;">Never mind</button>' +
      '<p id="oc-rot-msg" style="font-size:15px;font-weight:700;margin:12px 0 0;"></p>' +
      "</div>";
    document.body.appendChild(m);
    function cerrar() { try { m.remove(); } catch (_) {} document.removeEventListener("keydown", onKey, true); }
    function onKey(e) { if (e.key === "Escape" || e.key === "Esc") { e.stopPropagation(); cerrar(); } }
    document.addEventListener("keydown", onKey, true);
    m.addEventListener("click", function (e) { if (e.target === m) cerrar(); });
    m.querySelector("#oc-rot-no").addEventListener("click", cerrar);
    m.querySelector("#oc-rot-ok").addEventListener("click", function (ev) {
      var btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      var msg = m.querySelector("#oc-rot-msg");
      try {
        /* El generador vive en auth-ui.js, que ya usa crypto.getRandomValues y
           el simbolo de verificacion de Crockford. No se duplica aqui. */
        var nuevo = (window.OCAuth && window.OCAuth.generarCodigo) ? window.OCAuth.generarCodigo() : null;
        if (!nuevo) throw new Error("generador no disponible");

        /* ORDEN A PROPOSITO: primero se guarda en el registro local, despues se
           mueve la sala. Si el navegador muriera en medio, el dueno conserva el
           codigo nuevo escrito y puede volver a unirse a mano. Al reves quedaria
           en una sala cuyo codigo no sabe. */
        var owned = {};
        try { owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; } catch (_) {}
        owned.licenseCode = nuevo;
        /* BUG (JFC 2026-08-19): se actualizaba licenseCode pero NO syncCode, y
           el panel de sync precarga su campo desde owned.syncCode. Despues de
           rotar, el panel seguia mostrando el codigo VIEJO —ya muerto— como si
           fuera el bueno. Los dos campos describen la misma sala: se mueven
           juntos o no se mueven. */
        owned.syncCode = nuevo;
        owned.licenseRotadaEn = Date.now();
        localStorage.setItem("f123_owned", JSON.stringify(owned));

        if (window.OCSyncControl) {
          try { window.OCSyncControl.desactivar(); } catch (_) {}
          window.OCSyncControl.activar(nuevo);
        }
        try {
          if (window.OCAuth && window.OCAuth.heartbeat) {
            window.OCAuth.heartbeat({ instanceId: owned.instanceId, licenseCode: nuevo, accion: "rotacion" });
          }
        } catch (_) { /* el heartbeat es informativo: si falla, la rotacion vale igual */ }

        msg.style.color = "#00805A";
        /* BUG (caza 2026-08-19): aqui se mostraba "nuevo" crudo, el codigo
           interno F123-..., justo despues de construir toda la separacion
           TEAM-/F123- para que el usuario NUNCA vea el interno como si fuera
           su codigo de equipo. Se muestra con paraMostrar(), igual que en todo
           el resto del panel. */
        var nuevoMostrado = (window.OCSyncControl.paraMostrar ? window.OCSyncControl.paraMostrar(nuevo) : nuevo);
        msg.innerHTML = "New code. Share it with your team one to one:<br><code style=\'font-family:monospace;font-size:17px;letter-spacing:.08em;\'>" +
          String(nuevoMostrado).replace(/[&<>]/g, "") + "</code>";
        btn.style.display = "none";
      } catch (e) {
        btn.disabled = false;
        msg.style.color = "#B0183E";
        msg.textContent = (e && e.message) || "Could not change the code.";
      }
    });
  }

  /* MICROCIRUGÍA (JFC 2026-08-27). Caso real: un aparato quedó con una licencia
     TRUNCA/vieja (cuerpo de 8 o 12, no 17) o sin licencia, y no había forma simple
     de darle una BUENA que el otro aparato pueda unir. Este botón genera una
     licencia COMPLETA (17, con el generador de auth-ui.js), la fija como licenseCode
     Y syncCode (los deja coherentes), mueve la sala y la muestra/copia para pegarla
     en el otro aparato. NO vacía los datos locales. Es el núcleo de "rotar" sin el
     modal, con un aviso de una línea porque mueve la sala. */
  function ocDarLicenciaBuena() {
    try {
      if (!confirm("This gives THIS device a brand-new full license and moves it to a fresh notebook (your local data stays). Any OTHER device must enter the new code to rejoin. Continue?")) return;
      var nuevo = (window.OCAuth && window.OCAuth.generarCodigo) ? window.OCAuth.generarCodigo() : null;
      if (!nuevo) { alert("License generator not available."); return; }
      var owned = {};
      try { owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; } catch (_) {}
      owned.licenseCode = nuevo;
      owned.syncCode = nuevo;   // los dos campos describen la misma sala: se mueven juntos
      owned.licenseRotadaEn = Date.now();
      localStorage.setItem("f123_owned", JSON.stringify(owned));
      if (window.OCSyncControl) {
        try { window.OCSyncControl.desactivar(); } catch (_) {}
        try { window.OCSyncControl.activar(nuevo); } catch (_) {}
      }
      try { if (window.OCAuth && window.OCAuth.heartbeat) window.OCAuth.heartbeat({ instanceId: owned.instanceId, licenseCode: nuevo, accion: "rotacion" }); } catch (_) {}
      var mostrado = (window.OCSyncControl && window.OCSyncControl.paraMostrar) ? window.OCSyncControl.paraMostrar(nuevo) : nuevo;
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(mostrado)); } catch (_) {}
      var msg = document.getElementById("oc-sync-msg");
      if (msg) {
        msg.style.color = "#00805A";
        msg.innerHTML = "Done — this device now has a full license (copied to clipboard). Enter it on your other device to join:<br><code style=\"font-family:monospace;font-size:17px;letter-spacing:.08em;\">" + String(mostrado).replace(/[&<>]/g, "") + "</code>";
      } else {
        alert("Your new full license (copied):\n\n" + mostrado);
      }
    } catch (e) { alert((e && e.message) || "Could not generate a license."); }
  }

  /* EXPUESTAS PARA EL DASHBOARD (JFC 2026-08-28). El tablero pide estas
     acciones por orden remota (POST /micelio/fixlic y /micelio/rotar) y el
     dispositivo las ejecuta aquí. Antes solo se disparaban desde el botón de
     la sección Sync (que se quitó). */
  try { window.ocDarLicenciaBuena = ocDarLicenciaBuena; } catch (_) {}
  try { window.ocRotarCodigoSala = ocRotarCodigoSala; } catch (_) {}

})();
