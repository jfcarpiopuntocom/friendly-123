'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('an expense can be allocated to an existing shelf before its first sale', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCExpenseReceipt && window.OCAuth);
    const result = await page.evaluate(async () => {
      OCAuth.rolActual = () => 'dueno';
      const request = async (url, method = 'GET', body) => {
        const response = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      const shelf = await request('/api/ubicaciones', 'POST', { nombre: 'Synthetic upcoming workshop', tipo: 'propio' });
      await cargarGastos();
      const select = document.getElementById('gastoDestino');
      const hasShelf = [...select.options].some(option => option.value === 'shelf:' + shelf.id);
      if (!hasShelf) return { hasShelf };
      select.value = 'shelf:' + shelf.id;
      document.getElementById('gastoConcepto').value = 'Synthetic preparation cost';
      document.getElementById('gastoMonto').value = '15';
      document.getElementById('gastoMetodoPago').value = 'transfer';
      const canvas = document.createElement('canvas');
      canvas.width = 300; canvas.height = 200;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 300, 200);
      context.fillStyle = '#000'; context.fillText('Synthetic receipt $15', 20, 40);
      const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const files = new DataTransfer();
      files.items.add(new File([photo], 'synthetic-receipt.png', { type: 'image/png' }));
      document.getElementById('gastoFoto').files = files.files;
      await registrarGasto();
      const saved = (await request('/api/gastos')).gastos.find(expense => expense.concepto === 'Synthetic preparation cost');
      await OCExpenseReceipt.open(saved.facturaFotoHash);
      const receiptShown = !!document.querySelector('dialog[open] img[src^="data:image/jpeg;base64,"]');
      return { hasShelf, shelfId: shelf.id, saved, receiptShown, sales: await request('/api/ventas/todas') };
    });
    assert.equal(result.hasShelf, true, 'A real shelf with no sales must be available for its preparation costs');
    assert.equal(result.saved.ubicacionId, result.shelfId);
    assert.equal(result.saved.metodoPago, 'transfer');
    assert.equal(result.saved.monto, 15);
    assert.match(result.saved.facturaFotoHash, /^[a-f0-9]{64}$/);
    assert.equal(result.receiptShown, true);
    assert.doesNotMatch(JSON.stringify(result.saved), /data:image/);
    assert.equal(result.sales.filter(sale => sale.ubicacionId === result.shelfId).length, 0);
  } finally {
    await browser.close();
  }
});
