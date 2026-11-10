'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const realtime=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const yjs=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const a=realtime.indexOf('  window.OCSyncEmit = function (tipo, payload) {');
const b=realtime.indexOf('  function encolar(op)',a);
assert.ok(a>0&&b>a,'real legacy/Yjs movement bridge');
const code=realtime.slice(a,b).replace(/  \/\* NO PERDER EN SILENCIO[\s\S]*$/,'');
function harness(room,lic,channel){
 const events=[],store=new Map(),ops=new Map();
 if(channel && channel.opsMap) channel.opsMap={get:id=>ops.get(id),set:(id,op)=>ops.set(id,op)};
 const ctx={window:{OCYjs:channel,OCCurrentUser:{nombre:'owner'},
   addEventListener:()=>{},dispatchEvent:e=>{events.push(e.detail);if(channel&&channel.estado==='activo'&&channel.codigoCuaderno===lic)ops.set(e.detail.opId,e.detail)}},
   localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
   setInterval:()=>{},CustomEvent:class{constructor(name,o){this.type=name;this.detail=o.detail}},
   leerSala:()=>room,codigoCuadernoActivo:()=>lic,normalizarCodigo:x=>String(x||'').toUpperCase(),
   uuidCorto:()=>String(events.length+1),deviceId:()=> 'phone',siguienteLamport:()=>1,
   encolar:()=>true,registrarEnLog:()=>{},ws:null,WebSocket:{OPEN:1},Date,console};
 const ja=realtime.indexOf('  const COLA_YJS_SIN_SALA = ');
 const jb=realtime.indexOf('  // --- Puente con mock-backend.js:',ja);
 assert.ok(ja>0&&jb>ja);
 vm.runInNewContext(realtime.slice(ja,jb)+'\n'+code+'\nthis.drain=drenarPendientesYjs;this.read=leerPendientesYjs;',ctx);
 return {emit:ctx.window.OCSyncEmit,events,drain:ctx.drain,read:ctx.read,ops};
}
test('JFC committed stock event reaches Yjs when legacy room key is absent',()=>{
 const h=harness(null,'JFC-TEST',{estado:'activo',opsMap:{},codigoCuaderno:'JFC-TEST'});
 assert.equal(h.emit('ajuste',{productoId:'spray',delta:-1,stockPNHecho:{base:13,epoch:'E',actor:'phone',add:0,sub:1}}),true);
 assert.equal(h.events.length,1);
 assert.equal(h.events[0].payload.delta,-1);
 assert.equal(h.events[0]._salaOrigen,'JFC-TEST');
});
test('wrong notebook or uninitialized Yjs journals but never leaks a stock event',()=>{
 for(const ch of [{estado:'activo',opsMap:{},codigoCuaderno:'OTHER'},{estado:'apagado',opsMap:{},codigoCuaderno:'JFC-TEST'},null]){
  const h=harness(null,'JFC-TEST',ch);
  assert.equal(h.emit('ajuste',{delta:-1}),true);
  assert.equal(h.events.length,0);
  assert.equal(h.read('JFC-TEST').length,1);
 }
});
test('legacy room identity mismatch still blocks old and new transports',()=>{
 const h=harness({codigo:'OTHER'},'JFC-TEST',{estado:'activo',opsMap:{},codigoCuaderno:'JFC-TEST'});
 assert.equal(h.emit('ajuste',{delta:-1}),false);assert.equal(h.events.length,0);
});
test('Yjs derives same active licence and exposes it on ops channel',()=>{
 assert.match(yjs,/API\.codigoCuaderno = codigo/);
 assert.match(yjs,/window\.addEventListener\("oc-op-local"/);
});
