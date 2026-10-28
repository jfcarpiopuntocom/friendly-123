'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sync-yjs.js'), 'utf8');
const from = src.indexOf('                var conflictoBase = basePrev !== null && baseMia !== null && basePrev !== baseMia;');
const to = src.indexOf('                var base = baseMia !== null ? baseMia : basePrev;', from);
assert(from !== -1 && to > from, 'Cannot find the actual v602 stock epoch arbitration in Yjs');
const body = src.slice(from, to);
function arbitrate(clock, local, doc) {
  const ctx = {
    r: structuredClone(local), prev: structuredClone(doc),
    basePrev: doc.stockBase, baseMia: local.stockBase,
    window: { OCLatencia: { ahoraRelay: () => clock } },
    Number, JSON, Object
  };
  vm.runInNewContext(body, ctx);
  return ctx.r;
}
const newer = {stockBase: 12, stockPN: {phone:{add:0,sub:1}}, stockActual:11,stockTs:1_790_000_000_500};
const older = {stockBase: 14, stockPN: {},stockActual:14,stockTs:0};
for (const unready of [null,undefined,NaN]) {
  const result = arbitrate(unready,newer,older);
  assert.equal(result.stockBase,12,'Unready relay clock must not downgrade a newer phone change');
}
const invalidFuture = arbitrate(1_790_000_000_000,{...newer,stockTs:1_790_000_600_500},older);
assert.equal(invalidFuture.stockBase,14,'Trusted relay clock may reject a future-dated phone edit');
console.log('PASS stock epoch with null/undefined/NaN and trusted relay clock');
