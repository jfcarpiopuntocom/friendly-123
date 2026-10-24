'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = src.indexOf('  function _guardarEstadoLocalAhora(');
const end = src.indexOf('  function avisoEspacioJusto(', start);
const guard = src.slice(start, end);
test('quota recovery keeps historic photos and movements when persistence fails', () => {
  assert.ok(start > 0 && end > start, 'actual storage code selected');
  assert.doesNotMatch(guard, /localStorage\.removeItem\(/, 'do not delete unique legacy photo evidence');
  assert.doesNotMatch(guard, /movimientos\.slice\(/, 'do not truncate forensic movement history');
  assert.doesNotMatch(guard, /archivarLote\(/, 'no unacknowledged asynchronous archive');
  assert.match(guard, /_idb\.then\(\(ok\) =>/, 'success requires actual durable IDB acknowledgement');
  assert.match(guard, /else avisoMemoriaLlena\(\)/, 'retain explicit warning when both stores fail');
});
