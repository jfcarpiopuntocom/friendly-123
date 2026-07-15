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
        if (!res.ok) return { ok: false, motivo: "Tu servidor de sync rechazó el envío." };
        cola = cola.slice(n);
        await guardarColaCifrada();
        return { ok: true, enviado: n };
      } catch (_) { return { ok: false, motivo: "Sin conexión a tu servidor de sync (¿ya agregaste las rutas /api/sync?)." }; }
    }
    async function pull() {
      if (!syncOn || !window.OCSecure.syncActiva()) return { ok: true, recibido: 0 };
      try {
        const res = await fetchOriginal(`${API}/sync/pull?device=${encodeURIComponent(deviceId())}`, { method: "GET" });
        if (!res.ok) return { ok: false, motivo: "Tu servidor de sync rechazó la consulta." };
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
      } catch (_) { return { ok: false, motivo: "Sin conexión a tu servidor de sync." }; }
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
      if (texto.indexOf("OCSYNC1:") !== 0) return { ok: false, motivo: "Ese texto no es un paquete de sincronización válido." };
      if (texto.length > MANUAL_MAX_BYTES) return { ok: false, motivo: "Ese paquete es demasiado grande para ser válido." };
      let paquete;
      try { paquete = JSON.parse(decodeURIComponent(escape(atob(texto.slice(8))))); } catch (_) { return { ok: false, motivo: "El paquete está corrupto o incompleto." }; }
      if (!paquete || paquete.v !== 1 || typeof paquete.blob !== "string" || typeof paquete.device !== "string") return { ok: false, motivo: "El paquete no tiene el formato esperado." };
      if (paquete.device === deviceId()) return { ok: false, motivo: "Ese paquete es de este mismo dispositivo." };
      const texto2 = await window.OCSecure.descifrarSync(paquete.blob);
      if (!texto2) return { ok: false, motivo: "No se pudo descifrar (¿es del mismo negocio, con el mismo PIN de dueño activado aquí?)." };
      let ops = []; try { ops = JSON.parse(texto2); } catch (_) {}
      if (!Array.isArray(ops)) return { ok: false, motivo: "El contenido del paquete no es una lista de operaciones válida." };
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
    chartBox.innerHTML = `<h3 class="seccion" style="margin-top:0;">Comparativo por ubicación (este mes)</h3><div id="oc-chart"></div>`;
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
      <h3 class="seccion" style="margin-top:0;">Reporte para el contador</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">P&amp;G, balance e inventario valorizado en un solo archivo, listo para Excel. No es una declaración ante el SRI — es el insumo para que tu contador la prepare.</p>
      <button id="oc-descargar-csv" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">📄 Descargar reporte contable (.csv)</button>
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
      <h3 class="seccion" style="margin-top:0;">Respaldo</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Descarga TODO tu negocio (productos, ventas, movimientos, gastos, claves y fotos de perchas) en un archivo. Guárdalo en tu correo, tu Drive, donde sea — es tu copia de seguridad si se borra el caché o se daña el dispositivo.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="oc-exportar" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">⬇️ Exportar respaldo</button>
        <label class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);display:inline-flex;align-items:center;cursor:pointer;">⬆️ Importar respaldo
          <input id="oc-importar-file" type="file" accept=".json" style="display:none;">
        </label>
      </div>
      <p id="oc-respaldo-msg" style="font-size:14px;margin-top:10px;font-weight:700;"></p>
      <hr style="border:none;border-top:1px solid var(--azul-suave,#dde5ec);margin:16px 0;">
      <h4 style="margin:0 0 6px;font-size:14px;">🔐 Caja fuerte local (automática)</h4>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:0;">
        Además del respaldo manual de arriba, AMIGABLE guarda solo AQUÍ (en este navegador) una foto de tus datos cada cierto tiempo,
        por si borras algo sin querer. Esto NO reemplaza el respaldo manual — si se borra el caché del navegador, se pierden estos puntos también.
        <em>Fase futura (no implementada todavía): repartir estos puntos entre dispositivos por QR/texto dividido, al estilo 3-2-1, para no depender de un solo navegador.</em></p>
      <p id="oc-caja-alerta" style="font-size:13px;font-weight:700;"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="oc-caja-guardar" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">📸 Guardar punto ahora</button>
        <button id="oc-caja-ver" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">🗂️ Ver puntos guardados</button>
      </div>
      <div id="oc-caja-lista" style="display:none;margin-top:10px;"></div>
    `;
    cont.appendChild(respaldo);

    // --- Candado ---
    const lock = document.createElement("div");
    lock.id = "oc-acct-lock";
    lock.className = "tag-card";
    lock.innerHTML = `<button id="oc-acct-open">🔒 Ver capa contable</button>`;
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
      <h3 class="seccion" style="margin-top:0;">Acceso y recuperación</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">Correo del dueño para recuperar las claves. Una vez guardado se oculta y queda ofuscado.</p>
      <div id="oc-email-row"></div>
      <div id="oc-clave-block" style="margin-top:18px;">
        <p style="font-size:14px;color:var(--ink-soft);">Claves (PIN de 3 dígitos). Por seguridad, los códigos actuales NO se muestran aquí (se guardan cifrados) — escribe los NUEVOS solo si quieres cambiarlos.</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:340px;">
          <label style="font-size:13px;">Dueño <input id="oc-c-owner" maxlength="3" inputmode="numeric" placeholder="•••" style="margin-left:8px;width:90px;text-align:center;font-family:var(--font-mono);padding:8px;border:2px solid var(--azul-medio);border-radius:5px;"></label>
          <label style="font-size:13px;">Empleado <input id="oc-c-emp" maxlength="3" inputmode="numeric" placeholder="•••" style="margin-left:8px;width:90px;text-align:center;font-family:var(--font-mono);padding:8px;border:2px solid var(--azul-medio);border-radius:5px;"></label>
          <label style="font-size:13px;">Contable <input id="oc-c-acct" maxlength="3" inputmode="numeric" placeholder="•••" style="margin-left:8px;width:90px;text-align:center;font-family:var(--font-mono);padding:8px;border:2px solid var(--azul-medio);border-radius:5px;"></label>
        </div>
        <button id="oc-save-codes" class="ir" style="margin-top:12px;background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Guardar nuevas claves</button>
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
      <h3 class="seccion" style="margin-top:0;">Empleados</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Cada empleado tiene su propio PIN de 3 digitos. Sus ventas, ajustes y movimientos
        quedan registrados con su nombre en el historial. El PIN del dueno no aparece aqui.
      </p>
      <div id="oc-emp-lista" style="margin-bottom:18px;"></div>
      <details id="oc-emp-form-wrap" style="margin-bottom:6px;">
        <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--azul-medio);margin-bottom:10px;">
          + Agregar empleado
        </summary>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:320px;margin-top:10px;">
          <label style="font-size:13px;">Nombre
            <input id="oc-emp-nombre" maxlength="60" placeholder="Ej: Maria Auquilla"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;box-sizing:border-box;">
          </label>
          <label style="font-size:13px;">PIN (3 dígitos)<!-- Microcirugia 7 (2026-07-08): warning de colisión. El mock no puede verificar contra el PIN del dueño/contador (esos hashes viven en crypto-store). Si colisionan, el empleado queda bloqueado silenciosamente. -->
            <span style="display:block;font-size:12px;color:var(--rojo,#a3392a);margin-top:3px;font-weight:400;">
              No uses el mismo PIN del dueño, empleado general ni contador. Si coincide con alguno de esos, este empleado no podrá entrar.
            </span>
            <input id="oc-emp-pin" maxlength="3" inputmode="numeric" placeholder="•••"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:2px solid var(--azul-medio);
                     border-radius:5px;font-size:14px;text-align:center;font-family:var(--font-mono);
                     box-sizing:border-box;letter-spacing:.2em;">
          </label>
          <button id="oc-emp-agregar" class="ir"
            style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">
            Crear empleado
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
        lista.innerHTML = '<p style="font-size:14px;color:var(--ink-soft);margin:0;">Todavia no hay empleados registrados.</p>';
        return;
      }

      // Tabla simple: nombre, PIN (oculto salvo hover), estado, acciones
      lista.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="border-bottom:2px solid var(--azul-suave,#dde5ec);">
            <th style="text-align:left;padding:6px 8px;font-weight:700;">Nombre</th>
            <th style="text-align:center;padding:6px 8px;font-weight:700;">Estado</th>
            <th style="text-align:right;padding:6px 8px;font-weight:700;">Acciones</th>
          </tr></thead>
          <tbody id="oc-emp-tbody"></tbody>
        </table>`;
      const tbody = document.getElementById("oc-emp-tbody");
      empleados.forEach((u) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--azul-suave,#dde5ec)";
        const estadoColor = u.activo ? "var(--sim-verde-dk,#1a6e3c)" : "var(--rojo,#a3392a)";
        const estadoTxt   = u.activo ? "Activo" : "Inactivo";
        const btnLabel    = u.activo ? "Desactivar" : "Activar";
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
            if (!r.ok) { const e = await r.json(); alert(e.error || "Error al actualizar empleado."); return; }
            await renderEmpleados(); // refrescar lista
          } catch (_) { alert("Error de red al actualizar empleado."); }
        });
      });
    }

    // Bind form: crear empleado
    document.getElementById("oc-emp-agregar").addEventListener("click", async () => {
      const nombre = (document.getElementById("oc-emp-nombre").value || "").trim();
      const pin    = (document.getElementById("oc-emp-pin").value    || "").trim();
      const msgEl  = document.getElementById("oc-emp-msg");
      msgEl.style.color = "var(--rojo,#a3392a)";
      if (!nombre) { msgEl.textContent = "Escribe el nombre del empleado."; return; }
      if (!/^\d{3}$/.test(pin)) { msgEl.textContent = "El PIN debe ser exactamente 3 digitos numericos."; return; }
      try {
        const r = await fetch("/api/usuarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, pin }),
        });
        const data = await r.json();
        if (!r.ok) { msgEl.textContent = data.error || "Error al crear empleado."; return; }
        msgEl.style.color = "var(--sim-verde-dk,#1a6e3c)";
        msgEl.textContent = `Empleado "${data.nombre}" creado. PIN configurado.`;
        document.getElementById("oc-emp-nombre").value = "";
        document.getElementById("oc-emp-pin").value    = "";
        document.getElementById("oc-emp-form-wrap").open = false;
        await renderEmpleados();
      } catch (_) { msgEl.textContent = "Error de red al crear empleado."; }
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
        <h3 class="seccion" style="margin-top:0;">Control anti fraude</h3>
        <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">Integridad del historial y señales de riesgo del día. Cada movimiento va sellado: si alguien edita o borra el historial en este equipo, aquí se nota.</p>
        <div id="oc-af-integridad" style="margin-bottom:14px;"></div>
        <div id="oc-af-senales"></div>
        <button id="oc-af-refrescar" class="ir" style="margin-top:12px;background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Verificar ahora</button>
        <p style="font-size:13px;color:var(--ink-soft);margin:10px 0 0;">El sello detecta manipulación casual del historial. No es a prueba de expertos (el equipo es local), pero deja evidencia de cualquier edición común.</p>`;
      vista.appendChild(afPanel);

      async function renderAntiFraude() {
        // 1) Integridad del historial
        const cont = $("oc-af-integridad");
        if (cont) {
          try {
            const d = await (await fetch("/api/integridad")).json();
            if (d.ok) {
              cont.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:#e7f7ee;border:2px solid #1a6e3c;"><strong style="color:#1a6e3c;">✓ Historial íntegro</strong> <span style="color:#0F1923;font-size:14px;">— ${d.sellados} movimiento(s) sellado(s)${d.historico ? ", " + d.historico + " histórico(s) sin sello" : ""}.</span></div>`;
            } else {
              const det = d.ruptura
                ? `en la posición ${d.ruptura.index} (${escHtml(d.ruptura.tipo)} · ${escHtml(d.ruptura.usuarioNombre)} · ${escHtml(new Date(d.ruptura.fecha).toLocaleString())}) — ${escHtml(d.ruptura.motivo)}`
                : (d.colaOk === false ? "se recortó el final del historial" : "inconsistencia detectada");
              cont.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:#fdecea;border:2px solid #a3392a;"><strong style="color:#a3392a;">⚠ El historial fue alterado</strong> <span style="color:#0F1923;font-size:14px;">— ${det}.</span></div>`;
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
              if (!ents.length) return `<p style="font-size:14px;color:var(--ink-soft);margin:6px 0;">${titulo}: sin actividad hoy.</p>`;
              return `<p style="font-size:14px;font-weight:700;color:var(--ink);margin:10px 0 2px;">${titulo}:</p>` +
                ents.map(([n, v]) => `<div style="font-size:14px;color:#0F1923;padding:2px 0;">• ${escHtml(n)}: <strong>${v}</strong> ${unidad}</div>`).join("");
            };
            sen.innerHTML =
              bloque("Anulaciones de venta por persona (hoy)", anul, "anulación(es)") +
              bloque("Unidades bajadas a mano / mermas por persona (hoy)", merma, "unidad(es)");
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
      <h3 class="seccion" style="margin-top:0;">Transferencias entre ubicaciones</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">Solicitudes de traspaso de stock entre tus locales.</p>
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
      <h3 class="seccion" style="margin-top:0;">Sincronización remota (opcional)</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Por defecto este negocio corre 100% local, sin depender de internet.
        Solo si quieres recibir actualizaciones desde el panel central, pega
        aquí la URL de tu PocketBase en Fly.io.
      </p>
      <p style="font-size:14px;font-weight:700;margin:8px 0;color:${conectado ? "var(--sim-verde-dk)" : "var(--ink)"};">
        Estado: ${conectado ? "🟢 Conectado" : "⚪ Local (sin sync)"}
      </p>
      <input id="oc-pb-url" type="text" placeholder="https://tu-negocio.fly.dev" value="${escHtml(pbUrlActual)}" style="width:100%;max-width:340px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;">
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
        <button id="oc-pb-guardar" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Guardar y conectar</button>
        ${pbUrlActual ? `<button id="oc-pb-quitar" class="ir" style="background:transparent;color:var(--rojo);border-color:var(--rojo);">Volver a local</button>` : ""}
      </div>
      <p id="oc-pb-msg" style="font-size:14px;margin-top:8px;"></p>`;
    vista.appendChild(syncPanel);

    $("oc-pb-guardar").addEventListener("click", () => {
      const url = $("oc-pb-url").value.trim();
      if (!url) { msg("oc-pb-msg", "Pega la URL de tu PocketBase primero.", "var(--rojo)"); return; }
      localStorage.setItem("OC_PB_URL", url);
      msg("oc-pb-msg", "Guardado. Recargando para conectar...", "var(--sim-verde-dk)");
      setTimeout(() => window.location.reload(), 800);
    });
    const btnQuitar = document.getElementById("oc-pb-quitar");
    if (btnQuitar) btnQuitar.addEventListener("click", () => {
      localStorage.removeItem("OC_PB_URL");
      msg("oc-pb-msg", "Sync quitado. Recargando en modo local...", "var(--ink)");
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
      if (![o, e, a].every(valido)) { msg("oc-codes-msg", "Cada clave debe ser 3 dígitos (0-9).", "var(--rojo)"); return; }
      const correoActual = window.OCSecure.leerCorreo();
      if (!correoActual) { msg("oc-codes-msg", "Antes de cambiar las claves, registra tu correo de recuperación arriba (si olvidas el código nuevo, sin correo no hay forma de recuperarlo).", "var(--rojo)"); return; }
      await window.OCSecure.guardarSecreto(o, [e], a, correoActual);
      $("oc-c-owner").value = ""; $("oc-c-emp").value = ""; $("oc-c-acct").value = "";
      msg("oc-codes-msg", "Claves guardadas y cifradas.", "var(--verde)");
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
        fila("Reporte contable — friendly-123", new Date().toLocaleString(window.OCI18n ? window.OCI18n.locale() : "en-US")),
        fila("AVISO", "Insumo para el contador. No es una declaración válida ante el SRI."),
        fila("", ""),
        fila("PÉRDIDAS Y GANANCIAS (hoy)", ""),
        fila("Ventas cobradas (con IVA)", money(pl.ingresosConIva)),
        fila("IVA cobrado (15%, se liquida al SRI)", money(pl.ivaCobrado)),
        fila("Ingresos netos (sin IVA)", money(pl.ingresos)),
        fila("Costo de ventas", money(pl.costoVentas)),
        fila("Utilidad bruta", money(pl.utilidadBruta)),
        fila("Gastos operativos", money(pl.gastosOperativos)),
        fila("Utilidad neta", money(pl.utilidadNeta)),
        fila("", ""),
        fila("BALANCE SIMPLIFICADO", ""),
        fila("Ingresos del día estimados", money(bal.activos.efectivoEstimado)),
        fila("Inventario valorizado", money(bal.activos.inventarioValorizado)),
        fila("Total activos", money(bal.activos.total)),
        fila("", ""),
        fila("INVENTARIO VALORIZADO POR PRODUCTO", ""),
        fila("Producto", "Stock,Costo,Venta,Utilidad potencial"),
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
    $("oc-exportar").addEventListener("click", async () => {
      try {
        const datos = await (await fetch(`${API}/respaldo/exportar`)).json();
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
        const clave = prompt("Clave para proteger este respaldo (mínimo 8 caracteres). Déjalo en blanco para exportar sin cifrar:");
        // FIX 2026-07-07: "Cancelar" devolvia null y caia al camino sin cifrar —
        // exportaba un archivo CON oc_secure adentro sin que el dueno lo pidiera.
        // Cancelar ahora cancela de verdad.
        if (clave === null) {
          if (window.dialogosBloqueados && window.dialogosBloqueados()) { msg("oc-respaldo-msg", "Tu navegador bloquea los diálogos (pasa en el navegador de WhatsApp). Abre friendly-123 en Chrome o Safari para exportar con clave.", "var(--rojo)"); return; }
          msg("oc-respaldo-msg", "Exportación cancelada.", "var(--ink)");
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
        msg("oc-respaldo-msg", "Respaldo descargado" + (clave ? " y cifrado" : "") + ". Guárdalo en un lugar seguro.", "var(--verde)");
      } catch (e) { msg("oc-respaldo-msg", "No se pudo exportar: " + e.message, "var(--rojo)"); }
    });

    $("oc-importar-file").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        let paquete = JSON.parse(await file.text());
        if (paquete.amigableRespaldoCifrado) {
          const clave = prompt("Este respaldo está cifrado. Ingresa la clave con la que se exportó:");
          if (!clave) { e.target.value = ""; return; }
          const texto = await window.OCSecure.descifrarTextoConClave(paquete, clave.trim());
          if (!texto) { msg("oc-respaldo-msg", "Clave incorrecta o archivo dañado.", "var(--rojo)"); e.target.value = ""; return; }
          const checksumOk = paquete.checksum ? (await window.OCSecure.hashTexto(texto)) === paquete.checksum : true;
          if (!checksumOk) { msg("oc-respaldo-msg", "El contenido no coincide con su checksum — el archivo pudo dañarse.", "var(--rojo)"); e.target.value = ""; return; }
          paquete = JSON.parse(texto);
        } else if (paquete.checksum) {
          const { checksum, ...resto } = paquete;
          const ok = (await window.OCSecure.hashTexto(JSON.stringify(resto))) === checksum;
          if (!ok) { msg("oc-respaldo-msg", "El contenido no coincide con su checksum — el archivo pudo dañarse.", "var(--rojo)"); e.target.value = ""; return; }
        }
        if (!paquete.datos) { msg("oc-respaldo-msg", "Ese archivo no parece un respaldo de AMIGABLE.", "var(--rojo)"); return; }
        if ((paquete.schemaVersion || 1) > 3) { msg("oc-respaldo-msg", "Este respaldo es de una versión más nueva de AMIGABLE que esta pantalla — actualiza la app antes de importarlo.", "var(--rojo)"); return; }
        if (!confirm("Esto REEMPLAZA todos los datos actuales (productos, ventas, claves) con los del respaldo. ¿Continuar?")) return;
        const res = await fetch(`${API}/respaldo/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquete.datos) });
        const r = await res.json();
        if (!res.ok) { msg("oc-respaldo-msg", r.error, "var(--rojo)"); return; }
        if (paquete.oc_secure) localStorage.setItem("oc_secure", paquete.oc_secure);
        if (paquete.fotosPerchas) Object.entries(paquete.fotosPerchas).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} });
        window.dispatchEvent(new CustomEvent("oc-datos-importados")); // index re-sincroniza la UI solo
        msg("oc-respaldo-msg", "Respaldo importado. La pantalla ya muestra los datos restaurados.", "var(--verde)");
      } catch (err) { msg("oc-respaldo-msg", "No se pudo importar: " + err.message, "var(--rojo)"); }
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
          msg("oc-respaldo-msg", guardado ? "Punto de restauración guardado en este navegador." : "No se pudo guardar (¿localStorage lleno? intenta exportar un respaldo manual y libera espacio).", guardado ? "var(--verde)" : "var(--rojo)");
        }
      } catch (_) { if (!silencioso) msg("oc-respaldo-msg", "No se pudo tomar el punto de restauración.", "var(--rojo)"); }
    }
    async function cajaRestaurar(idx) {
      const lista = cajaLeer();
      const punto = lista[idx];
      if (!punto) return;
      const okChecksum = (await window.OCSecure.hashTexto(punto.contenido)) === punto.checksum;
      if (!okChecksum) { msg("oc-respaldo-msg", "Este punto no pasó la verificación de checksum — puede estar corrupto. No se restauró nada.", "var(--rojo)"); return; }
      if (!confirm(`Esto REEMPLAZA los datos actuales con el punto del ${new Date(punto.fecha).toLocaleString()}. ¿Continuar?`)) return;
      let paquete; try { paquete = JSON.parse(punto.contenido); } catch { msg("oc-respaldo-msg", "El punto está corrupto.", "var(--rojo)"); return; }
      const res = await fetch(`${API}/respaldo/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquete.datos) });
      if (!res.ok) { const r = await res.json(); msg("oc-respaldo-msg", r.error || "No se pudo restaurar.", "var(--rojo)"); return; }
      window.dispatchEvent(new CustomEvent("oc-datos-importados"));
      msg("oc-respaldo-msg", "Restaurado. La pantalla ya muestra los datos del punto elegido.", "var(--verde)");
    }
    function cajaPintarAlerta() {
      const ultimo = Number(localStorage.getItem("oc_ultimo_export_manual") || 0);
      const el = $("oc-caja-alerta");
      if (!el) return;
      if (!ultimo) { el.textContent = "⚠️ Todavía no has hecho ningún respaldo manual (el de arriba) — hazlo al menos una vez."; el.style.color = "var(--rust)"; return; }
      const dias = Math.floor((Date.now() - ultimo) / 86400000);
      if (dias >= CAJA_ALERTA_DIAS) { el.textContent = `⚠️ Tu último respaldo manual tiene ${dias} días — considera hacer uno nuevo.`; el.style.color = "var(--rust)"; }
      else { el.textContent = `✅ Último respaldo manual: hace ${dias} día(s).`; el.style.color = "var(--verde)"; }
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
              <button data-caja-restaurar="${idxReal}" style="font-size:13px;padding:6px 10px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Restaurar</button>
            </div>`;
          }).join("")
        : `<p style="font-size:13px;color:var(--ink-soft);">Todavía no hay puntos guardados.</p>`;
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
    if (!lista.length) { cont.innerHTML = `<p style="font-size:14px;color:var(--ink-soft);">No hay transferencias todavía.</p>`; return; }
    cont.innerHTML = lista.map((t) => {
      const colorEstado = t.estado === "recibida" ? "verde" : t.estado === "rechazada" ? "rojo" : t.estado === "en_transito" ? "azul" : "amarillo";
      let acciones = "";
      if (t.estado === "solicitada") {
        acciones = `<button data-transf-aprobar="${t.id}" style="font-size:13px;padding:6px 10px;border:2px solid var(--verde);border-radius:5px;background:transparent;color:var(--verde);cursor:pointer;">Aprobar</button>
          <button data-transf-rechazar="${t.id}" style="font-size:13px;padding:6px 10px;border:2px solid var(--rojo);border-radius:5px;background:transparent;color:var(--rojo);cursor:pointer;">Rechazar</button>`;
      } else if (t.estado === "en_transito") {
        acciones = `<button data-transf-confirmar="${t.id}" style="font-size:13px;padding:6px 10px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Confirmar recepción</button>`;
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
        <button id="oc-email-edit" style="font-size:13px;padding:8px 12px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Cambiar (requiere código maestro)</button></div>`;
      $("oc-email-edit").addEventListener("click", pedirMaestroYCambiarCorreo);
    } else {
      row.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="oc-email-in" type="email" placeholder="correo@dominio.com" style="flex:1;min-width:200px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);">
        <button id="oc-email-save" class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);">Guardar</button></div>
        <p id="oc-email-msg" style="font-size:14px;margin-top:8px;"></p>`;
      $("oc-email-save").addEventListener("click", () => {
        if (window.OCAuth.esDemo && window.OCAuth.esDemo()) return; // demo: sin cambio de correo
        const v = $("oc-email-in").value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { msg("oc-email-msg", "Correo no válido.", "var(--rojo)"); return; }
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
      <h2 style="font-family:var(--font-display);color:var(--ink);font-size:20px;margin:0 0 4px;">Código maestro</h2>
      <p style="font-size:14px;color:var(--ink-soft);margin-bottom:14px;">Solo JFC lo tiene. Identifica al dueño en persona o videollamada antes de dárselo.</p>
      <input id="mst-codigo" type="text" style="width:100%;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);text-align:center;">
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="mst-cancelar" style="flex:1;padding:10px;border-radius:6px;border:2px solid var(--azul-medio);background:transparent;color:var(--azul-medio);cursor:pointer;">Cancelar</button>
        <button id="mst-ok" class="ir" style="flex:1;">Verificar</button>
      </div>
      <p id="mst-msg" style="font-size:14px;margin-top:10px;font-weight:700;color:var(--rojo);"></p>
    </div>`;
    document.body.appendChild(cont);
    cont.querySelector("#mst-cancelar").addEventListener("click", () => cont.remove());
    cont.querySelector("#mst-ok").addEventListener("click", async () => {
      const codigo = cont.querySelector("#mst-codigo").value.trim();
      const ok = await window.OCSecure.verificarMaestro(codigo);
      if (!ok) { cont.querySelector("#mst-msg").textContent = "Código maestro incorrecto."; return; }
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
      <h3 class="seccion" style="margin-top:0;">Sincronización entre dispositivos</h3>
      <p style="font-size:14px;color:var(--ink-soft);margin-top:0;">
        Para cuando el mismo negocio corre en más de un celular/tablet (ej. caja y bodega).
        Cada dispositivo cifra sus propios cambios con tu PIN de dueño — ni siquiera el
        servidor de sincronización puede leerlos.
      </p>
      <p style="font-size:14px;font-weight:700;margin:8px 0;color:${activo && !necesitaPin ? "var(--sim-verde-dk)" : "var(--ink)"};">
        Estado: ${!activo ? "⚪ Desactivada" : necesitaPin ? "🟡 Activada, pero pide tu PIN de nuevo en este navegador" : "🟢 Activada"}
        ${activo && !necesitaPin && pend ? ` · ${pend} cambio(s) sin enviar` : ""}
      </p>
      <p id="oc-syncdev-msg" style="font-size:14px;font-weight:700;margin-bottom:10px;"></p>
      ${(!activo || necesitaPin) ? `
        <button id="oc-syncdev-activar" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">${necesitaPin ? "Ingresar PIN para reactivar" : "Activar en este dispositivo (pide tu PIN)"}</button>
      ` : `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <button id="oc-syncdev-push" class="ir" style="background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">🔄 Sync automático (Fly.io)</button>
          <button id="oc-syncdev-copiar" class="ir" style="background:var(--rust);color:var(--blanco-calido);border-color:var(--rust-deep);">📋 Copiar cambios para enviar</button>
          <button id="oc-syncdev-wa-cambios" class="ir" style="background:#25D366;color:#0a3d20;border-color:#1da851;">📲 Cambios recientes → WhatsApp</button>
          <button id="oc-syncdev-wa-respaldo" class="ir" style="background:#128C7E;color:#e8fff7;border-color:#0c6b60;">📲 Respaldo completo → WhatsApp</button>
          <button id="oc-syncdev-qr-mostrar" class="ir" style="background:var(--azul-oscuro);color:var(--blanco-calido);border-color:var(--brass);">📱 Mostrar QR de cambios</button>
          <button id="oc-syncdev-qr-escanear" class="ir" style="background:var(--azul-oscuro);color:var(--blanco-calido);border-color:var(--brass);">📷 Escanear QR del otro equipo</button>
          <button id="oc-syncdev-off" style="font-size:13px;padding:8px 12px;border:2px solid var(--rojo);border-radius:5px;background:transparent;color:var(--rojo);cursor:pointer;">Desactivar</button>
        </div>
        <div id="oc-syncdev-qr-zona" style="display:none;margin:10px 0;text-align:center;"></div>
        <details><summary style="font-size:14px;cursor:pointer;color:var(--azul-medio);">Pegar cambios recibidos de otro dispositivo</summary>
          <textarea id="oc-syncdev-pegar" rows="3" placeholder="Pega aquí el texto que empieza con OCSYNC1:..." style="width:100%;margin-top:8px;padding:8px;border:2px solid var(--azul-medio);border-radius:5px;font-family:var(--font-mono);font-size:12px;"></textarea>
          <button id="oc-syncdev-importar" class="ir" style="margin-top:8px;background:var(--azul-medio);color:var(--blanco-calido);border-color:var(--azul-oscuro);">Importar</button>
        </details>
      `}`;

    const btnActivar = $("oc-syncdev-activar");
    if (btnActivar) btnActivar.addEventListener("click", async () => {
      const pin = prompt("PIN del dueño (3 dígitos) para activar sincronización en este dispositivo:");
      if (pin === null) return;
      const ok = await OCSync.activar(pin.trim());
      msg("oc-syncdev-msg", ok ? "Sincronización activada en este dispositivo." : "PIN incorrecto.", ok ? "var(--verde)" : "var(--rojo)");
      pintarSyncDev();
    });
    const btnPush = $("oc-syncdev-push");
    if (btnPush) btnPush.addEventListener("click", async () => {
      msg("oc-syncdev-msg", "Enviando y recibiendo...", "var(--ink)");
      const rPush = await OCSync.push();
      const rPull = await OCSync.pull();
      if (rPush.ok && rPull.ok) msg("oc-syncdev-msg", `Listo. Enviados: ${rPush.enviado || 0} · Recibidos: ${rPull.recibido || 0}.`, "var(--verde)");
      else msg("oc-syncdev-msg", (rPush.motivo || rPull.motivo) + " Mientras tanto, usa \"Copiar cambios\".", "var(--rojo)");
      pintarSyncDev();
    });
    const btnCopiar = $("oc-syncdev-copiar");
    if (btnCopiar) btnCopiar.addEventListener("click", async () => {
      const texto = await OCSync.generarPaqueteManual();
      if (!texto) { msg("oc-syncdev-msg", "No hay cambios pendientes en este dispositivo.", "var(--ink)"); return; }
      try { await navigator.clipboard.writeText(texto); msg("oc-syncdev-msg", "Copiado. Envíalo por WhatsApp u otro medio al otro dispositivo.", "var(--verde)"); }
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
      const mensaje = "friendly-123 — cambios para sincronizar. Pega esto en el otro equipo (Avanzado → Pegar cambios):\n\n" + texto;
      if (navigator.share) {
        try { await navigator.share({ text: mensaje }); msg("oc-syncdev-msg", "Compartido. En el otro equipo: Avanzado → Pegar cambios.", "var(--verde)"); return; } catch (_) {}
      }
      if (mensaje.length < 1500) { window.open("https://wa.me/?text=" + encodeURIComponent(mensaje), "_blank"); msg("oc-syncdev-msg", "Abrí WhatsApp con los cambios listos para enviar.", "var(--verde)"); return; }
      try { await navigator.clipboard.writeText(texto); msg("oc-syncdev-msg", "Son muchos cambios para un enlace directo. Los copié — pégalos tú en WhatsApp.", "var(--verde)"); }
      catch (_) { prompt("Copia este texto y envíalo por WhatsApp:", texto); }
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
        const clave = prompt("Clave para cifrar el respaldo antes de mandarlo por WhatsApp (mínimo 8). En blanco = sin cifrar (no recomendado para WhatsApp):");
        if (clave === null) { msg("oc-syncdev-msg", "Envío cancelado.", "var(--ink)"); return; }
        let archivoFinal;
        if (clave && clave.trim()) { const cif = await window.OCSecure.cifrarTextoConClave(contenidoPlano, clave.trim()); archivoFinal = JSON.stringify({ amigableRespaldoCifrado: true, checksum, ...cif }, null, 2); }
        else archivoFinal = JSON.stringify({ ...paquete, checksum }, null, 2);
        const nombre = `respaldo-amigable-${new Date().toISOString().slice(0, 10)}.json`;
        const file = new File([archivoFinal], nombre, { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "Respaldo friendly-123", text: "Respaldo de mi negocio (friendly-123)." });
          msg("oc-syncdev-msg", "Respaldo compartido. En el otro equipo: Avanzado → Importar respaldo.", "var(--verde)");
        } else {
          const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
          msg("oc-syncdev-msg", "Tu navegador no comparte archivos directo. Lo descargué — adjúntalo tú en WhatsApp.", "var(--ink)");
        }
      } catch (e) { msg("oc-syncdev-msg", "No se pudo preparar el respaldo: " + e.message, "var(--rojo)"); }
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
      if (!confirm("¿Desactivar sincronización en este dispositivo?")) return;
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
      if (!qrLib()) { msg("oc-syncdev-msg", "El generador QR local no cargó (qrcode-local.js).", "var(--rojo)"); return; }
      const texto = await OCSync.generarPaqueteManual();
      if (!texto) { msg("oc-syncdev-msg", "No hay cambios pendientes en este dispositivo.", "var(--ink)"); return; }
      const sesion = Math.random().toString(36).slice(2, 6);
      const total = Math.ceil(texto.length / QR_CHUNK);
      // FIX preventivo 2026-07-07: con una cola enorme (semanas sin sincronizar)
      // esto generaria decenas de QRs y congelaria la pestana. Tope duro y
      // camino claro: para paquetes grandes, Copiar/Pegar es el canal correcto.
      if (total > 12) { msg("oc-syncdev-msg", `Son demasiados cambios para QR (${total} códigos). Usa "Copiar cambios" y pégalo en el otro equipo — misma seguridad.`, "var(--rojo)"); return; }
      let html = `<p style="font-size:14px;font-weight:700;color:var(--ink);">Escanea ${total > 1 ? "los " + total + " códigos, en cualquier orden," : "este código"} desde el otro equipo (Avanzado → Escanear QR):</p>`;
      for (let i = 0; i < total; i++) {
        const frag = "OCQ|" + sesion + "|" + (i + 1) + "|" + total + "|" + texto.slice(i * QR_CHUNK, (i + 1) * QR_CHUNK);
        const q = qrLib()(0, "M");
        q.addData(frag);
        q.make();
        html += `<div style="display:inline-block;background:#FFFFFF;padding:10px;border:2px solid var(--sim-plata,#C4CDD8);border-radius:8px;margin:6px;"><img src="${q.createDataURL(4, 8)}" alt="QR ${i + 1} de ${total}" style="display:block;max-width:240px;width:100%;image-rendering:pixelated;"><span style="font-family:var(--font-mono);font-size:13px;color:#0F1923;">${i + 1} / ${total}</span></div>`;
      }
      zona.innerHTML = html;
      zona.style.display = "block";
      msg("oc-syncdev-msg", "QR listos. Los cambios NO se borran de aquí hasta que el otro equipo los importe (dedup por operación: escanear dos veces no duplica).", "var(--verde)");
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
        msg("oc-syncdev-msg", "Este navegador no puede escanear QR (típico en iPhone). Usa \"Copiar cambios\" y pégalo en el otro equipo — misma seguridad.", "var(--rojo)");
        return;
      }
      if (!window.OCSecure.syncActiva()) { msg("oc-syncdev-msg", "Primero activa la sincronización con tu PIN.", "var(--rojo)"); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
      catch (_) { msg("oc-syncdev-msg", "No se pudo abrir la cámara (¿permiso denegado?).", "var(--rojo)"); return; }
      const ov = document.createElement("div");
      ov.id = "oc-syncdev-qr-overlay";
      ov.style.cssText = "position:fixed;inset:0;z-index:10001;background:#0F1923;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;";
      ov.innerHTML = `
        <video autoplay playsinline style="width:100%;max-width:420px;border-radius:10px;border:3px solid #5294AC;"></video>
        <p id="oc-qr-progreso" style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:17px;font-weight:700;margin:0;">Apunta al QR del otro equipo…</p>
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
            $("oc-qr-progreso").textContent = `Leídos ${tengo} de ${total}…`;
            if (total > 0 && tengo >= total) {
              detenerEscaneo();
              let texto = "";
              for (let i = 1; i <= total; i++) texto += frags[i];
              const r = await OCSync.importarPaqueteManual(texto);
              msg("oc-syncdev-msg", r.ok ? `Importado por QR: ${r.recibido || 0} cambio(s) aplicados.` : r.motivo, r.ok ? "var(--verde)" : "var(--rojo)");
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
      { nombre: "Caja (Activo)", debe: [["Cobrado hoy (con IVA)", pl.ingresosConIva]], haber: [["Gastos operativos", pl.gastosOperativos]] },
      { nombre: "Ventas (Ingreso)", debe: [], haber: [["Ingresos netos del día", pl.ingresos]] },
      { nombre: "IVA por Pagar (Pasivo)", debe: [], haber: [["IVA cobrado hoy (15%)", pl.ivaCobrado]] },
      { nombre: "Costo de Ventas (Gasto)", debe: [["Costo de lo vendido", pl.costoVentas]], haber: [] },
      { nombre: "Inventario (Activo)", debe: [["Saldo valorizado", bal.activos.inventarioValorizado]], haber: [["Salida por ventas", pl.costoVentas]] },
      { nombre: "Gastos Operativos (Gasto)", debe: [["Prorrateo del día", pl.gastosOperativos]], haber: [] },
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
    if (!filas.length) { box.innerHTML = `<p style="font-size:14px;color:var(--ink-soft);">Sin ubicaciones tipo socio/franquicia/consignación todavía.</p>`; return; }
    const maxCumplimiento = Math.max(100, ...filas.map((f) => f.cumplimientoMeta || 0));
    box.innerHTML = filas.map((f) => {
      const comisionEfectivaPct = f.ventasBrutas > 0 ? (f.comisionSocio / f.ventasBrutas) * 100 : 0;
      const anchoMeta = Math.min(100, ((f.cumplimientoMeta || 0) / maxCumplimiento) * 100);
      return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
          <strong>${escHtml(f.ubicacion)}</strong>
          <span style="color:var(--ink-soft);">${fmtVentas(f.ventasBrutas)} vendido · ${f.cumplimientoMeta ?? 0}% de meta</span>
        </div>
        <div style="background:var(--sim-azul-bg,#D4ECF5);border-radius:6px;overflow:hidden;height:22px;position:relative;">
          <div style="background:${(f.cumplimientoMeta || 0) >= 100 ? "var(--sim-verde,#00C87A)" : "var(--sim-azul,#5294AC)"};height:100%;width:${anchoMeta}%;transition:width .3s;"></div>
        </div>
        <div style="font-size:12px;color:var(--ink-soft);margin-top:3px;">Comisión efectiva pagada: ${comisionEfectivaPct.toFixed(1)}% (${money(f.comisionSocio)})</div>
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
          <th style="font-size:11px;color:var(--sim-azul);border-right:1.5px solid var(--sim-azul);border-bottom:1px solid var(--sim-azul);">DEBE</th>
          <th style="font-size:11px;color:var(--sim-azul);border-bottom:1px solid var(--sim-azul);">HABER</th>
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
})();
