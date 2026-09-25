// Corrida Hugo / Paco / Luis POR LA INTERFAZ (JFC 2026-09-25, tras el caso del Spray).
// Leccion: el bug del Spray paso todas las pruebas porque llamaban directo al backend; la
// PANTALLA no mandaba a la persona elegida. Aqui la venta pasa por las funciones del panel
// real (abrirPanelVentaInfo / confirmarVentaConInfo) en Chromium, y se mira lo que Commissions
// PINTA en pantalla, no solo lo que responde la API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function conApp(fn) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    return await page.evaluate(fn);
  } finally { await web.close(); }
}

test('Paco: vende en percha PROPIA eligiendo a una persona; Commissions lo pinta', async () => {
  const r = await conApp(async () => {
    const req = async (u, m = 'GET', b) => { const x = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined }); return x.json(); };
    const pr = await req('/api/promotoras', 'POST', { nombre: 'Paco Seller', comisionBase: 20 });
    const own = await req('/api/ubicaciones', 'POST', { nombre: 'Own counter', tipo: 'propio' });
    const p = await req('/api/productos', 'POST', { nombre: 'UI Spray', barcode: 'UI-SPRAY', precio: 10, costo: 4, stockInicial: 5, ubicacionId: own.id });
    await abrirPanelVentaInfo(p.id, false);
    document.getElementById('vi-comisionista').value = pr.id;
    await confirmarVentaConInfo(p.id, false);
    const v = (await req('/api/ventas/todas')).find((x) => x.productoId === p.id);
    await cargarComisiones();
    const txt = (document.getElementById('listaComisiones') || document.body).innerText;
    const rk = (document.getElementById('rankingComisiones') || document.body).innerText;
    return { com: v && v.comisionAsociado, nombre: v && v.asociadoNombre, pinta: txt.includes('Paco Seller'), ranking: rk.includes('Paco Seller') && /1 sold/.test(rk) };
  });
  assert.equal(r.com, 2);
  assert.equal(r.nombre, 'Paco Seller');
  assert.ok(r.pinta, 'Commissions muestra a la persona');
  assert.ok(r.ranking, 'el ranking dice 1 sold');
});

test('Hugo: percha compartida con otra persona fija; la elegida cobra y la percha no cambia', async () => {
  const r = await conApp(async () => {
    const req = async (u, m = 'GET', b) => { const x = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined }); return x.json(); };
    const fija = await req('/api/promotoras', 'POST', { nombre: 'Fixed One', comisionBase: 50 });
    const hugo = await req('/api/promotoras', 'POST', { nombre: 'Hugo Seller', comisionBase: 10 });
    const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Shared', tipo: 'socio' });
    await req(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: fija.id });
    const p = await req('/api/productos', 'POST', { nombre: 'UI Mug', barcode: 'UI-MUG', precio: 20, stockInicial: 5, ubicacionId: rack.id });
    await abrirPanelVentaInfo(p.id, false);
    document.getElementById('vi-comisionista').value = hugo.id;
    await confirmarVentaConInfo(p.id, false);
    const v = (await req('/api/ventas/todas')).find((x) => x.productoId === p.id);
    const rackDespues = (await req('/api/ubicaciones')).find((u) => u.id === rack.id);
    return { com: v && v.comisionAsociado, nombre: v && v.asociadoNombre, fija: rackDespues.promotoraId === fija.id };
  });
  assert.equal(r.com, 2, '10 % de Hugo');
  assert.equal(r.nombre, 'Hugo Seller');
  assert.ok(r.fija, 'el asociado fijo de la percha no cambio');
});

test('Luis: elige persona, se arrepiente a venta de la casa, y confirma dos veces rapido', async () => {
  const r = await conApp(async () => {
    const req = async (u, m = 'GET', b) => { const x = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined }); return x.json(); };
    const pr = await req('/api/promotoras', 'POST', { nombre: 'Luis Seller', comisionBase: 30 });
    const own = await req('/api/ubicaciones', 'POST', { nombre: 'Own 2', tipo: 'propio' });
    const p = await req('/api/productos', 'POST', { nombre: 'UI Candle', barcode: 'UI-CANDLE', precio: 10, stockInicial: 5, ubicacionId: own.id });
    await abrirPanelVentaInfo(p.id, false);
    const sel = document.getElementById('vi-comisionista');
    sel.value = pr.id; sel.value = '__counter__';
    await Promise.all([confirmarVentaConInfo(p.id, false), confirmarVentaConInfo(p.id, false)]);
    const vs = (await req('/api/ventas/todas')).filter((x) => x.productoId === p.id);
    const stock = (await req('/api/productos')).find((x) => x.id === p.id).stockActual;
    return { n: vs.length, com: vs[0] && vs[0].comisionAsociado, modo: vs[0] && vs[0].modoComision, stock };
  });
  assert.equal(r.n, 1, 'doble toque = una sola venta');
  assert.equal(r.stock, 4);
  assert.equal(r.modo, 'counter');
  assert.equal(r.com, 0);
});
