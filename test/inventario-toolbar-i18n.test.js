/* Barra de Inventory bilingue (JFC 2026-09-24, shell 376). "Agrupar por familia"
   y los chips "variantes · u." salian en espanol fijo en la UI inglesa, y
   "Sort by:" / columnas en ingles fijo en modo ES. Todo pasa por i18n.js. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '../docs/i18n.js'), 'utf8');

test('inventory toolbar has no hardcoded Spanish or English labels', () => {
  assert.doesNotMatch(html, /> Agrupar por familia/, 'etiqueta fija en espanol');
  assert.match(html, /data-i18n="inv\.groupByFamily">Group by family</);
  assert.match(html, /data-i18n="inv\.sortBy">Sort by:</);
  assert.doesNotMatch(html, /" variantes · " \+ f\.unidades \+ " u\."/, 'chips en espanol fijo');
  assert.match(html, /window\.tf\("inv\.famChip"/);
  assert.match(html, /function etiquetaOrdenInv\(c\)/);
});

test('every new toolbar key exists in EN and ES', () => {
  for (const k of ['inv.groupByFamily', 'inv.sortBy', 'inv.famChip', 'inv.sort.nombre', 'inv.sort.stockActual', 'inv.sort.precio', 'inv.sort.categoria']) {
    const n = (i18n.match(new RegExp(`"${k.replace(/\./g, '\.')}":`, 'g')) || []).length;
    assert.equal(n, 2, `${k} en EN y ES`);
  }
  assert.match(i18n, /"inv\.groupByFamily": "Group by family"/);
  assert.match(i18n, /"inv\.groupByFamily": "Agrupar por familia"/);
});
