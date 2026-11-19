// Exact test/harness extraction from friendly-123 DRAFT v698 @496a82b8; independent-writer assertion unchanged. NO NETWORK.
// P0 persisted Sync3 causal recovery regression: actual current repo source, no external network.
'use strict';
// End-to-end seam: actual current sync-yjs + actual Firebase REST
// adapter + production Yjs bundle, with a STRICT IN-MEMORY REST fixture.
// No network, no production Firebase URL, no PIN, no real business data.
const test=require('node:test').test,assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const sourceRoot=process.env.F123_SOURCE_ROOT || path.resolve(__dirname,'..');
const SHA=process.env.F123_EXPECTED_SHA || null;
assert.ok(sourceRoot,'Test source checkout is mandatory');
if (SHA) assert.equal(execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),SHA,
 'optional exact-SHA source pin must match');
const yjs=fs.readFileSync(path.join(sourceRoot,'docs/sync-yjs.js'),'utf8');
const firebase=fs.readFileSync(path.join(sourceRoot,'docs/firebase-relay.js'),'utf8');
const vendor=fs.readFileSync(path.join(sourceRoot,'docs/vendor/yjs-bundle.min.js'),'utf8');
const x=yjs.indexOf('  function _frame('),y=yjs.indexOf('  // Carga perezosa',x);
assert.ok(x>=0&&y>x,'must execute actual production Yjs transport');
const transport=yjs.slice(x,y);
const room='a'.repeat(40),server='https://synthetic.invalid';
async function until(condition,label){
 for(let i=0;i<500;i++){if(condition())return;await new Promise(r=>setTimeout(r,2));}
 assert.ok(condition(),label);
}
function rest(){
 const ckpts=new Map(),ops=new Map(),calls=[]; let clock=1000;
 const answer=(v,status=200)=>new Response(JSON.stringify(v),{status});
 async function fetch(url,opts={}){
  const u=new URL(url);assert.equal(u.origin,server,'NO REAL NETWORK');
  const m=/^\/f123\/([a-f0-9]{40}-y)\/(k|o)(?:\/([^/]+))?\.json$/.exec(u.pathname);
  assert.ok(m,'invalid synthetic Firebase path');
  const [_,locator,type,key]=m;
  assert.equal(locator,room+'-y');
  const written=opts.method==='POST'&&u.searchParams.get('x-http-method-override')==='PUT';
  calls.push({type,key:key||null,method:written?'PUT':'GET'});
  const map=type==='k'?ckpts:ops;
  if(written){
   assert.ok(key,'writes require explicit synthetic key');
   assert.equal(map.has(key),false,'no overwriting an existing checkpoint revision or op');
   const value=JSON.parse(opts.body);
   if(type==='o'&&typeof value.s==='object')value.s=++clock; // monotonic synthetic server timestamp
   map.set(key,value);
   return answer(value);
  }
  assert.equal(opts.method,'GET');
  if(key)return answer(map.get(key)||null);
  if(type==='k'&&u.searchParams.get('shallow')==='true')
   return answer(Object.fromEntries([...map.keys()].map(k=>[k,true])));
  let records=[...map.entries()];
  if(type==='o'){
    records.sort((a,b)=>a[1].s-b[1].s||a[0].localeCompare(b[0]));
    const queryNumber=(name)=>{
      const raw=u.searchParams.get(name);
      if(raw===null)return null;
      const parsed=JSON.parse(raw);
      assert.ok(Number.isSafeInteger(parsed),'only integer synthetic timestamp filters');
      return parsed;
    };
    const start=queryNumber('startAt'),end=queryNumber('endAt'),equal=queryNumber('equalTo');
    if(start!==null)records=records.filter(([,r])=>r.s>=start);
    if(end!==null)records=records.filter(([,r])=>r.s<=end);
    if(equal!==null)records=records.filter(([,r])=>r.s===equal);
    const limitFirst=Number(u.searchParams.get('limitToFirst')||0);
    const limitLast=Number(u.searchParams.get('limitToLast')||0);
    if(limitFirst>0)records=records.slice(0,limitFirst);
    if(limitLast>0)records=records.slice(-limitLast);
  }
  return answer(Object.fromEntries(records));
 }
 return {ckpts,ops,calls,fetch};
}
function device(api,seed){
 const timers=[],storage=new Map();
 const db={objectStoreNames:{contains:key=>key==='updates'},
  transaction(){const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx;}};
 const persist={whenSynced:Promise.resolve(),db,
   get:async key=>structuredClone(storage.get(key)),
   set:async(key,value)=>{storage.set(key,structuredClone(value));}};
 const ctx={ API:{clave:'synthetic-only',roomId:room,_store:{aplicar(){}},
      rollout:{outboxV2:false,gzipWrite:false}},
    RELAY_URL:'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/',
    crypto:require('node:crypto').webcrypto,
    window:{dispatchEvent(){}},navigator:{},
    document:{hidden:false,visibilityState:'visible',addEventListener(){},
      getElementById(){return null},body:{appendChild(){}}},
    CustomEvent:class{constructor(type){this.type=type}},
    WebSocket:class{constructor(){throw Error('network socket forbidden')}},
    Response,URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Date,
    JSON,Math,Promise,DOMException,console,
    setTimeout(fn,ms){timers.push({fn,ms,cancelled:false});return timers.length;},
    clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true;},
    setInterval(){return 1;},clearInterval(){},
    btoa:s=>Buffer.from(s,'binary').toString('base64'),
    atob:s=>Buffer.from(s,'base64').toString('binary'),
    fetch(){throw Error('global fetch forbidden');},
    log(){},
    cifrarBin:async(_,buffer)=>buffer.slice().buffer,
    descifrarBin:async(_,buffer)=>new Uint8Array(buffer)
 };
 vm.createContext(ctx);
 vm.runInContext(firebase,ctx);
 ctx.window.F123Relay=ctx.window.F123FirebaseRelay.create({
   db:server,fetch:api.fetch,EventSource:null});
 // Production relay-selector.js exposes this exact source-specific relayLayer
 // on the returned hub; direct Firebase adapters otherwise lack that property.
 const connectFirebase=ctx.window.F123Relay.connect;
 ctx.window.F123Relay.connect=function(url) {
   const socket=connectFirebase(url);
   socket.relayLayer='f123_relay_cupo_fb_v1';
   return socket;
 };
 vm.runInContext(transport+'\nthis.make=crearCanal;',ctx);
 vm.runInContext(vendor,ctx);
 const Y=ctx.Y,doc=new Y.Doc();
 if(seed)seed(doc);
 const channel=ctx.make(Y,doc,'-y','catalogo',true,null,persist);
 // Mirror the actual production app's Y.Doc update bridge; remote ('red') must never echo.
 doc.on('update',(update,origin)=>{if(origin!=='red'&&origin!==persist)channel.enviarUpdate(update);});
 channel.conectar();
 return {Y,doc,channel,timers,storage};
}
test('v694 Yjs → Firebase REST adapter → stored ckpt ACK → B full cold join without P2P', {timeout:30000},async()=>{
 const backend=rest();
 const A=device(backend,doc=>{
  doc.getMap('products').set('synthetic-15',15);
  doc.getMap('products').set('synthetic-3',3);
 });
 await until(()=>A.channel.recuperando===false,'A completes remote empty pull and final HEAD');
 assert.equal(A.doc.store.pendingStructs,null);
 assert.equal(A.doc.store.pendingDs,null);
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'A checkpoint timer');
 const selected=A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1);
 selected.fn();
 await until(()=>backend.ckpts.has('1'),'actual Firebase adapter persisted checkpoint under revision 1');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,
    'A confirmed CKPT through real adapter persistence ACK');
 assert.equal(A.storage.get('f123_relay_outbox_v1-y').pending.filter(x=>x.k==='ckpt').length,0,
   'confirmed checkpoint retired from outbox');
 A.channel.pausar(); // close A before B connects
 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'B cold-join ends after final verified HEAD');
 assert.equal(B.doc.getMap('products').get('synthetic-15'),15);
 assert.equal(B.doc.getMap('products').get('synthetic-3'),3);
 assert.equal(B.doc.store.pendingStructs,null);
 assert.equal(B.doc.store.pendingDs,null);
 assert.equal(B.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,1);
 assert.equal(backend.ckpts.size,1,'one persisted checkpoint; no duplicate/rewrite');
 assert.ok(backend.calls.some(c=>c.method==='PUT'&&c.type==='k'));
 assert.ok(backend.calls.some(c=>c.method==='GET'&&c.type==='k'&&c.key==='1'));
 B.channel.pausar();
});



test('P0 intentionally missing Yjs causal parent: final HEAD must remain RED until parent OP is restored', {timeout:45000},async()=>{
 const backend=rest();
 const A=device(backend,doc=>doc.getMap('identity').set('initial-count',33));
 await until(()=>A.channel.recuperando===false,'A hydrates initial empty room');
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'initial CKPT timer');
 A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('1'),'initial CKPT persisted');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'CKPT ACK persisted');
 A.channel.pausar();

 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'writer B hydrates remote checkpoint');
 const doc=B.doc.getMap('causalChain');
 const firstCount=backend.ops.size;
 doc.set('parent','PARENT-ONLY-SYNTHETIC');
 await until(()=>backend.ops.size===firstCount+1,'parent Yjs op persisted');
 const parentId=[...backend.ops.keys()].at(-1);
 const parent=structuredClone(backend.ops.get(parentId));
 doc.set('child','CHILD-ONLY-SYNTHETIC');
 await until(()=>backend.ops.size===firstCount+2,'child Yjs op persisted');
 // Simulate the actual root cause hypothesis: the parent was lost on the durable relay,
 // but a later child still exists and HEAD correctly advertises it.
 backend.ops.delete(parentId);
 B.channel.pausar();

 const readBefore=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 const C=device(backend);
 await until(()=>!!(C.doc.store.pendingStructs&&C.doc.store.pendingStructs.missing?.size),
   'child without parent must produce an unresolved Yjs causal dependency');
 // Let the real Firebase-adapter HEAD/PULL path reach its end.
 await until(()=>backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length>=readBefore+2,
   'new reader attempts initial HEAD and historical pull; final HEAD is NOT promised while Yjs has debt');
 assert.equal(C.channel.recuperando,true,'reaching HEAD must NOT make incomplete Yjs state safe');
 assert.ok(C.doc.store.pendingStructs.missing.size>0,'parent dependency remains missing');
 assert.equal(C.doc.getMap('causalChain').get('child'),undefined,
   'Yjs must never expose a child whose causal parent is absent');
 const timer=C.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1);
 assert.ok(timer,'checkpoint timer is present but does not certify incomplete history');
 timer.fn();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(backend.ckpts.size,1,
   'never persist a new checkpoint containing unresolved Yjs causal parents');
 console.log('SYNTHETIC_MISSING_PARENT_REMAINS_RED',JSON.stringify({
  serverLastHeadReached:true,pendingParents:C.doc.store.pendingStructs.missing.size,
  checkpointAfterBrokenHistory:false
 }));
 C.channel.pausar();

 // Restore EXACT original synthetic durable parent with same server timestamp.
 backend.ops.set(parentId,parent);
 const D=device(backend);
 await until(()=>D.channel.recuperando===false,'fresh D completely hydrates when missing parent is restored');
 assert.equal(D.doc.getMap('causalChain').get('parent'),'PARENT-ONLY-SYNTHETIC');
 assert.equal(D.doc.getMap('causalChain').get('child'),'CHILD-ONLY-SYNTHETIC');
 assert.equal(D.doc.store.pendingStructs,null);
 assert.equal(D.doc.store.pendingDs,null);
 assert.equal(backend.ckpts.size,1,'do not need to falsify checkpoint or history');
 D.channel.pausar();
 console.log('SYNTHETIC_PARENT_RESTORED_GREEN',JSON.stringify({pendingParents:0,coldJoin:true}));
});



test('P0 RED: rescue of early causal parent cannot skip 95 independent pre-CKPT writes from another writer', {timeout:65000},async()=>{
  const backend=rest();
  const A=device(backend,d=>d.getMap('identity').set('baseline',33));
  await until(()=>A.channel.recuperando===false,'A establishes complete initial state');
  await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'initial checkpoint timer');
  A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
  await until(()=>backend.ckpts.has('1'),'original rev1 CKPT exists');
  await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'original CKPT durable ACK');
  A.channel.pausar();

  // Deliberately use DIFFERENT Y.Doc client IDs for the missing causal pair
  // and the old independent history. A same-writer tail can hide this defect
  // because its pending Yjs dependencies only clear at the last page.
  const parentWriter=device(backend);
  await until(()=>parentWriter.channel.recuperando===false,'parent writer joins rev1');
  parentWriter.doc.getMap('causalChain').set('parent','PARENT-OLDER-THAN-CUT');
  await until(()=>backend.ops.size===1,'early parent op persisted');
  const parentTimestamp=[...backend.ops.values()].at(-1).s;

  const independentWriter=device(backend);
  await until(()=>independentWriter.channel.recuperando===false,'independent writer joins rev1 + parent');
  assert.notEqual(independentWriter.doc.clientID,parentWriter.doc.clientID,
    'two independent Yjs writer client IDs are essential for this scenario');
  const n=95, history=independentWriter.doc.getMap('independentHistory');
  for(let i=0;i<n;i++){
    history.set('separate-writer-'+i,i);
    await until(()=>backend.ops.size===i+2,'independent writer durable op '+i);
  }
  const cutTimestamp=[...backend.ops.values()].at(-1).s;
  assert.ok(cutTimestamp>parentTimestamp,'bad cutoff is later than both historical writers');
  independentWriter.channel.pausar();

  // Child is only causally dependent on the EARLY parent of the same client,
  // not on the 95 unrelated operations from the independent writer.
  parentWriter.doc.getMap('causalChain').set('child','CHILD-NEWER-THAN-CUT');
  await until(()=>backend.ops.size===n+2,'child after malformed cutoff persisted');
  parentWriter.channel.pausar();

  // This bad snapshot falsely claims it covers the early parent and unrelated
  // writer ops, but contains only legitimate old rev1 baseline ciphertext.
  backend.ckpts.set('2',{...structuredClone(backend.ckpts.get('1')),s:cutTimestamp});
  assert.equal(backend.ops.size,97,'never delete or rewrite the 97 encrypted historical operations');

  const preGet=backend.calls.filter(c=>c.type==='o'&&c.method==='GET').length;
  const C=device(backend);
  let fakeBackoffMs=0,backoffResumptions=0;
  for(let i=0;i<1800&&C.channel.recuperando!==false;i++){
    const timer=C.timers.find(t=>!t.cancelled&&!t.fired&&
      (t.ms===8000||t.ms===30000||t.ms===60000||t.ms===120000||t.ms===240000||t.ms===300000));
    if(timer){
      timer.fired=true;timer.cancelled=true;fakeBackoffMs+=timer.ms;
      backoffResumptions++;timer.fn();
    }
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  const observed=C.doc.getMap('independentHistory'),missing=C.doc.store.pendingStructs?.missing?.size||0;
  const pages=backend.calls.filter(c=>c.type==='o'&&c.method==='GET').length-preGet;
  console.log('CROSS_WRITER_PRECUT',JSON.stringify({
    storedOps:backend.ops.size,independentWriterOps:n,
    independentOpsRecovered:observed.size,missingParents:missing,
    pagesRead:pages,backoffResumptions,fakeBackoffMs,
    recoveryComplete:C.channel.recuperando===false
  }));
  assert.equal(backend.ckpts.size,2,'no unsafe checkpoint may be written');
  assert.equal(C.doc.getMap('causalChain').get('parent'),'PARENT-OLDER-THAN-CUT',
    'the missing parent must be recovered from old ops');
  assert.equal(C.doc.getMap('causalChain').get('child'),'CHILD-NEWER-THAN-CUT');
  assert.equal(missing,0,'early child parent is indeed repaired');
  assert.equal(observed.size,n,
    'clearing one missing parent cannot certify remaining independent pre-cut history');
  for(let i=0;i<n;i++)assert.equal(observed.get('separate-writer-'+i),i,
    'historical writes must not be silently omitted');
  assert.equal(C.channel.recuperando,false,'full historical reconciliation must finish');
  assert.equal(C.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,2,
    'durable ACK revision never rolls back');
  C.channel.pausar();
});

test('P0 frozen unfinished interval without Yjs debt resumes an encrypted pull BEFORE HEAD, within retry budget',()=>{
  // Run the REAL programarRelectura closure verbatim with deterministic timers.
  // This pins the second half of the v698 fix that a fast 95-op fixture may
  // complete without exercising a scheduled 4-page recovery boundary.
  const start=yjs.indexOf('    function programarRelectura(sock, estado) {',yjs.indexOf('function crearCanal('));
  const end=yjs.indexOf('    // Only useful, applied bytes',start);
  assert.ok(start>0&&end>start,'real frozen-history backoff function extracted');
  const calls=[],timers=[],ws={readyState:1};
  const ctx={
    canal:{ws},partesEntrantes:{},doc:{store:{}},nombre:'catalogo',
    _tReplay:null,_replayKey:null,_replayUsed:0,
    clavePendientes:()=> 'synthetic-empty-debt',
    deudaPendiente:()=>false,
    pedirPagina:(sock,estado,sinHead)=>calls.push({sock,estado,sinHead}),
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},
    clearTimeout:()=>{},log(){},Math,Object,JSON
  };
  vm.createContext(ctx);vm.runInContext(yjs.slice(start,end),ctx);
  const state={
    enCurso:false,rescateCausalDesde:{rev:2,seq:20},
    rescateCausalHasta:{rev:2,seq:500},rescateCausalAvanzo:true
  };
  ctx.programarRelectura(ws,state);
  assert.equal(timers.length,1,'unfinished frozen history must schedule retry despite zero pending Yjs parents');
  assert.equal(timers[0].delay,8000,'existing bounded 8s recovery pacing unchanged');
  timers[0].fn();
  assert.equal(calls.length,1,'a single paced historical pull is dispatched');
  assert.equal(calls[0].sinHead,true,'never ask post-cut HEAD before independent history reaches frozen end');
  assert.equal(state.rescateCausalAvanzo,false,'forward progress token consumed once, not inventing vector progress');
  state.rescateCausalDesde=null;state.rescateCausalHasta=null;
  ctx.programarRelectura(ws,state);
  assert.equal(ctx._replayKey,null,'finished history and no Yjs debt reset retry bookkeeping');
  ctx._replayUsed=5;ctx._replayKey='synthetic-empty-debt';
  state.rescateCausalDesde={rev:2,seq:20};state.rescateCausalHasta={rev:2,seq:500};
  ctx.programarRelectura(ws,state);
  assert.equal(timers.length,1,'stalled history cannot bypass exhausted bounded retry budget');
});
