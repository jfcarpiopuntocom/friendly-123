'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const URL = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
const SALES = Array.from({ length: 40 }, (_, i) => ({
  id: 'perf-s-' + i,
  fecha: '2026-11-21',
  cantidad: 1,
  precioUnit: 25,
  productoId: 'perf-p-' + (i % 20),
  productoNombre: 'Perf Item ' + (i % 20),
  sku: 'SKU-' + (i % 20),
  ubicacionId: 'perf-u-' + (i % 5),
  ubicacionNombre: 'Rack ' + (i % 5),
  clienteId: 'perf-c-' + (i % 8),
  clienteNombre: 'Customer ' + (i % 8),
  promotoraId: 'perf-a-' + (i % 4),
  asociadoNombre: 'Artist ' + (i % 4),
  comisionAsociado: 5,
  netoCasa: 20,
  comisionPendiente: 5,
  direccionComision: 'casaPaga',
  direccionProducto: 'casaPaga',
  formaPago: 'cash',
}));

for (const engine of [chromium, webkit]) {
  test(`Commissions perf (${engine.name()}): lazy filter dropdowns and incremental multi-group toggles`, async () => {
    let browser;
    try {
      browser = await engine.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(URL, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__ocMockBackendReady &&
        typeof window.resumenComisionesGlobalHtml === 'function' &&
        typeof window.cambiarRangoComisionesGlobal === 'function' &&
        !!window.F123CommissionsByPerson);
      await page.addStyleTag({ content: '#oc-gate,#puerta,#oc-splash{display:none!important;pointer-events:none!important}#vista-comisiones{display:block!important}' });

      await page.evaluate((sales) => {
        window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false });
        window._ocComFiltrosAbiertos = {};
        window._ocComFiltros = { comisionista: [], producto: [], percha: [], cliente: [] };
        window._ocComHistoryGroups = ['producto'];
        window._ocComHistoryGroup = 'producto';
        window._ocComHistorySales = sales;
        const cont = document.getElementById('listaComisiones');
        cont.innerHTML = barraComisionesHtml([], '') + resumenComisionesGlobalHtml(sales);
        window.__primaryHeaderRef = cont.querySelector('[data-commissions-summary="all"]');
      }, SALES);

      // 1. Closed filter <details> must not inject eager checkbox DOM nodes.
      const closedCheckboxes = await page.locator('[data-com-filtro-lista] input[type="checkbox"]').count();
      assert.equal(closedCheckboxes, 0, 'closed filter dropdowns must render 0 checkboxes until opened');

      // 2. Opening a filter <details> populates its checkboxes immediately and filters sales.
      await page.locator('[data-com-filtro-lista="producto"] summary').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-com-filtro-lista="producto"] input[type="checkbox"]').length === 20);
      const prodCheckboxes = await page.locator('[data-com-filtro-lista="producto"] input[type="checkbox"]').count();
      assert.equal(prodCheckboxes, 20, 'opening Product filter must lazily populate all 20 options');

      // Close filter again and reset header marker before testing incremental multi-group toggles.
      await page.locator('[data-com-filtro-lista="producto"] summary').click();
      await page.evaluate(() => {
        window.__primaryHeaderRef = document.querySelector('#listaComisiones [data-commissions-summary="all"]');
      });

      // 3. Toggling secondary groups ON and OFF must reuse existing primary section DOM node (incremental update).
      await page.locator('[data-commissions-view-global="percha"]').click();
      await page.locator('[data-commissions-view-global="cliente"]').click();
      const stateAfterAdd = await page.evaluate(() => {
        const secs = Array.from(document.querySelectorAll('#listaComisiones [data-commissions-summary="all"]'));
        const keys = Array.from(document.querySelectorAll('#listaComisiones [data-comm-history-group]'))
          .map(el => el.getAttribute('data-comm-group'));
        return {
          reusedPrimary: secs[0] === window.__primaryHeaderRef,
          views: secs.map(s => s.dataset.commissionsCurrentView),
          uniqueKeys: new Set(keys).size === keys.length,
          hasProdKey: keys.some(k => k.startsWith('["producto",')),
          hasRackKey: keys.some(k => k.startsWith('["percha",')),
          hasCustKey: keys.some(k => k.startsWith('["cliente",')),
          filterCards: document.querySelectorAll('#listaComisiones [data-com-filtros]').length,
        };
      });
      assert.equal(stateAfterAdd.reusedPrimary, true, 'adding secondary groups must not destroy/rebuild primary section');
      assert.deepEqual(stateAfterAdd.views, ['producto', 'percha', 'cliente']);
      assert.equal(stateAfterAdd.uniqueKeys, true, 'detail keys must remain collision-free');
      assert.equal(stateAfterAdd.hasProdKey, true);
      assert.equal(stateAfterAdd.hasRackKey, true);
      assert.equal(stateAfterAdd.hasCustKey, true);
      assert.equal(stateAfterAdd.filterCards, 1, 'exactly one filter card across multi-group view');

      // 4. Turning off a secondary group removes only that section without rebuilding primary.
      await page.locator('[data-commissions-view-global="percha"]').click();
      const stateAfterRemove = await page.evaluate(() => {
        const secs = Array.from(document.querySelectorAll('#listaComisiones [data-commissions-summary="all"]'));
        return {
          reusedPrimary: secs[0] === window.__primaryHeaderRef,
          views: secs.map(s => s.dataset.commissionsCurrentView),
        };
      });
      assert.equal(stateAfterRemove.reusedPrimary, true, 'removing secondary group must keep primary section intact');
      assert.deepEqual(stateAfterRemove.views, ['producto', 'cliente']);
    } finally {
      if (browser) await browser.close();
    }
  });
}
