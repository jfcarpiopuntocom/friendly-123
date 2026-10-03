const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('Record a payment stays usable while balance integrity is still verifying', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });

    const r = await page.evaluate(async () => {
      const req = async (url, method = 'GET', body, fetcher = window.fetch) => {
        const res = await fetcher(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        return data;
      };

      const c = await req('/api/clientes', 'POST', { nombre: 'Fixture Payment Integrity' });
      await req(`/api/clientes/${c.id}/fiar`, 'POST', { monto: 10, motivo: 'fixture debt' });
      const before = await req(`/api/clientes/${c.id}/cartera`);

      window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno' });
      const originalFetch = window.fetch.bind(window);

      window.fetch = async function (url, options) {
        const res = await originalFetch(url, options);
        if (String(url) === `/api/clientes/${c.id}/cartera` &&
            (!options || !options.method || options.method === 'GET')) {
          const data = await res.clone().json();
          data.integridad = { ok: false, razon: 'fixture sequence gap' };
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return res;
      };

      const host = document.createElement('div');
      host.id = 'cartera-' + c.id;
      document.body.appendChild(host);
      await pintarSaldoCartera(c.id);

      const button = host.querySelector('button[onclick*="ocPagarDeuda"]');
      const warningVisible = /Balance pending verification/.test(host.textContent || '');
      const debtVisible = /Debt\s+\$10\.00/.test(host.textContent || '');

      if (button) button.click();
      await new Promise(resolve => setTimeout(resolve, 60));

      const modal = document.getElementById('pp-modal-abono');
      const modalOpened = !!modal;
      if (modal) {
        modal.querySelector('#pp-ab-monto').value = '4';
        modal.querySelector('#pp-ab-ok').click();
      }
      await new Promise(resolve => setTimeout(resolve, 140));

      const after = await req(`/api/clientes/${c.id}/cartera`, 'GET', undefined, originalFetch);
      const modalClosed = !document.getElementById('pp-modal-abono');

      window.fetch = originalFetch;
      return {
        buttonVisible: !!button,
        warningVisible,
        debtVisible,
        modalOpened,
        modalClosed,
        before: before.saldo,
        after: after.saldo
      };
    });

    assert.equal(r.buttonVisible, true);
    assert.equal(r.warningVisible, true);
    assert.equal(r.debtVisible, true);
    assert.equal(r.modalOpened, true);
    assert.equal(r.modalClosed, true);
    assert.equal(r.before, -10);
    assert.equal(r.after, -6);
  } finally {
    await browser.close();
  }
});
