'use strict';
// RED (incidente v605): importar un respaldo se "deshace" al cerrar y reabrir la app.
// Causa: /api/respaldo/importar (mock-backend.js ~6993) reemplaza el store local pero NO toca el
// Y.Doc persistido en IndexedDB (f123-yjs-<room>). Al reabrir, el merge doc->store (aplicarCatalogo
// / sembrar, LWW por stockTs + union max de stockPN) trae de vuelta el ajuste -3 que el respaldo no tenia.
// Sin red, datos sinteticos, 1 solo contexto de Chromium con perfil persistente.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { startServer, chromium } = require('./helpers/e2e-app.cjs');

async function abrir(base, dir) {
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    try { localStorage.getItem('f123_owned') || localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-AUDIT-ONLY' })); } catch (_) {}
    window.WebSocket = class { constructor() { throw new Error('no network in e2e'); } };
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.OCSync && window.cargarHoy);
  await page.evaluate(() => { OCAuth.rolActual = () => 'dueno'; });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const J = (page, u, m, b) => page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m || 'GET', body: b ? JSON.stringify(b) : undefined });
  return r.json();
}, [u, m, b]);

// (JFC 2026-10-28) Regla: bloquear importar si el doc Yjs local ya tiene datos (doc Yjs local con datos, o "dispositivos" con id ajeno).
// C = prueba decisiva (cierra y reabre con perfil persistente).
async function sembrarYAjustar(page) {
  const p = await J(page, '/api/productos', 'POST', { nombre: 'P', barcode: 'P1', precio: 10, costo: 4, stockInicial: 10 });
  const respaldo = await J(page, '/api/respaldo/exportar');
  await J(page, '/api/productos/' + p.id + '/ajustar', 'POST', { delta: -3, motivo: 'b' });
  return { p, respaldo };
}
const importar = (page, b) => page.evaluate(async b => { const x = await fetch('/api/respaldo/importar', { method: 'POST', body: JSON.stringify(b) }); return { st: x.status, j: await x.json() }; }, b);
const stock = async (page, id) => (await J(page, '/api/productos')).find(x => x.id === id).stockActual;

test('cuaderno sincronizado con otro aparato: importar -> 409, nada cambia, tampoco tras reabrir (stock 7)', async () => {
  const { srv, base } = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-import-'));
  try {
    let { ctx, page } = await abrir(base, dir);
    const { p, respaldo } = await sembrarYAjustar(page);
    // Otro aparato ya escribio su entrada en el doc compartido (add-only, se guarda en IndexedDB).
    await page.evaluate(() => OCYjs.set('dispositivos', 'otro-aparato-sintetico', { id: 'otro-aparato-sintetico', apodo: 'Otro', rol: '' }));
    await page.waitForTimeout(800);
    const r = await importar(page, respaldo);
    assert.equal(r.st, 409);
    assert.match(r.j.errorEs, /Restaurar un respaldo solo se puede en un aparato nuevo, sin datos/);
    assert.equal(await stock(page, p.id), 7, 'sin cambios en memoria');
    await ctx.close();
    ({ ctx, page } = await abrir(base, dir));
    const despues = await stock(page, p.id);
    await ctx.close();
    assert.equal(despues, 7, 'tras reabrir sigue 7');
  } finally { srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
});

test('aparato solo con datos (sin otros aparatos): importar -> 409, memoria igual y tras reabrir sigue 7', async () => {
  const { srv, base } = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-import-'));
  try {
    let { ctx, page } = await abrir(base, dir);
    const { p, respaldo } = await sembrarYAjustar(page);
    await page.waitForTimeout(800); // el doc Yjs local se escribe en segundo plano
    const r = await importar(page, respaldo);
    assert.equal(r.st, 409);
    assert.match(r.j.errorEs, /lo restaurado se desharía al reabrir/);
    assert.equal(await stock(page, p.id), 7);
    await ctx.close();
    ({ ctx, page } = await abrir(base, dir));
    const despues = await stock(page, p.id);
    await ctx.close();
    assert.equal(despues, 7);
  } finally { srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
});

test('cuaderno vacio / aparato nuevo: importar funciona y sobrevive a cerrar y reabrir', async () => {
  const { srv, base } = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-import-'));
  try {
    let { ctx, page } = await abrir(base, dir);
    const respaldo = await J(page, '/api/respaldo/exportar');
    respaldo.ubicaciones = [{ id: 'u-i', nombre: 'Shelf I', tipo: 'propio' }];
    respaldo.productos = [{ id: 'p-i', nombre: 'Imported', barcode: 'IMP1', precio: 10, costo: 4, stockActual: 10, ubicacionId: 'u-i' }];
    assert.equal((await importar(page, respaldo)).st, 200);
    await ctx.close();
    ({ ctx, page } = await abrir(base, dir));
    const despues = (await J(page, '/api/productos')).find(x => x.id === 'p-i');
    await ctx.close();
    assert.ok(despues, 'el producto importado sigue tras reabrir');
    assert.equal(despues.stockActual, 10);
  } finally { srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
});
