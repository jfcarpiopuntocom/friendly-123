'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const m=pathToFileURL(path.join(__dirname,'../src/foto-pointer-intent-idb.mjs')).href;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const orig=(opId='photo-op:synthetic-B')=>({opId,photoHash:B,expectedFotoHash:A,expectedFotoRev:{c:4,d:'device-A'}});
async function store(idb=new IDBFactory(),ns=C){
 const {createShelfPhotoIntentStore}=await import(m);
 return createShelfPhotoIntentStore({indexedDB:idb,namespace:ns});
}
test('RED v802: offline photo pointer intention survives browser restart in IDB without saving photo bytes',async()=>{
 const db=new IDBFactory(),a=await store(db);
 assert.equal(await a.get('rack-A'),null);
 assert.equal((await a.putIfAbsent('rack-A',orig())).created,true);
 const reload=await store(db);
 assert.deepEqual(await reload.get('rack-A'),orig());
 assert.doesNotMatch(JSON.stringify(await reload.get('rack-A')),/base64|data:image|PIN|licenseCode/);
});
test('RED v802: two tabs cannot replace pending pointer with a different opId',async()=>{
 const db=new IDBFactory(),a=await store(db),b=await store(db);
 const out=await Promise.allSettled([a.putIfAbsent('rack-A',orig('photo-op:first')),b.putIfAbsent('rack-A',orig('photo-op:second'))]);
 assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(out.filter(x=>x.status==='rejected').length,1);
 assert.match((await a.get('rack-A')).opId,/^photo-op:(first|second)$/);
});
test('RED v802: pending pointers are per notebook and shelf; no cross-store claims',async()=>{
 const db=new IDBFactory(),a=await store(db),b=await store(db,'d'.repeat(64));
 await a.putIfAbsent('rack-A',orig());
 assert.equal(await a.get('rack-B'),null);
 assert.equal(await b.get('rack-A'),null);
 assert.deepEqual(await a.get('rack-A'),orig());
});
test('RED v802: only exact original opId can delete a pending pointer after ACK',async()=>{
 const db=new IDBFactory(),a=await store(db);
 await a.putIfAbsent('rack-A',orig());
 await assert.rejects(a.removeIfOp('rack-A','photo-op:other'),/conflict|opId|different/i);
 assert.deepEqual(await a.get('rack-A'),orig());
 assert.equal(await a.removeIfOp('rack-A','photo-op:synthetic-B'),true);
 assert.equal(await a.get('rack-A'),null);
});
test('RED v802: storage quota, bad hashes and invalid IDs reject before photo PUT',async()=>{
 const {createShelfPhotoIntentStore}=await import(m);
 assert.throws(()=>createShelfPhotoIntentStore({indexedDB:new IDBFactory(),namespace:'plaintext-license'}),/namespace/i);
 const bad=await store({open(){throw new Error('QuotaExceededError')}});
 await assert.rejects(bad.putIfAbsent('rack-A',orig()),/QuotaExceeded|persistence/i);
 const a=await store();
 await assert.rejects(a.putIfAbsent('rack-A',{...orig(),photoHash:'fake'}),/hash|photo/i);
 await assert.rejects(a.putIfAbsent('',orig()),/shelf|id/i);
});
test('RED v802: published ESM bytes must be exactly independently reviewed and manifest referenced',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/foto-pointer-intent-idb.mjs'));
 const shipped=fs.readFileSync(path.join(__dirname,'../docs/foto-pointer-intent-idb.mjs'));
 assert.ok(src.equals(shipped));
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/version-manifest.json'),'utf8'));
 assert.equal(manifest.files['./foto-pointer-intent-idb.mjs'],'sha256-'+crypto.createHash('sha256').update(shipped).digest('hex'));
 const sw=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
 assert.match(sw,/"\.\/foto-pointer-intent-idb\.mjs"/);
});
