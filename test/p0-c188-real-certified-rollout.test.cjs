'use strict';
// C188: source-executed proofs for the live friendly-123 1.0 -> 2.0
// assembly. No real PIN, license, customer data, sockets or Cloudflare writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const conf=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/sync-rollout.json'),'utf8'));

function extract(start,end){
 const i=src.indexOf(start),j=src.indexOf(end,i);
 assert.ok(i>=0&&j>i,'missing original production implementation');
 return src.slice(i,j);
}
const cutover=extract('      API.activarCorte20Runtime = async function (opc) {','\n      function _desarmarCorte20PorAuth(');
const loader=extract('  async function cargarPiloto(codigo, rollout) {','\n  // Carga perezosa del bundle');
const frozenHelper=extract('  function _cabezaCongeladaQa(rollout) {','\n  function origenCatalogoRemoto(');

function makeCutover({state='apagado',room=null,pending=false}={}){
 const history=[];
 const control={
  estado:()=>state,salaActiva:()=>room,durabilidadPendiente:()=>pending,
  onEstado:()=>history.push('listener')
 };
 const API={
  doc:{private:true},rollout:{yparty:true,frozenHead:'certified-c188-head'},
  async crearCoordinadorCorte20(doc,head) {
   assert.equal(doc,API.doc,'must retain the private local notebook');
   assert.equal(head,'certified-c188-head','must use actual per-license certificate');
   const coord={
    async activate20(){history.push('activate20');return {ok:true};},
    async failbackToLegacy(){history.push('failback');return {ok:true};}
   };
   API.coordinadorCorte20=coord;return coord;
  },
  cambiarRolComercial20(role){return {rol:role,fotoSha:null,corteFotosShaActivo:false};}
 };
 const window={OCSync:{aplicarOpRemota(){}},OCSyncControl:control,OCAuth:{rolActual:()=> 'dueno'}};
 const fn=new Function('API','window','_cabezaCongeladaQa',cutover+'\nreturn API.activarCorte20Runtime;');
 const activate=fn(API,window,()=>API.rollout.frozenHead);
 return {activate,API,history,window};
}
test('C188 real control facade OFF+empty permits certified 2.0; backend OCSync has no transport status',async()=>{
 const f=makeCutover();
 const res=await f.activate({activarDespachoComercial:true});
 assert.equal(res.modoCorte20Activo,true);
 assert.deepEqual(f.history,['activate20','listener']);
 assert.equal(f.API.coordinadorCorte20!==null,true);
});
test('C188 never activates 2.0 while old websocket, notebook, or durable outbox remains',async()=>{
 for(const state of [
  {state:'conectado',room:'F123-SYNTH-C188',pending:false},
  {state:'apagado',room:null,pending:true},
  {state:'apagado',room:'F123-SYNTH-C188',pending:false}
 ]){
  const f=makeCutover(state);
  await assert.rejects(f.activate({activarDespachoComercial:true}),/legacy relay/);
  assert.equal(f.API.modoCorte20Activo,false);
  assert.deepEqual(f.history,[],'no second catalog/money writer was started');
 }
});
test('C188 released frozen certificate overrides a stale QA-only localStorage head',()=>{
 const helper=new Function('localStorage',frozenHelper+'\nreturn _cabezaCongeladaQa;')({
  getItem:()=> 'stale-local-qa-head'
 });
 assert.equal(helper({yparty:true,frozenHead:'trusted-deployed-c188-head'}),'trusted-deployed-c188-head');
 assert.equal(helper({yparty:false}),'stale-local-qa-head');
});
test('C188 certified per-license rollout loads real 2.0 pilot without manual QA flags; other stores do not',async()=>{
 const license='F123-SYNTH-C188-OWNER';
 const expected=crypto.createHash('sha256').update('f123-yparty-v1:'+license).digest('hex').slice(0,32);
 const scripts=[];
 const document={
  createElement:()=>({remove(){}}),
  head:{appendChild(node){scripts.push(node);queueMicrotask(()=>node.onload());}}
 };
 const window={F123YPartyPilot:(room,code)=>({room,code})};
 const load=new Function('crypto','TextEncoder','localStorage','document','window','setTimeout','clearTimeout',
  loader+'\nreturn cargarPiloto;')(
   crypto.webcrypto,TextEncoder,{getItem:()=>null},document,window,setTimeout,clearTimeout
  );
 assert.equal(await load(license,{yparty:false,frozenHead:null}),null);
 assert.equal(scripts.length,0);
 const pilot=await load(license,{yparty:true,frozenHead:'trusted-deployed-c188-head'});
 assert.equal(pilot.room,expected);
 assert.equal(pilot.code,license);
 assert.equal(scripts.length,1);
 assert.equal(await load(license,{yparty:true,frozenHead:'INVALID HEAD WITH SPACE'}),null);
 assert.equal(scripts.length,1,'malformed certificate never opens a provider');
});
test('C188 existing global S4 stays unchanged, only one hashed owner license has explicit 2.0',()=>{
 assert.equal(conf.stage,'all');
 assert.equal(conf.allOutboxV2,true);
 assert.equal(conf.allApproved,true);
 const items=Object.entries(conf.licenses).filter(([k,v])=>v.yparty===true);
 assert.equal(items.length,1);
 assert.match(items[0][0],/^[a-f0-9]{64}$/);
 assert.match(items[0][1].frozenHead,/^[A-Za-z0-9_.:-]{3,128}$/);
 assert.doesNotMatch(JSON.stringify(conf),/F123-[A-Z0-9]{6}/);
});


test('C190: 2.0 tombstones allow safe resume after reload; no old-ledger duplicate and no queue erase',async()=>{
 const rt=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
 function cut(a,b){const i=rt.indexOf(a),j=rt.indexOf(b,i);assert.ok(i>0&&j>i,a);return rt.slice(i,j);}
 const functions=cut('  let _pausaArquitectura20 = null;','  function notificarEstado(');
 const methods=cut('    async pausarParaArquitectura20(licencia) {','    resincronizar() {');
 const factory=new Function('t',[
  'const pending=t.queue;',
  'const window={OCYjs:{codigoCuaderno:t.license,__port2DurableFenceAvailable:true,',
  'crearAlmacenDurableOpsTipadas:async()=>{if(t.storeFail)throw Error("IDB");return {loadCommittedOpIds:async()=>t.committed}},',
  'puedeDespacharOpEnLegado:async opId=>!t.committed.includes(opId)},addEventListener(name,fn){t.listeners[name]=fn}};',
  'const document={get hidden(){return t.hidden}};',
  'const codigoCuadernoActivo=()=>t.license;',
  'const normalizarCodigo=x=>String(x||"").trim().toUpperCase();',
  'const leerSala=()=>t.room;',
  'const colaLargo=()=>pending.length;',
  'const leerCola=()=>pending.slice();',
  'const pendientesCanales={};',
  'const notificarEstado=x=>t.states.push(x);',
  'let estadoActual="conectado";',
  'const cerrarWsExistente=()=>{t.closed++};',
  'const conectar=()=>{t.connected++};',
  'const reintentarDurable=()=>{t.retries++};',
  'let _conexionGeneracion=0,reintentoMs=1000;',
  functions,
  'const control={'+methods+'};',
  'return {control,can:puedeEnviarPorLegado,pending:tienePendientesDurables,getPause:()=>_pausaArquitectura20};'
 ].join('\n'));
 const mk=(changes={})=>({
  license:'F123-SYNTH-OWNER',room:{codigo:'F123-SYNTH-OWNER'},
  queue:[{opId:'abc123456789',_salaOrigen:'F123-SYNTH-OWNER'}],
  committed:['abc123456789'],storeFail:false,hidden:false,
  states:[],listeners:{},closed:0,connected:0,retries:0,...changes
 });
 // A DO-committed operation can remain in the OLD queue for audit.
 const A=mk(),f=factory(A);
 assert.deepEqual(await f.control.pausarParaArquitectura20(A.license),{ok:true});
 assert.equal(f.pending(),false);
 assert.equal(f.getPause(),A.license);
 assert.equal(A.closed,1);
 assert.equal(A.queue.length,1,'no queue deletion');
 assert.equal(await f.can(A.queue[0]),false,'never transmit committed opId on old relay');
 assert.deepEqual(f.control.reanudarDesdeArquitectura20(A.license),{ok:true});
 assert.equal(A.connected,1);
 assert.equal(A.queue.length,1);
 // A fresh operation still awaiting the DO is not disposable.
 const B=mk({committed:[]}),g=factory(B);
 assert.deepEqual(await g.control.pausarParaArquitectura20(B.license),{ok:false});
 assert.equal(B.closed,0);
 assert.equal(g.pending(),true);
 assert.equal(B.queue.length,1);
 // Corrupt/unavailable IDB is a hard refusal, preserving the journal.
 const C=mk({storeFail:true}),h=factory(C);
 assert.deepEqual(await h.control.pausarParaArquitectura20(C.license),{ok:false});
 assert.equal(C.queue.length,1);
 // The receipt is emitted only after the reconciler atomically marks committed.
 const D=mk({committed:[]}),q=factory(D);
 D.listeners['oc-op-20-recibo']({detail:{committed:true,stage:'business-committed',opId:'abc123456789'}});
 assert.equal(q.pending(),false);
 assert.equal(D.queue.length,1);
 // Actual old writer paths must consult the same durable same-DO fence.
 assert.match(rt,/async function vaciarCola\(\)[\s\S]*?await puedeEnviarPorLegado\(op\)/);
 assert.match(rt,/async function responderCatchup\(pedido\)[\s\S]*?await puedeEnviarPorLegado\(op\)/);
 assert.match(rt,/cifrar\(claveActual, op\)\s*\.then\(async \(buf\) => \{\s*if \(!\(await puedeEnviarPorLegado\(op\)\)\) return;/);
});
