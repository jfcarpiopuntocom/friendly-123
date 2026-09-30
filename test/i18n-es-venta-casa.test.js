// JFC 2026-09-26: al pasar a "Venta de la casa" (v400) quedaron dos textos ES mal:
// "ventas ventas de la casa" (palabra repetida) y "venta de mostrador" en Cantidad,
// que el EN ya habia quitado. Rojo en v411, verde con el arreglo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/i18n.js'), 'utf8');

// JFC 2026-09-30 (v429): "counter no es la casa". "Venta de mostrador" vuelve a ser el nombre
// correcto de COUNTER SALE; lo que sigue prohibido es el tartamudeo "ventas ventas".
test('ES: no repeated "ventas ventas"', () => {
  assert.doesNotMatch(src, /ventas ventas/i);
});
