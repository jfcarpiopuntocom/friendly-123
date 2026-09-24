/* CARRERAS DE DINERO ENTRE DOS APARATOS (JFC 2026-09-24, Luis nivel 2).
   Casos donde A y B actuan sobre la MISMA venta sin haberse visto todavia,
   por el camino real (mock-backend + catalogoPropio/aplicarCatalogo, que es
   lo que el relay reenvia). Regla: converger sin perder plata ni duplicarla. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Race shelf', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Race print', sku: 'RACE-1', barcode: 'RACE-1', precio: 50, costo: 10, stockInicial: 20, ubicacionId: shelf.id });
  return { shelf, product };
}
const venta = async (app, id) => (await app.request('/api/respaldo/exportar')).ventas.find(v => v.id === id);
const ajustes = async (app) => (await app.request('/api/respaldo/exportar')).ajustesComision;
const liq = async (app, shelf) => (await app.request('/api/liquidaciones')).find(f => f.ubicacionId === shelf.id);
const cents = (n) => Math.round(Number(n) * 100);
const sync = (X, Y) => { X.receive(Y); Y.receive(X); X.receive(Y); };

test('A paga y B devuelve la misma venta sin haberse visto: al converger la venta queda pagada+devuelta y existe UN ajuste negativo', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const vA = (await A.request('/api/respaldo/exportar')).ventas.pop();
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  // Carrera: A marca pagado; B (sin saberlo) registra la devolucion.
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  const rB = await B.request(`/api/ventas/${vA.id}/devolucion`, 'POST', { motivo: 'race', quien: 'B' });
  assert.equal(rB.ok, true);
  sync(A, B);
  const a = await venta(A, vA.id), b = await venta(B, vA.id);
  for (const [x, n] of [[a, 'A'], [b, 'B']]) {
    assert.equal(x.liquidada, true, n + ': lo pagado no se despaga');
    assert.equal(x.devuelta, true, n + ': la devolucion no se pierde');
  }
  const ajA = await ajustes(A), ajB = await ajustes(B);
  assert.equal(ajA.length, 1, 'venta pagada y devuelta => exactamente UN ajuste negativo (sin el, el socio se queda con comision de una venta que volvio)');
  assert.equal(ajB.length, 1, 'B tiene el mismo unico ajuste');
  assert.equal(ajA[0].id, ajB[0].id, 'mismo id en los dos aparatos (determinista, dedupe)');
  assert.equal(cents(ajA[0].montoComisionSocio), -cents(vA.split.montoComisionSocio));
  sync(A, B);
  assert.equal((await ajustes(A)).length, 1, 'mergear de nuevo no duplica el ajuste');
  const l = await liq(A, shelf);
  assert.equal(l.ajustes.length, 1, 'la liquidacion muestra el clawback pendiente de descontar');
});

test('A y B corrigen el % del mes a la vez con valores distintos: converge a UNO y comision+neto=bruto en los dos', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  await A.request(`/api/ubicaciones/${shelf.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 30, quien: 'A', motivo: 'a' });
  await B.request(`/api/ubicaciones/${shelf.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 55, quien: 'B', motivo: 'b' });
  sync(A, B);
  const id = (await A.request('/api/respaldo/exportar')).ventas.pop().id;
  const a = await venta(A, id), b = await venta(B, id);
  assert.equal(a.split.comisionPct, b.split.comisionPct, 'los dos aparatos muestran el mismo %');
  for (const v of [a, b]) assert.equal(cents(v.split.montoComisionSocio) + cents(v.split.montoNetoDueno), cents(v.split.montoBruto));
  assert.equal(cents((await liq(A, shelf)).ventasBrutas), cents((await liq(B, shelf)).ventasBrutas));
});

test('B corrige el % de una venta que A ya pago (sin verlo): al converger manda lo pagado, no la correccion', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const id = (await A.request('/api/respaldo/exportar')).ventas.pop().id;
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  await B.request(`/api/ubicaciones/${shelf.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 90, quien: 'B', motivo: 'tarde' });
  sync(A, B);
  const a = await venta(A, id), b = await venta(B, id);
  assert.equal(a.liquidada, true, 'A: lo pagado no se despaga'); assert.equal(b.liquidada, true, 'B: converge a pagada');
  assert.equal(a.split.comisionPct, 40, 'A conserva el % con el que se pago');
  assert.equal(b.split.comisionPct, 40, 'B descarta su correccion tardia: manda lo pagado');
  assert.equal(cents(a.split.montoComisionSocio), 2000);
  assert.equal(cents(b.split.montoComisionSocio), 2000);
  assert.equal(cents(b.split.montoComisionSocio) + cents(b.split.montoNetoDueno), cents(b.split.montoBruto));
});

test('A y B marcan pagado el mismo mes a la vez: al converger nada se paga dos veces ni queda pendiente', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  await B.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  sync(A, B);
  for (const X of [A, B]) {
    const l = await liq(X, shelf);
    assert.equal(l.estado, 'pagado'); assert.equal(l.ventasPendientes, 0);
    const vs = (await X.request('/api/respaldo/exportar')).ventas.filter(v => v.ubicacionId === shelf.id);
    assert.equal(vs.length, 2, 'dos ventas, no cuatro'); assert.ok(vs.every(v => v.liquidada));
  }
});

test('B devuelve una venta pendiente mientras A le corrige el %: converge anulada, sin ajuste y sin comision pendiente', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const id = (await A.request('/api/respaldo/exportar')).ventas.pop().id;
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  await A.request(`/api/ubicaciones/${shelf.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 60, quien: 'A', motivo: 'x' });
  await B.request(`/api/ventas/${id}/devolucion`, 'POST', { motivo: 'race', quien: 'B' });
  sync(A, B);
  for (const X of [A, B]) {
    const v = await venta(X, id);
    assert.equal(v.anulada, true, 'la anulacion no se pierde');
    assert.equal((await ajustes(X)).length, 0, 'no pagada => sin clawback');
    assert.equal((await liq(X, shelf)).ventasPendientes, 0, 'una venta anulada no debe comision');
  }
});

test('tras la carrera pago (A) / devolucion (B), el STOCK converge: la unidad devuelta vuelve una sola vez en los dos aparatos', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const id = (await A.request('/api/respaldo/exportar')).ventas.pop().id;
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  await B.request(`/api/ventas/${id}/devolucion`, 'POST', { motivo: 'race', quien: 'B' });
  sync(A, B); sync(A, B);
  const pa = await A.request(`/api/productos/${product.id}`), pb = await B.request(`/api/productos/${product.id}`);
  assert.equal(pb.stockActual, 20, 'B devolvio la unidad: 20');
  assert.equal(pa.stockActual, pb.stockActual, 'A converge al mismo stock (no 19, no 21)');
});
