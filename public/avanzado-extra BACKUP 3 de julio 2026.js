// avanzado-extra.js — Reestructura la vista "Avanzado" del dueño en dos capas:
//   1) Gestión (gastos, correo de recuperación, claves) — visible al dueño.
//   2) Contable (cuentas T, P&G, balance, valorizado) — detrás de la SUBCLAVE.
// Depende de window.OCAuth (auth-ui.js).
(function () {
  function $(id) { return document.getElementById(id); }
  const API = "/api";
  let desbloqueadaSesion = false;

  function ubic() { const s = $("selectUbicacion"); return s ? s.value : "todas"; }
  const money = (n) => "$" + Number(n || 0).toFixed(2);
  // Distingue "primer registro libre de correo" de "re-registro tras código
  // maestro" (SÍ debe encadenar directo a poner un PIN nuevo). Ver mismo
  // patrón en Olimpo Control.
  let reasignacionViaMaestro = false;

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
        fila("Reporte contable — AMIGABLE", new Date().toLocaleString("es-EC")),
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
        // Fotos de perchas (rec 26 completo, JFC 2026-07-02): viven en
        // localStorage (vp_foto_percha_*). Sin esto el respaldo perdería las
        // fotos reales al restaurar en otra tablet.
        const fotosPerchas = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("vp_foto_percha_") === 0) fotosPerchas[k] = localStorage.getItem(k);
        }
        const paquete = { fecha: new Date().toISOString(), datos, oc_secure: localStorage.getItem("oc_secure"), fotosPerchas };
        const blob = new Blob([JSON.stringify(paquete, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `respaldo-amigable-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        msg("oc-respaldo-msg", "Respaldo descargado. Guárdalo en un lugar seguro.", "var(--verde)");
      } catch (e) { msg("oc-respaldo-msg", "No se pudo exportar: " + e.message, "var(--rojo)"); }
    });

    $("oc-importar-file").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const paquete = JSON.parse(await file.text());
        if (!paquete.datos) { msg("oc-respaldo-msg", "Ese archivo no parece un respaldo de AMIGABLE.", "var(--rojo)"); return; }
        if (!confirm("Esto REEMPLAZA todos los datos actuales (productos, ventas, claves) con los del respaldo. ¿Continuar?")) return;
        const res = await fetch(`${API}/respaldo/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquete.datos) });
        const r = await res.json();
        if (!res.ok) { msg("oc-respaldo-msg", r.error, "var(--rojo)"); return; }
        if (paquete.oc_secure) localStorage.setItem("oc_secure", paquete.oc_secure);
        // Restaurar fotos de perchas (rec 26 completo).
        if (paquete.fotosPerchas) Object.entries(paquete.fotosPerchas).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} });
        msg("oc-respaldo-msg", "Respaldo importado. Recarga la página para ver los datos restaurados.", "var(--verde)");
      } catch (err) { msg("oc-respaldo-msg", "No se pudo importar: " + err.message, "var(--rojo)"); }
      e.target.value = "";
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
          <strong>${t.nombre}</strong> · ${t.cantidad} un.
          <div style="font-size:12px;color:var(--ink-soft);">${t.desdeNombre} → ${t.haciaNombre}</div>
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
          <strong>${f.ubicacion}</strong>
          <span style="color:var(--ink-soft);">${fmtVentas(f.ventasBrutas)} vendido · ${f.cumplimientoMeta ?? 0}% de meta</span>
        </div>
        <div style="background:var(--crema,#f3e8cd);border-radius:6px;overflow:hidden;height:22px;position:relative;">
          <div style="background:${(f.cumplimientoMeta || 0) >= 100 ? "var(--verde,#2f7a4f)" : "var(--azul-medio,#2c4a68)"};height:100%;width:${anchoMeta}%;transition:width .3s;"></div>
        </div>
        <div style="font-size:12px;color:var(--ink-soft);margin-top:3px;">Comisión efectiva pagada: ${comisionEfectivaPct.toFixed(1)}% (${money(f.comisionSocio)})</div>
      </div>`;
    }).join("");
  }
  function fmtVentas(n) { return "$" + Number(n || 0).toFixed(2); }

  function tAccount(c) {
    const filas = Math.max(c.debe.length, c.haber.length, 1);
    let rows = "";
    for (let i = 0; i < filas; i++) {
      const d = c.debe[i], h = c.haber[i];
      rows += `<tr>
        <td style="width:50%;padding:4px 6px;font-size:13px;border-right:1.5px solid var(--ink);">${d ? d[0] + " " + money(d[1]) : ""}</td>
        <td style="width:50%;padding:4px 6px;font-size:13px;">${h ? h[0] + " " + money(h[1]) : ""}</td></tr>`;
    }
    return `<div class="tag-card" style="padding:12px;">
      <div style="font-family:var(--font-display);font-weight:700;font-size:14px;text-align:center;color:var(--ink);border-bottom:2px solid var(--ink);padding-bottom:6px;margin-bottom:4px;">${c.nombre}</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><th style="font-size:11px;color:var(--ink-soft);border-right:1.5px solid var(--ink);border-bottom:1px solid var(--ink);">DEBE</th><th style="font-size:11px;color:var(--ink-soft);border-bottom:1px solid var(--ink);">HABER</th></tr>
        ${rows}
      </table></div>`;
  }

  // Si la ubicación cambia mientras está desbloqueada, re-render
  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "selectUbicacion" && desbloqueadaSesion && $("oc-contable") && $("oc-contable").style.display !== "none") render();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
