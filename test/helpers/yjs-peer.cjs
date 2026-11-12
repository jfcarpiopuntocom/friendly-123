'use strict';
// Shared two-peer harness (copied from incident-v608 test). Isolated real backend + vendored Yjs; no external relay or customer data.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {browser}=require('./browser.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<20;i++)await tick();}
async function peer(options={}){
  const w=browser(options.storage),timers=[];delete w.JSON;
  w.setTimeout=(fn,ms)=>{const timer={fn,ms,on:true};timers.push(timer);return timer;};
  w.clearTimeout=timer=>{if(timer)timer.on=false;};
  w.setInterval=(fn,ms)=>{const timer={fn,ms,on:true,interval:true};timers.push(timer);return timer;};
  const flush=async()=>{
    for(let i=0;i<5;i++){
      for(const timer of timers.filter(t=>t.on&&!t.interval&&t.ms===0)){timer.on=false;timer.fn();}
      await settle();
    }
  };
  Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
    F123Relay:{connect(){throw Error('External relay forbidden');}},
    BroadcastChannel:class{constructor(){throw Error('External channel forbidden');}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
  w.IndexeddbPersistence=class{once(){}};
  w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-V608-PUBLICATION'}));
  w.OCAuth={rolActual:()=> 'dueno'};
  const syncFile=options.legacy === 'v606' ? process.env.F123_V606_SYNC_FILE :
    options.legacy ? process.env.F123_V607_SYNC_FILE : path.join(__dirname,'../../docs/sync-yjs.js');
  assert.ok(syncFile&&fs.existsSync(syncFile),'v607 historical sync script must be fetched at exact pinned SHA');
  vm.runInContext(fs.readFileSync(syncFile,'utf8'),w);
  for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.OCYjs.estado,'activo');
  return {w,timers,flush};
}

async function exchange(a,b,rounds=1){
  for(let i=0;i<rounds;i++){
    const aState=a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc);
    const bState=b.w.Y.encodeStateAsUpdate(b.w.OCYjs.doc);
    b.w.Y.applyUpdate(b.w.OCYjs.doc,aState,'red');
    a.w.Y.applyUpdate(a.w.OCYjs.doc,bState,'red');
    a.w.OCYjs._store.aplicar();b.w.OCYjs._store.aplicar();
    await a.flush();await b.flush();
  }
}
module.exports={peer,exchange,settle};
