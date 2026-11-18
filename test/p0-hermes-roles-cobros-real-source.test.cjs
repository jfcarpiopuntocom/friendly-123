'use strict';
// Hermes ROL: actual local production endpoint + real payment-entry helper.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'docs/plan-pagos-ui.js'),'utf8');
const start=backend.indexOf('      const mCliFiar = path.match(');
const end=backend.indexOf('      // POST /api/clientes/:id/despedir',start);
assert.ok(start>0&&end>start,'must run actual customer movement endpoint');
const routeBody=backend.slice(start,end);
const first=ui.indexOf('  function _pagoAutorizarCobro() {');
const second=ui.indexOf('  function _pagoMismaSesion(ctx) {',first);
assert.ok(first>0&&second>first,'must run actual IDB / fallback entry code');
const paymentHelpers=ui.slice(first,second);
function endpoint(role,endpointName='abonar'){
 const requests=[],history=[];
 const clientes=[{id:'s-client',nombre:'Synthetic client'}];
 const env={clientes,ventas:[],movimientos:history,
  window:{OCAuth:{rolActual:()=>role},AMG:{Cartera:{
    registrarMovimiento:async(cliente,tipo,monto,motivo,relacion)=>{
      requests.push({cliente,tipo,monto,motivo,opId:relacion?.opId});
      return {id:'synthetic-receipt'};
    },
    saldoDeCliente:async()=>({saldo:0}),
  }}},
  J:(data,status=200)=>({status,data}),mov:(name,data)=>history.push({name,detalle:data}),
  _vistaCarteraConVinculos:async()=>({saldo:0}),
  _rolLocal:()=>role
 };
 const source='async function simulate(path,opts,body,env) { '+
   'const {clientes,ventas,movimientos,window,J,mov,_vistaCarteraConVinculos,_rolLocal}=env;\n'+routeBody+
   '\n return J({error:"No route"},404); }\nsimulate';
 const simulator=vm.runInNewContext(source,{});
 return async()=>{
  const response=await simulator('/api/clientes/s-client/'+endpointName,{method:'POST'},
    {monto:5,motivo:'Synthetic payment',opId:'syn-op-1'},env);
  return {response,requests,history};
 };
}
test('ROL RED: contador, artista and unauthenticated cannot POST a customer payment or debt',async()=>{
 for(const role of ['contador','artista','']){
  for(const route of ['abonar','fiar']){
   const {response,requests,history}=await endpoint(role,route)();
   assert.equal(response.status,403,role+' must be blocked at actual '+route+' endpoint');
   assert.equal(requests.length,0,'Cartera must never be called for unprivileged identity');
   assert.equal(history.length,0);
  }
 }
});
test('ROL: Owner/Admin/Team retain payment authority and business opId receipt',async()=>{
 for(const role of ['dueno','admin','empleado']){
  const {response,requests}=await endpoint(role)();
  assert.equal(response.status,200,role);
  assert.equal(response.data.movimientoId,'synthetic-receipt');
  assert.equal(requests.length,1);
  assert.equal(requests[0].opId,'syn-op-1');
 }
});
test('ROL RED: payment helper must not skip authorization when IDB or WebCrypto absent',async()=>{
 const script=paymentHelpers+'\nthis.runPaymentTest=()=>_pagoIDB()';
 for(const role of ['contador','artista','']){
  for(const missing of ['idb','crypto']){
   const global={OCAuth:{rolActual:()=>role},
     OCTienda:{licenciaActual:()=> 'SYNTHETIC-STORE'},crypto:missing==='crypto'?null:{subtle:null},
     indexedDB:missing==='idb'?null:{open:()=>{}},OCI18n:{locale:()=> 'es'}};
   const localStorage={getItem:(key)=>key==='f123_owned'
     ?JSON.stringify({licenseCode:'SYNTHETIC-STORE',instanceId:'synthetic-device-1'}):null};
   const ctx={global,localStorage,TextEncoder,console};vm.runInNewContext(script,ctx);
   await assert.rejects(ctx.runPaymentTest(),/autorizada|autoriza|permiso|sesión|role|403/i,
     role+' must be denied even without '+missing);
  }
 }
});
test('ROL: permitted roles retain graceful no-IDB fallback as before',async()=>{
 const script=paymentHelpers+'\nthis.runPaymentTest=()=>_pagoIDB()';
 for(const role of ['dueno','admin','empleado']){
  const ctx={global:{indexedDB:null,crypto:null,OCAuth:{rolActual:()=>role},
    OCTienda:{licenciaActual:()=> 'SYNTHETIC-STORE'}},
    localStorage:{getItem:()=>JSON.stringify({licenseCode:'SYNTHETIC-STORE',instanceId:'synthetic-device-1'})},
    TextEncoder,console};
  vm.runInNewContext(script,ctx);
  assert.equal(await ctx.runPaymentTest(),null);
 }
});
