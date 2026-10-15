/* v523: shared Playwright browser per engine; independent synthetic context per test.
   Network is routed exclusively to local fixture files. No real notebooks. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const DOCS = path.resolve(__dirname, '../docs');
const ORIGIN = 'http://localhost:18478';
const pool = new Map();

async function fixture(engine, viewport) {
  let browser = pool.get(engine);
  if (!browser) {
    browser = await engine.launch({ headless: true,
      ...(engine === chromium ? { args: ['--disable-gpu', '--use-angle=swiftshader'] } : {}) });
    pool.set(engine, browser);
  }
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort(); // never a public environment
    const file = path.resolve(DOCS, decodeURIComponent(url.pathname).slice(1));
    if (!file.startsWith(DOCS + path.sep)) return route.abort();
    try {
      const ext = path.extname(file);
      await route.fulfill({ status: 200,
        contentType: { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
          '.css': 'text/css', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream',
        body: fs.readFileSync(file) });
    } catch (_) { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  await context.addInitScript(() => {
    window.WebSocket = class {
      constructor() { this.readyState = 3; }
      send() {} close() {} addEventListener() {} removeEventListener() {}
    };
  });
  return context;
}
after(async () => { for (const browser of pool.values()) await browser.close(); pool.clear(); });

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test('v523: ' + name + ' tablet retains sales and commission editors without Tabulator', async () => {
    const ctx = await fixture(engine, { width: 390, height: 844 });
    try {
      const app = await ctx.newPage();
      await app.goto(ORIGIN + '/index.html', { waitUntil: 'load' });
      await app.waitForFunction(() => window.OCSecure && window.OCAuth);
      await app.evaluate(async () => {
        window.OCAuth = Object.assign({}, window.OCAuth, { rolActual: () => 'dueno' });
        localStorage.setItem('f123_owned', JSON.stringify({
          instanceId: 'fixture-v523', licenseCode: 'F123-FIXTURE-0000000',
          nombreNegocio: 'Synthetic commission shop',
        }));
        await window.OCSecure.guardarSecreto('789', ['260'], '357', '');
        const req = async (u, m = 'GET', b) => {
          const r = await fetch(u, { method: m, body: b ? JSON.stringify(b) : undefined });
          if (!r.ok) throw Error(await r.text());
          return r.json();
        };
        await req('/api/usuarios', 'POST', { nombre: 'Synthetic dashboard manager', pin: '555', rol: 'admin' });
        const ana = await req('/api/promotoras', 'POST', { nombre: 'Synthetic seller', comisionBase: 50 });
        const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Synthetic rack', tipo: 'socio' });
        await req('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: ana.id });
        const p = await req('/api/productos', 'POST', {
          nombre: 'Synthetic workshop', sku: 'PL-523', barcode: 'PL-523', precio: 100,
          costo: 0, stockInicial: 4, ubicacionId: rack.id
        });
        await req('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
      });
      await app.close();
      const dash = await ctx.newPage();
      await dash.goto(ORIGIN + '/dashboard.html', { waitUntil: 'load' });
      await dash.locator('#pin').fill('555');
      await dash.locator('#entrar').click();
      await dash.waitForFunction(() => getComputedStyle(document.getElementById('tablero')).display !== 'none');
      assert.equal(await dash.evaluate(() => typeof window.Tabulator), 'undefined');
      await dash.locator('a[data-ruta="hoy"]').click();
      await dash.locator('button[data-v="ventas"]').click();
      assert.ok(await dash.locator('#tabla a[href*="#editar=venta:"]').count());
      await dash.locator('a[data-ruta="comisiones"]').click();
      await dash.locator('button[data-v="comisiones"]').click();
      assert.ok(await dash.locator('#tabla a[href*="#editar=comisionpercha:"]').count());
      assert.equal(await dash.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    } finally { await ctx.close(); }
  });
}
