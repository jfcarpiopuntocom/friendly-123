const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function legacyStockFixture(w, id, stock, stockTs) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => Number(x.stockActual) >= 10);
  p.id = id;
  p.nombre = 'Clock forensic ' + id;
  p.stockActual = stock;
  p.stockTs = stockTs;
  delete p.stockBase;
  delete p.stockPN;
  delete p.stockDeficit;
  fx.productos = [p];
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return p;
}

test('clock forensic: a newly created product uses relay time for initial stockTs', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  w.OCLatencia = { ahoraRelay: () => 1234567890123 };

  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'Relay rack', tipo: 'propia' });
  const p = await w.request('/api/productos', 'POST', {
    nombre: 'Relay product', barcode: 'CLK-NEW-1', precio: 10, costo: 4,
    stockInicial: 7, ubicacionId: rack.id
  });
  const state = await w.request('/api/respaldo/exportar');
  const saved = state.productos.find((x) => x.id === p.id);
  assert.equal(saved.stockTs, 1234567890123);
});

test('clock forensic: an impossible-future legacy positive snapshot cannot win by fake recency', async () => {
  const w = browser();
  const relayNow = 1800000000000;
  w.OCLatencia = { ahoraRelay: () => relayNow };
  const p = await legacyStockFixture(w, 'p-clock-remote-future', 5, relayNow - 1000);

  const seen = [];
  w.addEventListener('oc-stock-ts-futuro-ignorado', (e) => seen.push(e.detail));

  const remote = w.catalog();
  const rp = remote.productos.find((x) => x.id === p.id);
  rp.stockActual = 7;
  rp.stockTs = relayNow + 24 * 60 * 60 * 1000;
  rp.stockBase = null;
  rp.stockPN = null;

  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  const saved = state.productos.find((x) => x.id === p.id);
  assert.equal(saved.stockActual, 5);
  assert.equal(saved.stockTs, relayNow - 1000);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].productoId, p.id);
});

test('clock forensic: read-only diagnostic flags legacy future stockTs without changing business data', async () => {
  const w = browser();
  const relayNow = 1800000000000;
  w.OCLatencia = { ahoraRelay: () => relayNow };
  const p = await legacyStockFixture(w, 'p-clock-existing-future', 0, relayNow + 6 * 60 * 60 * 1000);
  const before = await w.request('/api/respaldo/exportar');

  const audit = await w.request('/api/diagnostico/reloj-datos');
  assert.equal(audit.relojComun, true);
  const hit = audit.stockSospechoso.find((x) => x.productoId === p.id);
  assert.ok(hit, 'the impossible-future legacy timestamp must be surfaced');
  assert.equal(hit.stockActual, 0);
  assert.equal(hit.legacySinLedger, true);
  assert.ok(hit.futuroMs > 5 * 60 * 1000);

  const after = await w.request('/api/respaldo/exportar');
  const b = before.productos.find((x) => x.id === p.id);
  const a = after.productos.find((x) => x.id === p.id);
  assert.deepEqual(a, b, 'diagnostic is read-only and preserves the suspicious evidence');
});

test('clock forensic: commission month uses the stored clock offset without rewriting the sale', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await w.request('/api/ubicaciones', 'POST', { nombre: 'Clock commission', tipo: 'socio', comisionSocio: 40 });
  const p = await w.request('/api/productos', 'POST', {
    nombre: 'Clock commission product', sku: 'CLK-COMM', barcode: 'CLK-COMM',
    precio: 50, costo: 20, stockInicial: 5, ubicacionId: shelf.id
  });
  const sold = await w.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  const backup = await w.request('/api/respaldo/exportar');
  const v = backup.ventas.find((x) => x.id === sold.ventaId);
  v.fecha = '2026-11-02T12:00:00.000Z';
  v.relojDesfaseMs = -3 * 24 * 60 * 60 * 1000; // corrected instant = 2026-10-30
  v.relojMargenMs = 20;
  await w.request('/api/respaldo/importar', 'POST', backup);

  const oct = (await w.request('/api/liquidaciones?mes=2026-10')).find((x) => x.ubicacionId === shelf.id);
  assert.equal(oct.estado, 'pendiente');
  assert.equal(oct.comisionSocio, 20);

  const nov = (await w.request('/api/liquidaciones?mes=2026-11')).find((x) => x.ubicacionId === shelf.id);
  assert.equal(nov.estado, 'sin ventas');

  const after = await w.request('/api/respaldo/exportar');
  const raw = after.ventas.find((x) => x.id === sold.ventaId);
  assert.equal(raw.fecha, '2026-11-02T12:00:00.000Z', 'raw audit timestamp is preserved');
  assert.equal(raw.relojDesfaseMs, -3 * 24 * 60 * 60 * 1000);
});

test('clock forensic: Today uses corrected sale instant when a clock-offset seal exists', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await w.request('/api/ubicaciones', 'POST', { nombre: 'Clock today', tipo: 'propia' });
  const p = await w.request('/api/productos', 'POST', {
    nombre: 'Clock today product', sku: 'CLK-TODAY', barcode: 'CLK-TODAY',
    precio: 12, costo: 5, stockInicial: 5, ubicacionId: shelf.id
  });
  const sold = await w.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  const backup = await w.request('/api/respaldo/exportar');
  const v = backup.ventas.find((x) => x.id === sold.ventaId);
  v.fecha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  v.relojDesfaseMs = -24 * 60 * 60 * 1000;
  v.relojMargenMs = 10;
  await w.request('/api/respaldo/importar', 'POST', backup);

  const today = await w.request('/api/ventas/hoy?ubicacionId=' + encodeURIComponent(shelf.id));
  assert.equal(today[p.id], 1);
});
