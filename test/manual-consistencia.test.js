// Consistencia visual del manual (JFC 2026-09-26: "no hay consistencia en el uso de emojis,
// iconos y colores; parece poco profesional"). Guarda contra la regresion:
// 1) sin emojis decorativos: solo quedan el lapiz (etiqueta real del boton Edit) y la casilla
//    de la lista de verificacion; 2) los cinco estados con el MISMO formato en ambos idiomas;
// 3) la estrella es el icono dorado de la app; 4) los recuadros comparten la forma punteada.
// Rojo contra el manual de v414, verde en v415.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '../docs/manual.html'), 'utf8');

test('manual: no decorative emojis (only the Edit pencil and the checklist box)', () => {
  const vistos = [...new Set(s.match(/[\u{1F300}-\u{1FAFF}☀-➿⭐]/gu) || [])].sort();
  assert.deepEqual(vistos, ['☐', '✎']);
});

test('manual: the five states share one format, in both languages', () => {
  const filas = s.match(/<td class="estado"><span class="punto p-(verde|amarillo|naranja|rojo|negro)"/g) || [];
  assert.equal(filas.length, 10);
  assert.doesNotMatch(s, /<td style="[^"]*">(Verde|Amarillo|Naranja|Rojo|Negro|Green|Yellow|Orange|Red|Black)<\/td>/);
});

test('manual: star icon and one callout shape', () => {
  assert.ok((s.match(/class="ico-estrella"/g) || []).length >= 10);
  assert.match(s, /\.alerta,\.oportunidad,\.exito\{background:#FFFFFF !important;border:2px dashed/);
});
