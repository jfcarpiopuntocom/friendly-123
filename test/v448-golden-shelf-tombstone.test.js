const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer(licenseCode = 'SYNTHETIC-V448-GOLDEN') {
  const w = browser();
  delete w.JSON;
  Object.assign(w, {
    crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let attempt = 0; attempt < 100 && w.OCYjs.estado !== 'activo'; attempt++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  return w;
}

function transfer(from, to) {
  const update = from.Y.encodeStateAsUpdate(from.OCYjs.doc);
  to.Y.applyUpdate(to.OCYjs.doc, update, 'red');
  to.OCYjs._store.aplicar();
}

test('v448 golden: a deleted shelf tombstone cannot be resurrected by a stale peer with a later general rev', async () => {
  const a = await peer(), b = await peer();
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Tombstone shelf' });

  a.OCYjs._store.sembrar();
  transfer(a, b);
  assert.equal((await b.request('/api/ubicaciones')).some(x => x.id === shelf.id), true);

  await a.request(`/api/ubicaciones/${shelf.id}`, 'DELETE', {});

  // B never receives the delete. It continues editing its stale ACTIVE copy.
  // Repeated unrelated edits guarantee its record-level rev becomes later than A's
  // tombstone. That must still NOT be allowed to clear the deletion.
  for (let i = 0; i < 12; i++) {
    await b.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { nombre: 'Stale edit ' + i });
  }
  b.OCYjs._store.sembrar();
  transfer(b, a);

  const visible = await a.request('/api/ubicaciones');
  const all = a.catalog().ubicaciones;
  const rec = all.find(x => x.id === shelf.id);

  assert.equal(visible.some(x => x.id === shelf.id), false,
    'a shelf already deleted locally must never reappear because another peer edited stale metadata later');
  assert.equal(rec && rec.borrado, true, 'the tombstone must remain monotonic');
  assert.equal(rec && rec.activa, false, 'deleted shelves stay inactive');
});

test('v448 golden: checkpoint keeps shelf tombstone revision and photo pointer metadata', async () => {
  const a = await peer();
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Checkpoint deleted shelf' });
  await a.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { fotoHash: 'sha256-checkpoint-photo' });
  await a.request(`/api/ubicaciones/${shelf.id}`, 'DELETE', {});

  const snap = a.OCSync.estadoParaCheckpoint();
  const out = snap.ubicaciones.find(x => x.id === shelf.id);

  assert.ok(out, 'checkpoint keeps the shelf record as a tombstone');
  assert.equal(out.borrado, true, 'checkpoint must preserve deletion state');
  assert.equal(out.activa, false, 'checkpoint must preserve inactive state');
  assert.equal(out.fotoHash, 'sha256-checkpoint-photo', 'checkpoint must preserve exact photo pointer');
  assert.ok(out.rev && Number.isFinite(Number(out.rev.c)), 'checkpoint must preserve the shelf revision');
});

test('v448 golden: an active shelf photo pointer survives checkpoint bootstrap on a fresh device', async () => {
  const a = await peer('SYNTHETIC-V448-GOLDEN-A');
  const b = await peer('SYNTHETIC-V448-GOLDEN-B');
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Photo bootstrap shelf' });
  await a.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { fotoHash: 'sha256-active-photo' });

  const snap = a.OCSync.estadoParaCheckpoint();
  const encoded = snap.ubicaciones.find(x => x.id === shelf.id);
  assert.equal(encoded && encoded.fotoHash, 'sha256-active-photo',
    'checkpoint must carry the exact shelf->photo association');

  const result = b.OCSync.aplicarCheckpoint(snap);
  assert.equal(result.ok, true);
  const restored = b.catalog().ubicaciones.find(x => x.id === shelf.id);
  assert.equal(restored && restored.fotoHash, 'sha256-active-photo',
    'fresh bootstrap must retain the pointer so synced bytes can be rendered');
});


test('v448 golden: archive/deactivate has its own authority and stale metadata edits cannot reactivate it', async () => {
  const a = await peer(), b = await peer();
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Archived shelf' });

  a.OCYjs._store.sembrar();
  transfer(a, b);

  await a.request(`/api/ubicaciones/${shelf.id}/desactivar`, 'POST', {});
  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === shelf.id), false,
    'precondition: explicit deactivate hides the shelf');

  // B missed the archive/deactivate and keeps an active stale copy. Unrelated
  // edits must not acquire authority over the separate active/inactive state.
  for (let i = 0; i < 12; i++) {
    await b.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { nombre: 'Stale active edit ' + i });
  }
  b.OCYjs._store.sembrar();
  transfer(b, a);

  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === shelf.id), false,
    'stale general metadata edits must not resurrect an explicitly archived shelf');
  let archived = a.catalog().ubicaciones.find(x => x.id === shelf.id);
  assert.equal(archived && archived.activa, false);
  assert.ok(archived && archived.activaRev,
    'an explicit archive needs its own revision, separate from unrelated shelf metadata');

  // Unlike DELETE, deactivation is reversible — but only an EXPLICIT activation
  // should do it. This proves the fix does not make archived shelves permanent.
  await a.request(`/api/ubicaciones/${shelf.id}/activar`, 'POST', {});
  a.OCYjs._store.sembrar();
  transfer(a, b);
  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === shelf.id), true);
  assert.equal((await b.request('/api/ubicaciones')).some(x => x.id === shelf.id), true,
    'an explicit later activation must still converge');
});


test('v448 golden: a legacy peer without activaRev can still archive a shelf until modern state authority exists', async () => {
  const a = await peer();
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Legacy archive bridge' });

  const localBefore = a.catalog().ubicaciones.find(x => x.id === shelf.id);
  assert.equal(localBefore.activaRev || null, null,
    'creation stays legacy-compatible: activaRev starts only on explicit modern toggle');

  // Synthetic legacy payload: old app explicitly archived the shelf, but only knows
  // the general record rev and activa=false.
  const legacy = a.catalog();
  const remote = legacy.ubicaciones.find(x => x.id === shelf.id);
  remote.activa = false;
  delete remote.activaRev;
  remote.rev = { c: Number((remote.rev && remote.rev.c) || 0) + 50, d: 'legacy-peer' };

  const applied = a.OCSync.aplicarCatalogo(legacy, null);
  assert.equal(applied.ok, true);
  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === shelf.id), false,
    'before a modern activaRev exists, the legacy general revision can still carry an archive');
});
