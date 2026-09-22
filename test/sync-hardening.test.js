/* Regresiones del endurecimiento de sync (JFC 2026-09-22, shell v333).
   Fixtures aislados y sintéticos: sin red, sin datos de ningún cliente real.

   Cubre tres caminos que hasta hoy no tenían prueba y que ya costaron
   divergencia entre aparatos:
     1-2. despedir/reactivar un cliente no subía `rev`, así que el merge
          (aplicarCatalogo) lo descartaba y el cliente quedaba vivo en un
          aparato y despedido en el otro.
     3.   /api/liquidaciones/:id/marcar-pagado no validaba el verbo HTTP: sellar
          ventas como liquidadas es una escritura de dinero y no debe poder
          dispararse con un GET.
     4.   archivar un comisionista desasignaba sus perchas sin subir el `rev` de
          la percha (corregido en v332, pero sin regresión hasta ahora).

   Los cuatro fallan contra el código previo a estos fixes: cada uno afirma la
   CONVERGENCIA observable, no la mera presencia de un símbolo. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const despedidosDe = async peer =>
  (await peer.request('/api/clientes/comportamiento')).despedidos.map(c => c.id);

test('firing a customer converges to a peer device', async () => {
  const a = browser(), b = browser();
  const c = await a.request('/api/clientes', 'POST', { nombre: 'Fixture fired customer' });
  b.receive(a);
  assert.equal((await despedidosDe(b)).includes(c.id), false, 'arranca activo en el peer');

  await a.request(`/api/clientes/${c.id}/despedir`, 'POST', { quien: 'Fixture' });
  b.receive(a);

  assert.equal((await despedidosDe(a)).includes(c.id), true, 'queda despedido donde se hizo');
  assert.equal((await despedidosDe(b)).includes(c.id), true, 'y el despido CRUZA al peer');
  // No debe seguir apareciendo en la lista operativa del peer (la de Vender).
  assert.equal((await b.request('/api/clientes')).some(x => x.id === c.id), false);
});

test('reactivating a customer converges back, so rev keeps advancing', async () => {
  const a = browser(), b = browser();
  const c = await a.request('/api/clientes', 'POST', { nombre: 'Fixture rehired customer' });
  b.receive(a);
  await a.request(`/api/clientes/${c.id}/despedir`, 'POST', { quien: 'Fixture' });
  b.receive(a);
  assert.equal((await despedidosDe(b)).includes(c.id), true);

  // La segunda transición es la que prueba que el sello sigue subiendo: si `rev`
  // se quedara fijo tras el primer cambio, la reactivación no dominaría y el
  // peer se quedaría con el cliente despedido para siempre.
  await a.request(`/api/clientes/${c.id}/reactivar`, 'POST', { quien: 'Fixture' });
  b.receive(a);

  assert.equal((await despedidosDe(b)).includes(c.id), false, 'la reactivación también cruza');
  assert.equal((await b.request('/api/clientes')).some(x => x.id === c.id), true,
    'y vuelve a la lista operativa del peer');
});

test('marking a settlement paid ignores a non-POST verb but still works with POST', async () => {
  const a = browser();
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 5);
  product.id = 'p-fixture-liq'; product.stockActual = 5;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });

  const shelf = product.ubicacionId;
  const pendientes = async () =>
    (await a.request('/api/respaldo/exportar')).ventas.filter(v => !v.liquidada).length;
  assert.equal(await pendientes(), 1, 'hay una venta sin liquidar para sellar');

  // Un GET no debe sellar NADA: cae al 404 del router como cualquier verbo malo.
  await assert.rejects(
    () => a.request(`/api/liquidaciones/${shelf}/marcar-pagado`, 'GET'),
    /404/,
    'un GET a marcar-pagado se rechaza');
  assert.equal(await pendientes(), 1, 'y sobre todo: el GET no liquidó la venta');

  // El llamador real (POST) sigue funcionando exactamente igual que antes.
  const r = await a.request(`/api/liquidaciones/${shelf}/marcar-pagado`, 'POST');
  assert.equal(r.ok, true);
  assert.equal(r.ventasLiquidadas, 1);
  assert.equal(await pendientes(), 0, 'el POST sí sella, no se rompió la función');
});

test('archiving an associate unassigns its shelf on a peer device', async () => {
  const a = browser(), b = browser();
  const p = await a.request('/api/promotoras', 'POST', { nombre: 'Fixture associate', comisionBase: 30 });
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Fixture shelf', tipo: 'socio' });
  await a.request(`/api/ubicaciones/${u.id}`, 'PUT', { promotoraId: p.id });
  b.receive(a);

  const shelfOf = async peer =>
    (await peer.request('/api/respaldo/exportar')).ubicaciones.find(x => x.id === u.id);
  assert.equal((await shelfOf(b)).promotoraId, p.id, 'el peer ve la asignación inicial');

  await a.request(`/api/promotoras/${p.id}`, 'DELETE');
  b.receive(a);

  assert.equal((await shelfOf(a)).promotoraId, null, 'se desasigna donde se archivó');
  assert.equal((await shelfOf(b)).promotoraId, null,
    'y la desasignación CRUZA: sin el rev nuevo de la percha, el peer se quedaba con el comisionista viejo');
});
