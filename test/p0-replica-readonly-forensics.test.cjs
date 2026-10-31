'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compare}=require('../scripts/p0-compare-replicas.cjs');
const {browser}=require('./helpers/browser.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
async function backups(){
  const a=await browser().request('/api/respaldo/exportar');
  const b=clone(a);
  a._recuperacion={licenseCode:'F123-SYNTHETIC-TEST',notebookId:'different-device-A'};
  b._recuperacion={licenseCode:'F123-SYNTHETIC-TEST',notebookId:'different-device-B'};
  return [a,b];
}
test('P0 forensic detects equality despite separate device notebook IDs',async()=>{
  const [a,b]=await backups();
  const result=compare(a,b);
  assert.equal(result.identity,'same-license-reported');
  assert.equal(result.result,'NO_DIFFERENCE_DETECTED');
  assert.equal(result.canAutoReconcile,false);
});
test('P0 forensic flags epoch forks and never invents a physical winner',async()=>{
  const [a,b]=await backups();
  const p=a.productos[0],q=b.productos[0];
  p.stockActual=9;p.stockBase=7;p.stockEpochId='E-LOCAL';
  q.stockActual=6;q.stockBase=7;q.stockEpochId='E-REMOTE';
  const original=JSON.stringify(a);
  const r=compare(a,b);
  assert.equal(r.productEvidence.physicalEpochForks,1);
  assert.equal(r.productEvidence.unequalPhysicalStock,1);
  assert.equal(r.result,'RECONCILIATION_REQUIRED');
  assert.equal(JSON.stringify(a),original);
  assert.equal(r.canAutoReconcile,false);
  assert.ok(!JSON.stringify(r).includes(p.id));
});
test('P0 forensic counts missing real-looking ledger IDs, no user data',async()=>{
  const [a,b]=await backups();
  a.movimientos=[{id:'move-1',tipo:'ajuste',detalle:{nombre:'private client'}}];
  b.movimientos=[{id:'move-2',tipo:'ajuste',detalle:{nombre:'private client'}}];
  a.ventas=[{id:'sale-1',cliente:'private customer'}];b.ventas=[];
  const r=compare(a,b),serialized=JSON.stringify(r);
  assert.equal(r.movementIds.onlyLeft,1);
  assert.equal(r.movementIds.onlyRight,1);
  assert.equal(r.saleIds.onlyLeft,1);
  for(const secret of ['move-1','sale-1','private client','private customer','F123-SYNTHETIC-TEST'])
    assert.ok(!serialized.includes(secret),'never emit '+secret);
});
test('P0 forensic refuses cross-license comparison, never equates instance IDs',async()=>{
  const [a,b]=await backups();b._recuperacion.licenseCode='F123-DIFFERENT';
  const r=compare(a,b);
  assert.equal(r.result,'BLOCKED_IDENTITY');
  assert.equal(r.dataCompared,false);
});
test('P0 forensic preserves uncertainty when source identity is not recorded',async()=>{
  const [a,b]=await backups();delete b._recuperacion;
  const r=compare(a,b);assert.equal(r.identity,'UNKNOWN_LICENSE');
  assert.equal(r.canAutoReconcile,false);
  assert.equal(r.result,'UNVERIFIED_IDENTITY');
});
test('P0 forensic rejects partial and duplicate-ID backups, never writes',async()=>{
  const [a,b]=await backups();
  assert.throws(()=>compare({...a,parcial:true},b),/full notebook/);
  a.productos.push(clone(a.productos[0]));
  assert.throws(()=>compare(a,b),/duplicate/);
});

test('P0 forensic detects conflicting money and movement records with SAME IDs',async()=>{
  const [a,b]=await backups();
  a.ventas=[{id:'same-sale',total:10,cliente:'confidential'}];
  b.ventas=[{cliente:'confidential',total:12,id:'same-sale'}];
  a.movimientos=[{id:'same-movement',tipo:'ajuste',detalle:{delta:-1,nota:'confidential'}}];
  b.movimientos=[{tipo:'ajuste',id:'same-movement',detalle:{nota:'confidential',delta:-2}}];
  const r=compare(a,b);
  assert.equal(r.saleIds.onlyLeft,0);
  assert.equal(r.movementIds.onlyRight,0);
  assert.equal(r.salePayloadConflicts,1);
  assert.equal(r.movementPayloadConflicts,1);
  assert.equal(r.result,'RECONCILIATION_REQUIRED');
  assert.ok(!JSON.stringify(r).includes('confidential'));
});


test('P0 local PRIVATE mode identifies exact missing opIds and epochs without mutation',async()=>{
  const {privateDetails}=require('../scripts/p0-compare-replicas.cjs');
  const [pc,phone]=await backups();
  pc.movimientos=[{id:'op-pc-only',tipo:'ajuste'}];
  phone.movimientos=[{id:'op-phone-last',tipo:'ajuste'}];
  pc.ventas=[{id:'sale-pc-last',total:20}];phone.ventas=[];
  pc.productos[0].stockActual=3;pc.productos[0].stockEpochId='epoch-pc';
  phone.productos[0].stockActual=7;phone.productos[0].stockEpochId='epoch-phone';
  const before=JSON.stringify({pc,phone});
  const normal=compare(pc,phone),report=privateDetails(pc,phone);
  assert.equal(JSON.stringify({pc,phone}),before,'original exports are immutable');
  assert.equal(normal.canAutoReconcile,false);
  assert.equal(report.PRIVATE_LOCAL_ONLY,true);
  assert.deepEqual(report.movements.onlyInPC,['op-pc-only']);
  assert.deepEqual(report.movements.onlyInPhone,['op-phone-last']);
  assert.deepEqual(report.sales.onlyInPC,['sale-pc-last']);
  assert.equal(report.physical[0].pc.stockEpochId,'epoch-pc');
  assert.equal(report.physical[0].phone.stockEpochId,'epoch-phone');
  assert.ok(!JSON.stringify(normal).includes('op-phone-last'),'public summary stays sanitized');
});
