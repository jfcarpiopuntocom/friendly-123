// Corrida Hugo / Paco / Luis sobre Sold y Commissions (JFC 2026-09-24).
// Prioridad de JFC: que CUADRE el inventario y el dinero entre pantallas antes
// que cualquier feature. Cada persona hace la misma clase de trabajo a su
// manera y al final test/helpers/cuadre.cjs cruza Sold, Today, P&L,
// Commissions e inventario. Los casos B1..B6 son bugs hallados en esta corrida
// (rojo en shell v395); "FIJACION" marca comportamiento que ya era correcto.
//
// Vocabulario (JFC): COMMISSIONIST = quien vende / embajador (gana comision).
// CONSIGNOR (la artista con stock en consignacion) = duena de las piezas.
// En la app los dos viven hoy en la misma ficha ("promotoras"); aqui se usan
// los dos papeles por separado a proposito.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const { cuadre } = require('./helpers/cuadre.cjs');

async function tienda() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const vendedora = await w.request('/api/promotoras', 'POST', { nombre: 'Belen commissionist', comisionBase: 30 });
  const asistente = await w.request('/api/promotoras', 'POST', { nombre: 'Asistente', comisionBase: 10 });
  const consignadora = await w.request('/api/promotoras', 'POST', { nombre: 'Ana consignor', comisionBase: 85 });
  const rackV = await w.request('/api/ubicaciones', 'POST', { nombre: 'Rack Belen', tipo: 'socio' });
  const rackC = await w.request('/api/ubicaciones', 'POST', { nombre: 'Rack Ana', tipo: 'consignacion' });
  await w.request(`/api/ubicaciones/${rackV.id}`, 'PUT', { promotoraId: vendedora.id });
  await w.request(`/api/ubicaciones/${rackC.id}`, 'PUT', { promotoraId: consignadora.id });
  const alta = (nombre, ubic, precio, costo, stock) => w.request('/api/productos', 'POST', { nombre, barcode: 'CQ-' + nombre.replace(/\W/g, ''), precio, costo, stockInicial: stock, ubicacionId: ubic, umbralRojo: 1, umbralAmarillo: 2 });
  const libro = await alta('Libro', rackV.id, 20, 8, 10);
  const taza = await alta('Taza', rackV.id, 12.5, 4, 6);
  const cuadro = await alta('Cuadro', rackC.id, 150, 0, 3);
  const unico = await alta('Pieza unica', rackC.id, 90, 0, 1);
  const stock = { [libro.id]: 10, [taza.id]: 6, [cuadro.id]: 3, [unico.id]: 1 };
  // Vende y lleva la cuenta del stock SOLO si la venta se acepto.
  const vender = async (p, body = {}) => {
    const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, ...body });
    stock[p.id] -= Number(body.cantidad || 1);
    return r.ventaId;
  };
  const intentar = async (fn) => { try { await fn(); return true; } catch (_) { return false; } };
  const venta = async (id) => (await w.request('/api/ventas/todas')).find((v) => v.id === id);
  const sinDescuadre = async (quien) => assert.deepEqual(await cuadre(w, { stockEsperado: stock }), [], quien + ': descuadre');
  return { w, vendedora, asistente, consignadora, rackV, rackC, libro, taza, cuadro, unico, stock, vender, intentar, venta, sinDescuadre };
}

test('Paco: ventas simples, pago del mes; todo cuadra (FIJACION)', async () => {
  const t = await tienda();
  await t.vender(t.libro); await t.vender(t.libro, { cantidad: 2 }); await t.vender(t.cuadro);
  await t.sinDescuadre('Paco antes de pagar');
  await t.w.request(`/api/liquidaciones/${t.rackV.id}/marcar-pagado`, 'POST', { medioPago: 'efectivo' });
  await t.sinDescuadre('Paco despues de pagar');
  const l = (await t.w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.rackV.id);
  assert.equal(l.ventasBrutas, 60); assert.equal(l.comisionSocio, 18); assert.equal(l.estado, 'pagado');
});

test('Hugo: override, counter, cortesia, asistente, cantidad; todo cuadra (FIJACION)', async () => {
  const t = await tienda();
  await t.vender(t.libro, { cantidad: 3 });
  await t.vender(t.libro, { info: { precioOverride: 7.5 } });
  await t.vender(t.taza, { modoComision: 'counter' });
  await t.vender(t.taza, { info: { cortesia: true } });
  const conAsis = await t.vender(t.cuadro, { asistenteId: t.asistente.id, asistentePct: 40 });
  const v = await t.venta(conAsis);
  assert.equal(v.comisionAsociado, 127.5);
  await t.sinDescuadre('Hugo');
});

test('B1 Luis: una venta rechazada (cliente inexistente o despedido) NO baja el stock', async () => {
  const t = await tienda();
  assert.equal(await t.intentar(() => t.w.request(`/api/productos/${t.libro.id}/venta`, 'POST', { cantidad: 2, clienteId: 'no-existe' })), false);
  const c = await t.w.request('/api/clientes', 'POST', { nombre: 'Despedido' });
  await t.w.request(`/api/clientes/${c.id}/despedir`, 'POST', {});
  await t.intentar(() => t.w.request(`/api/productos/${t.libro.id}/venta`, 'POST', { cantidad: 1, clienteId: c.id }));
  await t.sinDescuadre('Luis cliente malo');
});

test('B1b Luis: cantidades absurdas y sin stock no tocan nada', async () => {
  const t = await tienda();
  for (const cantidad of [0, -1, 2.5, 'abc', 99]) {
    assert.equal(await t.intentar(() => t.w.request(`/api/productos/${t.taza.id}/venta`, 'POST', { cantidad })), false, String(cantidad));
  }
  await t.vender(t.unico);
  assert.equal(await t.intentar(() => t.w.request(`/api/productos/${t.unico.id}/venta`, 'POST', { cantidad: 1 })), false, 'no hay segunda pieza unica');
  await t.sinDescuadre('Luis cantidades');
});

test('B2 Luis: una edicion de venta rechazada no deja cambios a medias', async () => {
  const t = await tienda();
  const id = await t.vender(t.libro);
  const antes = await t.venta(id);
  assert.equal(await t.intentar(() => t.w.request(`/api/ventas/${id}`, 'PATCH', { cantidad: 3, precioUnit: -5 })), false);
  assert.equal(await t.intentar(() => t.w.request(`/api/ventas/${id}`, 'PATCH', { cantidad: 3, clienteId: 'no-existe' })), false);
  const despues = await t.venta(id);
  assert.equal(despues.cantidad, antes.cantidad);
  assert.equal(despues.comisionAsociado, antes.comisionAsociado);
  await t.sinDescuadre('Luis edicion rechazada');
});

test('B3 Hugo: editar una venta vieja NO aplica el % nuevo de la percha', async () => {
  const t = await tienda();
  const id = await t.vender(t.libro); // 30 % de 20 = 6
  await t.w.request(`/api/promotoras/${t.vendedora.id}`, 'PUT', { comisionBase: 50 });
  await t.w.request(`/api/ventas/${id}`, 'PATCH', { cantidad: 2 }); t.stock[t.libro.id] -= 1;
  const v = await t.venta(id);
  assert.equal(v.comisionAsociado, 12, 'sigue al 30 % sellado el dia de la venta');
  await t.w.request(`/api/ventas/${id}`, 'PATCH', { precioUnit: 25 });
  assert.equal((await t.venta(id)).comisionAsociado, 15);
  await t.sinDescuadre('Hugo edicion');
});

test('B4 Hugo: una venta ya pagada al asociado no se puede anular', async () => {
  const t = await tienda();
  const id = await t.vender(t.libro);
  await t.w.request(`/api/liquidaciones/${t.rackV.id}/marcar-pagado`, 'POST', {});
  assert.equal(await t.intentar(() => t.w.request(`/api/ventas/${id}/anular`, 'POST', {})), false);
  await t.sinDescuadre('Hugo anular pagada');
});

test('B5 Paco: pagar la percha no sella las COUNTER SALES (no hay a quien pagarle)', async () => {
  const t = await tienda();
  await t.vender(t.libro);
  const counter = await t.vender(t.taza, { modoComision: 'counter' });
  await t.w.request(`/api/liquidaciones/${t.rackV.id}/marcar-pagado`, 'POST', {});
  assert.equal((await t.venta(counter)).liquidada, false);
  await t.w.request(`/api/ventas/${counter}/cancelar`, 'POST', { motivo: 'error' }); t.stock[t.taza.id] += 1;
  await t.sinDescuadre('Paco counter tras pago');
});

test('B6 Hugo: devolucion de una venta pagada: vuelve el stock Y sale del ingreso', async () => {
  const t = await tienda();
  const entra0 = (await t.w.request('/api/dashboard')).resumenDia.entra;
  const pl0 = (await t.w.request('/api/reportes/pl')).ingresos;
  const id = await t.vender(t.cuadro); // 150, comision 127.5 al consignador
  await t.w.request(`/api/liquidaciones/${t.rackC.id}/marcar-pagado`, 'POST', {});
  await t.w.request(`/api/ventas/${id}/devolucion`, 'POST', { motivo: 'danado', quien: 'Hugo' }); t.stock[t.cuadro.id] += 1;
  assert.equal(await t.intentar(() => t.w.request(`/api/ventas/${id}/devolucion`, 'POST', {})), false, 'no se devuelve dos veces');
  const dash = await t.w.request('/api/dashboard');
  const pl = await t.w.request('/api/reportes/pl');
  assert.equal(dash.resumenDia.entra, entra0, 'Today no cuenta como ingreso una pieza que volvio');
  assert.equal(pl.ingresos, pl0, 'P&L tampoco');
  const l = (await t.w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.rackC.id);
  assert.equal(l.comisionSocio, 0, 'Commissions: +127.5 pagado y -127.5 a descontar');
  await t.sinDescuadre('Hugo devolucion');
});

// ---- Cierre (JFC 2026-09-24): "todo debe cuadrar, nada debe quedar fuera de vista" ----
const cent = (n) => Math.round((Number(n) || 0) * 100);

test('C1 Belen: la tarjeta de la percha muestra las COUNTER SALES y su total real = Sold', async () => {
  const t = await tienda();
  await t.vender(t.libro, { cantidad: 2 });
  await t.vender(t.taza, { modoComision: 'counter' });
  await t.vender(t.taza, { modoComision: 'counter', cantidad: 2 });
  const l = (await t.w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.rackV.id);
  assert.deepEqual(l.ventasCasa, { monto: 37.5, ventas: 2 });
  assert.equal(l.ventasBrutas, 40);
  assert.equal(l.totalPercha, 77.5);
  const sold = (await t.w.request('/api/ventas/todas')).filter((v) => v.ubicacionId === t.rackV.id && v.mes === l.mes);
  assert.equal(cent(l.totalPercha), sold.reduce((a, v) => a + cent(v.precioUnit * v.cantidad), 0));
  await t.sinDescuadre('Belen');
});

test('C2 cuadre del mes: los cubos suman el total de Sold al centavo y "por pagar" incluye devoluciones', async () => {
  const t = await tienda();
  await t.vender(t.libro, { cantidad: 3 });
  await t.vender(t.taza, { modoComision: 'counter' });
  const id = await t.vender(t.cuadro);
  await t.w.request(`/api/liquidaciones/${t.rackC.id}/marcar-pagado`, 'POST', {});
  await t.w.request(`/api/ventas/${id}/devolucion`, 'POST', { motivo: 'x' }); t.stock[t.cuadro.id] += 1;
  const c = await t.w.request('/api/comisiones/cuadre');
  const sold = (await t.w.request('/api/ventas/todas')).filter((v) => v.mes === c.mes);
  const cubos = ['conComision', 'casaCompartida', 'perchasPropias', 'sinTrato'];
  assert.equal(cubos.reduce((a, k) => a + cent(c[k].monto), 0), cent(c.totalVentas), 'los cubos suman el total');
  assert.equal(cent(c.totalVentas), sold.reduce((a, v) => a + cent(v.precioUnit * v.cantidad), 0), 'total = Sold del mes');
  assert.equal(cubos.reduce((a, k) => a + c[k].ventas, 0), sold.length);
  assert.equal(c.devoluciones.monto, -150);
  assert.equal(cent(c.netoDelMes), cent(c.totalVentas) - 15000);
  const liq = await t.w.request('/api/liquidaciones');
  const pendTarjetas = liq.reduce((a, l) => a + (l.detallePendientes || []).reduce((b, d) => b + cent(d.comisionSocio), 0), 0);
  assert.equal(cent(c.porPagar), pendTarjetas, 'por pagar arriba = suma de lo pendiente en las tarjetas');
  await t.sinDescuadre('cuadre del mes');
});

test('C3 aporte fijo: la tarjeta dice lo que de verdad se desconto en el mes (se aplica por venta)', async () => {
  const t = await tienda();
  await t.w.request(`/api/ubicaciones/${t.rackC.id}`, 'PUT', { contribFija: 10 });
  await t.vender(t.cuadro); await t.vender(t.cuadro);
  const l = (await t.w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.rackC.id);
  assert.equal(l.contribFija, 10, 'valor configurado');
  assert.equal(l.contribFijaMes, 20, 'descontado de verdad: 2 ventas x 10');
  const c = await t.w.request('/api/comisiones/cuadre');
  assert.equal(c.contribFijaDescontada, 20);
});

test('C4 balance: activo = inventario PROPIO a COSTO; lo consignado queda aparte, a la vista', async () => {
  const t = await tienda();
  const b = await t.w.request('/api/reportes/balance');
  const ps = await t.w.request('/api/productos');
  const racks = await t.w.request('/api/ubicaciones');
  const consig = (p) => p.tipoProveedor === 'consignacion' || (racks.find((u) => u.id === p.ubicacionId) || {}).tipo === 'consignacion';
  assert.equal(cent(b.activos.inventarioValorizado), ps.filter((p) => !consig(p)).reduce((a, p) => a + cent((p.costo || 0) * p.stockActual), 0));
  assert.equal(cent(b.memo.consignacionPrecioVenta), ps.filter(consig).reduce((a, p) => a + cent(p.precio * p.stockActual), 0));
  assert.ok(b.memo.consignacionPrecioVenta >= 450 + 90, 'las piezas de Ana (consignadora) no son activo de la tienda');
  assert.equal(b.memo.criterioInventario, 'costo');
});
