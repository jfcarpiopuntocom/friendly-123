const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

test('v448 golden: archive publishes catalog tombstone immediately', async () => {
  const w = browser();
  let changed = 0;
  w.addEventListener('oc-catalogo-cambiado', () => changed++);
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Archive me', tipo: 'propio' });
  changed = 0;
  await w.request('/api/ubicaciones/' + u.id + '/desactivar', 'POST');
  assert.equal(changed, 1, 'archive must wake catalog sync exactly once');
  const state = await w.request('/api/respaldo/exportar');
  const shelf = state.ubicaciones.find((x) => x.id === u.id);
  assert.equal(shelf.activa, false);
});

test('v448 golden: soft-delete publishes tombstone immediately', async () => {
  const w = browser();
  let changed = 0;
  w.addEventListener('oc-catalogo-cambiado', () => changed++);
  const keep = await w.request('/api/ubicaciones', 'POST', { nombre: 'Keep', tipo: 'propio' });
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Delete me', tipo: 'propio' });
  assert.ok(keep.id);
  changed = 0;
  await w.request('/api/ubicaciones/' + u.id, 'DELETE');
  assert.equal(changed, 1, 'delete must wake catalog sync exactly once');
  const state = await w.request('/api/respaldo/exportar');
  const shelf = state.ubicaciones.find((x) => x.id === u.id);
  assert.equal(shelf.borrado, true);
  assert.equal(shelf.activa, false);
});

test('v448 golden: deleting a shelf does not eagerly destroy its exact local photo bytes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../docs/vista-perchas.js'), 'utf8');
  const start = src.indexOf("if (e.target.id === 'vp-g-borrar')");
  const end = src.indexOf('// Crear nueva percha', start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);
  assert.doesNotMatch(block, /OCFotos\.borrarFoto\s*\(/,
    'photo bytes must survive until tombstone convergence / explicit GC');
});
