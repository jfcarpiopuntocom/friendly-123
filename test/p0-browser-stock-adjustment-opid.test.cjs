'use strict';
// C111 P0: one browser stock intent, ONE causal effect even when a strict
// IndexedDB commit happened but its ACK was reported as lost during CAS rebase.
// Executes real docs/mock-backend.js via the production offline-browser fixture.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const URL='/api/productos/p24/ajustar';
const OP='adjust-20261120-exactlyonce-000001';
const read=w=>w.request('/api/respaldo/exportar');
const post=(w,delta,opId=OP)=>w.fetch(URL,{method:'POST',body:JSON.stringify({delta,motivo:'synthetic CAS ABA',opId})});
const clone=x=>JSON.parse(JSON.stringify(x));
function product(s){return s.productos.find(x=>x.id==='p24');}
function movements(s,opId=OP){return (s.movimientos||[]).filter(m=>m&&m.detalle&&m.detalle.opId===opId);}

test('C111 RED: exact same manual adjustment opId is idempotent across HTTP retries, including after a durable save',async()=>{
 const w=browser();
 w.localStorage.setItem('f123_device_id','synthetic-C111-writer');
 const sends=[];w.OCSyncEmit=(tipo,payload)=>{if(tipo==='ajuste'&&payload?.opId===OP)sends.push(clone(payload));return true;};
 const before=await read(w), prior=product(before);
 const one=await post(w,-1); assert.equal(one.status,200);
 const mid=await read(w);
 assert.equal(product(mid).stockActual,prior.stockActual-1);
 assert.equal(movements(mid).length,1,'signed movement must preserve explicit opId');
 const again=await post(w,-1);
 assert.equal(again.status,200,'same opId should return original successful intent, not another -1');
 const duplicate=await again.json();
 assert.equal(duplicate.duplicate,true,'replayed request must be labeled duplicate');
 const after=await read(w);
 assert.equal(product(after).stockActual,prior.stockActual-1,'one -1 is exactly one stock change');
 assert.equal(after.movimientos.length,mid.movimientos.length,'no second signed movement');
 assert.equal(movements(after).length,1);
 assert.equal(sends.length,2,'a replay is permitted to republish its original exact opId for recovery');
 assert.deepEqual(sends[1],sends[0],'republish is byte-equivalent stock fact, never a new PN effect');
});

test('C111 RED: reusing a durable adjustment opId for another amount is a 409, with zero new effects',async()=>{
 const w=browser();
 const first=await post(w,+1);
 assert.equal(first.status,200);
 const before=await read(w);
 const response=await post(w,-2);
 assert.equal(response.status,409,'opId collision cannot authorize another movement');
 const after=await read(w);
 assert.deepEqual(product(after),product(before));
 assert.equal(after.movimientos.length,before.movimientos.length);
});

test('C111 RED: CAS commit actually persisted but ACK was false: transparent rebase must not apply delta twice',async()=>{
 const w=browser();
 w.localStorage.setItem('f123_device_id','synthetic-C111-false-ack');
 const before=await read(w), original=product(before).stockActual;
 let disk=null,attempts=0,reads=0,sends=0;
 const setOriginal=w.localStorage.setItem;
 w.localStorage.setItem=()=>{throw Error('synthetic A/B unavailable; strict IDB only');};
 w.OCSyncEmit=(tipo,p)=>{if(tipo==='ajuste'&&p?.opId===OP)sends++;return true;};
 w.OCEstadoIDB={
   soportado:true,
   ultimoError:()=>null,
   async guardarConRevision(candidate,_prior){ attempts++;disk=clone(candidate);return attempts>1; },
   async leer(){reads++;return clone(disk);}
 };
 let response;
 try{response=await post(w,-1);}finally{w.localStorage.setItem=setOriginal;delete w.OCEstadoIDB;}
 assert.equal(response.status,200,'committed intent must be recognized on CAS rebase');
 assert.ok(reads>=1,'must read newer durable revision before replay');
 assert.ok(disk,'IDB must contain first transaction despite ambiguous ACK');
 assert.equal(product(disk).stockActual,original-1,'first successful disk commit is not applied twice');
 assert.equal(movements(disk).length,1,'same operation has exactly one signed fact');
 assert.equal(attempts,1,'idempotent rebase needs no second strict commit');
 assert.ok(sends<=1,'same opId is never published as two distinct movements');
});

test('C111 browser quantity box supplies one stable cryptographic opId to the actual POST',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const ui=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
 const a=ui.indexOf('  async function ajustarConCajita(id) {'),b=ui.indexOf('  // Estrella:',a);
 assert.ok(a>0&&b>a,'must test actual product source');
 const sent=[];
 const ctx={
   crypto:{randomUUID:()=> '11111111-2222-4333-8444-555555555555'},
   API:'/api',JSON,Promise,
   t:key=>key,
   pedirCantidadStock:async()=>({modo:'agregar',n:4}),
   pedirMotivoAjuste:async()=> 'synthetic counted addition',
   fetch:async(url,opts)=>{sent.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({})};},
   ocAlert:async()=>{throw Error('unexpected alert')},
   cargarInventario:async()=>{}
 };
 vm.runInNewContext(ui.slice(a,b)+'\nthis.run=ajustarConCajita;',ctx);
 await ctx.run('p24');
 assert.equal(sent.length,1);
 assert.equal(sent[0].url,'/api/productos/p24/ajustar');
 assert.equal(sent[0].body.delta,4);
 assert.equal(sent[0].body.opId,'adj-11111111-2222-4333-8444-555555555555');
});
