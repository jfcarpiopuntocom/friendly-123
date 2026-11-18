'use strict';
// Execute the unmodified production module; no real storage or network.
// An IDB transaction can abort WITHOUT firing transaction.onerror.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
const KEY='f123_sync_pending';

function storage({abort=false,localQuota=false}={}) {
  const local=new Map([[KEY,'synthetic-older-ciphertext']]), durable=new Map();
  const warnings=[];
  const db={transaction(name,mode){
    assert.equal(name,'cola');assert.equal(mode,'readwrite');
    const tx={error:abort?new Error('synthetic-transaction-abort'):null};
    tx.objectStore=()=>({put(row){
      assert.equal(row.id,KEY);
      queueMicrotask(()=>{
        if(abort){tx.onabort?.({type:'abort',target:tx});return;}
        durable.set(row.id,structuredClone(row));
        tx.oncomplete?.({type:'complete',target:tx});
      });
    }});
    return tx;
  }};
  const ctx={
    window:{},
    indexedDB:{open(name,version){
      assert.equal(name,'f123_outbox');assert.equal(version,1);
      const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;
    }},
    localStorage:{
      getItem:k=>local.get(k)||null,
      setItem(k,v){if(localQuota)throw new Error('synthetic-quota');local.set(k,v);},
      removeItem:k=>{local.delete(k);}
    },
    console:{warn:(...args)=>warnings.push(args.map(String).join(' '))},Date,Promise
  };
  vm.runInNewContext(code,ctx,{filename:'sync-outbox.js'});
  assert.equal(typeof ctx.window.OCOutbox.guardar,'function');
  return {api:ctx.window.OCOutbox,local,durable,warnings};
}
async function outcome(p){
  return Promise.race([
    Promise.resolve(p).then(value=>({settled:true,value})),
    new Promise(resolve=>setTimeout(()=>resolve({settled:false}),150))
  ]);
}

test('IDB transaction abort alone resolves via encrypted localStorage fallback, not a permanent wait',async()=>{
  const x=storage({abort:true});
  const result=await outcome(x.api.guardar('synthetic-new-ciphertext'));
  assert.equal(result.settled,true,'aborted IDB tx must settle, even without onerror event');
  assert.equal(result.value,true,'verified legacy fallback can acknowledge its local write');
  assert.equal(x.local.get(KEY),'synthetic-new-ciphertext');
  assert.equal(x.durable.size,0,'aborted transaction did not commit');
});
test('IDB abort plus localStorage quota returns false, never a fabricated durable success',async()=>{
  const x=storage({abort:true,localQuota:true});
  const result=await outcome(x.api.guardar('synthetic-new-ciphertext'));
  assert.equal(result.settled,true,'dual-store failure must settle so caller can warn owner');
  assert.equal(result.value,false,'nothing committed to either storage');
  assert.equal(x.local.get(KEY),'synthetic-older-ciphertext','failed write cannot delete old journal');
  assert.equal(x.durable.size,0);
});
test('IDB commit success retains original priority and retires duplicate localStorage backup',async()=>{
  const x=storage();
  const result=await outcome(x.api.guardar('synthetic-new-ciphertext'));
  assert.equal(result.settled,true);
  assert.equal(result.value,true);
  assert.equal(x.durable.get(KEY).blob,'synthetic-new-ciphertext');
  assert.equal(x.local.has(KEY),false,'old localStorage mirror removed only after IDB completes');
});
