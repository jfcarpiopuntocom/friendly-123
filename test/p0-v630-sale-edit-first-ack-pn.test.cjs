'use strict';
// P0: the FIRST durable snapshot of a sale quantity edit must already contain
// matching stockBase/PN evidence. Synthetic fixture only, no customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const pause = async ready => {
  for (let i=0;i<160 && !ready();i++) await new Promise(r=>setImmediate(r));
  assert.ok(ready(),'strict CAS ACK was not attempted');
};
const copy = x => JSON.parse(JSON.stringify(x));
const product = state => state.productos.find(p=>p.id==='p24');
const ledger = p => p.stockBase + Object.values(p.stockPN||{}).reduce((v,n)=>v+n.add-n.sub,0);
async function setup() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  w.localStorage.setItem('f123_device_id','edit-pn-fixture-device');
  const created = await w.request('/api/productos/p24/venta','POST',{cantidad:2});
  const before = await w.request('/api/respaldo/exportar');
  return {w,id:created.ventaId,before};
}
function queue(s, cantidad) {
  return s.w.fetch('/api/ventas/'+s.id,{method:'PATCH',body:JSON.stringify({cantidad})});
}
function intercept(w) {
  const queue=[];
  let published=0;
  w.OCSyncEmit=()=>{published++;return true};
  w.OCEstadoIDB={guardarConRevision:(snapshot,priorRev)=>new Promise(resolve=>queue.push({snapshot:copy(snapshot),priorRev,resolve}))};
  const original=w.localStorage.setItem;
  w.localStorage.setItem=()=>{throw Error('synthetic quota')};
  return {queue, published:()=>published, restore(){w.localStorage.setItem=original;delete w.OCEstadoIDB}};
}
test('quantity edit: first atomic snapshot contains updated PN before successful ACK',async()=>{
  const s=await setup(), q=intercept(s.w);
  const pending=queue(s,3);await pause(()=>q.queue.length===1);
  const snap=q.queue[0].snapshot,p=product(snap),old=product(s.before);
  assert.equal(q.published(),0,'no publication before commit');
  assert.equal(p.stockActual,old.stockActual-1);
  assert.equal(ledger(p),p.stockActual,'first ACK must include quantity delta in PN');
  assert.equal(p.stockPN['edit-pn-fixture-device'].sub,old.stockPN['edit-pn-fixture-device'].sub+1);
  assert.equal(snap.ventas.find(v=>v.id===s.id).cantidad,3);
  q.queue[0].resolve(true);
  const response=await pending;assert.equal(response.status,200);
  assert.equal(q.published(),1,'one committed sale-edit stock publication');
  q.restore();
  const final=await s.w.request('/api/respaldo/exportar');
  assert.equal(ledger(product(final)),product(final).stockActual);
});
test('quantity edit: rejected atomic ACK restores sale, PN, stock and audit, no ghost event',async()=>{
  const s=await setup(),old=copy(s.before),q=intercept(s.w);
  const pending=queue(s,3);await pause(()=>q.queue.length===1);
  assert.equal(q.published(),0);
  q.queue[0].resolve(false);
  const response=await pending;assert.equal(response.status,503);
  q.restore();
  const after=await s.w.request('/api/respaldo/exportar');
  assert.deepEqual(copy(product(after)),copy(product(old)));
  assert.deepEqual(copy(after.ventas.find(v=>v.id===s.id)),copy(old.ventas.find(v=>v.id===s.id)));
  assert.equal(after.movimientos.length,old.movimientos.length);
  assert.equal(q.published(),0);
});
test('quantity reduction: first atomic ACK has matching positive PN and stock',async()=>{
  const s=await setup(),q=intercept(s.w);
  const pending=queue(s,1);await pause(()=>q.queue.length===1);
  const p=product(q.queue[0].snapshot),old=product(s.before);
  assert.equal(p.stockActual,old.stockActual+1);
  assert.equal(ledger(p),p.stockActual);
  q.queue[0].resolve(true);assert.equal((await pending).status,200);
  q.restore();
});
