const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const lang of ['en', 'es']) test(`Advanced money (${lang}): actual house profit and unknown cash survive rendering and reload`, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCAuth && window.OCI18n && typeof cargarAvanzado === 'function');
    const rack = await page.evaluate(async lang => {
      OCAuth.rolActual = () => 'dueno'; OCI18n.setLang(lang);
      const req = async (url, method = 'GET', body) => {
        const r = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw Error(await r.text()); return r.json();
      };
      const person = await req('/api/promotoras', 'POST', { nombre: 'Synthetic payee', comisionBase: 80 });
      const u = await req('/api/ubicaciones', 'POST', { nombre: 'Synthetic profit rack', tipo: 'socio' });
      await req('/api/ubicaciones/' + u.id, 'PUT', { promotoraId: person.id });
      const p = await req('/api/productos', 'POST', { nombre: 'Synthetic item', barcode: 'ADV-MONEY', precio: 100, costo: 10, stockInicial: 2, ubicacionId: u.id });
      await req('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
      await req('/api/gastos', 'POST', { concepto: 'Synthetic service', monto: 5, categoria: 'services', ubicacionId: u.id });
      return u.id;
    }, lang);
    for (let pass = 0; pass < 2; pass++) {
      if (pass) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.OCAuth && typeof cargarAvanzado === 'function');
      }
      const rendered = await page.evaluate(async ({ rack, lang }) => {
        OCAuth.rolActual = () => 'dueno'; OCI18n.setLang(lang); ubicacionActual = rack;
        await cargarAvanzado();
        return { profit: document.getElementById('tablaPL').innerText, balance: document.getElementById('tablaBalance').innerText };
      }, { rack, lang });
      assert.match(rendered.profit, /(?:Net profit|Utilidad neta)[^\n]*5[.,]00/);
      assert.match(rendered.profit, /(?:Earned commissions|Comisiones devengadas)[^\n]*80[.,]00/);
      assert.match(rendered.balance, /(?:Estimated cash today|Efectivo estimado hoy)[^\n]*—/);
      assert.match(rendered.balance, /(?:Total assets|Total activos)[^\n]*—/);
    }
  } finally { await browser.close(); }
});
