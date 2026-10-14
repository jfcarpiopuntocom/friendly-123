// JFC 2026-10-14: "acabo de entrar al dashboard y dice v498 arriba". La etiqueta era texto
// fijo y la meta dashboard-shell se quedo en v502 mientras version.json iba en v507: el
// actualizador del tablero nunca recargaba y bajaba dashboard.html cada 15 s para nada.
// Esta prueba exige que la meta sea SIEMPRE el shell vigente y que la etiqueta salga de ella.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const docs = (f) => fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8');

test('meta dashboard-shell = shell de version.json', () => {
  const shell = JSON.parse(docs('version.json')).shell;
  const meta = (docs('dashboard.html').match(/<meta\s+name="dashboard-shell"\s+content="([^"]+)"/) || [])[1];
  assert.equal(meta, shell);
});

test('la etiqueta visible sale de la meta, no de un numero escrito a mano', () => {
  const label = { textContent: 'Dashboard v498' };
  const c = { document: { querySelector: (s) => s.includes('dashboard-shell') ? { content: 'f123-shell-v999' } : null, getElementById: (id) => id === 'dashboard-version' ? label : null }, navigator: {}, window: {} };
  vm.createContext(c);
  vm.runInContext(docs('dashboard-updates.js'), c);
  assert.equal(label.textContent, 'Dashboard v999');
});
