'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {browser}=require('./helpers/browser.cjs');
function disk(owned,active='') {
  const entries=new Map(Object.entries({f123_owned:JSON.stringify({licenseCode:owned,instanceId:'synthetic-actor'}),
    f123_tienda_activa:active,f123_notebook_unificado_v2:'1'}));
  return {get length(){return entries.size},key:i=>[...entries.keys()][i],
    getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
}
async function peer(storage,identity) {
  const w=browser(storage);delete w.JSON;
  Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
    F123Relay:{connect(){throw Error('External network prohibited');}},
    BroadcastChannel:class{constructor(){throw Error('External channel prohibited');}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
  w.IndexeddbPersistence=class{once(){}};
  if(identity) identity(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
  for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)await new Promise(r=>setTimeout(r,5));
  return w;
}
const A='SYNTHETIC-IDENTITY-A',B='SYNTHETIC-IDENTITY-B';
test('joined active notebook uses the same room and key as its owner, including reopening',async()=>{
  const joinedDisk=disk(A,'::'+B),ownerDisk=disk(B);
  const owner=await peer(ownerDisk),joined=await peer(joinedDisk);
  assert.equal(joined.OCTienda.licenciaActual(),B);
  assert.equal(joined.OCYjs.estado,'activo');
  assert.equal(joined.OCYjs.roomId,owner.OCYjs.roomId,'room follows active notebook, not stale owned sidecar');
  const reopened=await peer(joinedDisk);
  assert.equal(reopened.OCYjs.roomId,owner.OCYjs.roomId);
  // Exercise the actual derived CryptoKeys, not only equal room labels.
  const iv=new Uint8Array(12),bytes=new TextEncoder().encode('synthetic notebook identity');
  const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},owner.OCYjs.clave,bytes);
  const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv},reopened.OCYjs.clave,cipher);
  assert.equal(new TextDecoder().decode(plain),'synthetic notebook identity');
  const other=await peer(disk(A));
  assert.notEqual(other.OCYjs.roomId,owner.OCYjs.roomId,'distinct businesses remain isolated');
  await assert.rejects(webcrypto.subtle.decrypt({name:'AES-GCM',iv},other.OCYjs.clave,cipher));
});
test('same license on distinct actors has one room, independent of obsolete room sidecar',async()=>{
  const one=disk(B),two=disk('  '+B.toLowerCase()+'  ');
  two.setItem('f123_owned',JSON.stringify({licenseCode:'  '+B.toLowerCase()+'  ',instanceId:'synthetic-other-actor'}));
  two.setItem('f123_sync_room',JSON.stringify({codigo:A}));
  const [a,b]=await Promise.all([peer(one),peer(two)]);
  assert.equal(a.OCYjs.roomId,b.OCYjs.roomId);
});
test('ambiguous active identity fails closed rather than connecting the own business',async()=>{
  const w=await peer(disk(A,'::'+B),w=>{w.OCTienda.licenciaActual=()=>{throw Error('Synthetic identity unavailable');};});
  assert.notEqual(w.OCYjs.estado,'activo');
  assert.equal(w.OCYjs.roomId,null);
});
test('early own-store boot without OCTienda keeps owned fallback; joined marker never does',async()=>{
  const own=await peer(disk(A),w=>{w.OCTienda=undefined;});
  assert.equal(own.OCYjs.estado,'activo');
  const joined=await peer(disk(A,'::'+B),w=>{w.OCTienda=undefined;});
  assert.notEqual(joined.OCYjs.estado,'activo');
  assert.equal(joined.OCYjs.roomId,null);
});
