'use strict';
// Synthetic browser-only proof of a single-snapshot transaction.
// Not proof of the real sale handler, commission ledger or iPhone PWA.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const code=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');
for(const [label,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
test('P0 local-first '+label+': one opId, atomic snapshot sale/outbox/dedup, abort and readback', {timeout:60000},async()=>{
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>P0 IDB fixture</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async()=>{
   await new Promise((resolve,reject)=>{
    const open=indexedDB.open('f123_estado',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('estado');
    open.onsuccess=()=>{
     const db=open.result,tx=db.transaction('estado','readwrite');
     tx.objectStore('estado').put({_rev:1,productos:[{id:'p',stockActual:2}],ventas:[],movimientos:[]},'actual');
     tx.oncomplete=()=>{db.close();resolve();};
     tx.onabort=()=>reject(tx.error);
    };
    open.onerror=()=>reject(open.error);
   });
  });
  await page.addScriptTag({content:code});
  const results=await page.evaluate(async()=>{
   const db=window.OCEstadoIDB;
   const apply=(next,{opId})=>{
    const product=next.productos[0];
    if(product.stockActual<1)return null;
    product.stockActual-=1;
    next.ventas.push({opId,id:opId,productoId:'p',cantidad:1,precioUnit:15,fecha:'2026-11-11T00:00:00Z'});
    next.movimientos.push({opId,id:'m-'+opId,tipo:'venta',monto:15,cantidad:1});
    return {resultado:{ventaId:opId,total:15}};
   };
   const data={opCifrada:'ciphertext:synthetic-encrypted-01'};
   const [a,b]=await Promise.all([
    db.registrarHechoLocal('sale-op-001','venta',data,apply,()=>true),
    db.registrarHechoLocal('sale-op-001','venta',data,apply,()=>true)]);
   const first=await db.leer();
   const conflict=await db.registrarHechoLocal('sale-op-001','venta',{opCifrada:'ciphertext:DIFFERENT'},apply,()=>true);
   const lostRole=await db.registrarHechoLocal('sale-op-002','venta',data,apply,()=>false);
   const rejected=await db.registrarHechoLocal('sale-op-003','venta',data,()=>null,()=>true);
   const beforeSecond=await db.leer();
   const second=await db.registrarHechoLocal('sale-op-004','venta',data,apply,()=>true);
   const afterSecond=await db.leer();
   // A stale legacy serializer without _dedup/_outbox must never overwrite
   // a committed local sale, even if it supplies a newer revision.
   const stale=JSON.parse(JSON.stringify(afterSecond));
   delete stale._dedup;delete stale._outbox;stale._rev=afterSecond._rev+1;
   const lostMetadata=await db.guardarConRevision(stale,afterSecond._rev);
   const afterStale=await db.leer();
   return {a,b,conflict,lostRole,rejected,second,lostMetadata,
    afterStale:{rev:afterStale._rev,stock:afterStale.productos[0].stockActual,
     dedup:Object.keys(afterStale._dedup||{}),outbox:Object.keys(afterStale._outbox||{})},
    first:{stock:first.productos[0].stockActual,ventas:first.ventas.length,movimientos:first.movimientos.length,rev:first._rev,outbox:Object.keys(first._outbox||{}),dedup:Object.keys(first._dedup||{})},
    beforeSecond:{stock:beforeSecond.productos[0].stockActual,ventas:beforeSecond.ventas.length,rev:beforeSecond._rev},
    afterSecond:{stock:afterSecond.productos[0].stockActual,ventas:afterSecond.ventas.length,movimientos:afterSecond.movimientos.length,rev:afterSecond._rev,outbox:Object.keys(afterSecond._outbox||{}),dedup:Object.keys(afterSecond._dedup||{})}
   };
  });
  assert.equal(results.a.ok,true);
  assert.equal(results.b.ok,true);
  assert.equal([results.a,results.b].filter(x=>x.duplicate).length,1,'second tap same id is no-op');
  assert.deepEqual(results.first,{stock:1,ventas:1,movimientos:1,rev:2,outbox:['sale-op-001'],dedup:['sale-op-001']});
  assert.equal(results.conflict.ok,false,'same opId different encrypted payload is not ACKed');
  assert.equal(results.lostRole.ok,false,'revoked identity aborts before write');
  assert.equal(results.rejected.ok,false,'invalid business mutation aborts');
  assert.deepEqual(results.beforeSecond,{stock:1,ventas:1,rev:2});
  assert.equal(results.second.ok,true);
  assert.equal(results.lostMetadata,false,'legacy serializer may not erase committed opId/outbox');
  assert.deepEqual(results.afterStale,{rev:3,stock:0,
   dedup:['sale-op-001','sale-op-004'],outbox:['sale-op-001','sale-op-004']});
  assert.deepEqual(results.afterSecond,{stock:0,ventas:2,movimientos:2,rev:3,
   outbox:['sale-op-001','sale-op-004'],dedup:['sale-op-001','sale-op-004']});
  // A reload after an ACK lost by the UI must recover the same operation.
  await page.reload();
  await page.addScriptTag({content:code});
  const recovered=await page.evaluate(async()=>{
    const db=window.OCEstadoIDB;
    return db.registrarHechoLocal('sale-op-001','venta',
      {opCifrada:'ciphertext:synthetic-encrypted-01'},
      ()=>{throw Error('duplicate mutated again');},()=>true);
  });
  assert.equal(recovered.ok,true);
  assert.equal(recovered.duplicate,true);
  console.log('P0 local-first '+label+': atomic synthetic snapshot/dedup/outbox, abort and same-id retry PASS; not integrated');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
}
