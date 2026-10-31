'use strict';
// Synthetic owner credentials only. No user data, real licenses or external relay.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');
function setup(){
  const lic='F123-SYNTHETIC-ROTATION',storage=new Map();
  const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  localStorage.setItem('f123_owned',JSON.stringify({licenseCode:lic,instanceId:'synthetic-only'}));
  localStorage.setItem('photo-synthetic','unchanged');
  const data={ownerPinConfirmado:'642',pinsRol:{owner:'642',emp:'583',acct:'914'},ownerPinCambioRev:0};
  const Y={roomId:'synthetic-room',estado:'activo',canal:{recuperando:false,ws:{readyState:1}},
    meta:{get:k=>data[k],set:(k,v)=>{data[k]=v}},
    confirmarPinOwnerDurable:async(pin,rev)=>data.ownerPinConfirmado===pin&&data.ownerPinCambioRev===rev,
    publicarCambioPinOwner(pin,priorRev){
      if(this.canal.recuperando||!this.canal.ws||this.canal.ws.readyState!==1)return false;
      if(priorRev!==undefined&&priorRev!==data.ownerPinCambioRev)return false;
      if(data.ownerPinConfirmado===pin)return true;
      data.pinsRol={...data.pinsRol,owner:pin};data.ownerPinConfirmado=pin;
      data.ownerPinCambioRev++;return true;
    }};
  const window={OCYjs:Y,OCTienda:{licenciaActual:()=>lic},OCAuth:{rolActual:()=> 'dueno'}};
  let pauseOne=false,release=null,started=null;
  const crypto={getRandomValues:x=>webcrypto.getRandomValues(x),subtle:{
    importKey:(...a)=>webcrypto.subtle.importKey(...a),
    deriveBits:(...a)=>{if(pauseOne){pauseOne=false;started?.();return new Promise(resolve=>{release=()=>webcrypto.subtle.deriveBits(...a).then(resolve);});}return webcrypto.subtle.deriveBits(...a)},
    deriveKey:(...a)=>webcrypto.subtle.deriveKey(...a),
    digest:(...a)=>webcrypto.subtle.digest(...a),
    encrypt:(...a)=>webcrypto.subtle.encrypt(...a),
    decrypt:(...a)=>webcrypto.subtle.decrypt(...a)
  }};
  function reload(){vm.runInNewContext(source,{window,localStorage,crypto,
    self:{isSecureContext:true,crypto},location:{hostname:'localhost'},TextEncoder,TextDecoder,btoa,atob,console});
    return window.OCSecure;}
  return {Y,data,storage,window,reload,pauseDerivation(){let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);started=readyResolve;pauseOne=true;return {ready,release:()=>{if(!release)throw Error('paused derive not reached');release();}}}};
}
test('R1 authorized return A to B to A does not re-publish stale B or reject newly canonical A',async()=>{
  const x=setup(),S=x.reload();
  assert.equal(await S.guardarSecreto('642',['583'],'914',''),true);
  assert.equal(await S.fijarOwnerPinDesdeSesion('731'),true);
  assert.equal(x.Y.publicarCambioPinOwner('731'),true); // first publish succeeds outside retry sweep
  assert.equal(x.data.ownerPinCambioRev,1);
  await S.reconciliarCambioPinOwnerPendiente(); // should permanently close acknowledged intent
  const saved=JSON.parse(x.storage.get('f123_secure'));
  assert.equal(saved.ownerRotationPending,undefined,'confirmed intent cannot reactivate after restart');
  assert.equal(x.Y.publicarCambioPinOwner('642'),true); // second device, authorized later
  assert.equal(x.data.ownerPinCambioRev,2);
  const reloaded=x.reload();
  assert.equal(await reloaded.reconciliarCambioPinOwnerPendiente(),false);
  assert.equal(x.data.ownerPinConfirmado,'642','stale intent must never undo a later authorized return');
  assert.equal(await reloaded.identificarPin('642'),'dueno','new canonical Owner may reuse previously retired value');
  assert.equal(await reloaded.identificarPin('731'),null,'superseded owner PIN is no longer canonical');
  assert.equal(x.storage.get('photo-synthetic'),'unchanged');
});
test('R2 derivation suspended during A to B cannot publish after local B to C supersedes it',async()=>{
  const x=setup(),S=x.reload();
  assert.equal(await S.guardarSecreto('642',['583'],'914',''),true);
  assert.equal(await S.fijarOwnerPinDesdeSesion('731'),true);
  const hold=x.pauseDerivation(),stale=S.reconciliarCambioPinOwnerPendiente();
  await hold.ready;
  assert.equal(await S.fijarOwnerPinDesdeSesion('842'),true);
  hold.release();
  assert.equal(await stale,false,'old async resolver must detect superseded local intent');
  assert.equal(x.data.ownerPinConfirmado,'642');
  const pending=JSON.parse(x.storage.get('f123_secure')).ownerRotationPending;
  assert.ok(pending&&pending.toHash,'new intent preserved durably');
  const reloaded=x.reload();
  assert.equal(await reloaded.reconciliarCambioPinOwnerPendiente(),true);
  assert.equal(x.data.ownerPinConfirmado,'842');
  assert.equal(await reloaded.identificarPin('842'),'dueno');
  assert.equal(await reloaded.identificarPin('731'),null);
  assert.equal(await reloaded.identificarPin('583'),'empleado');
  assert.equal(await reloaded.identificarPin('914'),'contador');
});
