const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readyEnvironment } = require('./helpers/ready-environment.cjs');
let env;
before(async () => { env = await readyEnvironment(); });
after(async () => { if (env) await env.close(); });

async function shop() {
  const context = await env.context({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(env.origin + '/index.html');
  await page.evaluate(async () => {
    localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-FIXTURE-0000000', nombreNegocio: 'Synthetic performance shop', instanceId: 'performance-fixture' }));
    localStorage.setItem('f123_lang', 'es');
    OCAuth.rolActual = () => 'dueno';
    await OCSecure.guardarSecreto('789', [], '357', '');
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    };
    const shelf = await post('/api/ubicaciones', { nombre: 'Synthetic shelf', tipo: 'propio' });
    const product = await post('/api/productos', { nombre: 'Synthetic item', barcode: 'PERF-1', precio: 10, costo: 2, stockInicial: 3, ubicacionId: shelf.id });
    await post('/api/productos/' + product.id + '/venta', { cantidad: 1 });
  });
  return { context, page };
}
async function login(page) {
  await page.goto(env.origin + '/dashboard.html');
  await page.locator('#pin').fill('789');
  await page.locator('#entrar').click();
  await page.locator('#tablero').waitFor({ state: 'visible' });
  await page.locator('a[data-ruta="hoy"]').click();
}

test('a financial export waiting for its PDF tool is cancelled when the notebook changes', async () => {
  const { context, page } = await shop();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let requested;
  const requestSeen = new Promise(resolve => { requested = resolve; });
  await context.route('**/vendor/jspdf-4.2.1.umd.min.js', async route => {
    requested(); await pending; await route.continue();
  });
  const downloads = [];
  page.on('download', file => downloads.push(file));
  try {
    await login(page);
    await page.evaluate(() => {
      OCFinanceReport.update({ ventas: [], gastos: [], ajustesComision: [], cobertura: { ventas: true, gastos: true, ajustesComision: true, finanzasCoherentes: true } });
      document.getElementById('finance-pdf').click();
    });
    await requestSeen;
    await page.evaluate(() => {
      localStorage.setItem('f123_tienda_activa', '::F123-DIFFERENT-SYNTHETIC');
      window.dispatchEvent(new StorageEvent('storage', { key: 'f123_tienda_activa' }));
    });
    await page.locator('#puerta').waitFor({ state: 'visible' });
    release();
    await page.waitForFunction(() => !document.getElementById('finance-pdf').disabled);
    assert.equal(downloads.length, 0, 'the prior notebook cannot export after session loss');
  } finally { release(); await context.close(); }
});

test('export cancels when data mutates in place or the search changes while loading', async () => {
  const html = await fs.readFile(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
  const from = html.indexOf('  async function ejecutarExportacion('), to = html.indexOf('  function pintarSelector()', from);
  for (const change of ['revision', 'search']) {
    let finish;
    const ready = new Promise(resolve => { finish = resolve; });
    let revision = 1, selection = 'initial', exported = 0;
    const footer = { innerHTML: 'old total', textContent: '' };
    const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
    const context = { window: {}, localStorage: { getItem: () => 'es' }, $: () => footer,
      capturarSesionExportacion: () => () => true, seleccionExportacion: () => selection,
      prepararExportacion: () => ready, get revisionVistaExportacion() { return revision; } };
    require('node:vm').createContext(context);
    require('node:vm').runInContext(html.slice(from, to), context);
    const result = context.ejecutarExportacion(button, 'pdf', () => { exported++; });
    if (change === 'revision') revision++; else selection = 'filtered';
    footer.innerHTML = 'current total';
    finish(); await result;
    assert.equal(exported, 0);
    assert.equal(footer.innerHTML, 'current total', 'old financial footer is never restored');
    assert.match(footer.textContent, /Vuelve a exportar/);
    assert.equal(button.disabled, false);
  }
});

test('PDF tools stay unloaded until requested; failed first load retries and all reports download', async () => {
  const { context, page } = await shop();
  const requests = [];
  let fail = true;
  await context.route('**/vendor/jspdf-4.2.1.umd.min.js', route => {
    requests.push('pdf');
    return fail ? route.abort() : route.continue();
  });
  page.on('request', request => { if (request.url().includes('jspdf-autotable')) requests.push('table'); });
  try {
    await login(page);
    assert.deepEqual(requests, [], 'initial dashboard must not load export scripts');
    assert.equal(await page.evaluate(() => typeof window.jspdf), 'undefined');
    await page.locator('[data-r="mes"]').click();
    await page.waitForFunction(() => document.querySelector('#cierre').textContent.includes('vuelve a pulsar'));
    assert.equal(await page.locator('[data-r="mes"]').isEnabled(), true);
    fail = false;
    for (const report of ['mes', 'inv', 'cli']) {
      const download = page.waitForEvent('download');
      await page.locator('[data-r="' + report + '"]').click();
      const file = await download;
      assert.match(file.suggestedFilename(), /\.pdf$/);
      const bytes = await fs.readFile(await file.path());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.ok(bytes.length > 1000);
    }
    assert.deepEqual(requests, ['pdf', 'pdf', 'table'], 'successful dependencies are reused across reports');
  } finally { await context.close(); }
});

test('collapsed history avoids DOM work and preserves every latest movement on opening', async () => {
  const { context, page } = await shop();
  const html = await fs.readFile(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
  await context.route('**/dashboard.html', route => route.fulfill({ contentType: 'text/html', body: html.replace('  function mostrar() {',
    '  window.__performanceFixture = { snapshot: function(rows) { datos = Object.assign({}, datos, {movimientos: rows}); mostrar(); } };\n  function mostrar() {') }));
  try {
    await login(page);
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: 'synthetic-' + i, tipo: 'sale', fecha: '2026-10-16', detalle: 'Movement ' + i, dispositivoApodo: 'Synthetic device' }));
    await page.evaluate(rows => __performanceFixture.snapshot(rows), rows);
    assert.equal(await page.locator('#oc-log-tabla tr').count(), 0);
    await page.locator('a[data-ruta="inicio"]').click();
    await page.locator('a[data-tile="herramientas"]').click();
    assert.equal(await page.locator('#oc-log-tabla tr').count(), 0);
    await page.locator('#oc-log-tablero summary').click();
    await page.waitForFunction(() => document.querySelectorAll('#oc-log-tabla tr').length === 2001);
    assert.match(await page.locator('#oc-log-tabla').innerText(), /Movement 1999/);
    await page.locator('#oc-log-tablero summary').click();
    rows.push({ id: 'synthetic-new', tipo: 'sale', detalle: 'Newest movement' });
    await page.evaluate(rows => __performanceFixture.snapshot(rows), rows);
    assert.equal(await page.locator('#oc-log-tabla tr').count(), 2001);
    await page.locator('#oc-log-tablero summary').click();
    await page.waitForFunction(() => document.querySelectorAll('#oc-log-tabla tr').length === 2002);
    assert.match(await page.locator('#oc-log-tabla').innerText(), /Newest movement/);
    await page.locator('a[data-ruta="inicio"]').click();
    rows.push({ id: 'synthetic-hidden', tipo: 'sale', detalle: 'Updated while away' });
    await page.evaluate(rows => __performanceFixture.snapshot(rows), rows);
    assert.equal(await page.locator('#oc-log-tabla tr').count(), 2002);
    await page.locator('a[data-tile="herramientas"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#oc-log-tabla tr').length === 2003);
    rows.push({ id: 'synthetic-live', tipo: 'sale', detalle: 'Visible live update' });
    await page.evaluate(rows => __performanceFixture.snapshot(rows), rows);
    assert.equal(await page.locator('#oc-log-tabla tr').count(), 2004);
  } finally { await context.close(); }
});
