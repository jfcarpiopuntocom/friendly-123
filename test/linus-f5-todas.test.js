// Revision nivel Linus, Bloque 4 (JFC 2026-09-26): F5 y navegacion en TODAS las secciones.
// f5-posicion.test.js probaba solo Sold y Commissions. Aqui se recorre cada boton del nav
// (lista leida del HTML, asi una seccion nueva entra sola) como dueno: se entra, se recarga
// con F5 real y se exige (1) la misma seccion activa, (2) su <section> visible y con
// contenido, (3) cero errores de JavaScript en toda la vuelta. Tambien ida y vuelta rapida
// entre secciones (Luis tocando el nav sin esperar) sin errores.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const URL_APP = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

test('Bloque 4: cada seccion del nav sobrevive a F5 como dueno, sin errores de JS', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 800 } });
    const errores = [];
    page.on('pageerror', (e) => errores.push(String(e && e.message || e)));
    await page.goto(URL_APP, { waitUntil: 'networkidle' });
    await page.evaluate(() => sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const vistas = await page.evaluate(() => [...new Set([...document.querySelectorAll('nav button[data-vista]')].map((b) => b.dataset.vista))]);
    assert.ok(vistas.length >= 8, 'el nav tiene sus secciones: ' + vistas.join(','));
    const fallos = [];
    for (const v of vistas) {
      await page.click(`nav button[data-vista="${v}"]`);
      await page.waitForTimeout(600);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const r = await page.evaluate((v) => {
        const b = document.querySelector('nav button.activo');
        const s = document.getElementById(v) || document.querySelector(`section[data-vista="${v}"]`) || document.getElementById('vista-' + v);
        const visible = !!s && s.offsetParent !== null && s.getBoundingClientRect().height > 40;
        return { activa: b && b.dataset.vista, visible, texto: s ? s.innerText.trim().length : 0 };
      }, v);
      if (r.activa !== v) fallos.push(`${v}: tras F5 quedo en ${r.activa}`);
      else if (!r.visible || r.texto < 10) fallos.push(`${v}: la seccion no se ve o esta vacia (${JSON.stringify(r)})`);
    }
    assert.deepEqual(fallos, [], fallos.join('\n'));
    // Luis: toca el nav sin esperar que pinte.
    for (let i = 0; i < 3; i++) for (const v of vistas) await page.click(`nav button[data-vista="${v}"]`);
    await page.waitForTimeout(1500);
    assert.deepEqual(errores, [], 'errores de JS: ' + errores.join(' | '));
  } finally { await web.close(); }
});
