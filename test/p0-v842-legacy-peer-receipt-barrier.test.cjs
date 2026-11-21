'use strict';
// C118: source-coupled runtime bridge test. The full OCSync API race tests live
// in p0-v842-concurrent-receipts-red.test.cjs on the parent #937 branch.
// This test additionally verifies the legacy receiver's real ACK/broadcast
// boundary, with no network, customer data or mutable browser storage.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const from=src.indexOf('        const requirePnCommit = ');
const until=src.indexOf('      } catch (_) { /* mensaje ilegible',from);
assert.ok(from>=0 && until>from,'real inbound encrypted-ops receiver exists');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const apply=new AsyncFunction('op','window','ev','ws','miGeneracion','_conexionGeneracion',
  '_socketDeEstaConexion','codigoCuadernoActivo','codigoNorm','registrarEnLog',
  'leerLog','cifrar','claveActual','CustomEvent',src.slice(from,until));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(pilot=true, options={}){
  const pending=defer(),events=[],receipts=[];
  const op={opId:'C118-remote-PN',tipo:'ajuste',payload:{
    productoId:'p',stockPNHecho:{base:10,epoch:'e',actor:'phone',add:0,sub:1}
  }};
  let active='ROOM',logged=false,confirmCalls=0;
  const ws={confirmPeerReceipt:async (...args)=>{receipts.push(args);return true;}};
  const window={
    OCSync:{aplicarOpRemota:()=>pending.promise,
      confirmarCatalogoDurable:async()=>{confirmCalls++;return true;}},
    OCYjs:{esLicenciaPruebaJfc:pilot},
    dispatchEvent:e=>events.push(e.type)
  };
  const ev={peerReceipt:{id:op.opId,kind:'op',hash:'hash-fixture'}};
  const invoke=()=>apply(op,window,ev,ws,1,1,ws,()=>active,'ROOM',
    ()=>{if (!options.quotaFull) logged=true;},()=>logged?[op]:[],
    options.cipher || (async (_key,payload)=>payload),'fixture-key',
    class CustomEvent {constructor(type,options){this.type=type;this.detail=options?.detail;}});
  return {pending,events,receipts,invoke,changeRoom:()=>active='OTHER',
    get confirmCalls(){return confirmCalls;},get logged(){return logged;}};
}
test('C118: pilot remote PN neither broadcasts nor peer-ACKs while its CAS is pending',async()=>{
  const x=fixture();
  const done=x.invoke();
  await Promise.resolve();
  assert.deepEqual(x.events,[]);
  assert.equal(x.confirmCalls,0);
  assert.equal(x.receipts.length,0);
  assert.equal(x.logged,false,'a pending PN must not advance the legacy catch-up vector');
  x.pending.resolve({ok:true});
  await done;
  assert.deepEqual(x.events,['oc-sync-op-remota']);
  assert.equal(x.confirmCalls,0,'pilot PN must not repeat strict CAS after its verified durable write');
  assert.equal(x.receipts.length,1);
  assert.equal(x.logged,true,'the committed PN now advances the vector');
});
test('C118: rejected pilot PN CAS never announces or peer-ACKs',async()=>{
  const x=fixture();const done=x.invoke();
  x.pending.resolve({ok:false,error:'stock-not-durable'});
  await done;
  assert.deepEqual(x.events,[]);
  assert.equal(x.confirmCalls,0);
  assert.equal(x.receipts.length,0);
  assert.equal(x.logged,false,'a refused PN stays eligible for peer catch-up');
});
test('C118: shop switched during awaited CAS never dispatches into new shop',async()=>{
  const x=fixture();const done=x.invoke();
  x.changeRoom();x.pending.resolve({ok:true});
  await done;
  assert.deepEqual(x.events,[]);
  assert.equal(x.confirmCalls,0);
  assert.equal(x.receipts.length,0);
  assert.equal(x.logged,false,'a stale PN cannot advance the new notebook vector');
});

test('C118: full localStorage cannot suppress ACK of an already durable PN',async()=>{
  const x=fixture(true,{quotaFull:true});
  const done=x.invoke();
  x.pending.resolve({ok:true});
  await done;
  assert.equal(x.logged,false,'best effort vector may not fit into localStorage');
  assert.deepEqual(x.events,['oc-sync-op-remota']);
  assert.equal(x.receipts.length,1,'durable CAS is sufficient for peer ACK');
  assert.equal(x.confirmCalls,0,'never rewrite the full business catalog for an ACK');
});
test('C118: delayed receipt encryption must not send into a new notebook',async()=>{
  const cryptoPending=defer();
  const x=fixture(true,{cipher:()=>cryptoPending.promise});
  const done=x.invoke();
  x.pending.resolve({ok:true});
  for(let n=0;n<12&&!x.logged;n++) await Promise.resolve();
  assert.equal(x.logged,true,'durable PN has completed');
  x.changeRoom();
  cryptoPending.resolve({tipo:'__peer_receipt__'});
  await done;
  assert.equal(x.receipts.length,0,'no old receipt after active notebook switch');
  assert.equal(x.confirmCalls,0);
});
test('C118: nonpilot legacy durable confirmation behavior is preserved',async()=>{
  const x=fixture(false);
  const done=x.invoke();
  await done; // nonpilot does not await the pilot-only PN branch
  assert.deepEqual(x.events,['oc-sync-op-remota']);
  assert.equal(x.confirmCalls,1,'unchanged historical nonpilot verification');
  assert.equal(x.receipts.length,1);
});

test('C118: durable duplicate PN still ACKs peer but never repeats the UI event',async()=>{
  const x=fixture();
  const done=x.invoke();
  x.pending.resolve({ok:true,repetida:true});
  await done;
  assert.deepEqual(x.events,[],'duplicate PN is already represented in the visible stock');
  assert.equal(x.receipts.length,1,'peer can retire a duplicate without reapplying stock');
  assert.equal(x.confirmCalls,0,'no second strict save even on duplicate receipt');
});
