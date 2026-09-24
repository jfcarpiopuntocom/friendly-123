/* Fotos del demo (JFC 2026-09-24, shell 374). Cada producto semilla lleva su
   foto CC0 en docs/demo/<id>.webp; el peso total se mantiene liviano para
   telefonos modestos; y la foto se asigna SOLO a semilla intacta (mismo nombre
   original), nunca a un producto real. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

test('every seed product has a light local photo', async () => {
  const b = await browser().request('/api/respaldo/exportar');
  const seed = b.productos.filter(p => /^p\d\d$/.test(p.id));
  assert.ok(seed.length >= 38);
  let total = 0;
  for (const p of seed) {
    assert.equal(p.foto, `./demo/${p.id}.webp`, `${p.id} tiene foto`);
    const f = path.join(__dirname, '../docs/demo', `${p.id}.webp`);
    assert.ok(fs.existsSync(f), `${p.id}.webp existe`);
    total += fs.statSync(f).size;
  }
  assert.ok(total < 1.2 * 1024 * 1024, `peso total ${Math.round(total / 1024)} KB`);
  assert.ok(fs.existsSync(path.join(__dirname, '../docs/demo/CREDITOS.json')), 'fuentes registradas');
});

test('photos only land on untouched seed products', () => {
  const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
  assert.match(src, /!p\.foto && _DEMO_NOMBRES\.get\(p\.id\) === p\.nombre/, 'guarda por nombre original y sin foto propia');
});
