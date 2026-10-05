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


test('v448 GOLDEN golden14: product view also keeps Pay in the app when the product belongs to one rack', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const href = await page.evaluate((datos) => {
      window.OCDashComisiones.pintarConDatos(datos);
      document.querySelector('[data-cm-vista="producto"]').click();
      const card = [...document.querySelectorAll('#cm .cm-card')].find(el => /Mountain print/.test(el.textContent));
      return card?.querySelector('a.pagar')?.getAttribute('href') || '';
    }, fx.datos);
    assert.equal(href, 'index.html#editar=comisiones:u1&mes=' + fx.mes);
  } finally {
    await web.close();
  }
});

test('v448 GOLDEN golden14: product view does not offer one-rack payment when the same product spans multiple racks', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const hasPay = await page.evaluate((datos) => {
      const clone = JSON.parse(JSON.stringify(datos));
      const commissioned = clone.ventas.filter(v => v.comisionPct != null);
      if (!commissioned.length) throw new Error('fixture requires commissioned sale');
      const copy = { ...commissioned[0], id: 'fixture-second-rack', ubicacionId: 'u2', ubicacionNombre: 'Second rack', liquidada: false };
      clone.ventas.push(copy);
      window.OCDashComisiones.pintarConDatos(clone);
      document.querySelector('[data-cm-vista="producto"]').click();
      const card = [...document.querySelectorAll('#cm .cm-card')].find(el => /Mountain print/.test(el.textContent));
      return !!card?.querySelector('a.pagar');
    }, fx.datos);
    assert.equal(hasPay, false);
  } finally {
    await web.close();
  }
});


test('v448 payout ledger: dashboard prefers exact payout-ledger due over stale legacy liquidada', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const result = await page.evaluate((datos) => {
      const clone = JSON.parse(JSON.stringify(datos));
      clone.ventas.forEach(v => {
        if (v.comisionPct != null) {
          v.liquidada = false;              // intentionally stale compatibility flag
          v.comisionPendiente = 0;          // ledger is authoritative
        }
      });
      (clone.liquidaciones || []).forEach(l => { l.stillDue = 0; l.estado = 'pagado'; });
      window.OCDashComisiones.pintarConDatos(clone);
      document.querySelector('[data-cm-vista="producto"]').click();
      const text = document.getElementById('cm').innerText;
      return { hasPay: !!document.querySelector('#cm a.pagar'), text };
    }, fx.datos);
    assert.equal(result.hasPay, false);
    assert.doesNotMatch(result.text, /Still to pay\s+\$?[1-9]/i);
  } finally {
    await web.close();
  }
});
