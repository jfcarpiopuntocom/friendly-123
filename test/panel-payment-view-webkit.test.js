const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright');

test('WebKit native payment modal preserves selected license and reopened draft', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../docs/panel.html'), 'utf8');
  const start = source.indexOf('/* ── PAGOS (asientos append-only por licencia)');
  const end = source.indexOf('/* ── LOTES', start);
  assert(start > 0 && end > start);
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    // Use the real form markup, but never run the admin gate or contact a Worker.
    await page.setContent(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    await page.addScriptTag({ content: `
      ${source.match(/^let _licIndice[^\n]+/m)[0]}
      const _licData = [{instanceId:'synthetic-a',licenseCode:'fixture-a'},
        {instanceId:'synthetic-b',licenseCode:'fixture-b'}];
      const requests = [];
      function licWorkerUrl() { return 'https://invalid.example'; }
      function licMasterKey() { return 'synthetic-not-a-key'; }
      function licEsc(value) { return String(value ?? ''); }
      function licReindexar() {}
      function mostrarConfirmacion() {}
      window.fetch = (url, options) => new Promise(resolve => requests.push({url, options, resolve}));
      ${source.slice(start, end)}
    ` });
    const result = await page.evaluate(async () => {
      const get = id => document.getElementById(id);
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      const payment = monto => ({ monto, moneda: 'USD', fecha: '2026-10-24', medio: 'synthetic' });
      const reply = async (request, body) => {
        request.resolve({ ok: true, json: async () => body }); await tick();
      };
      licAbrirPago('synthetic-a'); licAbrirPago('synthetic-b');
      await reply(requests[1], { pagos: [payment(22)] });
      const selectedHistory = get('lic-pago-historial').innerHTML;
      await reply(requests[0], { pagos: [payment(11)] });
      const selectedPreserved = get('lic-pago-historial').innerHTML === selectedHistory;
      get('lic-pago-monto').value = '12.50';
      const saved = licGuardarPago();
      licCerrarPago(); licAbrirPago('synthetic-b');
      await reply(requests[3], { pagos: [] });
      get('lic-pago-monto').value = '42';
      await reply(requests[2], { resumen: { total: 12.5, moneda: 'USD', n: 1 } }); await saved;
      await reply(requests[4], { pagos: [payment(12.5)] });
      return { selectedPreserved, draft: get('lic-pago-monto').value,
        history: get('lic-pago-historial').textContent,
        storedTotal: _licData.find(record => record.instanceId === 'synthetic-b').pagoResumen.total,
        modalDisplay: get('lic-pago-modal').style.display };
    });
    assert.equal(result.selectedPreserved, true);
    assert.equal(result.draft, '42'); assert.match(result.history, /12\.50/);
    assert.equal(result.storedTotal, 12.5); assert.equal(result.modalDisplay, 'flex');
    await context.close();
  } finally { await browser.close(); }
});
