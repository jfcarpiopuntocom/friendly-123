'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');

function fixture(localOwner=null){
 const entries=new Map();
 const localStorage={getItem:k=>entries.has(k)?entries.get(k):null,
   setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
 const lic='F123-SYNTHETIC-OWNER-ROOM';
 localStorage.setItem('f123_owned',JSON.stringify({licenseCode:lic,instanceId:'fixture'}));
 localStorage.setItem('photos_synthetic', 'opaque-photo-bytes');
 const metaData={pinsRol:{owner:'642',emp:'583',acct:'914'},ownerPinConfirmado:'731'};
 const window={OCTienda:{licenciaActual:()=>lic},OCYjs:{roomId:'room-for-fixture',
   canal:{recuperando:false},meta:{get:k=>metaData[k],set:(k,v)=>{metaData[k]=v}}},
 };
 const ctx={window,localStorage,crypto:webcrypto,self:{isSecureContext:true,crypto:webcrypto},
 location:{hostname:'localhost'},TextEncoder,TextDecoder,btoa,atob,console};
 vm.runInNewContext(source,ctx);
 return {window,storage:localStorage,meta:metaData};
}

test('P0: owned PWA uses explicit owner credential, not stale Yjs pinsRol, without local secure',async()=>{
 const x=fixture();
 assert.equal(await x.window.OCSecure.identificarPin('731'),'dueno');
 assert.equal(await x.window.OCSecure.identificarPin('642'),null);
 assert.equal(x.storage.getItem('f123_secure'),null,'login does not write a new PIN verifier');
 const recovered=await x.window.OCSecure.instalarCredencialesDesdeSala(
   {...x.meta.pinsRol,owner:x.meta.ownerPinConfirmado});
 assert.equal(recovered,true,'Owner screen can explicitly bootstrap a missing local verifier from exact room');
 assert.equal(await x.window.OCSecure.coincidePin('731','owner'),true);
 assert.equal(x.storage.getItem('photos_synthetic'),'opaque-photo-bytes');
});

test('P0: historical local owner verifier cannot override a confirmed Yjs rotation',async()=>{
 const x=fixture();
 await x.window.OCSecure.guardarSecreto('642',['583'],'914','synthetic@example.invalid');
 assert.equal(await x.window.OCSecure.identificarPin('642'),null,
   'old local owner must not override more recent explicit shared owner credential');
 assert.equal(await x.window.OCSecure.identificarPin('731'),'dueno');
 assert.equal(await x.window.OCSecure.fijarOwnerPin('842'),true);
 x.meta.ownerPinConfirmado='842';
 x.meta.pinsRol={...x.meta.pinsRol,owner:'642'}; // legacy shell replays old team metadata
 assert.equal(await x.window.OCSecure.identificarPin('642'),null);
 assert.equal(await x.window.OCSecure.identificarPin('842'),'dueno');
 assert.equal(x.storage.getItem('photos_synthetic'),'opaque-photo-bytes');
});
