'use strict';
// (JFC 2026-10-28) v605: (1) aviso visible cuando falla un guardado (oc-guardado-fallo), (2) anti doble toque en "crear producto".
// Los avisos y el wrapper se cargan del FUENTE y del bundle MINIFICADO en un VM con DOM falso; la ruta usa el harness real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

// ---- Alta de producto: re-entrada y boton deshabilitado (wrapper real, interno simulado) ----
for (const file of ['src/app/app-inline-01.js', 'docs/app-inline-01.min.js']) {
  test(file + ' - crearProductoNuevo: doble toque concurrente entra una vez; boton deshabilitado y restaurado en finally', async () => {
    const s = read(file);
    const a = s.indexOf('let _npCreando'), b = s.indexOf('async function _crearProductoNuevoInterno');
    assert(a > 0 && b > a, 'wrapper presente');
    const btn = { disabled: false }; let n = 0, soltar, vistoDeshab = null;
    const ctx = { document: { getElementById: () => ({ querySelectorAll: () => [btn] }) }, fichaTargetActual: 'x', Array, Promise,
      _crearProductoNuevoInterno: () => { n++; vistoDeshab = btn.disabled; return new Promise((r) => { soltar = r; }); } };
    vm.runInNewContext(s.slice(a, b) + ';this.f=crearProductoNuevo;', ctx);
    const p1 = ctx.f('X'), p2 = ctx.f('X'); await tick();
    assert.equal(n, 1, 'el segundo toque no entra'); assert.equal(vistoDeshab, true); assert.equal(btn.disabled, true);
    soltar(); await p1; await p2; assert.equal(btn.disabled, false, 'restaurado');
    const p3 = ctx.f('X'); await tick(); assert.equal(n, 2, 'despues de terminar vuelve a entrar'); soltar(); await p3;
    // error: tambien restaura
    ctx._crearProductoNuevoInterno = () => Promise.reject(new Error('boom'));
    await assert.rejects(ctx.f('X')); assert.equal(btn.disabled, false);
  });
}
// ---- Ruta: POST /api/productos con mismo codigo ----
function app() { const w = browser(); w.OCAuth = { rolActual: () => 'dueno' }; return w; }
const alta = (w, barcode, extra) => w.fetch('/api/productos', { method: 'POST', body: JSON.stringify(Object.assign({ nombre: 'Synthetic ' + barcode, barcode, precio: 5, costo: 2, stockInicial: 1 }, extra || {})) });
test('ruta: doble llamada concurrente con el mismo codigo -> exactamente 1 producto, la otra 409', async () => {
  const w = app();
  const rs = await Promise.all([alta(w, 'DUP-605'), alta(w, 'DUP-605')]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const exp = await w.request('/api/respaldo/exportar'); // estado crudo (la lista filtra por percha)
  assert.equal(exp.productos.filter((p) => p.barcode === 'DUP-605').length, 1);
});
test('ruta: mismo codigo despues -> 409 con mensaje de la rama de variantes; otro codigo se crea; sin codigo sigue 400', async () => {
  const w = app();
  assert.equal((await alta(w, 'ABC-1')).status, 200);
  const r = await alta(w, ' abc-1 ');
  assert.equal(r.status, 409); assert.match((await r.json()).error, /barcode or internal code is already used/);
  assert.equal((await alta(w, 'ABC-2')).status, 200);
  assert.equal((await alta(w, '')).status, 400, 'sin codigo: comportamiento anterior (400) sin cambios');
});
// ---- Sellar venta (carrito): re-entrada (JFC 2026-10-28). La ruta de venta no es idempotente por opId; la UI es la unica barrera. ----
for (const file of ['src/app/app-inline-01.js', 'docs/app-inline-01.min.js']) {
  test(file + ' - sellarVenta: doble toque concurrente entra una vez (aun antes de la confirmacion); boton restaurado', async () => {
    const s = read(file);
    const a = s.indexOf('let _sellando'), b = s.indexOf('async function _sellarVentaInterno');
    assert(a > 0 && b > a, 'wrapper presente');
    const btn = { disabled: false }; let n = 0, soltar;
    const ctx = { document: { getElementById: () => btn }, Promise,
      _sellarVentaInterno: () => { n++; return new Promise((r) => { soltar = r; }); } };
    vm.runInNewContext(s.slice(a, b) + ';this.f=sellarVenta;', ctx);
    const p1 = ctx.f(), p2 = ctx.f(); await tick();
    assert.equal(n, 1); assert.equal(btn.disabled, true);
    soltar(); await p1; await p2; assert.equal(btn.disabled, false);
    const p3 = ctx.f(); await tick(); assert.equal(n, 2); soltar(); await p3;
  });
}
