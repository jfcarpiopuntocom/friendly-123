'use strict';
// C250 post-deploy WebKit: an associate with sales only in older months stays
// present in All dates Persona after every list repaint. No production writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('WebKit: an older-month-only associate survives All dates -> repaint -> selection -> repaint', async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failures = [];
    page.on('pageerror', error => failures.push(String(error.message)));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, {waitUntil:'load'});
    await page.waitForFunction(() => window.OCCommissionHistory &&
      window.F123CommissionsByPerson && typeof window.cargarComisiones === 'function');
    await page.addStyleTag({content:'#oc-gate,#puerta,#oc-splash{display:none!important;pointer-events:none!important}'});
    const sales = [
      { id:'prior-only', fecha:'2026-09-12T12:00:00Z', fechaLocal:'2026-09-12', mes:'2026-09',
        productoId:'p-old', productoNombre:'Antique', ubicacionId:'r-old', ubicacionNombre:'Old rack',
        promotoraId:'artist-prior', asociadoNombre:'Prior Artist',
        cantidad:1, precioUnit:35, comisionAsociado:7, netoCasa:28 },
      { id:'current-only', fecha:'2026-11-12T12:00:00Z', fechaLocal:'2026-11-12', mes:'2026-11',
        productoId:'p-now', productoNombre:'Poster', ubicacionId:'r-now', ubicacionNombre:'Now rack',
        promotoraId:'artist-current', asociadoNombre:'Current Artist',
        cantidad:1, precioUnit:50, comisionAsociado:10, netoCasa:40 }
    ];
    await page.evaluate(async sales => {
      const original = window.fetch.bind(window);
      window.fetch = (url, init) => String(url).includes('/ventas/todas')
        ? Promise.resolve({ok:true,json:async()=>sales})
        : String(url).includes('/liquidaciones')
          ? Promise.resolve({ok:true,json:async()=>[]})
          : original(url,init);
      const view=document.getElementById('vista-comisiones');
      view.hidden=false;view.style.display='block';view.classList.add('activa');
      window._ocMesComisiones=null;
      window._ocComDesde=''; window._ocComHasta='';
      window._ocComFiltros={};
      await window.cargarComisiones();
    }, sales);
    await page.locator('#comm-tab-person').click();
    await page.waitForFunction(() => {
      const select=document.querySelector('[data-commissions-person-select]');
      return !!select && Array.from(select.options).some(x=>x.value==='artist-prior')
        && Array.from(select.options).some(x=>x.value==='artist-current');
    });
    await page.waitForFunction(() => !!document.querySelector('[data-cm-person-id="artist-prior"]'));
    await page.selectOption('[data-commissions-person-select]','artist-prior');
    await page.waitForFunction(() => {
      const el=document.querySelector('#comm-panel-person');
      return el && el.textContent.includes('Prior Artist') && !el.textContent.includes('Current Artist');
    });
    await page.evaluate(async () => window.cargarComisiones());
    await page.waitForFunction(() => {
      const select=document.querySelector('[data-commissions-person-select]');
      return select && select.value==='artist-prior'
        && !!document.querySelector('[data-cm-person-id="artist-prior"]');
    });
    assert.equal(await page.locator('#comm-panel-person [data-cm-person-id]').count(),1);
    assert.equal(await page.locator('#comm-panel-person [data-cm-person-id="artist-prior"]').count(),1);
    assert.deepEqual(failures,[],'WebKit must not crash during repaint');
  } finally { await browser.close(); }
});
