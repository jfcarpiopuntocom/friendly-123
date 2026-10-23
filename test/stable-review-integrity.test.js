'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');

test('E1b-3: failed session claim notifies listeners AFTER pending clears',async()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../docs/tab-session.js'),'utf8');
  const begin=src.indexOf(' async function claim(){');
  const end=src.indexOf("\n try{channel=new BroadcastChannel(",begin);
  assert.ok(begin>=0&&end>begin,'extract actual claim() production code');
  const changes=[];
  const state={
    window:{OC_AUTH_SESSION_EPOCH:0},
    localStorage:{getItem:()=>null},
    TextEncoder,crypto:{subtle:{digest:async()=>{throw Error('Synthetic digest failure')}}},
    pending:false,claimed:false,suspendida:false,scopeKey:'',
    clearPanel(){},epoch(){this.OC_AUTH_SESSION_EPOCH=(this.OC_AUTH_SESSION_EPOCH||0)+1;},
    avisarSync(){changes.push(state.pending);}
  };
  // epoch reads the global window, as in the actual production closure.
  state.epoch=()=>{state.window.OC_AUTH_SESSION_EPOCH++;};
  vm.createContext(state);
  vm.runInContext(src.slice(begin,end)+'\nthis.claim=claim;',state);
  await state.claim();
  assert.equal(state.pending,false,'failed claim is not left pending');
  assert.deepEqual(changes,[true,false],
    'listeners must get the restored state, otherwise all Yjs channels remain paused');
});

test('E4: Yjs authoritative owner name converges on equal revision despite local future clock',()=>{
  const device=browser();
  const apply=(name,rev,ts,yjs=false)=>device.OCSync.aplicarCatalogo({
    ubicaciones:[],productos:[],nombreNegocio:name,nombreNegocioRev:rev,nombreNegocioTs:ts,
    ...(yjs?{_nombreDesdeYjs:true}:{})
  },'dueno');
  apply('My small shop USA',7,999999);
  assert.equal(device.catalog().nombreNegocio,'My small shop USA');
  apply('17 de Septiembre',7,1000,true);
  assert.equal(device.catalog().nombreNegocio,'17 de Septiembre',
    'shared Yjs owner name must win equal revision; no local timestamp authority');
  // Real Yjs bridge retains this canonical metadata during legacy broadcasts.
  device.OCYjs={meta:{get:key=>key==='nombreNegocio'?'17 de Septiembre':key==='nombreRev'?7:null}};
  apply('My small shop USA',7,9999999);
  assert.equal(device.catalog().nombreNegocio,'17 de Septiembre',
    'legacy equal-revision timestamps cannot resurrect old names');
  apply('Explicit newer owner rename',8,1001);
  assert.equal(device.catalog().nombreNegocio,'Explicit newer owner rename');
  const sync=fs.readFileSync(path.resolve(__dirname,'../docs/sync-yjs.js'),'utf8');
  assert.match(sync,/_nombreDesdeYjs:\s*true/,
    'Yjs bridge must mark metadata as owner-authoritative');
});


test('E1: legacy v1 checkpoint HEAD behind stored cursor replays checkpoint ONCE, not stale empty pages forever', async () => {
  const source=fs.readFileSync(path.resolve(__dirname,'../docs/sync-yjs.js'),'utf8');
  const start=source.indexOf('    function pedirPagina(sock, estado, sinHead) {');
  const end=source.indexOf('    function reprogramar() {',start);
  assert.ok(start>=0&&end>start,'extract production HEAD/pull protocol');
  const sent=[];
  const ws={readyState:1,send(s){sent.push(JSON.parse(s));}};
  const ctx={
    canal:{ws,recuperando:true},_pullCursorReady:Promise.resolve(),
    _pullCursor:{rev:3,seq:10},_appliedPullCursor:{rev:3,seq:10},
    _soloMemoria:false,_replayKey:'missing',_replayUsed:4,PULL_PAGE_SIZE:64,
    _legacyProbeKey:'',_legacyProbeAttempts:0,
    clearTimeout(){},setTimeout(){return 1;},programarRelectura(){},
    partesEntrantes:{},doc:{store:{}},API:{},nombre:'catalogo',console
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end)+'\nthis._head=procesarHead;',ctx);
  const state={esperandoHead:true,enCurso:true,usarHead:true,validacionFinal:true,tHead:0};
  await ctx._head(ws,state,{rev:3,seq:0});await Promise.resolve();
  assert.equal(sent.length,1,'one bounded recovery request after detecting checkpoint rewind');
  assert.equal(sent[0].k,'pull');
  assert.equal(sent[0].rev,-1,'re-request ciphertext checkpoint from the beginning, never stale rev3/seq10');
  assert.equal(sent[0].seq,0);
  assert.equal(state.rebaseCursor,true,'record that next successfully applied checkpoint must rebase durable cursor');
  assert.equal(ctx._pullCursor.seq,10,'do not drop the proven cursor before ciphertext is applied');
});


test('E1 v1 checkpoint repair has a fixed per-channel quota across reconnects',async()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../docs/sync-yjs.js'),'utf8');
  const a=src.indexOf('    function pedirPagina(sock, estado, sinHead) {');
  const b=src.indexOf('    function reprogramar() {',a);
  assert.ok(a>=0&&b>a,'actual production HEAD/recovery logic');
  const sent=[];
  const ws={readyState:1,send(raw){sent.push(JSON.parse(raw));}};
  const ctx={canal:{ws,recuperando:true},_pullCursorReady:Promise.resolve(),
    _pullCursor:{rev:3,seq:10},_appliedPullCursor:{rev:3,seq:10},
    _legacyProbeKey:'',_legacyProbeAttempts:0,
    _soloMemoria:false,_replayKey:null,_replayUsed:0,PULL_PAGE_SIZE:64,
    clearTimeout(){},setTimeout(){return 1;},programarRelectura(){},
    partesEntrantes:{},doc:{store:{}},API:{},nombre:'catalogo',log(){}};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a,b)+'\nthis._head=procesarHead;',ctx);
  const head=async(seq)=>{
    const state={esperandoHead:true,enCurso:true,usarHead:true,validacionFinal:true,tHead:0};
    await ctx._head(ws,state,{rev:3,seq});await Promise.resolve();
    return state;
  };
  await head(0);await head(0);
  const stopped=await head(0);
  assert.equal(sent.length,2,'unchanged HEAD must never trigger a third full history request');
  assert.equal(stopped.enCurso,false,'leave websocket online, no reconnect storm');
  assert.equal(ctx._pullCursor.seq,10,'failed checkpoint probes must not erase proven cursor');
  assert.equal(ctx._legacyProbeAttempts,2,'budget survives new socket states');
  await head(1);
  assert.equal(sent.length,3,'only a truly changed HEAD allows fresh recovery');
});

test('E4 legacy owner timestamp tie-break survives until shared Yjs is canonical',()=>{
  const device=browser();
  const apply=(name,rev,ts,yjs=false)=>device.OCSync.aplicarCatalogo({
    ubicaciones:[],productos:[],nombreNegocio:name,nombreNegocioRev:rev,nombreNegocioTs:ts,
    ...(yjs?{_nombreDesdeYjs:true}:{})
  },'dueno');
  apply('Old store',4,1000);
  apply('Legit non-Yjs owner rename',4,2000);
  assert.equal(device.catalog().nombreNegocio,'Legit non-Yjs owner rename');
  device.OCYjs={meta:{get:key=>key==='nombreNegocio'?'Legit non-Yjs owner rename':key==='nombreRev'?4:null}};
  apply('Stale future-clock legacy store',4,9999999);
  assert.equal(device.catalog().nombreNegocio,'Legit non-Yjs owner rename',
    'known canonical Yjs name beats equal-revision legacy wall clocks');
  apply('Yjs owner canonical',4,500,true);
  assert.equal(device.catalog().nombreNegocio,'Yjs owner canonical');
  apply('Explicit newer revision',5,501);
  assert.equal(device.catalog().nombreNegocio,'Explicit newer revision');
});

test('E1 S1: only the extra verified checkpoint permits cursor rebase',async()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../docs/sync-yjs.js'),'utf8');
  const start=src.indexOf('else if (c && c.k === "pull-page") {');
  const end=src.indexOf('else if (c && c.k === "tsr"',start);
  assert.ok(start>=0 && end>start,'actual pull-page production handler found');
  const snippet=src.slice(start,end).trim().replace(/^else if/,'if');
  assert.equal((src.match(/source === "pull" && pullEstado.rebaseCursor && ok/g)||[]).length,2,
    'both ArrayBuffer and Blob paths count validated durable frames, not live traffic');
  async function scenario(n,applied,encrypted){
    const writes=[],closes=[];
    const socket={readyState:1,close(code,reason){closes.push({code,reason});}};
    const ctx={_colaRecepcion:Promise.resolve(),ws:socket,canal:{ws:socket,recuperando:true},
      pullEstado:{enCurso:true,rebaseCursor:true,rebaseFrames:applied,rebaseCipherFrames:encrypted,fallos:0},
      _pullCursor:{rev:3,seq:10},_appliedPullCursor:{rev:3,seq:10},
      _ultimoCursorLimpio:{rev:3,seq:10},_legacyProbeKey:'3:0:3:10',_legacyProbeAttempts:2,
      guardarPullCursor:async(c)=>{writes.push(c);},pedirPagina(){},
      programarRelectura(){},deudaPendiente:()=>true,API:{},nombre:'catalogo',log(){},_soloMemoria:false};
    vm.createContext(ctx);
    vm.runInContext('this.page=function(c){'+snippet+'}',ctx);
    ctx.page({k:'pull-page',v:2,rev:3,seq:1,n,more:true});
    await ctx._colaRecepcion;
    return {writes:writes.length,closes:closes.length,
      rev:ctx._pullCursor.rev,seq:ctx._pullCursor.seq,
      attempts:ctx._legacyProbeAttempts};
  }
  const noCheckpoint=await scenario(1,1,1);
  assert.equal(noCheckpoint.writes,0,'ordinary op cannot masquerade as checkpoint');
  assert.equal(noCheckpoint.closes,1,'fail closed without extra checkpoint ciphertext');
  assert.equal(noCheckpoint.seq,10,'preserve proven local cursor');
  assert.equal(noCheckpoint.attempts,2,'do not reset quota after failed proof');
  const good=await scenario(1,2,2);
  assert.equal(good.writes,1,'real checkpoint + 1 op can advance');
  assert.equal(good.closes,0);
  assert.equal(good.rev,-1,'rewind only after proven checkpoint');
  const checkpointOnly=await scenario(0,1,1);
  assert.equal(checkpointOnly.writes,1,'checkpoint with 0 ops is valid');
  const fragmented=await scenario(3,2,4);
  assert.equal(fragmented.writes,1,'fragmented Yjs operations still count as 3 ciphertext rows');
  for (const invalid of [undefined,null,'0',-1,1.1]){
    const unsafe=await scenario(invalid,1,1);
    assert.equal(unsafe.writes,0,'invalid operation count cannot prove checkpoint');
    assert.equal(unsafe.seq,10,'invalid reply must preserve proven cursor');
  }
});
