// JFC 2026-09-26: al pasar a "Venta de la casa" (v400) quedaron dos textos ES mal:
// "ventas ventas de la casa" (palabra repetida) y "venta de mostrador" en Cantidad,
// que el EN ya habia quitado. Rojo en v411, verde con el arreglo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/i18n.js'), 'utf8');

test('ES: no repeated "ventas ventas" and no leftover "venta de mostrador"', () => {
  assert.doesNotMatch(src, /ventas ventas/i);
  assert.doesNotMatch(src, /venta de mostrador/i);
});
