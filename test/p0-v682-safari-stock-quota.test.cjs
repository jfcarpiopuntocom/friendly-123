'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');
function fixture({failure='quota',online=true,server=true,servedShell='f123-shell-v682',cacheName='f123-shell-v682-golden226',takeover=false,optional=true,failAttempts=1}={}){
 let stored={_rev:7,productos:[{id:'p',stockActual:32}],movimientos:[]},attempts=0;
 const cacheEntries=new Set(['https://example.test/friendly-123/index.html','https://example.test/friendly-123/mock-backend.js',...(optional?['https://example.test/friendly-123/vendor/jspdf-4.2.1.umd.min.js','https://example.test/friendly-123/manual.html']:[])]);
 const deleted=[],names=new Set([cacheName,'f123-shell-v681-golden225-next','customer-photos']);
 const cached={keys:async()=>[...cacheEntries].map(url=>({url})),
  delete:async req=>{const url=typeof req==='string'?req:req.url;deleted.push(url);const ok=cacheEntries.delete(url);if(takeover)stored={_rev:9,productos:[{id:'p',stockActual:30}],movimientos:[{id:'other'}]};return ok;}};
 const caches={keys:async()=>[...names],delete:async n=>{deleted.push(n);return names.delete(n);},open:async n=>{assert.equal(n,cacheName);return cached;}};
 const db={objectStoreNames:{contains:()=>true},transaction(){
  const n=++attempts;let written;
  const tx={error:null,objectStore(){return {get(){
    const req={result:stored};queueMicrotask(()=>{req.onsuccess();queueMicrotask(()=>{
      if(n<=failAttempts&&failure!=='none'&&written){const err=new Error(failure);err.name=failure==='quota'?'QuotaExceededError':'AbortError';tx.error=err;tx.onabort();}
      else{if(written)stored=written;tx.oncomplete();}
    });});return req;},
    put(x){written=structuredClone(x);}}}};
  return tx;
 }};
 const indexedDB={open(){const q={result:db};queueMicrotask(()=>q.onsuccess());return q;}};
 const window={indexedDB,caches,location:{pathname:'/friendly-123/index.html'}};
 const network=async()=>({ok:server,json:async()=>({shell:servedShell,cacheGeneration:'golden226'})});
 vm.runInNewContext(src,{window,indexedDB,navigator:{onLine:online,storage:{}},fetch:network,console,Promise,setTimeout,clearTimeout,queueMicrotask,structuredClone});
 return {idb:window.OCEstadoIDB,deleted,cacheEntries,get attempts(){return attempts},get state(){return stored}};
}
test('RED: current-only Safari shell quota frees only optional generated resources and commits stock 32→31',async()=>{
 const f=fixture();
 const ok=await f.idb.guardarConRevision({_rev:8,productos:[{id:'p',stockActual:31}],movimientos:[{id:'adj',delta:-1}]},7);
 assert.equal(ok,true,'must ACK only after actual atomic IndexedDB commit');
 assert.equal(f.attempts,2);
 assert.equal(f.state.productos[0].stockActual,31);
 assert.equal(f.state.movimientos.length,1);
 assert.equal(f.deleted.some(x=>x.endsWith('/vendor/jspdf-4.2.1.umd.min.js')),true);
 assert.equal(f.cacheEntries.has('https://example.test/friendly-123/index.html'),true);
 assert.equal(f.cacheEntries.has('https://example.test/friendly-123/mock-backend.js'),true);
 assert.equal(f.deleted.includes('customer-photos'),false);
 assert.equal(f.deleted.includes('f123-shell-v681-golden225-next'),false);
});
test('offline or mismatched release refuses reclaim and still rejects unsaved count',async()=>{
 for(const o of [{online:false},{server:false},{servedShell:'f123-shell-v683'}]){
  const f=fixture(o);
  assert.equal(await f.idb.guardarConRevision({_rev:8,productos:[{stockActual:31}]},7),false);
  assert.equal(f.state.productos[0].stockActual,32);
  assert.deepEqual(f.deleted,[]);
 }
});
test('P0: Safari transient nonquota abort retries the stock transaction once without cache deletion',async()=>{
 const f=fixture({failure:'abort'});
 assert.equal(await f.idb.guardarConRevision({_rev:8,productos:[{id:'p',stockActual:31}],movimientos:[{id:'one',delta:-1}]},7),true);
 assert.equal(f.attempts,2);
 assert.equal(f.state.productos[0].stockActual,31);
 assert.equal(f.state.movimientos.length,1);
 assert.deepEqual(f.deleted,[],'no cache deletion for nonquota errors');
});
test('persistent abort and quota without optional assets fail closed',async()=>{
 for(const o of [{failure:'abort',failAttempts:2},{optional:false}]){
  const f=fixture(o);
  assert.equal(await f.idb.guardarConRevision({_rev:8},7),false);
  assert.equal(f.state._rev,7);
  assert.deepEqual(f.deleted,[]);
 }
});
test('cross-tab physical adjustment during reclaim wins CAS, never clobbered by stale 31',async()=>{
 const f=fixture({takeover:true});
 assert.equal(await f.idb.guardarConRevision({_rev:8,productos:[{id:'p',stockActual:31}]},7),false);
 assert.equal(f.attempts,2);
 assert.equal(f.state.productos[0].stockActual,30);
});
