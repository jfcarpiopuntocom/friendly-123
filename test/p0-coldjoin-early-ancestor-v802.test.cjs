'use strict';
// P0 Qwen/Gemini audit · Source-executed cold join boundary.
// NO network, license, real shop or plaintext customer data.
// Test first against the unmodified v801 path: an orphan after a nonfinal
// Firebase page must initiate the bounded precheckpoint probe BEFORE the tail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const first = src.indexOf('      ws.onmessage = function (ev) {', src.indexOf('function crearCanal('));
const last = src.indexOf('      _directReceive = function (buf) {', first);
assert.ok(first > 0 && last > first, 'test must execute the actual published receive handler');
const handler = src.slice(first, last);

async function scenario({missing=true, relay='f123_relay_cupo_fb_v1', rev=2, attempted=false,
                        fragments=false, more=true}={}) {
  const requests = [];
  const ws = {readyState: 1, relayLayer: relay};
  const state = {enCurso:true, fallos:0, usarHead:true, rescatePaginas:0,
    rescateCausalDesde:null, validacionFinal:false};
  const missingMap = new Map(missing ? [[12345, 0]] : []);
  const doc = {store:{pendingStructs:missing ? {missing:missingMap} : null,pendingDs:null}};
  const ctx = {
    ws, canal:{ws,recuperando:true},pullEstado:state,
    _pullCursorReady:Promise.resolve(),_colaRecepcion:Promise.resolve(),
    _pullCursor:{rev,seq:0},partesEntrantes:fragments ? {unfinished:{}} : {},
    doc, nombre:'catalogo',_antecedentesBuscados:attempted, _soloMemoria:false,
    _tReplay:null, _currentPullState:state,
    _replayKey:null,_replayUsed:0, _ultimoCursorLimpio:{rev:0,seq:0},
    Y:{encodeStateVector:()=>new Uint8Array([7])},
    API:{clave:{},_store:{aplicar(){}}},
    Promise,JSON,Object,Number,Math,Date,Array,Map,Uint8Array,ArrayBuffer, Blob,
    TextEncoder, TextDecoder,
    guardarPullCursor:async page=>{
      // The production routine advances the in-memory cursor before deciding
      // whether to persist a causally clean cut.
      ctx._pullCursor = {rev:Number(page.rev),seq:Number(page.seq)};
    },
    pedirPagina:(_sock, s, sinHead)=>{
      const from = s.rescateCausalDesde || ctx._pullCursor;
      requests.push({rev:from.rev,seq:from.seq,sinHead,until:s.rescateCausalHasta});
      return Promise.resolve();
    },
    confirmarDurable(){}, manejar:async()=>true,
    deudaPendiente:()=>!!doc.store.pendingStructs || !!doc.store.pendingDs,
    programarRelectura(){}, checkpointTrasPull(){},
    log(){}, clearTimeout(){},setTimeout(){return 1;},
    window:{}
  };
  vm.createContext(ctx);
  vm.runInContext(handler + '\nthis.queue=()=>_colaRecepcion;', ctx);
  ws.onmessage({data:JSON.stringify({k:'pull-page',rev,seq:191,more,n:191})});
  await ctx.queue();
  return {requests, state, ctx};
}

test('RED: first non-final Firebase tail page with causal orphan starts earlier ciphertext pull', async()=>{
 const {requests,state,ctx}=await scenario();
 assert.equal(requests.length,1,'one bounded historical pull, not a page storm');
 assert.deepEqual([requests[0].rev,requests[0].seq],[2,0],
   'request precheckpoint seq=0 BEFORE asking the next forward page');
 assert.equal(requests[0].sinHead,true,'use encrypted historical pull, never certify HEAD');
 assert.equal(ctx._antecedentesBuscados,true,'one ancestor probe per channel');
 assert.deepEqual([state.rescateCausalHasta.rev,state.rescateCausalHasta.seq],[2,191],
   'freeze the observed cut to avoid losing unrelated older writers');
 assert.equal(ctx.canal.recuperando,true,'missing Yjs parent must not unlock business/PIN');
});

test('clean non-final page retains ordinary monotonic forward pagination',async()=>{
 const {requests,state,ctx}=await scenario({missing:false});
 assert.equal(requests.length,1);
 assert.deepEqual([requests[0].rev,requests[0].seq],[2,191]);
 assert.equal(state.rescateCausalDesde,null);
 assert.equal(ctx._antecedentesBuscados,false);
});
test('never probe early on other relay, genesis, second attempt or pending fragments',async()=>{
 for(const settings of [{relay:'other'},{rev:0},{attempted:true},{fragments:true}]){
  const {requests,state}=await scenario(settings);
  assert.equal(requests.length,1,'ordinary replay still advances '+JSON.stringify(settings));
  assert.equal(requests[0].seq,191,'no unsafe ancestor rollback '+JSON.stringify(settings));
  assert.equal(state.rescateCausalDesde,null,'do not duplicate or widen a prior probe');
 }
});
test('final page remains controlled by existing HEAD-before-ancestor guard',async()=>{
 const {requests,ctx}=await scenario({more:false});
 assert.equal(ctx._antecedentesBuscados,false,'do not preempt the final HEAD proof');
 assert.ok(requests.length >= 0);
});
