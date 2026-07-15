// server.js — Backend de AMIGABLE
// Capa visual/pedagógica sobre Loyverse (o datos de demo si no hay token).
// Stack: Express + data.js (adaptador Loyverse/demo). "npm install && npm start"
// y nada más para correr local o desplegar en Render/Railway/Fly/VPS.

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const path = require("path");
const data = require("./data");
const umbrales = require("./umbrales");
const { code128SVG } = require("./barcode");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// friendly-123 (USA): este server corre local, en el dispositivo del propio
// negocio (mismo modelo self-hosted que AMIGABLE) — se usa la zona horaria
// del SISTEMA OPERATIVO donde corre, en vez de fijar Ecuador. Como el
// dueño ejecuta esto en o cerca de su local, la zona del SO es la zona del
// negocio en la inmensa mayoría de los casos.
const ZONA = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

// ---------- Helpers de fecha ----------
function hoyISO() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date()); // en-CA -> YYYY-MM-DD
}

// Días reales del mes actual en la zona horaria de Guayaquil (28/29/30/31,
// no un fijo "30"). El prorrateo diario de gastos mensuales debe dividir
// entre lo que el mes realmente tiene — dividir siempre entre 30 subestima
// el gasto diario en enero/marzo/etc. (31 días) y lo sobrestima en febrero.
function diasEnMesActual() {
  const [anio, mes] = hoyISO().split("-").map(Number); // YYYY-MM-DD
  return new Date(anio, mes, 0).getDate(); // día 0 del mes siguiente = último día de este mes
}

// ---------- Helpers de negocio ----------
// Días entre hoy (Ecuador) y una fecha "YYYY-MM-DD". Negativo = ya venció.
function diasParaVencer(fechaCaducidad) {
  if (!fechaCaducidad) return null;
  const hoy = new Date(hoyISO() + "T00:00:00");
  const venc = new Date(fechaCaducidad + "T00:00:00");
  return Math.round((venc - hoy) / 86400000);
}

// El estado combina DOS señales independientes: nivel de stock (como antes)
// y, si el producto es perecible, cercanía al vencimiento. Se toma la más
// severa de las dos (un producto con stock sano pero por vencer sigue siendo
// una alerta real). El campo `dias` viaja en la respuesta para que la UI
// pueda mostrar "vence en 3 días" sin recalcular fechas en el navegador.
function calcularEstado(p) {
  const margen = p.precio > 0 ? (p.precio - p.costo) / p.precio : 0;
  const dias = p.perecible ? diasParaVencer(p.fechaCaducidad) : null;

  let porStock;
  if (p.stockActual <= 0) porStock = { estado: "rojo", mensaje: "Sin stock — repón cuanto antes" };
  else if (p.stockActual <= p.umbralRojo) porStock = { estado: "rojo", mensaje: `Quedan ${p.stockActual} — reponer urgente` };
  else if (p.stockActual <= p.umbralAmarillo) porStock = { estado: "amarillo", mensaje: `Quedan ${p.stockActual} — revisar pronto` };
  else if (margen >= 0.5) porStock = { estado: "azul", mensaje: "Buen margen — impúlsalo esta semana" };
  else porStock = { estado: "verde", mensaje: "Stock saludable" };

  if (dias == null) return { ...porStock, dias };

  let porVencimiento = null;
  if (dias < 0) porVencimiento = { estado: "rojo", mensaje: `Venció hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"} — retíralo` };
  else if (dias <= 3) porVencimiento = { estado: "rojo", mensaje: `Vence en ${dias} día${dias === 1 ? "" : "s"} — véndelo ya` };
  else if (dias <= 7) porVencimiento = { estado: "amarillo", mensaje: `Vence en ${dias} días — véndelo primero` };

  if (!porVencimiento) return { ...porStock, dias };
  const masGrave = ORDEN_ESTADO[porVencimiento.estado] <= ORDEN_ESTADO[porStock.estado] ? porVencimiento : porStock;
  return { ...masGrave, dias };
}

function toResumenInventario(p) {
  const { estado, mensaje, dias } = calcularEstado(p);
  return {
    id: p.id, nombre: p.nombre, categoria: p.categoria, sku: p.sku, stockActual: p.stockActual, estado, mensaje,
    perecible: !!p.perecible, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: dias,
  };
}

async function toFicha(p) {
  const { estado, mensaje, dias } = calcularEstado(p);
  return {
    id: p.id,
    nombre: p.nombre,
    precio: p.precio,
    sku: p.sku,
    barcode: p.barcode,
    proveedor: p.proveedor,
    stockActual: p.stockActual,
    estado,
    mensaje,
    categoria: p.categoria,
    ubicacionId: p.ubicacionId,
    ubicacionNombre: await data.nombreUbicacion(p.ubicacionId),
    perecible: !!p.perecible,
    fechaCaducidad: p.fechaCaducidad || null,
    diasParaVencer: dias,
    metodoCosteo: p.metodoCosteo || "FIFO",
    foto: p.foto || null,
  };
}

const ORDEN_ESTADO = { rojo: 0, amarillo: 1, azul: 2, verde: 3 };

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(502).json({ error: "No se pudo obtener datos de Loyverse. Verifica el token y vuelve a intentar." });
  });
}

// ====================== RUTAS ======================

app.get("/api/modo", (req, res) => {
  res.json({ modo: data.modo });
});

// --- Ubicaciones ---
// ?todas=1 incluye las desactivadas (para el panel de administración); sin
// ese parámetro, solo las activas (lo que usa el selector operativo normal).
app.get("/api/ubicaciones", asyncRoute(async (req, res) => {
  res.json(await data.getUbicaciones(req.query.todas !== "1"));
}));

app.post("/api/ubicaciones", asyncRoute(async (req, res) => {
  const r = await data.crearUbicacion(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));

app.put("/api/ubicaciones/:id", asyncRoute(async (req, res) => {
  const r = await data.actualizarUbicacion(req.params.id, req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));

app.post("/api/ubicaciones/:id/activar", asyncRoute(async (req, res) => {
  const r = await data.setActivaUbicacion(req.params.id, true);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));

app.post("/api/ubicaciones/:id/desactivar", asyncRoute(async (req, res) => {
  const r = await data.setActivaUbicacion(req.params.id, false);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));

// --- Dashboard (vista Hoy) ---
app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const { ubicacionId } = req.query;
  const productos = await data.getProductos(ubicacionId);
  const ventasHoy = await data.getVentasHoy(ubicacionId, hoyISO());

  const entra = ventasHoy.reduce((acc, v) => acc + v.precioUnit * v.cantidad, 0);
  const sale = ventasHoy.reduce((acc, v) => acc + v.costoUnit * v.cantidad, 0);
  const gananciaHoy = entra - sale;

  const inventarioValorizado = productos.reduce((acc, p) => acc + p.precio * p.stockActual, 0);

  const evaluados = productos.map((p) => ({ p, ...calcularEstado(p) }));
  const alertas = evaluados
    .filter((e) => e.estado === "rojo" || e.estado === "amarillo")
    .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado])
    .map((e) => ({ estado: e.estado, mensaje: `${e.p.nombre}: ${e.mensaje}` }));

  let semaforoGeneral = "verde";
  if (alertas.some((a) => a.estado === "rojo")) semaforoGeneral = "rojo";
  else if (alertas.some((a) => a.estado === "amarillo")) semaforoGeneral = "amarillo";

  res.json({
    semaforoGeneral,
    resumenDia: {
      entra: Number(entra.toFixed(2)),
      sale: Number(sale.toFixed(2)),
      gananciaHoy: Number(gananciaHoy.toFixed(2)),
      inventarioValorizado: Number(inventarioValorizado.toFixed(2)),
      ventasCount: ventasHoy.length,
    },
    alertas,
  });
}));

// --- Inventario ---
app.get("/api/productos", asyncRoute(async (req, res) => {
  const { ubicacionId, estado } = req.query;
  let productos = (await data.getProductos(ubicacionId)).map((p) => ({ p, resumen: toResumenInventario(p) }));

  if (estado) productos = productos.filter((x) => x.resumen.estado === estado);

  productos.sort((a, b) => {
    const diff = ORDEN_ESTADO[a.resumen.estado] - ORDEN_ESTADO[b.resumen.estado];
    if (diff !== 0) return diff;
    return a.resumen.nombre.localeCompare(b.resumen.nombre, "es");
  });

  res.json(productos.map((x) => x.resumen));
}));

app.get("/api/productos/:id", asyncRoute(async (req, res) => {
  const p = await data.getProducto(req.params.id);
  if (!p) return res.status(404).json({ error: "Producto no encontrado." });
  res.json(await toFicha(p));
}));

// --- Dar de alta un producto nuevo (típicamente tras escanear un código que
// no existía). En modo Loyverse, data.crearProducto devuelve un error
// explicando que el alta se hace en Loyverse — ver nota en data.js.
app.post("/api/productos", asyncRoute(async (req, res) => {
  const { nombre, barcode } = req.body;
  if (!nombre || !barcode) return res.status(400).json({ error: "Falta el nombre o el código de barras." });
  if (req.body.perecible && !req.body.fechaCaducidad) {
    return res.status(400).json({ error: "Si el producto expira, indica su fecha de caducidad." });
  }
  const r = await data.crearProducto(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(await toFicha(r));
}));

// --- Umbrales (puntos de reorden, editables por el propietario/admin) ---
// Edicion libre de la ficha (dueno): nombre, foto, precios, proveedor y codigo
// interno. El gating por rol vive en la UI (el empleado nunca ve Editar).
app.patch("/api/productos/:id", asyncRoute(async (req, res) => {
  const r = await data.actualizarProducto(req.params.id, req.body);
  if (r && r.error) return res.status(400).json({ error: r.error });
  if (!r) return res.status(404).json({ error: "Producto no encontrado." });
  res.json(await toFicha(r));
}));

// Borrado definitivo (dueno, con doble confirmacion en la UI).
app.delete("/api/productos/:id", asyncRoute(async (req, res) => {
  const r = await data.eliminarProducto(req.params.id);
  if (r && r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
}));

app.post("/api/productos/:id/umbrales", asyncRoute(async (req, res) => {
  const p = await data.getProducto(req.params.id);
  if (!p) return res.status(404).json({ error: "Producto no encontrado." });
  const variantId = p.variantId || p.id;
  umbrales.set(variantId, { umbralRojo: req.body.umbralRojo, umbralAmarillo: req.body.umbralAmarillo });
  res.json({ ok: true });
}));

// --- Escanear ---
app.post("/api/escanear", asyncRoute(async (req, res) => {
  const codigo = String(req.body.codigo || "").trim();
  if (!codigo) return res.status(400).json({ error: "Código vacío." });

  const p = await data.buscarPorCodigo(codigo);
  if (!p) return res.status(404).json({ error: "No se encontró ningún producto con ese código." });
  res.json(await toFicha(p));
}));

// --- Venta rápida ---
app.post("/api/productos/:id/venta", asyncRoute(async (req, res) => {
  const cantidad = Number.isInteger(req.body.cantidad) && req.body.cantidad > 0 ? req.body.cantidad : 1;
  // BUG FIJADO 2026-07-03: promotorId nunca se reenviaba a data.venderUno(),
  // que sí lo soporta (atribuye comisión). Resultado: en el servidor REAL
  // (no la demo estática) las comisiones a promotores quedaban en $0 siempre,
  // sin error visible. Ver también el fallback a ubic.promotoraId en data.js.
  const promotorId = req.body.promotorId || null;
  const r = await data.venderUno(req.params.id, cantidad, promotorId);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ producto: await toFicha(r.producto), ventaId: r.ventaId });
}));

// --- Anular venta reciente (tronco 2: "deshacer", ventana de 5s en la UI) ---
app.post("/api/ventas/:ventaId/anular", asyncRoute(async (req, res) => {
  const r = await data.anularVenta(req.params.ventaId);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ producto: await toFicha(r.producto) });
}));

// --- Ajuste manual de stock ---
app.post("/api/productos/:id/ajustar", asyncRoute(async (req, res) => {
  const delta = Number.isInteger(req.body.delta) ? req.body.delta : 0;
  const motivo = req.body.motivo || "Ajuste manual";
  const r = await data.ajustar(req.params.id, delta, motivo);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(await toFicha(r.producto));
}));

// --- Etiqueta con barcode + QR combinados (ver nota en Olimpo Control) ---
app.get("/api/productos/:id/etiqueta", asyncRoute(async (req, res) => {
  const p = await data.getProducto(req.params.id);
  if (!p) return res.status(404).json({ error: "Producto no encontrado." });

  try {
    const payload = JSON.stringify({ id: p.id, sku: p.sku, barcode: p.barcode });
    const qrDataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 320 });
    const barcodeSvg = code128SVG(p.barcode, { width: 300, height: 80 });
    res.json({ producto: await toFicha(p), qrDataUrl, barcodeSvg });
  } catch (err) {
    res.status(500).json({ error: "No se pudo generar la etiqueta (revisa que el código de barras use solo caracteres ASCII imprimibles)." });
  }
}));

// --- Actividad reciente (siempre local: acciones hechas desde AMIGABLE) ---
app.get("/api/actividad", (req, res) => {
  res.json(data.getActividad());
});

// --- Respaldo exportable/importable (ver nota de seguridad en Olimpo Control) ---
app.get("/api/respaldo/exportar", (req, res) => {
  res.json(data.exportarTodo());
});
app.post("/api/respaldo/importar", (req, res) => {
  const r = data.importarTodo(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

// --- Liquidaciones (brote 1: revenue sharing) ---
app.get("/api/liquidaciones", asyncRoute(async (req, res) => {
  res.json(await data.getLiquidaciones());
}));
app.post("/api/liquidaciones/:ubicacionId/marcar-pagado", asyncRoute(async (req, res) => {
  const r = await data.marcarLiquidado(req.params.ubicacionId);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));

// --- Transferencias (brote 2: inventario compartido) ---
app.get("/api/productos/:id/sugerencias-transferencia", asyncRoute(async (req, res) => {
  res.json(await data.getSugerenciasTransferencia(req.params.id));
}));
app.post("/api/transferencias", asyncRoute(async (req, res) => {
  const r = await data.crearTransferencia(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));
app.get("/api/transferencias", asyncRoute(async (req, res) => {
  res.json(await data.getTransferencias());
}));
app.post("/api/transferencias/:id/aprobar", asyncRoute(async (req, res) => {
  const r = await data.aprobarTransferencia(req.params.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));
app.post("/api/transferencias/:id/confirmar-recepcion", asyncRoute(async (req, res) => {
  const r = await data.confirmarRecepcionTransferencia(req.params.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));
app.post("/api/transferencias/:id/rechazar", asyncRoute(async (req, res) => {
  const r = await data.rechazarTransferencia(req.params.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
}));

// --- Configuración: gastos mensuales (siempre local, sin importar el modo) ---
app.get("/api/configuracion/gastos", (req, res) => {
  res.json(data.getGastosMensuales(req.query.ubicacionId));
});

app.post("/api/configuracion/gastos", asyncRoute(async (req, res) => {
  const { ubicacionId, gastosMensuales } = req.body;
  const monto = Number(gastosMensuales);

  if (!ubicacionId || ubicacionId === "todas") {
    return res.status(400).json({ error: "Elige una ubicación específica para guardar sus gastos mensuales." });
  }
  if (!Number.isFinite(monto) || monto < 0) {
    return res.status(400).json({ error: "El monto de gastos mensuales debe ser un número igual o mayor a 0." });
  }
  const ubicaciones = await data.getUbicaciones();
  if (!ubicaciones.find((u) => u.id === ubicacionId)) {
    return res.status(404).json({ error: "Ubicación no encontrada." });
  }

  data.setGastosMensuales(ubicacionId, monto);
  res.json({ ubicacionId, gastosMensuales: Number(monto.toFixed(2)) });
}));

// --- Reportes (modo avanzado) ---
// friendly-123 (USA): a diferencia de AMIGABLE (Ecuador, IVA 15% incluido en
// el precio), el sales tax de EEUU varía por estado/condado y NO viene
// incluido en el precio mostrado — se cobra aparte en el punto de venta y no
// es un valor que este P&L deba back-out del precio de lista. Por eso la
// tasa es 0: el precio de venta = ingreso neto, sin resta de impuesto
// embebido. Si en el futuro se necesita modelar sales tax por estado, este
// es el gancho — pero requiere un dato de configuración por ubicación, no
// una constante fija como el IVA ecuatoriano.
const SALES_TAX_RATE = 0;
app.get("/api/reportes/pl", asyncRoute(async (req, res) => {
  const { ubicacionId } = req.query;
  const ventasHoy = await data.getVentasHoy(ubicacionId, hoyISO());

  const ingresosConIva = ventasHoy.reduce((acc, v) => acc + v.precioUnit * v.cantidad, 0);
  const ingresosNetos = ingresosConIva / (1 + SALES_TAX_RATE);
  const ivaCobrado = ingresosConIva - ingresosNetos;
  const costoVentas = ventasHoy.reduce((acc, v) => acc + v.costoUnit * v.cantidad, 0);
  const utilidadBruta = ingresosNetos - costoVentas;

  const { gastosMensuales } = data.getGastosMensuales(ubicacionId);
  const gastosOperativos = Number((gastosMensuales / diasEnMesActual()).toFixed(2));
  const utilidadNeta = utilidadBruta - gastosOperativos;

  res.json({
    ingresosConIva: Number(ingresosConIva.toFixed(2)),
    ingresos: Number(ingresosNetos.toFixed(2)),
    ivaCobrado: Number(ivaCobrado.toFixed(2)),
    costoVentas: Number(costoVentas.toFixed(2)),
    utilidadBruta: Number(utilidadBruta.toFixed(2)),
    gastosOperativos,
    utilidadNeta: Number(utilidadNeta.toFixed(2)),
  });
}));

app.get("/api/reportes/balance", asyncRoute(async (req, res) => {
  const { ubicacionId } = req.query;
  const productos = await data.getProductos(ubicacionId);
  const ventasHoy = await data.getVentasHoy(ubicacionId, hoyISO());

  const efectivoEstimado = ventasHoy.reduce((acc, v) => acc + v.precioUnit * v.cantidad, 0);
  const inventarioValorizado = productos.reduce((acc, p) => acc + p.precio * p.stockActual, 0);

  res.json({
    activos: {
      efectivoEstimado: Number(efectivoEstimado.toFixed(2)),
      inventarioValorizado: Number(inventarioValorizado.toFixed(2)),
      total: Number((efectivoEstimado + inventarioValorizado).toFixed(2)),
    },
  });
}));

app.get("/api/reportes/valorizado", asyncRoute(async (req, res) => {
  const { ubicacionId } = req.query;
  const productos = await data.getProductos(ubicacionId);

  const filas = productos.map((p) => {
    const valorCosto = p.costo * p.stockActual;
    const valorVenta = p.precio * p.stockActual;
    return {
      nombre: p.nombre,
      stockActual: p.stockActual,
      valorCosto: Number(valorCosto.toFixed(2)),
      valorVenta: Number(valorVenta.toFixed(2)),
      utilidadPotencial: Number((valorVenta - valorCosto).toFixed(2)),
    };
  });

  const totales = filas.reduce(
    (acc, f) => ({
      valorCosto: acc.valorCosto + f.valorCosto,
      valorVenta: acc.valorVenta + f.valorVenta,
      utilidadPotencial: acc.utilidadPotencial + f.utilidadPotencial,
    }),
    { valorCosto: 0, valorVenta: 0, utilidadPotencial: 0 }
  );

  res.json({
    productos: filas,
    totales: {
      valorCosto: Number(totales.valorCosto.toFixed(2)),
      valorVenta: Number(totales.valorVenta.toFixed(2)),
      utilidadPotencial: Number(totales.utilidadPotencial.toFixed(2)),
    },
  });
}));

// --- Fallback: cualquier ruta no-API sirve el frontend ---
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AMIGABLE escuchando en http://localhost:${PORT} — modo: ${data.modo}`);
});
