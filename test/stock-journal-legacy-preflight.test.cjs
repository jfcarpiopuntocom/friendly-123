'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {auditLegacy}=require('../lab/stock-journal/legacy-preflight.cjs');
const book='legacy-synthetic-only';
const snap=(device,productos)=>({device,notebook:book,productos});
const product=(base,actual,pn={},id='cream')=>({id,stockBase:base,stockActual:actual,stockPN:pn});
test('P0: PC 15+3=18 vs phone 13+3=16 never guesses which baseline to migrate',()=>{
 const r=auditLegacy({notebook:book,snapshots:[
  snap('pc',[product(15,18,{pc:{add:3,sub:0}})]),
  snap('phone',[product(13,16,{phone:{add:3,sub:0}})])
 ]});
 assert.equal(r.canAutoMigrate,false);
 assert.deepEqual(r.products[0].candidateBaselines,[13,15]);
 assert.deepEqual(r.products[0].displaysObserved,[16,18]);
 assert.ok(r.products[0].issues.includes('divergent-baselines'));
 assert.ok(r.products[0].issues.includes('divergent-displayed-stock'));
});
test('same displayed 18 still is NOT proof of identical historical epochs',()=>{
 const r=auditLegacy({notebook:book,snapshots:[
  snap('pc',[product(15,18,{pc:{add:3,sub:0}})]),
  snap('phone',[product(15,18,{pc:{add:3,sub:0}})])
 ]});
 assert.equal(r.products[0].canAutoMigrate,false);
 assert.ok(r.products[0].issues.includes('unverifiable-legacy-epoch'));
});
test('stockEvidencias alternative base survives in read-only diagnostic output',()=>{
 const p=product(13,16,{phone:{add:3,sub:0}});
 p.stockEvidencias={'15':{base:15,pn:{pc:{add:3,sub:0}}}};
 const r=auditLegacy({notebook:book,snapshots:[snap('phone',[p])]});
 assert.deepEqual(r.products[0].candidateBaselines,[13,15]);
 assert.equal(r.canAutoMigrate,false);
});
test('metadata privacy: do not export customer names, PIN, prices or photos in audit',()=>{
 const p=product(3,3);p.nombre='PRIVATE-STORED-SKU';p.pin='654321';p.fotos=['secret-photo'];p.precio=999;
 const r=auditLegacy({notebook:book,snapshots:[snap('pc',[p])]});
 const out=JSON.stringify(r);
 assert.doesNotMatch(out,/PRIVATE-STORED-SKU|654321|secret-photo|999/);
});
test('malformed PN records and cross-notebook snapshots cannot be silently accepted',()=>{
 const p=product(10,12,{pc:{add:-3,sub:0}});
 const r=auditLegacy({notebook:book,snapshots:[snap('pc',[p])]});
 assert.ok(r.malformed.length>0);assert.equal(r.canAutoMigrate,false);
 assert.throws(()=>auditLegacy({notebook:book,snapshots:[{...snap('pc',[p]),notebook:'other'}]}),/cross-notebook/);
});
test('duplicate device snapshots are refused rather than faking two independent witnesses',()=>{
 assert.throws(()=>auditLegacy({notebook:book,snapshots:[snap('pc',[]),snap('pc',[])]}),/duplicate device/);
});
