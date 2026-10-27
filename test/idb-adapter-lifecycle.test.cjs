'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function fixture(file){
  const requests=[],connections=[],transactions=[],data=new Map();
  const indexedDB={open(){const req={};requests.push(req);return req;}};
  const local=new Map(),localStorage={get length(){return local.size;},key:i=>[...local.keys()][i]||null,
    getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
  const ctx={window:{indexedDB},indexedDB,localStorage,navigator:{},console:{error(){},warn(){}},setTimeout,clearTimeout,Promise,Map,Set,JSON,Error};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../docs',file),'utf8'),ctx);
  function success(i){
    const req=requests[i],db={objectStoreNames:{contains:()=>true},close(){this.closed=true;},
      transaction(){
        const pending=new Map(),tx={error:null,objectStore(){return{
          put(value,key){pending.set(key,value);},delete(key){pending.set(key,undefined);},
          get(key){const r={};queueMicrotask(()=>{r.result=data.get(key);r.onsuccess?.();});return r;}
        };},complete(){for(const [key,value] of pending){if(value===undefined)data.delete(key);else data.set(key,value);}this.oncomplete?.();},
          abort(){this.error=Error('synthetic abort');this.onabort?.();}};transactions.push(tx);return tx;
      }};
    connections.push(db);req.result=db;req.onupgradeneeded?.();req.onsuccess?.();return db;
  }
  async function waitFor(list,count){for(let i=0;i<100&&list.length<count;i++)await new Promise(setImmediate);assert.ok(list.length>=count,'fixture operation started');}
  const api=ctx.window.OCFotos||ctx.window.OCEstadoIDB;
  return {api,requests,connections,transactions,data,blocked(i){requests[i].onblocked?.();},
    fail(i){requests[i].error=Error('synthetic openerror');requests[i].onerror?.();},success,
    waitRequests:n=>waitFor(requests,n),waitTransactions:n=>waitFor(transactions,n),complete:i=>transactions[i].complete(),
    abort(){transactions.at(-1).abort();}};
}
async function settles(promise,ms=50){return Promise.race([promise,new Promise(r=>setTimeout(()=>r('pending'),ms))]);}

for(const [file,save,read,value] of [
  ['idb-fotos.js',api=>api.guardarFoto('shelf','data:image/png;base64,AQID'),api=>api.leerFoto('shelf'),'data:image/png;base64,AQID'],
  ['estado-idb.js',api=>api.guardarYa({_rev:7,productos:[]}),api=>api.leer(),{_rev:7,productos:[]}]
]){
  test(file+': openerror retries and a blocked request cannot cache or leak its late connection',async()=>{
    const f=fixture(file);const first=save(f.api);await f.waitRequests(1);f.fail(0);assert.equal(await first,false);
    const retry=save(f.api);await f.waitRequests(2);f.success(1);await f.waitTransactions(1);f.complete(0);assert.equal(await retry,true);
    assert.deepEqual(JSON.parse(JSON.stringify(await read(f.api))),value);

    const g=fixture(file);const blocked=save(g.api);await g.waitRequests(1);g.blocked(0);assert.equal(await blocked,false);
    const late=g.success(0);assert.equal(late.closed,true,'late success after blocked rejection closes its handle');
    const retried=save(g.api);await g.waitRequests(2);g.success(1);await g.waitTransactions(1);g.complete(0);assert.equal(await retried,true);
    assert.deepEqual(JSON.parse(JSON.stringify(await read(g.api))),value);
  });
  test(file+': versionchange closes and invalidates the cached connection',async()=>{
    const f=fixture(file);const first=save(f.api);await f.waitRequests(1);const old=f.success(0);await f.waitTransactions(1);f.complete(0);assert.equal(await first,true);
    assert.equal(typeof old.onversionchange,'function','open connection releases on versionchange');
    old.onversionchange();assert.equal(old.closed,true);
    const next=save(f.api);await f.waitRequests(2);f.success(1);await f.waitTransactions(2);f.complete(1);assert.equal(await next,true);
    assert.deepEqual(JSON.parse(JSON.stringify(await read(f.api))),value);
  });
}

for(const [file,save] of [
  ['idb-fotos.js',api=>api.guardarFoto('shelf','data:image/png;base64,AQID')],
  ['estado-idb.js',api=>api.guardarYa({_rev:7,productos:[]})]
])test(file+': aborted write settles as failure',async()=>{
  const f=fixture(file),opening=save(f.api);await f.waitRequests(1);f.success(0);await f.waitTransactions(1);f.abort();
  assert.equal(await settles(opening),false,'abort must settle the write as failure');
});
