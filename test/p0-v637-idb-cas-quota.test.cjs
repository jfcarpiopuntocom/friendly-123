'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');
test('strict IDB CAS put quota throw fails closed and preserves quota error',async()=>{
 const db={objectStoreNames:{contains:()=>true},close(){},transaction(){
   const tx={error:null,objectStore(){return {
     get(){const req={};queueMicrotask(()=>{req.result={_rev:0};req.onsuccess?.();});return req;},
     put(){throw new DOMException('synthetic disk quota exhausted','QuotaExceededError');}
   };},abort(){queueMicrotask(()=>tx.onabort?.());}};return tx;
 }};
 const indexedDB={open(){const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;}};
 const window={indexedDB};
 new Function('window','indexedDB','navigator','setTimeout','clearTimeout','console',source)(
   window,indexedDB,{},setTimeout,clearTimeout,{error(){}});
 const ok=await window.OCEstadoIDB.guardarConRevision({_rev:1,productos:[],ubicaciones:[]},0);
 assert.equal(ok,false,'quota failure cannot acknowledge sale or stock');
 assert.equal(window.OCEstadoIDB.ultimoError()?.name,'QuotaExceededError','actual failure must be available to in-UI status');
});
