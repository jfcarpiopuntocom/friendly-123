// Diagnostico de Advanced solo en el aparato de JFC (JFC 2026-09-25: "puede causar horribles
// problemas a los usuarios que no sean yo, a menos que solo me salga a mi"). La linea "Sync:",
// la linea "Code:" y la caja del origen del codigo nacen ocultas; se ven solo en la licencia
// lord de JFC entrando como dueno (huella cyrb53, la licencia nunca va al repo) o si el aparato
// tiene un canario puesto (salida de emergencia). La rama "licencia lord" no se puede probar
// aqui sin escribir la licencia: se prueban las otras dos y que la medicion siga viva.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const URL_APP = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

async function advanced({ canario }) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(URL_APP, { waitUntil: 'networkidle' });
    await page.evaluate((c) => {
      sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' }));
      // Un negocio cualquiera (no la licencia lord). Valor de prueba, no es una licencia real.
      localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'test-inst', licenseCode: 'TEST-OTRO-NEGOCIO' }));
      if (c) localStorage.setItem('f123_origen_codigo', c); else localStorage.removeItem('f123_origen_codigo');
    }, canario || '');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.click('nav button[data-vista="avanzado"]');
    await page.waitForTimeout(4500);
    return await page.evaluate(() => {
      const vis = (id) => { const n = document.getElementById(id); return !!n && getComputedStyle(n).display !== 'none'; };
      const sync = document.getElementById('oc-sync-estado-min');
      return { hay: !!sync, sync: vis('oc-sync-estado-min'), code: vis('oc-codigo-estado'), caja: vis('oc-codigo-canario'),
        textoSync: sync ? sync.textContent : '' };
    });
  } finally { await web.close(); }
}

test('dueno de otro negocio: no ve Sync, Code ni la caja del origen; la medicion sigue', async () => {
  const r = await advanced({});
  assert.ok(r.hay, 'el panel de sync existe');
  assert.equal(r.sync, false, 'linea Sync oculta');
  assert.equal(r.code, false, 'linea Code oculta');
  assert.equal(r.caja, false, 'caja del origen oculta');
  assert.notEqual(r.textoSync.trim(), 'Sync: …', 'el pintor sigue escribiendo en el nodo oculto');
});

test('aparato con canario puesto: se ve la salida para volver a github.io', async () => {
  const r = await advanced({ canario: 'https://friendly-123.jfcarpio.workers.dev/' });
  assert.equal(r.code, true, 'linea Code visible');
  assert.equal(r.caja, true, 'caja con "Back to github.io" visible');
});
