'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const mock=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
test('S3: read-only audit reports numeric sizes without source records',()=>{
 const at=sync.indexOf('  function _medirDocumentoYjs(Y, doc, nombre, canal, idb, permiteCkpt) {');
 const end=sync.indexOf('\n  var API = {',at);
 assert.ok(at>0&&end>at,'size audit must exist');
 const ctx=vm.createContext({window:{},Uint8Array,JSON,Math,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto});
 vm.runInContext(vendor,ctx);vm.runInContext(sync.slice(at,end),ctx);
 vm.runInContext("var cat=new Y.Doc(),ops=new Y.Doc(),fotos=new Y.Doc();"+
   "cat.getMap('productos').set('synthetic-product',{id:'synthetic-product',fotoHash:'synthetic-hash'});"+
   "ops.getMap('eventos').set('synthetic-sale',{opId:'synthetic-sale',cantidad:2});"+
   "fotos.getMap('blobs').set('synthetic-hash','data:image/png;base64,AAA');",ctx);
 const Y=ctx.Y,cat=ctx.cat,ops=ctx.ops,fotos=ctx.fotos;
 const read=(doc,name,ckpt)=>vm.runInContext('_medirDocumentoYjs(Y,__doc,__name,{recuperando:false},{synced:true},__ckpt)',Object.assign(ctx,{__doc:doc,__name:name,__ckpt:ckpt}));
 const a=read(cat,'catalogo',true),b=read(ops,'operaciones',true),c=read(fotos,'fotos',false);
 for(const item of [a,b,c]){
   assert.ok(item.bytesPlano>0);
   assert.equal(item.bytesCifrados,item.bytesPlano+29);
   assert.equal(item.entradas,1);
   assert.equal(item.hidratado,true);
   assert.doesNotMatch(JSON.stringify(item),/synthetic-product|synthetic-hash|synthetic-sale|AAA/);
 }
 assert.equal(a.dataImageInline,0);assert.equal(b.dataImageInline,0);
 assert.equal(c.dataImageInline,1);assert.equal(c.checkpoint,false);
});
test('S3: product export whitelist strips inline photo from remote product',()=>{
 const start=mock.indexOf('productos: productos.filter((p) =>');
 const end=mock.indexOf('/* EL EQUIPO VIAJA',start);
 assert.ok(start>0&&end>start);
 const expression=mock.slice(start,end).trim();
 const ctx=vm.createContext({productos:[{id:'synthetic',foto:'data:image/png;base64,ABC',fotoHash:'hash-only'}],
  _demoLocal:null,_estaEnSemillaDemoSeleccionada:()=>false,
  precioOpcional:x=>x,normPctAsociado:x=>x,Number,JSON,Math});
 const result=vm.runInContext('({'+expression+'})',ctx);
 assert.equal(result.productos.length,1);
 assert.equal(result.productos[0].fotoHash,'hash-only');
 assert.equal(Object.hasOwn(result.productos[0],'foto'),false);
 assert.doesNotMatch(JSON.stringify(result),/data:image\//);
});

test('S3: oversized tag0 uses only causal-preserving Yjs replay, never a new map identity',()=>{
 const start=sync.indexOf('  function _compactarYjsSinCambiarCausalidad(Y, full) {');
 const end=sync.indexOf('\n  function crearCanal(',start);
 assert.ok(start>0&&end>start,'safe, bounded tag0 checkpoint replay helper required');
 const ctx=vm.createContext({window:{},Uint8Array,JSON,Math,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto});
 vm.runInContext(vendor,ctx);
 vm.runInContext(sync.slice(start,end),ctx);
 vm.runInContext("var d=new Y.Doc(); var m=d.getMap('productos'); m.set('test','old'); m.set('test','new'); var full=Y.encodeStateAsUpdate(d);",ctx);
 const compact=vm.runInContext('_compactarYjsSinCambiarCausalidad(Y,full)',ctx);
 if(compact){
   assert.ok(compact.length<ctx.full.length,'only smaller snapshots can replace original');
   vm.runInContext('var check=new Y.Doc(); Y.applyUpdate(check,__compact);',Object.assign(ctx,{__compact:compact}));
   assert.equal(vm.runInContext('Y.equalSnapshots(Y.snapshot(d),Y.snapshot(check))',ctx),true);
   assert.equal(vm.runInContext('JSON.stringify(d.toJSON())===JSON.stringify(check.toJSON())',ctx),true);
 }
 assert.match(sync,/if \(!useful && full\.length \+ 29/);
 assert.match(sync,/diagnosticarCkpt\("snapshot-over-limit"/);
});


// Checkpoint payload cap is decoded ciphertext (server after migration: 786432 B), not base64 JSON.
// Older adapters still enforce the 256 KiB serialized frame limit.
async function checkpointProbe(cipherBytes, advertised = true) {
 const at=sync.indexOf('    function hacerCkpt() {');
 const end=sync.indexOf('    function conectar() {',at);
 assert.ok(at>0&&end>at);
 const saved=[],diagnostics=[];
 const full=new Uint8Array(cipherBytes-30);
 const ctx=vm.createContext({
  window:{F123Relay:advertised?{ckptFrameBytes:786432}:{}},
  _soloMemoria:false,canal:{ws:{readyState:1,peerOnly:false},recuperando:false},
  permiteCkpt:true,API:{clave:'synthetic',rollout:{outboxV2:false,gzipWrite:false}},
  _currentPullState:null,_appliedPullCursor:{rev:0,seq:1},
  partesEntrantes:{},doc:{store:{}},
  Y:{encodeStateAsUpdate:()=>full},_outbox:{pending:[],checkpoint:''},
  MAX_OP_BYTES:250*1024,MAX_CKPT_RPC_BYTES:256*1024,MAX_CKPT_CIPHER_BYTES:768*1024,
  _b64:bytes=>Buffer.from(bytes).toString('base64'),
  _frame:()=>new Uint8Array(1),
  cifrarBin:async()=>new Uint8Array(cipherBytes).buffer,
  _compactarYjsSinCambiarCausalidad:()=>null,
  guardarSobre:entry=>saved.push(entry),
  diagnosticarCkpt:(reason,bytes)=>diagnostics.push({reason,bytes}),
  nombre:'catalogo',log(){}
 });
 vm.runInContext(sync.slice(at,end),ctx);
 vm.runInContext('hacerCkpt()',ctx);
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 return {saved,diagnostics};
}
test('S3: exactly 786432 ciphertext bytes pass the advertised checkpoint cap',async()=>{
 assert.match(sync,/var MAX_OP_BYTES = 250 \* 1024/,'OP guard must remain unchanged');
 assert.match(sync,/var MAX_CKPT_CIPHER_BYTES = 768 \* 1024/);
 const {saved,diagnostics}=await checkpointProbe(786432);
 assert.equal(saved.length,1,'the full server-cap checkpoint must be enqueued');
 const wire={...saved[0]};delete wire.state;
 const bytes=Buffer.byteLength(JSON.stringify(wire));
 assert.ok(bytes>256*1024,'must exercise the larger RPC-only transport allowance');
 assert.ok(bytes<1088*1024,'actual serialized frame must fit the checkpoint transport cap');
 assert.equal(diagnostics.length,0);
});
test('S3: 786433 ciphertext bytes are rejected before durable enqueue',async()=>{
 const {saved,diagnostics}=await checkpointProbe(786433);
 assert.equal(saved.length,0,'server-oversized ciphertext must never be queued');
 assert.deepEqual(diagnostics,[{reason:'snapshot-over-limit',bytes:786433}]);
});
test('S3: old adapters without the advertised capability retain the smaller frame cap',async()=>{
 const fits=await checkpointProbe(196000,false),tooLarge=await checkpointProbe(197000,false);
 assert.equal(fits.saved.length,1);
 assert.equal(tooLarge.saved.length,0);
 assert.equal(tooLarge.diagnostics[0].reason,'snapshot-over-limit');
});
test('S3: 1MiB checkpoint envelope bypasses only the idle advertised RPC buffer guard',()=>{
 const at=sync.indexOf('    function enviarConLimite(ws, value, ckptRPC) {');
 const end=sync.indexOf('    function encolarVivo(',at);
 assert.ok(at>0&&end>at);
 const sends=[];
 const ctx=vm.createContext({
  window:{F123Relay:{ckptFrameBytes:786432}},
  MAX_BUFFERED_BYTES:512*1024,MAX_CKPT_CIPHER_BYTES:768*1024,
  bytesPendientes:value=>Buffer.byteLength(value),
  _lastRelayProgressAt:0,Date
 });
 vm.runInContext(sync.slice(at,end),ctx);
 const frame='x'.repeat(1048576+200);
 const ws={readyState:1,peerOnly:false,bufferedAmount:0,send:value=>sends.push(value)};
 const call=ckpt=>vm.runInContext('enviarConLimite(ws, frame, '+String(ckpt)+')',Object.assign(ctx,{ws,frame}));
 assert.equal(call(true),'sent');
 assert.equal(sends.length,1);
 ws.bufferedAmount=1;
 assert.equal(call(true),'blocked','large checkpoint waits for an empty buffer');
 ws.bufferedAmount=0;
 assert.equal(call(false),'blocked','ordinary frame keeps 512KiB guard');
 ws.peerOnly=true;
 assert.equal(call(true),'blocked','peer frame is never exempt');
 ws.peerOnly=false;
 ctx.window.F123Relay={};
 assert.equal(call(true),'blocked','legacy adapter is never exempt');
 assert.equal(sends.length,1,'blocked calls never sent bytes');
});

test('S3: read-only catalog collection audit returns only names, counts and estimated visible JSON bytes',()=>{
 const at=sync.indexOf('  function _medirDocumentoYjs(Y, doc, nombre, canal, idb, permiteCkpt) {');
 const end=sync.indexOf('\n  var API = {',at);
 assert.ok(at>0&&end>at);
 const ctx=vm.createContext({
  window:{},Uint8Array,JSON,Math,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto,
  COLECCIONES:['productos','ventas','gastos','actividad','ajustes','transferencias']
 });
 vm.runInContext(vendor,ctx);
 vm.runInContext(sync.slice(at,end),ctx);
 vm.runInContext("var cat=new Y.Doc();"+
   "cat.getMap('productos').set('private-product-id',{nombre:'private-product-value'});"+
   "cat.getMap('ventas').set('private-sale-id',{descripcion:'private-sale-value'.repeat(10)});"+
   "cat.getMap('_stock_pn_testigos_v1').set('private-device',{cantidad:42});",ctx);
 const rows=vm.runInContext('_medirColeccionesCatalogo(cat)',ctx);
 const sale=rows.find(x=>x.coleccion==='ventas');
 assert.equal(sale.entradas,1);
 assert.ok(sale.bytesJSONVisibles>100);
 assert.equal(rows[0].coleccion,'ventas','rank largest visible collection first');
 assert.equal(rows.find(x=>x.coleccion==='hechos_financieros').entradas,0);
 assert.equal(rows.find(x=>x.coleccion==='_stock_pn_testigos_v1').entradas,1);
 assert.ok(rows.every(x=>Object.keys(x).sort().join(',')==='bytesJSONVisibles,coleccion,entradas'));
 assert.doesNotMatch(JSON.stringify(rows),/private-|product-value|sale-value/);
});


// P0 regression contract: a successful ACK on one durable provider is NOT proof
// that the same ciphertext checkpoint exists on the other durable provider.
// This is a synthetic-only VM fixture; no real stores, keys or network calls.
async function probeCheckpointSource(previousProof, activeLayer) {
 const at=sync.indexOf('    function hacerCkpt() {');
 const end=sync.indexOf('    function conectar() {',at);
 assert.ok(at>0&&end>at);
 const full=new Uint8Array(128).fill(7);
 const state=Buffer.from(full).toString('base64');
 const saved=[];
 const ctx=vm.createContext({
  window:{F123Relay:{ckptFrameBytes:786432}},
  _soloMemoria:false,
  canal:{ws:{readyState:1,peerOnly:false,relayLayer:activeLayer},recuperando:false},
  permiteCkpt:true,
  API:{clave:'SYNTHETIC-ONLY',rollout:{outboxV2:false,gzipWrite:false}},
  _currentPullState:null,_appliedPullCursor:{rev:1,seq:2},
  partesEntrantes:{},doc:{store:{}},
  Y:{encodeStateAsUpdate:()=>full},
  _outbox:{pending:[],checkpoint:state,checkpointLayer:previousProof,confirmed:[]},
  MAX_CKPT_RPC_BYTES:256*1024,MAX_CKPT_CIPHER_BYTES:768*1024,
  _b64:bytes=>Buffer.from(bytes).toString('base64'),
  _frame:()=>new Uint8Array(1),
  cifrarBin:async()=>new Uint8Array(200).buffer,
  _compactarYjsSinCambiarCausalidad:()=>null,
  guardarSobre:entry=>saved.push(entry),
  diagnosticarCkpt(){},nombre:'catalogo',log(){}
 });
 vm.runInContext(sync.slice(at,end),ctx);
 vm.runInContext('hacerCkpt()',ctx);
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 return saved;
}
test('P0: confirmed Supabase snapshot must be offered to Firebase after a durable layer change',async()=>{
 const sent=await probeCheckpointSource('f123_relay_cupo_v1','f123_relay_cupo_fb_v1');
 assert.equal(sent.length,1,'a checkpoint ACK on Supabase cannot certify Firebase: do not suppress re-publish');
 assert.equal(sent[0].k,'ckpt');
 assert.equal(sent[0].state,Buffer.from(new Uint8Array(128).fill(7)).toString('base64'));
});
test('P0: confirmed same-layer checkpoint does not re-send identical snapshot',async()=>{
 const sent=await probeCheckpointSource('f123_relay_cupo_fb_v1','f123_relay_cupo_fb_v1');
 assert.equal(sent.length,0,'avoid inflating same-provider room and burning upload quota');
});
test('P0: legacy checkpoint with unknown provider must not certify a different durable provider',async()=>{
 const sent=await probeCheckpointSource(null,'f123_relay_cupo_fb_v1');
 assert.equal(sent.length,1,'legacy global hash is not proof of Firebase persistence');
});


test('P0: checkpoint ACK provenance is source-tagged without altering Yjs pull/live classification',()=>{
 const selector=fs.readFileSync(path.join(__dirname,'../docs/relay-selector.js'),'utf8');
 assert.match(selector,/var persistLayer = typeof e\.data === "string"/);
 assert.match(selector,/persistLayer: persistLayer/);
 assert.match(selector,/relaySource: e\.relaySource, persistLayer:/,
  'existing pull/live/peer source must remain unchanged');
 assert.match(sync,/confirmarDurable\(c, ev\.persistLayer\)/);
 assert.match(sync,/checkpointLayer:meta\.checkpointLayer \|\| ""/,'outbox v2 read preserves proof');
 assert.match(sync,/checkpointLayer:_outbox\.checkpointLayer \|\| ""/,'outbox v2 write preserves proof');
 assert.match(sync,/checkpointLayer: _outbox\.checkpointLayer \|\| ""/,'error rollback preserves proof');
});

async function checkpointAckProbe(layer, ok=true) {
 const start=sync.indexOf('    function confirmarDurable(');
 const end=sync.indexOf('    // P0 / 1AAA:',start);
 assert.ok(start>=0&&end>start);
 const ctx=vm.createContext({
  _durableQueue:Promise.resolve(),_durableInFlight:{},_durableWatchdog:null,
  _durableTimer:null,_durableDelay:2000,_groupAcks:new Set(),
  _currentPullState:null,canal:{ws:{readyState:1}},
  _outbox:{pending:[{id:'synthetic-ckpt',k:'ckpt',state:'SYNTHETIC-STATE'}],
   confirmed:[],checkpoint:'',checkpointLayer:''},
  _absorcion:null, _absorcionKey:'synthetic',
  clearTimeout(){}, programarDurable(){},
  diagnosticarCkpt(){},_vivos:()=>[], avisarDurable(){},
  mutarOutbox:cb=>{cb();return Promise.resolve()}, drenarDurable(){}, log(){},
  Object,Array,Set,Promise
 });
 vm.runInContext(sync.slice(start,end),ctx);
 vm.runInContext('confirmarDurable({id:"synthetic-ckpt",kind:"ckpt",ok:'+ok+'},__source)',Object.assign(ctx,{__source:layer}));
 await ctx._durableQueue;
 return ctx._outbox;
}
test('P0: actual successful Firebase ACK proves Firebase, not generic relay',async()=>{
 const d=await checkpointAckProbe('f123_relay_cupo_fb_v1');
 assert.equal(d.checkpoint,'SYNTHETIC-STATE');
 assert.equal(d.checkpointLayer,'f123_relay_cupo_fb_v1');
 assert.equal(d.pending.length,0);
});
test('P0: unknown/peer ACK can retire but never certify a durable checkpoint provider',async()=>{
 for(const layer of [null,'peer-live','SENSITIVE-ROOM']){
  const d=await checkpointAckProbe(layer);
  assert.equal(d.checkpointLayer,'');
  assert.doesNotMatch(JSON.stringify(d),/SENSITIVE-ROOM/);
 }
});
test('P0: negative Firebase ACK cannot create provider proof or discard checkpoint',async()=>{
 const d=await checkpointAckProbe('f123_relay_cupo_fb_v1',false);
 assert.equal(d.checkpointLayer,'');
 assert.equal(d.checkpoint,'');
 assert.equal(d.pending.length,1);
});


test('P0: actual relay-selector forwarded ACK preserves exact durable origin and binary relaySource',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../docs/relay-selector.js'),'utf8').replace(/\r\n/g,'\n');
 const start=source.indexOf('        var persistLayer = typeof e.data === "string" &&');
 const end=source.indexOf('\n      });\n      ws.addEventListener("error"',start);
 assert.ok(start>0&&end>start,'exercise actual relay-selector dispatch expression');
 const snippet=source.slice(start,end);
 const layers=[
  {key:'f123_relay_cupo_v1'},
  {key:'f123_relay_cupo_fb_v1'}
 ];
 const dispatch=(orden,data,relaySource,peerAccepted=false)=>{
  let event=null;
  const context=vm.createContext({
   x:{orden},capas:layers,e:{data,relaySource,peerAccepted,peerReceipt:null,peerAck:null},
   emitir:(type,payload)=>{assert.equal(type,'message');event=payload}
  });
  vm.runInContext(snippet,context);
  return event;
 };
 const ack=JSON.stringify({k:'persist-result',kind:'ckpt',id:'synthetic',ok:true});
 const sb=dispatch(0,ack,undefined),fb=dispatch(1,ack,undefined);
 assert.equal(sb.persistLayer,'f123_relay_cupo_v1');
 assert.equal(fb.persistLayer,'f123_relay_cupo_fb_v1');
 const peer=dispatch(2,ack,'peer-live',true);
 assert.equal(peer.persistLayer,null,'peers never certify a durable relay');
 assert.equal(peer.relaySource,'peer-live');
 const binary=dispatch(1,new Uint8Array([2,3]).buffer,'pull');
 assert.equal(binary.persistLayer,null,'binary Yjs pages cannot be mistaken for persistence ACKs');
 assert.equal(binary.relaySource,'pull','Yjs durable cursor classification stays unchanged');
 const live=dispatch(0,new Uint8Array([4]).buffer,'live');
 assert.equal(live.relaySource,'live');
 assert.equal(live.persistLayer,null);
});
