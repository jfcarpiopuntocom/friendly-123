'use strict';
// C36 exact-source + actual backend sale: one durable opId from local receipt
// through the SAME legacy/Yjs event into C31 typed Workerd command.
// Synthetic app data only, no production, no real network or cloud writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {browser}=require('./helpers/browser.cjs');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const yjs=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const first=src.indexOf('  window.OCSyncEmit = function (tipo, payload) {');
const last=src.indexOf('  /* NO PERDER EN SILENCIO',first);
const mapStart=yjs.indexOf('    function _traducirOpLegadoAComando20(op, licenciaFallback) {');
const mapEnd=yjs.indexOf('    API.traducirOpLegadoAComando20 =',mapStart);
assert.ok(first>0&&last>first&&mapStart>0&&mapEnd>mapStart,'real product source anchors');
const emitter=src.slice(first,last);
const mapper=new Function(yjs.slice(mapStart,mapEnd)+'\nreturn _traducirOpLegadoAComando20;')();
const LICENSE='F123-ABCDEF1234567890';
const SALE_OP='sale-c36-retry-0001';
async function realBackendSale({opId=SALE_OP,payment='cash'}={}){
 const w=browser();
 w.OCAuth={rolActual:()=> 'dueno'};
 const sent=[];
 w.OCSyncEmit=(type,payload)=>{sent.push({type,payload:JSON.parse(JSON.stringify(payload))});return true;};
 const p=await w.request('/api/productos','POST',{nombre:'synthetic C36 '+payment,precio:15,costo:4,stockInicial:3,barcode:'C36-'+payment});
 assert.ok(p.id,'actual backend product created');
 const input={cantidad:1,opId,info:{formaPago:payment}};
 const sale=await w.request('/api/productos/'+p.id+'/venta','POST',input);
 assert.equal(sale.opId,opId,'actual API receipt keeps client stable id');
 const beforeReplay=await w.request('/api/respaldo/exportar');
 const duplicate=await w.request('/api/productos/'+p.id+'/venta','POST',input);
 const afterReplay=await w.request('/api/respaldo/exportar');
 const saleRows=afterReplay.ventas.filter(v=>v.productoId===p.id);
 assert.equal(duplicate.duplicate,true,'actual POST same opId must replay without new stock/money');
 assert.equal(duplicate.opId,opId);
 assert.equal(sent.length,1,'exactly one emitter call after first durable local commit');
 assert.equal(beforeReplay.productos.find(x=>x.id===p.id).stockActual,2);
 assert.equal(afterReplay.productos.find(x=>x.id===p.id).stockActual,2);
 assert.equal(saleRows.length,1,'same opId cannot duplicate a sale row');
 assert.equal(saleRows[0].opId,opId,'durable sale row carries the receipt id');
 assert.equal(afterReplay.movimientos.filter(x=>x.detalle?.opId===opId).length,1);
 return {sale,sent:sent[0],p};
}
function actualEmitterEvent(type,payload,room){
 const pub=[],queue=[],journal=[],timeline=[];let generated=0;
 const code=[
   'const window={OCCurrentUser:{nombre:"synthetic owner"},dispatchEvent:e=>{timeline.push("publish");pub.push(e.detail)}};',
   'const CustomEvent=function(t,o){this.type=t;this.detail=o.detail};',
   'const leerSala=()=>room?{codigo:LICENSE}:null;',
   'const codigoCuadernoActivo=()=>LICENSE;',
   'const normalizarCodigo=v=>String(v||"").toUpperCase();',
   'const uuidCorto=()=>{generated++;return "synthetic-generated-op-"+generated};',
   'const deviceId=()=>"synthetic-device";',
   'const siguienteLamport=()=>13;',
   'const leerPendientesYjs=()=>journal.slice();',
   'const guardarPendientesYjs=(lic,ops)=>{timeline.push("journal");journal.splice(0,journal.length,...ops);return true};',
   'const drenarPendientesYjs=()=>{for(const op of journal){window.dispatchEvent(new CustomEvent("oc-op-local",{detail:op}))}};',
   'const encolar=op=>{timeline.push("queue");queue.push(op);return true};',
   'const registrarEnLog=op=>timeline.push("log");',
   'const ws=null,WebSocket={OPEN:1};',
   emitter,
   'const accepted=window.OCSyncEmit(type,payload);',
   'return {accepted,pub,queue,journal,timeline,generated};'
 ].join('\n');
 return new Function('type','payload','room','LICENSE','pub','queue','journal','timeline',
   'generated',code)(type,payload,room,LICENSE,pub,queue,journal,timeline,generated);
}

test('C36 RED: REAL strict-ACK sale opId survives both legacy-room queue and roomless Yjs journal into C31 SQL',async()=>{
 const {sale,sent,p}=await realBackendSale();
 assert.equal(sent.type,'venta');
 assert.equal(sent.payload.productoId,p.id);
 assert.equal(sent.payload.cantidad,1);
 assert.equal(sent.payload.amountCents,1500);
 assert.equal(sent.payload.opId,sale.opId,'C34 must expose the RECEIPT id in its actual emitted payload');
 for(const joined of [true,false]){
   const e=actualEmitterEvent(sent.type,sent.payload,joined);
   assert.equal(e.accepted,true);
   assert.equal(e.generated,0,'no second uuidCorto for a sale with a stable receipt id');
   assert.equal(e.pub.length,1,'one operation published after local journal/queue');
   const op=e.pub[0],onDisk=joined?e.queue[0]:e.journal[0];
   assert.equal(op.opId,sale.opId,'same source id must reach 1.0/Yjs');
   assert.equal(onDisk.opId,sale.opId,'same source id must be retained for retry');
   assert.equal(e.timeline[0],joined?'queue':'journal','persisted before publish');
   const cmd=mapper(op,LICENSE);
   assert.equal(cmd?.kind,'sale.record');
   assert.equal(cmd?.opId,sale.opId,'C31 business opId must equal original sale receipt opId');
   assert.equal(cmd?.productId,p.id);
   assert.equal(cmd?.amountCents,1500);
   assert.equal(cmd?.quantity,1);
 }
});
test('C36: transfer sale and legal legacy colon opId cannot masquerade as a typed cash receipt',async()=>{
 const transfer=await realBackendSale({opId:'sale-c36-transfer-0001',payment:'transferencia'});
 const colon=await realBackendSale({opId:'sale:c36_legacy_0001',payment:'cash'});
 for(const {sent} of [transfer,colon]){
   assert.equal(sent.payload.cantidad,undefined);
   assert.equal(sent.payload.amountCents,undefined);
   assert.equal(sent.payload.opId,undefined,'unsafe/unsupported sale must not propagate typed receipt id');
   for(const joined of [true,false]){
     const e=actualEmitterEvent(sent.type,sent.payload,joined);
     assert.equal(e.generated,1,'legacy fallback creates its own historical transport ID');
     assert.equal(mapper(e.pub[0],LICENSE),null,'non-representable business event stays legacy');
   }
 }
});
test('C36: non-sale events cannot inject an arbitrary supplied opId into unrelated transport',()=>{
 const event={productoId:'p1',delta:3,opId:SALE_OP,amountCents:1500,cantidad:1};
 for(const joined of [true,false]){
   const e=actualEmitterEvent('ajuste',event,joined);
   assert.equal(e.generated,1);
   assert.notEqual(e.pub[0].opId,event.opId);
   assert.equal(e.pub[0].payload.opId,event.opId,'do not rewrite caller payload');
 }
});
