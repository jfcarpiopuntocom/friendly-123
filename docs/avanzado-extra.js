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
  //   1) Automático — POST /api/sync/push y GET /api/sync/pull, si tu backend
  //      en Fly.io ya tiene esas rutas (relay ciego: solo guarda y reenvía
  //      bytes, nunca los descifra). Si no existen, falla en silencio: el
  //      negocio sigue 100% funcional en modo local.
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
      if (blob) localStorage.setItem("f123_sync_pending", blob);
    }
    async function restaurarCola() {
      if (!window.OCSecure.syncActiva()) return;
      const blob = localStorage.getItem("f123_sync_pending");
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
      const porDispositivo = {};
      ops.forEach((op) => { if (op.dev !== deviceId() && op.id && !aplicados.has(op.id)) (porDispositivo[op.dev] = porDispositivo[op.dev] || []).push(op); });
      for (const dev in porDispositivo) {
        const pendientes = porDispositivo[dev].sort((a, b) => a.ts - b.ts);
        for (const op of pendientes) {
          // Nunca reproducir contra otra cosa que no sea nuestra propia API —
          // un paquete manipulado o corrupto no debe poder hacer fetch a
          // cualquier URL arbitraria.
          if (typeof op.url !== "string" || op.url.indexOf("/api/") !== 0) break;
          try {
            await fetchOriginal(op.url, { method: op.method, headers: { "Content-Type": "application/json" }, body: op.body });
            aplicados.add(op.id);
          } catch (_) { break; /* se detiene aquí: preserva el orden para el próximo intento */ }
        }
      }
      guardarIdsAplicados(aplicados);
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

    // ---- Automático (si tu Fly.io ya tiene /api/sync/push y /api/sync/pull) ----
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
    function arrancarIntervalo() {
      if (temporizador) clearInterval(temporizador);
      temporizador = setInterval(() => { if (window.OCAuth && !window.OCAuth.rolActual()) return; push().then(pull); }, 4 * 60 * 1000); // sin sesion no hay trabajo
      if (!onlineListenerListo) {
        onlineListenerListo = true;
        window.addEventListener("online", () => { if (syncOn) push().then(pull); });
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
    chartBox.innerHTML = `<h3 class="seccion" style="margin-top:0;">Location comparison (this month)</h3><div id="oc-chart"></div>`;
    cont.appendChild(chartBox);

    // Mover PL / balance / valorizado (h3 + tabla-wrap) al contenedor
    const marcadores = ["tablaPL", "tablaBalance", "tablaValorizado"];
    marcadores.forEach((idTabla) => {
      const tabla = $(idTabla);
      if (!tabla) return;
      const wrap = tabla.closest(".tabla-wrap");
      const h3 = wrap && wrap.previousElementSibling;
      if (h3 && h3.tagName === "H3") cont.appendChild(h3);
      if (wrap) cont.appendChild(wrap);
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
        Download your full business data (products, sales, movements, costs, keys, and rack photos) in one file. Save it to your email, Drive, or anywhere — it's your backup if the cache is cleared or the device fails.</p>
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
        <button id="oc-caja-guardar" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Save checkpoint now</button>
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
      <h3 class="seccion" style="margin-top:0;">Access & recovery</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">Owner email for key recovery. Once saved, it's masked for privacy.</p>
      <div id="oc-email-row"></div>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:18px;">${window.t("auth.act.whatsappLabel")} — ${window.t("auth.act.whatsappHint")}</p>
      <div id="oc-whatsapp-row"></div>
      <div id="oc-clave-block" style="margin-top:18px;">
        <p style="font-size:14px;color:var(--ink-soft);">PINs (3 digits). For security, current codes are NOT shown here (stored encrypted) — enter NEW ones only if you want to change them.</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:340px;">
          <label style="font-size:13px;">Owner <input id="oc-c-owner" maxlength="3" inputmode="numeric" placeholder="•••" style="margin-left:8px;width:90px;text-align:center;font-family:var(--font-mono);padding:8px;border:2px solid var(--azul-medio);border-radius:5px;"></label>
          <label style="font-size:13px;">Employee <input id="oc-c-emp" maxlength="3" inputmode="numeric" placeholder="•••" style="margin-left:8px;width:90px;text-align:center;font-family:var(--font-mono);padding:8px;border:2px solid var(--azul-medio);border-radius:5px;"></label>
          <label style="font-size:13px;">Accounting <input id="oc-c-acct" maxlength="3" inputmode="numeric" placeholder="•••" style="margin-left:8px;width:90px;text-align:center;font-family:var(--font-mono);padding:8px;border:2px solid var(--azul-medio);border-radius:5px;"></label>
        </div>
        <button id="oc-save-codes" class="ir" style="margin-top:12px;background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Save new PINs</button>
        <p id="oc-codes-msg" style="font-size:14px;margin-top:8px;"></p>
      </div>`;
    vista.appendChild(gestion);

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
        <div id="oc-sync-apagado" style="display:${salaActiva ? "none" : "flex"};gap:8px;flex-wrap:wrap;align-items:center;">
          <input id="oc-sync-codigo" type="text" value="${escHtml(codigoPrecargado)}" placeholder="${window.t("sync.panel.codePlaceholder")}" maxlength="40"
            style="flex:1;min-width:220px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;font-size:14px;">
          <button id="oc-sync-activar" class="ir">${window.t("sync.panel.activate")}</button>
        </div>
        <div id="oc-sync-activo" style="display:${salaActiva ? "block" : "none"};">
          <p style="font-size:13px;color:var(--ink-soft);">${window.t("sync.panel.shareHint")}</p>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <code id="oc-sync-codigo-actual" style="font-size:16px;font-weight:700;background:var(--paper-deep,#E2E8ED);padding:6px 12px;border-radius:6px;">${escHtml(salaActiva || "")}</code>
            <div id="oc-sync-qr" style="margin-top:8px;"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button id="oc-sync-compartir" class="ir" style="background:#25D366;border-color:#1da851;">${window.t("sync.panel.share")}</button>
            <button id="oc-sync-resincronizar">${window.t("sync.panel.resync")}</button>
            <button id="oc-sync-rotar" style="border-color:#E86040;color:#E86040;">Change the code</button>
        <button id="oc-sync-desactivar" style="border-color:var(--rojo);color:var(--rojo);">${window.t("sync.panel.deactivate")}</button>
          </div>
        </div>
        <div id="oc-sync-unirse" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--azul-suave,#dde5ec);">
          <p style="font-size:14px;color:var(--ink-soft);margin:0 0 8px;">Joining from another device? Paste the team code here.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input id="oc-sync-codigo2" type="text" placeholder="F123-XXXX-XXXX" maxlength="40"
              style="flex:1;min-width:220px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-size:15px;">
            <button id="oc-sync-unirme" class="ir" style="min-height:44px;">Join this team</button>
          </div>
        </div>
        <p id="oc-sync-msg" style="font-size:13px;margin-top:8px;font-weight:700;"></p>`;
      vista.appendChild(panel);

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
      const pillColor = (estado) => {
        if (estado === "conectado") return "var(--sim-verde-dk,#1a6e3c)";
        if (estado === "apagado") return "var(--ink-soft)";
        if (window.OCSyncControl.problemaPersistente && window.OCSyncControl.problemaPersistente()) return "var(--rojo,#a3392a)";
        return "#B8760A";
      };

      function pintarEstado(estado, n) {
        const el = document.getElementById("oc-sync-estado");
        if (!el) return;
        const e = estado || window.OCSyncControl.estado();
        el.textContent = pillTexto(e, n != null ? n : window.OCSyncControl.presencia());
        el.style.color = pillColor(e);
      }
      pintarEstado();
      window.OCSyncControl.onEstado(pintarEstado);

      function pintarQR(codigo) {
        const cont = document.getElementById("oc-sync-qr");
        if (!cont || !window.qrcode) return;
        try {
          /* BUG EN VIVO (JFC 2026-08-19): el QR llevaba el texto suelto
             "AMIGABLE123-SYNC:<codigo>". La camara de cualquier telefono lo lee
             pero no sabe que hacer con el y responde "No usable data found".
             Ahora lleva una URL de verdad: la camara abre friendly-123 y la app
             ve ?join=<codigo> y ofrece unirse. Un solo escaneo, sin teclear. */
          const url = "https://jfcarpiopuntocom.github.io/friendly-123/?join=" + encodeURIComponent(codigo);
          const q = window.qrcode(0, "M");
          q.addData(url);
          q.make();
          cont.innerHTML = `<img src="${q.createDataURL(4, 4)}" width="140" height="140" alt="QR" style="border-radius:6px;">`;
        } catch (_) { /* QR es un extra visual */ }
      }
      if (salaActiva) pintarQR(salaActiva);

      document.getElementById("oc-sync-activar").addEventListener("click", (ev) => {
        const btn = ev.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, 1200);
        const codigo = document.getElementById("oc-sync-codigo").value;
        /* Guard (portado de amigable-123, 23ce907): pegar por error el codigo
           de la app hermana metia este negocio en la sala de otro. */
        if (codigo.trim() && !/^F123-/i.test(codigo.trim())) {
          const m0 = document.getElementById("oc-sync-msg");
          m0.style.color = "var(--rojo,#a3392a)";
          m0.textContent = "That code is not from friendly-123. Yours starts with F123-.";
          btn.disabled = false;
          return;
        }
        const r = window.OCSyncControl.activar(codigo);
        const msg = document.getElementById("oc-sync-msg");
        if (!r.ok) { msg.style.color = "var(--rojo,#a3392a)"; msg.textContent = r.error; return; }
        msg.textContent = "";
        document.getElementById("oc-sync-apagado").style.display = "none";
        document.getElementById("oc-sync-activo").style.display = "block";
        document.getElementById("oc-sync-codigo-actual").textContent = codigo.trim();
        pintarQR(codigo.trim());
      });
      const btnCompartir = document.getElementById("oc-sync-compartir");
      if (btnCompartir) btnCompartir.addEventListener("click", () => {
        const _c = (window.OCSyncControl.salaActiva() || "").trim();
        const codigo = /^F123-/i.test(_c) ? _c : "";   // mismo filtro que arriba
        const negocio = (function () { try { const s = document.getElementById("oc-negocio-nombre"); return s ? s.textContent.trim() : ""; } catch (_) { return ""; } })();
        const texto = window.t("sync.panel.shareText")
          .replace("{business}", negocio ? " (" + negocio + ")" : "")
          .replace("{code}", codigo);
        window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
      });
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
          if (!cod) { m2.style.color = "var(--rojo,#a3392a)"; m2.textContent = "Paste the team code first."; return; }
          if (!/^F123-/i.test(cod)) { m2.style.color = "var(--rojo,#a3392a)"; m2.textContent = "That code is not from friendly-123. It starts with F123-."; return; }
          const r2 = window.OCSyncControl.activar(cod);
          if (!r2.ok) { m2.style.color = "var(--rojo,#a3392a)"; m2.textContent = r2.error; return; }
          m2.style.color = "var(--sim-verde-dk,#1a6e3c)";
          m2.textContent = "Joined. This device is now syncing with the team.";
          document.getElementById("oc-sync-apagado").style.display = "none";
          document.getElementById("oc-sync-activo").style.display = "block";
          document.getElementById("oc-sync-codigo-actual").textContent = cod;
          pintarQR(cod);
        });
        /* Si llego por el QR (?join=CODIGO), el campo viene ya lleno: solo toca
           el boton. Lo pone el bloque de index.html que lee el parametro. */
        try {
          const pre = sessionStorage.getItem("f123_join_pendiente");
          if (pre) { document.getElementById("oc-sync-codigo2").value = pre; }
        } catch (_) {}
      })(),
      (function(){var _r=document.getElementById("oc-sync-rotar");if(_r&&!_r.dataset.listo){_r.dataset.listo="1";_r.addEventListener("click",ocRotarCodigoSala);}})(),document.getElementById("oc-sync-desactivar").addEventListener("click", () => {
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
      <div id="oc-emp-lista" style="margin-bottom:18px;"></div>
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
              <option value="empleado">Staff — day-to-day access (sales, inventory, shelves)</option>
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
      let equipo = [];
      try {
        const r = await fetch("/api/usuarios");
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

      lista.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="border-bottom:2px solid var(--azul-suave,#dde5ec);">
            <th style="text-align:left;padding:6px 8px;font-weight:700;">Member</th>
            <th style="text-align:center;padding:6px 8px;font-weight:700;">Role</th>
            <th style="text-align:center;padding:6px 8px;font-weight:700;">Status</th>
            <th style="text-align:right;padding:6px 8px;font-weight:700;">Actions</th>
          </tr></thead>
          <tbody id="oc-emp-tbody"></tbody>
        </table>`;
      const tbody = document.getElementById("oc-emp-tbody");

      equipo.forEach((u) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--azul-suave,#dde5ec)";
        const estadoColor  = u.activo ? "var(--sim-verde-dk,#1a6e3c)" : "var(--rojo,#a3392a)";
        const estadoTxt    = u.activo ? "Active" : "Inactive";
        const btnEstLabel  = u.activo ? "Deactivate" : "Activate";
        const btnEstColor  = u.activo ? "var(--rojo,#a3392a)" : "var(--sim-verde-dk,#1a6e3c)";
        const rolBadge     = u.rol === "admin"
          ? `<span style="font-size:13px;font-weight:700;background:#E8A020;color:#fff;padding:2px 7px;border-radius:10px;">Admin</span>`
          : `<span style="font-size:13px;font-weight:700;background:var(--azul-medio,#2c4a68);color:#fff;padding:2px 7px;border-radius:10px;">Staff</span>`;
        // Admin solo puede editar encargados, no a otros admins (seguridad por capas)
        const puedeEditar = isDueno() || (isAdmin() && u.rol === "empleado");
        // Promover/degradar (JFC 2026-07-30: "hazlo una lista dinamica y permite
        // editar y promote y demote") — solo el dueño decide quién es admin.
        const puedePromover = isDueno();
        const ping = ultimasUbic["u:" + u.id];
        const ubicHtml = (isDueno() || isAdmin())
          ? (ping
              ? `<div style="font-size:13px;color:var(--ink-soft);">📍 ${window.tf("geo.emp.lastSeen", { when: hacetiempo(ping.ts) })}${
                  (ping.lat != null && ping.lon != null)
                    ? ` · <a href="https://www.google.com/maps?q=${ping.lat},${ping.lon}" target="_blank" rel="noopener" style="color:var(--azul-medio);">${window.t("geo.panel.viewMap")}</a>` +
                      (ping.precision != null && ping.precision > 300
                        ? ` <span style="color:#E8A020;">(approximate, ±${ping.precision}m — not exact)</span>`
                        : ping.precision != null ? ` (±${ping.precision}m)` : "")
                    : " · " + window.t("geo.emp.noLocationThatTime")
                }</div>`
              : `<div style="font-size:13px;color:var(--ink-soft);">📍 ${window.t("geo.emp.none")}</div>`)
          : "";
        tr.innerHTML = `
          <td style="padding:8px;">
            <div style="font-weight:700;">${escHtml(u.nombre)}</div>
            ${u.email ? `<div style="font-size:13px;color:var(--ink-soft);">${escHtml(u.email)}</div>` : ""}
            ${ubicHtml}
          </td>
          <td style="padding:8px;text-align:center;">${rolBadge}</td>
          <td style="padding:8px;text-align:center;color:${estadoColor};font-weight:700;">${estadoTxt}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap;">
            ${puedeEditar ? `
              <button data-toggle-id="${escHtml(u.id)}" data-activo="${u.activo}"
                style="font-size:13px;padding:5px 10px;border:2px solid ${btnEstColor};
                       border-radius:5px;background:transparent;color:${btnEstColor};cursor:pointer;">
                ${btnEstLabel}
              </button>
              <button data-cambiar-pin="${escHtml(u.id)}"
                style="font-size:13px;padding:5px 10px;border:2px solid var(--azul-medio);
                       border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;margin-left:4px;">
                PIN
              </button>
              ${puedePromover ? `
                <button data-cambiar-rol="${escHtml(u.id)}" data-rol-actual="${escHtml(u.rol)}"
                  style="font-size:13px;padding:5px 10px;border:2px solid #E8A020;
                         border-radius:5px;background:transparent;color:#E8A020;cursor:pointer;margin-left:4px;">
                  ${u.rol === "admin" ? "Demote to staff" : "Promote to admin"}
                </button>
              ` : ""}
            ` : `<span style="font-size:13px;color:var(--ink-soft);">Owner only</span>`}
          </td>`;
        tbody.appendChild(tr);

        // Fila inline para cambiar PIN (oculta hasta click en "PIN")
        if (puedeEditar) {
          const trPin = document.createElement("tr");
          trPin.id = `oc-pin-row-${u.id}`;
          trPin.style.cssText = "display:none;background:var(--azul-suave,#EEF3F7);";
          trPin.innerHTML = `
            <td colspan="4" style="padding:10px 12px;">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <span style="font-size:13px;font-weight:700;">Nuevo PIN para ${escHtml(u.nombre)}:</span>
                <input data-pin-input="${escHtml(u.id)}" maxlength="3" inputmode="numeric" placeholder="•••"
                  style="width:80px;padding:7px 10px;border:2px solid var(--azul-medio);border-radius:5px;
                         font-size:14px;text-align:center;font-family:var(--font-mono);letter-spacing:.15em;">
                <button data-guardar-pin="${escHtml(u.id)}"
                  style="padding:7px 14px;border:2px solid var(--azul-medio);border-radius:5px;
                         background:var(--azul-medio);color:var(--blanco-calido);font-size:13px;font-weight:700;cursor:pointer;">
                  Guardar
                </button>
                <span data-pin-msg="${escHtml(u.id)}" style="font-size:13px;font-weight:700;"></span>
              </div>
            </td>`;
          tbody.appendChild(trPin);
        }
      });

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

      // Bind: promover/degradar (solo dueño ve el botón, ver puedePromover arriba)
      tbody.querySelectorAll("[data-cambiar-rol]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.cambiarRol;
          const rolNuevo = btn.dataset.rolActual === "admin" ? "empleado" : "admin";
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
            msg.textContent = "PIN actualizado.";
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
        msgEl.textContent = `${data.rol === "admin" ? "Admin" : "Staff member"} "${data.nombre}" added.`;
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
            const hoy = new Date().toISOString().slice(0, 10);
            const delHoy = (Array.isArray(movs) ? movs : []).filter((m) => (m.fecha || "").slice(0, 10) === hoy);
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

    // --- Transferencias (brote 2) — panel operativo, fuera del candado
    // contable: el dueño necesita aprobar/rechazar rápido, no es info financiera.
    const transfPanel = document.createElement("div");
    transfPanel.className = "tag-card";
    transfPanel.style.cssText = "text-align:left;margin-top:22px;";
    transfPanel.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Transfers between locations</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">Stock transfer requests between your locations.</p>
      <div id="oc-transf-lista"></div>`;
    vista.appendChild(transfPanel);
    renderTransferencias();

    // --- Sync remoto (opcional, JFC 2026-07-04) — LOCAL-FIRST por diseño:
    // sin URL guardada, el negocio corre 100% local (server.js + db.json o
    // mock-backend.js en la demo). Esto NO es un backend obligatorio: es
    // solo el canal para que el panel central master de JFC pueda mandar
    // patches/actualizaciones a este negocio via PocketBase en Fly.io.
    // Ver docs/pocketbase-client.js para el adaptador completo.
    const syncPanel = document.createElement("div");
    syncPanel.className = "tag-card";
    syncPanel.style.cssText = "text-align:left;margin-top:22px;";
    const pbUrlActual = localStorage.getItem("F123_PB_URL") || "";
    const conectado = !!(window.OC_PB_CONNECTED);
    syncPanel.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Remote sync (optional)</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        By default this system runs 100% locally, without depending on the internet.
        Only if you want to receive updates from the central panel, paste
        your PocketBase URL on Fly.io here.
      </p>
      <p style="font-size:14px;font-weight:700;margin:8px 0;color:${conectado ? "var(--sim-verde-dk)" : "var(--ink)"};">
        Estado: ${conectado ? "Connected" : "Local (no sync)"}
      </p>
      <input id="oc-pb-url" type="text" placeholder="https://tu-negocio.fly.dev" value="${escHtml(pbUrlActual)}" style="width:100%;max-width:340px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;">
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
        <button id="oc-pb-guardar" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Save and connect</button>
        ${pbUrlActual ? `<button id="oc-pb-quitar" class="ir" style="background:transparent;color:var(--rojo);border-color:var(--rojo);">Switch to local</button>` : ""}
      </div>
      <p id="oc-pb-msg" style="font-size:14px;margin-top:8px;"></p>`;
    vista.appendChild(syncPanel);

    $("oc-pb-guardar").addEventListener("click", () => {
      const url = $("oc-pb-url").value.trim();
      if (!url) { msg("oc-pb-msg", "Paste your PocketBase URL first.", "var(--rojo)"); return; }
      localStorage.setItem("F123_PB_URL", url);
      msg("oc-pb-msg", "Saved. Reloading to connect...", "var(--sim-verde-dk)");
      setTimeout(() => window.location.reload(), 800);
    });
    const btnQuitar = document.getElementById("oc-pb-quitar");
    if (btnQuitar) btnQuitar.addEventListener("click", () => {
      localStorage.removeItem("F123_PB_URL");
      msg("oc-pb-msg", "Sync removed. Reloading in local mode...", "var(--ink)");
      setTimeout(() => window.location.reload(), 800);
    });

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
      micPanel.innerHTML = '<h3 class="seccion" style="margin-top:0;">Your team right now</h3><div id="oc-micelio-panel"></div>';
      vista.appendChild(micPanel);
      if (window.OCMicelioUI) window.OCMicelioUI.pintarPanel();
    } catch (e) { console.error("Panel micelio no cargo (aislado, no rompe Avanzado):", e); }

    const syncDevPanel = document.createElement("div");
    syncDevPanel.id = "oc-syncdev-panel";
    syncDevPanel.className = "tag-card";
    syncDevPanel.style.cssText = "text-align:left;margin-top:22px;";
    vista.appendChild(syncDevPanel);
    pintarSyncDev();

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
    (function () {
      try {
        const HINTS = {
          "Accounting layer": "T-accounts, P&L, balance sheet, valued inventory. Needs a passcode.",
          "Recent activity": "Today's operational history.",
          "Timezone": "Sets what counts as \"today\" for sales and closes.",
          "Monthly expenses": "Rent, payroll, utilities… prorated into the P&L.",
          "Access & recovery": "Email, WhatsApp, PINs and password.",
          "Sync your team": "Live sync across every device on your team.",
          "Team": "Team members, roles and PINs for this business.",
          "Activity log": "Who did what, and when.",
          "Your team right now": "Who is synced and who is not.",
          "Fraud control": "Integrity of sensitive operations.",
          "Transfers between locations": "Move stock between branches.",
          "Remote sync (optional)": "Your own PocketBase, if you set one up.",
          "Device-to-device sync": "Encrypted package for another device, no internet needed.",
          "Where the team has been": "Location pings while a session is open.",
        };
        function esComo(t) { t = (t || "").trim(); return /^¿?Cómo funciona/i.test(t) || /^How does it work/i.test(t); }
        function tituloDe(n) {
          if (!n || n.nodeType !== 1) return null;
          if (n.id === "oc-acct-lock") return "Accounting layer";
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
          if (n.id === "oc-riel-fila") return;
          if (n.tagName === "DETAILS") { const sm = n.querySelector("summary"); if (sm && esComo(sm.textContent)) return; }
          mover.push(n);
        });
        mover.forEach((n) => {
          contR.appendChild(n);
          if (n.id === "oc-contable") return;
          const t = tituloDe(n); if (!t) return;
          const id = idDe(n, idx++); hint(n, t); secciones.push({ id, label: t });
        });
        rNav.innerHTML = secciones.map((s) =>
          `<button type="button" data-riel-go="${s.id}" style="display:block;width:100%;text-align:left;background:none;border:none;border-left:3px solid transparent;padding:9px 8px;margin:0;font-size:13px;font-weight:700;cursor:pointer;line-height:1.3;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;">${s.label}</button>`
        ).join("");
        fila.appendChild(rNav); fila.appendChild(contR); vista.appendChild(fila);

        function activo(id) {
          rNav.querySelectorAll("[data-riel-go]").forEach((b) => {
            const a = b.getAttribute("data-riel-go") === id;
            b.style.borderLeftColor = a ? "var(--azul-medio,#2c4a68)" : "transparent";
            b.style.background = a ? "var(--azul-suave,#dde5ec)" : "none";
            b.style.color = a ? "var(--azul-medio,#2c4a68)" : "var(--ink-soft,#5d5340)";
            b.style.setProperty("-webkit-text-fill-color", a ? "var(--azul-medio,#2c4a68)" : "var(--ink-soft,#5d5340)");
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
              b.textContent = t; rNav.appendChild(b);
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
      } catch (_) { /* si el riel falla, los paneles ya armados arriba siguen visibles tal cual estaban - cero riesgo */ }
    })();

    window.OCAuth.listo().then(() => { pintarEmail(); pintarWhatsapp(); });

    // Cambiar los 3 PINs rota TODO (nuevo salt + nuevos hashes). Por eso se
    // piden los tres juntos: no se puede "mantener" un hash viejo bajo un
    // salt nuevo. JFC pidió explícitamente: si el dueño cambia su código,
    // EXIGIR que ya tenga un correo de recuperación guardado (si no, no se
    // puede recuperar el código nuevo si se le olvida). El correo en sí no
    // se toca aquí — se preserva tal cual esté guardado.
    $("oc-save-codes").addEventListener("click", async () => {
      if (window.OCAuth.esDemo && window.OCAuth.esDemo()) return; // demo: sin cambio de claves
      const o = $("oc-c-owner").value.trim(), e = $("oc-c-emp").value.trim(), a = $("oc-c-acct").value.trim();
      const valido = (s) => /^[0-9]{3}$/.test(s);
      if (![o, e, a].every(valido)) { msg("oc-codes-msg", "Each PIN must be 3 digits (0-9).", "var(--rojo)"); return; }
      const correoActual = window.OCSecure.leerCorreo();
      if (!correoActual) { msg("oc-codes-msg", "Before changing PINs, register your recovery email above (if you forget the new PIN, without an email there is no way to recover it).", "var(--rojo)"); return; }
      await window.OCSecure.guardarSecreto(o, [e], a, correoActual);
      $("oc-c-owner").value = ""; $("oc-c-emp").value = ""; $("oc-c-acct").value = "";
      msg("oc-codes-msg", "PINs saved and encrypted.", "var(--verde)");
    });

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
      const csv = "﻿" + filas.join("\n"); // BOM para que Excel abra tildes bien
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `reporte-contable-amigable-${new Date().toISOString().slice(0, 10)}.csv`;
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
        a.download = `respaldo-amigable-${new Date().toISOString().slice(0, 10)}.json`;
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
    (async () => {
      try {
        if (!navigator.storage || !navigator.storage.estimate) return;
        const { usage, quota } = await navigator.storage.estimate();
        if (!quota) return;
        const pct = Math.round((usage / quota) * 100);
        if (pct < 80) return; // sin problema, no molestamos
        const aviso = document.createElement("p");
        aviso.id = "oc-storage-aviso";
        aviso.style.cssText = "font-size:14px;font-weight:700;color:var(--rojo,#a3392a);"
          + "background:#fff5f5;border:2px solid var(--rojo,#a3392a);border-radius:8px;"
          + "padding:10px 14px;margin:0 0 14px;";
        aviso.textContent = "Storage at " + pct + "% — consider deleting old shelf photos, "
          + "or making a backup from Checkpoints and then freeing space on your device.";
        const vista = document.getElementById("vista-avanzado");
        if (vista && !document.getElementById("oc-storage-aviso")) vista.insertBefore(aviso, vista.firstChild);
      } catch (_) {}
    })();

    // Fase 1 (2026-08-04): aviso de PERSISTENCIA, distinto del aviso de cuota
    // de arriba. Cuota = "te estas quedando sin espacio". Persistencia =
    // "el sistema operativo puede borrar tus datos sin avisar si no usas la
    // app por unos dias" (tipico en iOS Safari sin instalar la PWA). Es el
    // riesgo mas serio de perdida total de datos y el mas barato de evitar:
    // instalar la app en la pantalla de inicio sube mucho la probabilidad de
    // que el navegador conceda persistencia.
    (async () => {
      try {
        if (!window.OCStorageDurable) return;
        const persistido = await window.OCStorageDurable.verificarYSolicitar();
        if (persistido !== false) return; // true = protegido, null = API no existe (nada que avisar)
        if (document.getElementById("oc-persist-aviso")) return;
        const aviso = document.createElement("p");
        aviso.id = "oc-persist-aviso";
        aviso.style.cssText = "font-size:14px;font-weight:700;color:var(--rojo,#a3392a);"
          + "background:#fff5f5;border:2px solid var(--rojo,#a3392a);border-radius:8px;"
          + "padding:10px 14px;margin:0 0 14px;";
        aviso.textContent = "Your data is only in this browser, and the operating system can "
          + "delete it if you do not use the app for several days — install friendly-123 on your home "
          + "screen (browser menu → \"Add to Home Screen\" / \"Install app\") and back up "
          + "often from Checkpoints.";
        const vista = document.getElementById("vista-avanzado");
        if (vista && !document.getElementById("oc-persist-aviso")) vista.insertBefore(aviso, vista.firstChild);
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
  async function renderTransferencias() {
    const cont = $("oc-transf-lista");
    if (!cont) return;
    // Reforzado (JFC 2026-07-18): sin este guard, aprobar/rechazar/confirmar
    // una transferencia hacia el re-render, y si la red fallaba en ese
    // re-render la lista se quedaba muda (parecia que el boton no hizo nada).
    let lista;
    try {
      lista = await (await fetch(`${API}/transferencias`)).json();
    } catch (err) {
      console.error("[renderTransferencias]", err);
      cont.innerHTML = `<p style="font-size:14px;color:var(--rojo,#a3392a);">Could not load. Check your connection and try again.</p>`;
      return;
    }
    if (!lista.length) { cont.innerHTML = `<p style="font-size:14px;color:var(--ink-soft);">No transfers yet.</p>`; return; }
    cont.innerHTML = lista.map((t) => {
      const colorEstado = t.estado === "recibida" ? "verde" : t.estado === "rechazada" ? "rojo" : t.estado === "en_transito" ? "azul" : "amarillo";
      let acciones = "";
      if (t.estado === "solicitada") {
        acciones = `<button data-transf-aprobar="${t.id}" style="font-size:13px;padding:6px 10px;border:2px solid var(--verde);border-radius:5px;background:transparent;color:var(--verde);cursor:pointer;">Approve</button>
          <button data-transf-rechazar="${t.id}" style="font-size:13px;padding:6px 10px;border:2px solid var(--rojo);border-radius:5px;background:transparent;color:var(--rojo);cursor:pointer;">Reject</button>`;
      } else if (t.estado === "en_transito") {
        acciones = `<button data-transf-confirmar="${t.id}" style="font-size:13px;padding:6px 10px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Confirm receipt</button>`;
      }
      return `<div class="tag-card" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <strong>${escHtml(t.nombre)}</strong> · ${t.cantidad} un.
          <div style="font-size:13px;color:var(--ink-soft);">${escHtml(t.desdeNombre)} → ${escHtml(t.haciaNombre)}</div>
        </div>
        <span class="badge-estado ${colorEstado}">${t.estado.replace("_", " ")}</span>
        ${acciones}
      </div>`;
    }).join("");

    // try/catch (homologado de AMIGABLE, auditoria 2026-07-23): los 3
    // botones de transferencias no tenian proteccion de red.
    cont.querySelectorAll("[data-transf-aprobar]").forEach((btn) => btn.addEventListener("click", async () => {
      let res, r;
      try { res = await fetch(`${API}/transferencias/${btn.dataset.transfAprobar}/aprobar`, { method: "POST" }); r = await res.json(); }
      catch (err) { console.error("[transf-aprobar]", err); alert("Could not reach the server. Try again."); return; }
      if (!res.ok) { alert(r.error); return; }
      renderTransferencias();
    }));
    cont.querySelectorAll("[data-transf-rechazar]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await fetch(`${API}/transferencias/${btn.dataset.transfRechazar}/rechazar`, { method: "POST" }); }
      catch (err) { console.error("[transf-rechazar]", err); alert("Could not reach the server. Try again."); return; }
      renderTransferencias();
    }));
    cont.querySelectorAll("[data-transf-confirmar]").forEach((btn) => btn.addEventListener("click", async () => {
      let res, r;
      try { res = await fetch(`${API}/transferencias/${btn.dataset.transfConfirmar}/confirmar-recepcion`, { method: "POST" }); r = await res.json(); }
      catch (err) { console.error("[transf-confirmar]", err); alert("Could not reach the server. Try again."); return; }
      if (!res.ok) { alert(r.error); return; }
      renderTransferencias();
      cargarInventario();
    }));
  }

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
            body: JSON.stringify({ instanceId: owned.instanceId, licenseCode: owned.licenseCode || "", email: window.OCSecure.leerCorreo() || "", whatsapp: v, accion: "update" }),
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
  function pintarSyncDev() {
    const box = $("oc-syncdev-panel");
    if (!box) return;
    const activo = OCSync.activa();
    const necesitaPin = OCSync.requiereReactivar();
    const pend = OCSync.pendientes();
    box.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Device-to-device sync</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        For when the same business runs on more than one phone/tablet (e.g. register and stockroom).
        Each device encrypts its own changes with your owner PIN — not even the
        sync server can read them.
      </p>
      <p style="font-size:14px;font-weight:700;margin:8px 0;color:${activo && !necesitaPin ? "var(--sim-verde-dk)" : "var(--ink)"};">
        Estado: ${!activo ? "Disabled" : necesitaPin ? "Enabled, but needs your PIN again in this browser" : "Enabled"}
        ${activo && !necesitaPin && pend ? ` · ${pend} change(s) pending` : ""}
      </p>
      <p id="oc-syncdev-msg" style="font-size:14px;font-weight:700;margin-bottom:10px;"></p>
      ${(!activo || necesitaPin) ? `
        <button id="oc-syncdev-activar" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">${necesitaPin ? "Enter PIN to reactivate" : "Enable on this device (needs your PIN)"}</button>
      ` : `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <button id="oc-syncdev-push" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">🔄 Auto sync (Fly.io)</button>
          <button id="oc-syncdev-copiar" class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);">📋 Copy changes to send</button>
          <button id="oc-syncdev-wa-cambios" class="ir" style="background:#25D366;color:#0a3d20;border-color:#1da851;">📲 Recent changes → WhatsApp</button>
          <button id="oc-syncdev-wa-respaldo" class="ir" style="background:#128C7E;color:#e8fff7;border-color:#0c6b60;">📲 Full backup → WhatsApp</button>
          <button id="oc-syncdev-qr-mostrar" class="ir" style="background:var(--azul-oscuro);color:var(--blanco-calido);border-color:var(--brass);">📱 Show changes QR</button>
          <button id="oc-syncdev-qr-escanear" class="ir" style="background:var(--azul-oscuro);color:var(--blanco-calido);border-color:var(--brass);">Scan QR from other device</button>
          <button id="oc-syncdev-off" style="font-size:13px;padding:8px 12px;border:2px solid var(--rojo);border-radius:5px;background:transparent;color:var(--rojo);cursor:pointer;">Disable</button>
        </div>
        <div id="oc-syncdev-qr-zona" style="display:none;margin:10px 0;text-align:center;"></div>
        <details><summary style="font-size:14px;cursor:pointer;color:var(--azul-medio);">Paste changes received from another device</summary>
          <textarea id="oc-syncdev-pegar" rows="3" placeholder="Paste the text starting with OCSYNC1: here..." style="width:100%;margin-top:8px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);font-size:13px;"></textarea>
          <button id="oc-syncdev-importar" class="ir" style="margin-top:8px;background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Import</button>
        </details>
      `}`;

    const btnActivar = $("oc-syncdev-activar");
    if (btnActivar) btnActivar.addEventListener("click", async () => {
      const pin = prompt("Owner PIN (3 digits) to enable sync on this device:");
      if (pin === null) return;
      const ok = await OCSync.activar(pin.trim());
      msg("oc-syncdev-msg", ok ? "Sync enabled on this device." : "Incorrect PIN.", ok ? "var(--verde)" : "var(--rojo)");
      pintarSyncDev();
    });
    const btnPush = $("oc-syncdev-push");
    if (btnPush) btnPush.addEventListener("click", async () => {
      msg("oc-syncdev-msg", "Sending and receiving...", "var(--ink)");
      const rPush = await OCSync.push();
      const rPull = await OCSync.pull();
      if (rPush.ok && rPull.ok) msg("oc-syncdev-msg", `Done. Sent: ${rPush.enviado || 0} · Received: ${rPull.recibido || 0}.`, "var(--verde)");
      else msg("oc-syncdev-msg", (rPush.motivo || rPull.motivo) + " In the meantime, use \"Copy changes\".", "var(--rojo)");
      pintarSyncDev();
    });
    const btnCopiar = $("oc-syncdev-copiar");
    if (btnCopiar) btnCopiar.addEventListener("click", async () => {
      const texto = await OCSync.generarPaqueteManual();
      if (!texto) { msg("oc-syncdev-msg", "No pending changes on this device.", "var(--ink)"); return; }
      try { await navigator.clipboard.writeText(texto); msg("oc-syncdev-msg", "Copied. Send it to the other device via WhatsApp or any channel.", "var(--verde)"); }
      catch (_) { prompt("Copia este texto manualmente:", texto); }
      pintarSyncDev();
    });

    // Enviar CAMBIOS RECIENTES (op-log cifrado) por WhatsApp. Prioridad:
    // 1) Web Share (movil: WhatsApp aparece entre las apps) 2) wa.me si es corto
    // 3) copiar al portapapeles. El receptor los aplica en "Pegar cambios".
    const btnWaCambios = $("oc-syncdev-wa-cambios");
    if (btnWaCambios) btnWaCambios.addEventListener("click", async () => {
      const texto = await OCSync.generarPaqueteManual();
      if (!texto) { msg("oc-syncdev-msg", "There are no pending changes on this device.", "var(--ink)"); return; }
      const mensaje = "friendly-123 — changes to sync. Paste this on the other device (Advanced → Paste changes):\n\n" + texto;
      if (navigator.share) {
        try { await navigator.share({ text: mensaje }); msg("oc-syncdev-msg", "Shared. On the other device: Advanced → Paste changes.", "var(--verde)"); return; } catch (_) {}
      }
      if (mensaje.length < 1500) { window.open("https://wa.me/?text=" + encodeURIComponent(mensaje), "_blank"); msg("oc-syncdev-msg", "Opened WhatsApp with the changes ready to send.", "var(--verde)"); return; }
      try { await navigator.clipboard.writeText(texto); msg("oc-syncdev-msg", "Too many changes for a direct link. Copied them — paste them yourself in WhatsApp.", "var(--verde)"); }
      catch (_) { prompt("Copy this text and send it via WhatsApp:", texto); }
    });

    // Enviar RESPALDO COMPLETO (.json cifrado) por WhatsApp como ARCHIVO.
    // Reusa exactamente el mismo empaquetado que "Exportar respaldo" (checksum +
    // cifrado opcional AES-256-GCM). Web Share nivel 2 adjunta el archivo; si el
    // navegador no lo soporta, lo descarga y pide adjuntarlo a mano.
    const btnWaResp = $("oc-syncdev-wa-respaldo");
    if (btnWaResp) btnWaResp.addEventListener("click", async () => {
      try {
        const datos = await (await fetch(`${API}/respaldo/exportar`)).json();
        try { if (window.OCArchivo) { const arch = await window.OCArchivo.leerTodos(); if (arch.length) datos.movimientos = [...arch, ...(datos.movimientos || [])]; } } catch (_) {}
        const fotosPerchas = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("f123_foto_percha_") === 0) fotosPerchas[k] = localStorage.getItem(k); }
        const paquete = { schemaVersion: 2, fecha: new Date().toISOString(), datos, oc_secure: (function () {
          // SEGURIDAD 2026-07-17: ownerPinR va XOR-ofuscado con clave fija visible
          // en el fuente — cualquiera con el archivo recuperaria el PIN del dueno.
          // Se quita del export; la recuperacion "Olvidaste?" se re-arma sola en
          // el proximo cambio de PIN tras restaurar.
          try { const s = JSON.parse(localStorage.getItem("f123_secure")); if (s) delete s.ownerPinR; return s ? JSON.stringify(s) : null; } catch (_) { return localStorage.getItem("f123_secure"); }
        })(), fotosPerchas };
        const contenidoPlano = JSON.stringify(paquete);
        const checksum = await window.OCSecure.hashTexto(contenidoPlano);
        const clave = prompt("Key to encrypt the backup before sending via WhatsApp (min 8 chars). Leave blank = no encryption (not recommended for WhatsApp):");
        if (clave === null) { msg("oc-syncdev-msg", "Send cancelled.", "var(--ink)"); return; }
        let archivoFinal;
        if (clave && clave.trim()) { const cif = await window.OCSecure.cifrarTextoConClave(contenidoPlano, clave.trim()); archivoFinal = JSON.stringify({ amigableRespaldoCifrado: true, checksum, ...cif }, null, 2); }
        else archivoFinal = JSON.stringify({ ...paquete, checksum }, null, 2);
        // Fase 4 (2026-08-04): mismo autoverificado que el export principal —
        // ver comentario extenso en el handler de oc-exportar.
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
          msg("oc-syncdev-msg", "The backup did not pass its own check (" + eVerif.message + ") — it was not sent. Try again.", "var(--rojo)");
          return;
        }
        const nombre = `respaldo-amigable-${new Date().toISOString().slice(0, 10)}.json`;
        const file = new File([archivoFinal], nombre, { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "friendly-123 backup", text: "My business backup (friendly-123)." });
          msg("oc-syncdev-msg", "Backup shared. On the other device: Advanced → Import backup.", "var(--verde)");
        } else {
          const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
          msg("oc-syncdev-msg", "Your browser doesn't share files directly. Downloaded it — attach it yourself in WhatsApp.", "var(--ink)");
        }
      } catch (e) { msg("oc-syncdev-msg", "Could not prepare the backup: " + e.message, "var(--rojo)"); }
    });
    const btnImportar = $("oc-syncdev-importar");
    if (btnImportar) btnImportar.addEventListener("click", async () => {
      const texto = $("oc-syncdev-pegar").value;
      const r = await OCSync.importarPaqueteManual(texto);
      msg("oc-syncdev-msg", r.ok ? `Importado. ${r.recibido || 0} cambio(s) aplicados.` : r.motivo, r.ok ? "var(--verde)" : "var(--rojo)");
      if (r.ok) $("oc-syncdev-pegar").value = "";
    });
    const btnOff = $("oc-syncdev-off");
    if (btnOff) btnOff.addEventListener("click", () => {
      if (!confirm("Disable sync on this device?")) return;
      OCSync.desactivar();
      pintarSyncDev();
    });

    // ========================================================================
    // SYNC POR QR ENTRE DISPOSITIVOS (recomendación 9, JFC 2026-07-07)
    // ------------------------------------------------------------------------
    // Canal físico sin internet: el paquete es el MISMO OCSYNC1 cifrado
    // (AES-256-GCM derivado del PIN de dueño, dedup por op.id al importar) —
    // idéntico nivel de seguridad que copiar/pegar; solo cambia el transporte.
    // Un QR guarda ~1KB cómodo, así que el paquete se parte en FRAGMENTOS:
    //   OCQ|<sesión>|<i>|<total>|<pedazo>
    // El receptor los escanea en cualquier orden; cuando junta todos, importa.
    //
    // HONESTIDAD TÉCNICA (por qué QR y no Bluetooth): los navegadores web NO
    // pueden hacer Bluetooth teléfono-a-teléfono — Web Bluetooth solo actúa
    // como "central" (no como periférico anunciable) y en iOS ni existe.
    // Mesh BLE real exigiría empaquetar la app como nativa (p.ej. Capacitor);
    // queda anotado como camino futuro. El QR es hoy el canal offline
    // universal: cámara a cámara, cero red, cero servidor.
    //
    // Escáner: usa BarcodeDetector (Chrome/Android). Donde no exista (iOS
    // Safari), el botón lo dice honesto y el camino es Copiar/Pegar.
    // ========================================================================
    const QR_CHUNK = 700; // caracteres por QR: legible rápido en pantallas medianas
    function qrLib() { return window.qrcode || null; }

    async function mostrarQRCambios() {
      const zona = $("oc-syncdev-qr-zona");
      if (zona.style.display !== "none") { zona.style.display = "none"; zona.innerHTML = ""; return; }
      if (!qrLib()) { msg("oc-syncdev-msg", "The local QR generator did not load (qrcode-local.js).", "var(--rojo)"); return; }
      const texto = await OCSync.generarPaqueteManual();
      if (!texto) { msg("oc-syncdev-msg", "There are no pending changes on this device.", "var(--ink)"); return; }
      const sesion = Math.random().toString(36).slice(2, 6);
      const total = Math.ceil(texto.length / QR_CHUNK);
      // FIX preventivo 2026-07-07: con una cola enorme (semanas sin sincronizar)
      // esto generaria decenas de QRs y congelaria la pestana. Tope duro y
      // camino claro: para paquetes grandes, Copiar/Pegar es el canal correcto.
      if (total > 12) { msg("oc-syncdev-msg", `Too many changes for QR (${total} codes). Use "Copy changes" and paste on the other device — same security.`, "var(--rojo)"); return; }
      let html = `<p style="font-size:14px;font-weight:700;color:var(--ink);">Scan ${total > 1 ? "the " + total + " codes, in any order," : "this code"} from the other device (Advanced → Escanear QR):</p>`;
      for (let i = 0; i < total; i++) {
        const frag = "OCQ|" + sesion + "|" + (i + 1) + "|" + total + "|" + texto.slice(i * QR_CHUNK, (i + 1) * QR_CHUNK);
        const q = qrLib()(0, "M");
        q.addData(frag);
        q.make();
        html += `<div style="display:inline-block;background:#FFFFFF;padding:10px;border:2px solid var(--sim-plata,#C4CDD8);border-radius:8px;margin:6px;"><img src="${q.createDataURL(4, 8)}" alt="QR ${i + 1} de ${total}" style="display:block;max-width:240px;width:100%;image-rendering:pixelated;"><span style="font-family:var(--font-mono);font-size:13px;color:#0F1923;">${i + 1} / ${total}</span></div>`;
      }
      zona.innerHTML = html;
      zona.style.display = "block";
      msg("oc-syncdev-msg", "QR codes ready. Changes are NOT removed here until the other device imports them (dedup by op: scanning twice does not duplicate).", "var(--verde)");
    }

    let escaneoActivo = null; // { stream, timer } para poder apagar la cámara siempre
    function detenerEscaneo() {
      if (!escaneoActivo) return;
      clearInterval(escaneoActivo.timer);
      escaneoActivo.stream.getTracks().forEach((t) => t.stop());
      const ov = $("oc-syncdev-qr-overlay");
      if (ov) ov.remove();
      escaneoActivo = null;
    }

    // FIX preventivo 2026-07-07: si cierran la pestana o navegan con el
    // escaner abierto, la camara quedaria tomada hasta matar el navegador.
    window.addEventListener("pagehide", detenerEscaneo);
    document.addEventListener("visibilitychange", () => { if (document.hidden) detenerEscaneo(); });

    async function escanearQRCambios() {
      if (!("BarcodeDetector" in window)) {
        msg("oc-syncdev-msg", "This browser cannot scan QR codes (common on iPhone). Use \"Copy changes\" and paste on the other device — same security.", "var(--rojo)");
        return;
      }
      if (!window.OCSecure.syncActiva()) { msg("oc-syncdev-msg", "First enable sync with your PIN.", "var(--rojo)"); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
      catch (_) { msg("oc-syncdev-msg", "Could not open camera (permission denied?).", "var(--rojo)"); return; }
      const ov = document.createElement("div");
      ov.id = "oc-syncdev-qr-overlay";
      ov.style.cssText = "position:fixed;inset:0;z-index:10001;background:#0F1923;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;";
      ov.innerHTML = `
        <video autoplay playsinline style="width:100%;max-width:420px;border-radius:10px;border:3px solid #5294AC;"></video>
        <p id="oc-qr-progreso" style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:17px;font-weight:700;margin:0;">Point at the QR from the other device...</p>
        <button id="oc-qr-cerrar" style="min-height:44px;padding:10px 22px;border-radius:8px;border:2px solid #5294AC;background:transparent;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:16px;font-weight:700;cursor:pointer;">Cancelar</button>`;
      document.body.appendChild(ov);
      const video = ov.querySelector("video");
      video.srcObject = stream;
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const frags = {}; // sesión actual: { i: pedazo }
      let sesion = null, total = 0;
      const timer = setInterval(async () => {
        try {
          const codes = await detector.detect(video);
          for (const c of codes) {
            const v = String(c.rawValue || "");
            if (v.indexOf("OCQ|") !== 0) continue;
            const [, ses, iStr, nStr] = v.split("|", 4);
            const pedazo = v.split("|").slice(4).join("|");
            if (sesion && ses !== sesion) continue; // no mezclar sesiones distintas
            sesion = sesion || ses;
            total = Number(nStr) || 0;
            frags[Number(iStr)] = pedazo;
            const tengo = Object.keys(frags).length;
            $("oc-qr-progreso").textContent = `Read ${tengo} of ${total}...`;
            if (total > 0 && tengo >= total) {
              detenerEscaneo();
              let texto = "";
              for (let i = 1; i <= total; i++) texto += frags[i];
              const r = await OCSync.importarPaqueteManual(texto);
              msg("oc-syncdev-msg", r.ok ? `Imported via QR: ${r.recibido || 0} change(s) applied.` : r.motivo, r.ok ? "var(--verde)" : "var(--rojo)");
              return;
            }
          }
        } catch (_) { /* frame sin QR legible: seguir intentando */ }
      }, 300);
      escaneoActivo = { stream, timer };
      $("oc-qr-cerrar").addEventListener("click", detenerEscaneo);
    }

    const btnQRMostrar = $("oc-syncdev-qr-mostrar");
    if (btnQRMostrar) btnQRMostrar.addEventListener("click", mostrarQRCambios);
    const btnQREscanear = $("oc-syncdev-qr-escanear");
    if (btnQREscanear) btnQREscanear.addEventListener("click", escanearQRCambios);
  }

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
  function fmtVentas(n) { return "$" + Number(n || 0).toFixed(2); }

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
      '<button type="button" id="oc-rot-ok" style="width:100%;min-height:48px;padding:13px;border:none;border-radius:12px;background:#E86040;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-weight:800;font-size:16px;cursor:pointer;">Yes, change the code</button>' +
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
        msg.innerHTML = "New code. Share it with your team one to one:<br><code style=\'font-family:monospace;font-size:17px;letter-spacing:.08em;\'>" +
          String(nuevo).replace(/[&<>]/g, "") + "</code>";
        btn.style.display = "none";
      } catch (e) {
        btn.disabled = false;
        msg.style.color = "#B0183E";
        msg.textContent = (e && e.message) || "No se pudo cambiar el codigo.";
      }
    });
  }

})();
