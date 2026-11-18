'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {IDBFactory}=require('fake-indexeddb');
const code=fs.readFileSync(path.join(__dirname,'../docs/idb-fotos.js'),'utf8');
const bytes='data:image/jpeg;base64,'+Buffer.from('F123 synthetic photo bytes, no customer content').toString('base64');
function context({factory=new IDBFactory(),hasIDB=true,local={}}={}){
 const values=new Map(Object.entries(local));
 const ls={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),
  removeItem:k=>values.delete(k),key:n=>Array.from(values.keys())[n]||null,get length(){return values.size}};
 const w={crypto:webcrypto,localStorage:ls,TextEncoder,
  ...(hasIDB?{indexedDB:factory}:{})};
 const c={window:w,localStorage:ls,...(hasIDB?{indexedDB:factory}:{}),console,
  crypto:webcrypto,TextEncoder,atob:s=>Buffer.from(s,'base64').toString('binary'),
  setTimeout,clearTimeout,Uint8Array,Array,Date,Promise};
 vm.runInNewContext(code,c,{filename:'idb-fotos.js'});
 return {f:w.OCFotos,values,factory};
}
test('STK-H1: hash and exact bytes are proven only AFTER confirmed IndexedDB transaction',async()=>{
 const x=context(),hash='synthetic-confirmed-hash';
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb(hash,bytes),false);
 assert.equal(await x.f.guardarPorHash(hash,bytes),true);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb(hash,bytes),true);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb(hash,bytes+'changed'),false);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb('different-hash',bytes),false);
});
test('STK-H1: after restart, transient proof is reset until strict IndexedDB readback',async()=>{
 const factory=new IDBFactory(),hash='synthetic-persisted-hash';
 const a=context({factory});
 assert.equal(await a.f.guardarPorHash(hash,bytes),true);
 const b=context({factory});
 assert.equal(b.f.tieneFotoHashConfirmadoEnIdb(hash,bytes),false);
 assert.equal(await b.f.leerPorHash(hash),bytes);
 assert.equal(b.f.tieneFotoHashConfirmadoEnIdb(hash,bytes),true);
});
test('STK-H1: no IndexedDB = legacy blob fallback is NOT treated as IDB durability proof',async()=>{
 const x=context({hasIDB:false}),hash='synthetic-legacy-hash';
 assert.equal(await x.f.guardarPorHash(hash,bytes),true);
 assert.equal(await x.f.leerPorHash(hash),bytes);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb(hash,bytes),false);
});
test('STK-H1: an IDB failure with legacy fallback cannot authorize a compacted snapshot',async()=>{
 const hash='synthetic-only-legacy';
 const x=context({factory:{open(){throw new Error('Synthetic blocked IDB')}},local:{['f123_fotoblob_'+hash]:bytes}});
 assert.equal(await x.f.leerPorHash(hash),bytes);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb(hash,bytes),false);
});

test('STK-H1: confirmation memory is bounded; cache eviction never deletes IDB photo bytes',async()=>{
 const x=context();
 for(let i=0;i<67;i++)assert.equal(await x.f.guardarPorHash('synthetic-many-'+i,bytes),true);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb('synthetic-many-0',bytes),false);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb('synthetic-many-66',bytes),true);
 assert.equal(await x.f.leerPorHash('synthetic-many-0'),bytes);
 assert.equal(x.f.tieneFotoHashConfirmadoEnIdb('synthetic-many-0',bytes),true);
});
