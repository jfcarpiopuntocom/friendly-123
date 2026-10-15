/* FLECHA DE COMISION en pantalla (JFC 2026-10-14, Belen). En Summary by Product el boton va ENTRE
   "Associate takes" y "House keeps"; al girarlo corrige todas las ventas del producto y Expenses
   muestra la plata en la direccion nueva (casa paga = gasto, asociado paga = ingreso), en EN y ES.
   Rojo contra backups/2026-10-14_flecha-comision: no hay boton ni tarjetas. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const lang of ['en', 'es']) {
  test(`commission arrow turns in Summary by Product and reaches Expenses (${lang})`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.OCAuth && typeof cargarComisiones === 'function' && typeof cargarGastos === 'function');
      const fx = await page.evaluate(async (lang) => {
        window.OCAuth.rolActual = () => 'dueno'; window.OCI18n.setLang(lang);
        document.querySelectorAll('[id*="gate"]').forEach(x => x.style.display = 'none');
        document.querySelectorAll('.vista').forEach(x => x.classList.remove('activa')); document.getElementById('vista-comisiones').classList.add('activa');
        const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, body: b ? JSON.stringify(b) : undefined })).json();
        const a = await req('/api/promotoras', 'POST', { nombre: 'Arrow teacher', comisionBase: 40 });
        const r = await req('/api/ubicaciones', 'POST', { nombre: 'Arrow rack', tipo: 'socio' });
        await req('/api/ubicaciones/' + r.id, 'PUT', { promotoraId: a.id });
        const p = await req('/api/productos', 'POST', { nombre: 'Arrow class', barcode: 'ARROW-1', precio: 100, costo: 0, stockInicial: 5, ubicacionId: r.id });
        await req('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
        await req('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
        window.confirm = () => true; window.alert = () => {};
        await cargarComisiones();
        return { p: p.id, casaPaga: window.t('flecha.casaPaga'), held: window.t('flecha.casaEnAsociado'), ingreso: window.t('flecha.ingresoMes'), gasto: window.t('flecha.gastoMes') };
      }, lang);
      const btn = page.locator(`[data-product-id="${fx.p}"] [data-comm-flecha] button`);
      assert.match(await btn.textContent(), new RegExp(fx.casaPaga));
      await btn.click();
      await page.waitForFunction((pid) => {
        const b = document.querySelector(`[data-product-id="${pid}"] [data-comm-flecha] button`);
        return b && b.getAttribute('data-flecha-dir') === 'asociadoPaga' && document.querySelector(`[data-product-id="${pid}"]`).textContent.includes(window.t('flecha.casaEnAsociado'));
      }, fx.p, { timeout: 8000 });
      const dirs = await page.evaluate(async (pid) => (await (await fetch('/api/ventas/todas?ubicacionId=todas')).json()).filter(v => v.productoId === pid).map(v => v.direccionComision), fx.p);
      assert.deepEqual(dirs, ['asociadoPaga', 'asociadoPaga']);
      const gastos = await page.evaluate(async () => {
        document.querySelectorAll('.vista').forEach(x => x.classList.remove('activa')); document.getElementById('vista-gastos').classList.add('activa');
        await cargarGastos(); return document.getElementById('gastosResumen').textContent;
      });
      assert.ok(gastos.includes(fx.ingreso), gastos);
      assert.ok(gastos.includes(fx.gasto), gastos);
      assert.match(gastos, /120[.,]00/);
      if (process.env.FLECHA_SHOT) await page.screenshot({ path: process.env.FLECHA_SHOT.replace('.png', `-${lang}.png`), fullPage: false });
    } finally { await browser.close(); }
  });
}
