'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');
const {webcrypto}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync(path.join(__dirname,'../docs/plan-pagos-ui.js'),'utf8');
const moduleURL=pathToFileURL(path.join(__dirname,'../src/pago-intento-idb.mjs')).href;
const ownedA={licenseCode:'SYNTHETIC-STORE-A',instanceId:'a1b2c3d4'};
const ownedB={licenseCode:'SYNTHETIC-STORE-B',instanceId:'b1b2c3d4'};
const make=({db=new IDBFactory(),storage=null,receive,role='dueno',owner=ownedA,active=null,failIDB=false}={})=>{
  const values=storage||new Map();
  if(!values.has('f123_owned'))values.set('f123_owned',JSON.stringify(owner));
  const outgoing=[];
  const ls={
    getItem:k=>values.has(k)?values.get(k):null,
    setItem:(k,v)=>{if(k.startsWith('f123_customer_'))throw new Error('QuotaExceededError');values.set(k,v);},
    removeItem:k=>values.delete(k),
  };
  const doc={createElement:()=>({style:{},textContent:''}),head:{appendChild(){}},getElementById:()=>null};
  // Inject only the ESM loader into Node VM: the production HTML and all
  // payment logic run unchanged; stock node --test does not enable vm-modules.
  const module=source.replace('  function modalAbonar(clienteId, nombre) {',
    '  global.__creditRegression={leerReferenciaDurable,guardarReferenciaPagoDurable,reanudarAsignacion,claveAsignacion,claveAbono};\n  function modalAbonar(clienteId, nombre) {')
    .replace('var modulo = await import("./pago-intento-idb.mjs");',
      'var modulo = await global.__syntheticImportIDB();');
  const state={role,active:active||owner.licenseCode};
  const win={
    indexedDB:failIDB?{open(){throw new Error('QuotaExceededError')}}:db,
    crypto:webcrypto,TextEncoder,
    OCAuth:{rolActual:()=>state.role},
    OCTienda:{licenciaActual:()=>state.active},OCI18n:{locale:()=> 'es'},
    AMG:{},addEventListener(){},setTimeout(){},
    __syntheticImportIDB:()=>import(moduleURL),
  };
  const fetch=async(url,opts)=>{
    outgoing.push({url,body:JSON.parse(opts.body)});
    if(receive)return receive(url,JSON.parse(opts.body));
    return {ok:true,json:async()=>({opId:JSON.parse(opts.body).opId,movimientoId:'receipt-synthetic'})};
  };
  vm.runInNewContext(module,{window:win,document:doc,localStorage:ls,fetch,TextEncoder,
    setTimeout:()=>{},console},{filename:'plan-pagos-ui.js'});
  return {win,values,ls,outgoing,db,state};
};

test('P0 Belén: Safari localStorage quota uses durable IDB and confirms first payment once',async()=>{
 const x=make();
 const out=await x.win.ocEnviarAbono('client-A',5,'Abono');
 assert.equal(out.movimientoId,'receipt-synthetic');
 assert.equal(x.outgoing.length,1);
 assert.match(x.outgoing[0].body.opId,/^customer-payment:/);
 const old=await x.win.__creditRegression.leerReferenciaDurable('client-A','payment');
 assert.equal(old,null,'only verified receipt may release durable intent');
});
test('P0 Belén: dropped HTTP response, reboot, retry same payment opId once',async()=>{
 const db=new IDBFactory(),values=new Map(),ledger=new Map();
 let fail=true;
 const receive=async(url,body)=>{
    if(!ledger.has(body.opId))ledger.set(body.opId,{opId:body.opId,movimientoId:'durable:'+body.opId});
    if(fail){fail=false;throw new Error('network gone after commit');}
    return {ok:true,json:async()=>ledger.get(body.opId)};
 };
 const a=make({db,storage:values,receive});
 await assert.rejects(a.win.ocEnviarAbono('cli-A',5,'Abono'),/network gone/);
 const pending=await a.win.__creditRegression.leerReferenciaDurable('cli-A','payment');
 assert.match(pending.opId,/^customer-payment:/);
 const b=make({db,storage:values,receive});
 const receipt=await b.win.ocEnviarAbono('cli-A',5,'Abono');
 assert.equal(receipt.opId,pending.opId);
 assert.equal(a.outgoing[0].body.opId,b.outgoing[0].body.opId);
 assert.equal(ledger.size,1,'one financial movement after retry');
});
test('P0 Belén: overlapping tabs reuse original durable opId, one economic receipt',async()=>{
 const db=new IDBFactory(),values=new Map(),ledger=new Map();
 let firstPost;
 const postStarted=new Promise(resolve=>{firstPost=resolve;});
 let releasePost;
 const postGate=new Promise(resolve=>{releasePost=resolve;});
 const receive=async(_url,body)=>{
   if(!ledger.has(body.opId))
     ledger.set(body.opId,{opId:body.opId,movimientoId:'receipt:'+body.opId});
   return {ok:true,json:async()=>ledger.get(body.opId)};
 };
 const a=make({db,storage:values,receive:async(url,body)=>{
   firstPost();
   await postGate; // Keep first POST pending while the other tab reads IDB.
   return receive(url,body);
 }});
 const b=make({db,storage:values,receive});
 const first=a.win.ocEnviarAbono('cli-A',5,'Abono');
 try {
   await postStarted;
   // The second tab must RESUME the same durable opId, not mint a second one.
   // Repeated HTTP requests with the same opId are legitimate idempotent retries.
   const second=await b.win.ocEnviarAbono('cli-A',5,'Abono');
   assert.equal(second.opId,a.outgoing[0].body.opId);
   assert.equal(b.outgoing.length,1);
   assert.equal(b.outgoing[0].body.opId,a.outgoing[0].body.opId,
     'both tabs must send the exact same original payment opId');
 } finally {
   releasePost();
 }
 const original=await first;
 assert.equal(original.opId,a.outgoing[0].body.opId);
 assert.equal(ledger.size,1,'two HTTP deliveries must yield exactly one economic receipt');
});
test('P0 Belén: overlapping explicit rival opId fails closed before POST',async()=>{
 const db=new IDBFactory(),values=new Map();
 let postStarted;
 const started=new Promise(resolve=>{postStarted=resolve;});
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const a=make({db,storage:values,receive:async(_url,body)=>{
   postStarted();
   await gate;
   return {ok:true,json:async()=>({opId:body.opId,movimientoId:'receipt-synthetic'})};
 }});
 const b=make({db,storage:values});
 const first=a.win.ocEnviarAbono('cli-A',5,'Abono',{opId:'customer-payment:original'});
 try {
   await started;
   await assert.rejects(b.win.ocEnviarAbono('cli-A',5,'Abono',
     {opId:'customer-payment:rival'}),/anterior|confirmar|previous|original/i);
   assert.equal(b.outgoing.length,0,'explicit different opId cannot bypass durable intent');
 } finally {
   release();
 }
 await first;
 assert.equal(a.outgoing.length,1);
 assert.equal(a.outgoing[0].body.opId,'customer-payment:original');
});

test('P0 Belén: if both localStorage and IDB fail, do not send payment',async()=>{
 const x=make({failIDB:true});
 await assert.rejects(x.win.ocEnviarAbono('cli-A',5,'Abono'),/QuotaExceeded|almacenamiento|durable/i);
 assert.equal(x.outgoing.length,0);
});
test('P0 Belén: credit payment and allocation retain separate opIds and one receipt after reboot',async()=>{
 const db=new IDBFactory(),values=new Map(),seen=new Map(),urls=[];
 const receive=async(url,body)=>{
   urls.push(url);
   if(url.endsWith('/abonar')){
     if(!seen.has(body.opId))seen.set(body.opId,{opId:body.opId,movimientoId:'payment-proof'});
     return {ok:true,json:async()=>seen.get(body.opId)};
   }
   if(url.endsWith('/aplicar')){
      assert.equal(body.abonoId,'payment-proof');
      assert.equal(body.partes[0].cargoKey,'venta:synthetic-A');
      return {ok:true,json:async()=>({opId:body.opId,aplicacionId:'allocation-proof'})};
   }
   throw Error('unexpected URL '+url);
 };
 const x=make({db,storage:values,receive});
 const original={
   paymentOpId:'customer-payment:synthetic-10',opId:'customer-allocation:synthetic-10',
   abonoId:null,partes:[{cargoKey:'venta:synthetic-A',monto:5}],monto:5,motivo:'Abono'};
 await x.win.__creditRegression.guardarReferenciaPagoDurable(x.win.__creditRegression.claveAsignacion('cli-A'),original,false,'cli-A','allocation');
 const y=make({db,storage:values,receive});
 const pending=await y.win.__creditRegression.leerReferenciaDurable('cli-A','allocation');
 const confirmed=await y.win.__creditRegression.reanudarAsignacion('cli-A',pending);
 assert.equal(confirmed.aplicacionId,'allocation-proof');
 assert.equal(urls.filter(x=>x.endsWith('/abonar')).length,1);
 assert.equal(urls.filter(x=>x.endsWith('/aplicar')).length,1);
 assert.equal(seen.size,1);
 assert.equal(await y.win.__creditRegression.leerReferenciaDurable('cli-A','allocation'),null);
});
test('P0 Belén: legacy localStorage intent with different IDB opId must fail closed',async()=>{
 const db=new IDBFactory(),values=new Map();
 values.set('f123_owned',JSON.stringify(ownedA));
 values.set('f123_customer_payment_intent_v1:cli-A',JSON.stringify({opId:'customer-payment:old',monto:5,motivo:'Abono'}));
 const x=make({db,storage:values});
 await assert.rejects(x.win.__creditRegression.guardarReferenciaPagoDurable(
   x.win.__creditRegression.claveAbono('cli-A'),{opId:'customer-payment:new',monto:5,motivo:'Abono'},false,'cli-A','payment'),
   /conflict|revisar|opId|anterior/i);
 assert.equal(x.outgoing.length,0);
});

test('P0 root: joined business payment journal follows OCTienda, not old f123_owned',async()=>{
  const db=new IDBFactory(),values=new Map();
  const x=make({db,storage:values,active:ownedB.licenseCode});
  // A payment attempt with uncertain network creates the durable pending proof.
  x.win.__creditRegression.guardarReferenciaPagoDurable;
  const ref=x.win.__creditRegression;
  const original={opId:'customer-payment:joined-B',monto:7,motivo:'Abono'};
  await ref.guardarReferenciaPagoDurable(ref.claveAbono('cli-joined'),original,false,'cli-joined','payment');
  assert.deepEqual(await ref.leerReferenciaDurable('cli-joined','payment'),original);
  x.state.active=ownedA.licenseCode;
  assert.equal(await ref.leerReferenciaDurable('cli-joined','payment'),null,
    'local owner shop must not read joined shop payment');
  x.state.active=ownedB.licenseCode;
  assert.deepEqual(await ref.leerReferenciaDurable('cli-joined','payment'),original);
  assert.equal(x.outgoing.length,0,'switching namespaces performs no financial POST');
});
test('P0 root: unscoped legacy payment is ambiguous after joining another shop; never debit',async()=>{
 const values=new Map();
 values.set('f123_owned',JSON.stringify(ownedA));
 values.set('f123_customer_payment_intent_v1:cli-A',JSON.stringify({opId:'customer-payment:other-shop',monto:5,motivo:'Abono'}));
 const x=make({storage:values,active:ownedB.licenseCode});
 await assert.rejects(x.win.ocEnviarAbono('cli-A',5,'Abono'),/conflict|referencia|unscoped/i);
 assert.equal(x.outgoing.length,0);
});
test('P0 root: license/role switch between read and commit may not reuse another notebook receipt',async()=>{
 const x=make();
 const ref=x.win.__creditRegression;
 const pending={opId:'customer-payment:stale-guard',monto:5,motivo:'Abono'};
 await ref.guardarReferenciaPagoDurable(ref.claveAbono('cli-A'),pending,false,'cli-A','payment');
 x.state.role='';
 await assert.rejects(ref.leerReferenciaDurable('cli-A','payment'),/sesión|autoriza|cambi/i);
 assert.equal(x.outgoing.length,0);
});
