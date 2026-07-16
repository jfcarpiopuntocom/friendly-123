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
  const money = (n) => "$" + Number(n || 0).toFixed(2);
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
    let syncOn = localStorage.getItem("oc_sync_on") === "1";

    function deviceId() {
      let id = localStorage.getItem("oc_device_id");
      if (!id) { id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); localStorage.setItem("oc_device_id", id); }
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
      if (blob) localStorage.setItem("oc_sync_pending", blob);
    }
    async function restaurarCola() {
      if (!window.OCSecure.syncActiva()) return;
      const blob = localStorage.getItem("oc_sync_pending");
      if (!blob) return;
      const texto = await window.OCSecure.descifrarSync(blob);
      if (texto) { try { cola = JSON.parse(texto) || []; } catch { cola = []; } }
    }

    // Ledger de op.id ya aplicados (no solo "último ts por dispositivo"):
    // dos operaciones con timestamps iguales o paquetes parciales/reenviados
    // ya no se saltan ni se duplican, porque el ledger es por id exacto.
    function idsAplicados() {
      try { return new Set(JSON.parse(localStorage.getItem("oc_sync_ids_aplicados") || "[]")); } catch { return new Set(); }
    }
    function guardarIdsAplicados(set) {
      localStorage.setItem("oc_sync_ids_aplicados", JSON.stringify(Array.from(set).slice(-3000)));
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
      localStorage.setItem("oc_sync_on", "1");
      await restaurarCola();
      arrancarIntervalo();
      return true;
    }
    function desactivar() {
      syncOn = false;
      localStorage.removeItem("oc_sync_on");
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
      <button id="oc-descargar-csv" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">📄 Download accounting report (.csv)</button>
    `;
    cont.appendChild(descargaBox);

    // --- Respaldo exportable/importable (tronco 3, JFC 2026-07-01) ---
    // Vive DENTRO de "cont" (detrás de la subclave contable): exportar/
    // importar el negocio completo es una acción sensible, no debe estar al
    // alcance de un empleado ni de cualquiera que abra Avanzado.
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
      <h4 style="margin:0 0 6px;font-size:14px;">🔐 Local safe (automatic)</h4>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">
        In addition to the manual backup above, friendly-123 saves a snapshot of your data here (in this browser) periodically,
        in case you delete something by accident. This does NOT replace the manual backup — if the browser cache is cleared, these checkpoints are lost too.
        <em>Coming soon: automatic replication of these checkpoints across your devices. In the meantime, you can copy your data to another device via Advanced → QR Sync.</em></p>
      <p id="oc-caja-alerta" style="font-size:13px;font-weight:700;"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="oc-caja-guardar" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">📸 Save checkpoint now</button>
        <button id="oc-caja-ver" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">🗂️ View saved checkpoints</button>
      </div>
      <div id="oc-caja-lista" style="display:none;margin-top:10px;"></div>
    `;
    cont.appendChild(respaldo);

    // --- Candado ---
    const lock = document.createElement("div");
    lock.id = "oc-acct-lock";
    lock.className = "tag-card";
    lock.innerHTML = `<button id="oc-acct-open">🔒 View accounting layer</button>`;
    // Boton al inicio, justo bajo el blurb de "Modo avanzado" (JFC 2026-07-04:
    // "no moviste el boton mismo de 'ver capa contable' al inicio, animal").
    const aviso = vista.querySelector(".avanzado-aviso");
    if (aviso) aviso.insertAdjacentElement("afterend", lock);
    else vista.appendChild(lock);
    vista.appendChild(cont);

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

    // === EMPLEADOS (multi-usuario 2026-07-07) ==============================
    // Panel de gestion de empleados nombrados. Solo el dueno llega a Avanzado.
    // Cada empleado tiene un PIN propio de 3 digitos. Al loguearse, sus acciones
    // quedan registradas en movimientos con su nombre (via window.OCCurrentUser).
    // Limite: 49 empleados. El dueno NO aparece en esta lista.
    const empPanel = document.createElement("div");
    empPanel.className = "tag-card";
    empPanel.id = "oc-emp-panel";
    empPanel.style.cssText = "text-align:left;margin-top:22px;";
    empPanel.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Employees</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Each employee has their own 3-digit PIN. Their sales, adjustments, and movements
        are recorded with their name in the history log. The owner PIN does not appear here.
      </p>
      <div id="oc-emp-lista" style="margin-bottom:18px;"></div>
      <details id="oc-emp-form-wrap" style="margin-bottom:6px;">
        <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--azul-medio);margin-bottom:10px;">
          + Add employee
        </summary>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:320px;margin-top:10px;">
          <label style="font-size:13px;">Name
            <input id="oc-emp-nombre" maxlength="60" placeholder="Ej: Maria Auquilla"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;box-sizing:border-box;">
          </label>
          <label style="font-size:13px;">PIN (3 digits)<!-- Microcirugia 7 (2026-07-08): warning de colisión. El mock no puede verificar contra el PIN del dueño/contador (esos hashes viven en crypto-store). Si colisionan, el empleado queda bloqueado silenciosamente. -->
            <span style="display:block;font-size:12px;color:var(--rojo,#a3392a);margin-top:3px;font-weight:400;">
              Do not use the same PIN as the owner, general employee, or accountant. If it matches any of those, this employee cannot log in.
            </span>
            <input id="oc-emp-pin" maxlength="3" inputmode="numeric" placeholder="•••"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;text-align:center;font-family:var(--font-mono);
                     box-sizing:border-box;letter-spacing:.2em;">
          </label>
          <button id="oc-emp-agregar" class="ir"
            style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">
            Create employee
          </button>
          <p id="oc-emp-msg" style="font-size:14px;margin:0;font-weight:700;"></p>
        </div>
      </details>`;
    vista.appendChild(empPanel);

    // Renderiza la tabla de empleados (llama al endpoint cada vez que hay cambio)
    async function renderEmpleados() {
      const lista = document.getElementById("oc-emp-lista");
      if (!lista) return;
      let empleados = [];
      try {
        const r = await fetch("/api/usuarios");
        if (r.ok) empleados = await r.json();
      } catch (_) {}

      if (!empleados.length) {
        lista.innerHTML = '<p style="font-size:14px;color:var(--ink-soft);margin:0;">No employees registered yet.</p>';
        return;
      }

      // Tabla simple: nombre, PIN (oculto salvo hover), estado, acciones
      lista.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="border-bottom:2px solid var(--azul-suave,#dde5ec);">
            <th style="text-align:left;padding:6px 8px;font-weight:700;">Name</th>
            <th style="text-align:center;padding:6px 8px;font-weight:700;">Status</th>
            <th style="text-align:right;padding:6px 8px;font-weight:700;">Actions</th>
          </tr></thead>
          <tbody id="oc-emp-tbody"></tbody>
        </table>`;
      const tbody = document.getElementById("oc-emp-tbody");
      empleados.forEach((u) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--azul-suave,#dde5ec)";
        const estadoColor = u.activo ? "var(--sim-verde-dk,#1a6e3c)" : "var(--rojo,#a3392a)";
        const estadoTxt   = u.activo ? "Active" : "Inactive";
        const btnLabel    = u.activo ? "Deactivate" : "Activate";
        const btnColor    = u.activo ? "var(--rojo,#a3392a)" : "var(--sim-verde-dk,#1a6e3c)";
        tr.innerHTML = `
          <td style="padding:8px;">${escHtml(u.nombre)}</td>
          <td style="padding:8px;text-align:center;color:${estadoColor};font-weight:700;">${estadoTxt}</td>
          <td style="padding:8px;text-align:right;">
            <button data-id="${escHtml(u.id)}" data-activo="${u.activo}"
              style="font-size:12px;padding:5px 10px;border:2px solid ${btnColor};
                     border-radius:5px;background:transparent;color:${btnColor};cursor:pointer;">
              ${btnLabel}
            </button>
          </td>`;
        tbody.appendChild(tr);
      });

      // Bind toggle-active buttons
      tbody.querySelectorAll("button[data-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id     = btn.dataset.id;
          const activo = btn.dataset.activo === "true";
          try {
            const r = await fetch("/api/usuarios/" + id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ activo: !activo }),
            });
            if (!r.ok) { const e = await r.json(); alert(e.error || "Error updating employee."); return; }
            await renderEmpleados(); // refrescar lista
          } catch (_) { alert("Network error updating employee."); }
        });
      });
    }

    // Bind form: crear empleado
    document.getElementById("oc-emp-agregar").addEventListener("click", async () => {
      const nombre = (document.getElementById("oc-emp-nombre").value || "").trim();
      const pin    = (document.getElementById("oc-emp-pin").value    || "").trim();
      const msgEl  = document.getElementById("oc-emp-msg");
      msgEl.style.color = "var(--rojo,#a3392a)";
      if (!nombre) { msgEl.textContent = "Enter employee name."; return; }
      if (!/^\d{3}$/.test(pin)) { msgEl.textContent = "PIN must be exactly 3 numeric digits."; return; }
      try {
        const r = await fetch("/api/usuarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, pin }),
        });
        const data = await r.json();
        if (!r.ok) { msgEl.textContent = data.error || "Error creating employee."; return; }
        msgEl.style.color = "var(--sim-verde-dk,#1a6e3c)";
        msgEl.textContent = `Employee "${data.nombre}" created. PIN set.`;
        document.getElementById("oc-emp-nombre").value = "";
        document.getElementById("oc-emp-pin").value    = "";
        document.getElementById("oc-emp-form-wrap").open = false;
        await renderEmpleados();
      } catch (_) { msgEl.textContent = "Network error creating employee."; }
    });

    // Cargar empleados al montar Avanzado
    renderEmpleados();
    // Tambien refrescar cuando el usuario vuelve a la vista (por si otro dispositivo agrego empleados)
    window.addEventListener("oc-login", renderEmpleados);
    // === FIN EMPLEADOS =====================================================

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
              cont.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:#fdecea;border:2px solid #a3392a;"><strong style="color:#a3392a;">⚠ History has been altered</strong> <span style="color:#0F1923;font-size:14px;">— ${det}.</span></div>`;
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
    const pbUrlActual = localStorage.getItem("OC_PB_URL") || "";
    const conectado = !!(window.OC_PB_CONNECTED);
    syncPanel.innerHTML = `
      <h3 class="seccion" style="margin-top:0;">Remote sync (optional)</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        By default this system runs 100% locally, without depending on the internet.
        Only if you want to receive updates from the central panel, paste
        your PocketBase URL on Fly.io here.
      </p>
      <p style="font-size:14px;font-weight:700;margin:8px 0;color:${conectado ? "var(--sim-verde-dk)" : "var(--ink)"};">
        Estado: ${conectado ? "🟢 Connected" : "⚪ Local (no sync)"}
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
      localStorage.setItem("OC_PB_URL", url);
      msg("oc-pb-msg", "Saved. Reloading to connect...", "var(--sim-verde-dk)");
      setTimeout(() => window.location.reload(), 800);
    });
    const btnQuitar = document.getElementById("oc-pb-quitar");
    if (btnQuitar) btnQuitar.addEventListener("click", () => {
      localStorage.removeItem("OC_PB_URL");
      msg("oc-pb-msg", "Sync removed. Reloading in local mode...", "var(--ink)");
      setTimeout(() => window.location.reload(), 800);
    });

    // --- Sync entre dispositivos (lazy sync cifrado, JFC 2026-07-04) ---
    // Distinto del panel de arriba: aquel es para recibir actualizaciones
    // desde EL PANEL CENTRAL de JFC (PocketBase); este es para que DOS
    // DISPOSITIVOS DEL MISMO NEGOCIO (ej. caja + bodega) se pongan al día
    // entre ellos, cifrado de punta a punta con el PIN del dueño.
    const syncDevPanel = document.createElement("div");
    syncDevPanel.id = "oc-syncdev-panel";
    syncDevPanel.className = "tag-card";
    syncDevPanel.style.cssText = "text-align:left;margin-top:22px;";
    vista.appendChild(syncDevPanel);
    pintarSyncDev();

    window.OCAuth.listo().then(() => { pintarEmail(); });

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
        const fotosPerchas = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("vp_foto_percha_") === 0) fotosPerchas[k] = localStorage.getItem(k);
        }
        const paquete = { schemaVersion: 2, fecha: new Date().toISOString(), datos, oc_secure: localStorage.getItem("oc_secure"), fotosPerchas };
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
        const blob = new Blob([archivoFinal], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `respaldo-amigable-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        localStorage.setItem("oc_ultimo_export_manual", String(Date.now()));
        msg("oc-respaldo-msg", "Backup downloaded" + (clave ? " and encrypted" : "") + ". Save it somewhere safe.", "var(--verde)");
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
        if ((paquete.schemaVersion || 1) > 3) { msg("oc-respaldo-msg", "This backup is from a newer version of friendly-123 — update the app before importing it.", "var(--rojo)"); return; }
        if (!confirm("This REPLACES all current data (products, sales, keys) with the backup data. Continue?")) return;
        const res = await fetch(`${API}/respaldo/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquete.datos) });
        const r = await res.json();
        if (!res.ok) { msg("oc-respaldo-msg", r.error, "var(--rojo)"); return; }
        if (paquete.oc_secure) localStorage.setItem("oc_secure", paquete.oc_secure);
        if (paquete.fotosPerchas) Object.entries(paquete.fotosPerchas).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} });
        window.dispatchEvent(new CustomEvent("oc-datos-importados")); // index re-sincroniza la UI solo
        msg("oc-respaldo-msg", "Backup imported. Screen now shows restored data.", "var(--verde)");
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
      try { return JSON.parse(localStorage.getItem("oc_caja_snapshots") || "[]"); } catch { return []; }
    }
    function cajaGuardar(lista) {
      try { localStorage.setItem("oc_caja_snapshots", JSON.stringify(lista.slice(-CAJA_MAX_SNAPSHOTS))); return true; }
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
      const ultimo = Number(localStorage.getItem("oc_ultimo_export_manual") || 0);
      const el = $("oc-caja-alerta");
      if (!el) return;
      if (!ultimo) { el.textContent = "⚠️ You have not made a manual backup yet (the one above) — do it at least once."; el.style.color = "var(--rust)"; return; }
      const dias = Math.floor((Date.now() - ultimo) / 86400000);
      if (dias >= CAJA_ALERTA_DIAS) { el.textContent = `⚠️ Your last manual backup is ${dias} days old — consider making a new one.`; el.style.color = "var(--rust)"; }
      else { el.textContent = `✅ Last manual backup: ${dias} day(s) ago.`; el.style.color = "var(--verde)"; }
    }
    cajaPintarAlerta();
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
    const lista = await (await fetch(`${API}/transferencias`)).json();
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
          <div style="font-size:12px;color:var(--ink-soft);">${escHtml(t.desdeNombre)} → ${escHtml(t.haciaNombre)}</div>
        </div>
        <span class="badge-estado ${colorEstado}">${t.estado.replace("_", " ")}</span>
        ${acciones}
      </div>`;
    }).join("");

    cont.querySelectorAll("[data-transf-aprobar]").forEach((btn) => btn.addEventListener("click", async () => {
      const res = await fetch(`${API}/transferencias/${btn.dataset.transfAprobar}/aprobar`, { method: "POST" });
      const r = await res.json(); if (!res.ok) { alert(r.error); return; }
      renderTransferencias();
    }));
    cont.querySelectorAll("[data-transf-rechazar]").forEach((btn) => btn.addEventListener("click", async () => {
      await fetch(`${API}/transferencias/${btn.dataset.transfRechazar}/rechazar`, { method: "POST" });
      renderTransferencias();
    }));
    cont.querySelectorAll("[data-transf-confirmar]").forEach((btn) => btn.addEventListener("click", async () => {
      const res = await fetch(`${API}/transferencias/${btn.dataset.transfConfirmar}/confirmar-recepcion`, { method: "POST" });
      const r = await res.json(); if (!res.ok) { alert(r.error); return; }
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
        Estado: ${!activo ? "⚪ Disabled" : necesitaPin ? "🟡 Enabled, but needs your PIN again in this browser" : "🟢 Enabled"}
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
          <button id="oc-syncdev-qr-escanear" class="ir" style="background:var(--azul-oscuro);color:var(--blanco-calido);border-color:var(--brass);">📷 Scan QR from other device</button>
          <button id="oc-syncdev-off" style="font-size:13px;padding:8px 12px;border:2px solid var(--rojo);border-radius:5px;background:transparent;color:var(--rojo);cursor:pointer;">Disable</button>
        </div>
        <div id="oc-syncdev-qr-zona" style="display:none;margin:10px 0;text-align:center;"></div>
        <details><summary style="font-size:14px;cursor:pointer;color:var(--azul-medio);">Paste changes received from another device</summary>
          <textarea id="oc-syncdev-pegar" rows="3" placeholder="Paste the text starting with OCSYNC1: here..." style="width:100%;margin-top:8px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);font-size:12px;"></textarea>
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
      if (!texto) { msg("oc-syncdev-msg", "No hay cambios pendientes en este dispositivo.", "var(--ink)"); return; }
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
        const fotosPerchas = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("vp_foto_percha_") === 0) fotosPerchas[k] = localStorage.getItem(k); }
        const paquete = { schemaVersion: 2, fecha: new Date().toISOString(), datos, oc_secure: localStorage.getItem("oc_secure"), fotosPerchas };
        const contenidoPlano = JSON.stringify(paquete);
        const checksum = await window.OCSecure.hashTexto(contenidoPlano);
        const clave = prompt("Key to encrypt the backup before sending via WhatsApp (min 8 chars). Leave blank = no encryption (not recommended for WhatsApp):");
        if (clave === null) { msg("oc-syncdev-msg", "Send cancelled.", "var(--ink)"); return; }
        let archivoFinal;
        if (clave && clave.trim()) { const cif = await window.OCSecure.cifrarTextoConClave(contenidoPlano, clave.trim()); archivoFinal = JSON.stringify({ amigableRespaldoCifrado: true, checksum, ...cif }, null, 2); }
        else archivoFinal = JSON.stringify({ ...paquete, checksum }, null, 2);
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
      if (!texto) { msg("oc-syncdev-msg", "No hay cambios pendientes en este dispositivo.", "var(--ink)"); return; }
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
    const [pl, bal] = await Promise.all([
      fetch(`${API}/reportes/pl?ubicacionId=${u}`).then((r) => r.json()),
      fetch(`${API}/reportes/balance?ubicacionId=${u}`).then((r) => r.json()),
    ]);
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
    const filas = await (await fetch(`${API}/liquidaciones`)).json();
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
        <div style="font-size:12px;color:var(--ink-soft);margin-top:3px;">Effective commission paid: ${comisionEfectivaPct.toFixed(1)}% (${money(f.comisionSocio)})</div>
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
          <th style="font-size:11px;color:var(--sim-azul);border-right:1.5px solid var(--sim-azul);border-bottom:1px solid var(--sim-azul);">DEBIT</th>
          <th style="font-size:11px;color:var(--sim-azul);border-bottom:1px solid var(--sim-azul);">CREDIT</th>
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
})();
