'use strict';
// C38: exact-source proof that QA-only C21a business activation CANNOT run
// concurrently with the existing legacy WebSocket business transport.
// No customer data, no Cloudflare writes, no mock business receipt.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const realtime=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const a=src.indexOf('      API.activarCorte20Runtime = async function (opc) {');
const end='\n      };';
const b=src.indexOf(end,a)+end.length;
assert.ok(a>0 && b>a,'real product QA cutover activation source present');
assert.ok(realtime.includes('async function vaciarCola()') &&
  realtime.includes('ws.send(buf); _persistirOpBuf(op, buf)') &&
  realtime.includes('window.OCSyncEmit = function (tipo, payload) {'),
  'C38 must inspect actual old writer risk (both queued and direct socket)');
const actualAssignment=src.slice(a,b);

function fixture({estado='apagado',sala=null,pending=false,throws=false,withFacade=true,
                   onActivate=()=>{}, missingWatcher=false}={}){
  const trace=[];let listener=null;
  const legacy={
    estado(){ if(throws)throw new Error('legacy state unavailable');return estado; },
    salaActiva(){ return sala; },
    durabilidadPendiente(){ return pending; },
    ...(missingWatcher?{}:{onEstado(fn){listener=fn;}})
  };
  const window={
    ...(withFacade?{OCSync:legacy}:{}),
    OCAuth:{rolActual:()=> 'dueno'}
  };
  let coordinator=null;
  const API={
    doc:{synthetic:true},modoCorte20Activo:false,rolComercial20Activo:null,
    fotoSha:null,corteFotosShaActivo:false,
    async crearCoordinadorCorte20(){
      trace.push('create-coordinator');
      coordinator={
        async activate20(){trace.push('activate20');await onActivate({setState,trace});return {ok:true};},
        async failbackToLegacy(reason){trace.push('failback:'+reason);return {ok:true};},
        destroy(){trace.push('destroy');}
      };
      API.coordinadorCorte20=coordinator;
      return coordinator;
    },
    cambiarRolComercial20(role){
      trace.push('role:'+role);
      API.rolComercial20Activo=role;
      return {rol:role,fotoSha:null,corteFotosShaActivo:false,
        modoCorte20Activo:API.modoCorte20Activo};
    }
  };
  const setState=({nextEstado=estado,nextSala=sala,nextPending=pending}={})=>{
    estado=nextEstado;sala=nextSala;pending=nextPending;
  };
  const factory=new Function('API','window','headCongeladoQa',
    actualAssignment+'\nreturn API.activarCorte20Runtime;');
  const activate=factory(API,window,'synthetic-head');
  return {activate,API,trace,window,setState,
    emitState(){if(listener)listener(estado);},
    watcherRegistered(){return !!listener},
    getCoordinator(){return coordinator}
  };
}
async function rejectWithoutWriter(f,reason){
  await assert.rejects(f.activate({activarDespachoComercial:true,rol:'dueno'}),err=>
    err instanceof Error && /legacy|relay|transporte|corte|escritor/i.test(err.message));
  assert.equal(f.API.modoCorte20Activo,false,'not allowed to certify 2.0');
  assert.equal(f.trace.includes('activate20'),false,'legacy writers rejected BEFORE opening C25 catalog writer');
}
test('C38 RED: live 1.0 socket or joined room blocks simultaneous C21a active-2.0',async()=>{
  await rejectWithoutWriter(fixture({estado:'conectado',sala:'F123-SYNTH-REAL'}));
  await rejectWithoutWriter(fixture({estado:'offline',sala:'F123-SYNTH-REAL'}));
});
test('C38: old relay intentionally OFF but unacknowledged old local outbox blocks cutover',async()=>{
  await rejectWithoutWriter(fixture({estado:'apagado',sala:null,pending:true}));
});
test('C38: old relay state unreadable or missing change observer blocks unsafe cutover',async()=>{
  await rejectWithoutWriter(fixture({throws:true}));
  await rejectWithoutWriter(fixture({withFacade:false}));
  await rejectWithoutWriter(fixture({estado:'apagado',missingWatcher:true}));
});
test('C38: fully quiesced legacy OFF + empty queue permits certified cutover, photo-only still works',async()=>{
  const off=fixture();
  const result=await off.activate({activarDespachoComercial:true,rol:'dueno'});
  assert.equal(result.modoCorte20Activo,true);
  assert.equal(off.API.modoCorte20Activo,true);
  assert.equal(off.watcherRegistered(),true,'listen for legacy relay reactivation');
  const photo=fixture({estado:'conectado',sala:'F123-SYNTH-REAL'});
  const photoOnly=await photo.activate({activarDespachoComercial:false,rol:'dueno'});
  assert.equal(photoOnly.modoCorte20Activo,false,'photo-only QA never arms business 2.0');
});
test('C38: legacy starts while C21a waits for activation; abort business cutover and failback',async()=>{
  const f=fixture({onActivate:async({setState})=>{
    setState({nextEstado:'conectado',nextSala:'F123-SYNTH-REAL'});
  }});
  await assert.rejects(f.activate({activarDespachoComercial:true}),/legacy|relay|transporte|corte|escritor/i);
  assert.equal(f.API.modoCorte20Activo,false);
  assert.ok(f.trace.some(x=>x.startsWith('failback:')),'C21a old writer lock must release on failed safety recheck');
});
test('C38: legacy reactivation AFTER cutover revokes QA business 2.0 and releases C21a writer',async()=>{
  const f=fixture();
  await f.activate({activarDespachoComercial:true});
  f.setState({nextEstado:'conectado',nextSala:'F123-SYNTH-REAL'});
  f.emitState();
  assert.equal(f.API.modoCorte20Activo,false,'revocation happens synchronously before next sale');
  await Promise.resolve();
  assert.ok(f.trace.some(x=>x.startsWith('failback:')),'reuse C21a failback to release writer');
});
