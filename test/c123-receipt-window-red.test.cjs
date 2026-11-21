'use strict';
// C123 RED: exact production snapshot expression and cold-open receipt retention.
// Run: node --test test/c123-receipt-window-red.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
test('C123: 2,001 durable remote receipts survive cold-open when localStorage quota is full',()=>{
 const line=source.split('\n').find(x=>x.includes('? { opsAplicadas:'));
 assert.ok(line,'production notebook exports durable op receipts');
 const expr=line.match(/opsAplicadas:\s*(.+?)\s*}\s*:/);
 assert.ok(expr,'extract real production receipt snapshot expression');
 const old=Array.from({length:2001},(_,i)=>'remote-stock:'+i);
 const sandbox={_opsAplicadas:new Set(old),_opsDelCuaderno:null};
 const exported=vm.runInNewContext(expr[1],sandbox);
 const persisted=JSON.parse(JSON.stringify({opsAplicadas:exported}));
 // No localStorage fallback: emulate quota-full and a fresh browser process.
 const reopened=new Set(persisted.opsAplicadas);
 assert.equal(reopened.size,2001,'all 2001 unacknowledged receipts must remain durable');
 assert.ok(reopened.has(old[0]),'oldest opId must not replay stock after cold-open');
});

test('C124: runtime receipt set never evicts old opIds; only best-effort localStorage mirror is bounded',()=>{
 const start=source.indexOf('function _marcarOpAplicada(opId)');
 const end=source.indexOf('function _fundirHechoStock',start);
 assert.ok(start>0 && end>start,'production receipt marker is present');
 const body=source.slice(start,end);
 assert.doesNotMatch(body, /s\.clear\(\)|s\.delete\(/, 'canonical receipts must not be evicted');
 assert.match(body, /s\.add\(opId\)/, 'runtime records every opId');
 assert.match(body, /JSON\.stringify\(\[\.\.\.s\]\.slice\(-2000\)\)/, 'only optional localStorage mirror is bounded');
 const ids=Array.from({length:10001},(_,i)=>'remote:'+i);
 const canonical=new Set(ids);
 const mirror=[...canonical].slice(-2000);
 assert.equal(canonical.size,10001);
 assert.equal(mirror.length,2000);
 assert.ok(canonical.has(ids[0]) && !mirror.includes(ids[0]));
});

test('C124: execute actual marker 10,001 times; oldest receipt survives despite quota-full localStorage',()=>{
 const start=source.indexOf('function _marcarOpAplicada(opId)');
 const end=source.indexOf('function _fundirHechoStock',start);
 assert.ok(start>0 && end>start);
 const marker=source.slice(start,end);
 const applied=new Set();
 let mirrorWrites=0;
 const sandbox={
   _cargarOpsAplicadas:()=>applied,
   OPS_APLICADAS_KEY:'test-receipts',
   localStorage:{setItem(_key,value){
     mirrorWrites++;
     const ids=JSON.parse(value);
     assert.ok(ids.length<=2000,'best-effort mirror must remain bounded');
     throw new Error('QuotaExceededError');
   }},
   JSON,Set
 };
 vm.runInNewContext(marker+'; globalThis.mark=_marcarOpAplicada;',sandbox);
 for(let i=0;i<10001;i++)sandbox.mark('remote:'+i);
 assert.equal(applied.size,10001,'all receipts remain in canonical Set');
 assert.ok(applied.has('remote:0')&&applied.has('remote:5000')&&applied.has('remote:10000'));
 assert.equal(mirrorWrites,10001,'quota errors do not prevent canonical receipt insertion');
});
