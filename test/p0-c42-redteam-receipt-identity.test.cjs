'use strict';
// C42-R independent adversarial tests: exact C42 browser-source segments, no production network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
const mock=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
function cut(source,start,end){
 const a=source.indexOf(start);
 const b=source.indexOf(end,a+start.length);
 assert.ok(a>0&&b>a,'exact product source block missing: '+start);
 return source.slice(a,b);
}
const receipts=cut(sync,'    API.recibosComerciales20 = new Map();','    if (piloto && typeof piloto.crearCoordinadorCorte20 === "function") {');
const dispatch=cut(sync,'      API.despacharOpComercialCertificada = function (comando) {','      // C29:');
const checkout=cut(mock,'  function _aplicarEstadoReciboDo20(detail) {','  // C42_END');
function createHarness(ventas){
 let submit=async()=>{throw Error('submit mock not configured')};
 const events=[]; const listeners=new Map(); let saves=0;
 const window={
  addEventListener(name,callback){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback);},
  dispatchEvent(event){if(event?.type==='oc-op-20-recibo')events.push(event.detail);
    for(const fn of listeners.get(event?.type)||[])fn(event);}
 };
 const ctx={window,ventas,_mergeSucio:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  _guardarMergePendienteYa(){saves++;},
  __submitMock(command){return submit(command);}
 };
 const code='(function(){var API={coordinadorCorte20:{submitCommercial:__submitMock}};\n'+
   receipts+'\n'+dispatch+'\n'+checkout+'\nreturn {API:API};})()';
 const result=vm.runInNewContext(code,ctx,{filename:'C42-real-product-extract.js'});
 return {api:result.API,events,ventas,setSubmit(fn){submit=fn;},get saves(){return saves;}};
}
test('C42 P0: mismatched DO receipt.opId cannot confirm another sale',async()=>{
 const A='op_c42_mismatch_A_001',B='op_c42_mismatch_B_002';
 const h=createHarness([{id:'v-A',opId:A},{id:'v-B',opId:B}]);
 h.setSubmit(async()=>({committed:true,receipt:{opId:B,receiptId:'another-receipt',stage:'business-committed'}}));
 await h.api.despacharOpComercialCertificada({opId:A});
 assert.notEqual(h.ventas[1].reciboDo20?.estado,'confirmado-do','server receipt for B must not confirm unrelated sale B from command A');
 assert.notEqual(h.api.obtenerReciboComercial20(B)?.committed,true,'foreign opId should not enter map as committed');
});
test('C42 P0: confirmed receipt is monotone; stale 202 cannot demote sale or DO Map',async()=>{
 const A='op_c42_monotone_0001';const h=createHarness([{id:'v-A',opId:A}]);
 h.setSubmit(async()=>({committed:true,receipt:{opId:A,receiptId:'original',stage:'business-committed'}}));
 await h.api.despacharOpComercialCertificada({opId:A});
 assert.equal(h.ventas[0].reciboDo20?.estado,'confirmado-do');
 h.setSubmit(async()=>({committed:false,reconcileRequired:true,receipt:{opId:A,stage:'stored-for-application'}}));
 await h.api.despacharOpComercialCertificada({opId:A});
 assert.equal(h.ventas[0].reciboDo20?.estado,'confirmado-do','202 after ACK must not downgrade local receipt');
 assert.equal(h.api.obtenerReciboComercial20(A)?.committed,true,'202 after ACK must not downgrade DO receipt map');
});
test('C42 P0: 409 with quarantine + reconcileRequired is quarantine, never ordinary pending',async()=>{
 const A='op_c42_conflict_0001';const h=createHarness([{id:'v-A',opId:A}]);
 h.setSubmit(async()=>({committed:false,quarantine:true,reconcileRequired:true,stage:'conflict-quarantine'}));
 await h.api.despacharOpComercialCertificada({opId:A});
 assert.equal(h.ventas[0].reciboDo20?.estado,'cuarentena-do');
 assert.equal(h.ventas[0].reciboDo20?.committed,false);
});
test('C42 P0: delayed rejection after valid DO commit cannot demote cash receipt',async()=>{
 const A='op_c42_late_reject_001';const h=createHarness([{id:'v-A',opId:A}]);
 h.setSubmit(async()=>({committed:true,receipt:{opId:A,receiptId:'committed',stage:'business-committed'}}));
 await h.api.despacharOpComercialCertificada({opId:A});
 h.setSubmit(async()=>{throw Error('old network timeout after receipt');});
 await assert.rejects(()=>h.api.despacharOpComercialCertificada({opId:A}),/old network timeout/);
 assert.equal(h.ventas[0].reciboDo20?.estado,'confirmado-do','uncertain reject cannot erase confirmed receipt');
 assert.equal(h.api.obtenerReciboComercial20(A)?.committed,true);
});
