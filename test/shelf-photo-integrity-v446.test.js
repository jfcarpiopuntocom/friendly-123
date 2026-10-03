const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function shelfWithPhoto() {
  const w = browser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Photo shelf', tipo: 'propio' });
  await w.request('/api/ubicaciones/' + u.id, 'PUT', { fotoHash: 'hash-local' });
  const state = await w.request('/api/respaldo/exportar');
  return { w, id: u.id, shelf: state.ubicaciones.find((x) => x.id === u.id) };
}

function revAfter(rev, device) {
  return { c: Math.max(1, Number(rev && rev.c) || 0) + 100, d: device };
}

test('v446: a newer legacy shelf edit cannot erase an existing photo pointer with fotoHash:null', async () => {
  const { w, id, shelf } = await shelfWithPhoto();
  assert.equal(shelf.fotoHash, 'hash-local');
  assert.ok(shelf.fotoRev, 'an explicit local photo edit gets its own photo revision');

  const remote = w.catalog();
  const ru = remote.ubicaciones.find((x) => x.id === id);
  ru.nombre = 'Renamed by old peer';
  ru.fotoHash = null;
  delete ru.fotoRev; // simulates a pre-v446 peer
  ru.rev = revAfter(shelf.rev, 'legacy-peer');

  w.OCSync.aplicarCatalogo(remote, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === id);
  assert.equal(after.nombre, 'Renamed by old peer', 'the unrelated newer shelf edit still converges');
  assert.equal(after.fotoHash, 'hash-local', 'legacy null cannot erase the photo pointer');
  assert.deepEqual(after.fotoRev, shelf.fotoRev, 'photo revision stays untouched');
});

test('v446: an explicit newer photo deletion still propagates', async () => {
  const { w, id, shelf } = await shelfWithPhoto();
  const remote = w.catalog();
  const ru = remote.ubicaciones.find((x) => x.id === id);
  ru.fotoHash = null;
  ru.fotoRev = revAfter(shelf.fotoRev, 'new-peer-delete');
  ru.rev = revAfter(shelf.rev, 'new-peer-delete');

  w.OCSync.aplicarCatalogo(remote, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === id);
  assert.equal(after.fotoHash, null);
  assert.deepEqual(after.fotoRev, ru.fotoRev);
});

test('v446: an explicit newer photo replacement still propagates', async () => {
  const { w, id, shelf } = await shelfWithPhoto();
  const remote = w.catalog();
  const ru = remote.ubicaciones.find((x) => x.id === id);
  ru.fotoHash = 'hash-new';
  ru.fotoRev = revAfter(shelf.fotoRev, 'new-peer-replace');
  ru.rev = revAfter(shelf.rev, 'new-peer-replace');

  w.OCSync.aplicarCatalogo(remote, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === id);
  assert.equal(after.fotoHash, 'hash-new');
  assert.deepEqual(after.fotoRev, ru.fotoRev);
});
