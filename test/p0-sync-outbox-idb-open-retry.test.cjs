'use strict';
// Test the actual browser module in a VM. No external network or personal data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
const KEY='f123_sync_pending';

function fixture(firstFailure) {
  let openCalls=0,localQuota=false;
  const legacy=new Map(),durable=new Map();
  const db={transaction(store,mode) {
    assert.equal(store,'cola');
    const tx={};
    tx.objectStore=()=>({
      put(row) {
        assert.equal(mode,'readwrite');
        queueMicrotask(()=>{durable.set(row.id,structuredClone(row));tx.oncomplete?.();});
      },
      get(key) {
        assert.equal(mode,'readonly');
        const req={};queueMicrotask(()=>{req.result=durable.get(key);req.onsuccess?.();});return req;
      }
    });
    return tx;
  }};
  const indexedDB={open(name,version) {
    assert.equal(name,'f123_outbox');assert.equal(version,1);
    openCalls++;
    if(openCalls===1 && firstFailure==='throw')throw new Error('synthetic transient open exception');
    const req=openCalls===1
      ? {error:new Error('synthetic transient '+firstFailure)}
      : {result:db};
    queueMicrotask(()=>{
      if(openCalls===1) {
        if(firstFailure==='blocked') req.onblocked?.();
        else req.onerror?.();
      } else req.onsuccess?.();
    });
    return req;
  }};
  const localStorage={
    getItem:key=>legacy.get(key)||null,
    setItem(key,val){if(localQuota)throw new Error('synthetic full legacy storage');legacy.set(key,val);},
    removeItem:key=>legacy.delete(key)
  };
  const root={window:{},indexedDB,localStorage,console:{warn(){}},Date,Promise};
  vm.runInNewContext(source,root,{filename:'sync-outbox.js'});
  return {
    api:root.window.OCOutbox,durable,legacy,
    get opens(){return openCalls;},
    quota(on){localQuota=on;}
  };
}
for(const kind of ['error','blocked','throw']) {
  test('outbox retries recovered IndexedDB after transient first '+kind+'; never pins failed open',async()=>{
    const f=fixture(kind);
    assert.equal(await f.api.guardar('synthetic-old-encrypted-blob'),true,
      'first open failure must safely use the legacy encrypted backup');
    assert.equal(f.legacy.get(KEY),'synthetic-old-encrypted-blob');
    assert.equal(f.opens,1);
    f.quota(true);
    assert.equal(await f.api.guardar('synthetic-new-encrypted-blob'),true,
      'recovered IDB must be retried even when the legacy fallback is full');
    assert.equal(f.opens,2,'fresh IDB open attempted after the earlier failed Promise');
    assert.equal(f.durable.get(KEY).blob,'synthetic-new-encrypted-blob');
    assert.equal(f.legacy.has(KEY),false,'only a confirmed new IDB commit retires stale backup');
    assert.equal(await f.api.leer(),'synthetic-new-encrypted-blob',
      'read-after-recovery must return the latest durable encrypted blob');
  });
}
