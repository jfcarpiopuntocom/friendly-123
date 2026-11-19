'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
async function init(){const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
 const shelf=await app.request('/api/ubicaciones','POST',{nombre:'SYNTHETIC-PHOTO-CAS-SHELF'});
 return {app,shelf,url:'/api/ubicaciones/'+shelf.id};}
test('P0 RED: photo changed by peer C must reject stale A→B CAS without touching C',async()=>{
 const {app,url,shelf}=await init();
 const old=await app.request(url,'PUT',{fotoHash:A});
 await app.request(url,'PUT',{fotoHash:C});
 await assert.rejects(app.request(url,'PUT',{fotoHash:B,expectedFotoHash:A,expectedFotoRev:old.fotoRev,fotoOpId:'photo-op:stale-B'}),/409|FOTO_CAS_CONFLICT/);
 const actual=(await app.request('/api/ubicaciones')).find(u=>u.id===shelf.id);
 assert.equal(actual.fotoHash,C);
});
test('P0 RED: retry same photo op with already committed hash leaves revision untouched',async()=>{
 const {app,url}=await init();
 const input={fotoHash:B,expectedFotoHash:null,expectedFotoRev:null,fotoOpId:'photo-op:retry-B'};
 const first=await app.request(url,'PUT',input);
 const again=await app.request(url,'PUT',input);
 assert.equal(first.fotoHash,B);assert.deepEqual(again.fotoRev,first.fotoRev);
 assert.deepEqual(again.rev,first.rev);
});
test('P0 RED: partial CAS envelope missing revision fails closed before mutation',async()=>{
 const {app,url,shelf}=await init();
 await assert.rejects(app.request(url,'PUT',{fotoHash:B,expectedFotoHash:null,fotoOpId:'photo-op:invalid'}),/400|FOTO_CAS_BAD_REQUEST/);
 const actual=(await app.request('/api/ubicaciones')).find(u=>u.id===shelf.id);
 assert.equal(actual.fotoHash||null,null);
});
test('P0: unscoped historical photo PUT remains backward compatible',async()=>{
 const {app,url}=await init();
 const x=await app.request(url,'PUT',{fotoHash:A});
 assert.equal(x.fotoHash,A);
});
