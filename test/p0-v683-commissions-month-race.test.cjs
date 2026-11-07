'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Execute the actual loading logic, not a hand-written replacement.
// Stop the source just before its HTML rendering so we can observe stale
// money reads without involving the entire DOM, authentication or real customers.
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const from=source.indexOf('async function cargarComisiones(){');
const until=source.indexOf('  // Rec 03: botón que arma el resumen',from);
assert.ok(from>0 && until>from,'must find real Commissions data-loading boundary');
const declaration=source.slice(from,until)+
  '  painted.push({month: _ocMesComisiones, rows: filas, sales: ventasTodas});\n}\n';
const globalVar='let _ocMesComisiones = null;\n'+
  (source.includes('let _ocComisionesSolicitud = 0;')?'let _ocComisionesSolicitud = 0;\n':'');
function deferred(){
 let resolve,reject;
 const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
 return {promise,resolve,reject};
}
function fixture(){
 const requests=[],painted=[],cont={innerHTML:''};
 const context={API:'/api',painted,console,Promise,
  document:{getElementById:()=>cont},
  renderGestionPromotoras:()=>{},
  agruparVentasPorProducto:()=>[{ubicacionIds:new Set()}],
  window:{_ocMesAuto:null,_ocMesAutoHecho:true},
  fetch:url=>{const d=deferred();requests.push({url,...d});return d.promise;}};
 vm.createContext(context);
 vm.runInContext(globalVar+declaration,context);
 return {context,requests,painted,cont};
}
const deliver=(req,payload)=>{
 req.resolve({ok:true,json:async()=>payload});
};
const fulfillBatch=(requests,offset,month)=>{
 const payloads=[
  [{ubicacionId:'event-rack',mes:month,paymentStatus:month==='2026-10'?'paid':'due'}],
  [],
  [{id:month==='2026-10'?'paid-oct':'new-nov',mes:month,productoId:'event',liquidada:month==='2026-10'}],
  [{mes:month,actual:month==='2026-11',pendiente:month==='2026-10'?0:12.75}],
  {mes:month,porPagar:month==='2026-10'?0:12.75},
 ];
 for(let i=0;i<5;i++)deliver(requests[offset+i],payloads[i]);
};
test('RED: late PAID October result cannot repaint current November after month selection',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-10"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const newer=vm.runInContext('cargarComisiones()',f.context);
 assert.equal(f.requests.length,10);
 fulfillBatch(f.requests,5,'2026-11');
 await newer;
 assert.equal(f.painted.length,1);
 assert.equal(f.painted[0].rows[0].paymentStatus,'due');
 fulfillBatch(f.requests,0,'2026-10');
 await older;
 assert.equal(f.painted.length,1,'a late old response MUST NOT replace the new month');
 assert.equal(f.painted[0].month,'2026-11');
});
test('RED: stale errors cannot replace a later successful month with a blank warning',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-10"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const newer=vm.runInContext('cargarComisiones()',f.context);
 fulfillBatch(f.requests,5,'2026-11');
 await newer;
 f.requests[0].reject(Error('stale old-month network failure'));
 await older;
 assert.equal(f.cont.innerHTML,'','old network error cannot erase November');
 assert.equal(f.painted.length,1);
});
test('a same-month newer sync repaint supersedes an older request',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 const newer=vm.runInContext('cargarComisiones()',f.context);
 fulfillBatch(f.requests,5,'2026-11');
 await newer;
 fulfillBatch(f.requests,0,'2026-11');
 await older;
 assert.equal(f.painted.length,1,'late same-month result must not repaint');
});
