const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function storage() {
  const values = new Map();
  return {
    writes: 0,
    get length() { return values.size; },
    key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { this.writes++; values.set(key, String(value)); },
    removeItem: key => values.delete(key)
  };
}

test('reapplying an identical catalog is a no-op: no merge history, event, or save', async () => {
  const ls = storage();
  const w = browser(ls);
  const remote = w.catalog();
  const before = await w.request('/api/respaldo/exportar');
  let events = 0;
  w.addEventListener('oc-catalogo-cambiado', () => events++);
  const writes = ls.writes;

  const result = w.OCSync.aplicarCatalogo(remote, null);
  const after = await w.request('/api/respaldo/exportar');

  assert.equal(result.ok, true);
  assert.equal(after.movimientos.length, before.movimientos.length);
  assert.equal(events, 0);
  assert.equal(ls.writes, writes);
});

test('name-only and stock-only merges still persist and publish', async () => {
  for (const kind of ['name', 'stock']) {
    const w = browser();
    let remote = w.catalog();
    if (kind === 'stock') {
      remote.productos.push({ id: 'real-stock-1', nombre: 'Fixture stock', precio: 4, costo: 2,
        stockActual: 4, stockTs: 1000, stockBase: 4, stockPN: {}, rev: { c: 1, d: 'fixture' } });
      w.OCSync.aplicarCatalogo(remote, null);
      remote = w.catalog();
    }
    if (kind === 'name') {
      remote.nombreNegocio = 'Remote shop';
      remote.nombreNegocioRev = (remote.nombreNegocioRev || 0) + 10;
    } else {
      const product = remote.productos.find(p => p.id === 'real-stock-1');
      product.stockActual += 1;
      product.stockBase += 1;
      product.stockTs += 1000;
    }
    let events = 0;
    w.addEventListener('oc-catalogo-cambiado', () => events++);
    const before = (await w.request('/api/respaldo/exportar')).movimientos.length;
    const result = w.OCSync.aplicarCatalogo(remote, 'dueno');
    const after = await w.request('/api/respaldo/exportar');

    assert.equal(result.ok, true, kind);
    assert.equal(after.movimientos.length, before + 1, kind);
    assert.equal(events, 1, kind);
    if (kind === 'name') assert.equal(after.nombreNegocio, 'Remote shop');
    else assert.equal(after.productos.find(p => p.id === 'real-stock-1').stockActual,
      remote.productos.find(p => p.id === 'real-stock-1').stockActual);
  }
});

test('money, expense, member status, and photo-hash changes still persist and publish', async () => {
  const w = browser();
  const remote = w.catalog();
  remote.productos.push({ id: 'photo-product', nombre: 'Photo fixture', precio: 5, costo: 2,
    stockActual: 1, stockTs: 1000, stockBase: 1, stockPN: {}, fotoHash: 'sha256:fixture', rev: { c: 1, d: 'fixture' } });
  remote.ventas.push({ id: 'sale-fixture', productoId: 'photo-product', cantidad: 1, precioUnit: 5, fecha: '2026-10-20T00:00:00Z' });
  remote.gastos.push({ id: 'expense-fixture', concepto: 'fixture', monto: 2, rev: { c: 2, d: 'fixture' } });
  remote.payouts.push({ id: 'payout-fixture', opId: 'op-fixture', locationId: 'rack-fixture', payeeId: 'payee-fixture',
    status: 'paid', amountCents: 100, items: [{ kind: 'sale', sourceId: 'sale-fixture', payeeId: 'payee-fixture', amountCents: 100 }] });
  remote.usuarios.push({ id: 'member-fixture', nombre: 'Fixture member', pin: '654', rol: 'empleado', activo: false, rev: { c: 3, d: 'fixture' } });
  let events = 0;
  w.addEventListener('oc-catalogo-cambiado', () => events++);

  const result = w.OCSync.aplicarCatalogo(remote, 'dueno');
  const after = await w.request('/api/respaldo/exportar');

  assert.equal(result.ok, true);
  assert.equal(events, 1);
  assert.ok(after.ventas.some(v => v.id === 'sale-fixture'));
  assert.ok(after.gastos.some(g => g.id === 'expense-fixture'));
  assert.ok(after.payouts.some(p => p.id === 'payout-fixture'));
  assert.equal(after.usuarios.find(u => u.id === 'member-fixture').activo, false);
  assert.equal(after.productos.find(p => p.id === 'photo-product').fotoHash, 'sha256:fixture');
});

test('derived stock deficit reconciliation is persisted even though it is absent from the wire catalog', async () => {
  const w = browser();
  const seed = w.catalog();
  seed.productos.push({ id: 'deficit-fixture', nombre: 'Fixture deficit', precio: 1, costo: 1,
    stockActual: 0, stockTs: 1000, stockBase: 1, stockPN: { sale: { add: 0, sub: 3 } }, rev: { c: 1, d: 'fixture' } });
  w.OCSync.aplicarCatalogo(seed, null);
  const local = await w.request('/api/respaldo/exportar');
  local.productos.find(p => p.id === 'deficit-fixture').stockDeficit = 99;
  await w.request('/api/respaldo/importar', 'POST', local);
  const remote = w.catalog();
  let events = 0;
  w.addEventListener('oc-catalogo-cambiado', () => events++);

  const result = w.OCSync.aplicarCatalogo(remote, null);
  const after = await w.request('/api/respaldo/exportar');

  assert.equal(result.ok, true);
  assert.equal(after.productos.find(p => p.id === 'deficit-fixture').stockDeficit, 2);
  assert.equal(events, 1);
});

test('async PIN adoption is persisted and published after the secure store accepts it', async () => {
  const ls = storage();
  const w = browser(ls);
  let ownerPin = '', sidecarPin = '';
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  w.OCSecure.leerPinQueAbre = () => ({ owner: ownerPin });
  w.OCSecure.leerPinsVisibles = () => ({ owner: ownerPin });
  w.OCSecure.leerPinsEquipo = () => ({ owner: sidecarPin });
  w.OCSecure.guardarPinsEquipo = pins => { sidecarPin = pins.owner || ''; };
  w.OCSecure.fijarOwnerPin = pin => pending.then(() => { ownerPin = pin; return true; });
  w.OCSecure.recordarPinQueAbre = pin => { ownerPin = pin; };
  const remote = w.catalog();
  remote.pinsRol = { owner: '321' };
  let events = 0, writesAtEvent = 0;
  w.addEventListener('oc-catalogo-cambiado', () => { events++; writesAtEvent = ls.writes; });
  const before = (await w.request('/api/respaldo/exportar')).movimientos.length;
  const writes = ls.writes;

  const result = w.OCSync.aplicarCatalogo(remote, null);
  assert.equal(result.ok, true);
  assert.equal(events, 0);
  assert.equal(ls.writes, writes);
  assert.equal((await w.request('/api/respaldo/exportar')).movimientos.length, before);

  release();
  await new Promise(resolve => setImmediate(resolve));
  const after = await w.request('/api/respaldo/exportar');
  assert.equal(ownerPin, '321');
  assert.equal(events, 1);
  assert.ok(writesAtEvent > writes, 'secure PIN success is saved before the catalog event');
  assert.equal(after.movimientos.length, before + 1);
});
