/* v597 · DINERO ENTRE DOS APARATOS (3 bugs, datos sinteticos, mismo estilo que
   test/commissions-carreras-sync.test.js: mock-backend + catalogoPropio/aplicarCatalogo).
   1) A paga la comision y B cancela (ex post) la misma venta: debe haber UN solo
      descuento por lo pagado (el void del libro), no void + aj-dev.
   2) A y B cancelan/anulan la misma venta de 2 unidades: el stock se repone UNA vez.
   3) Una venta pagada con ajuste de recalculo retroactivo y devuelta en otro aparato
      debe generar su clawback (el adj-retro no cuenta como "ya hay devolucion"). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Race shelf', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Race print', sku: 'RACE-1', barcode: 'RACE-1', precio: 50, costo: 10, stockInicial: 20, ubicacionId: shelf.id });
  return { shelf, product };
}
const exp = (app) => app.request('/api/respaldo/exportar');
const liq = async (app, shelf) => (await app.request('/api/liquidaciones')).find(f => f.ubicacionId === shelf.id);
const stock = async (app, product) => (await app.request('/api/productos/' + product.id)).stockActual;
const cents = (n) => Math.round(Number(n) * 100);
const sync = (X, Y) => { X.receive(Y); Y.receive(X); X.receive(Y); };
const dosAparatos = async (cantidad) => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad });
  const venta = (await exp(A)).ventas.pop();
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  return { A, B, shelf, product, venta };
};

test('v597 bug1: A paga y B cancela ex post la misma venta: UN solo descuento (void), no void + aj-dev', async () => {
  const { A, B, shelf, venta } = await dosAparatos(1);
  const pagado = cents(venta.split.montoComisionSocio);
  assert.ok(pagado > 0);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  const rB = await B.request(`/api/ventas/${venta.id}/cancelar`, 'POST', { motivo: 'x' });
  assert.equal(rB.ok, true);
  sync(A, B);
  for (const [n, X] of [['A', A], ['B', B]]) {
    const e = await exp(X); const v = e.ventas.find(x => x.id === venta.id);
    assert.equal(v.anulada, true, n + ': la cancelacion no se pierde');
    assert.equal(v.liquidada, true, n + ': lo pagado no se despaga');
    assert.equal(e.ajustesComision.filter(a => a.tipo === 'devolucion' && a.ventaId === venta.id).length, 0,
      n + ': una venta ANULADA ya pagada se descuenta por el void del libro; el merge no fabrica ademas un aj-dev');
    const l = await liq(X, shelf);
    assert.equal(cents(l.stillDue), -pagado, n + ': se devuelve lo cobrado UNA vez (no el doble)');
    assert.equal(cents(l.payoutBalances.reduce((s, b) => s + b.earned, 0)), -pagado, n + ': ganado neto = -lo pagado');
  }
});

test('v597 bug1 (guarda): A paga y B DEVUELVE la misma venta: sigue habiendo exactamente un descuento (aj-dev)', async () => {
  const { A, B, shelf, venta } = await dosAparatos(1);
  const pagado = cents(venta.split.montoComisionSocio);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  await B.request(`/api/ventas/${venta.id}/devolucion`, 'POST', { motivo: 'race', quien: 'B' });
  sync(A, B);
  for (const [n, X] of [['A', A], ['B', B]]) {
    const e = await exp(X);
    assert.equal(e.ajustesComision.filter(a => a.tipo === 'devolucion' && a.ventaId === venta.id).length, 1, n);
    assert.equal(cents((await liq(X, shelf)).stillDue), -pagado, n + ': un solo descuento');
  }
});

test('v597 bug2: A y B cancelan (ex post) la misma venta de 2 unidades sin verse: el stock se repone UNA vez', async () => {
  const { A, B, product, venta } = await dosAparatos(2);
  await A.request(`/api/ventas/${venta.id}/cancelar`, 'POST', { motivo: 'x' });
  await B.request(`/api/ventas/${venta.id}/cancelar`, 'POST', { motivo: 'x' });
  sync(A, B); sync(A, B);
  assert.equal(await stock(A, product), 20, 'A: 20 - 2 vendidas + 2 repuestas = 20');
  assert.equal(await stock(B, product), 20, 'B igual');
});

test('v597 bug2: A anula y B cancela la misma venta (2 u.): el stock se repone UNA vez', async () => {
  const { A, B, product, venta } = await dosAparatos(2);
  const r = await A.request(`/api/ventas/${venta.id}/anular`, 'POST', {});
  assert.ok(!r.error, JSON.stringify(r));
  await B.request(`/api/ventas/${venta.id}/cancelar`, 'POST', { motivo: 'x' });
  sync(A, B); sync(A, B);
  assert.equal(await stock(A, product), 20);
  assert.equal(await stock(B, product), 20);
});

test('v597 bug2: A y B anulan la misma venta (2 u.): el stock se repone UNA vez', async () => {
  const { A, B, product, venta } = await dosAparatos(2);
  await A.request(`/api/ventas/${venta.id}/anular`, 'POST', {});
  await B.request(`/api/ventas/${venta.id}/anular`, 'POST', {});
  sync(A, B); sync(A, B);
  assert.equal(await stock(A, product), 20);
  assert.equal(await stock(B, product), 20);
});

test('v597 bug2: A cancela y B devuelve la misma venta sin pagar (2 u.): el stock se repone UNA vez', async () => {
  const { A, B, product, venta } = await dosAparatos(2);
  await A.request(`/api/ventas/${venta.id}/cancelar`, 'POST', { motivo: 'x' });
  await B.request(`/api/ventas/${venta.id}/devolucion`, 'POST', { motivo: 'y', quien: 'B' });
  sync(A, B); sync(A, B);
  assert.equal(await stock(A, product), 20);
  assert.equal(await stock(B, product), 20);
});

test('v597 bug2 (guarda): una sola cancelacion en un solo aparato repone las 2 unidades', async () => {
  const { A, B, product, venta } = await dosAparatos(2);
  await A.request(`/api/ventas/${venta.id}/cancelar`, 'POST', { motivo: 'x' });
  assert.equal(await stock(A, product), 20);
  sync(A, B);
  assert.equal(await stock(B, product), 20);
});

test('v597 bug3: venta pagada con ajuste de recalculo retroactivo y devuelta en otro aparato SI genera su clawback', async () => {
  const { A, B, shelf, venta } = await dosAparatos(1);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  // A ya tiene un ajuste de recalculo retroactivo (adj-retro) sobre esa venta (sintetico, misma forma que _retroEvaluar).
  const cat = A.catalog();
  cat.ajustesComision.push({ id: 'adj-retro-' + venta.id, tipo: 'recalculo-retroactivo', ventaId: venta.id, ubicacionId: venta.ubicacionId,
    productoId: venta.productoId, cantidad: venta.cantidad, fecha: venta.fecha, montoBruto: 0, montoComisionSocio: 1, montoNetoDueno: -1,
    reparto: [{ promotoraId: 'x', monto: 1 }], comisionPct: 40, quien: 'sistema', motivo: 'recalculo retroactivo al % del producto', liquidada: false });
  A.OCSync.aplicarCatalogo(cat, null);
  // B devuelve la venta (aun sin ver el pago) y A solo recibe la VENTA devuelta, sin el ajuste de B
  // (el ajuste puede llegar en otro lote del sync; el merge de la venta no debe darlo por cubierto con el adj-retro).
  await B.request(`/api/ventas/${venta.id}/devolucion`, 'POST', { motivo: 'race', quien: 'B' });
  const deB = B.catalog();
  deB.ajustesComision = deB.ajustesComision.filter(a => a.tipo !== 'devolucion');
  A.OCSync.aplicarCatalogo(deB, null);
  const e = await exp(A);
  const dev = e.ajustesComision.filter(a => a.tipo === 'devolucion' && a.ventaId === venta.id);
  assert.equal(dev.length, 1, 'pagada + devuelta => un clawback (el adj-retro no cuenta como devolucion)');
  assert.equal(cents(dev[0].montoComisionSocio), -cents(venta.split.montoComisionSocio));
  // Cuando por fin llega el ajuste real de B (mismo id determinista) no se duplica.
  A.receive(B); A.receive(B);
  assert.equal((await exp(A)).ajustesComision.filter(a => a.tipo === 'devolucion' && a.ventaId === venta.id).length, 1);
});
