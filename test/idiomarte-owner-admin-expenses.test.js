'use strict';
// idiomARTE owner/admin regression. Isolated in-memory profiles and synthetic records only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');

const DOCS=path.join(__dirname,'../docs');
async function device(role, ls) {
  const w=browser(ls);
  delete w.JSON;
  Object.assign(w,{
    crypto:webcrypto,TextEncoder,TextDecoder,
    F123Relay:{connect(){throw Error('synthetic no live relay');}},
    WebSocket:class{constructor(){throw Error('no network');}},
    BroadcastChannel:class{constructor(){throw Error('no cross-test channel');}}
  });
  w.OCAuth={rolActual:()=>role};
  vm.runInContext(fs.readFileSync(path.join(DOCS,'vendor/yjs-bundle.min.js'),'utf8'),w);
  w.IndexeddbPersistence=class{once(){}};
  w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-IDIOMARTE-ONLY'}));
  vm.runInContext(fs.readFileSync(path.join(DOCS,'sync-yjs.js'),'utf8'),w);
  for(let n=0;n<100&&w.OCYjs.estado!=='activo';n++)await delay(10);
  assert.equal(w.OCYjs.estado,'activo');
  return w;
}
function transfer(from,to) {
  const update=from.Y.encodeStateAsUpdate(from.OCYjs.doc);
  to.Y.applyUpdate(to.OCYjs.doc,update,'red');
  to.OCYjs._store.aplicar();
}
function expenses(w) {return w.request('/api/gastos').then(x=>x.gastos);}
const monthly=(w,rows,ym)=>w.OCBusinessReadModel.monthly([],rows,ym,'America/Guayaquil').expensesCents;

test('Admin expense creates one durable row on Owner, then moves calendar months after editing',async()=>{
  const owner=await device('dueno'),admin=await device('admin');
  assert.equal(owner.OCYjs.roomId,admin.OCYjs.roomId, 'same synthetic notebook');
  const x=await admin.request('/api/gastos','POST',{
    concepto:'Synthetic workshop receipt',monto:18.50,
    categoria:'services',metodoPago:'cash',fecha:'2026-10-20T16:00:00-05:00'
  });
  admin.OCYjs._store.sembrar();transfer(admin,owner);
  let own=await expenses(owner);
  assert.equal(own.filter(r=>r.id===x.id).length,1);
  assert.equal(own.find(r=>r.id===x.id).monto,18.5);
  assert.equal(monthly(owner,own,'2026-10'),1850);
  assert.equal(monthly(owner,own,'2026-09'),0);

  await admin.request('/api/gastos/'+x.id,'PATCH',{
    monto:17.5,fecha:'2026-09-30T14:00:00-05:00',metodoPago:'transfer'
  });
  admin.OCYjs._store.sembrar();transfer(admin,owner);
  own=await expenses(owner);
  assert.equal(own.filter(r=>r.id===x.id).length,1,'expense not duplicated after remote edit');
  assert.equal(own.find(r=>r.id===x.id).monto,17.5);
  assert.equal(own.find(r=>r.id===x.id).metodoPago,'transfer');
  assert.equal(monthly(owner,own,'2026-09'),1750);
  assert.equal(monthly(owner,own,'2026-10'),0);

  // A stale owner reseed must not put the October version back into the Yjs map.
  owner.OCYjs._store.sembrar();
  transfer(owner,admin);transfer(admin,owner);
  assert.equal((await expenses(admin)).filter(r=>r.id===x.id).length,1);
  assert.equal((await expenses(owner)).find(r=>r.id===x.id).monto,17.5);
});

test('Owner/Admin notebook expense set remains consistent across local browser reload',async()=>{
  const owner=await device('dueno'),admin=await device('admin');
  const item=await admin.request('/api/gastos','POST',{concepto:'Synthetic receipt survives reload',monto:9.25,fecha:'2026-10-20T16:00:00-05:00'});
  admin.OCYjs._store.sembrar();transfer(admin,owner);
  const before=(await expenses(owner)).find(r=>r.id===item.id);
  assert.ok(before);
  // Local durable store is reused; no live relay or user data.
  const opened=await device('dueno',owner.localStorage);
  const after=(await expenses(opened)).find(r=>r.id===item.id);
  assert.ok(after,'saved expense survives new browser process');
  assert.equal(after.monto,before.monto);
  assert.equal(after.fecha,before.fecha);
});
