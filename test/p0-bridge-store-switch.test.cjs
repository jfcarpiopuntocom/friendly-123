'use strict';
// PORT 2.0 behind a per-store switch (OFF by default) + shadow write to the legacy relay.
// RED->GREEN against the real docs/sync-yjs.js, src/yparty-piloto.js and the vendored Yjs.
// Synthetic licences only; no network, no PIN, no real data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8').replace(/\r\n/g,'\n');
const QA='F123-SYNT-QA00-STORE',OTRA='F123-SYNT-OTHER-STORE';
const key=c=>crypto.createHash('sha256').update('friendly123-rollout-v1:'+c).digest('hex');

const ps=source.indexOf('  async function _politicaRollout(codigo) {');
const pe=source.indexOf('\n  function _compactarYjsSinCambiarCausalidad(',ps);
assert.ok(ps>=0&&pe>ps,'real rollout policy must remain detectable');
async function politica(cfg,codigo){
  const ctx=vm.createContext({crypto:crypto.webcrypto,TextEncoder,Uint8Array,Array,Number,Promise,setTimeout,
    fetch:async()=>cfg===null?{ok:false}:({ok:true,json:async()=>cfg})});
  vm.runInContext(source.slice(ps,pe),ctx);
  ctx.__c=codigo;
  return vm.runInContext('_politicaRollout(__c)',ctx);
}
const cfgQA=yparty=>({schema:1,stage:'owner-canary',licenses:{[key(QA)]:
  {stage:'owner-canary',approved:true,outboxV2:false,gzipWrite:false,yparty}}});

test('(a) OFF by default: no yparty field, policy down, broken JSON or unapproved entry => yparty false',async()=>{
  assert.equal((await politica(cfgQA(undefined),QA)).yparty,false);
  assert.equal((await politica(cfgQA('true'),QA)).yparty,false,'only the boolean true turns it on');
  assert.equal((await politica(null,QA)).yparty,false);
  assert.equal((await politica({schema:2},QA)).yparty,false);
  const sinAprobar=cfgQA(true);sinAprobar.licenses[key(QA)].approved=false;
  assert.equal((await politica(sinAprobar,QA)).yparty,false);
  // Existing S4/gzip semantics are unchanged by the new field.
  const p=await politica(cfgQA(undefined),QA);
  assert.deepEqual({outboxV2:p.outboxV2,gzipWrite:p.gzipWrite,stage:p.stage},{outboxV2:false,gzipWrite:false,stage:'owner-canary'});
});

test('(a) this PR ships the switch OFF for every store: no yparty entry, no licence in clear',()=>{
  const raw=fs.readFileSync(path.join(__dirname,'../docs/sync-rollout.json'),'utf8');
  const cfg=JSON.parse(raw);
  assert.equal(Object.values(cfg.licenses).filter(x=>'yparty' in x).length,0);
  assert.doesNotMatch(raw,/F123-[A-Z0-9]+-/);
});

test('(b) ON only for the QA licence hash; another licence and the global stage stay legacy',async()=>{
  assert.equal((await politica(cfgQA(true),QA)).yparty,true);
  assert.equal((await politica(cfgQA(true),OTRA)).yparty,false);
  const all={schema:1,stage:'all',allOutboxV2:true,allApproved:true,licenses:{}};
  assert.equal((await politica(all,QA)).yparty,false,'the 2.0 is never switched on globally');
});

// ---- (c) real Yjs: ON -> OFF -> ON with the actual catalog update handler ----
function cargarY(){
  // Same realm as the test values (Yjs checks plain-object constructors).
  const w={};w.window=w;w.self=w;w.globalThis=w;
  new Function('window','self','globalThis',fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'))(w,w,w);
  return w.Y;
}
const Y=cargarY();
const hs=source.indexOf('    API.doc.on("update", function (update, origin) {\n      if (API.canal.proveedor');
const he=source.indexOf('\n    });',hs);
assert.ok(hs>=0&&he>hs,'real catalog update handler must remain detectable');
function aparatoPiloto(sombra){
  const doc=new Y.Doc(),proveedor={},worker=[],legado=[];
  // The y-partyserver provider listens to the same doc (enviarUpdate is a no-op in the pilot).
  doc.on('update',(u,origin)=>{if(origin!==proveedor)worker.push(u);});
  const API={doc,bc:null,idb:null,canal:{proveedor,enviarUpdate(){}},
    canalSombra:sombra?{enviarUpdate:u=>legado.push(u)}:null};
  vm.runInNewContext(source.slice(hs,he+7),{API});
  return {doc,worker,legado};
}
function escribirNegocio(doc){
  doc.getMap('productos').set('p1',{id:'p1',nombre:'Sintetico',precio:1,stockActual:5});
  doc.getMap('fotos_refs').set('a'.repeat(64),{sha:'a'.repeat(64),bytes:10,tipo:'image/jpeg'});
  doc.getMap('hechos_financieros').set('h1',{id:'h1',tipo:'cartera_abono'});
  doc.getMap('ventas').set('v1',{id:'v1',opId:'op-1'});
  doc.getMap('_stock_pn_testigos_v1').set('t1',{opId:'op-1'});
  doc.getMap('_meta').set('nombre','Tienda sintetica');
}
const MAPAS=['productos','fotos_refs','hechos_financieros','ventas','_stock_pn_testigos_v1','_meta'];

test('(c) RED proof: WITHOUT shadow write a cold legacy device misses what an ON device wrote',()=>{
  const a=aparatoPiloto(false);escribirNegocio(a.doc);
  const frio=new Y.Doc();a.legado.forEach(u=>Y.applyUpdate(frio,u,'red'));
  for(const m of MAPAS)assert.equal(frio.getMap(m).size,0,m+' is lost when the switch goes OFF');
});

test('(c) ON -> OFF -> ON with shadow write: nothing lost, nothing duplicated',()=>{
  const a=aparatoPiloto(true);escribirNegocio(a.doc);
  assert.ok(a.worker.length>0&&a.legado.length===a.worker.length,'every local update went to BOTH transports');
  // OFF: a cold device that only has the legacy relay sees everything.
  const frio=new Y.Doc();a.legado.forEach(u=>Y.applyUpdate(frio,u,'red'));
  for(const m of MAPAS)assert.equal(frio.getMap(m).size,1,m+' survives OFF');
  assert.deepEqual(frio.getMap('productos').get('p1'),a.doc.getMap('productos').get('p1'));
  // A change made while OFF (legacy only) on the cold device...
  const offUpdates=[];frio.on('update',(u,o)=>{if(o!=='red')offUpdates.push(u);});
  frio.getMap('productos').set('p2',{id:'p2',nombre:'Sintetico 2',precio:2,stockActual:1});
  // ...and ON again: both streams replayed in any order converge with no duplicate.
  const de_nuevo=new Y.Doc();
  [...a.worker,...offUpdates,...a.legado,...a.worker].forEach(u=>Y.applyUpdate(de_nuevo,u,'red'));
  assert.equal(de_nuevo.getMap('productos').size,2);
  for(const m of MAPAS.slice(1))assert.equal(de_nuevo.getMap(m).size,1,m+' not duplicated');
  assert.deepEqual(Y.encodeStateVector(de_nuevo),Y.encodeStateVector((()=>{const d=new Y.Doc();
    [...a.legado,...offUpdates].forEach(u=>Y.applyUpdate(d,u));return d;})()));
  // Money (ops) never leaves the legacy -ops relay; a sale replayed twice is one opId.
  const ops=new Y.Doc(),u=(()=>{const d=new Y.Doc();d.getMap('eventos').set('op-1',{opId:'op-1',monto:1});return Y.encodeStateAsUpdate(d);})();
  Y.applyUpdate(ops,u);Y.applyUpdate(ops,u);
  assert.equal(ops.getMap('eventos').size,1);
});

// ---- (d) Worker down with ON => legacy relay within 7.5 s ----
function harness(){
  const timers=[],fallbacks=[],providers=[];
  class FakeProvider{constructor(){this.synced=false;this.ev={};this.awareness={destroy(){}};providers.push(this);}
    on(n,f){(this.ev[n]||=[]).push(f);}off(){}connect(){return Promise.resolve(true);}disconnect(){}destroy(){this.destroyed=true;}
    emit(n,v){(this.ev[n]||[]).forEach(f=>f(v));}}
  const ctx={window:{OCSecure:{leerPinQueAbre:()=>({owner:'123'})},OCAuth:{rolActual:()=>'dueno'},Y:{}},
    document:{hidden:false,addEventListener(){},removeEventListener(){}},
    localStorage:{getItem:()=>JSON.stringify({licenseCode:QA,instanceId:'synthetic-instance'})},
    crypto:crypto.webcrypto,Uint8Array,Array,Promise,JSON,
    setTimeout(fn,delay){timers.push({fn,delay,cancelled:false});return timers.length;},
    clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true;},
    AuthorizedYProvider:FakeProvider,createOwnerTicketParams:()=>async()=>({})};
  const src=fs.readFileSync(path.join(__dirname,'../src/yparty-piloto.js'),'utf8');
  vm.runInNewContext(src.split('\n').filter(l=>!/^import /.test(l)).join('\n'),ctx);
  const doc={store:{pendingStructs:null,pendingDs:null},isDestroyed:false,on(){},once(){},off(){}};
  const canal=ctx.window.F123YPartyPilot('a'.repeat(32),QA).canal(doc,'cat',{synced:true,once(){}},()=>{},()=>fallbacks.push('relay'));
  return {canal,timers,fallbacks,providers};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('(d) fail-closed Owner catalog uses encrypted legacy immediately without contacting Worker',async()=>{
  const h=harness();h.canal.conectar();await tick();
  assert.deepEqual(h.fallbacks,['relay'],'existing encrypted relay remains usable');
  assert.equal(h.providers.length,0,'never give sensitive Y.Doc to unsealed Worker');
  assert.equal(h.canal.proveedor,null);
  assert.equal(h.timers.some(t=>!t.cancelled&&t.delay>0),false,'no timeout waiting for an unsafe Worker');
});

test('(d) repeated explicit reconnect is fail-closed; foreground cannot create competing catalog writer',async()=>{
  const h=harness();h.canal.conectar();await tick();
  h.canal.conectar();await tick();
  assert.equal(h.providers.length,0,'no unencrypted catalog connection after retry');
  assert.deepEqual(h.fallbacks,['relay','relay'],'each explicit attempt is routed back to encrypted legacy');
  assert.equal(h.canal.proveedor,null);
});
