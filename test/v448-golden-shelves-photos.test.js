const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function later(rev, device) {
  return { c: Math.max(1, Number(rev && rev.c) || 0) + 100, d: device };
}

test('v448 golden: stale active peer cannot resurrect a deleted shelf', async () => {
  const w = browser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Golden tombstone', tipo: 'propio' });
  await w.request('/api/ubicaciones/' + u.id, 'PUT', { fotoHash: 'hash-authentic' });
  const beforeDelete = w.catalog();
  await w.request('/api/ubicaciones/' + u.id, 'DELETE');

  const deleted = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(deleted.borrado, true);
  assert.equal(deleted.activa, false);

  const remote = beforeDelete;
  const ru = remote.ubicaciones.find((x) => x.id === u.id);
  ru.borrado = false;
  ru.activa = true;
  ru.nombre = 'Stale peer rename';
  ru.rev = later(deleted.rev, 'stale-peer');

  w.OCSync.aplicarCatalogo(remote, null);
  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(after.borrado, true, 'delete tombstone is monotonic across sync');
  assert.equal(after.activa, false, 'stale peer cannot reactivate a deleted shelf');
  assert.equal(after.fotoHash, 'hash-authentic', 'authentic photo pointer is retained as recovery evidence');
});

test('v448 golden: stale active peer cannot resurrect a deactivated shelf', async () => {
  const w = browser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Archived shelf', tipo: 'propio' });
  const old = w.catalog();
  await w.request('/api/ubicaciones/' + u.id + '/desactivar', 'POST', {});

  const archived = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(archived.activa, false);

  const ru = old.ubicaciones.find((x) => x.id === u.id);
  ru.activa = true;
  ru.rev = later(archived.rev, 'stale-peer');
  w.OCSync.aplicarCatalogo(old, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(after.activa, false, 'archive is monotonic during passive sync');
});

test('v448 golden: explicit local reactivation still works', async () => {
  const w = browser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Reactivate me', tipo: 'propio' });
  await w.request('/api/ubicaciones/' + u.id + '/desactivar', 'POST', {});
  const r = await w.request('/api/ubicaciones/' + u.id + '/activar', 'POST', {});
  assert.equal(r.activa, true, 'explicit owner action may reactivate an archived shelf');
});
