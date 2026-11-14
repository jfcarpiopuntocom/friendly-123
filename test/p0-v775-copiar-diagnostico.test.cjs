'use strict';
// v775 (JFC 13 nov 2026, «dale greenlight»): Advanced has a «Copy diagnostics» button that shows/copies ONLY the device's
// own reload and error logs, version and browser. Never the license or business data. Real Chromium, synthetic license.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, enterAs, go, chromium } = require('./helpers/e2e-app.cjs');

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser.close(); await new Promise(r => server.srv.close(r)); });

test('Copy diagnostics shows the reload and error logs and nothing of the business', async () => {
  const { ctx, page } = await openDevice(browser, server.base, { license: 'F123-SYNTHETIC-DIAG-ONLY' });
  try {
    await enterAs(page, 'dueno', 'es');
    await page.evaluate(() => {
      localStorage.setItem('f123_recargas_log', JSON.stringify([{ m: 'prueba-recarga', t: 1, v: 'f123-shell-v775' }]));
      localStorage.setItem('f123_errores_log', JSON.stringify([{ k: 'error', m: 'prueba-error', s: 'x.js', t: 2 }]));
    });
    await go(page, 'avanzado');
    await page.waitForSelector('#oc-copiar-diag', { state: 'attached', timeout: 15000 });
    await page.evaluate(() => document.getElementById('oc-copiar-diag').click());
    await page.waitForFunction(() => { const c = document.getElementById('oc-diag-texto'); return c && c.value; }, null, { timeout: 5000 });
    const texto = await page.evaluate(() => document.getElementById('oc-diag-texto').value);
    const d = JSON.parse(texto);
    assert.equal(d.recargas[0].m, 'prueba-recarga');
    assert.equal(d.errores[0].m, 'prueba-error');
    assert.deepEqual(Object.keys(d).sort(), ['ahora', 'errores', 'recargas', 'ua', 'v']);
    assert.doesNotMatch(texto, /F123-|SYNTHETIC/, 'never the license');
  } finally { await ctx.close(); }
});
