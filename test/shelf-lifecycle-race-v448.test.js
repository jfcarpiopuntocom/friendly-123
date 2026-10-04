const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function byId(cat, id) {
  return (cat.ubicaciones || []).find(x => String(x.id) === String(id));
}

test('RED v448: a stale peer unrelated edit must not reactivate an archived shelf', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Archive race shelf' });
  b.receive(a);

  await a.request(`/api/ubicaciones/${u.id}/desactivar`, 'POST', {});
  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === u.id), false);

  // B is stale/offline: it still believes the shelf is active. Two unrelated edits
  // advance its general record revision beyond A's archive revision.
  await b.request(`/api/ubicaciones/${u.id}`, 'PUT', { nombre: 'Stale rename 1' });
  await b.request(`/api/ubicaciones/${u.id}`, 'PUT', { metaMensual: 77 });

  a.receive(b);

  const raw = byId(a.catalog(), u.id);
  assert.ok(raw, 'the historical shelf record remains present');
  assert.equal(raw.activa, false, 'archive state is monotonic against stale unrelated edits');
  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === u.id), false,
    'archived shelf must stay out of the operational shelf list');
});

test('RED v448: a stale peer unrelated edit must not resurrect a deleted shelf', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Delete race shelf' });
  b.receive(a);

  await a.request(`/api/ubicaciones/${u.id}`, 'DELETE', {});
  assert.equal((await a.request('/api/ubicaciones?todas=1')).some(x => x.id === u.id), false);

  // B never saw the tombstone and later performs unrelated edits on its old copy.
  await b.request(`/api/ubicaciones/${u.id}`, 'PUT', { nombre: 'Stale renamed shelf' });
  await b.request(`/api/ubicaciones/${u.id}`, 'PUT', { metaMensual: 88 });

  a.receive(b);

  const raw = byId(a.catalog(), u.id);
  assert.ok(raw, 'tombstone remains as history');
  assert.equal(raw.borrado, true, 'delete tombstone must dominate stale unrelated edits');
  assert.equal(raw.activa, false, 'deleted shelf must stay inactive');
  assert.equal((await a.request('/api/ubicaciones?todas=1')).some(x => x.id === u.id), false,
    'deleted shelf must never reappear in My shelves');
});


test('explicit modern reactivation still propagates after archive', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Reactivate shelf' });
  b.receive(a);

  await a.request(`/api/ubicaciones/${u.id}/desactivar`, 'POST', {});
  b.receive(a);
  assert.equal((await b.request('/api/ubicaciones')).some(x => x.id === u.id), false);

  await b.request(`/api/ubicaciones/${u.id}/activar`, 'POST', {});
  a.receive(b);

  const raw = byId(a.catalog(), u.id);
  assert.equal(raw.borrado, false);
  assert.equal(raw.activa, true);
  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === u.id), true,
    'an explicit newer reactivation is allowed');
});

test('legacy inactive state can still archive an active modern peer', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Legacy archive shelf' });
  b.receive(a);

  await b.request(`/api/ubicaciones/${u.id}/desactivar`, 'POST', {});
  const legacy = b.catalog();
  const row = byId(legacy, u.id);
  delete row.estadoRev; // simulate a pre-fix peer that only has general rev
  a.OCSync.aplicarCatalogo(legacy, null);

  assert.equal((await a.request('/api/ubicaciones')).some(x => x.id === u.id), false,
    'legacy negative lifecycle evidence remains compatible');
});

test('stale photo/self-heal style writes cannot resurrect a deleted shelf', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Photo race shelf' });
  b.receive(a);

  await a.request(`/api/ubicaciones/${u.id}`, 'DELETE', {});

  // Stale B still thinks it is active. A normal edit plus a later photo pointer
  // write models the recent read/self-heal paths advancing the generic record rev.
  await b.request(`/api/ubicaciones/${u.id}`, 'PUT', { metaMensual: 31 });
  await b.request(`/api/ubicaciones/${u.id}`, 'PUT', { fotoHash: 'sha256-synthetic-photo' });
  a.receive(b);

  const raw = byId(a.catalog(), u.id);
  assert.equal(raw.borrado, true);
  assert.equal(raw.activa, false);
  assert.equal((await a.request('/api/ubicaciones?todas=1')).some(x => x.id === u.id), false);
});


test('RED v451: deleted shelf tombstone is sticky even against newer explicit active lifecycle state', async () => {
  const w = browser();
  await w.request('/api/ubicaciones', 'POST', { nombre: 'Other sticky shelf', tipo: 'propio' });
  const shelf = await w.request('/api/ubicaciones', 'POST', { nombre: 'Sticky delete target', tipo: 'propio' });
  await w.request(`/api/ubicaciones/${shelf.id}`, 'DELETE', {});

  const before = byId(w.catalog(), shelf.id);
  assert.equal(before.borrado, true);
  assert.equal(before.activa, false);
  assert.ok(before.estadoRev, 'modern delete carries lifecycle revision');

  const remote = w.catalog();
  const ru = byId(remote, shelf.id);
  ru.borrado = false;
  ru.activa = true;
  ru.estadoRev = { c: Number(before.estadoRev.c || 0) + 1000, d: 'synthetic-undelete-peer' };
  ru.rev = { c: Number(before.rev && before.rev.c || 0) + 1000, d: 'synthetic-undelete-peer' };

  w.OCSync.aplicarCatalogo(remote, null);

  const after = byId(w.catalog(), shelf.id);
  assert.equal(after.borrado, true, 'no implicit undelete exists for a shelf id');
  assert.equal(after.activa, false, 'deleted shelf stays non-operational');
  assert.equal((await w.request('/api/ubicaciones?todas=1')).some(x => x.id === shelf.id), false);
});
