'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// Load the actual pilot implementation (strip imports only; inject observable
// provider, never a retyped implementation). Synthetic license and PIN only.
const source=fs.readFileSync(path.join(__dirname,'../src/yparty-piloto.js'),'utf8').replace(/^import .*;\s*$/gm,'');
function harness({shadowRecovered=false}={}){
  const calls={providers:[],fallBack:0,applied:0},listeners={};
  const doc={
    store:{pendingStructs:null,pendingDs:null},isDestroyed:false,
    on:(name,fn)=>{(listeners[name]??=[]).push(fn)},
    once:(name,fn)=>{(listeners[name]??=[]).push(fn)},
    off:()=>{},
  };
  const providerEvents={};
  class Provider {
    constructor(host,room,receivedDoc){
      calls.providers.push({room,receivedDoc});
      this.synced=false;this.ws={readyState:1};this.awareness={destroy(){}};
    }
    on(name,fn){(providerEvents[name]??=[]).push(fn)}
    off(){}
    connect(){return Promise.resolve(true)}
    disconnect(){}
    destroy(){}
  }
  const localStorage={getItem(key){
    if(key==='f123_owned') return JSON.stringify({licenseCode:'F123-SYNTHETIC',instanceId:'fake1234'});
    return null;
  }};
  const window={OCSecure:{leerPinQueAbre:()=>({owner:'123'})},OCAuth:{rolActual:()=> 'dueno'}};
  const document={hidden:false,addEventListener(){},removeEventListener(){}};
  const ctx={window,document,localStorage,AuthorizedYProvider:Provider,
    createOwnerTicketParams:()=>()=>({cap:'synthetic-cap'}),
    createPhotoShaBridge:()=>({}),
    crypto:require('node:crypto').webcrypto,
    clearTimeout:()=>{},setTimeout:()=>0};
  vm.runInNewContext(source,ctx,{filename:'real-yparty-pilot.js'});
  const p=window.F123YPartyPilot('a'.repeat(32),'F123-SYNTHETIC');
  const canal=p.canal(doc,'cat',{synced:true,once(){}},()=>{calls.applied++},
    ()=>{calls.fallBack++},()=>shadowRecovered);
  return {doc,canal,calls,events:providerEvents,update(){(listeners.update||[]).forEach(fn=>fn())},
    setShadowRecovered(value){shadowRecovered=value}};
}

test('RED ULTRA #1: real Owner Y.Doc with pins and financial metadata must never be given to YParty provider unencrypted',()=>{
  const h=harness({shadowRecovered:false});
  h.doc.getMap=()=>({pinsRol:'synthetic-hash',hechos_financieros:'synthetic-financial-event'});
  h.canal.conectar();
  assert.equal(h.calls.providers.length,0,'NO raw catalog to YParty under any rollout; no E2E sealed adapter exists yet');
  assert.equal(h.calls.fallBack,1,'unencrypted pilot must fail closed to existing E2E legacy relay');
});

test('RED ULTRA #2: provider synced and local IDB ready never unlock before legacy shadow relay recovery',()=>{
  const h=harness({shadowRecovered:false});
  h.canal.proveedor={synced:true};
  h.update();
  assert.equal(h.canal.accesoListo(),false,'old relay not finished; PIN and store authority MUST remain closed');
  assert.equal(h.canal.recuperando,true);
  assert.equal(h.calls.applied,0,'must not apply empty/stale YParty to store');
  h.setShadowRecovered(true);
  h.update();
  assert.equal(h.calls.applied,1,'once legacy confirms, may apply certified state');
  assert.equal(h.canal.recuperando,false);
  assert.equal(h.canal.accesoListo(),true);
});

test('Yjs causal debts keep access closed even with legacy and YParty ready',()=>{
  const h=harness({shadowRecovered:true});
  h.canal.proveedor={synced:true};
  h.doc.store.pendingStructs={client:1};
  h.update();
  assert.equal(h.canal.accesoListo(),false);
  assert.equal(h.calls.applied,0);
  h.doc.store.pendingStructs=null;
  h.doc.store.pendingDs={client:2};
  h.update();
  assert.equal(h.canal.accesoListo(),false);
  h.doc.store.pendingDs=null;
  h.update();
  assert.equal(h.calls.applied,1);
});
