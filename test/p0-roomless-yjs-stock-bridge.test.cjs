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
 const events=[],ctx={window:{OCYjs:channel,OCCurrentUser:{nombre:'owner'},dispatchEvent:e=>events.push(e.detail)},CustomEvent:class{constructor(name,o){this.type=name;this.detail=o.detail}},leerSala:()=>room,codigoCuadernoActivo:()=>lic,normalizarCodigo:x=>String(x||'').toUpperCase(),uuidCorto:()=>String(events.length+1),deviceId:()=> 'phone',siguienteLamport:()=>1,encolar:()=>true,registrarEnLog:()=>{},ws:null,WebSocket:{OPEN:1},Date,console};
 vm.runInNewContext(code,ctx);
 return {emit:ctx.window.OCSyncEmit,events};
}
test('JFC committed stock event reaches Yjs when legacy room key is absent',()=>{
 const h=harness(null,'JFC-TEST',{estado:'activo',opsMap:{},codigoCuaderno:'JFC-TEST'});
 assert.equal(h.emit('ajuste',{productoId:'spray',delta:-1,stockPNHecho:{base:13,epoch:'E',actor:'phone',add:0,sub:1}}),true);
 assert.equal(h.events.length,1);
 assert.equal(h.events[0].payload.delta,-1);
 assert.equal(h.events[0]._salaOrigen,'JFC-TEST');
});
test('wrong notebook or uninitialized Yjs never leaks a stock event',()=>{
 for(const ch of [{estado:'activo',opsMap:{},codigoCuaderno:'OTHER'},{estado:'apagado',opsMap:{},codigoCuaderno:'JFC-TEST'},null]){
  const h=harness(null,'JFC-TEST',ch);h.emit('ajuste',{delta:-1});assert.equal(h.events.length,0);
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
