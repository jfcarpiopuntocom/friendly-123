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
test('revision-fence rejection after an earlier quota abort is not reported as a storage error (no false 507)',async()=>{
 let modo='quota', guardado={_rev:0};
 const db={objectStoreNames:{contains:()=>true},close(){},transaction(){
   const tx={error:null,objectStore(){return {
     get(){const req={};queueMicrotask(()=>{req.result=guardado;req.onsuccess?.();queueMicrotask(()=>{if(!tx._ab)tx.oncomplete?.();});});return req;},
     put(v){if(modo==='quota')throw new DOMException('synthetic disk quota exhausted','QuotaExceededError');guardado=v;}
   };},abort(){tx._ab=true;queueMicrotask(()=>tx.onabort?.());}};return tx;
 }};
 const indexedDB={open(){const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;}};
 const window={indexedDB};
 new Function('window','indexedDB','navigator','setTimeout','clearTimeout','console',source)(window,indexedDB,{},setTimeout,clearTimeout,{error(){}});
 assert.equal(await window.OCEstadoIDB.guardarConRevision({_rev:1},0),false);
 assert.equal(window.OCEstadoIDB.ultimoError()?.name,'QuotaExceededError');
 modo='ok'; guardado={_rev:5}; // otra pestaña ya avanzó la revisión: la valla rechaza sin escribir
 assert.equal(await window.OCEstadoIDB.guardarConRevision({_rev:3},2),false,'fence rejects the stale base');
 assert.equal(window.OCEstadoIDB.ultimoError(),null,'a fence rejection must not inherit the earlier quota error');
 assert.equal(await window.OCEstadoIDB.guardarConRevision({_rev:6},5),true,'next sale on the current base is accepted');
 assert.equal(window.OCEstadoIDB.ultimoError(),null);
});
