// JFC 2026-09-30 (v431): en Commissions el resumen del mes va ARRIBA de "Summary by product" (ahi
// empieza la lista) y los productos sin comision van al final, plegados. Rojas contra el shell v430.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('Commissions: month summary first, commissioned products listed, the rest collapsed at the end', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const pg = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await pg.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(async () => {
      window.OCAuth = Object.assign({}, window.OCAuth, { rolActual: () => 'dueno' });
      const req = async (u, m = 'GET', bd) => (await fetch(u, { method: m, headers: bd ? { 'Content-Type': 'application/json' } : undefined, body: bd ? JSON.stringify(bd) : undefined })).json();
      const pr = await req('/api/promotoras', 'POST', { nombre: 'Esteban Orden', comisionBase: 60 });
      const own = await req('/api/ubicaciones', 'POST', { nombre: 'Propia Orden', tipo: 'propio' });
      const a = await req('/api/productos', 'POST', { nombre: 'ZZ Con comision', barcode: 'ORD-CC', precio: 50, stockInicial: 5, ubicacionId: own.id, comisionistaId: pr.id });
      const c = await req('/api/productos', 'POST', { nombre: 'ZZ Sin comision', barcode: 'ORD-SC', precio: 10, stockInicial: 5, ubicacionId: own.id });
      await req(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
      await req(`/api/productos/${c.id}/venta`, 'POST', { cantidad: 1 });
      document.querySelector('[data-vista="comisiones"]').click();
      await new Promise((res) => setTimeout(res, 2500));
      const sec = document.getElementById('comm-panel-product');
      const html = sec.innerHTML;
      const sin = document.getElementById('comm-sin-comision');
      const dentro = (n) => [...sec.querySelectorAll('[data-comm-product-card]')].find((x) => x.dataset.search.includes(n));
      const buscador = document.getElementById('comm-product-search');
      buscador.value = 'ZZ Sin'; buscador.dispatchEvent(new Event('input'));
      return {
        mesAntes: html.indexOf('comm-by-product-heading') > html.indexOf(document.querySelector('#comm-panel-product .tag-card').outerHTML.slice(0, 40)),
        headingDespuesDelMes: sec.innerText.indexOf('Everything sold') < sec.innerText.indexOf('Summary by product'),
        conFuera: !!dentro('ZZ Con') && !(sin && sin.contains(dentro('ZZ Con'))),
        sinDentro: !!(sin && sin.contains(dentro('ZZ Sin'))),
        abiertoAlBuscar: !!(sin && sin.open),
      };
    });
    assert.ok(r.headingDespuesDelMes, 'the month summary comes before Summary by product');
    assert.ok(r.conFuera, 'a commissioned product is in the main list');
    assert.ok(r.sinDentro, 'a product without commission is inside the collapsed group');
    assert.ok(r.abiertoAlBuscar, 'searching opens the collapsed group when it has a match');
  } finally { await web.close(); }
});
