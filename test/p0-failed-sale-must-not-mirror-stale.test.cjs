'use strict';
// P0: an unconfirmed CAS sale must never publish a newer stale background
// snapshot that overwrites a valid concurrent receipt. Synthetic store only.
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { browser }=require('./helpers/browser.cjs');
async function fixture(){
  const app=browser();app.OCAuth={rolActual:()=>'dueno'};
  const product=await app.request('/api/productos','POST',{
    nombre:'Synthetic same-device sale race',barcode:'SALE-RACE-SYNTHETIC-ONLY',
    sku:'SALE-RACE-SYNTHETIC-ONLY',precio:15,costo:6,stockInicial:4,
    umbralRojo:1,umbralAmarillo:2
  });
  const baseline=await app.request('/api/respaldo/exportar');
  assert.ok(Number.isSafeInteger(baseline._rev), 'synthetic baseline has a durable revision');
  return {app,product,baseline};
}
test('P0 RED: rejected strict sale never mirrors rolled-back state as newer durable snapshot',async()=>{
  const {app,product,baseline}=await fixture();
  let mirrors=0,strict=0;
  app.OCEstadoIDB={
    soportado:true,
    guardarConRevision:async()=>{strict++;return false;},
    guardar:async()=>{mirrors++;return true;},
    ultimoError:()=>null
  };
  const response=await app.fetch('/api/productos/'+product.id+'/venta',{
    method:'POST',body:JSON.stringify({cantidad:1})
  });
  assert.equal(response.status,503,'no optimistic receipt when strict CAS refuses');
  await Promise.resolve();await Promise.resolve();
  assert.equal(strict,1);
  assert.equal(mirrors,0,'never mirror unconfirmed/rolled-back sale as a newer revision');
  const after=await app.request('/api/respaldo/exportar');
  assert.equal(after.productos.find(x=>x.id===product.id).stockActual,4);
  assert.equal(after.ventas.length,baseline.ventas.length,'rollback leaves no ghost receipt');
});
test('P0 RED: rejected stale CAS rebases from newer IDB receipt and retries exactly once',async()=>{
  const {app,product,baseline}=await fixture();
  const latest=JSON.parse(JSON.stringify(baseline));
  latest._rev+=1;
  let saves=0,committed=null;const mirrors=[];
  app.OCEstadoIDB={
    soportado:true,
    guardarConRevision:async(snapshot,expected)=>{
      saves++;
      if(saves===1)return false; // simulated independent more-recent writer
      assert.equal(expected,latest._rev,'retry must use newest durable revision');
      committed=JSON.parse(JSON.stringify(snapshot));return true;
    },
    guardar:async(snapshot)=>{mirrors.push(JSON.parse(JSON.stringify(snapshot)));return true;},
    leer:async()=>JSON.parse(JSON.stringify(latest)),
    ultimoError:()=>null
  };
  const res=await app.fetch('/api/productos/'+product.id+'/venta',{
    method:'POST',body:JSON.stringify({cantidad:1})
  });
  assert.equal(res.status,200,'a safe one-time rebase should sell without asking user to reload');
  const response=await res.json();
  assert.ok(response.ventaId);
  assert.equal(saves,2,'at most one retry after newer state verified');
  assert.ok(committed,'receipt exists only on a successful strict CAS');
  assert.equal(committed.ventas.filter(v=>v.id===response.ventaId).length,1);
  assert.equal(committed.productos.find(x=>x.id===product.id).stockActual,3);
  assert.ok(mirrors.every(x=>x.ventas.some(v=>v.id===response.ventaId)),
    'a post-success backup may run, but never publish rolled-back state before rebase');
});
