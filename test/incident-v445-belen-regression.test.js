const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

async function makeProduct(w, name, stock) {
  const shelves = await w.request('/api/ubicaciones');
  const shelf = shelves[0] || await w.request('/api/ubicaciones', 'POST', { nombre: 'v445 fixture shelf' });
  return w.request('/api/productos', 'POST', {
    nombre: name, sku: 'FIX-' + name.replace(/\W+/g, '-'), barcode: 'FIX-' + name.replace(/\W+/g, '-'),
    precio: 25, costo: 10, stockInicial: stock, ubicacionId: shelf.id
  });
}

test('v445 Belén matrix: several stale legacy zeros cannot erase positive local counts', async () => {
  const w = fixtureBrowser();
  const stocks = [1, 2, 7, 9, 40];
  const made = [];
  for (let i = 0; i < stocks.length; i++) made.push(await makeProduct(w, 'Belen multi ' + i, stocks[i]));

  const remote = w.catalog();
  for (const p of remote.productos) {
    const idx = made.findIndex(x => x.id === p.id);
    if (idx < 0) continue;
    p.stockActual = 0;
    p.stockTs = Date.now() + (idx + 1) * 86400000;
    delete p.stockBase;
    delete p.stockPN;
    delete p.stockDeficit;
  }
  w.OCSync.aplicarCatalogo(remote, null);

  const state = await w.request('/api/respaldo/exportar');
  assert.deepEqual(made.map((p, i) => state.productos.find(x => x.id === p.id).stockActual), stocks);
});

test('v445 compatibility: a newer positive legacy stock still updates normally', async () => {
  const w = fixtureBrowser();
  const p = await makeProduct(w, 'Belen positive legacy', 3);
  const state0 = await w.request('/api/respaldo/exportar');
  const local = state0.productos.find(x => x.id === p.id);
  local.stockTs = 1000;
  delete local.stockBase; delete local.stockPN; delete local.stockDeficit;
  state0.productos = [local];
  state0.ventas = []; state0.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', state0);

  const remote = w.catalog();
  const rp = remote.productos.find(x => x.id === p.id);
  rp.stockActual = 11;
  rp.stockTs = 2000;
  delete rp.stockBase; delete rp.stockPN; delete rp.stockDeficit;
  w.OCSync.aplicarCatalogo(remote, null);

  const state = await w.request('/api/respaldo/exportar');
  assert.equal(state.productos.find(x => x.id === p.id).stockActual, 11);
});

test('v445 compatibility: a ledger-backed real zero still wins over positive local stock', async () => {
  const w = fixtureBrowser();
  const p = await makeProduct(w, 'Belen real zero', 1);
  const remote = w.catalog();
  const rp = remote.productos.find(x => x.id === p.id);
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 5000;
  rp.stockBase = 1;
  rp.stockPN = { 'fixture-device': { add: 0, sub: 1 } };
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(state.productos.find(x => x.id === p.id).stockActual, 0);
});

test('v445 compatibility: zero local stock remains zero when a stale legacy zero arrives', async () => {
  const w = fixtureBrowser();
  const p = await makeProduct(w, 'Belen already zero', 0);
  const remote = w.catalog();
  const rp = remote.productos.find(x => x.id === p.id);
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 86400000;
  delete rp.stockBase; delete rp.stockPN; delete rp.stockDeficit;
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(state.productos.find(x => x.id === p.id).stockActual, 0);
});

test('v445 new stock writes use relay time when available', async () => {
  const w = fixtureBrowser();
  const p = await makeProduct(w, 'Belen relay clock', 5);
  w.OCLatencia = { ahoraRelay: () => 1770000000123 };
  await w.request('/api/productos/' + p.id + '/ajustar', 'POST', { delta: 2, motivo: 'fixture' });
  const state = await w.request('/api/respaldo/exportar');
  const actual = state.productos.find(x => x.id === p.id);
  assert.equal(actual.stockActual, 7);
  assert.equal(actual.stockTs, 1770000000123);
});

test('Belén debt regression: sequence-gap warning keeps real $10 debt and Record a payment works -10 -> -6', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });

    const r = await page.evaluate(async () => {
      const req = async (url, method = 'GET', body, fetcher = window.fetch.bind(window)) => {
        const res = await fetcher(url, { method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        return data;
      };
      const c = await req('/api/clientes', 'POST', { nombre: 'Belen debt fixture' });
      await req('/api/clientes/' + c.id + '/fiar', 'POST', { monto: 5, motivo: 'Copa de vino blanco A' });
      await req('/api/clientes/' + c.id + '/fiar', 'POST', { monto: 5, motivo: 'Copa de vino blanco B' });
      const before = await req('/api/clientes/' + c.id + '/cartera');

      window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno' });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async function (url, options) {
        const res = await originalFetch(url, options);
        if (String(url) === '/api/clientes/' + c.id + '/cartera' &&
            (!options || !options.method || options.method === 'GET')) {
          const data = await res.clone().json();
          data.integridad = { ok: false, razon: 'hueco de secuencia' };
          return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return res;
      };

      const host = document.createElement('div');
      host.id = 'cartera-' + c.id;
      document.body.appendChild(host);
      await pintarSaldoCartera(c.id);
      const button = host.querySelector('button[onclick*="ocPagarDeuda"]');
      const snapshot = host.textContent || '';
      if (button) button.click();
      await new Promise(resolve => setTimeout(resolve, 60));
      const modal = document.getElementById('pp-modal-abono');
      if (modal) {
        modal.querySelector('#pp-ab-monto').value = '4';
        modal.querySelector('#pp-ab-ok').click();
      }
      await new Promise(resolve => setTimeout(resolve, 160));
      const after = await req('/api/clientes/' + c.id + '/cartera', 'GET', undefined, originalFetch);
      window.fetch = originalFetch;
      return { before: before.saldo, after: after.saldo, snapshot, button: !!button,
        modalOpened: !!modal, modalClosed: !document.getElementById('pp-modal-abono') };
    });

    assert.equal(r.before, -10);
    assert.equal(r.after, -6);
    assert.equal(r.button, true);
    assert.equal(r.modalOpened, true);
    assert.equal(r.modalClosed, true);
    assert.match(r.snapshot, /Debt\s+\$10\.00/);
    assert.match(r.snapshot, /Balance pending verification/);
    assert.match(r.snapshot, /Record a payment/);
  } finally { await browser.close(); }
});

test('v445 current sale path may legitimately reach zero and sync that zero to another peer', async () => {
  const a = fixtureBrowser();
  const b = fixtureBrowser();
  const p = await makeProduct(a, 'Belen sold to zero', 1);
  b.receive(a);
  await a.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  const afterSale = await a.request('/api/respaldo/exportar');
  const sold = afterSale.productos.find(x => x.id === p.id);
  assert.equal(sold.stockActual, 0);
  assert.ok(sold.stockBase != null, 'current sale path must carry stockBase');
  assert.ok(sold.stockPN && typeof sold.stockPN === 'object', 'current sale path must carry PN ledger');

  b.receive(a);
  const afterSync = await b.request('/api/respaldo/exportar');
  assert.equal(afterSync.productos.find(x => x.id === p.id).stockActual, 0);
});
