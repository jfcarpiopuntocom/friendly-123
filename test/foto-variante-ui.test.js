// JFC 2026-10-01: la variante "Spray de la verdad - Bourgeois" quedo gris tras cambiarle la foto.
// (1) una foto propia que no abre debe caer a la de la familia, no a las iniciales;
// (2) un archivo que no se puede leer debe AVISAR y no fingir que guardo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function app(fn, archivo) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const ids = await page.evaluate(async (PNG) => {
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const u = (await req('/api/ubicaciones'))[0];
      const base = await req('/api/productos', 'POST', { nombre: 'Spray de la verdad', barcode: 'T009', sku: 'T009', precio: 10, stockInicial: 6, ubicacionId: u.id, foto: PNG });
      const v = await req('/api/productos', 'POST', { nombre: 'Spray de la verdad Bourgeois', barcode: 'T009-B', sku: 'T009-B', precio: 10, stockInicial: 2, ubicacionId: u.id, familiaId: 'T009', productoBaseId: base.id, varianteAtributo: 'Brand', varianteValor: 'Bourgeois' });
      return { base: base.id, v: v.id };
    }, PNG);
    return await fn(page, ids, archivo);
  } finally { await web.close(); }
}

test('variante con foto propia rota muestra la foto de la familia', async () => {
  const r = await app(async (page, ids) => page.evaluate(async (ids) => {
    await fetch('/api/productos/' + ids.v, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ foto: 'data:image/jpeg;base64,roto' }) });
    await cargarInventario(); await new Promise((r) => setTimeout(r, 1200));
    const caja = [...document.querySelectorAll('.caja')].find((c) => c.innerText.includes('Bourgeois'));
    const img = caja && caja.querySelector('.fotowrap img');
    const i0 = caja && caja.querySelector('.fotowrap img'); if (i0) { i0.loading = 'eager'; document.body.appendChild(caja); } await new Promise((r) => setTimeout(r, 800)); const vis = caja && caja.offsetParent !== null; const i2 = caja && caja.querySelector('.fotowrap img'); return { img: !!i2 && i2.complete && i2.naturalWidth > 0, dbg: 'vis=' + vis + ' ' + (caja ? caja.querySelector('.fotowrap').outerHTML.slice(0, 300) : 'sin caja') };
  }, ids));
  assert.ok(r.img, r.dbg + ' ' + 'la tarjeta muestra una imagen (la de la familia), no solo iniciales');
});

test('archivo ilegible: avisa y no guarda en silencio', async () => {
  const f = path.join(os.tmpdir(), 'no-es-foto.jpg'); fs.writeFileSync(f, 'esto no es una imagen');
  const r = await app(async (page, ids) => {
    await page.evaluate(async (id) => { await mostrarFormEditarProducto(id); }, ids.v);
    await page.setInputFiles('#ed-foto', f);
    return page.evaluate(async (id) => { await guardarEdicionProducto(id); return (document.getElementById('ed-msg') || {}).textContent || ''; }, ids.v);
  });
  assert.match(r, /could not be read|No se pudo leer/);
});
