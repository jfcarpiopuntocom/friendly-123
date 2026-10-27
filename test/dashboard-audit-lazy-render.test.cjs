const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readyEnvironment } = require('./helpers/ready-environment.cjs');
let env;
before(async () => { env = await readyEnvironment(); });
after(async () => { if (env) await env.close(); });

test('dashboard defers hidden sales audit and paints latest rows with filters on route open', async () => {
  const ctx = await env.context({ viewport: { width: 390, height: 844 } });
  try {
    const app = await ctx.newPage();
    await app.goto(env.origin + '/index.html');
    await app.waitForFunction(() => window.OCSecure);
    await app.evaluate(async () => {
      OCAuth.rolActual = () => 'dueno';
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-TEST-0000-0000-00000', instanceId: 'synthetic-audit-device', nombreNegocio: 'Synthetic audit' }));
      const post = async (url, body) => { const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) }); if (!r.ok) throw Error(await r.text()); return r.json(); };
      const rack = await post('/api/ubicaciones', { nombre: 'Synthetic audit rack', tipo: 'propio' });
      await post('/api/productos', { nombre: 'Synthetic audit item', barcode: 'AUDIT-LAZY', precio: 10, costo: 2, stockInicial: 2, ubicacionId: rack.id });
      await OCSecure.guardarSecreto('789', [], '357', '');
    });
    await app.close();

    const dash = await ctx.newPage();
    dash.setDefaultTimeout(5000);
    await dash.goto(env.origin + '/dashboard.html');
    await dash.locator('#pin').fill('789');
    await dash.locator('#entrar').click();
    await dash.locator('#tablero').waitFor({ state: 'visible' });
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: 'sale-' + i, productoId: 'p' + (i % 10), productoNombre: 'Product ' + (i % 10), fecha: '2026-10-16T12:00:00.000Z',
      cantidad: 1, precioUnit: 10, ubicacionId: 'rack-' + (i % 2), ubicacionNombre: 'Rack ' + (i % 2), formaPago: 'cash'
    }));
    await dash.evaluate(rows => OCDashSalesAudit.pintarConDatos({ ventas: rows }), rows);
    assert.equal(await dash.locator('#sales-audit [data-audit-sale]').count(), 0, 'hidden report does not build cards');
    await dash.locator('#nav-hub a[data-ruta=hoy]').click();
    await dash.waitForFunction(() => document.documentElement.dataset.hubRuta === 'hoy');
    await dash.waitForFunction(() => document.querySelectorAll('#sales-audit [data-audit-sale]').length === 20);
    assert.equal(await dash.locator('#sales-audit [data-audit-sale]').count(), 20, 'route paints all rows');
await dash.locator('#sales-audit [data-audit-query]').fill('Product 1');
    assert.equal(await dash.locator('#sales-audit [data-audit-sale]').count(), 2);
    rows.push({ id: 'sale-new', productoId: 'p1', productoNombre: 'Product 1', fecha: '2026-10-17T12:00:00.000Z', cantidad: 1, precioUnit: 10, ubicacionId: 'rack-1', ubicacionNombre: 'Rack 1', formaPago: 'cash' });
    await dash.evaluate(rows => OCDashSalesAudit.pintarConDatos({ ventas: rows }), rows);
    assert.equal(await dash.locator('#sales-audit [data-audit-query]').inputValue(), 'Product 1', 'refresh retains query');
    assert.equal(await dash.locator('#sales-audit [data-audit-sale]').count(), 3, 'refresh updates matching sales');
    await dash.locator('#nav-hub a[data-ruta=inicio]').click();
    await dash.waitForFunction(() => document.documentElement.dataset.hubRuta === 'inicio');
    assert.equal(await dash.locator('#sales-audit').evaluate(el => el.hidden), true);
    rows.push({ id: 'sale-later', productoId: 'p1', productoNombre: 'Product 1', fecha: '2026-10-18T12:00:00.000Z', cantidad: 1, precioUnit: 10, ubicacionId: 'rack-1', ubicacionNombre: 'Rack 1', formaPago: 'cash' });
    await dash.evaluate(rows => OCDashSalesAudit.pintarConDatos({ ventas: rows }), rows);
    await dash.locator('#nav-hub a[data-ruta=hoy]').click();
    await dash.waitForFunction(() => document.documentElement.dataset.hubRuta === 'hoy');
    await dash.waitForFunction(() => document.querySelectorAll('#sales-audit [data-audit-sale]').length === 4);
    assert.equal(await dash.locator('#sales-audit [data-audit-sale]').count(), 4, 'route opening paints the latest hidden update');
    assert.equal(await dash.locator('#sales-audit [data-audit-query]').inputValue(), 'Product 1');
  } finally { await ctx.close(); }
});