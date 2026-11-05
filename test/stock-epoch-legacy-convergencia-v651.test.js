// v651 · convergencia entre motores (JFC 2026-11-01).
//
// DEFECTO: docs/sync-yjs.js (_epochPreferred) y docs/mock-backend.js (_gana)
// decidian distinto el MISMO conflicto "epoch anterior vs legacy posterior con
// base fisica DISTINTA". sync-yjs privilegiaba SIEMPRE el lado con epoch;
// mock-backend (v651) dejaba ganar al legacy con base distinta y stockTs mayor.
// Resultado observable: un aparato quedaba en 13 y el otro en 19.
//
// ESTE TEST NO DECIDE NEGOCIO: solo demuestra que, ante la MISMA entrada, ambos
// motores producen el MISMO stockBase/stockEpochId (convergencia). NO afirma que
// "la base nueva absorbe las ventas del perdedor" sea correcto (eso es negocio
// pendiente). La entrada usa stockPN vacio (conteo fisico sin ventas en vuelo).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const EPOCA_ANTERIOR = 'stock-epoch-anterior';
const LEGACY_SIN_EPOCA = ''; // stockEpochId vacio = legacy sin epoch

// Importa UN solo producto con base/epoch/ts explicitos (control total del conflicto).
async function sembrar(w, id, base, epoch, stock, ts) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => Number(x.stockActual) >= 1);
  Object.assign(p, { id, nombre: 'Convergencia v651', stockActual: stock, stockTs: ts, stockBase: base, stockPN: {}, stockEpochId: epoch, rev: null });
  delete p.stockDeficit;
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return w;
}

async function leer(w, id) {
  const p = (await w.request('/api/respaldo/exportar')).productos.find((x) => x.id === id);
  return { base: p.stockBase, epoch: p.stockEpochId || '', actual: p.stockActual };
}

async function peer() {
  const w = browser(); delete w.JSON;
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

// Pone en el Y.Map un producto legacy SIN epoch. El objeto debe crearse DENTRO
// del realm del VM: Yjs rechaza un objeto plano creado en el realm de Node
// ("Unexpected content type" por el chequeo de constructor).
function ponerDocLegacy(w, id, base, stock, ts) {
  const obj = { id, nombre: 'Convergencia v651', stockBase: base, stockPN: {}, stockActual: stock, stockTs: ts, stockEpochId: LEGACY_SIN_EPOCA, rev: null, fotoHash: null };
  const dentro = vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(obj)) + ')', w);
  w.OCYjs.mapas.productos.set(id, dentro);
}

test('v651: legacy posterior con base distinta converge igual en sync-yjs.js y mock-backend.js', async () => {
  // ---- Motor mock-backend (aplicarCatalogo): local = epoch anterior, remoto = legacy posterior.
  const mb = await sembrar(browser(), 'v651', 13, EPOCA_ANTERIOR, 13, 1000);
  const remoto = mb.catalog();
  Object.assign(remoto.productos.find((x) => x.id === 'v651'),
    { stockBase: 19, stockPN: {}, stockActual: 19, stockTs: 5000, stockEpochId: LEGACY_SIN_EPOCA });
  mb.OCSync.aplicarCatalogo(remoto, null);
  const motorBackend = await leer(mb, 'v651');

  // ---- Motor sync-yjs (merge _sembrar en el Y.Map): local = epoch anterior, doc = legacy posterior.
  const w = await peer();
  await sembrar(w, 'v651', 13, EPOCA_ANTERIOR, 13, 1000);
  ponerDocLegacy(w, 'v651', 19, 19, 5000);
  w.OCYjs._store.sembrar();
  const doc = w.OCYjs.mapas.productos.get('v651');

  // ---- Cada motor, ante la MISMA entrada, debe decidir que gana el legacy posterior.
  assert.equal(motorBackend.base, 19, 'mock-backend (v651): gana la base del legacy posterior');
  assert.equal(motorBackend.epoch, LEGACY_SIN_EPOCA, 'mock-backend: el epoch anterior cede al legacy');
  assert.equal(doc.stockBase, 19, 'sync-yjs (_epochPreferred): gana la base del legacy posterior');
  assert.equal(doc.stockEpochId, LEGACY_SIN_EPOCA, 'sync-yjs: el epoch anterior cede al legacy');

  // ---- Convergencia explicita entre los dos motores (mismo stockBase/stockEpochId).
  assert.equal(doc.stockBase, motorBackend.base, 'MISMO stockBase en sync-yjs.js y mock-backend.js');
  assert.equal(doc.stockEpochId, motorBackend.epoch, 'MISMO stockEpochId en sync-yjs.js y mock-backend.js');
});

test('v651: un legacy con la MISMA base no es recuento nuevo y no gana en ningun motor', async () => {
  // Misma base => no gana: ambos motores deben conservar el epoch anterior.
  const mb = await sembrar(browser(), 'v651-b', 13, EPOCA_ANTERIOR, 13, 1000);
  const remoto = mb.catalog();
  Object.assign(remoto.productos.find((x) => x.id === 'v651-b'),
    { stockBase: 13, stockPN: {}, stockActual: 13, stockTs: 5000, stockEpochId: LEGACY_SIN_EPOCA });
  mb.OCSync.aplicarCatalogo(remoto, null);
  const motorBackend = await leer(mb, 'v651-b');
  assert.equal(motorBackend.epoch, EPOCA_ANTERIOR, 'mock-backend: misma base legacy no pisa el epoch');

  const w = await peer();
  await sembrar(w, 'v651-b', 13, EPOCA_ANTERIOR, 13, 1000);
  ponerDocLegacy(w, 'v651-b', 13, 13, 5000);
  w.OCYjs._store.sembrar();
  const doc = w.OCYjs.mapas.productos.get('v651-b');
  assert.equal(doc.stockEpochId, EPOCA_ANTERIOR, 'sync-yjs: misma base legacy no pisa el epoch');
  assert.equal(doc.stockEpochId, motorBackend.epoch, 'MISMO stockEpochId en ambos motores (misma base)');
});
