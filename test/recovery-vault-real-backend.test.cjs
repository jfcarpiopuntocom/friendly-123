// v597: recovery vault against the REAL docs/mock-backend.js (no hand-made fetch).
// The WIP tests of Codex inject `_recuperacion` by hand; these prove that the real
// /api/respaldo/exportar?confirmado=1&completo=1 route produces what the vault demands.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { browser } = require('./helpers/browser.cjs');

const hash = s => createHash('sha256').update(s).digest('hex');
const avanzado = fs.readFileSync(path.join(__dirname, '../docs/avanzado-extra.js'), 'utf8');
const cajaCode = avanzado.slice(avanzado.indexOf('    const CAJA_MAX_SNAPSHOTS ='), avanzado.indexOf('    function cajaPintarAlerta()'));
const perchas = fs.readFileSync(path.join(__dirname, '../docs/vista-perchas.js'), 'utf8');
const photoCode = (() => {
  const start = perchas.indexOf('  async function historialFotosCheckpointsExacto()');
  const end = perchas.indexOf('\n  ', perchas.indexOf('\n  }', start) + 4);
  return perchas.slice(start, end);
})();

function mapStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { get length() { return m.size; }, key: i => [...m.keys()][i],
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (m.__fail) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: k => m.delete(k), _m: m };
}
// Fresh app: owner-activated notebook INST-A, license F123-TEST-A, role configurable.
async function fixture(role = 'dueno', instance = 'INST-A') {
  const ls = mapStorage({ f123_owned: JSON.stringify({ instanceId: instance, licenseCode: 'F123-TEST-A' }) });
  const w = browser(ls);
  w.OCAuth = { rolActual: () => w.__rol };
  w.__rol = role;
  w.OCSecure.hashTexto = async s => hash(s);
  const messages = [];
  Object.assign(w, { API: '/api', msg: (...a) => messages.push(a), confirm: () => true, escHtml: x => String(x), $: () => null });
  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'Vault rack', tipo: 'socio' });
  await w.request('/api/productos', 'POST', { nombre: 'Vault cup', barcode: 'VAULT-1', precio: 10, costo: 2, stockInicial: 5, ubicacionId: rack.id });
  vm.runInContext(cajaCode, w);
  return { w, ls, messages, rack };
}
const keysOf = ls => [...ls._m.keys()].filter(k => k.startsWith('f123_caja_snapshots::'));
const listOf = (w) => w.cajaLeer(w.cajaOrigen());
const productos = async w => (await w.request('/api/respaldo/exportar')).productos.map(p => p.nombre);

test('owner saves a real checkpoint, list grows and restore brings the data back', async () => {
  const { w } = await fixture();
  assert.equal(listOf(w).length, 0);
  await w.cajaGuardarPunto(true);
  assert.equal(listOf(w).length, 1, 'the real export must satisfy the vault gate');
  const saved = JSON.parse(listOf(w)[0].contenido).datos;
  assert.deepEqual({ ...saved._recuperacion }, { confirmado: true, completo: true, namespace: '', notebookId: 'INST-A', licenseCode: 'F123-TEST-A' });
  const rack = (await w.request('/api/respaldo/exportar')).ubicaciones[0];
  await w.request('/api/productos', 'POST', { nombre: 'Added later', barcode: 'VAULT-2', precio: 5, costo: 1, stockInicial: 1, ubicacionId: rack.id });
  assert.ok((await productos(w)).includes('Added later'));
  await w.cajaRestaurar(0);
  const after = await productos(w);
  assert.ok(after.includes('Vault cup') && !after.includes('Added later'), 'restore replaces the notebook with the checkpoint: ' + after);
});

test('employee neither saves a checkpoint nor gets full data from the confirmed route', async () => {
  const { w } = await fixture('empleado');
  const before = w.fetch;
  let calls = 0; w.fetch = (...a) => { calls++; return before(...a); };
  await w.cajaGuardarPunto(true);
  assert.equal(calls, 0, 'role gate on the client');
  assert.equal(listOf(w).length, 0);
  w.fetch = before;
  const res = await w.fetch('/api/respaldo/exportar?confirmado=1&completo=1');
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.productos, undefined);
  assert.equal(body._recuperacion, undefined);
});

test('export without the query answers exactly as before', async () => {
  const { w } = await fixture();
  const plain = await w.request('/api/respaldo/exportar');
  assert.equal(plain._recuperacion, undefined);
  const confirmed = await w.request('/api/respaldo/exportar?confirmado=1&completo=1');
  assert.deepEqual(Object.keys(confirmed).filter(k => k !== '_recuperacion').sort(), Object.keys(plain).sort());
  const { _recuperacion, ...rest } = confirmed;
  assert.deepEqual(rest, plain);
  // only one of the two flags is not enough to opt in
  assert.equal((await w.request('/api/respaldo/exportar?confirmado=1'))._recuperacion, undefined);
  assert.equal((await w.request('/api/respaldo/exportar?completo=1'))._recuperacion, undefined);
});

test('unpublishable state answers 409 without data and nothing is saved', async () => {
  const { w, ls } = await fixture();
  await w.cajaGuardarPunto(true);
  assert.equal(listOf(w).length, 1);
  ls._m.__fail = true; // every local write now fails: the last save is not confirmed
  await w.fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Lost write', barcode: 'VAULT-3', precio: 1, costo: 1, stockInicial: 1 }) });
  const res = await w.fetch('/api/respaldo/exportar?confirmado=1&completo=1');
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.productos, undefined);
  assert.equal(body._recuperacion, undefined);
  await w.cajaGuardarPunto(true);
  assert.equal(listOf(w).length, 1, 'no new point while the state is not confirmed');
});

test('rotating the license code does not hide the checkpoints', async () => {
  const { w, ls } = await fixture();
  await w.cajaGuardarPunto(true);
  assert.equal(listOf(w).length, 1);
  const keyBefore = keysOf(ls);
  ls.setItem('f123_owned', JSON.stringify({ instanceId: 'INST-A', licenseCode: 'F123-ROTATED-B' }));
  assert.equal(listOf(w).length, 1, 'same notebook, new license: same box');
  assert.deepEqual(keysOf(ls), keyBefore);
  await w.cajaGuardarPunto(true); // and a new point after rotation lands in the same box
  assert.equal(listOf(w).length, 2);
  assert.equal(JSON.parse(listOf(w)[1].contenido).datos._recuperacion.licenseCode, 'F123-ROTATED-B');
  await w.cajaRestaurar(0); // an older point (previous license) still restores
  assert.ok((await productos(w)).includes('Vault cup'));
});

test('a point from another notebook never restores', async () => {
  const { w, ls } = await fixture();
  await w.cajaGuardarPunto(true);
  const own = listOf(w)[0];
  const foreign = JSON.parse(own.contenido);
  foreign.datos._recuperacion.notebookId = 'INST-OTHER';
  foreign.datos.productos = foreign.datos.productos.map(p => ({ ...p, nombre: 'Foreign cup' }));
  const contenido = JSON.stringify(foreign);
  ls.setItem(keysOf(ls)[0], JSON.stringify([{ fecha: own.fecha, contenido, checksum: hash(contenido) }]));
  await w.cajaRestaurar(0);
  assert.deepEqual(await productos(w), ['Vault cup'], 'foreign data was not imported');
  // and a different active notebook sees an empty box
  await w.request('/api/instancia/activar', 'POST', { instanceId: 'INST-B' });
  assert.equal(listOf(w).length, 0);
});

function photoWindow(w, legacy) {
  const win = { localStorage: w.localStorage, OCTienda: w.OCTienda, OCSecure: w.OCSecure };
  win.window = win; vm.createContext(win);
  vm.runInContext('let _historialFotosCheckpointsPromise;\n' + photoCode, win);
  return win.historialFotosCheckpointsExacto().then(r => JSON.parse(JSON.stringify(r)));
}
function withPhoto(point, hashValue, instanceId) {
  const body = JSON.parse(point.contenido);
  body.datos.ubicaciones = [{ id: 'shelf-1', fotoHash: hashValue }];
  if (instanceId === undefined) delete body.datos.instanceId; else body.datos.instanceId = instanceId;
  const contenido = JSON.stringify(body);
  return { fecha: point.fecha, contenido, checksum: hash(contenido) };
}
test('photo history keeps legacy global evidence only for the exact notebook instanceId', async () => {
  const { w, ls } = await fixture();
  await w.cajaGuardarPunto(true);
  const base = listOf(w)[0];
  ls.setItem('f123_caja_snapshots', JSON.stringify([
    withPhoto(base, 'legacy-own', 'INST-A'),
    withPhoto(base, 'legacy-foreign', 'INST-OTHER'),
    withPhoto(base, 'legacy-anonymous', undefined),
  ]));
  assert.deepEqual(await photoWindow(w), { 'shelf-1': ['legacy-own'] });
});
test('photo history: new points still need the same namespace and notebook in _recuperacion', async () => {
  const { w, ls } = await fixture();
  await w.cajaGuardarPunto(true);
  const base = listOf(w)[0];
  const foreign = JSON.parse(withPhoto(base, 'new-foreign', 'INST-A').contenido);
  foreign.datos._recuperacion.notebookId = 'INST-OTHER';
  const contenido = JSON.stringify(foreign);
  ls.setItem(keysOf(ls)[0], JSON.stringify([withPhoto(base, 'new-own', 'INST-A'), { fecha: base.fecha, contenido, checksum: hash(contenido) }]));
  assert.deepEqual(await photoWindow(w), { 'shelf-1': ['new-own'] });
});

test('legacy download appends the link to the DOM and revokes the URL later (Safari)', async () => {
  const { w, ls } = await fixture();
  await w.cajaGuardarPunto(true);
  ls.setItem('f123_caja_snapshots', JSON.stringify([listOf(w)[0]]));
  const events = [], timers = [];
  const anchor = { click() { events.push('click:' + (anchor.parent ? 'attached' : 'detached')); }, remove() { anchor.parent = null; events.push('remove'); } };
  w.document = { createElement: () => anchor, body: { appendChild(a) { a.parent = this; events.push('append'); } } };
  w.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => events.push('revoke') };
  w.Blob = class {};
  w.setTimeout = (fn, ms) => { timers.push(ms); events.push('timer'); fn(); return 0; };
  await w.cajaDescargarLegado(0);
  assert.deepEqual(events, ['append', 'click:attached', 'remove', 'timer', 'revoke']);
  assert.ok(timers[0] >= 4000);
});
