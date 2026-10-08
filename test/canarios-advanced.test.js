/* SPLIT 2026-10-08 (Claude): las dos pruebas de Advanced (franja del canario y aviso de hora) viven aqui (venian de
   test/canarios-app.test.js) SIN cambiar ninguna asercion. Motivo: este archivo sumaba ~98 s en la laptop
   y pasaba el limite de 120 s por archivo en CI (release-control fallo por timeout en v470 y en una rama
   que solo traia tests). Partirlo no relaja ninguna verificacion. */
// Plan canarios F3 (JFC 2026-09-25): canario dentro de la app, en Chromium real con los tres
// canales servidos desde un servidor local (mismo origen = mismos datos).
// La licencia lord de verdad NO puede ir al repo: el servidor de prueba reemplaza su huella en
// index.html/salud-app.js por la de una licencia de prueba. Asi se prueba el MECANISMO real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DOCS = path.join(__dirname, '../docs');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const LORD_PRUEBA = 'F123-DOBLE-DE-PRUEBA';
function h53(str) { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return 4294967296 * (2097151 & h2) + (h1 >>> 0); }

function servidor() {
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/friendly-123\/(next\/|previo\/)?(.*)$/.exec(u);
    if (!m) { res.writeHead(404); return res.end(); }
    u = '/' + (m[2] || 'index.html');
    const f = path.join(DOCS, u);
    if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    let cuerpo = fs.readFileSync(f);
    if (/\.(html|js)$/.test(u)) cuerpo = Buffer.from(cuerpo.toString('utf8').split('6583453063440131').join(String(h53(LORD_PRUEBA))));
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  });
}
// Este servidor sustituye bytes para una identidad ficticia: su manifest no es
// el artefacto publicado. Los SW tienen su suite propia; aqui deben pasar por
// las rutas del fixture (incluida la cabecera Date simulada), sin cache del SW.
async function conServidor(fn) {
  const srv = servidor(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const web = await chromium.launch({ headless: true });
  try { return await fn(web, `http://127.0.0.1:${srv.address().port}/friendly-123/`); }
  finally { await web.close(); srv.close(); }
}
// networkidle no prueba que el cargador secuencial haya terminado. Bajo carga
// el fixture llegaba a medirCuadre con OCSalud undefined y el panel sin inicializar.
async function lista(page) {
  await page.waitForFunction(() => window.OCCargador && window.OCCargador.estado().listo && window.OCSalud && window.OCLatencia, null, { timeout: 20000 });
}
async function aparato(ctx, base, licencia) {
  const page = await ctx.newPage();
  await page.goto(base + '?estable=1', { waitUntil: 'networkidle' }); // primera carga: sembrar sin moverse
  await lista(page);
  await page.evaluate((lic) => {
    localStorage.removeItem('f123_canal_propio');
    localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'inst-canario-test', licenseCode: lic }));
    sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' }));
  }, licencia);
  return page;
}

test('franja del canario en Advanced: la ve el aparato lord como dueno, no un cliente', async () => {
  await conServidor(async (web, base) => {
    const ver = async (lic) => {
      const ctx = await web.newContext({ serviceWorkers: 'block' });
      const page = await aparato(ctx, base, lic);
      await page.goto(base + 'next/', { waitUntil: 'networkidle' });
      await lista(page);
      await page.waitForTimeout(2500);
      await page.click('nav button[data-vista="avanzado"]');
      await page.waitForTimeout(3000);
      return page.evaluate(() => { const f = document.getElementById('oc-canario-franja'); return { vis: !!f && getComputedStyle(f).display !== 'none', txt: (document.getElementById('oc-canario-linea') || {}).textContent || '' }; });
    };
    const lord = await ver(LORD_PRUEBA);
    assert.equal(lord.vis, true);
    assert.match(lord.txt, /This device: CANARY \(next\) · f123-shell-v\d+/);
    const cliente = await ver('F123-CLIENTE-DE-PRUEBA');
    assert.equal(cliente.vis, false);
  });
});

/* v427 (JFC 2026-09-30): el aviso de hora es para TODO dueno, no solo el lord. Se prueba con
   un aparato CLIENTE. Prueba nueva (no de fijacion): sin el aviso este test es rojo. */
test('aviso de hora en Advanced: un cliente dueno lo ve con el reloj corrido, y no lo ve con la hora buena', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext({ serviceWorkers: 'block' });
    const page = await aparato(ctx, base, 'F123-CLIENTE-DE-PRUEBA');
    await page.goto(base + 'next/', { waitUntil: 'networkidle' });
    await lista(page);
    await page.waitForTimeout(2500);
    await page.click('nav button[data-vista="avanzado"]');
    await page.waitForTimeout(3500);
    const leer = () => page.evaluate(() => { const n = document.getElementById('oc-reloj-aviso'); return { vis: !!n && n.getBoundingClientRect().height > 0 /* de verdad en pantalla, no solo display del nodo */, txt: n ? n.textContent : '', px: n ? parseFloat(getComputedStyle(n).fontSize) : 0 }; });
    assert.equal((await leer()).vis, false, 'sin reloj comun no hay aviso');
    await page.evaluate(() => { const t = Date.now(); window.OCLatencia.anotarPing(t, t + 10 + 6 * 60 * 1000, t + 20); });
    await page.waitForTimeout(3500);
    // v436 (JFC 2026-10-01): un solo testigo (el relay) ya no basta; el servidor de la app
    // (cabecera Date de version.json) dice la hora buena -> no se acusa al aparato.
    assert.equal((await leer()).vis, false, 'solo el relay corrido: no acusa al aparato');
    // Segundo testigo de acuerdo: el servidor tambien va 6 min adelante del aparato.
    let clockRequests = 0;
    await page.route('**/version.json?reloj=*', (r) => { clockRequests++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}',
      headers: { Date: new Date(Date.now() + 6 * 60 * 1000).toUTCString() } }); });
    await page.evaluate(() => { window.OCLatencia.reiniciar(); const t = Date.now(); window.OCLatencia.anotarPing(t, t + 10 + 6 * 60 * 1000, t + 20); });
    await page.reload({ waitUntil: 'networkidle' });
    await lista(page);
    await page.waitForTimeout(2500);
    await page.click('nav button[data-vista="avanzado"]');
    await page.evaluate(() => { const t = Date.now(); window.OCLatencia.anotarPing(t, t + 10 + 6 * 60 * 1000, t + 20); });
    await page.waitForTimeout(7000);
    assert.ok(clockRequests > 0, 'el segundo testigo debe pasar por la ruta de reloj simulada');
    const malo = await leer();
    assert.equal(malo.vis, true);
    assert.match(malo.txt, /Clock warning: .* about 6 minutes behind/);
    assert.ok(malo.px >= 16, 'legible: 16px o mas');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    await page.evaluate(() => { window.OCLatencia.reiniciar(); const t = Date.now(); window.OCLatencia.anotarPing(t, t + 10, t + 20); });
    await page.waitForTimeout(3500);
    assert.equal((await leer()).vis, false, 'con la hora buena el aviso se esconde solo');
  });
});

