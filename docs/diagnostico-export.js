/* friendly-123: per-instance reconciliation evidence, explicit owner-only and read-only.
   No PIN/license/room, names, client details, raw photos, ciphertext or data payloads
   enter the downloadable report. A missing ACK is never inferred from a send. */
(function (root) {
  "use strict";
  const VERSION = 1;
  const MAX_ROWS = 30000;
  function owner() {
    return !!(root.OCAuth && typeof root.OCAuth.rolActual === "function" && root.OCAuth.rolActual() === "dueno");
  }
  function ls(key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } }
  function arrayKey(key) {
    try { const a = JSON.parse(ls(key) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function limited(items, fn) {
    const all = Array.isArray(items) ? items : [];
    return { total: all.length, truncado: all.length > MAX_ROWS, filas: all.slice(0, MAX_ROWS).map(fn) };
  }
  function opId(x) {
    const v = String(x == null ? "" : x);
    return /^[A-Za-z0-9_.:\-]{1,160}$/.test(v) && !/F123-/i.test(v) ? v : null;
  }
  function tipo(x) {
    const v = String(x == null ? "" : x);
    return /^[a-zA-Z0-9_-]{1,48}$/.test(v) ? v : "otro";
  }
  function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
  async function digest(s) {
    if (!root.crypto || !root.crypto.subtle || typeof root.TextEncoder !== "function")
      throw new Error("SHA-256 no disponible: no se exportan identificadores sin anonimizar.");
    const buffer = await root.crypto.subtle.digest("SHA-256", new root.TextEncoder().encode(String(s == null ? "" : s)));
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function fingerprint(rows) {
    const mapped = await Promise.all(rows.map(async x => ({
      clave: (await digest(x.id || "")).slice(0, 24),
      ...x.fields
    })));
    mapped.sort((a, b) => a.clave.localeCompare(b.clave));
    return { total: rows.length, huella: await digest(JSON.stringify(mapped)), filas: mapped };
  }
  function projInventory(x) {
    return { id: x.id, fields: { stock: num(x.stockActual), base: x.stockBase == null ? null : num(x.stockBase),
      deficit: num(x.stockDeficit || 0), epoca: x.stockEpochId ? "presente" : "ausente",
      pnHuella: x.stockPN || {}, conflicto: !!x.stockReconciliacionPendiente,
      borrado: !!x.borrado } };
  }
  function projSales(x) {
    return { id: x.id, fields: { opId: opId(x.opId), unidades: num(x.cantidad),
      precioUnitario: num(x.precioUnit), fecha: /^\d{4}-\d\d-\d\d/.test(String(x.fecha)) ? x.fecha : null,
      anulada: !!x.anulada, devuelta: !!x.devuelta, liquidada: !!x.liquidada } };
  }
  function projMoney(x) {
    return { id: x.id, fields: { opId: opId(x.opId), tipo: tipo(x.tipo || x.type || x.status),
      monto: num(x.monto == null ? (x.amount == null ? x.importe : x.amount) : x.monto),
      amountCents: num(x.amountCents), montoComisionSocio: num(x.montoComisionSocio),
      cantidad: num(x.cantidad), anulado: !!x.anulada, liquidada: !!x.liquidada,
      pagado: x.status === "paid" } };
  }
  function projAccess(x) {
    return { id: x.id, fields: { rol: ["dueno", "admin", "empleado", "contador", "artista"].includes(x.rol) ? x.rol : "otro",
      activo: x.activo !== false, borrado: !!x.borrado } };
  }
  async function withHashedPn(entries) {
    // StockPN actor identifiers can identify a device: export digest only.
    return Promise.all(entries.map(async row => {
      const pn = row.fields.pnHuella || {}, keys = Object.keys(pn).sort();
      row.fields.pn = await Promise.all(keys.map(async k => ({
        actor: (await digest(k)).slice(0, 24), add: num(pn[k] && pn[k].add), sub: num(pn[k] && pn[k].sub)
      })));
      delete row.fields.pnHuella;
      return row;
    }));
  }
  async function businessReport() {
    const res = await root.fetch("/api/diagnostico/reconciliacion", { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error("El backend rechazó el diagnóstico (" + res.status + ").");
    const d = await res.json();
    if (!d || d.formato !== 1) throw new Error("El backend no ofrece el formato de diagnóstico requerido.");
    const products = (d.productos || []).map(projInventory);
    await withHashedPn(products);
    const inventories = await fingerprint(products);
    const sales = await fingerprint((d.ventas || []).map(projSales));
    const dinero = {};
    for (const c of ["payouts", "gastos", "transferencias", "ajustesComision", "movimientos"]) {
      dinero[c] = await fingerprint((d[c] || []).map(projMoney));
    }
    const acceso = await fingerprint((d.usuarios || []).map(projAccess));
    const fotos = await fingerprint((d.fotos || []).map(x => ({
      id: x.id, fields: { clase: tipo(x.clase), tienePuntero: !!x.fotoHash,
        puntero: x.fotoHash ? x.fotoHash : null }
    })));
    // Photo hashes are themselves evidence; double hash so raw content fingerprints stay private.
    for (const x of fotos.filas) if (x.puntero) x.puntero = (await digest(x.puntero)).slice(0, 24);
    fotos.huella = await digest(JSON.stringify(fotos.filas));
    return { revision: num(d.revision), persistenciaConfirmadaLocal: d.persistenciaConfirmadaLocal === true, inventario: inventories, ventas: sales,
      dinero, fotos, acceso, conteos: d.conteos || {} };
  }
  async function transportReport() {
    const legacyLog = arrayKey("f123_sync_log");
    const legacyQueue = arrayKey("f123_sync_cola");
    const queued = new Set(legacyQueue.map(x => opId(x && x.opId)).filter(Boolean));
    const safeOp = async (x, estado) => ({
      opId: opId(x && x.opId), tipo: tipo(x && x.tipo),
      lamport: num(x && x.lamport), fecha: x && typeof x.fecha === "string" && /^\d{4}-/.test(x.fecha) ? x.fecha : null,
      dispositivo: x && x.deviceId ? (await digest(x.deviceId)).slice(0, 24) : null,
      estado
    });
    const logs = await Promise.all(legacyLog.slice(0, MAX_ROWS).map(x => safeOp(x, queued.has(opId(x && x.opId)) ? "pendiente-cola-legacy" : "sin-ACK-individual-verificable")));
    const missing = legacyQueue.filter(x => !legacyLog.some(z => opId(z && z.opId) === opId(x && x.opId)));
    const extra = await Promise.all(missing.slice(0, MAX_ROWS).map(x => safeOp(x, "pendiente-cola-legacy")));
    const y = root.OCYjs;
    const channels = {};
    if (y) {
      for (const [name, c] of [["catalogo", y.canal], ["operaciones", y.opsCanal], ["fotos", y.fotosCanal]]) {
        if (!c) { channels[name] = { disponible: false }; continue; }
        const r = typeof c.diagnosticoOutboxLectura === "function" ? c.diagnosticoOutboxLectura() : null;
        const envelopes = r && Array.isArray(r.sobres) ? r.sobres : [];
        channels[name] = {
          disponible: !!r, recuperando: !!c.recuperando, recuperacionLocal: tipo(c.recuperacionLocal),
          socket: c.ws ? num(c.ws.readyState) : null, pendientesRelay: num(c.pendientesRelay),
          huerfanosHeredados: num(c.huerfanosHeredados),
          totalSobres: r ? r.total : null, sinGuardar: r ? r.sinGuardar : null,
          confirmados: r ? r.confirmados : null, truncado: r ? r.truncado : null,
          sobres: await Promise.all(envelopes.map(async e => ({
            sobre: (await digest(e.id)).slice(0, 24), clase: tipo(e.clase),
            huerfano: !!e.huerfano, enVuelo: !!e.enVuelo,
            grupo: e.grupo ? (await digest(e.grupo)).slice(0, 24) : null,
            // Envelope ID is NOT an opId; no false join between these ledgers.
            opId: null
          })))
        };
      }
    }
    let yjsOps = { disponible: false };
    if (y && y.opsMap && typeof y.opsMap.forEach === "function") {
      const ids = [];
      let total = 0;
      y.opsMap.forEach((v, k) => { total++; if (ids.length < MAX_ROWS) ids.push(opId(v && v.opId || k)); });
      yjsOps = { disponible: true, total, truncado: total > MAX_ROWS, opIds: ids.filter(Boolean).sort() };
    }
    let hechos = { disponible: false };
    try {
      const h = root.AMG && root.AMG.Hechos;
      if (h && typeof h.todos === "function") {
        const records = await h.todos();
        const list = Array.isArray(records) ? records : [];
        hechos = { disponible: true, ...limited(list, x => ({
          id: opId(x && x.id), opId: opId(x && x.datos && x.datos.opId),
          tipo: tipo(x && x.tipo), hash: x && typeof x.hash === "string" ? x.hash.slice(0, 80) : null
        })), cadenaLocal: typeof h.verificarCadena === "function" ?
          (await h.verificarCadena()) === null ? { ok: true } : { ok: false, detalle: "verificar localmente" } : null };
      }
    } catch (_) { hechos = { disponible: false, error: "no-legible" }; }
    return {
      sync: root.OCSyncControl ? {
        estado: tipo(root.OCSyncControl.estado && root.OCSyncControl.estado()),
        presencia: num(root.OCSyncControl.presencia && root.OCSyncControl.presencia()),
        pendienteDurable: !!(root.OCSyncControl.durabilidadPendiente && root.OCSyncControl.durabilidadPendiente())
      } : { disponible: false },
      yjs: y && typeof y._diag === "function" ? (() => {
        const d = y._diag();
        return { estado: tipo(d.estado), n: d.n, ws: d.ws, ops: d.ops,
          fotos: d.fotos, recuperacionLocalPendiente: !!d.recuperacionLocalPendiente };
      })() : { disponible: false },
      canales: channels, opsYjs: yjsOps, hechos,
      legado: { log: { total: legacyLog.length, truncado: legacyLog.length > MAX_ROWS,
        filas: logs.concat(extra) }, cola: { total: legacyQueue.length,
        idsPendientes: legacyQueue.map(x => opId(x && x.opId)).filter(Boolean) },
        colaDesbordada: num(ls("f123_sync_cola_desbordada")) },
      // No adapter exposes receiver-specific durable ACK-by-opId:
      acuseRemotoPorOpId: { disponible: false, motivo: "No inferir ACK de un send ni de la desaparición de la cola legacy." }
    };
  }
  async function construir() {
    if (!owner()) throw new Error("Solo el dueño autorizado puede exportar este informe.");
    const a = await businessReport();
    if (!owner()) throw new Error("La sesión cambió durante la lectura; exportación cancelada.");
    const b = await transportReport();
    if (!owner()) throw new Error("La sesión cambió durante la lectura; exportación cancelada.");
    const d = root.OCSyncControl && root.OCSyncControl.deviceIdActual && root.OCSyncControl.deviceIdActual();
    const version = ls("f123_version_vista") || (root.document.querySelector('meta[name="app-version"]') || {}).content || "";
    return {
      esquema: "friendly-123-reconciliacion-v1", versionEsquema: VERSION,
      generadoEn: new Date().toISOString(), version, sha: null,
      shaVerificado: false, nombreAparato: null,
      ultimaActividadLocal: (() => {
        const fechas = arrayKey("f123_sync_log").map(x => Date.parse(x && x.fecha || "")).filter(Number.isFinite);
        return fechas.length ? new Date(Math.max(...fechas)).toISOString() : null;
      })(),
      navegador: String(root.navigator.userAgent || "").slice(0, 180),
      dispositivo: d ? (await digest(d)).slice(0, 24) : null,
      contexto: "Instancia local; no implica convergencia, validación cruzada ni ACK remoto",
      comercial: a, transporte: b,
      pruebas: { capturasFisicas: false, respaldosVerificados: false, canonicidad: "sin-determinar",
        convergencia: "no-verificada", veredicto: "NO-GO" },
      advertencias: [
        "Las huellas de datos del backend reflejan este aparato al momento de leerlos.",
        "Los sobres cifrados del relay NO tienen relación 1:1 garantizada con opId.",
        "Un mismo hash local NO certifica ACK de otros dispositivos.",
        "El informe no incluye imágenes, payloads, PIN, licencias, datos personales ni cifrados.",
        "El SHA exacto de la build y el nombre del aparato no están disponibles con una API fiable: se muestran null en vez de inventarlos."
      ]
    };
  }
  async function descargar() {
    const reporte = await construir();
    if (!owner()) throw new Error("Sesión cambiada; descarga cancelada.");
    const data = JSON.stringify(reporte, null, 2);
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    const url = root.URL.createObjectURL(blob);
    try {
      const a = root.document.createElement("a");
      a.href = url; a.download = "friendly123-reconciliacion-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      root.document.body.appendChild(a); a.click(); a.remove();
    } finally { root.URL.revokeObjectURL(url); }
    return reporte;
  }
  root.F123DiagnosticoExport = { construir, descargar };
})(typeof window !== "undefined" ? window : this);
