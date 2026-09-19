const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('label print actions call the current page print dialog synchronously', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const result = await page.evaluate(() => {
      let calls = 0;
      window.print = () => { calls += 1; };
      window._etiquetaActual = { p: { id: 'fixture' }, data: {} };
      imprimirEtiquetaCompleta();
      const afterFull = calls;
      imprimirSoloBarcode('<svg></svg>', { barcode: 'fixture' });
      return { afterFull, afterBarcode: calls, barcodeMode: document.body.classList.contains('oc-print-barcode-only'), href: location.href };
    });
    assert.equal(result.afterFull, 1);
    assert.equal(result.afterBarcode, 2);
    assert.equal(result.barcodeMode, true);
    assert.match(result.href, /index\.html$/);
  } finally {
    await browser.close();
  }
});
