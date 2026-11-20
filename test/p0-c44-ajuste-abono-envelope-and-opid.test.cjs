'use strict';
// C44: exact-source contract for ajuste (stock.adjust) and abono (credit.payment.record)
// across docs/mock-backend.js, docs/sync-realtime.js, and docs/sync-yjs.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'docs/mock-backend.js'), 'utf8');
const realtime = fs.readFileSync(path.join(root, 'docs/sync-realtime.js'), 'utf8');
const syncYjs = fs.readFileSync(path.join(root, 'docs/sync-yjs.js'), 'utf8');

function extractTranslator() {
  const start = syncYjs.indexOf('    function _traducirOpLegadoAComando20(op, licenciaFallback) {');
  assert.ok(start > 0, 'C31 translator must exist in docs/sync-yjs.js');
  const end = syncYjs.indexOf('    API.traducirOpLegadoAComando20 =', start);
  assert.ok(end > start, 'C31 translator closing boundary must exist');
  return new Function(syncYjs.slice(start, end) + '\nreturn _traducirOpLegadoAComando20;')();
}

test('C44: mock-backend ajuste op carries stockNuevo + validated opId and translates to stock.adjust', () => {
  const stamp = 'const op = { productoId: p.id, delta: d';
  const start = backend.indexOf(stamp);
  assert.ok(start > 0, 'ajuste op construction must exist in docs/mock-backend.js');
  const end = backend.indexOf('if (fisico === null) _prepararOpStock(op);', start);
  assert.ok(end > start, 'ajuste _prepararOpStock boundary must exist');
  const snippet = backend.slice(start, end);
  assert.match(snippet, /stockNuevo\s*:\s*p\.stockActual/, 'ajuste op must carry stockNuevo: p.stockActual');
  assert.match(snippet, /opId\s*:/, 'ajuste op must carry durable opId');

  const translate = extractTranslator();
  const cmd = translate({
    opId: 'adj-c44-0001',
    tipo: 'ajuste',
    _salaOrigen: 'F123-ABCDEF1234567890',
    payload: { productoId: 'prod-1', delta: 3, stockNuevo: 8, opId: 'adj-c44-0001' }
  }, 'F123-ABCDEF1234567890');
  assert.equal(cmd?.kind, 'stock.adjust');
  assert.equal(cmd?.productId, 'prod-1');
  assert.equal(cmd?.quantity, 8);
});

test('C44: mock-backend abono emits typed credit.customer.payment.record op without fabricating receivableId', () => {
  const start = backend.indexOf('recibo = await window.AMG.Cartera.registrarMovimiento');
  assert.ok(start > 0, 'Cartera.registrarMovimiento must exist in docs/mock-backend.js');
  const end = backend.indexOf('const info = await window.AMG.Cartera.saldoDeCliente', start);
  assert.ok(end > start, 'saldoDeCliente boundary must exist');
  const snippet = backend.slice(start, end);
  assert.match(snippet, /typeof emitirOpStock === ["']function["']/, 'abono must guard emitirOpStock for isolated VM tests');
  assert.match(snippet, /emitirOpStock\(\s*["']abono["']/, 'abono must emit emitirOpStock("abono", ...)');
  assert.match(snippet, /amountCents\s*:\s*Math\.round\(monto\s*\*\s*100\)/, 'abono op must carry integer amountCents');
  assert.match(snippet, /clienteId\s*:\s*c\.id/, 'abono op must carry clienteId');
  assert.doesNotMatch(snippet, /receivableId\s*:/, 'abono must never synthesize receivableId from receipt or client id');

  const translate = extractTranslator();
  const cmdCust = translate({
    opId: 'customer-payment:abono_c44_0001',
    tipo: 'abono',
    _salaOrigen: 'F123-ABCDEF1234567890',
    payload: { clienteId: 'cli-1', amountCents: 1500, opId: 'customer-payment:abono_c44_0001' }
  }, 'F123-ABCDEF1234567890');
  assert.equal(cmdCust?.kind, 'credit.customer.payment.record');
  assert.equal(cmdCust?.clienteId, 'cli-1');
  assert.equal(cmdCust?.amountCents, 1500);

  const cmdRec = translate({
    opId: 'abono-c44-0001',
    tipo: 'abono',
    _salaOrigen: 'F123-ABCDEF1234567890',
    payload: { receivableId: 'rec-99', amountCents: 1500, opId: 'abono-c44-0001' }
  }, 'F123-ABCDEF1234567890');
  assert.equal(cmdRec?.kind, 'credit.payment.record');
  assert.equal(cmdRec?.receivableId, 'rec-99');
  assert.equal(cmdRec?.amountCents, 1500);

  const remoteStart = backend.indexOf('    aplicarOpRemota(op) {');
  assert.ok(remoteStart > 0, 'aplicarOpRemota must exist');
  const remoteSection = backend.slice(remoteStart, remoteStart + 1200);
  assert.match(remoteSection, /op\.tipo\s*!==\s*["']abono["']/, 'aplicarOpRemota must not reject abono with stock-proof-missing');
});

test('C44: OCSyncEmit in docs/sync-realtime.js preserves durable opId for venta, ajuste, and abono', () => {
  const start = realtime.indexOf('window.OCSyncEmit = function (tipo, payload) {');
  assert.ok(start > 0, 'OCSyncEmit must exist in docs/sync-realtime.js');
  const end = realtime.indexOf('const sala = leerSala();', start);
  assert.ok(end > start, 'leerSala boundary must exist in OCSyncEmit');
  const fnBody = realtime.slice(start, end);

  assert.match(fnBody, /ajuste/, 'OCSyncEmit durable opId guard must handle ajuste');
  assert.match(fnBody, /abono/, 'OCSyncEmit durable opId guard must handle abono');

  const evalCode = `
    function uuidCorto() { return 'uuid-' + (++seq); }
    ${fnBody.replace('window.OCSyncEmit = function (tipo, payload) {', 'function _check(tipo, payload) {')}
    return opIdVentaDurable;
    }
    return _check;
  `;
  const check = new Function('seq', evalCode)(0);
  assert.equal(check('venta', { opId: 'sale-c44-0001', cantidad: 1, amountCents: 1500 }), 'sale-c44-0001');
  assert.equal(check('ajuste', { opId: 'adj-c44-0001', productoId: 'p1', stockNuevo: 8 }), 'adj-c44-0001');
  assert.equal(check('abono', { opId: 'customer-payment:abono_c44_0001', clienteId: 'cli-1', amountCents: 1500 }), 'customer-payment:abono_c44_0001');
  assert.equal(check('abono', { opId: 'abono-c44-0001', receivableId: 'rec-1', amountCents: 1500 }), 'abono-c44-0001');
  assert.match(check('abono', { opId: 'abono-c44-0001', clienteId: 'cli-1', amountCents: 1500 }), /^uuid-/);
  assert.match(check('ajuste', { opId: 'bad:id', productoId: 'p1', stockNuevo: 8 }), /^uuid-/);
  assert.match(check('abono', { opId: 'abono-c44-0001', receivableId: 'rec-1', amountCents: 0 }), /^uuid-/);
});
