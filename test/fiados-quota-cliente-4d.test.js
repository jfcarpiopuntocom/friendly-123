'use strict';
// P0 idiomARTE 24 Oct: synthetic-only regression for allocation storage quota
// and cross-customer sales. Never reads real licenses, receipts or customer data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ui=fs.readFileSync(path.join(__dirname,'../docs/plan-pagos-ui.js'),'utf8');
const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
function sliceBetween(source,a,b){
  const first=source.indexOf(a), last=source.indexOf(b,first);
  assert.ok(first>=0&&last>first,'production anchors '+a);
  return source.slice(first,last);
}
function app({rejectKey='',stale=false,receipt=false}={}){
  const memory=new Map();let requests=0;
  const storage={
    getItem:k=>stale?null:(memory.has(k)?memory.get(k):null),
    setItem:(k,v)=>{if(rejectKey&&k.startsWith(rejectKey))throw Error('QuotaExceededError');memory.set(k,v);},
    removeItem:k=>memory.delete(k)
  };
  const win={AMG:{},OCAuth:{rolActual:()=> 'dueno'},
    OCI18n:{locale:()=> 'es'},crypto:{randomUUID:()=> 'synthetic-op'},
    addEventListener:()=>{}};
  const doc={createElement:()=>({style:{},textContent:''}),head:{appendChild:()=>{}},getElementById:()=>null};
  const source=ui.replace('  function modalAbonar(clienteId, nombre) {',
    '  global.__creditRegression = { reanudarAsignacion, claveAsignacion, claveAbono };\n  function modalAbonar(clienteId, nombre) {');
  const fetch=async url=>{
    requests++;
    if(receipt&&url.endsWith('/abonar'))return {ok:true,json:async()=>({opId:'customer-payment:synthetic-op',movimientoId:'synthetic-receipt'})};
    throw Error('Unexpected request to '+url);
  };
  const ctx={window:win,document:doc,localStorage:storage,fetch,console,setTimeout:()=>{}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {win,memory,storage,requests:()=>requests};
}
test('P0 quota on initial allocation reference: no payment sent, no false success',async()=>{
  const x=app({rejectKey:'f123_customer_allocation_intent_v1:'});
  const ref=x.win.__creditRegression;
  const old={paymentOpId:'customer-payment:synthetic-op',opId:'customer-allocation:synthetic-op',
    abonoId:null,partes:[{cargoKey:'venta:synthetic-sale',monto:5}],monto:5,motivo:'Abono'};
  // The exact helper is source extracted, not a simulated throw from a UI error handler.
  const helper=sliceBetween(ui,'  function guardarReferenciaPago(clave, dato, cobroConfirmado) {','  function claveAbono(clienteId)');
  const store=new Function('global','localStorage',helper+';return guardarReferenciaPago;')(x.win,x.storage);
  assert.throws(()=>store(ref.claveAsignacion('synthetic-client'),old,false),e=>
    e.codigo==='F123_REFERENCIA_PAGO_NO_GUARDADA'&&!e.cobroConfirmado&&/No se envió/.test(e.message));
  assert.equal(x.requests(),0);
});
test('P0 quota on generic on-account payment: no request without durable opId',async()=>{
  const x=app({rejectKey:'f123_customer_payment_intent_v1:'});
  await assert.rejects(x.win.ocEnviarAbono('synthetic-client',5,'Abono'),e=>
    e.codigo==='F123_REFERENCIA_PAGO_NO_GUARDADA'&&!e.cobroConfirmado);
  assert.equal(x.requests(),0);
});
test('P0 payment receipt known, later allocation reference fails: never claim unpaid',async()=>{
  const x=app({receipt:true});
  const ref=x.win.__creditRegression;
  const pending={paymentOpId:'customer-payment:synthetic-op',opId:'customer-allocation:synthetic-op',
    abonoId:null,partes:[{cargoKey:'venta:sale-1',monto:5}],monto:5,motivo:'Abono'};
  const key=ref.claveAsignacion('synthetic-client');
  x.memory.set(key,JSON.stringify(pending));
  const originalSet=x.storage.setItem;
  x.storage.setItem=(k,v)=>{if(k===key&&JSON.parse(v).abonoId)throw Error('QuotaExceededError');return originalSet(k,v);};
  await assert.rejects(ref.reanudarAsignacion('synthetic-client',pending),e=>
    e.codigo==='F123_REFERENCIA_PAGO_NO_GUARDADA'&&e.cobroConfirmado&&/No lo cobres de nuevo/.test(e.message));
  assert.equal(x.requests(),1,'one payment request, no allocation request');
  assert.equal(JSON.parse(x.memory.get(key)).abonoId,null,'original recovery reference survives');
});
test('P0 cross-client linked sale is excluded from payable list; balance/history untouched',async()=>{
  const code=sliceBetween(backend,'  async function _vistaCarteraConVinculos(clienteId, info, rol) {','  function _rolLocal()');
  const sales=[{id:'my-sale',clienteId:'cli-A'},{id:'not-mine',clienteId:'cli-B'}];
  const input={saldo:-15,movimientos:[{tipo:'cargo',id:'historical'}]};
  const vista={saldo:-15,historial:[{tipo:'cargo',id:'historical'}],consumosPendientes:[
    {cargoKey:'venta:my-sale'},{cargoKey:'venta:not-mine'},{cargoKey:'cargo:old-unlinked'}]};
  const ctx={window:{AMG:{Cartera:{vistaCarteraSegunRol:()=>vista}}},ventas:sales};
  const fn=new Function('window','ventas',code+';return _vistaCarteraConVinculos;')(ctx.window,ctx.ventas);
  const out=await fn('cli-A',input,'empleado');
  assert.deepEqual(out.consumosPendientes.map(x=>x.cargoKey),['venta:my-sale','cargo:old-unlinked']);
  assert.equal(out.consumosEnRevision,1);
  assert.equal(out.saldo,-15);
  assert.equal(out.historial.length,1);
});
test('P0 backend rejects payment allocation to a different customer before recording a fact',async()=>{
  const code=sliceBetween(backend,
    '      const mCliAplicar = path.match(/^\\/api\\/clientes\\/([^/]+)\\/aplicar$/);',
    '      const mCliFiar = path.match(');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const action=new AsyncFunction('path','opts','clientes','window','body','ventas','J','mov','movimientos',
    '_rolLocal','_vistaCarteraConVinculos',code);
  let writes=0;
  const C={aplicarAbono:async()=>{writes++;return {id:'confirmed-synthetic'};},
    saldoDeCliente:async()=>({saldo:-5,movimientos:[],aplicacionesAceptadas:['confirmed-synthetic']})};
  const clients=[{id:'cli-A',nombre:'A'},{id:'cli-B',nombre:'B'}];
  const sales=[{id:'not-mine',clienteId:'cli-B'},{id:'mine',clienteId:'cli-A'}];
  const J=(x,status=200)=>({body:x,status});
  const send=k=>action('/api/clientes/cli-A/aplicar',{method:'POST'},clients,{AMG:{Cartera:C}},
    {abonoId:'receipt',partes:[{cargoKey:'venta:'+k,monto:5}],opId:'synthetic-op'},
    sales,J,()=>{},[],()=> 'admin',async()=>({}));
  const blocked=await send('not-mine');
  assert.equal(blocked.status,409);
  assert.equal(blocked.body.needsReview,true);
  assert.equal(writes,0);
  assert.equal((await send('mine')).status,200);
  assert.equal(writes,1);
});
test('P0 quota blocks same-screen retry and mismatched charges display an inline warning',()=>{
  assert.match(ui,/btn\.disabled = bloqueoAlmacenamiento/);
  assert.match(ui,/info\.consumosEnRevision/);
  assert.match(ui,/No se envió este pago/);
});
