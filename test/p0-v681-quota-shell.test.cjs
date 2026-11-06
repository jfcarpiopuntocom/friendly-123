'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');

// Synthetic transaction emulator: fail ONLY on the first attempted durable
// put. Never point this at customer data or a real license.
function fixture({failure='quota',online=true,cacheNames=['f123-shell-v681-golden225'],
  servedVersion='f123-shell-v681',cacheGeneration='golden225',remoteOK=true,takeover=false}={}) {
  let stored={_rev:7,ventas:[]},tries=0;
  const kept=new Set(cacheNames),removed=[];
  const caches={
    keys:async()=>[...kept],
    delete:async name=>{
      removed.push(name);
      const ok=kept.delete(name);
      if(takeover)stored={_rev:9,ventas:[{id:'another-sale'}]};
      return ok;
    }
  };
  const db={
    objectStoreNames:{contains:()=>true},
    transaction(){
      const attempt=++tries;
      let pending=null;
      const tx={error:null,objectStore(){return{
        get(){
          const req={result:stored};
          queueMicrotask(()=>{
            req.onsuccess();
            queueMicrotask(()=>{
              if(attempt===1&&failure!=='none'&&pending){
                const err=new Error(failure);
                err.name=failure==='quota'?'QuotaExceededError':'AbortError';
                tx.error=err;tx.onabort();
              }else{
                if(pending)stored=pending;
                tx.oncomplete();
              }
            });
          });
          return req;
        },
        put(x){pending=structuredClone(x);}
      };}};
      return tx;
    }
  };
  const indexedDB={open(){
    const req={result:db};
    queueMicrotask(()=>req.onsuccess());
    return req;
  }};
  const fetch=async()=>({ok:remoteOK,json:async()=>({shell:servedVersion,cacheGeneration})});
  const window={indexedDB,caches,location:{pathname:'/friendly-123/index.html'}};
  vm.runInNewContext(src,{window,indexedDB,navigator:{onLine:online,storage:{}},
    fetch,console,Promise,setTimeout,clearTimeout,queueMicrotask,structuredClone});
  return{ idb:window.OCEstadoIDB,get state(){return stored;},
    get tries(){return tries;},removed,kept };
}
test('live v681 can recover quota without old shells, only after online version proof',async()=>{
  const f=fixture();
  assert.equal(await f.idb.guardarConRevision({_rev:8,ventas:[{id:'test-sale'}]},7),true);
  assert.equal(f.tries,2);
  assert.deepEqual(f.removed,['f123-shell-v681-golden225']);
  assert.equal(f.state.ventas[0].id,'test-sale');
});
test('offline sale failure never destroys the last offline shell or fakes ACK',async()=>{
  const f=fixture({online:false});
  assert.equal(await f.idb.guardarConRevision({_rev:8,ventas:[{id:'test'}]},7),false);
  assert.equal(f.tries,1);
  assert.deepEqual(f.removed,[]);
});
test('unverified network / mismatched deployed shell forbids cache deletion',async()=>{
  for(const opts of [{remoteOK:false},{servedVersion:'f123-shell-v682'},{cacheGeneration:'golden226'}]){
    const f=fixture(opts);
    assert.equal(await f.idb.guardarConRevision({_rev:8},7),false);
    assert.deepEqual(f.removed,[]);
  }
});
test('nonquota abort never deletes any cache',async()=>{
  const f=fixture({failure:'abort'});
  assert.equal(await f.idb.guardarConRevision({_rev:8},7),false);
  assert.deepEqual(f.removed,[]);
});
test('a competing sale still wins CAS during emergency cache release',async()=>{
  const f=fixture({takeover:true});
  assert.equal(await f.idb.guardarConRevision({_rev:8,ventas:[{id:'own'}]},7),false);
  assert.equal(f.tries,2);
  assert.equal(f.state.ventas[0].id,'another-sale');
});
test('stale older shell is deleted first; current offline shell is preserved',async()=>{
  const f=fixture({cacheNames:['f123-shell-v650-golden120','f123-shell-v681-golden225']});
  assert.equal(await f.idb.guardarConRevision({_rev:8,ventas:[{id:'test-sale'}]},7),true);
  assert.deepEqual(f.removed,['f123-shell-v650-golden120']);
  assert.equal(f.kept.has('f123-shell-v681-golden225'),true);
});
