// JFC 2026-10-01: canarios.js manda a Sentry/PostHog SOLO errores, fallos, flujos y checksums.
// Se fija: (1) ningun dato del negocio sale (nombres, montos, licencias, correos);
// (2) un fallo silencioso AVISA pero no suma a "errores" (lo que frena promover.yml);
// (3) la foto que no abre dispara su canario. En file:// no se envia nada a la red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function app(fn) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    const salidas = [];
    page.on('request', (r) => { if (/sentry\.io|posthog\.com/.test(r.url())) salidas.push(r.url()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await page.evaluate(fn);
    r.salidas = salidas;
    return r;
  } finally { await web.close(); }
}

test('nada del negocio sale; fallo avisa sin sumar a errores', async () => {
  const r = await app(async () => {
    const antes = OCSalud.resumen().errores;
    OCSalud.fallo('inventario', 'foto-no-abre');
    OCCanarios.error('No se encontro "Spray de la verdad" precio 12.50 licencia F123-ABCD-EFGH-IJKL de ana@x.com', 'https://x/docs/index.html', 77, 'Error\n at f (https://x/docs/mock-backend.js:120:5)');
    await new Promise((s) => setTimeout(s, 50));
    return { antes, despues: OCSalud.resumen().errores, ultimos: JSON.stringify(OCCanarios.ultimos()) };
  });
  assert.equal(r.despues, r.antes, 'un fallo silencioso no suma a errores');
  for (const prohibido of ['Spray', '12.50', '12,50', 'F123-ABCD', 'ana@x.com']) assert.ok(!r.ultimos.includes(prohibido), 'salio: ' + prohibido);
  assert.match(r.ultimos, /foto-no-abre/);
  assert.match(r.ultimos, /mock-backend\.js:#|mock-backend\.js:120/);
  assert.equal(r.salidas.length, 0, 'en file:// no se envia nada');
});

test('la foto propia que no abre dispara el canario foto-no-abre', async () => {
  const r = await app(async () => {
    const d = document.createElement('div');
    d.innerHTML = bloqueFoto({ id: 'x', nombre: 'A B', foto: 'data:image/jpeg;base64,roto' }, []);
    d.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); document.body.appendChild(d);
    await new Promise((s) => setTimeout(s, 400));
    return { ultimos: JSON.stringify(OCCanarios.ultimos()) };
  });
  assert.match(r.ultimos, /foto-no-abre/);
});
