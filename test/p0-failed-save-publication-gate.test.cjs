'use strict';
// P0: a failed durable save must not be bypassed by a later in-flight background save.
// Synthetic-only, no customer credentials, external transport, or production writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const tick=()=>new Promise(r=>setImmediate(r));

test('failed durable save blocks speculative publication during the next pending save',async()=>{
  const entries=new Map();
  let fail=false;
  const storage={
    get length(){return entries.size;},
    key:i=>[...entries.keys()][i],
    getItem:k=>entries.get(k)??null,
    setItem(k,v){if(fail)throw Error('synthetic storage failure');entries.set(k,String(v));},
    removeItem:k=>entries.delete(k)
  };
  const w=browser(storage);
  w.OCAuth={rolActual:()=> 'dueno'};
  await w.request('/api/ubicaciones','POST',{nombre:'Synthetic initial',tipo:'socio'});
  // First save fails in both A/B and IndexedDB. RAM now diverges from durable state.
  fail=true;
  w.OCEstadoIDB={guardar:async()=>false};
  await w.request('/api/ubicaciones','POST',{nombre:'Synthetic failed',tipo:'socio'});
  for(let i=0;i<20;i++)await tick();
  assert.equal(w.OCSync.catalogoPropio(),null,'failure must block outbound snapshots');

  // Another edit queues a pending IndexedDB write. It is NOT durable yet.
  let settle;
  w.OCEstadoIDB={guardar:()=>new Promise(resolve=>{settle=resolve;})};
  await w.request('/api/ubicaciones','POST',{nombre:'Synthetic still pending',tipo:'socio'});
  for(let i=0;i<20;i++)await tick();
  assert.equal(typeof settle,'function','second attempt reached durable storage');
  assert.equal(w.OCSync.catalogoPropio(),null,
    'an unresolved retry cannot publish RAM after an earlier durable failure');
  let announced=false;
  const awaitingCatalog=w.OCSync.catalogoConfirmado().then(value=>{
    announced=true;return value;
  });
  for(let i=0;i<20;i++)await tick();
  assert.equal(announced,false,'sender must WAIT for the durable recovery ACK');

  settle(true);
  const recovered=await awaitingCatalog;
  for(let i=0;i<20;i++)await tick();
  assert.ok(recovered,'sender resumes with a confirmed catalog after recovery');
  assert.ok(w.OCSync.catalogoPropio(),
    'a successful later durable confirmation clears the publication block');
});
