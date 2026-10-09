const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function peer(){
 const w=browser();delete w.JSON;
 Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
  WebSocket:class{constructor(){throw Error('No production relay in this fixture')}},
  BroadcastChannel:class{constructor(){throw Error('No cross-test channel')}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
 w.IndexeddbPersistence=class{once(){}};
 w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-IDLE-BUDGET'}));
 w.OCAuth={rolActual:()=> 'dueno'};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
 for(let n=0;n<100&&w.OCYjs.estado!=='activo';n++)await delay(10);
 assert.equal(w.OCYjs.estado,'activo');return w;
}
test('unchanged owner metadata produces zero real Yjs updates on 100 idle reseeds; rename still converges',async()=>{
 const a=await peer(),b=await peer();
 let cat={nombreNegocio:'Synthetic gallery',nombreNegocioRev:7,nombreNegocioTs:1700000000000};
 a.OCSync.catalogoPropio=()=>cat;
 a.OCYjs._store.sembrar();
 let updates=0;a.OCYjs.doc.on('update',(_u,origin)=>{if(origin==='seed')updates++});
 for(let n=0;n<100;n++)a.OCYjs._store.sembrar();
 assert.equal(updates,0,'idle metadata must not wake the relay or persist another encrypted operation');
 cat={...cat,nombreNegocio:'Synthetic gallery renamed',nombreNegocioRev:8,nombreNegocioTs:1700000001000};
 a.OCYjs._store.sembrar();assert.equal(updates,1,'a real rename remains an immediate update');
 b.Y.applyUpdate(b.OCYjs.doc,a.Y.encodeStateAsUpdate(a.OCYjs.doc),'red');
 assert.equal(b.OCYjs.meta.get('nombreNegocio'),'Synthetic gallery renamed');
 assert.equal(b.OCYjs.meta.get('nombreRev'),8);
 assert.equal(b.OCYjs.meta.get('nombreTs'),1700000001000);
 b.OCSync.catalogoPropio=()=>({nombreNegocio:'Stale name',nombreNegocioRev:7,nombreNegocioTs:1700000000000});
 b.OCYjs._store.sembrar();assert.equal(b.OCYjs.meta.get('nombreNegocio'),'Synthetic gallery renamed');
 for(let n=0;n<100;n++)a.OCYjs._store.sembrar();assert.equal(updates,1);
});
