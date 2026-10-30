'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../docs/crypto-store.js'), 'utf8');
function setup() {
  const entries = new Map(), lic = 'F123-SYNTHETIC-RECOVERY';
  const localStorage = {
    getItem:k => entries.has(k) ? entries.get(k) : null,
    setItem:(k,v) => entries.set(k, String(v)),
    removeItem:k => entries.delete(k)
  };
  localStorage.setItem('f123_owned', JSON.stringify({licenseCode:lic,instanceId:'synthetic'}));
  localStorage.setItem('photo-fixture', 'unchanged');
  const data = {ownerPinConfirmado:'642', pinsRol:{owner:'642',emp:'583',acct:'914'}};
  const Y = {roomId:'synthetic-encrypted-room', estado:'activo',
    canal:{recuperando:true,ws:null},
    meta:{get:k=>data[k],set:(k,v)=>{data[k]=v}},
    publicarCambioPinOwner(pin) {
      if (this.canal.recuperando || !this.canal.ws || this.canal.ws.readyState!==1) return false;
      data.pinsRol = {...data.pinsRol,owner:pin};
      data.ownerPinConfirmado=pin;
      return true;
    }
  };
  const window = {OCTienda:{licenciaActual:()=>lic}, OCYjs:Y,
    OCAuth:{rolActual:()=> 'dueno'}};
  function reload() {
    delete window.OCSecure;
    vm.runInNewContext(source,{window,localStorage,crypto:webcrypto,
      self:{isSecureContext:true,crypto:webcrypto},location:{hostname:'localhost'},
      TextEncoder,TextDecoder,btoa,atob,console});
    return window.OCSecure;
  }
  return {reload,window,storage:localStorage,data,Y};
}
test('P1: local Owner rotation survives recovery and restart; retired PIN never authenticates', async () => {
  const x=setup(), S=x.reload();
  assert.equal(await S.guardarSecreto('642',['583'],'914','test@example.invalid'),true);
  assert.equal(await S.fijarOwnerPinDesdeSesion('731'),true);
  const saved=JSON.parse(x.storage.getItem('f123_secure'));
  assert.equal(saved.ownerRotationPending.fromHash===saved.ownerHash,false);
  assert.equal(saved.ownerRotationPending.toHash,saved.ownerHash);
  assert.equal(await S.identificarPin('642'),null);
  assert.equal(await S.identificarPin('731'),'dueno');
  x.Y.canal={recuperando:false,ws:{readyState:1}};
  const restart=x.reload();
  assert.equal(await restart.identificarPin('642'),null);
  assert.equal(await restart.identificarPin('731'),'dueno');
  assert.equal(await restart.identificarPin('583'),'empleado');
  assert.equal(await restart.identificarPin('914'),'contador');
  assert.equal(await restart.reconciliarCambioPinOwnerPendiente(),true);
  assert.equal(x.data.ownerPinConfirmado,'731');
  assert.equal(await restart.identificarPin('642'),null);
  assert.equal(await restart.identificarPin('731'),'dueno');
  assert.equal(await restart.reconciliarCambioPinOwnerPendiente(),false);
  assert.equal(x.storage.getItem('photo-fixture'),'unchanged');
});
test('P1: concurrent different Owner change is not overwritten by a stale pending intent', async () => {
  const x=setup(), S=x.reload();
  await S.guardarSecreto('642',['583'],'914','');
  assert.equal(await S.fijarOwnerPinDesdeSesion('731'),true);
  x.Y.canal={recuperando:false,ws:{readyState:1}};
  x.data.ownerPinConfirmado='842';
  x.data.pinsRol={...x.data.pinsRol,owner:'842'};
  const restart=x.reload();
  assert.equal(await restart.reconciliarCambioPinOwnerPendiente(),false);
  assert.equal(x.data.ownerPinConfirmado,'842');
  assert.equal(await restart.identificarPin('731'),null);
  assert.equal(await restart.identificarPin('842'),'dueno');
  assert.equal(await restart.identificarPin('642'),null);
});
test('P1: no live recovered channel or owner session means no automatic publication', async () => {
  const x=setup(), S=x.reload();
  await S.guardarSecreto('642',['583'],'914','');
  assert.equal(await S.fijarOwnerPinDesdeSesion('731'),true);
  assert.equal(await S.reconciliarCambioPinOwnerPendiente(),false);
  x.Y.canal={recuperando:false,ws:null};
  assert.equal(await S.reconciliarCambioPinOwnerPendiente(),false);
  x.Y.canal.ws={readyState:1};
  x.window.OCAuth.rolActual=()=> 'empleado';
  assert.equal(await S.reconciliarCambioPinOwnerPendiente(),false);
  assert.equal(x.data.ownerPinConfirmado,'642');
});
test('P1: never invent a pending rotation from setup-only owner PIN change', async () => {
  const x=setup(), S=x.reload();
  await S.guardarSecreto('642',['583'],'914','');
  assert.equal(await S.fijarOwnerPin('731'),true);
  assert.equal(JSON.parse(x.storage.getItem('f123_secure')).ownerRotationPending,undefined);
  x.Y.canal={recuperando:false,ws:{readyState:1}};
  assert.equal(await S.reconciliarCambioPinOwnerPendiente(),false);
  assert.equal(await S.identificarPin('642'),null);
  assert.equal(await S.identificarPin('731'),null,'without signed explicit intent, shared room stays canonical');
});
