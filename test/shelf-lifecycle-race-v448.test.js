const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function byId(cat, id) {
  return (cat.ubicaciones || []).find(x => String(x.id) === String(id));
}

test('pre36h: a stale peer unrelated edit must not reactivate an archived shelf', async () => {
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

test('pre36h: a stale peer unrelated edit must not resurrect a deleted shelf', async () => {
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
