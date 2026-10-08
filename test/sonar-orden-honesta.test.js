// JFC 2026-09-30: el panel decia "hecho" tras PUSH y los clientes seguian en la version vieja
// (sonar.yml corre cada 4-7 h, no cada 5 min). El panel ahora mide la verdad en los canales,
// promover.yml atiende el PUSH en su ventana, y los canarios son los sprites CC0 de Mantis.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../docs/panel.html'), 'utf8');
// Windows checkouts (core.autocrlf) bring CRLF: accept both line endings so the test checks logic, not the OS.
const fn = src.match(/function sonarOrdenCumplida[\s\S]*?\r?\n}\r?\n/)[0];
const sonarOrdenCumplida = new Function(fn + '; return sonarOrdenCumplida;')();
const v = (p, e, n) => [{ shell: p }, { shell: e }, { shell: n }];

test('PUSH not yet applied reads PENDIENTE; applied reads CUMPLIDA', () => {
  assert.match(sonarOrdenCumplida({ accion: 'push', at: Date.now() }, v('v428', 'v429', 'v431')), /^PENDIENTE/);
  assert.match(sonarOrdenCumplida({ accion: 'push', at: Date.now() }, v('v429', 'v431', 'v431')), /^CUMPLIDA/);
});
test('REWIND and stale orders', () => {
  assert.match(sonarOrdenCumplida({ accion: 'rewind', at: Date.now() }, v('v428', 'v428', 'v431')), /^CUMPLIDA/);
  assert.match(sonarOrdenCumplida({ accion: 'push', at: Date.now() - 2 * 86400000 }, v('v428', 'v429', 'v431')), /vencida/);
});
test('the confirmation no longer reads as done', () => { assert.match(src, /Todavía NO está hecha/); });
test('promover.yml honors a panel PUSH during its window', () => {
  const y = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/promover.yml'), 'utf8');
  assert.match(y, /pushPedido/); assert.match(y, /sonar-\$\{\{ steps\.v\.outputs\.orden \}\}/);
});
test('canaries are JFC sprite files (img/canario*.png), not hand-drawn shapes', () => {
  // v441 (JFC 2026-10-02): la tira CC0 de Mantis se reemplazo por el sprite que entrego JFC.
  // La guarda real sigue: nada de pajaros dibujados con figuras SVG.
  assert.match(src, /img\/\$\{rojo \? "canario-caido" : "canario"\}\.png/);
  const fs = require('fs'), path = require('path');
  ['canario.png', 'canario-caido.png'].forEach((n) => assert.ok(fs.statSync(path.join(__dirname, '..', 'docs', 'img', n)).size > 1000, n));
  assert.doesNotMatch(src, /<ellipse cx="\$\{x\}"/);
});
