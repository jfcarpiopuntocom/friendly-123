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


test('v694 checkpoint compacts a ~250 KB synthetic catalog; fresh B hydrates with one checkpoint', {timeout:45000},async()=>{
 const cryptoHash=require('node:crypto').createHash;
 const syntheticData=new Map();
 for(let i=0;i<220;i++){
  let payload='';
  for(let j=0;j<18;j++){
   payload+=cryptoHash('sha256').update('SYNTHETIC-ONLY-'+i+'-'+j).digest('hex');
  }
  syntheticData.set('fake-product-'+String(i).padStart(4,'0'),payload);
 }
 const backend=rest();
 const A=device(backend,doc=>{
  const catalog=doc.getMap('largeCatalog');
  for(const [key,value] of syntheticData)catalog.set(key,value);
 });
 const snapshotBytes=A.Y.encodeStateAsUpdate(A.doc).byteLength;
 assert.ok(snapshotBytes>220*1024,'must test catalog comparable to reported large histories');
 assert.ok(snapshotBytes<750*1024,'synthetic fixture must fit the existing checkpoint cap');
 await until(()=>A.channel.recuperando===false,'large A completes pull and final HEAD');
 assert.equal(A.doc.store.pendingStructs,null);
 assert.equal(A.doc.store.pendingDs,null);
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),
   'large A schedules checkpoint after hydration');
 const timer=A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1);
 timer.fn();
 await until(()=>backend.ckpts.has('1'),'large catalog checkpoint persisted by real Firebase adapter');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,
   'large checkpoint receives matching remote ACK');
 assert.equal(A.storage.get('f123_relay_outbox_v1-y').pending.filter(x=>x.k==='ckpt').length,0);
 const checkpoint=backend.ckpts.get('1');
 assert.ok(Buffer.from(checkpoint.c,'base64').byteLength<=768*1024,
   'full snapshot obeys the existing 768 KiB encrypted checkpoint ceiling');
 A.channel.pausar();
 const readsBeforeB=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'fresh B finishes large checkpoint recovery');
 const got=B.doc.getMap('largeCatalog');
 assert.equal(got.size,syntheticData.size,'all 220 synthetic records present');
 for(const [key,value] of syntheticData)assert.equal(got.get(key),value,
   'large checkpoint must preserve every byte without dropped records');
 assert.equal(B.doc.store.pendingStructs,null);
 assert.equal(B.doc.store.pendingDs,null);
 assert.equal(B.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,1);
 assert.equal(backend.ckpts.size,1);
 const pullReads=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 console.log('SYNTHETIC_250K_READ_COUNTS', JSON.stringify({beforeB:readsBeforeB,afterTotal:pullReads,newB:pullReads-readsBeforeB}));
 assert.equal(pullReads-readsBeforeB,3,'B should need HEAD, checkpoint pull and final HEAD only');
 B.channel.pausar();
});


test('P0 stale Firebase checkpoint + 31 distinct causal updates: newest 15 survives cold reopen, older 33 never resurrects', {timeout:120000}, async()=>{
 const backend=rest();
 const A=device(backend,doc=>doc.getMap('products').set('count-synthetic',33));
 await until(()=>A.channel.recuperando===false,'A initial HEAD and hydration');
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'A checkpoint timer');
 A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('1'),'A persisted original checkpoint containing 33');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'A received the actual adapter persist-result ACK');
 A.channel.pausar();

 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'B finishes cold join from rev1 checkpoint');
 assert.equal(B.doc.getMap('products').get('count-synthetic'),33,'baseline must really be 33');
 const m=B.doc.getMap('products');
 for(let i=0;i<30;i++){
   const prior=backend.ops.size;
   m.set('tail-synthetic-'+i,i);
   await until(()=>backend.ops.size>prior,'tail event '+i+' durable on synthetic REST');
 }
 const beforeLast=backend.ops.size;
 m.set('count-synthetic',15);
 await until(()=>backend.ops.size>beforeLast,'newer count 15 has its own durable operation');
 assert.equal(backend.ops.size,31,'real transport published 31 distinct operations after old checkpoint');
 assert.equal(backend.ckpts.size,1,'no fresh checkpoint: force stale snapshot + paged op replay');
 B.channel.pausar();

 // Negative causal control: with newest op absent, a brand-new device still sees old 33.
 const [lastId,lastOp]=[...backend.ops.entries()].at(-1);
 backend.ops.delete(lastId);
 const Missing=device(backend);
 await until(()=>Missing.channel.recuperando===false,'negative-control cold join completes without newest write');
 assert.equal(Missing.doc.getMap('products').get('count-synthetic'),33,
   'dropping the most recent op must be detected as stale state, not fake convergence');
 Missing.channel.pausar();
 backend.ops.set(lastId,lastOp);

 const readsBeforeC=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 const C=device(backend);
 await until(()=>C.channel.recuperando===false,'C completes stale checkpoint and 31-op paginated recovery');
 const final=C.doc.getMap('products');
 assert.equal(final.get('count-synthetic'),15,'last causal count wins after reconnection');
 for(let i=0;i<30;i++)assert.equal(final.get('tail-synthetic-'+i),i,'no history omissions');
 assert.equal(C.doc.store.pendingStructs,null,'no causal parents missing');
 assert.equal(C.doc.store.pendingDs,null,'no pending deleted structures');
 assert.equal(C.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,1);
 const reads=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length-readsBeforeC;
 assert.ok(reads>3,'old checkpoint forces an actual multi-page catch-up, not a new compact snapshot');
 console.log('STALE_CHECKPOINT_SYNTHETIC_ONLY',JSON.stringify({newBData:31,legacySnapshot:true,newCReads:reads,postReplayLatestValue:15}));
 C.channel.pausar();
});

test('P0 3212 sequential causal operations after an old checkpoint recover completely from scratch', {timeout:240000}, async()=>{
 const backend=rest();
 const A=device(backend,doc=>doc.getMap('longHistory').set('latest-synthetic-count',33));
 await until(()=>A.channel.recuperando===false,'A hydrated from empty remote room');
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'A checkpoint timer');
 A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('1'),'initial old checkpoint persisted');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'initial checkpoint ACKed by actual adapter');
 A.channel.pausar();

 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'B hydrated old checkpoint');
 const map=B.doc.getMap('longHistory');
 assert.equal(map.get('latest-synthetic-count'),33,'baseline old physical count');
 for(let i=0;i<3211;i++){
   const prior=backend.ops.size;
   map.set('history-'+String(i).padStart(4,'0'),i);
   await until(()=>backend.ops.size>prior,'durable operation '+i+' recorded by synthetic REST');
 }
 const beforeFinal=backend.ops.size;
 map.set('latest-synthetic-count',15);
 await until(()=>backend.ops.size>beforeFinal,'final recent count durable');
 assert.equal(backend.ops.size,3212,'all 3212 synthetic causal operations stored');
 assert.equal(backend.ckpts.size,1,'snapshot deliberately stale; no hidden re-compaction');
 B.channel.pausar();

 const beforeReads=backend.calls.filter(c=>c.type==='o'&&c.method==='GET').length;
 const C=device(backend);
 const start=Date.now();
 while(C.channel.recuperando!==false&&Date.now()-start<60000){
   await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.equal(C.channel.recuperando,false,'C must complete remote pull and final HEAD, not merely receive some pages');
 assert.equal(C.doc.getMap('longHistory').get('latest-synthetic-count'),15,
   'newest count remains authoritative, without a fabricated delta');
 assert.equal(C.doc.getMap('longHistory').size,3212,'no dropped historical values');
 for(let i=0;i<3211;i++)assert.equal(C.doc.getMap('longHistory').get('history-'+String(i).padStart(4,'0')),i);
 assert.equal(C.doc.store.pendingStructs,null,'all causal parents available after full replay');
 assert.equal(C.doc.store.pendingDs,null,'no pending deletes');
 assert.equal(C.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,1,'real durable cursor retained');
 const reads=backend.calls.filter(c=>c.type==='o'&&c.method==='GET').length-beforeReads;
 assert.ok(reads>100,'force extended paginated replay, not checkpoint shortcut');
 console.log('SYNTHETIC_DEEP_REPLAY',JSON.stringify({
  storedOperations:backend.ops.size, pagesRead:reads,
  finalCount:15, receivedAll:true, pendingParents:0,
  elapsedMs:Date.now()-start
 }));
 C.channel.pausar();
});

test('P0 8489 Yjs updates after stale checkpoint -> fully recovered writer compacts -> fast brand-new D cold join', {timeout:330000}, async()=>{
 const backend=rest();
 const A=device(backend,doc=>doc.getMap('identity').set('latest-synthetic-count',33));
 await until(()=>A.channel.recuperando===false,'A recovers initial empty room');
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'A checkpoint timer after recovery');
 A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('1'),'initial checkpoint stored by real Firebase adapter');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'initial remote ACK applied to A outbox');
 A.channel.pausar();

 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'B retrieves old checkpoint');
 const history=B.doc.getMap('rollingCatalog');
 for(let i=0;i<8488;i++){
   const before=backend.ops.size;
   history.set('synthetic-product-'+String(i%15).padStart(2,'0'),i);
   await until(()=>backend.ops.size>before,'operation '+i+' must be durable');
 }
 const beforeFinal=backend.ops.size;
 B.doc.getMap('identity').set('latest-synthetic-count',15);
 await until(()=>backend.ops.size>beforeFinal,'final count update must be stored');
 assert.equal(backend.ops.size,8489,'exactly 8489 synthetic Yjs ops after old checkpoint');
 assert.equal(backend.ckpts.size,1,'no accidental new checkpoint before C full hydration');
 B.channel.pausar();

 const beforeReplay=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 const C=device(backend);
 const start=Date.now();
 while(C.channel.recuperando!==false&&Date.now()-start<120000)
   await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(C.channel.recuperando,false,'C must complete *all* old history before attempting compaction');
 assert.equal(C.doc.getMap('identity').get('latest-synthetic-count'),15,
   'latest count 15 must override checkpoint 33');
 assert.equal(C.doc.getMap('rollingCatalog').size,15,'all 15 rolling synthetic products recovered');
 for(let p=0;p<15;p++){
   const last=8487-((8487-p+15)%15);
   assert.equal(C.doc.getMap('rollingCatalog').get('synthetic-product-'+String(p).padStart(2,'0')),last,
     'newest update of each synthetic product must survive long replay');
 }
 assert.equal(C.doc.store.pendingStructs,null);
 assert.equal(C.doc.store.pendingDs,null);
 const replayReads=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length-beforeReplay;
 assert.ok(replayReads>300,'must exercise a genuinely long replay, not shortcut to old snapshot');
 const snapshotBytes=C.Y.encodeStateAsUpdate(C.doc).byteLength;
 // Existing unchanged v694 cap. Oversized state may reveal why a checkpoint cannot be generated.
 await until(()=>C.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),
   'fresh checkpoint should be scheduled only after full catch-up');
 C.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('2'),'fully recovered C must persist a second revision');
 await until(()=>C.storage.get('f123_relay_outbox_v1-y')?.checkpoint==='2' ||
   (C.storage.get('f123_relay_outbox_v1-y')?.pending||[]).filter(x=>x.k==='ckpt').length===0,
   'CKPT must be remote ACKed and retired from outbox');
 assert.equal(backend.ckpts.size,2);
 const cipherBytes=Buffer.from(backend.ckpts.get('2').c,'base64').byteLength;
 assert.ok(cipherBytes<=768*1024,'do not bypass the existing encrypted checkpoint cap');
 C.channel.pausar();

 const beforeD=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 const D=device(backend);
 await until(()=>D.channel.recuperando===false,'D must complete from fresh CKPT after final HEAD');
 assert.equal(D.doc.getMap('identity').get('latest-synthetic-count'),15);
 assert.equal(D.doc.getMap('rollingCatalog').size,15);
 assert.equal(D.doc.store.pendingStructs,null);
 assert.equal(D.doc.store.pendingDs,null);
 assert.equal(D.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,2);
 const freshReads=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length-beforeD;
 assert.equal(freshReads,3,'D must use HEAD, checkpoint pull, final HEAD, not thousands of old ops');
 console.log('SYNTHETIC_8489_COMPACTION',JSON.stringify({
  oldCheckpointRev:1,opsAfterOldCheckpoint:8489,
  longReaderPages:replayReads,compactSourceBytes:snapshotBytes,
  checkpointCipherBytes:cipherBytes,newCheckpointRev:2,
  freshReaderGETs:freshReads,latestCount:15,pendingParents:0
 }));
 D.channel.pausar();
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


test('P0 BAD CKPT cut hides a preserved parent OP: explicit raw-history proof may recover it', {timeout:35000},async()=>{
 const backend=rest();
 const A=device(backend,doc=>doc.getMap('identity').set('baseline',33));
 await until(()=>A.channel.recuperando===false,'A initial join');
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'A ckpt timer');
 A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('1'),'legitimate rev1 checkpoint');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'ACK for rev1');
 A.channel.pausar();
 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'B hydrated rev1');
 const map=B.doc.getMap('causalChain');
 map.set('parent','REAL-STORED-PARENT-SYNTHETIC');
 await until(()=>backend.ops.size===1,'parent stored');
 const parent=structuredClone([...backend.ops.values()][0]);
 map.set('child','REAL-STORED-CHILD-SYNTHETIC');
 await until(()=>backend.ops.size===2,'child stored');
 // Invalid historical rev2 snapshot: copied old rev1 state but falsely claims
 // to cover parent.s. Real append-only op history retains BOTH parent and child.
 backend.ckpts.set('2',{...structuredClone(backend.ckpts.get('1')),s:parent.s});
 assert.equal(backend.ops.size,2,'both ciphertext ops remain available for rescue');
 B.channel.pausar();
 const C=device(backend);
 // Cross-relay negative control: selector did not certify the Firebase layer.
 // The new AUTOMATIC ancestor rescue must NOT fire on a peer/unknown source;
 // the explicit old-op transport probe still demonstrates the parent is stored.
 C.channel.ws.relayLayer='unknown';
 await until(()=>!!(C.doc.store.pendingStructs&&C.doc.store.pendingStructs.missing?.size),
  'old checkpoint + recent child alone leaves causal parent missing');
 assert.equal(C.channel.recuperando,true,'must not falsely certify snapshot with invalid cut');
 assert.equal(C.doc.getMap('causalChain').get('child'),undefined);
 // Controlled *manual* transport-only experiment: on the current revision,
 // seq:0 means replay all still-stored ops WITHOUT injecting the bad checkpoint.
 // This does not change any production source or server state.
 C.channel.ws.send(JSON.stringify({k:'pull',v:2,rev:2,seq:0,limit:12}));
 await until(()=>!C.doc.store.pendingStructs,
  'manual in-memory full append-only op replay resolves missing parent');
 assert.equal(C.doc.getMap('causalChain').get('parent'),'REAL-STORED-PARENT-SYNTHETIC');
 assert.equal(C.doc.getMap('causalChain').get('child'),'REAL-STORED-CHILD-SYNTHETIC');
 assert.equal(backend.ckpts.size,2,'manual rescue must never emit unsafe checkpoint');
 console.log('SYNTHETIC_BAD_CHECKPOINT_RECOVERED_MANUALLY',JSON.stringify({
  priorParentStillStored:true,missingParentsAfterFullOpReplay:0,
  wouldNeedAutomaticBoundedFallback:true
 }));
 C.channel.pausar();
});


test('P0 AUTOMATIC Firebase-only pre-CKPT ancestor rescue: bad cut but parent OP retained; no manual commands', {timeout:40000},async()=>{
 const backend=rest();
 const A=device(backend,doc=>doc.getMap('identity').set('baseline',33));
 await until(()=>A.channel.recuperando===false,'A initial join');
 await until(()=>A.timers.some(t=>!t.cancelled&&(t.ms===250||t.ms===2500)),'A checkpoint timer');
 A.timers.filter(t=>!t.cancelled&&(t.ms===250||t.ms===2500)).at(-1).fn();
 await until(()=>backend.ckpts.has('1'),'A rev1 CKPT');
 await until(()=>!!A.storage.get('f123_relay_outbox_v1-y')?.checkpoint,'A CKPT ACK');
 A.channel.pausar();
 const B=device(backend);
 await until(()=>B.channel.recuperando===false,'B hydrated initial state');
 B.doc.getMap('causalChain').set('parent','PARENT-IN-EARLY-OP-SYNTHETIC');
 await until(()=>backend.ops.size===1,'parent persisted as OP');
 const parent=structuredClone([...backend.ops.values()][0]);
 B.doc.getMap('causalChain').set('child','CHILD-IN-LATE-OP-SYNTHETIC');
 await until(()=>backend.ops.size===2,'child persisted as OP');
 backend.ckpts.set('2',{...structuredClone(backend.ckpts.get('1')),s:parent.s});
 B.channel.pausar();

 const C=device(backend); // MUST NEVER manually call channel.ws.send('pull')
 await until(()=>C.channel.recuperando===false,
   'one-time autonomous Firebase-only ancestor scan must complete after a final page with Yjs pending');
 assert.equal(C.doc.getMap('causalChain').get('parent'),'PARENT-IN-EARLY-OP-SYNTHETIC',
   'older causal parent retained on server must be recovered automatically');
 assert.equal(C.doc.getMap('causalChain').get('child'),'CHILD-IN-LATE-OP-SYNTHETIC');
 assert.equal(C.doc.store.pendingStructs,null);
 assert.equal(C.doc.store.pendingDs,null);
 assert.equal(backend.ckpts.size,2,'never rewrite CKPT while uncertain');
 assert.equal(C.storage.get('f123_yjs_pull_cursor_v2-y')?.rev,2,
  'durable revision must not roll back to unverified checkpoint cut');
 const gets=backend.calls.filter(c=>c.method==='GET'&&c.type==='o').length;
 assert.ok(gets<=24,'one-time rescue must not explode remote GET budget for this two-OP case');
 console.log('AUTO_GENESIS_BACKFILL',JSON.stringify({recovered:true,causalDebt:0,initialCKPTUnchanged:true,totalGets:gets}));
 C.channel.pausar();
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
