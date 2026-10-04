/* v448 GOLDEN hotfix regression: dashboard -> app must preserve the exact
   Commissions month. A payment deep-link without the month can highlight the
   right rack while leaving the app on a different period, which is unsafe for
   money. These are isolated Playwright fixtures; no real customer data/network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const fx = require('./helpers/dashboard-comisiones-fixture.cjs');

test('RED v448: dashboard Pay in the app carries the selected commission month', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const links = await page.evaluate(({ datos, prev }) => {
      window.OCDashComisiones.pintarConDatos(datos);
      document.querySelector('[data-cm-vista="percha"]').click();
      const current = document.querySelector('#cm a.pagar')?.getAttribute('href') || '';
      const sel = document.getElementById('cm-mes');
      sel.value = prev;
      sel.dispatchEvent(new Event('change'));
      const past = document.querySelector('#cm a.pagar')?.getAttribute('href') || '';
      return { current, past };
    }, { datos: fx.datos, prev: fx.prev });
    assert.equal(links.current, 'index.html#editar=comisiones:u1&mes=' + fx.mes);
    assert.equal(links.past, 'index.html#editar=comisiones:u1&mes=' + fx.prev);
  } finally {
    await web.close();
  }
});

test('RED v448: app commission deep-link restores its month before opening Commissions', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const selected = await page.evaluate(async (prev) => {
      _ocMesComisiones = null;
      location.hash = '#editar=comisiones:u1&mes=' + encodeURIComponent(prev);
      await procesarDeepLinkEditar();
      return _ocMesComisiones;
    }, fx.prev);
    assert.equal(selected, fx.prev);
  } finally {
    await web.close();
  }
});
