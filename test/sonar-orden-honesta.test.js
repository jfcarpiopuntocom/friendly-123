// JFC 2026-09-30: el panel decia "hecho" tras PUSH y los clientes seguian en la version vieja
// (sonar.yml corre cada 4-7 h, no cada 5 min). El panel ahora mide la verdad en los canales,
// promover.yml atiende el PUSH en su ventana, y los canarios son los sprites CC0 de Mantis.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../docs/panel.html'), 'utf8');
const fn = src.match(/function sonarOrdenCumplida[\s\S]*?\n}\n/)[0];
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
test('canaries are the credited CC0 Mantis sprites, not hand-drawn shapes', () => {
  assert.match(src, /SONAR_TIRA = "data:image\/png;base64,/);
  assert.match(src, /Mantis, OpenGameArt/); assert.match(src, /CC0/);
  assert.doesNotMatch(src, /<ellipse cx="\$\{x\}"/);
});
