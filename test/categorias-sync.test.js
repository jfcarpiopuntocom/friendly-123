/* Configuración de categorías que viaja entre aparatos y en el respaldo
   (v344, hallazgo #2 de Codex; JFC 2026-09-22).

   Lo que viajaba: la categoría de cada PRODUCTO. Lo que NO viajaba: las
   categorías propias todavía vacías y la lista de categorías ocultas (vivían
   solo en localStorage). Un aparato nuevo no las veía; restaurar un respaldo
   tampoco las devolvía.

   Las pruebas de RENOMBRE y de RÉPLICA REZAGADA son las que importan: unir las
   dos listas a ciegas habría resucitado el nombre viejo de una categoría
   renombrada, justo el "se aumenta en vez de reemplazar" que reportó Belén.
   Dos niveles: la fusión (aplicarCatalogo) y el puente Yjs REAL.
   Fixtures sintéticos, sin red y sin datos de clientes. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

const CUSTOM = 'f123_categorias_custom';
const OCULTAS = 'f123_categorias_ocultas';
const lista = (w, k) => JSON.parse(w.localStorage.getItem(k) || '[]');
const tiene = (w, k, nom) => lista(w, k).some(x => String(x).toLowerCase() === nom.toLowerCase());

// Lo mismo que hace borradores.js al guardar: escribe la lista y avisa el cambio.
function crearPropia(w, nom) {
  w.localStorage.setItem(CUSTOM, JSON.stringify([...lista(w, CUSTOM), nom]));
  w.OCSync.marcarCategoria(nom, 'custom');
}
function renombrarPropia(w, vieja, nueva) {
  w.localStorage.setItem(CUSTOM, JSON.stringify(lista(w, CUSTOM).filter(x => x !== vieja).concat(nueva)));
  w.OCSync.marcarCategoria(vieja, 'borrada');
  w.OCSync.marcarCategoria(nueva, 'custom');
}

test('an empty custom category created on one device reaches another', () => {
  const a = browser(), b = browser();
  crearPropia(a, 'Vinilos');
  b.receive(a);
  assert.equal(tiene(b, CUSTOM, 'Vinilos'), true, 'el otro aparato ve la categoría aunque no tenga productos');
});

test('a rename travels as a tombstone: the old name does NOT come back', () => {
  const a = browser(), b = browser();
  crearPropia(a, 'Cuadros');
  b.receive(a);
  assert.equal(tiene(b, CUSTOM, 'Cuadros'), true);

  renombrarPropia(a, 'Cuadros', 'Pinturas');
  b.receive(a);
  assert.equal(tiene(b, CUSTOM, 'Pinturas'), true, 'llega el nombre nuevo');
  assert.equal(tiene(b, CUSTOM, 'Cuadros'), false, 'y el viejo se va: reemplaza, no se aumenta');

  // Ida y vuelta: el aparato B ya no puede devolverle "Cuadros" a A.
  a.receive(b);
  assert.equal(tiene(a, CUSTOM, 'Cuadros'), false);
});

test('an older peer snapshot cannot resurrect a deleted category', () => {
  const a = browser(), b = browser();
  crearPropia(a, 'Temporal');
  b.receive(a);
  const fotoVieja = JSON.parse(JSON.stringify(b.OCSync.catalogoPropio())); // B antes del borrado

  a.localStorage.setItem(CUSTOM, JSON.stringify(lista(a, CUSTOM).filter(x => x !== 'Temporal')));
  a.OCSync.marcarCategoria('Temporal', 'borrada');
  a.OCSync.aplicarCatalogo(fotoVieja, null); // llega tarde una foto vieja de B
  assert.equal(tiene(a, CUSTOM, 'Temporal'), false, 'la lápida gana a la foto vieja');
});

test('hiding and un-hiding a seed category both travel', () => {
  const a = browser(), b = browser();
  a.localStorage.setItem(OCULTAS, JSON.stringify(['Toys']));
  a.OCSync.marcarCategoria('Toys', 'oculta');
  b.receive(a);
  assert.equal(tiene(b, OCULTAS, 'Toys'), true);

  a.localStorage.setItem(OCULTAS, '[]');
  a.OCSync.marcarCategoria('Toys', 'visible');
  b.receive(a);
  assert.equal(tiene(b, OCULTAS, 'Toys'), false);
});

test('categories from before this change reach a new device, but never beat a real tombstone', () => {
  // Aparato "viejo": listas sin ningún registro (como todo lo creado antes de v344).
  const viejo = browser();
  viejo.localStorage.setItem(CUSTOM, JSON.stringify(['Heredada']));
  const nuevo = browser();
  nuevo.receive(viejo);
  assert.equal(tiene(nuevo, CUSTOM, 'Heredada'), true, 'un aparato nuevo recibe las categorías de antes');

  // El nuevo la borra (lápida real). El viejo, que estuvo offline, vuelve a
  // publicar su siembra de legado: no puede resucitarla.
  nuevo.localStorage.setItem(CUSTOM, '[]');
  nuevo.OCSync.marcarCategoria('Heredada', 'borrada');
  nuevo.receive(viejo);
  assert.equal(tiene(nuevo, CUSTOM, 'Heredada'), false, 'la siembra de legado (rev mínima) pierde ante la lápida');
});

test('a merge never removes a category that has no record (additive)', () => {
  const a = browser(), b = browser();
  b.localStorage.setItem(CUSTOM, JSON.stringify(['Solo de B']));
  crearPropia(a, 'De A');
  // B recibe de A sin haber publicado nunca: su categoría sin registro queda.
  b.OCSync.aplicarCatalogo(a.OCSync.catalogoPropio(), null);
  assert.equal(tiene(b, CUSTOM, 'Solo de B'), true);
  assert.equal(tiene(b, CUSTOM, 'De A'), true);
});

test('a backup carries the category config and restores it on a clean device', async () => {
  const a = browser();
  crearPropia(a, 'Respaldada');
  a.localStorage.setItem(OCULTAS, JSON.stringify(['Pets']));
  a.OCSync.marcarCategoria('Pets', 'oculta');
  const respaldo = await a.request('/api/respaldo/exportar');
  assert.ok(respaldo.configuracion.categoriasMeta, 'el respaldo lleva la configuración');

  const limpio = browser();
  await limpio.request('/api/respaldo/importar', 'POST', respaldo);
  assert.equal(tiene(limpio, CUSTOM, 'Respaldada'), true, 'la categoría vacía vuelve al restaurar');
  assert.equal(tiene(limpio, OCULTAS, 'Pets'), true, 'y la oculta también');
});

test('an old backup without category config leaves the lists untouched', async () => {
  const a = browser();
  const respaldo = await a.request('/api/respaldo/exportar');
  delete respaldo.configuracion.categoriasMeta; // así eran los respaldos antes de v344
  const b = browser();
  b.localStorage.setItem(CUSTOM, JSON.stringify(['Local de B']));
  await b.request('/api/respaldo/importar', 'POST', respaldo);
  assert.equal(tiene(b, CUSTOM, 'Local de B'), true);
});

// ---- Puente Yjs REAL (mismo arnés que yjs-bridge.test.js) ----
async function peer(licenseCode = 'F123-SYNTHETIC-CATEGORIAS') {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  return w;
}
function transfer(from, to) {
  to.Y.applyUpdate(to.OCYjs.doc, from.Y.encodeStateAsUpdate(from.OCYjs.doc), 'red');
  to.OCYjs._store.aplicar();
}

test('actual Yjs bridge carries a rename without resurrecting the old name', async () => {
  const a = await peer(), b = await peer();
  crearPropia(a, 'Grabados');
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal(tiene(b, CUSTOM, 'Grabados'), true, 'viaja por el documento Yjs real');

  renombrarPropia(a, 'Grabados', 'Estampas');
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal(tiene(b, CUSTOM, 'Estampas'), true);
  assert.equal(tiene(b, CUSTOM, 'Grabados'), false);
});

test('actual Yjs bridge: a lagging replica cannot poison the shared doc for a NEW device', async () => {
  /* Lo que protege la guarda de sync-yjs.js ("|| col === \"categorias\""):
     que una réplica REZAGADA re-publique su entrada vieja ENCIMA de una más
     nueva en el documento compartido. El aparato que ya tiene la nueva la
     rechaza igual (compara revisiones); el que queda expuesto es un aparato
     NUEVO que se une después: no tiene nada local contra qué comparar, adopta
     la entrada vieja y la categoría resucita ahí.
     Primera versión de esta prueba: pasaba AUNQUE se quitara la guarda, porque
     B ya había aplicado el borrado antes de re-sembrar (no estaba rezagada de
     verdad). Detectado quitando la guarda y viendo que seguía en verde. */
  const a = await peer(), b = await peer(), c = await peer();
  crearPropia(a, 'Rezagada');
  a.OCYjs._store.sembrar(); transfer(a, b);

  a.localStorage.setItem(CUSTOM, '[]');
  a.OCSync.marcarCategoria('Rezagada', 'borrada');
  a.OCYjs._store.sembrar();
  // B recibe el documento de A pero TODAVÍA NO lo aplica: sigue creyendo
  // "custom". Así es una réplica rezagada de verdad.
  b.Y.applyUpdate(b.OCYjs.doc, a.Y.encodeStateAsUpdate(a.OCYjs.doc), 'red');
  b.OCYjs._store.sembrar();          // re-siembra su copia vieja
  transfer(b, c);                    // un aparato NUEVO lee el documento de B
  assert.equal(tiene(c, CUSTOM, 'Rezagada'), false,
    'el aparato nuevo no recibe la categoría borrada: la réplica rezagada no pisó el documento');
});
