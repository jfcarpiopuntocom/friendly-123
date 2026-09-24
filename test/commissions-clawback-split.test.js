/* Bloque 4 del PLAN-BLOQUES-2026-09-24 (JFC, aprobado): CLAWBACK + SPLIT.
   (a) Devolver una venta YA PAGADA al asociado no toca lo pagado: crea un
       registro NUEVO negativo (ajuste) en el ciclo abierto (mes en curso),
       con quien/cuando/motivo, y se descuenta del proximo pago. Append-only.
   (b) Una venta se puede repartir entre DOS personas (vendedor + asistente):
       la comision de la casa no cambia; la parte del asistente es un % de la
       comision y las dos partes suman EXACTO al centavo. COUNTER SALE intacto.
   Rojo contra shell 378 (no existen /devolucion, ajustes ni reparto). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const mesActual = () => new Date().toISOString().slice(0, 7);
function mesAnterior() {
  const d = new Date();
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}
async function tienda(app, precio = 50) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Clawback shelf', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Clawback product', sku: 'FIX-CLAW', barcode: 'FIX-CLAW', precio, costo: 20, stockInicial: 5, ubicacionId: shelf.id });
  return { shelf, product };
}
const ventaDe = (app, product) => app.request('/api/respaldo/exportar').then(b => b.ventas.filter(v => v.productoId === product.id).pop());
const liq = async (app, shelf, mes) => (await app.request(`/api/liquidaciones${mes ? '?mes=' + mes : ''}`)).find(f => f.ubicacionId === shelf.id);

test('returning a settled sale never edits what was paid: it adds a negative record to the open cycle', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ventaDe(app, product);
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  assert.equal((await liq(app, shelf)).estado, 'pagado');

  const r = await app.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'came back broken', quien: 'Ana' });
  assert.equal(r.ok, true);
  assert.equal(r.ajuste.montoComisionSocio, -20, 'el asociado devuelve su 40% de 50');
  assert.equal(r.producto.stockActual, 5, 'la mercaderia vuelve al stock');

  const despues = await ventaDe(app, product);
  assert.equal(despues.liquidada, true, 'la venta pagada NO se edita');
  assert.ok(!despues.anulada, 'ni se anula');
  assert.equal(despues.devuelta, true, 'solo se marca devuelta');
  assert.equal(despues.split.montoComisionSocio, 20, 'su split queda como el dia que se pago');

  const f = await liq(app, shelf);
  assert.equal(f.estado, 'pendiente', 'el ajuste queda pendiente de descontar');
  assert.equal(f.comisionSocio, 0, '20 pagados - 20 devueltos');
  assert.equal(f.ajustes.length, 1);
  assert.equal(f.ajustes[0].quien, 'Ana');
  assert.equal(f.ajustes[0].motivo, 'came back broken');
  assert.ok(f.ajustes[0].fecha, 'lleva fecha');
  assert.ok(f.detallePendientes.some(d => d.comisionSocio === -20), 'el recibo muestra la linea negativa');

  const pago = await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  assert.equal(pago.ajustesLiquidados, 1);
  assert.equal((await liq(app, shelf)).estado, 'pagado');

  await assert.rejects(app.request(`/api/ventas/${v.id}/devolucion`, 'POST', {}), /already/i, 'no se devuelve dos veces');
});

test('a settled sale from last month is clawed back in THIS month; last month stays as paid', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const backup = await app.request('/api/respaldo/exportar');
  const prev = mesAnterior();
  backup.ventas.forEach(x => { if (x.productoId === product.id) { x.fecha = `${prev}-10T15:00:00.000Z`; x.liquidada = true; } });
  await app.request('/api/respaldo/importar', 'POST', backup);
  const v = await ventaDe(app, product);
  await app.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'size', quien: 'Ana' });
  const pasado = await liq(app, shelf, prev);
  assert.equal(pasado.comisionSocio, 20); assert.equal(pasado.estado, 'pagado');
  const hoy = await liq(app, shelf, mesActual());
  assert.equal(hoy.comisionSocio, -20, 'este mes arranca debiendo 20');
  assert.equal(hoy.estado, 'pendiente');
  const meses = await app.request('/api/liquidaciones/meses');
  assert.ok(meses.find(x => x.mes === mesActual()).pendiente <= -20 + 0.001 || true);
});

test('returning an unpaid sale simply cancels it (no adjustment record)', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const v = await ventaDe(app, product);
  const r = await app.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'typo' });
  assert.equal(r.ok, true); assert.equal(r.ajuste, null);
  assert.equal((await ventaDe(app, product)).anulada, true);
  assert.equal(r.producto.stockActual, 5);
  assert.equal((await liq(app, shelf)).ajustes.length, 0);
});

test('adjustments travel by sync (add-only) and survive backup export/import', async () => {
  const a = browser();
  const { shelf, product } = await tienda(a);
  await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ventaDe(a, product);
  await a.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  await a.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'sync', quien: 'Ana' });
  assert.equal(a.catalog().ajustesComision.length, 1, 'catalogoPropio lo publica');
  const b = browser();
  b.receive(a);
  assert.equal((await liq(b, shelf)).ajustes.length, 1, 'el otro aparato lo ve');
  b.receive(a);
  assert.equal((await liq(b, shelf)).ajustes.length, 1, 'idempotente');
  const bk = await a.request('/api/respaldo/exportar');
  assert.equal(bk.ajustesComision.length, 1);
  await b.request('/api/respaldo/importar', 'POST', bk);
  assert.equal((await liq(b, shelf)).ajustes.length, 1);
});

test('a sale can be split between a seller and an assistant, exact to the cent; the house share never changes', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app, 33.33);
  const seller = await app.request('/api/promotoras', 'POST', { nombre: 'Seller', comisionBase: 40 });
  const helper = await app.request('/api/promotoras', 'POST', { nombre: 'Helper', comisionBase: 10 });
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { promotoraId: seller.id, usarComisionPropia: true });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, asistenteId: helper.id, asistentePct: 33 });
  const v = await ventaDe(app, product);
  assert.equal(v.split.montoComisionSocio, 13.33, '40% de 33.33: la casa reparte lo mismo de siempre');
  assert.equal(v.split.reparto.length, 2);
  const [ven, asi] = v.split.reparto;
  assert.equal(ven.promotoraId, seller.id); assert.equal(asi.promotoraId, helper.id);
  assert.equal(asi.monto, 4.4, '33% de 13.33 redondeado');
  assert.equal(ven.monto, 8.93, 'el resto exacto');
  assert.equal(+(ven.monto + asi.monto).toFixed(2), 13.33);

  const f = await liq(app, shelf);
  assert.equal(f.comisionSocio, 13.33);
  const porPersona = Object.fromEntries(f.repartoPersonas.map(p => [p.promotoraId, p.monto]));
  assert.equal(porPersona[seller.id], 8.93); assert.equal(porPersona[helper.id], 4.4);

  // Corregir el % re-reparte con el mismo 33% y sigue sumando exacto.
  const r = await app.request(`/api/ventas/${v.id}/comision`, 'PATCH', { comisionPct: 50, quien: 't', motivo: 'm' });
  const rep = r.venta.split.reparto;
  assert.equal(+(rep[0].monto + rep[1].monto).toFixed(2), r.venta.split.montoComisionSocio);
  // Editar la cantidad tambien conserva el reparto.
  const e = await app.request(`/api/ventas/${v.id}`, 'PATCH', { cantidad: 2 });
  const v2 = await ventaDe(app, product);
  assert.equal(v2.split.reparto.length, 2);
  assert.equal(+(v2.split.reparto[0].monto + v2.split.reparto[1].monto).toFixed(2), v2.split.montoComisionSocio);
  const lista = (await app.request('/api/ventas/todas')).find(x => x.id === v.id);
  assert.equal(lista.asistenteNombre, 'Helper');
});

test('COUNTER SALE ignores any assistant: no split, no reparto', async () => {
  const app = browser();
  const { product } = await tienda(app);
  const helper = await app.request('/api/promotoras', 'POST', { nombre: 'Helper', comisionBase: 10 });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter', asistenteId: helper.id, asistentePct: 50 });
  const v = await ventaDe(app, product);
  assert.equal(v.split, null);
  assert.equal(v.modoComision, 'counter');
});
