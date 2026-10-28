'use strict';
// (JFC 2026-10-28) v605: (1) aviso visible cuando falla un guardado (oc-guardado-fallo), (2) anti doble toque en "crear producto".
// Los avisos y el wrapper se cargan del FUENTE y del bundle MINIFICADO en un VM con DOM falso; la ruta usa el harness real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

function el(tag) {
  const props = new Map(), attrs = {}, l = {};
  return { tag, id: '', type: '', textContent: '', attrs, l, h: 48, style: { setProperty: (k, v, p) => props.set(k, { v, p }), props },
    setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (ev, fn) => { l[ev] = fn; },
    getBoundingClientRect() { return { height: this.h }; }, remove() { this.gone = true; } };
}
function cargarAviso(file, { save } = {}) {
  const s = read(file);
  const k = s.indexOf('f123-aviso-guardado');
  const a = s.lastIndexOf('(function', k);
  const fin = s.indexOf('addEventListener("oc-guardado-fallo"', k);
  const e = s.indexOf('})()', fin);
  assert(k > 0 && a > 0 && fin > 0 && e > 0, 'IIFE del aviso presente en ' + file);
  const code = s.slice(a, e + 4);
  const body = [], timers = [], handlers = {};
  const document = { body: { appendChild: (x) => body.push(x) }, getElementById: (id) => body.find((x) => x.id === id && !x.gone) || null, createElement: (t) => el(t) };
  const win = { OCI18n: { getLang: () => ctx.lang }, OCSync: save ? { confirmarCatalogoDurable: save } : undefined,
    addEventListener: (ev, fn) => { handlers[ev] = fn; } };
  const ctx = { lang: 'es', window: win, document, Promise, Math, Object, console,
    setInterval: (fn, ms) => { timers.push({ fn, ms, k: 'i' }); return timers.length; }, clearInterval: (i) => { if (timers[i - 1]) timers[i - 1].off = true; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, k: 't' }); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].off = true; } };
  vm.runInNewContext(code, ctx);
  return { ctx, body, timers, win, fallo: () => handlers['oc-guardado-fallo'](), aviso: () => document.getElementById('f123-aviso-guardado'), document };
}
for (const file of ['src/app/app-inline-03.js', 'docs/app-inline-03.min.js']) {
  test(file + ' - el evento muestra el aviso con texto ES/EN y estilo pactado', () => {
    const f = cargarAviso(file);
    assert.equal(f.aviso(), null);
    f.fallo();
    const a = f.aviso();
    assert.ok(a, 'aviso visible');
    assert.equal(a.textContent, 'No se pudo guardar el último cambio. No cierres la app. Toca aquí para reintentar.');
    assert.equal(a.attrs.role, 'status');
    const p = (k) => a.style.props.get(k);
    assert.equal(p('background-color').v, '#E86040'); assert.equal(p('color').v, '#FFFFFF'); assert.equal(p('-webkit-text-fill-color').v, '#FFFFFF');
    for (const k of ['background-color', 'color', '-webkit-text-fill-color', 'font-size', 'min-height', 'z-index', 'position']) assert.equal(p(k).p, 'important', k + ' !important');
    assert.equal(p('font-size').v, '16px'); assert.equal(p('min-height').v, '48px'); assert.equal(p('z-index').v, '9990');
    assert.ok(![...a.style.props.keys()].some((k) => /opacity/.test(k)), 'sin opacity');
    assert.ok(![...a.style.props.values()].some((x) => /rgba/i.test(x.v)), 'sin rgba');
    const f2 = cargarAviso(file); f2.ctx.lang = 'en'; f2.fallo();
    assert.equal(f2.aviso().textContent, "Your last change could not be saved. Don't close the app. Tap here to retry.");
  });
  test(file + ' - tocar: guardado ok oculta; falla mantiene y cambia el texto; nunca recarga', async () => {
    let ok = false; let llamadas = 0;
    const f = cargarAviso(file, { save: async () => { llamadas++; return ok; } });
    f.ctx.location = { reload() { throw new Error('no debe recargar'); } };
    f.fallo(); const a = f.aviso();
    a.l.click(); for (let i = 0; i < 5; i++) await tick();
    assert.equal(llamadas, 1); assert.ok(f.aviso(), 'sigue visible tras fallo');
    assert.equal(a.textContent, 'Todavía no se pudo guardar. Vuelve a tocar.');
    ok = true; a.l.click(); for (let i = 0; i < 5; i++) await tick();
    assert.equal(f.aviso(), null, 'oculto tras guardar');
  });
  test(file + ' - guardado colgado: tope de 10 s y el aviso sigue; sin OCSync tambien sigue', async () => {
    const f = cargarAviso(file, { save: () => new Promise(() => {}) });
    f.fallo(); f.aviso().l.click(); await tick();
    const tope = f.timers.find((t) => t.k === 't'); assert.equal(tope.ms, 10000);
    tope.fn(); for (let i = 0; i < 5; i++) await tick();
    assert.ok(f.aviso()); assert.equal(f.aviso().textContent, 'Todavía no se pudo guardar. Vuelve a tocar.');
    const g = cargarAviso(file); g.fallo(); g.aviso().l.click(); for (let i = 0; i < 5; i++) await tick();
    assert.ok(g.aviso(), 'sin OCSync no se oculta');
  });
  test(file + ' - apila encima del aviso de version sin solaparse; un fallo repetido no duplica', () => {
    const f = cargarAviso(file);
    const v = el('button'); v.id = 'f123-aviso-version'; v.h = 52; f.body.push(v);
    f.fallo(); f.fallo();
    assert.equal(f.body.filter((x) => x.id === 'f123-aviso-guardado').length, 1);
    assert.equal(f.aviso().style.props.get('bottom').v, '52px');
    v.gone = true; f.timers.find((t) => t.k === 'i').fn();
    assert.equal(f.aviso().style.props.get('bottom').v, '0px', 'baja cuando el otro aviso se va');
  });
}
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
