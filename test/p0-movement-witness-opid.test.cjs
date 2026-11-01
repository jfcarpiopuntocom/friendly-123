'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const yjs=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const first=source.indexOf('  function _fundirHechoStock(p, w) {');
const end=source.indexOf('  /* v515: quien gana',first);
assert.ok(first>=0&&end>first,'real stock witness projector from production');
const context=vm.createContext({});
vm.runInContext(source.slice(first,end),context);
function merge(p,w){context.p=p;context.w=w;return vm.runInContext('_fundirHechoStock(p,w)',context);}
test('stock from unique movement counters converges regardless of delivery order',()=>{
 const A={base:7,epoch:'E1',actor:'iphone',add:0,sub:2};
 const B={base:7,epoch:'E1',actor:'pc',add:4,sub:0};
 const c={stockBase:7,stockEpochId:'E1',stockActual:7,stockPN:{}};
 const d={stockBase:7,stockEpochId:'E1',stockActual:7,stockPN:{}};
 for(const fact of [A,B,A])assert.equal(merge(c,fact),true);
 for(const fact of [B,A,B])assert.equal(merge(d,fact),true);
 assert.equal(c.stockActual,9);assert.equal(d.stockActual,9);
 assert.deepEqual(JSON.parse(JSON.stringify(c.stockPN)),JSON.parse(JSON.stringify(d.stockPN)));
});
test('older cumulative movement cannot roll back a newer one; repeated op is idempotent',()=>{
 const p={stockBase:5,stockEpochId:'E2',stockActual:5,stockPN:{}};
 assert.equal(merge(p,{base:5,epoch:'E2',actor:'iphone',add:0,sub:4}),true);
 assert.equal(p.stockActual,1);
 assert.equal(merge(p,{base:5,epoch:'E2',actor:'iphone',add:0,sub:1}),true);
 assert.equal(merge(p,{base:5,epoch:'E2',actor:'iphone',add:0,sub:4}),true);
 assert.equal(p.stockActual,1);
});
test('an unrelated physical epoch and invalid counters cannot invent stock',()=>{
 const p={stockBase:7,stockEpochId:'E2',stockActual:7,stockPN:{}};
 assert.equal(merge(p,{base:7,epoch:'E1',actor:'pc',add:1,sub:0}),false);
 assert.equal(merge(p,{base:7,epoch:'E2',actor:'pc',add:-1,sub:0}),false);
 assert.equal(p.stockActual,7);assert.deepEqual(JSON.parse(JSON.stringify(p.stockPN)),{});
});
test('sync path carries opId and commits read model before dedup; no legacy double sale',()=>{
 assert.match(source,/payload\.stockPNHecho = \{ base: _sp\.stockBase/);
 assert.match(source,/if \(witness\) \{/);
 assert.match(source,/Promise\.resolve\(guardarEstadoLocal\(true\)\)/);
 assert.match(source,/if \(saved !== true\) return \{ok:false/);
 assert.match(source,/if \(localStorage\.getItem\("f123_ops_delta_activo"\) !== "1"\)/);
 assert.match(yjs,/!API\.opsMap \|\| _opsAsyncBusy/);
 assert.match(yjs,/if \(ok\) pedirProcesarEventos\(\)/);
});
