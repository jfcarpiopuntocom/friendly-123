'use strict';
// RED-first P0 (JFC, 20 nov 2026): "se crashea al aumentar cantidades manualmente".
// Real browser, real app shell, synthetic license/store only. Owner taps "+", types N, chooses ADD (sumar) + a reason.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice } = require('./helpers/e2e-app.cjs');
const pw = require('playwright');
const engine = pw[process.env.F123_BROWSER || 'chromium'];

test('owner manual ADD of N units (sumar) commits exactly +N, repeatedly, with zero page errors', { timeout: 120000 }, async () => {
  const { srv, base } = await startServer();
  let web;
  try {
    web = await engine.launch();
    const { page, ctx } = await openDevice(web, base, { license: 'F123-SYNTHETIC-MANUAL-ADD-ONLY' });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + (e && e.message)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    page.on('crash', () => errors.push('PAGE CRASHED'));
    const id = await page.evaluate(async () => {
      const original = OCAuth;
      window.OCAuth = Object.assign({}, original, { rolActual: () => 'dueno' });
      try {
        localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'synthetic-manual-add-device' }));
        await OCSecure.guardarSecreto('789', ['260'], '357', '');
        const r = await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Synthetic manual add', barcode: 'SYN-ADD-829', stockInicial: 3, precio: 10, costo: 4 }) });
        if (!r.ok) throw Error(await r.text());
        return (await r.json()).id;
      } finally { window.OCAuth = original; }
    });
    for (const digit of ['7', '8', '9']) await page.locator('#oc-pad').getByRole('button', { name: digit, exact: true }).click();
    await page.waitForFunction(() => OCAuth.rolActual() === 'dueno');
    if (await page.locator('#am-welcome.abierto').isVisible()) await page.locator('#am-welcome-ok').click();
    await page.locator('button[data-vista="inventario"]').click();
    const stock = () => page.evaluate(async id => (await (await fetch('/api/productos')).json()).find(p => p.id === id)?.stockActual, id);
    let expected = 3;
    assert.equal(await stock(), expected);
    for (const n of [5, 12, 1]) {
      await page.locator(`[data-ajuste-mas="${id}"]`).click();
      await page.locator('#oc-cant-n').fill(String(n));
      await page.locator('#oc-cantidad-modal [data-cant-sumar]').click();
      await page.locator('#oc-motivo-modal [data-mot]').first().click();
      expected += n;
      await page.waitForFunction(async ([id, want]) => (await (await fetch('/api/productos')).json()).find(p => p.id === id)?.stockActual === want, [id, expected], { timeout: 15000 })
        .catch(async () => assert.fail(`stock after +${n} is ${await stock()} (expected ${expected}); errors: ${errors.join(' | ')}`));
      await page.waitForTimeout(300);
    }
    const ajustes = await page.evaluate(async () => (await (await fetch('/api/actividad')).json()).filter(m => m.tipo === 'ajuste' && m.detalle?.producto === 'Synthetic manual add').length);
    assert.equal(ajustes, 3, 'three confirmed manual additions create exactly three adjustments');
    assert.deepEqual(errors.filter(e => !/favicon|ERR_FAILED|net::/.test(e)), [], 'no page errors or crashes');
    await ctx.close();
  } finally { if (web) await web.close(); await new Promise(resolve => srv.close(resolve)); }
});
