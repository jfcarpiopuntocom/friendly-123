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
async function conServidor(fn) {
  const srv = servidor(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const web = await chromium.launch({ headless: true });
  try { return await fn(web, `http://127.0.0.1:${srv.address().port}/friendly-123/`); }
  finally { await web.close(); srv.close(); }
}
async function aparato(ctx, base, licencia) {
  const page = await ctx.newPage();
  await page.goto(base + '?estable=1', { waitUntil: 'networkidle' }); // primera carga: sembrar sin moverse
  await page.evaluate((lic) => {
    localStorage.removeItem('f123_canal_propio');
    localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'inst-canario-test', licenseCode: lic }));
    sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' }));
  }, licencia);
  return page;
}

test('aparato lord: la direccion de los clientes lo lleva solo a /next/ con los mismos datos', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, LORD_PRUEBA);
    await page.evaluate(() => localStorage.setItem('f123_marca_datos', 'mismo-cuaderno'));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/next\/$/, { timeout: 8000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('f123_marca_datos')), 'mismo-cuaderno', 'mismos datos en /next/');
    // Salida: ?estable=1 lo deja en el estable y lo recuerda.
    await page.goto(base + '?estable=1', { waitUntil: 'networkidle' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    assert.doesNotMatch(page.url(), /\/next\//, 'con la salida puesta se queda en el estable');
  });
});

test('aparato de un cliente: nunca se mueve de la direccion estable', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, 'F123-CLIENTE-DE-PRUEBA');
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    assert.doesNotMatch(page.url(), /\/next\//);
  });
});

test('salud: solo campos de la lista blanca; cuadre "ok" con ventas mezcladas (sin rojo falso)', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, LORD_PRUEBA);
    await page.goto(base + 'next/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async () => {
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const pr = await req('/api/promotoras', 'POST', { nombre: 'Canary Seller', comisionBase: 25 });
      const propia = await req('/api/ubicaciones', 'POST', { nombre: 'Own canary', tipo: 'propio' });
      const comp = await req('/api/ubicaciones', 'POST', { nombre: 'Shared canary', tipo: 'socio' });
      await req(`/api/ubicaciones/${comp.id}`, 'PUT', { promotoraId: pr.id });
      const a = await req('/api/productos', 'POST', { nombre: 'Canary A', barcode: 'CAN-A', precio: 12.34, costo: 5, stockInicial: 9, ubicacionId: comp.id });
      const b = await req('/api/productos', 'POST', { nombre: 'Canary B', barcode: 'CAN-B', precio: 7.1, costo: 2, stockInicial: 9, ubicacionId: propia.id });
      await req(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 3, modoComision: 'associate', promotoraId: pr.id });
      await req(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
      await req(`/api/productos/${b.id}/venta`, 'POST', { cantidad: 2, modoComision: 'associate', promotoraId: pr.id });
      await req(`/api/productos/${b.id}/venta`, 'POST', { cantidad: 1 });
      const cuadre = await window.OCSalud.medirCuadre();
      return { cuadre, resumen: window.OCSalud.resumen() };
    });
    assert.equal(r.cuadre, 'ok', 'Sold y Commissions cuadran: no hay rojo falso');
    assert.deepEqual(Object.keys(r.resumen).sort(), ['caidas', 'canal', 'cuadre', 'errores', 'mezcla', 'nodos', 'retenido', 'shell']);
    assert.equal(r.resumen.canal, 'next');
    assert.match(r.resumen.shell, /^f123-shell-v\d+$/);
  });
});

test('salud: un error de JavaScript en la sesion se cuenta', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, LORD_PRUEBA);
    await page.goto(base + 'next/', { waitUntil: 'networkidle' });
    const antes = await page.evaluate(() => window.OCSalud.resumen().errores);
    await page.evaluate(() => { setTimeout(() => { throw new Error('canario de prueba'); }, 0); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.OCSalud.resumen().errores), antes + 1);
  });
});

test('salud: un descuadre real entre Sold y Commissions se detecta como "fallo"', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, LORD_PRUEBA);
    await page.goto(base + 'next/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(async () => {
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const u = await req('/api/ubicaciones', 'POST', { nombre: 'Own drift', tipo: 'propio' });
      const p = await req('/api/productos', 'POST', { nombre: 'Drift', barcode: 'DRIFT-1', precio: 10, stockInicial: 5, ubicacionId: u.id });
      await req(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
      // Commissions diria un centavo menos que Sold: exactamente el tipo de bug que no debe llegar a clientes.
      const orig = window.fetch;
      window.fetch = async (url, o) => {
        const res = await orig(url, o);
        if (String(url).includes('/api/comisiones/cuadre')) { const j = await res.json(); j.totalVentas = +(j.totalVentas - 0.01).toFixed(2); return new Response(JSON.stringify(j)); }
        return res;
      };
      try { return await window.OCSalud.medirCuadre(); } finally { window.fetch = orig; }
    });
    assert.equal(r, 'fallo');
  });
});

test('franja del canario en Advanced: la ve el aparato lord como dueno, no un cliente', async () => {
  await conServidor(async (web, base) => {
    const ver = async (lic) => {
      const ctx = await web.newContext();
      const page = await aparato(ctx, base, lic);
      await page.goto(base + 'next/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      await page.click('nav button[data-vista="avanzado"]');
      await page.waitForTimeout(3000);
      return page.evaluate(() => { const f = document.getElementById('oc-canario-franja'); return { vis: !!f && getComputedStyle(f).display !== 'none', txt: (document.getElementById('oc-canario-linea') || {}).textContent || '' }; });
    };
    const lord = await ver(LORD_PRUEBA);
    assert.equal(lord.vis, true);
    assert.match(lord.txt, /This device: CANARY \(next\) · shell-v448 GOLDEN/);
    const cliente = await ver('F123-CLIENTE-DE-PRUEBA');
    assert.equal(cliente.vis, false);
  });
});

/* v427 (JFC 2026-09-30): el aviso de hora es para TODO dueno, no solo el lord. Se prueba con
   un aparato CLIENTE. Prueba nueva (no de fijacion): sin el aviso este test es rojo. */
test('aviso de hora en Advanced: un cliente dueno lo ve con el reloj corrido, y no lo ve con la hora buena', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, 'F123-CLIENTE-DE-PRUEBA');
    await page.goto(base + 'next/', { waitUntil: 'networkidle' });
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
    await page.route('**/version.json?reloj=*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}',
      headers: { Date: new Date(Date.now() + 6 * 60 * 1000).toUTCString() } }));
    await page.evaluate(() => { window.OCLatencia.reiniciar(); const t = Date.now(); window.OCLatencia.anotarPing(t, t + 10 + 6 * 60 * 1000, t + 20); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.click('nav button[data-vista="avanzado"]');
    await page.evaluate(() => { const t = Date.now(); window.OCLatencia.anotarPing(t, t + 10 + 6 * 60 * 1000, t + 20); });
    await page.waitForTimeout(7000);
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

/* v428 (JFC 2026-09-30): invariantes al arrancar. Se siembra por el importador de respaldo una
   venta con dinero partido y otra con la percha vacia; tras reiniciar: el dinero SOLO se avisa
   (el monto malo queda igual) y la percha vacia se llena desde el producto. Prueba nueva. */
test('invariantes al arrancar: avisa el dinero partido sin tocarlo y llena la percha vacia', async () => {
  await conServidor(async (web, base) => {
    const ctx = await web.newContext();
    const page = await aparato(ctx, base, 'F123-CLIENTE-DE-PRUEBA');
    await page.goto(base + 'next/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const sembrado = await page.evaluate(async () => {
      const exp = await (await fetch('/api/respaldo/exportar')).json();
      exp.ubicaciones = [{ id: 'u-t', nombre: 'Shelf T', tipo: 'propio' }];
      exp.productos = [{ id: 'p-t', nombre: 'Product T', precio: 10, costo: 4, stockActual: 5, ubicacionId: 'u-t' }];
      const p = exp.productos[0];
      const base = { productoId: p.id, cantidad: 2, precioUnit: 10, costoUnit: 4, fecha: new Date().toISOString(), liquidada: false, clienteId: null };
      exp.ventas = [
        Object.assign({ id: 'v-mala', ubicacionId: p.ubicacionId }, base, { split: { montoBruto: 20, montoComisionSocio: 6, montoNetoDueno: 13 } }),
        Object.assign({ id: 'v-vacia', ubicacionId: '' }, base, { split: null }),
      ];
      const r = await fetch('/api/respaldo/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exp) });
      return { ok: r.ok, ubi: p.ubicacionId };
    });
    assert.equal(sembrado.ok, true, 'el respaldo sembrado se importo');
    const bufferUbi = () => page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); try { const b = JSON.parse(localStorage.getItem(k)); const v = b && b.ventas && b.ventas.find((x) => x.id === 'v-vacia'); if (v) return v.ubicacionId; } catch (_) {} } return null; });
    assert.equal(await bufferUbi(), '', 'antes de reiniciar la venta guardada trae la percha vacia (prueba de que el llenado es de v428)');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const inf = await page.evaluate(async () => (await fetch('/api/invariantes')).json());
    assert.equal(await bufferUbi(), sembrado.ubi, 'tras reiniciar, la percha vacia quedo guardada llena');
    assert.equal(inf.revisado, true);
    assert.ok(inf.avisos.some((a) => a.codigo === 'dinero-partido' && a.ventaId === 'v-mala'));
    const netoGuardado = await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); try { const b = JSON.parse(localStorage.getItem(k)); const v = b && b.ventas && b.ventas.find((x) => x.id === 'v-mala'); if (v) return v.split.montoNetoDueno; } catch (_) {} } return null; });
    assert.equal(netoGuardado, 13, 'el dinero malo NO se reescribe: sigue guardado tal cual');
    await page.click('nav button[data-vista="avanzado"]');
    await page.waitForTimeout(3500);
    const caja = await page.evaluate(() => { const n = document.getElementById('oc-invariantes-aviso'); return { vis: !!n && n.getBoundingClientRect().height > 0, txt: n ? n.textContent : '', px: n ? parseFloat(getComputedStyle(n).fontSize) : 0 }; });
    assert.equal(caja.vis, true);
    assert.match(caja.txt, /Data check: 1 sale looks inconsistent .*Nothing was changed/);
    assert.ok(caja.px >= 16);
    if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });
  });
});
