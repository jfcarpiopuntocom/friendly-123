// F5 conserva seccion, desplegables, pestana de Commissions y scroll (JFC 2026-09-25,
// regla dura: "dejemos de parecer UX amateur"). Rojo contra el respaldo previo: ahi F5
// volvia siempre a Hoy. Se prueba con una RECARGA real en Chromium, no llamando funciones.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const URL_APP = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

async function conPagina(fn) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 700 } });
    await page.goto(URL_APP, { waitUntil: 'networkidle' });
    return await fn(page);
  } finally { await web.close(); }
}
// Sesion ya abierta en esta pestana (lo que deja un login con PIN), y recarga.
async function recargar(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500); // auto-login + reintentos de scroll (~3 s)
}
const activa = (page) => page.evaluate(() => { const b = document.querySelector('nav button.activo'); return b && b.dataset.vista; });

test('F5 vuelve a la misma seccion, con el desplegable abierto y el mismo scroll', async () => {
  await conPagina(async (page) => {
    await page.evaluate(() => sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })));
    await recargar(page);
    await page.click('nav button[data-vista="escanear"]');
    await page.evaluate(() => { document.getElementById('ventasSold').open = true; });
    await page.waitForTimeout(800);
    const y = await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const y = Math.min(500, max - 20); window.scrollTo(0, y); return Math.round(scrollY);
    });
    assert.ok(y > 150, 'la vista tiene por donde bajar (y=' + y + ')');
    await page.waitForTimeout(500);
    await recargar(page);
    assert.equal(await activa(page), 'escanear', 'misma seccion');
    assert.equal(await page.evaluate(() => document.getElementById('ventasSold').open), true, 'Sold sigue abierto');
    const y2 = await page.evaluate(() => Math.round(scrollY));
    assert.ok(Math.abs(y2 - y) <= 4, `mismo scroll: antes ${y}, despues ${y2}`);
  });
});

test('la pestana "by rack" de Commissions sobrevive a un repintado y a F5', async () => {
  await conPagina(async (page) => {
    await page.evaluate(() => sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })));
    await recargar(page);
    await page.click('nav button[data-vista="comisiones"]');
    await page.waitForTimeout(800);
    const sel = () => page.evaluate(() => { const b = document.querySelector('[data-commissions-view="rack"]'); return b && b.getAttribute('aria-selected'); });
    await page.evaluate(() => cambiarVistaComisiones('rack'));
    await page.evaluate(() => cargarComisiones()); // lo que hace una venta llegada de otro aparato
    assert.equal(await sel(), 'true', 'el repintado no la devuelve a by product');
    await page.waitForTimeout(500);
    await recargar(page);
    assert.equal(await activa(page), 'comisiones');
    assert.equal(await sel(), 'true', 'F5 mantiene by rack');
  });
});

test('cerrar sesion borra la posicion; sin sesion al cargar no se restaura nada', async () => {
  await conPagina(async (page) => {
    await page.evaluate(() => sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })));
    await recargar(page);
    await page.click('nav button[data-vista="clientes"]');
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => !!sessionStorage.getItem('f123_ui_pos')), 'se guardo la posicion');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('oc-logout')));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('f123_ui_pos')), null, 'logout la borra');
    // Posicion vieja pero la pagina carga SIN sesion (login nuevo con PIN): aterriza normal.
    await page.evaluate(() => { sessionStorage.removeItem('f123_sesion');
      sessionStorage.setItem('f123_ui_pos', JSON.stringify({ v: 'clientes', y: 0, d: [], c: 'product', rol: 'dueno', t: Date.now() })); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => { sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })); window.dispatchEvent(new CustomEvent('oc-login', { detail: { rol: 'dueno' } })); });
    await page.waitForTimeout(600);
    assert.notEqual(await activa(page), 'clientes', 'un login nuevo no salta a la posicion vieja');
  });
});
