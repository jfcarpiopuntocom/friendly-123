'use strict';
// P0 v737 (JFC 2026-11-11, diseno Fable 5.2): "la venta se acepta SIEMPRE, local
// primero, y se concilia despues". Cubre: stock insuficiente, perecible vencido
// y prueba vencida. El rechazo por rol cambiado / sesion cerrada NO se toca.
// Fixtures sinteticos: sin red, sin licencias ni datos reales.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

const DIA = 24 * 60 * 60 * 1000;
const dueno = (w) => { w.OCAuth = Object.assign(w.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false }); return w; };
const exportar = (w) => w.request('/api/respaldo/exportar');
const prodDe = async (w, id) => (await exportar(w)).productos.find((p) => p.id === id);

async function conSocio(w, stock) {
  const a = await w.request('/api/promotoras', 'POST', { nombre: 'Socia sintetica', comisionBase: 40 });
  const r = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha sintetica', tipo: 'socio' });
  await w.request('/api/ubicaciones/' + r.id, 'PUT', { promotoraId: a.id });
  const p = await w.request('/api/productos', 'POST', { nombre: 'Prod sintetico', sku: 'V737-A', barcode: 'V737-A', precio: 100, costo: 20, stockInicial: stock, ubicacionId: r.id });
  return { a, r, p };
}

test('STOCK: vender mas de lo que hay procede; el faltante queda registrado, no hay cero ficticio', async () => {
  const w = dueno(browser());
  const { r, p } = await conSocio(w, 2);
  const emitidas = [];
  w.OCSyncEmit = (tipo, payload) => { emitidas.push({ tipo, payload }); return true; };
  const antes = await exportar(w);
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 5, opId: 'v737-stock-0001' });
  assert.ok(v.ventaId, 'la venta se acepta');
  const despues = await exportar(w);
  const pr = despues.productos.find((x) => x.id === p.id);
  assert.equal(pr.stockActual, 0, 'la percha nunca muestra unidades negativas');
  assert.equal(pr.stockDeficit, 3, 'las 3 unidades que faltaban quedan visibles como faltante');
  const venta = despues.ventas.find((x) => x.id === v.ventaId);
  assert.equal(venta.cantidad, 5);
  assert.equal(venta.precioUnit * venta.cantidad, 500, 'el dinero de la venta es el real');
  assert.equal(despues.movimientos.filter((m) => m.tipo === 'venta').length - antes.movimientos.filter((m) => m.tipo === 'venta').length, 1, 'un solo movimiento de venta');
  const ops = emitidas.filter((e) => e.payload && e.payload.productoId === p.id);
  assert.equal(ops.length, 1, 'el movimiento de stock sale una sola vez al sync');
  assert.equal(ops[0].payload.delta, -5);
  assert.equal(pr.stockPN && Object.values(pr.stockPN).reduce((s, c) => s + c.sub, 0), 5, 'el contador compartido lleva las 5 salidas');
  const liq = (await w.request('/api/liquidaciones')).find((x) => x.ubicacionId === r.id);
  assert.equal(liq.stillDue, 200, 'la comision se calcula sobre la venta completa (40% de 500)');
});

test('STOCK: reintento con el mismo opId no duplica venta, movimiento ni faltante', async () => {
  const w = dueno(browser());
  const { p } = await conSocio(w, 1);
  const a = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 3, opId: 'v737-stock-0002' });
  const b = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 3, opId: 'v737-stock-0002' });
  assert.equal(b.duplicate, true);
  assert.equal(b.ventaId, a.ventaId);
  const e = await exportar(w);
  assert.equal(e.ventas.filter((x) => x.opId === 'v737-stock-0002').length, 1);
  assert.equal(e.productos.find((x) => x.id === p.id).stockDeficit, 2);
});

test('STOCK: vender mas con faltante previo suma al faltante y reponer lo paga primero', async () => {
  const w = dueno(browser());
  const { p } = await conSocio(w, 1);
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2 }); // 1 hay, 1 falta
  assert.equal((await prodDe(w, p.id)).stockDeficit, 1);
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2 }); // faltan 3 en total
  let pr = await prodDe(w, p.id);
  assert.equal(pr.stockActual, 0);
  assert.equal(pr.stockDeficit, 3);
  await w.request(`/api/productos/${p.id}/ajustar`, 'POST', { delta: 5, motivo: 'Reposicion sintetica' });
  pr = await prodDe(w, p.id);
  assert.equal(pr.stockDeficit, 0, 'la reposicion paga primero el faltante');
  assert.equal(pr.stockActual, 2, '5 repuestas - 3 de faltante = 2 en percha');
});

test('STOCK: anular una venta con faltante devuelve el faltante, no inventa unidades', async () => {
  const w = dueno(browser());
  const { p } = await conSocio(w, 1);
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 3 });
  assert.equal((await prodDe(w, p.id)).stockDeficit, 2);
  await w.request(`/api/ventas/${v.ventaId}/anular`, 'POST', {});
  const pr = await prodDe(w, p.id);
  assert.equal(pr.stockActual, 1);
  assert.equal(pr.stockDeficit, 0);
});

// ---- Dos aparatos: el faltante y la venta viajan por el sync ----
async function peer() {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-ISOLATED-FIXTURE' }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  return w;
}
function transfer(from, to) {
  to.Y.applyUpdate(to.OCYjs.doc, from.Y.encodeStateAsUpdate(from.OCYjs.doc), 'red');
  to.OCYjs._store.aplicar();
}

test('SYNC: la venta sin stock y su faltante llegan al otro aparato una sola vez', async () => {
  const a = await peer(), b = await peer();
  for (const w of [a, b]) {
    const fx = await exportar(w);
    const p = fx.productos.find((x) => x.stockActual >= 1);
    p.id = 'p-v737'; p.stockActual = 2; delete p.stockBase; delete p.stockPN;
    fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
    await w.request('/api/respaldo/importar', 'POST', fx);
  }
  const v = await a.request('/api/productos/p-v737/venta', 'POST', { cantidad: 5 });
  assert.ok(v.ventaId);
  for (let i = 0; i < 2; i++) {
    a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar();
    transfer(a, b); transfer(b, a);
  }
  for (const w of [a, b]) {
    const pr = await prodDe(w, 'p-v737');
    assert.equal(pr.stockActual, 0);
    assert.equal(pr.stockDeficit, 3);
    const ventas = (await w.request('/api/ventas/todas')).filter((x) => x.id === v.ventaId);
    assert.equal(ventas.length, 1, 'la venta existe una sola vez en cada aparato');
  }
});

// ---- Perecible vencido ----
test('VENCIDO: un perecible vencido se vende; el vencimiento sigue marcado en su estado', async () => {
  const w = dueno(browser());
  const futuro = new Date(Date.now() + 7 * DIA).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 2 * DIA).toISOString().slice(0, 10);
  const p = await w.request('/api/productos', 'POST', { nombre: 'Perecible sintetico', barcode: 'V737-EXP', ubicacionId: 'bar', precio: 25, costo: 9, stockInicial: 5, perecible: true, fechaCaducidad: futuro });
  await w.request(`/api/productos/${p.id}`, 'PATCH', { fechaCaducidad: ayer });
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2 });
  assert.ok(v.ventaId, 'la venta se acepta');
  const pr = await prodDe(w, p.id);
  assert.equal(pr.stockActual, 3, 'el stock baja lo vendido');
  const ficha = (await w.request('/api/productos')).find((x) => x.id === p.id);
  assert.ok(ficha.diasParaVencer < 0, 'el estado existente sigue diciendo que esta vencido');
  assert.equal(ficha.estado, 'rojo');
});

// ---- Prueba vencida ----
const moduloPrueba = fs.readFileSync(path.join(__dirname, '..', 'docs', 'licencia-prueba.js'), 'utf8');
function aparatoPrueba({ estado = 'minima' } = {}) {
  const w = dueno(browser());
  w.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture-inst', licenseCode: 'F123-FIXTURE-PRUEBA', licenseEstado: estado }));
  w.localStorage.setItem('f123_prueba_inicio', String(Date.now()));
  w.__elementos = 0;
  const crear = w.document.createElement;
  w.document.createElement = (...a) => { w.__elementos++; return crear(...a); };
  vm.runInContext(moduloPrueba, w);
  return w;
}
// Se crea el producto con la prueba vigente y despues se vence el reloj.
async function productoPrueba(w) {
  const p = await w.request('/api/productos', 'POST', { nombre: 'Prod prueba', barcode: 'V737-P', ubicacionId: 'bar', precio: 10, costo: 4, stockInicial: 5 });
  w.localStorage.setItem('f123_prueba_inicio', String(Date.now() - 31 * DIA));
  return p;
}

test('PRUEBA VENCIDA: la venta ya no se bloquea ni abre modal', async () => {
  const w = aparatoPrueba();
  const p = await productoPrueba(w);
  assert.equal(w.OCPrueba.estado().vencida, true, 'la prueba esta vencida de verdad');
  let avisos = 0;
  w.addEventListener('oc-prueba-vencida', () => { avisos++; });
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(v.ventaId, 'la venta se acepta con la prueba vencida');
  assert.equal(avisos, 0, 'no se dispara el aviso que abria el modal');
  assert.equal((await prodDe(w, p.id)).stockActual, 4);
  w.OCPrueba.mostrarModal();
  assert.equal(w.__elementos, 0, 'el modal de compra esta dormido: no crea ningun elemento');
});

test('PRUEBA VENCIDA: la licencia pagada sigue vendiendo igual', async () => {
  const w = aparatoPrueba({ estado: 'full' });
  const p = await productoPrueba(w);
  assert.ok((await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 })).ventaId);
  assert.equal(w.OCPrueba.estado().pagada, true);
});

test('PRUEBA VENCIDA: el reloj sigue corriendo y el estado se puede leer (linea de estado de Ayuda)', async () => {
  const w = aparatoPrueba();
  await productoPrueba(w);
  const e = w.OCPrueba.estado();
  assert.equal(e.aplica, true);
  assert.equal(e.vencida, true);
});
