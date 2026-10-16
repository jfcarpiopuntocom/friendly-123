'use strict';
const { test, before, after } = require('node:test');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const docs = path.resolve(__dirname, '../docs');
let server, origin;
before(async () => {
  server = http.createServer((req, res) => {
    const file = path.resolve(docs, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(docs + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });


test('Spanish quarter report shows exact net result, downloads a real PDF and refuses a stale invalid export', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin + '/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCFinanceReport);
    assert.equal(await page.evaluate(() => typeof window.jspdf), 'undefined', 'PDF tools load only when exporting');
    await page.evaluate(() => {
      // This isolated financial module fixture supplies synthetic data directly;
      // dashboard-demand-loading tests the real PIN/session cancellation path.
      OCDashboardExports.captureSession = () => () => true;
      localStorage.setItem('f123_lang', 'es');
      OCFinanceReport.update({ ventas: [{ id: 's', fecha: '2026-10-16', cantidad: 1, precioUnit: 100, costoUnit: 10, comisionAsociado: 40, netoCasa: 60, ubicacionId: 'bar', ubicacionNombre: 'Bar' }], gastos: [{ id: 'g', monto: 15, fecha: '2026-10-16', categoria: 'services', ubicacionId: 'bar' }, { id: 'empty', monto: 5, fecha: '2026-10-17', categoria: 'services', ubicacionId: 'no-sales' }], ajustesComision: [], cobertura: { ventas: true, gastos: true, ajustesComision: true, finanzasCoherentes: true } }, 'America/Guayaquil');
      document.getElementById('finance-month').value = '2026-10';
      document.getElementById('finance-cadence').value = 'quarterly';
      document.getElementById('finance-generate').click();
    });
    await page.waitForFunction(() => document.getElementById('finance-output').textContent.includes('Resultado neto Casa'));
    const result = await page.evaluate(async () => ({ text: document.getElementById('finance-output').textContent, report: await OCFinanceReport.buildReport() }));
    assert.equal(result.report.rows[0].result.houseAfterExpensesCents, 3000);
    assert.equal(result.report.rows.find(r => r.name === 'no-sales').result.houseAfterExpensesCents, -500);
    assert.match(result.text, /2026-10-01.*2026-12-31/);
    assert.match(result.text, /Resultado neto Casa/);
    const pending = page.waitForEvent('download');
    await page.evaluate(() => document.getElementById('finance-pdf').click());
    const download = await pending;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friendly-pdf-'));
    try {
      const checkDownload = async (file, language, title) => {
        const dest = path.join(dir, language + '.pdf');
        await file.saveAs(dest);
        const bytes = fs.readFileSync(dest), pdf = bytes.toString('latin1');
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.ok(bytes.length > 2000);
        assert.ok(pdf.includes(title), 'the downloaded PDF contains the selected language');
        assert.ok(pdf.includes('2026-10-01') && pdf.includes('2026-12-31'), 'quarter boundaries survive export');
        const amounts = await page.evaluate(language => {
          const money = new Intl.NumberFormat(language === 'es' ? 'es-EC' : 'en-US', { style: 'currency', currency: 'USD' });
          return [money.format(30), money.format(20), money.format(-5)];
        }, language);
        for (const amount of amounts) assert.ok(pdf.includes(amount), 'download preserves synthetic net result, expenses and expense-only group: ' + amount);
      };
      await checkDownload(download, 'es', 'Rentabilidad de la Casa');
      await page.evaluate(() => localStorage.setItem('f123_lang', 'en'));
      const english = page.waitForEvent('download');
      await page.evaluate(() => document.getElementById('finance-pdf').click());
      await checkDownload(await english, 'en', 'House profitability');
      await page.evaluate(() => localStorage.setItem('f123_lang', 'es'));
    } finally { fs.rmSync(dir, { recursive: true }); }
    await page.evaluate(() => { document.getElementById('finance-month').value = ''; document.getElementById('finance-pdf').click(); });
    await page.waitForFunction(() => document.getElementById('finance-status').textContent.includes('mes válido'));
    assert.match(await page.locator('#finance-status').textContent(), /mes válido/);
  } finally { await browser.close(); }
});

test('receipt capture writes bounded image separately and surfaces storage failure', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(docs, 'index.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCExpenseReceipt);
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 300, 400); ctx.fillStyle = '#000'; ctx.fillText('Synthetic invoice $15', 20, 40);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const input = { files: [new File([blob], 'receipt.png', { type: 'image/png' })] };
      let stored;
      window.OCFotos = { hashDeDataUrl: async () => 'b'.repeat(64), guardarPorHash: async (hash, bytes) => { stored = { hash, bytes }; return true; } };
      const hash = await OCExpenseReceipt.capture(input);
      OCFotos.guardarPorHash = async () => false;
      let error = ''; try { await OCExpenseReceipt.capture(input); } catch (e) { error = e.message; }
      return { hash, size: stored.bytes.length, type: stored.bytes.slice(0, 23), error };
    });
    assert.equal(result.hash, 'b'.repeat(64)); assert.ok(result.size <= 180000); assert.match(result.type, /data:image\/jpeg;base64/);
    assert.match(result.error, /not saved|No se guardó/);
  } finally { await browser.close(); }
});

test('a large comparison runs off the UI thread and refuses results from an outdated snapshot', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin + '/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCFinanceReport);
    const result = await page.evaluate(async () => {
      const snapshot = { ventas: Array.from({ length: 400 }, (_, i) => ({ id: 's' + i, fecha: '2026-10-16', cantidad: 1, precioUnit: 100, costoUnit: 10, comisionAsociado: 40, netoCasa: 60, ubicacionId: 'shelf-' + i % 20 })), gastos: [], ajustesComision: [], cobertura: { ventas: true, gastos: true, ajustesComision: true, finanzasCoherentes: true } };
      OCFinanceReport.update(snapshot, 'America/Guayaquil');
      document.getElementById('finance-month').value = '2026-10';
      let ticks = 0;
      const timer = setInterval(() => { ticks++; }, 1);
      const pending = OCFinanceReport.buildReport();
      setTimeout(() => OCFinanceReport.update(snapshot, 'America/Guayaquil'), 0);
      let error = '';
      try { await pending; } catch (e) { error = e.message; }
      clearInterval(timer);
      return { ticks, error };
    });
    assert.ok(result.ticks > 0, 'UI event loop receives updates while financial comparison runs');
    assert.match(result.error, /New data arrived|Llegaron datos nuevos/);
  } finally { await browser.close(); }
});
