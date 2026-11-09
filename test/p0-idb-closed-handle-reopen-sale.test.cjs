'use strict';
// P0 single-device: Safari/PWA can resume with a cached CLOSED IndexedDB connection.
// All data is synthetic. Never acknowledge a sale before an actual IDB CAS commit.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');

function fixture(firstError,secondError,revision=4){
 let opens=0,puts=0,closed=0;
 const saved={actual:{_rev:revision,productos:[],ventas:[]}};
 const indexedDB={open(){
   const req={},attempt=++opens;
   const db={
     objectStoreNames:{contains:()=>true},
     close(){closed++},
     transaction(name,mode,options){
       const problem=attempt===1?firstError:secondError;
       if(problem)throw new DOMException('synthetic transaction could not start',problem);
       assert.equal(name,'estado');
       assert.equal(mode,'readwrite');
       assert.equal(options.durability,'strict');
       let candidate,aborted=false;
       const tx={error:null,objectStore(){return {
         get(key){
           const get={};
           queueMicrotask(()=>{
             get.result=saved[key];
             get.onsuccess?.();
             queueMicrotask(()=>{
               if(aborted)return;
               if(candidate)saved[key]=candidate;
               tx.oncomplete?.();
             });
           });
           return get;
         },
         put(next,key){candidate=next;puts++;}
       }},abort(){aborted=true;queueMicrotask(()=>tx.onabort?.())}};
       return tx;
     }
   };
   queueMicrotask(()=>{req.result=db;req.onsuccess?.()});
   return req;
 }};
 const window={indexedDB};
 new Function('window','indexedDB','navigator','setTimeout','clearTimeout','console',source)(
   window,indexedDB,{onLine:false},setTimeout,clearTimeout,{error(){},warn(){}}
 );
 return {api:window.OCEstadoIDB,stats:()=>({opens,puts,closed,saved})};
}

test('P0 RED: closed cached IDB handle is reopened ONCE, with the exact sale CAS before ACK',async()=>{
 const f=fixture('InvalidStateError',null,4);
 const sale={_rev:5,productos:[{id:'p-test',stockActual:3}],ventas:[{id:'sale-one'}]};
 assert.equal(await f.api.guardarConRevision(sale,4),true,
   'closed IDB connection is recoverable without falling back to a falsely acknowledged A/B sale');
 const s=f.stats();
 assert.equal(s.opens,2,'reopen exactly once');
 assert.equal(s.puts,1,'only one durable put');
 assert.equal(s.saved.actual._rev,5);
 assert.equal(s.saved.actual.ventas[0].id,'sale-one');
 assert.equal(f.api.ultimoError(),null);
});

test('P0 RED: re-open must recheck disk revision and reject a stale sale',async()=>{
 const f=fixture('InvalidStateError',null,6);
 const sale={_rev:7,productos:[],ventas:[{id:'stale-sale'}]};
 assert.equal(await f.api.guardarConRevision(sale,4),false,
   'even after reopening, a newer receipt must win; never acknowledge a stale sale');
 assert.equal(f.stats().opens,2);
 assert.equal(f.stats().puts,0,'no write following stale CAS');
 assert.equal(f.stats().saved.actual._rev,6);
});

test('P0 RED: repeatedly closed DB fails closed after bounded ONE reopen',async()=>{
 const f=fixture('InvalidStateError','InvalidStateError',4);
 assert.equal(await f.api.guardarConRevision({_rev:5,ventas:[{id:'one'}]},4),false);
 assert.equal(f.stats().opens,2,'no open/retry loop');
 assert.equal(f.stats().puts,0);
 assert.equal(f.api.ultimoError()?.name,'InvalidStateError');
});

test('P0: true quota is never treated as a closed connection',async()=>{
 const f=fixture('QuotaExceededError',null,4);
 assert.equal(await f.api.guardarConRevision({_rev:5,ventas:[{id:'one'}]},4),false);
 assert.equal(f.stats().opens,1,'no retry for quota');
 assert.equal(f.stats().puts,0);
 assert.equal(f.api.ultimoError()?.name,'QuotaExceededError');
});
