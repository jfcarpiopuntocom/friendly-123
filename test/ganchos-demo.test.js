/* Embudo dentro del demo (JFC 2026-09-24, shell 375). Reglas que no se rompen:
   solo en el demo; tarjetas en linea (jamas modal/fijo); sin "free/gratis"
   (la prueba 789 es "prueba completa de 30 dias", decision de JFC v343);
   textos en EN y ES; lleva a save.html (precio + PayPal). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const leer = (f) => fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8');

test('demo hooks are inline, demo-only and point to the price page', () => {
  const js = leer('ganchos-demo.js');
  assert.match(js, /if \(!esDemo\(\)\) \{[^}]*remove\(\)/, 'fuera del demo se quitan');
  assert.doesNotMatch(js, /position:\s*fixed|aria-modal/, 'nunca modal ni fijo');
  assert.match(js, /PRECIO_URL = "\.\/save\.html"/);
  assert.match(leer('index.html'), /<script src="\.\/ganchos-demo\.js"><\/script>/);
  assert.match(leer('sw.js'), /"\.\/ganchos-demo\.js"/, 'en el SHELL');
});

test('hook copy exists in both languages and never promises "free"', () => {
  const i18n = leer('i18n.js');
  const claves = ['hoy.titulo', 'hoy.texto', 'inventario.titulo', 'inventario.texto', 'comisiones.titulo', 'comisiones.texto',
    'cta.prueba', 'pasos', 'cta.candado', 'cta.precio', 'cta.no'];
  for (const k of claves) {
    const hits = i18n.match(new RegExp(`"gancho\.${k.replace('.', '\.')}": "([^"]*)"`, 'g')) || [];
    assert.equal(hits.length, 2, `gancho.${k} en EN y ES`);
    for (const h of hits) assert.doesNotMatch(h, /\bfree\b|gratis/i, `gancho.${k} sin "free/gratis"`);
  }
});
