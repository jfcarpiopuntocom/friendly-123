const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

function shelf(cat, id) {
  return (cat.ubicaciones || []).find((x) => String(x.id) === String(id));
}

test('v448 GOLDEN: remote null fotoHash cannot erase an existing shelf photo pointer', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Photo rescue shelf' });
  await a.request(`/api/ubicaciones/${u.id}`, 'PUT', { fotoHash: 'hash-good-photo' });
  b.receive(a);

  const corrupt = b.catalog();
  const row = shelf(corrupt, u.id);
  assert.equal(row.fotoHash, 'hash-good-photo');
  row.fotoHash = null;
  row.fotoRev = { c: 999999, d: 'stale-null-peer' };
  row.rev = { c: 1000000, d: 'stale-null-peer' };

  a.OCSync.aplicarCatalogo(corrupt, null);
  assert.equal(shelf(a.catalog(), u.id).fotoHash, 'hash-good-photo',
    'null is pointer loss, not proof of an intentional photo deletion');
});

test('v448 GOLDEN: Yjs shelf reseed preserves a known photo pointer when stale local state is null', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../docs/sync-yjs.js'), 'utf8');
  assert.match(src, /v448 GOLDEN photo-rescue/);
  assert.match(src, /prev\.fotoHash && \(!r\.fotoHash \|\| fotoPrevMasNueva\)/);
  assert.match(src, /fotoHash: prev\.fotoHash, fotoRev: fp \|\| r\.fotoRev \|\| null/);
});

test('v448 GOLDEN: shelf renderer never deletes per-id photo evidence during ordinary load', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../docs/vista-perchas.js'), 'utf8');
  const loadStart = src.indexOf('async function cargar()');
  const loadEnd = src.indexOf('// ── CARPETA:', loadStart);
  const load = src.slice(loadStart, loadEnd);
  assert.match(load, /RENDER JAMAS BORRA EVIDENCIA/);
  assert.doesNotMatch(load, /borrarFoto\(u\.id\)/,
    'ordinary rendering must not delete the only local shelf-photo copy');
});
