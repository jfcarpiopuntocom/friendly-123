'use strict';
// R3 synthetic interruption: production crypto-store with an explicit durable journal receipt.
// Never use real customer credentials, licenses, browser storage or relay.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');
function setup(){
  const code='F123-SYNTHETIC-R3',disk=new Map();
  const localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,String(v)),removeItem:k=>disk.delete(k)};
  localStorage.setItem('f123_owned',JSON.stringify({licenseCode:code,instanceId:'synthetic'}));
  localStorage.setItem('synthetic-photo','photo-preserved');
  const room={ownerPinConfirmado:'642',pinsRol:{owner:'642',emp:'583',acct:'914'},ownerPinCambioRev:0};
  let committed=false,calls=0;
  const Y={roomId:'synthetic-r3-room',estado:'activo',canal:{recuperando:false,ws:{readyState:1}},
    meta:{get:k=>room[k],set:(k,v)=>{room[k]=v}},
    confirmarPinOwnerDurable:async(pin,rev)=>{
      calls++;
      return committed && room.ownerPinConfirmado===pin && room.ownerPinCambioRev===rev;
    },
    publicarCambioPinOwner(pin,prev){
      if(prev!==room.ownerPinCambioRev)return false;
      if(room.ownerPinConfirmado===pin)return true;
      room.pinsRol={...room.pinsRol,owner:pin};
      room.ownerPinConfirmado=pin;room.ownerPinCambioRev++;
      return true;
    }};
  const window={OCYjs:Y,OCTienda:{licenciaActual:()=>code},OCAuth:{rolActual:()=> 'dueno'}};
  const context={window,localStorage,crypto:webcrypto,self:{isSecureContext:true,crypto:webcrypto},
    location:{hostname:'localhost'},TextEncoder,TextDecoder,btoa,atob,console};
  function reload(){vm.runInNewContext(source,context);return window.OCSecure}
  return {window,Y,room,disk,reload,commit:()=>{committed=true},calls:()=>calls,
    secret:()=>JSON.parse(localStorage.getItem('f123_secure'))};
}
test('R3 RED: local Y.Doc success must retain retry until exact PIN and revision are durable',async()=>{
  const x=setup(),S=x.reload();
  assert.equal(await S.guardarSecreto('642',['583'],'914',''),true);
  assert.equal(await S.fijarOwnerPinDesdeSesion('731'),true);
  const r=await S.reconciliarCambioPinOwnerPendiente();
  assert.equal(r,false,'RAM publication must not be treated as durability');
  assert.equal(x.room.ownerPinConfirmado,'731');
  assert.equal(x.room.ownerPinCambioRev,1);
  assert.ok(x.secret().ownerRotationPending,'crash before journal commit must retain recovery intent');
  assert.equal(x.disk.get('synthetic-photo'),'photo-preserved');
});
test('R3 GREEN: committed exact PIN and revision retire only matching pending intent',async()=>{
  const x=setup(),S=x.reload();
  await S.guardarSecreto('642',['583'],'914','');
  await S.fijarOwnerPinDesdeSesion('731');
  assert.equal(await S.reconciliarCambioPinOwnerPendiente(),false);
  assert.ok(x.secret().ownerRotationPending);
  x.commit();
  const restart=x.reload();
  assert.equal(await restart.reconciliarCambioPinOwnerPendiente(),false,'already published, now confirmed');
  assert.equal(x.secret().ownerRotationPending,undefined);
  assert.equal(x.secret().ownerPinRevisionFloor,1);
  assert.equal(await restart.identificarPin('731'),'dueno');
  assert.equal(x.disk.get('synthetic-photo'),'photo-preserved');
});
