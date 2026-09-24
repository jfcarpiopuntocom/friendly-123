// Browser regression: the Commissions summary opens by product/SKU and switches live.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('product/SKU is default and the rack/event switch updates panels and ARIA', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      document.getElementById('vista-comisiones').hidden = false;
      await cargarComisiones();
    });

    const state = async () => page.evaluate(() => ({
      productHidden: document.getElementById('comm-panel-product').hidden,
      rackHidden: document.getElementById('comm-panel-rack').hidden,
      productSelected: document.getElementById('comm-tab-product').getAttribute('aria-selected'),
      rackSelected: document.getElementById('comm-tab-rack').getAttribute('aria-selected'),
    }));

    assert.deepEqual(await state(), {
      productHidden: false, rackHidden: true, productSelected: 'true', rackSelected: 'false'
    });

    await page.locator('[data-commissions-view="rack"]').evaluate((button) => button.click());
    assert.deepEqual(await state(), {
      productHidden: true, rackHidden: false, productSelected: 'false', rackSelected: 'true'
    });

    await page.locator('[data-commissions-view="product"]').evaluate((button) => button.click());
    assert.deepEqual(await state(), {
      productHidden: false, rackHidden: true, productSelected: 'true', rackSelected: 'false'
    });
  } finally {
    await browser.close();
  }
});
