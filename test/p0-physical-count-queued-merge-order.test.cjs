'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = source.indexOf('      if ((m = path.match(/^\\/api\\/productos\\/([^/]+)\\/ajustar$/)))');
const end = source.indexOf('      if ((m = path.match(/^\\/api\\/productos\\/([^/]+)\\/etiqueta$/)))', start);
assert.ok(start > 0 && end > start, 'inspect actual manual adjustment endpoint');
const handler = source.slice(start, end);
test('physical count seeds its durable epoch before pending remote catalogs can repaint old count', () => {
  const afterCommit = handler.slice(handler.indexOf('\n        } finally {') + 1);
  const seed = afterCommit.indexOf('window.OCYjs.sembrarConteoConfirmado(p.id, _epocaFisicaConfirmada)');
  const drain = afterCommit.indexOf('_drenarCatalogosPendientes()');
  assert.ok(seed >= 0 && drain > seed, 'confirmed physical count must be seeded before pending remote merge');
  assert.match(afterCommit, /if \(guardado && _epocaFisicaConfirmada/);
  assert.match(afterCommit, /if \(guardado\) _avisarCatalogoConfirmado\(\)/);
});
test('pending remote merge still runs on both successful and failed adjustments', () => {
  const afterCommit = handler.slice(handler.indexOf('\n        } finally {') + 1);
  assert.match(afterCommit, /_drenarCatalogosPendientes\(\)/);
  assert.match(afterCommit, /finally \{ terminar\(\); \}/);
});

const syncSource = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
test('immediate confirmed count seeds only the selected product without full-shop fanout', () => {
  assert.match(syncSource, /function sembrar\(soloProductoId\)/);
  assert.match(syncSource, /if \(soloProductoId && col !== "productos"\) return/);
  assert.match(syncSource, /if \(soloProductoId\) filas = filas\.filter/);
  assert.match(syncSource, /if \(soloProductoId\) return;\s*\/\/ B3: publicar/);
  assert.match(syncSource, /sembrar\(productoId\); \/\/ one-product Y\.Doc transaction/);
  assert.match(syncSource, /if \(!soloProductoId && cat\.nombreNegocio/);
  assert.match(syncSource, /if \(!soloProductoId && cat\.pinsRol/);
});
