// data.js — Capa única de acceso a datos. Server.js solo habla con este
// archivo y no le importa si los datos vienen de Loyverse (modo real) o
// de db.js (modo demo local, sin token configurado).

const { randomUUID } = require("crypto");
const db = require("./db");
const loyverse = require("./loyverse");

const MODO_LOYVERSE = loyverse.activo();
let ultimaVentaLoyverse = null; // ver anularVenta() en modo Loyverse, más abajo

function registrarMovimiento(tipo, detalle) {
  db.get("movimientos").push({ id: randomUUID(), tipo, detalle, fecha: new Date().toISOString() }).write();
}

function getActividad() {
  return db.get("movimientos").value().slice().reverse().slice(0, 100);
}

// --- Gastos mensuales: siempre locales, sin importar el modo ---
function getGastosMensuales(ubicacionId) {
  const gastos = db.get("configuracion.gastosMensuales").value() || {};
  if (!ubicacionId || ubicacionId === "todas") {
    const total = Object.values(gastos).reduce((acc, v) => acc + Number(v || 0), 0);
    return { ubicacionId: "todas", gastosMensuales: Number(total.toFixed(2)), porUbicacion: gastos };
  }
  return { ubicacionId, gastosMensuales: Number(gastos[ubicacionId] || 0) };
}

function setGastosMensuales(ubicacionId, monto) {
  db.set(`configuracion.gastosMensuales.${ubicacionId}`, Number(monto.toFixed(2))).write();
}

// --- Activacion de instancia (free-tier gating, 2026-07-15): siempre local,
// sin importar el modo (Loyverse o demo) — igual que gastosMensuales arriba.
// "apropiada" (instanceId presente) desbloquea limites de plan gratis.
function getActivacion() {
  return db.get("configuracion.activacion").value() || { instanceId: null, email: null, activatedAt: null };
}
function activarInstancia({ instanceId, email } = {}) {
  const a = { instanceId: instanceId || randomUUID(), email: email || "", activatedAt: Date.now() };
  db.set("configuracion.activacion", a).write();
  return a;
}

if (MODO_LOYVERSE) {
  // ====================== MODO LOYVERSE (real) ======================
  module.exports = {
    modo: "loyverse",

    async getUbicaciones() {
      return loyverse.getUbicaciones();
    },

    // Las ubicaciones (tiendas) en modo Loyverse se administran EN Loyverse
    // mismo — es la fuente de verdad. No duplicamos su gestión aquí.
    async crearUbicacion() {
      return { error: "Con Loyverse conectado, crea ubicaciones directamente en Loyverse — se reflejarán automáticamente aquí." };
    },
    async actualizarUbicacion() {
      return { error: "Con Loyverse conectado, edita ubicaciones directamente en Loyverse." };
    },
    async setActivaUbicacion() {
      return { error: "Con Loyverse conectado, activa/desactiva tiendas directamente en Loyverse." };
    },

    // Revenue sharing e inventario compartido dependen de datos de venta que
    // en este modo vienen de Loyverse (sin campos de split/comisión propios
    // todavía) — no implementado hasta que el propietario conecte su cuenta y se
    // decida cómo mapear esto sobre su catálogo real.
    getLiquidaciones() { return []; },
    async marcarLiquidado() { return { error: "No disponible en modo Loyverse todavía." }; },
    getSugerenciasTransferencia() { return []; },
    async crearTransferencia() { return { error: "No disponible en modo Loyverse todavía." }; },
    getTransferencias() { return []; },
    async aprobarTransferencia() { return { error: "No disponible en modo Loyverse todavía." }; },
    async confirmarRecepcionTransferencia() { return { error: "No disponible en modo Loyverse todavía." }; },
    async rechazarTransferencia() { return { error: "No disponible en modo Loyverse todavía." }; },

    async nombreUbicacion(id) {
      const u = (await loyverse.getUbicaciones()).find((x) => x.id === id);
      return u ? u.nombre : "Ubicación desconocida";
    },

    async getProductos(ubicacionId) {
      const todos = await loyverse.getProductos();
      if (!ubicacionId || ubicacionId === "todas") return todos;
      return todos.filter((p) => p.ubicacionId === ubicacionId);
    },

    async getProducto(id) {
      const todos = await loyverse.getProductos();
      return todos.find((p) => p.id === id) || null;
    },

    async buscarPorCodigo(codigo) {
      const c = String(codigo).trim().toLowerCase();
      const todos = await loyverse.getProductos();
      return todos.find((p) => String(p.barcode).toLowerCase() === c || String(p.sku).toLowerCase() === c) || null;
    },

    // Dar de alta catálogo nuevo se hace en Loyverse mismo (es la fuente de
    // verdad del inventario en este modo); acá solo se lee y refleja. Si en
    // el futuro se quiere crear desde AMIGABLE, hay que llamar al
    // endpoint de creación de items de la API de Loyverse — no implementado
    // todavía porque el propietario aún no ha conectado su cuenta real.
    async crearProducto() {
      return { error: "Con Loyverse conectado, da de alta productos nuevos directamente en Loyverse — AMIGABLE los reflejará automáticamente." };
    },

    async actualizarProducto() {
      return { error: "Con Loyverse conectado, edita el catálogo directamente en Loyverse." };
    },

    async eliminarProducto() {
      return { error: "Con Loyverse conectado, elimina productos directamente en Loyverse." };
    },

    async venderUno(id, cantidad) {
      const p = await this.getProducto(id);
      if (!p) return { error: "Producto no encontrado." };
      if (p.stockActual < cantidad) return { error: `No hay suficiente stock disponible (quedan ${p.stockActual}).` };

      await loyverse.ajustarStock({ variantId: p.variantId, storeId: p.ubicacionId, delta: -cantidad, motivo: "Venta rápida desde AMIGABLE" });
      registrarMovimiento("venta", {
        producto: p.nombre,
        cantidad,
        total: Number((p.precio * cantidad).toFixed(2)),
        ubicacion: await this.nombreUbicacion(p.ubicacionId),
      });
      ultimaVentaLoyverse = { ventaId: randomUUID(), productoId: id, cantidad };
      return { producto: await this.getProducto(id), ventaId: ultimaVentaLoyverse.ventaId };
    },

    async anularVenta(ventaId) {
      if (!ultimaVentaLoyverse || ultimaVentaLoyverse.ventaId !== ventaId) {
        return { error: "Esta venta ya no se puede anular (pasó el tiempo o ya se anuló)." };
      }
      const { productoId, cantidad } = ultimaVentaLoyverse;
      ultimaVentaLoyverse = null;
      const p = await this.getProducto(productoId);
      if (!p) return { error: "Producto no encontrado." };
      await loyverse.ajustarStock({ variantId: p.variantId, storeId: p.ubicacionId, delta: cantidad, motivo: "Anulación de venta (deshacer)" });
      registrarMovimiento("anulacion", { producto: p.nombre, cantidad, ubicacion: await this.nombreUbicacion(p.ubicacionId) });
      return { producto: await this.getProducto(productoId) };
    },

    async ajustar(id, delta, motivo) {
      const p = await this.getProducto(id);
      if (!p) return { error: "Producto no encontrado." };
      if (p.stockActual + delta < 0) return { error: `Ese ajuste dejaría el stock en negativo (actual: ${p.stockActual}).` };

      await loyverse.ajustarStock({ variantId: p.variantId, storeId: p.ubicacionId, delta, motivo });
      registrarMovimiento("ajuste", {
        producto: p.nombre,
        delta,
        motivo,
        stockResultante: p.stockActual + delta,
        ubicacion: await this.nombreUbicacion(p.ubicacionId),
      });
      return { producto: await this.getProducto(id) };
    },

    async getVentasHoy(ubicacionId, fechaISO) {
      return loyverse.getVentasHoy(ubicacionId, fechaISO);
    },

    getActividad,
    getGastosMensuales,
    setGastosMensuales,
    getActivacion,
    activarInstancia,
    ventasCountMesGlobal,
    exportarTodo,
    importarTodo,
  };
} else {
  // ====================== MODO DEMO (local, sin token) ======================
  function nombreUbicacionLocal(id) {
    const u = db.get("ubicaciones").find({ id }).value();
    return u ? u.nombre : "Ubicación desconocida";
  }

// ---------------------------------------------------------------------------
// REVENUE SHARING (brotes 1 y 3, JFC 2026-07-01)
// ---------------------------------------------------------------------------
// Por qué esto y no un % fijo hardcodeado: la mayoría del software de
// consignación/franquicia cobra igual sin importar el volumen y esconde el
// cálculo real del socio en una hoja de Excel aparte (investigado: quejas
// recurrentes de dueños de tiendas de consignación sobre "no sé cómo
// llegaron a ese número"). Acá el cálculo es transparente, se guarda CON
// cada venta (no se recalcula después con supuestos distintos) y sube solo
// si el socio va superando su meta del mes — motor de incentivos, no una
// hoja de cálculo escondida.
const ZONA_MX = "America/Guayaquil";
function mesActualISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_MX, year: "numeric", month: "2-digit" }).format(new Date());
}
function esDelMesActual(fechaISO) {
  if (!fechaISO) return false;
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_MX, year: "numeric", month: "2-digit" }).format(new Date(fechaISO)) === mesActualISO();
}
// Total bruto vendido este mes en una ubicación, ANTES de la venta en curso
// (se usa para saber en qué escala de comisión cae la venta que se está
// registrando ahora mismo).
function ventasMesAcumuladas(ubicacionId) {
  return db.get("ventas").value()
    .filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha))
    .reduce((acc, v) => acc + v.precioUnit * v.cantidad, 0);
}
// Conteo global de ventas del mes actual, TODAS las ubicaciones (free-tier
// gating, 2026-07-15). Distinto de ventasMesAcumuladas: esa suma montos por
// una sola ubicación (para comisiones); esta cuenta transacciones en total
// (para el tope de 100 ventas/mes del plan gratis).
function ventasCountMesGlobal() {
  return db.get("ventas").value().filter((v) => esDelMesActual(v.fecha)).length;
}
// Elige la escala vigente según % de meta acumulado (incluyendo esta venta).
// Sin escalas configuradas, usa el % fijo comisionSocio. Sin meta ($0 o sin
// definir), no se puede calcular % de cumplimiento — usa la primera escala
// o el fijo, lo que exista, para no romper la venta por falta de config.
function comisionVigente(ubicacion, acumuladoConEstaVenta) {
  const escalas = Array.isArray(ubicacion.escalasComision) ? ubicacion.escalasComision : [];
  if (!ubicacion.metaMensual || escalas.length === 0) return Number(ubicacion.comisionSocio) || 0;
  const pctMeta = (acumuladoConEstaVenta / ubicacion.metaMensual) * 100;
  const escalasOrdenadas = [...escalas].sort((a, b) => a.hasta - b.hasta);
  const tier = escalasOrdenadas.find((e) => pctMeta <= e.hasta) || escalasOrdenadas[escalasOrdenadas.length - 1];
  return Number(tier.comision) || 0;
}
// Calcula el split de una venta. Dos comisiones INDEPENDIENTES pueden
// aplicar a la misma venta: la del socio del local (por tipo de ubicación,
// como antes) y la de un promotor/embajador (por persona, sin importar el
// tipo de ubicación — un promotor puede traer clientela incluso a un local
// "propio"). Ambas salen del lado del dueño; nunca se restan entre sí.
// Devuelve null solo si NO aplica ninguna de las dos (ubicación propia sin
// promotor asignado a esa venta) — no hay nada que repartir.
function calcularSplitVenta(ubicacion, montoBruto, acumuladoPrevio, promotor) {
  const esSocio = !!(ubicacion && ubicacion.tipo && ubicacion.tipo !== "propio");
  let comisionPct = 0, montoComisionSocio = 0;
  if (esSocio) {
    const acumuladoConEsta = acumuladoPrevio + montoBruto;
    comisionPct = comisionVigente(ubicacion, acumuladoConEsta);
    montoComisionSocio = Number((montoBruto * (comisionPct / 100)).toFixed(2));
  }
  let comisionPromotorPct = 0, montoComisionPromotor = 0;
  if (promotor && promotor.activo) {
    comisionPromotorPct = Number(promotor.comisionPct) || 0;
    montoComisionPromotor = Number((montoBruto * (comisionPromotorPct / 100)).toFixed(2));
  }
  if (!esSocio && !promotor) return null;
  return {
    comisionPct,
    montoBruto: Number(montoBruto.toFixed(2)),
    montoComisionSocio,
    promotorId: promotor ? promotor.id : null,
    promotorNombre: promotor ? promotor.nombre : null,
    comisionPromotorPct,
    montoComisionPromotor,
    montoNetoDueno: Number((montoBruto - montoComisionSocio - montoComisionPromotor).toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// PROMOTORES / EMBAJADORES (JFC, 2026-07-01)
// ---------------------------------------------------------------------------
// Independientes de la ubicación: un promotor puede trabajar en varios
// locales/perchas a la vez (ubicacionesIds es un arreglo). La comisión
// es un % plano por venta que atendió — no usa escalas por meta como el
// socio, porque un promotor no tiene "su" local con una meta propia; podría
// agregarse después si hace falta, pero hoy sería sobre-ingeniería.
function getPromotores(soloActivos = false) {
  const todos = db.get("promotores").value() || [];
  return soloActivos ? todos.filter((p) => p.activo !== false) : todos;
}
function getPromotoresDeUbicacion(ubicacionId) {
  return getPromotores(true).filter((p) => (p.ubicacionesIds || []).includes(ubicacionId));
}
function crearPromotor({ nombre, comisionPct, ubicacionesIds }) {
  if (!nombre || !nombre.trim()) return { error: "El nombre de la promotora/e es obligatorio." };
  const pct = Number(comisionPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "La comisión debe ser un número entre 0 y 100." };
  const p = { id: randomUUID(), nombre: nombre.trim(), comisionPct: pct, activo: true, ubicacionesIds: Array.isArray(ubicacionesIds) ? ubicacionesIds : [] };
  db.get("promotores").push(p).write();
  registrarMovimiento("promotor-alta", { promotor: p.nombre });
  return p;
}
function actualizarPromotor(id, { nombre, comisionPct, ubicacionesIds }) {
  const p = db.get("promotores").find({ id }).value();
  if (!p) return { error: "Promotora/e no encontrada." };
  const cambios = {};
  if (nombre && nombre.trim()) cambios.nombre = nombre.trim();
  if (comisionPct != null) {
    const pct = Number(comisionPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "La comisión debe ser un número entre 0 y 100." };
    cambios.comisionPct = pct;
  }
  if (Array.isArray(ubicacionesIds)) cambios.ubicacionesIds = ubicacionesIds;
  db.get("promotores").find({ id }).assign(cambios).write();
  return db.get("promotores").find({ id }).value();
}
function setActivoPromotor(id, activo) {
  const p = db.get("promotores").find({ id }).value();
  if (!p) return { error: "Promotora/e no encontrada." };
  db.get("promotores").find({ id }).assign({ activo: !!activo }).write();
  return db.get("promotores").find({ id }).value();
}
// Comisiones acumuladas del mes por promotor (para Liquidaciones) — misma
// idea que getLiquidaciones() pero agrupado por persona, no por local,
// porque un promotor puede haber vendido en varios locales este mes.
function getComisionesPromotores() {
  const promotores = getPromotores(false);
  return promotores.map((prom) => {
    const ventasMes = db.get("ventas").value().filter((v) => esDelMesActual(v.fecha) && v.split && v.split.promotorId === prom.id);
    const ventasBrutas = ventasMes.reduce((a, v) => a + v.split.montoBruto, 0);
    const comision = ventasMes.reduce((a, v) => a + v.split.montoComisionPromotor, 0);
    const pendientes = ventasMes.filter((v) => !v.liquidadaPromotor);
    return {
      promotorId: prom.id, promotor: prom.nombre, activo: prom.activo !== false, comisionPct: prom.comisionPct,
      ubicaciones: (prom.ubicacionesIds || []).map((id) => (db.get("ubicaciones").find({ id }).value() || {}).nombre).filter(Boolean),
      ventasAtendidas: ventasMes.length, ventasBrutas: Number(ventasBrutas.toFixed(2)), comision: Number(comision.toFixed(2)),
      estado: ventasMes.length === 0 ? "sin ventas" : pendientes.length === 0 ? "pagado" : "pendiente",
    };
  });
}
function marcarLiquidadoPromotor(promotorId) {
  const prom = db.get("promotores").find({ id: promotorId }).value();
  if (!prom) return { error: "Promotora/e no encontrada." };
  const ventas = db.get("ventas").value().filter((v) => esDelMesActual(v.fecha) && v.split && v.split.promotorId === promotorId && !v.liquidadaPromotor);
  ventas.forEach((v) => db.get("ventas").find({ id: v.id }).assign({ liquidadaPromotor: true }).write());
  registrarMovimiento("liquidacion-promotor", { promotor: prom.nombre, ventasLiquidadas: ventas.length });
  return { ok: true, ventasLiquidadas: ventas.length };
}

// Vista "Liquidaciones": una fila por ubicación no-propia, con lo vendido
// este mes, la comisión acumulada del socio, el neto del dueño, y si ya se
// pagó. "liquidada" vive en cada venta (no en la ubicación) porque el dueño
// puede pagar parcial/mensualmente sin perder el detalle de qué venta ya se
// saldó.
function getLiquidaciones() {
  const ubicaciones = db.get("ubicaciones").value().filter((u) => u.tipo && u.tipo !== "propio");
  return ubicaciones.map((u) => {
    const ventasMes = db.get("ventas").value().filter((v) => v.ubicacionId === u.id && esDelMesActual(v.fecha) && v.split);
    const ventasBrutas = ventasMes.reduce((a, v) => a + v.split.montoBruto, 0);
    const comisionSocio = ventasMes.reduce((a, v) => a + v.split.montoComisionSocio, 0);
    const netoDueno = ventasMes.reduce((a, v) => a + v.split.montoNetoDueno, 0);
    const pendientes = ventasMes.filter((v) => !v.liquidada);
    // #19: desglose itemizado por producto de lo pendiente (recibo al socio).
    const productos = db.get("productos").value();
    const detMap = new Map();
    pendientes.forEach((v) => {
      const p = productos.find((x) => x.id === v.productoId);
      const cur = detMap.get(v.productoId) || { producto: p ? p.nombre : "Producto", sku: p ? p.sku : "", cantidad: 0, montoBruto: 0, comisionSocio: 0 };
      cur.cantidad += v.cantidad || 1;
      cur.montoBruto += v.split ? v.split.montoBruto : 0;
      cur.comisionSocio += v.split ? v.split.montoComisionSocio : 0;
      detMap.set(v.productoId, cur);
    });
    const detallePendientes = [...detMap.values()].map((d) => ({ ...d, montoBruto: Number(d.montoBruto.toFixed(2)), comisionSocio: Number(d.comisionSocio.toFixed(2)) }));
    return {
      ubicacionId: u.id, ubicacion: u.nombre, tipo: u.tipo,
      metaMensual: u.metaMensual || 0,
      cumplimientoMeta: u.metaMensual ? Number(((ventasBrutas / u.metaMensual) * 100).toFixed(1)) : null,
      ventasBrutas: Number(ventasBrutas.toFixed(2)),
      comisionSocio: Number(comisionSocio.toFixed(2)),
      netoDueno: Number(netoDueno.toFixed(2)),
      estado: ventasMes.length === 0 ? "sin ventas" : pendientes.length === 0 ? "pagado" : "pendiente",
      ventasPendientes: pendientes.length, detallePendientes,
    };
  });
}
// Marca TODAS las ventas del mes en curso de esa ubicación como liquidadas
// (pagadas al socio). No borra ni recalcula nada — es un sello, no un ajuste.
function marcarLiquidado(ubicacionId) {
  const u = db.get("ubicaciones").find({ id: ubicacionId }).value();
  if (!u) return { error: "Ubicación no encontrada." };
  const ventas = db.get("ventas").value().filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha) && !v.liquidada);
  ventas.forEach((v) => db.get("ventas").find({ id: v.id }).assign({ liquidada: true }).write());
  registrarMovimiento("liquidacion", { ubicacion: u.nombre, ventasLiquidadas: ventas.length });
  return { ok: true, ventasLiquidadas: ventas.length };
}

// ---------------------------------------------------------------------------
// INVENTARIO COMPARTIDO (brote 2, JFC 2026-07-01)
// ---------------------------------------------------------------------------
// Investigado: la queja más repetida en gestión multi-local es "un local se
// queda sin stock mientras el de al lado tiene de sobra, y nadie se entera
// hasta que el cliente ya se fue". Esto busca automáticamente el mismo SKU
// con stock sano en otra ubicación ACTIVA cuando uno está en rojo/amarillo.
function calcularEstadoSimple(p) {
  if (p.stockActual <= 0) return "rojo";
  if (p.stockActual <= p.umbralRojo) return "rojo";
  if (p.stockActual <= p.umbralAmarillo) return "amarillo";
  return "verde";
}
function getSugerenciasTransferencia(productoId) {
  const p = db.get("productos").find({ id: productoId }).value();
  if (!p || calcularEstadoSimple(p) === "verde") return [];
  const activasIds = new Set(db.get("ubicaciones").value().filter((u) => u.activa !== false).map((u) => u.id));
  return db.get("productos").value()
    .filter((x) => x.sku === p.sku && x.id !== p.id && activasIds.has(x.ubicacionId) && calcularEstadoSimple(x) !== "rojo" && x.stockActual > x.umbralAmarillo)
    .map((x) => ({
      productoDestinoId: p.id, productoOrigenId: x.id, sku: p.sku, nombre: p.nombre,
      desde: x.ubicacionId, desdeNombre: nombreUbicacionLocal(x.ubicacionId),
      hacia: p.ubicacionId, haciaNombre: nombreUbicacionLocal(p.ubicacionId),
      stockOrigen: x.stockActual,
      cantidadSugerida: Math.min(Math.floor(x.stockActual / 2), x.stockActual - x.umbralAmarillo),
    }))
    .filter((s) => s.cantidadSugerida > 0);
}
function crearTransferencia({ productoOrigenId, productoDestinoId, cantidad }) {
  const origen = db.get("productos").find({ id: productoOrigenId }).value();
  const destino = db.get("productos").find({ id: productoDestinoId }).value();
  if (!origen || !destino) return { error: "Producto no encontrado." };
  if (origen.sku !== destino.sku) return { error: "Los productos de origen y destino no son el mismo artículo (SKU distinto)." };
  const cant = Number(cantidad);
  if (!Number.isInteger(cant) || cant <= 0) return { error: "La cantidad debe ser un entero mayor a 0." };
  if (origen.stockActual < cant) return { error: `"${origen.nombre}" solo tiene ${origen.stockActual} unidades en origen.` };
  const t = {
    id: randomUUID(), productoOrigenId, productoDestinoId, sku: origen.sku, nombre: origen.nombre,
    desde: origen.ubicacionId, desdeNombre: nombreUbicacionLocal(origen.ubicacionId),
    hacia: destino.ubicacionId, haciaNombre: nombreUbicacionLocal(destino.ubicacionId),
    cantidad: cant, estado: "solicitada", fecha: new Date().toISOString(),
  };
  db.get("transferencias").push(t).write();
  registrarMovimiento("transferencia-solicitada", { producto: t.nombre, cantidad: cant, desde: t.desdeNombre, hacia: t.haciaNombre });
  return t;
}
function getTransferencias() {
  return db.get("transferencias").value().slice().reverse();
}
// Aprobar: el stock SALE del origen de inmediato (evita venderlo dos veces
// mientras viaja) y la transferencia queda "en_transito" hasta que alguien
// confirme que llegó — recién ahí se suma al destino. Si se rechaza, no se
// toca ningún stock.
function aprobarTransferencia(id) {
  const t = db.get("transferencias").find({ id }).value();
  if (!t) return { error: "Transferencia no encontrada." };
  if (t.estado !== "solicitada") return { error: `Esta transferencia ya está en estado "${t.estado}".` };
  const origen = db.get("productos").find({ id: t.productoOrigenId }).value();
  if (!origen || origen.stockActual < t.cantidad) return { error: "Ya no hay suficiente stock en origen para aprobar esta transferencia." };
  db.get("productos").find({ id: t.productoOrigenId }).assign({ stockActual: origen.stockActual - t.cantidad }).write();
  db.get("transferencias").find({ id }).assign({ estado: "en_transito" }).write();
  registrarMovimiento("transferencia-aprobada", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
  return db.get("transferencias").find({ id }).value();
}
function confirmarRecepcionTransferencia(id) {
  const t = db.get("transferencias").find({ id }).value();
  if (!t) return { error: "Transferencia no encontrada." };
  if (t.estado !== "en_transito") return { error: `Esta transferencia está "${t.estado}", no se puede confirmar recepción.` };
  const destino = db.get("productos").find({ id: t.productoDestinoId }).value();
  if (!destino) return { error: "Producto destino no encontrado." };
  db.get("productos").find({ id: t.productoDestinoId }).assign({ stockActual: destino.stockActual + t.cantidad }).write();
  db.get("transferencias").find({ id }).assign({ estado: "recibida" }).write();
  registrarMovimiento("transferencia-recibida", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
  return db.get("transferencias").find({ id }).value();
}
function rechazarTransferencia(id) {
  const t = db.get("transferencias").find({ id }).value();
  if (!t) return { error: "Transferencia no encontrada." };
  if (t.estado !== "solicitada") return { error: `Esta transferencia ya está en estado "${t.estado}".` };
  db.get("transferencias").find({ id }).assign({ estado: "rechazada" }).write();
  return db.get("transferencias").find({ id }).value();
}

// Respaldo exportable/importable — ver nota larga en Olimpo Control/data.js.
function exportarTodo() {
  if (MODO_LOYVERSE) {
    return {
      modo: "loyverse",
      aviso: "Productos, ventas e inventario viven en Loyverse — respáldalos desde ahí. Este archivo solo contiene movimientos y gastos locales.",
      movimientos: db.get("movimientos").value(),
      configuracion: db.get("configuracion").value(),
    };
  }
  return { modo: "demo", ...db.getState() };
}

function importarTodo(datos) {
  if (!datos || typeof datos !== "object") return { error: "Archivo de respaldo inválido." };
  if (MODO_LOYVERSE) {
    if (datos.movimientos) db.set("movimientos", datos.movimientos).write();
    if (datos.configuracion) db.set("configuracion", datos.configuracion).write();
    return { ok: true };
  }
  if (datos.modo && datos.modo !== "demo") return { error: "Este respaldo es de otro modo (Loyverse) y no aplica aquí." };
  const { modo, ...estado } = datos;
  // BUG FIJADO 2026-07-03: la validación solo comprobaba que productos/
  // ubicaciones fueran "truthy" (un string u objeto también lo son), no que
  // fueran ARRAYS de verdad. db.setState() reemplaza TODO el estado sin más
  // chequeo — un respaldo corrupto o mal armado dejaba la app inservible
  // hasta editar el archivo db.json a mano. Ahora se exige el tipo correcto.
  if (!Array.isArray(estado.productos) || !Array.isArray(estado.ubicaciones)) {
    return { error: "El archivo no parece un respaldo válido de AMIGABLE." };
  }
  db.setState(estado);
  return { ok: true };
}

  module.exports = {
    modo: "demo",

    // soloActivas=true (default) es lo que usa el selector operativo del día
    // a día — una ubicación desactivada no debe ofrecerse para vender ahí.
    // El panel de administración de ubicaciones pide soloActivas=false para
    // poder mostrar (y reactivar) las archivadas.
    async getUbicaciones(soloActivas = true) {
      const todas = db.get("ubicaciones").value();
      return soloActivas ? todas.filter((u) => u.activa !== false) : todas;
    },

    async nombreUbicacion(id) {
      return nombreUbicacionLocal(id);
    },

    async crearUbicacion({ nombre, tipo, comisionSocio, metaMensual, escalasComision }) {
      if (!nombre || !nombre.trim()) return { error: "El nombre de la ubicación es obligatorio." };
      const u = {
        id: randomUUID(), nombre: nombre.trim(), tipo: tipo || "propio", activa: true,
        comisionSocio: Number(comisionSocio) || 0, metaMensual: Number(metaMensual) || 0,
        escalasComision: Array.isArray(escalasComision) ? escalasComision : [],
      };
      db.get("ubicaciones").push(u).write();
      registrarMovimiento("ubicacion-alta", { ubicacion: u.nombre });
      return u;
    },

    async actualizarUbicacion(id, { nombre, tipo, comisionSocio, metaMensual, escalasComision, promotoraId }) {
      const u = db.get("ubicaciones").find({ id }).value();
      if (!u) return { error: "Ubicación no encontrada." };
      const cambios = {};
      if (nombre && nombre.trim()) cambios.nombre = nombre.trim();
      if (tipo) cambios.tipo = tipo;
      if (comisionSocio !== undefined) cambios.comisionSocio = Number(comisionSocio) || 0;
      if (metaMensual !== undefined) cambios.metaMensual = Number(metaMensual) || 0;
      if (Array.isArray(escalasComision)) cambios.escalasComision = escalasComision;
      // FIX (code-review 2026-07-03): sin esto, venderUno() nunca podía
      // resolver el promotor asignado a la percha en el servidor real —
      // el campo se aceptaba en el PUT del frontend pero jamás se guardaba.
      if (promotoraId !== undefined) cambios.promotoraId = promotoraId || null;
      db.get("ubicaciones").find({ id }).assign(cambios).write();
      return db.get("ubicaciones").find({ id }).value();
    },

    // Desactivar NO borra nada — ventas y movimientos históricos de esta
    // ubicación siguen intactos y siguen sumando en reportes que consulten
    // "todas". Solo deja de aparecer en el selector operativo y no admite
    // ventas nuevas (ver guard en venderUno/crearProducto más abajo).
    async setActivaUbicacion(id, activa) {
      const u = db.get("ubicaciones").find({ id }).value();
      if (!u) return { error: "Ubicación no encontrada." };
      db.get("ubicaciones").find({ id }).assign({ activa: !!activa }).write();
      registrarMovimiento(activa ? "ubicacion-reactivada" : "ubicacion-desactivada", { ubicacion: u.nombre });
      return db.get("ubicaciones").find({ id }).value();
    },

    async getProductos(ubicacionId) {
      let lista = db.get("productos").value();
      if (ubicacionId && ubicacionId !== "todas") lista = lista.filter((p) => p.ubicacionId === ubicacionId);
      return lista;
    },

    async getProducto(id) {
      return db.get("productos").find({ id }).value() || null;
    },

    async buscarPorCodigo(codigo) {
      const c = String(codigo).trim().toLowerCase();
      return (
        db
          .get("productos")
          .find((x) => String(x.barcode).toLowerCase() === c || String(x.sku).toLowerCase() === c)
          .value() || null
      );
    },

    // Crea un producto nuevo (solo modo demo/local — en modo Loyverse el
    // catálogo se gestiona en Loyverse mismo; ver nota en server.js). Se usa
    // cuando el dueño escanea un código que no existe y decide darlo de alta.
    async crearProducto(datos) {
      const ubic = datos.ubicacionId && datos.ubicacionId !== "todas" ? db.get("ubicaciones").find({ id: datos.ubicacionId }).value() : null;
      if (ubic && ubic.activa === false) return { error: `"${ubic.nombre}" está desactivada — reactívala en Avanzado antes de agregar productos ahí.` };
      const p = {
        id: randomUUID(),
        nombre: datos.nombre,
        categoria: datos.categoria || "General",
        sku: datos.sku || datos.barcode,
        barcode: datos.barcode,
        ubicacionId: datos.ubicacionId || "todas",
        precio: Number(datos.precio) || 0,
        costo: Number(datos.costo) || 0,
        // BUG FIJADO 2026-07-03: venderUno/ajustar/anularVenta SIEMPRE
        // impiden que el stock quede negativo, pero la creación no tenía
        // ese piso — un stockInicial negativo (typo o dato malo) corrompía
        // la valorización de inventario (precio*stockActual) desde el día 1.
        stockActual: Math.max(0, Number(datos.stockInicial) || 0),
        umbralRojo: Number(datos.umbralRojo) || 5,
        umbralAmarillo: Number(datos.umbralAmarillo) || 10,
        proveedor: datos.proveedor || "",
        perecible: !!datos.perecible,
        fechaCaducidad: datos.perecible ? datos.fechaCaducidad || null : null,
        metodoCosteo: datos.metodoCosteo === "LIFO" ? "LIFO" : "FIFO",
        lotes: [], // terreno listo para costeo por lotes (fase 2, ver db.js)
      };
      db.get("productos").push(p).write();
      registrarMovimiento("alta", { producto: p.nombre, sku: p.sku, ubicacion: nombreUbicacionLocal(p.ubicacionId) });
      return p;
    },

    // Edicion libre de la ficha (solo modo demo/local). Lista blanca de campos:
    // NADA de tocar stockActual por aca (eso va por /ajustar, que deja rastro).
    async actualizarProducto(id, campos) {
      const p = db.get("productos").find({ id }).value();
      if (!p) return null;
      const CAMPOS = ["nombre", "categoria", "precio", "costo", "proveedor", "foto", "barcode", "sku", "perecible", "fechaCaducidad", "metodoCosteo"];
      const cambios = {};
      CAMPOS.forEach((k) => { if (campos[k] !== undefined) cambios[k] = (k === "precio" || k === "costo") ? Number(campos[k]) || 0 : campos[k]; });
      db.get("productos").find({ id }).assign(cambios).write();
      const actualizado = db.get("productos").find({ id }).value();
      registrarMovimiento("edicion", { producto: actualizado.nombre, sku: actualizado.sku, ubicacion: nombreUbicacionLocal(actualizado.ubicacionId) });
      return actualizado;
    },

    async eliminarProducto(id) {
      const p = db.get("productos").find({ id }).value();
      if (!p) return { error: "Producto no encontrado." };
      // BUG FIJADO 2026-07-03: aprobarTransferencia() ya resta el stock del
      // origen en cuanto se aprueba (para no venderlo dos veces mientras
      // viaja) y solo lo suma al destino cuando alguien confirma recepción.
      // Sin este guard, borrar el producto origen O destino mientras una
      // transferencia sigue "en_transito" dejaba esas unidades restadas para
      // siempre, sin ningún producto que las reciba: stock perdido del
      // sistema sin dejar rastro ni forma de recuperarlo.
      const enTransito = db.get("transferencias").value()
        .find((t) => t.estado === "en_transito" && (t.productoOrigenId === id || t.productoDestinoId === id));
      if (enTransito) {
        return { error: `"${p.nombre}" tiene una transferencia en tránsito (${enTransito.cantidad} unidades). Espera a que se confirme o se resuelva antes de borrarlo.` };
      }
      db.get("productos").remove({ id }).write();
      registrarMovimiento("baja", { producto: p.nombre, sku: p.sku, ubicacion: nombreUbicacionLocal(p.ubicacionId) });
      return { ok: true };
    },

    async venderUno(id, cantidad, promotorId) {
      const p = db.get("productos").find({ id }).value();
      if (!p) return { error: "Producto no encontrado." };
      const ubic = db.get("ubicaciones").find({ id: p.ubicacionId }).value();
      if (ubic && ubic.activa === false) return { error: `"${ubic.nombre}" está desactivada — no admite ventas nuevas.` };
      if (p.stockActual < cantidad) return { error: `No hay suficiente stock disponible (quedan ${p.stockActual}).` };
      // BUG FIJADO 2026-07-03: sin promotorId explícito, la venta nunca miraba
      // si la percha (ubic) ya tiene un promotor asignado (ubic.promotoraId,
      // que la UI de Perchas sí permite configurar) — esa asignación se
      // guardaba pero jamás afectaba el cálculo de comisión de ninguna venta.
      // Fallback silencioso y no-bloqueante: si el promotor asignado ya no
      // existe o está desactivado, la venta sigue sin comisión (no se rompe).
      const promotorIdResuelto = promotorId || (ubic && ubic.promotoraId) || null;
      let promotor = null;
      if (promotorIdResuelto) {
        const candidato = db.get("promotores").find({ id: promotorIdResuelto }).value();
        if (promotorId) {
          // Promotor explícito por venta: sí exige que exista, esté activo,
          // y esté asignado a esta ubicación (comportamiento original).
          if (!candidato || candidato.activo === false) return { error: "Ese promotor no existe o está desactivado." };
          if (!(candidato.ubicacionesIds || []).includes(p.ubicacionId)) return { error: `"${candidato.nombre}" no está asignado a esta ubicación.` };
          promotor = candidato;
        } else if (candidato && candidato.activo !== false) {
          // Promotor resuelto por la percha: no bloquea la venta si falta.
          promotor = candidato;
        }
      }

      const ventaId = randomUUID();
      const montoBruto = p.precio * cantidad;
      // El split se calcula ANTES de escribir esta venta (para que el
      // acumulado del mes no se cuente a sí mismo dos veces) y se guarda
      // CONGELADO dentro de la venta — si luego cambian las escalas o la
      // meta, las ventas ya hechas no se recalculan con reglas nuevas.
      const acumuladoPrevio = ubic ? ventasMesAcumuladas(ubic.id) : 0;
      const split = calcularSplitVenta(ubic, montoBruto, acumuladoPrevio, promotor);
      db.get("productos").find({ id }).assign({ stockActual: p.stockActual - cantidad }).write();
      db.get("ventas")
        .push({ id: ventaId, productoId: p.id, ubicacionId: p.ubicacionId, cantidad, precioUnit: p.precio, costoUnit: p.costo, fecha: new Date().toISOString(), split, liquidada: false, liquidadaPromotor: false })
        .write();
      registrarMovimiento("venta", {
        producto: p.nombre,
        cantidad,
        total: Number(montoBruto.toFixed(2)),
        ubicacion: nombreUbicacionLocal(p.ubicacionId),
      });
      return { producto: db.get("productos").find({ id }).value(), ventaId };
    },

    async anularVenta(ventaId) {
      const venta = db.get("ventas").find({ id: ventaId }).value();
      if (!venta) return { error: "Esta venta ya no se puede anular (pasó el tiempo o ya se anuló)." };
      // BUG FIJADO 2026-07-03: la UI muestra un botón "anular" con cuenta
      // regresiva de 5s y lo hace desaparecer al vencer — pero el endpoint
      // aceptaba anular CUALQUIER venta pasada, sin importar la antigüedad.
      // Eso permitía borrar retroactivamente ventas ya liquidadas a un socio
      // o de días/meses atrás con solo conocer el ventaId. VENTANA_ANULACION_MS
      // da margen generoso sobre los 5s de la UI (latencia de red incluida)
      // sin bloquear jamás un clic legítimo.
      const VENTANA_ANULACION_MS = 30 * 1000;
      // FIX (code-review 2026-07-03): con fecha ausente/inválida (venta vieja
      // de un respaldo previo a este campo), new Date(undefined).getTime() da
      // NaN, y "NaN > 30000" es false — la venta quedaba anulable PARA
      // SIEMPRE, justo lo opuesto de lo que la ventana debía impedir. Number()
      // fuerza a NaN también del lado izquierdo cuando falta la fecha,
      // Number.isFinite() lo detecta y falla CERRADO (rechaza) en vez de abierto.
      const antiguedadMs = Date.now() - new Date(venta.fecha).getTime();
      if (!Number.isFinite(antiguedadMs) || antiguedadMs > VENTANA_ANULACION_MS) {
        return { error: "Esta venta ya no se puede anular (pasó el tiempo o ya se anuló)." };
      }
      const p = db.get("productos").find({ id: venta.productoId }).value();
      if (!p) return { error: "Producto no encontrado." };
      db.get("productos").find({ id: venta.productoId }).assign({ stockActual: p.stockActual + venta.cantidad }).write();
      db.get("ventas").remove({ id: ventaId }).write();
      registrarMovimiento("anulacion", {
        producto: p.nombre,
        cantidad: venta.cantidad,
        ubicacion: nombreUbicacionLocal(venta.ubicacionId),
      });
      return { producto: db.get("productos").find({ id: venta.productoId }).value() };
    },

    async ajustar(id, delta, motivo) {
      const p = db.get("productos").find({ id }).value();
      if (!p) return { error: "Producto no encontrado." };
      const nuevoStock = p.stockActual + delta;
      if (nuevoStock < 0) return { error: `Ese ajuste dejaría el stock en negativo (actual: ${p.stockActual}).` };

      db.get("productos").find({ id }).assign({ stockActual: nuevoStock }).write();
      registrarMovimiento("ajuste", {
        producto: p.nombre,
        delta,
        motivo,
        stockResultante: nuevoStock,
        ubicacion: nombreUbicacionLocal(p.ubicacionId),
      });
      return { producto: db.get("productos").find({ id }).value() };
    },

    async getVentasHoy(ubicacionId, fechaISO) {
      const ZONA = "America/Guayaquil";
      const esDeHoy = (fechaISOVenta) => {
        if (!fechaISOVenta) return false;
        const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(fechaISOVenta));
        return f === fechaISO;
      };
      return db
        .get("ventas")
        .value()
        .filter((v) => esDeHoy(v.fecha) && (!ubicacionId || ubicacionId === "todas" || v.ubicacionId === ubicacionId));
    },

    getActividad,
    getGastosMensuales,
    setGastosMensuales,
    getActivacion,
    activarInstancia,
    ventasCountMesGlobal,
    exportarTodo,
    importarTodo,
    getLiquidaciones,
    marcarLiquidado,
    getSugerenciasTransferencia,
    crearTransferencia,
    getTransferencias,
    aprobarTransferencia,
    confirmarRecepcionTransferencia,
    rechazarTransferencia,
    getPromotores,
    getPromotoresDeUbicacion,
    crearPromotor,
    actualizarPromotor,
    setActivoPromotor,
    getComisionesPromotores,
    marcarLiquidadoPromotor,
  };
}
