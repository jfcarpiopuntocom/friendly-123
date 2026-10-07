/* v458 HOTFIX — regression exacta reportada por JFC:
   editar la Base commission de una persona (99% -> 33%) debe cambiar de inmediato
   lo que AUN se le debe, sin reescribir hechos de venta ni tocar contratos que no
   dependan de esa base. Datos sinteticos; sin red. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const LIC = 'F123-TEST-0000-0000-00000';
const mesActual = () => new Date().toISOString().slice(0, 7);

function appReal() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: LIC, nombreNegocio: 'Negocio Sintetico' }));
  return w;
}
async function ventaRaw(w, id) {
  const e = await w.request('/api/respaldo/exportar');
  return e.ventas.find((v) => v.id === id);
}
async function crearBase(w, pct = 99, extraRack = {}) {
  const pr = await w.request('/api/promotoras', 'POST', { nombre: 'JF Sintetico', comisionBase: pct });
  const rack = await w.request('/api/ubicaciones', 'POST', Object.assign({ nombre: 'Percha JF', tipo: 'socio', comisionSocio: 12 }, extraRack));
  await w.request('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: pr.id, ...(extraRack.usarComisionPropia !== undefined ? { usarComisionPropia: extraRack.usarComisionPropia } : {}) });
  return { pr, rack };
}
async function crearProducto(w, rack, suffix, extra = {}) {
  return w.request('/api/productos', 'POST', Object.assign({
    nombre: 'Producto ' + suffix, sku: 'V458-' + suffix, barcode: 'V458-' + suffix,
    precio: 100, costo: 20, stockInicial: 20, ubicacionId: rack.id
  }, extra));
}
async function vender(w, p) {
  const r = await w.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  return r.ventaId;
}

test('v458: 99% -> 33% on the person updates unpaid due immediately and preserves the sale facts', async () => {
  const w = appReal();
  const { pr, rack } = await crearBase(w, 99);
  const p = await crearProducto(w, rack, 'BASE');
  const id = await vender(w, p);

  const antes = await ventaRaw(w, id);
  assert.equal(antes.split.origenComision, 'comisionista');
  assert.equal(antes.split.comisionPct, 99);
  assert.equal(antes.split.montoComisionSocio, 99);
  const hechos = { id: antes.id, productoId: antes.productoId, ubicacionId: antes.ubicacionId, cantidad: antes.cantidad, precioUnit: antes.precioUnit, costoUnit: antes.costoUnit, fecha: antes.fecha };

  const c0 = await w.request('/api/comisiones/cuadre?mes=' + mesActual());
  assert.equal(c0.comisionAsociados, 99);
  assert.equal(c0.porPagar, 99);

  await w.request('/api/promotoras/' + pr.id, 'PUT', { comisionBase: 33 });

  const despues = await ventaRaw(w, id);
  assert.equal(despues.split.comisionPct, 33);
  assert.equal(despues.split.montoComisionSocio, 33);
  assert.deepEqual(
    { id: despues.id, productoId: despues.productoId, ubicacionId: despues.ubicacionId, cantidad: despues.cantidad, precioUnit: despues.precioUnit, costoUnit: despues.costoUnit, fecha: despues.fecha },
    hechos,
    'el hotfix solo corrige el reparto; los hechos de la venta quedan identicos'
  );
  assert.equal(despues.split.corregida, true);
  assert.equal(despues.split.correcciones.at(-1).tipo, 'persona-base');
  assert.match(despues.split.correcciones.at(-1).motivo, /99% to 33%/);

  const c1 = await w.request('/api/comisiones/cuadre?mes=' + mesActual());
  assert.equal(c1.comisionAsociados, 33);
  assert.equal(c1.porPagar, 33);

  /* Una segunda edicion de la MISMA regla sigue siendo reactiva; la correccion
     automatica anterior no se confunde con un override manual. */
  await w.request('/api/promotoras/' + pr.id, 'PUT', { comisionBase: 25 });
  const otra = await ventaRaw(w, id);
  assert.equal(otra.split.comisionPct, 25);
  assert.equal(otra.split.montoComisionSocio, 25);
  assert.equal(otra.split.correcciones.filter((x) => x.tipo === 'persona-base').length, 2);
  const c2 = await w.request('/api/comisiones/cuadre?mes=' + mesActual());
  assert.equal(c2.porPagar, 25);
});

test('v458 surgical guards: product %, shelf override, manual correction and paid sale are untouched', async () => {
  const w = appReal();
  const { pr, rack } = await crearBase(w, 99);

  const pProducto = await crearProducto(w, rack, 'PRODUCT', { pctAsociado: 55, comisionistaId: pr.id });
  const idProducto = await vender(w, pProducto);

  const rackPropio = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha override', tipo: 'socio', comisionSocio: 44 });
  await w.request('/api/ubicaciones/' + rackPropio.id, 'PUT', { promotoraId: pr.id, usarComisionPropia: true, comisionSocio: 44 });
  const pPercha = await crearProducto(w, rackPropio, 'RACK');
  const idPercha = await vender(w, pPercha);

  const pManual = await crearProducto(w, rack, 'MANUAL');
  const idManual = await vender(w, pManual);
  await w.request('/api/ventas/' + idManual + '/comision', 'PATCH', { comisionPct: 77, quien: 'owner', motivo: 'manual override fixture' });

  const rackPagado = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha paid', tipo: 'socio', comisionSocio: 10 });
  await w.request('/api/ubicaciones/' + rackPagado.id, 'PUT', { promotoraId: pr.id });
  const pPagado = await crearProducto(w, rackPagado, 'PAID');
  const idPagado = await vender(w, pPagado);
  const pago = await w.request('/api/payouts', 'POST', {
    ubicacionId: rackPagado.id, mes: mesActual(), payeeId: pr.id, sourceIds: [idPagado], medioPago: 'cash'
  });
  assert.ok(pago.payout && pago.payout.amount > 0, 'fixture: la venta quedo pagada');
  assert.equal((await ventaRaw(w, idPagado)).liquidada, true);

  await w.request('/api/promotoras/' + pr.id, 'PUT', { comisionBase: 33 });

  const prod = await ventaRaw(w, idProducto);
  const percha = await ventaRaw(w, idPercha);
  const manual = await ventaRaw(w, idManual);
  const pagada = await ventaRaw(w, idPagado);

  assert.equal(prod.split.comisionPct, 55, 'manda el % propio del producto');
  assert.equal(prod.split.montoComisionSocio, 55);
  assert.equal(percha.split.comisionPct, 44, 'manda la comision propia de la percha');
  assert.equal(percha.split.montoComisionSocio, 44);
  assert.equal(manual.split.comisionPct, 77, 'una correccion manual no se pisa');
  assert.equal(manual.split.montoComisionSocio, 77);
  assert.equal(pagada.split.comisionPct, 99, 'lo ya pagado queda sellado');
  assert.equal(pagada.split.montoComisionSocio, 99);
});
