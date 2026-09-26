// FIJACION (paso verde a la primera, nada que arreglar). Revision nivel Linus, Bloque 2 (JFC 2026-09-26): sync entre dos aparatos de la PERSONA de la
// venta. yjs-bridge.test.js ya cubre stock, anular, correcciones y liquidacion; faltaba que
// cruce QUIEN cobra: COUNTER SALE (venta de la casa, sin comision) y una persona elegida en la
// venta distinta del acuerdo fijo de la percha. Por el puente Yjs real (sync-yjs.js), dos
// backends. Se exige en el aparato B: mismo modoComision, mismo split al centavo, el acuerdo
// fijo de la percha intacto y el mismo total de comisiones que en A.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer(timersReales) {
  const w = browser();
  if (timersReales) { w.setTimeout = (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; }; w.clearTimeout = clearTimeout; }
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-LINUS-B2' }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  return w;
}
function ida(from, to) {
  from.OCYjs._store.sembrar();
  to.Y.applyUpdate(to.OCYjs.doc, from.Y.encodeStateAsUpdate(from.OCYjs.doc), 'red');
  to.OCYjs._store.aplicar();
}
const ce = (n) => Math.round((Number(n) || 0) * 100);
const resumen = (v) => v && { modo: v.modoComision || null, split: v.split ? JSON.stringify(Object.keys(v.split).sort().map((k) => [k, typeof v.split[k] === 'number' ? ce(v.split[k]) : v.split[k]])) : null };

test('Bloque 2: COUNTER SALE y persona elegida en la venta cruzan al otro aparato sin tocar la percha', async () => {
  const a = await peer(), b = await peer();
  const fija = await a.request('/api/promotoras', 'POST', { nombre: 'Fixed Linus', comisionBase: 30 });
  const otra = await a.request('/api/promotoras', 'POST', { nombre: 'Picked Linus', comisionBase: 20 });
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Linus shared B2', tipo: 'socio', comisionSocio: 30 });
  await a.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { promotoraId: fija.id });
  const p = await a.request('/api/productos', 'POST', { nombre: 'Linus B2', barcode: 'LIN-B2', precio: 19.99, costo: 7.5, stockInicial: 10, ubicacionId: shelf.id });
  ida(a, b);
  const vCasa = await a.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  const vOtra = await a.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2, promotoraId: otra.id });
  const vFija = await a.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  ida(a, b); ida(b, a); ida(a, b);
  const ventasA = (await a.request('/api/respaldo/exportar')).ventas;
  const ventasB = (await b.request('/api/respaldo/exportar')).ventas;
  for (const id of [vCasa.ventaId, vOtra.ventaId, vFija.ventaId]) {
    const va = ventasA.find((v) => v.id === id), vb = ventasB.find((v) => v.id === id);
    assert.ok(va && vb, 'la venta ' + id + ' existe en los dos aparatos');
    assert.deepEqual(resumen(vb), resumen(va), 'misma persona y mismo split en B para ' + id);
  }
  const casaB = ventasB.find((v) => v.id === vCasa.ventaId);
  assert.ok(!casaB.split, 'COUNTER SALE sigue sin comision en B');
  assert.equal(casaB.modoComision, 'counter', 'B sabe que fue venta de la casa');
  assert.ok(ventasB.find((v) => v.id === vOtra.ventaId).split, 'la persona elegida cobra en B');
  const expB = await b.request('/api/respaldo/exportar');
  assert.equal(expB.ubicaciones.find((u) => u.id === shelf.id).promotoraId, fija.id, 'el acuerdo fijo de la percha no cambia');
  assert.equal(expB.productos.find((x) => x.id === p.id).stockActual, 6, 'stock 10 - 4 en B');
  const cm = async (w) => (await w.request('/api/comisiones/cuadre')) ;
  assert.deepEqual(JSON.parse(JSON.stringify(await cm(b))), JSON.parse(JSON.stringify(await cm(a))), 'Commissions del mes igual en los dos aparatos');
});

// Fotos entre aparatos (Bloque 2). Los bytes viajan por el Y.Doc de fotos (hash -> dataURL) y el
// catalogo lleva solo el puntero fotoHash. OCFotos (IndexedDB) se reemplaza por un almacen en
// memoria con la MISMA interfaz; todo lo demas es el codigo real de sync-yjs.js y mock-backend.js.
function fotosEnMemoria(w) {
  const m = new Map();
  w.OCFotos = {
    hashDeDataUrl: async (d) => 'h' + require('node:crypto').createHash('sha256').update(String(d)).digest('hex').slice(0, 24),
    guardarPorHash: async (h, d) => { m.set(h, d); },
    leerPorHash: async (h) => m.get(h) || null,
    tieneHash: async (h) => m.has(h),
  };
  return m;
}
test('Bloque 2: la foto de un producto cruza al otro aparato (puntero y bytes)', async () => {
  const a = await peer(true), b = await peer(true);
  const fa = fotosEnMemoria(a), fb = fotosEnMemoria(b);
  const foto = 'data:image/jpeg;base64,' + Buffer.from('linus-foto-bytes').toString('base64');
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Linus foto', tipo: 'propio' });
  const p = await a.request('/api/productos', 'POST', { nombre: 'Linus con foto', barcode: 'LIN-FOTO', precio: 5, costo: 2, stockInicial: 1, ubicacionId: shelf.id, foto });
  await a.OCSync.hashearFotosProductos();
  const hash = (await a.request('/api/respaldo/exportar')).productos.find((x) => x.id === p.id).fotoHash;
  assert.ok(hash && fa.get(hash) === foto, 'A guardo los bytes por hash');
  a.OCYjs.fotosMap.set(hash, foto); // lo que hace publicarFotosLocales (asincrono) en el arranque
  ida(a, b);
  b.Y.applyUpdate(b.OCYjs.fotosDoc, a.Y.encodeStateAsUpdate(a.OCYjs.fotosDoc), 'red');
  assert.equal(b.OCYjs.fotosMap.get(hash), foto, 'el doc de fotos de B recibio el blob');
  for (let i = 0; i < 100 && !fb.has(hash); i++) await delay(20);
  assert.equal(fb.get(hash), foto, 'los bytes llegaron a B');
  await b.OCSync.hidratarFotosProductos();
  const pb = (await b.request('/api/respaldo/exportar')).productos.find((x) => x.id === p.id);
  assert.equal(pb.fotoHash, hash, 'B tiene el puntero');
  const pv = (await b.request('/api/productos')).find((x) => x.id === p.id);
  assert.equal(pv && pv.foto, foto, 'B muestra la foto en el producto');
});
