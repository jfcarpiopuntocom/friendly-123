/* FLECHA DE COMISION (JFC 2026-10-14, pedido de Belen/idiomARTE). Quien le paga a quien:
   - casaPaga (default, todo lo viejo): la casa cobro y le debe al asociado su parte -> gasto.
   - asociadoPaga: el asociado cobro y le debe a la casa su parte -> ingreso de la casa.
   Decisiones de JFC: se elige en el producto, se puede cambiar en la venta, el switch de
   Summary by Product corrige TODAS las ventas del producto (tambien pasadas); una venta ya
   pagada no se esconde: queda para revisar. Still to pay se queda: dice quien le debe a quien.
   Rojo contra backups/2026-10-14_flecha-comision (sin campo, sin ruta, ledger cobra a la casa). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const L = require('../docs/core/payout-ledger.js');

async function tienda(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const ana = await app.request('/api/promotoras', 'POST', { nombre:'Flecha Ana', comisionBase:50 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre:'Flecha Rack', tipo:'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId:ana.id });
  const prod = await app.request('/api/productos', 'POST', { nombre:'Flecha Taller', sku:'FL-1', barcode:'FL-1', precio:100, costo:0, stockInicial:20, ubicacionId:rack.id });
  return { ana, rack, prod };
}
const ventasDe = async (app, pid) => (await app.request('/api/ventas/todas')).filter(v => v.productoId === pid);

test('ledger: a sale where the associate collected owes nothing from the house', () => {
  const loc = [{ id:'r1', promotoraId:'ana' }];
  const v = (id, extra) => Object.assign({ id, fecha:'2026-10-10T12:00:00Z', ubicacionId:'r1', split:{ montoComisionSocio:50, montoNetoDueno:50 } }, extra || {});
  const casa = L.buildObligations({ sales:[v('a')], locations:loc, payouts:[] });
  assert.equal(casa.reduce((s, o) => s + o.dueCents, 0), 5000);
  const asoc = L.buildObligations({ sales:[v('b', { direccionComision:'asociadoPaga' })], locations:loc, payouts:[] });
  assert.equal(asoc.reduce((s, o) => s + o.dueCents, 0), 0);
  /* Ya pagada en la direccion vieja: el pago no se esconde; queda marcada para revisar. */
  const pagada = L.buildObligations({ sales:[v('c', { direccionComision:'asociadoPaga', liquidada:true })], locations:loc, payouts:[] });
  assert.equal(pagada.length, 1);
  assert.equal(pagada[0].paidCents, 5000);
  assert.equal(pagada[0].directionReview, true);
});

test('product direction is stamped on the sale; old sales stay house pays', async () => {
  const app = browser(); const s = await tienda(app);
  await app.request(`/api/productos/${s.prod.id}/venta`, 'POST', { cantidad:1 });
  let vs = await ventasDe(app, s.prod.id);
  assert.equal(vs[0].direccionComision, 'casaPaga');
  await app.request(`/api/productos/${s.prod.id}`, 'PATCH', { direccionComision:'asociadoPaga' });
  const p = (await app.request('/api/productos')).find(x => x.id === s.prod.id);
  assert.equal(p.direccionComision, 'asociadoPaga');
  await app.request(`/api/productos/${s.prod.id}/venta`, 'POST', { cantidad:1 });
  await app.request(`/api/productos/${s.prod.id}/venta`, 'POST', { cantidad:1, direccionComision:'casaPaga' });
  vs = await ventasDe(app, s.prod.id);
  const dirs = vs.map(v => v.direccionComision).sort();
  assert.deepEqual(dirs, ['asociadoPaga', 'casaPaga', 'casaPaga']);
  /* Solo la venta de la casa genera deuda de la casa: 50 de 3 ventas de 100 al 50%. */
  const liq = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq.stillDue, 100);
});

test('switch from Summary by Product fixes every sale of the product, flags paid ones', async () => {
  const app = browser(); const s = await tienda(app);
  await app.request(`/api/productos/${s.prod.id}/venta`, 'POST', { cantidad:1 });
  await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', { payeeId:s.ana.id, medioPago:'efectivo', opId:'flecha-pay-1' });
  await app.request(`/api/productos/${s.prod.id}/venta`, 'POST', { cantidad:2 });
  const r = await app.request(`/api/productos/${s.prod.id}/direccion-comision`, 'PATCH', { direccion:'asociadoPaga', quien:'test' });
  assert.equal(r.ok, true);
  assert.equal(r.cambiadas, 2);
  assert.equal(r.pagadasARevisar, 1);
  const vs = await ventasDe(app, s.prod.id);
  assert.ok(vs.every(v => v.direccionComision === 'asociadoPaga'));
  const liq = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq.stillDue, 0);
  /* Volver atras restaura la deuda de la casa por la venta sin pagar. */
  await app.request(`/api/productos/${s.prod.id}/direccion-comision`, 'PATCH', { direccion:'casaPaga', quien:'test' });
  const liq2 = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq2.stillDue, 100);
});

test('invalid direction is refused, never guessed', async () => {
  const app = browser(); const s = await tienda(app);
  const r = await app.request(`/api/productos/${s.prod.id}/direccion-comision`, 'PATCH', { direccion:'otra' }).catch(e => ({ error:String(e && e.message || e) }));
  assert.ok(r.error);
});
