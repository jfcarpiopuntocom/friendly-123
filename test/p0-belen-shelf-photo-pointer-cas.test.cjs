'use strict';
// Real mock backend, isolated shop fixture. Belén photo pointer CAS: no stale writer overwrites.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
async function context(){
 const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
 const shelf=await w.request('/api/ubicaciones','POST',{nombre:'SYNTHETIC Belén CAS shelf'});
 let broadcasts=0;w.addEventListener('oc-catalogo-cambiado',()=>broadcasts++);
 const put=(body)=>w.fetch('/api/ubicaciones/'+shelf.id,{method:'PUT',body:JSON.stringify(body)});
 const current=()=>JSON.parse(JSON.stringify(w.catalog().ubicaciones.find(u=>u.id===shelf.id)));
 return {w,shelf,put,current,broadcasts:()=>broadcasts};
}
test('RED: stale photo pointer with expected empty hash+rev gets 409, not a silent overwrite',async()=>{
 const {put,current,broadcasts}=await context();
 assert.equal((await put({fotoHash:A})).status,200);
 const before=current(),prevEvents=broadcasts();
 assert.equal(before.fotoHash,A);
 const reply=await put({fotoHash:B,expectedFotoHash:null,expectedFotoRev:null});
 assert.equal(reply.status,409,'old local photo must NOT replace new remote photo');
 assert.deepEqual(current(),before,'409 cannot mutate photo, revision or other shelf fields');
 assert.equal(broadcasts(),prevEvents,'409 cannot publish catalog');
});
test('CAS permits only exact observed photo revision, rejects replay after next writer',async()=>{
 const {put,current}=await context();
 assert.equal((await put({fotoHash:A})).status,200);
 const first=current();
 const ok=await put({fotoHash:B,expectedFotoHash:A,expectedFotoRev:first.fotoRev});
 assert.equal(ok.status,200,'valid preimage should commit');
 const after=current();
 assert.equal(after.fotoHash,B);
 assert.notDeepEqual(after.fotoRev,first.fotoRev,'each photo write gets independent rev');
 const late=await put({fotoHash:C,expectedFotoHash:A,expectedFotoRev:first.fotoRev});
 assert.equal(late.status,409,'stale repeat must not beat concurrent newer photo');
 assert.deepEqual(current(),after);
});
test('legacy calls without expected fields retain compatibility; malformed expected rev fails closed',async()=>{
 const {put,current}=await context();
 assert.equal((await put({fotoHash:A})).status,200);
 const base=current();
 assert.equal((await put({fotoHash:B,expectedFotoHash:A,expectedFotoRev:{c:'not-revision',d:base.fotoRev.d}})).status,409);
 assert.deepEqual(current(),base);
 assert.equal((await put({nombre:'New name without photo change'})).status,200);
 assert.equal(current().fotoHash,A);
});
