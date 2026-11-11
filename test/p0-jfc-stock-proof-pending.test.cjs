'use strict';
// P0 · Reproduce the JFC PN bridge's silent ACK for an unwitnessed stock op.
// Synthetic-only: loads the exact production receiver branch; no network/client state.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = src.indexOf('      const witness = op.payload && op.payload.stockPNHecho;');
const end = src.indexOf('      const pl = op.payload;', start);
assert.ok(start >= 0 && end > start, 'real PN/neutralized receiver code present');
const apply = new Function(
  'op', 'window', 'productos', 'guardarEstadoLocal', '_fundirHechoStock',
  'clonar', '_marcarOpAplicada', 'avisarCatalogoCambiado', 'localStorage',
  src.slice(start, end)
);

function run({ jfc, witness, base = 13, epoch = 'E1' }) {
  const acknowledgements = [];
  const product = { id:'spray', stockActual:base, stockBase:base,
    stockEpochId:epoch, stockPN:{}, stockDeficit:0 };
  const op = { opId:'stock-op-1', tipo:'ajuste', payload:{ productoId:'spray', delta:-1 } };
  if (witness !== undefined) op.payload.stockPNHecho = witness;
  const result = apply(op, { OCYjs:{ esLicenciaPruebaJfc:jfc } }, [product],
    () => Promise.resolve(true),
    (p, w) => { if (w.base !== p.stockBase || w.epoch !== p.stockEpochId) return false;
      p.stockActual -= 1; return true; },
    (p) => JSON.parse(JSON.stringify(p)), id => acknowledgements.push(id),
    () => {}, { getItem:() => null });
  return { result, acknowledgements, product };
}

test('RED: a JFC stock movement without causal witness remains pending, never ACKed', () => {
  const x = run({jfc:true});
  assert.deepEqual(x.result, {ok:false,error:'stock-proof-missing'});
  assert.deepEqual(x.acknowledgements, []);
  assert.equal(x.product.stockActual,13);
});

test('existing legacy neutralized path is preserved for non-pilot licences', () => {
  const x = run({jfc:false});
  assert.deepEqual(x.result,{ok:true,neutralizado:true});
  assert.deepEqual(x.acknowledgements,['stock-op-1']);
  assert.equal(x.product.stockActual,13);
});

test('JFC different physical epoch is never ACKed or applied optimistically', () => {
  const x = run({jfc:true,witness:{base:13,epoch:'E2',actor:'phone',add:0,sub:1}});
  assert.deepEqual(x.result,{ok:false,error:'stock-epoch-or-proof-conflict'});
  assert.deepEqual(x.acknowledgements,[]);
  assert.equal(x.product.stockActual,13);
});

test('JFC conflicting physical bases (33 vs 15) are not silently merged or ACKed', () => {
  const x = run({jfc:true,base:15,epoch:'E1',
    witness:{base:33,epoch:'E1',actor:'iphone',add:0,sub:1}});
  assert.deepEqual(x.result,{ok:false,error:'stock-epoch-or-proof-conflict'});
  assert.deepEqual(x.acknowledgements,[]);
  assert.equal(x.product.stockActual,15, 'no invented 32 or double subtraction');
});

test('JFC witnessed movement retains its existing durable ACK behavior', async () => {
  const x = run({jfc:true,witness:{base:13,epoch:'E1',actor:'phone',add:0,sub:1}});
  assert.deepEqual(await x.result,{ok:true});
  assert.deepEqual(x.acknowledgements,['stock-op-1']);
  assert.equal(x.product.stockActual,12);
});
