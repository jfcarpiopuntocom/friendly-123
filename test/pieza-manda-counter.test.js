// LA PIEZA MANDA (Belen/idiomARTE 2026-09-30): "2 personas compraron en la puerta... el programa
// dice que si es counter no se comisiona". Con comisionista o % puestos en la PIEZA, COUNTER SALE
// dejaba la venta 100% casa. Ahora la pieza manda; COUNTER SALE sigue valiendo para piezas sin nada.
// Rojas contra el shell v428 salvo las marcadas "fijacion".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

let n = 0;
const bc = () => 'PM-' + Date.now().toString(36) + (n++);
const ventas = (w) => w.request('/api/ventas/todas');
async function base() {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const est = await w.request('/api/promotoras', 'POST', { nombre: 'Esteban', comisionBase: 60 });
  const propia = await w.request('/api/ubicaciones', 'POST', { nombre: 'Eventos', tipo: 'propio' });
  const prod = (extra) => w.request('/api/productos', 'POST', Object.assign({ nombre: 'Obra ' + bc(), barcode: bc(), precio: 100, costo: 0, stockInicial: 9, ubicacionId: propia.id }, extra));
  return { w, est, propia, prod };
}

test('1. counter sale of a piece with its own associate is still commissioned to that associate', async () => {
  const { w, est, prod } = await base();
  const p = await prod({ comisionistaId: est.id });
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2, modoComision: 'counter' });
  assert.ok(r && !r.error, JSON.stringify(r));
  const v = (await ventas(w)).find((x) => x.productoId === p.id);
  assert.ok(Number(v.comisionAsociado) > 0, 'the associate gets paid');
  assert.notEqual(v.modoComision, 'counter');
  assert.equal(+(v.comisionAsociado + v.netoCasa).toFixed(2), 200);
});

test('2. counter sale and associate sale of the same piece give the same split (no contradiction)', async () => {
  const { w, est, prod } = await base();
  const p = await prod({ comisionistaId: est.id });
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: est.id });
  const vs = (await ventas(w)).filter((x) => x.productoId === p.id).map((x) => x.comisionAsociado);
  assert.equal(vs.length, 2); assert.equal(vs[0], vs[1]);
});

test('fijacion: a piece with nothing of its own on an own rack stays a pure house sale', async () => {
  const { w, prod } = await base();
  const p = await prod({});
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  const v = (await ventas(w)).find((x) => x.productoId === p.id);
  assert.equal(v.modoComision, 'counter'); assert.equal(Number(v.comisionAsociado) || 0, 0);
});

test('fijacion: the piece associate was deleted: the counter sale still goes through as a house sale (never blocked)', async () => {
  const { w, est, prod } = await base();
  const p = await prod({ comisionistaId: est.id });
  await w.request(`/api/promotoras/${est.id}`, 'DELETE');
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  assert.ok(r && !r.error, JSON.stringify(r));
  assert.equal((await ventas(w)).find((x) => x.productoId === p.id).modoComision, 'counter');
});

test('UI: the sale form of a piece with its own associate does not offer House sale, and the sale is commissioned', async () => {
  const path = require('node:path'); const { pathToFileURL } = require('node:url');
  const { chromium } = require('playwright');
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await page.evaluate(async () => {
      const req = async (url, method = 'GET', body) => (await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })).json();
      const est = await req('/api/promotoras', 'POST', { nombre: 'UI Esteban', comisionBase: 60 });
      const rack = await req('/api/ubicaciones', 'POST', { nombre: 'UI Eventos', tipo: 'propio' });
      const conPieza = await req('/api/productos', 'POST', { nombre: 'UI obra', barcode: 'UI-PM-1', precio: 50, costo: 0, stockInicial: 3, ubicacionId: rack.id, comisionistaId: est.id });
      const sinNada = await req('/api/productos', 'POST', { nombre: 'UI casa', barcode: 'UI-PM-2', precio: 50, costo: 0, stockInicial: 3, ubicacionId: rack.id });
      await abrirPanelVentaInfo(conPieza.id, false);
      const opts1 = Array.from(document.getElementById('vi-comisionista').options).map((o) => o.value);
      const val1 = document.getElementById('vi-comisionista').value;
      await confirmarVentaConInfo(conPieza.id, false);
      await abrirPanelVentaInfo(sinNada.id, false);
      const opts2 = Array.from(document.getElementById('vi-comisionista').options).map((o) => o.value);
      cancelarPanelVentaInfo();
      const v = (await req('/api/ventas/todas')).find((x) => x.productoId === conPieza.id);
      return { opts1, val1, estId: est.id, opts2, com: v && v.comisionAsociado };
    });
    assert.ok(!r.opts1.includes('__counter__'), 'no contradictory House sale option');
    assert.equal(r.val1, r.estId, 'the piece associate is preselected');
    assert.equal(r.com, 30, '60% of 50');
    assert.ok(r.opts2.includes('__counter__'), 'fijacion: a piece without associate still offers House sale');
  } finally { await web.close(); }
});
