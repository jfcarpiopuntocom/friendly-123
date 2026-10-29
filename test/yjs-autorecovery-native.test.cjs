const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require('playwright');
test('real durable ledgers recover four IDB aborts without a new Yjs update and survive two-profile reopen',async()=>{
 const server=http.createServer((q,r)=>r.end('<!doctype html><title>Synthetic ledger recovery</title>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profiles=[0,1].map(()=>fs.mkdtempSync(path.join(os.tmpdir(),'friendly-yjs-recovery-'))),contexts=[];
 const launch={headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})};
 async function open(i){
  const c=await chromium.launchPersistentContext(profiles[i],launch);contexts[i]=c;const p=await c.newPage();
  await p.goto('http://127.0.0.1:'+server.address().port);
  await p.evaluate(i=>{
   if(!localStorage.getItem('f123_owned'))localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-RECOVERY-ONLY',instanceId:'synthetic-device-'+i}));
   window.WebSocket=class{constructor(){throw Error('production network prohibited');}};window.BroadcastChannel=class{constructor(){throw Error('profiles isolated');}};
   const timer=window.setTimeout;window.__retryDelays=[];window.setTimeout=function(fn,ms,...args){if(ms>=2000&&ms<=600000){__retryDelays.push(ms);return timer(fn,20,...args);}return timer(fn,ms,...args);};
   window.OCAuth={rolActual:()=> 'dueno'};
  },i);
  for(const f of ['estado-ab.js','core/payout-ledger.js','core/business-read-model.js','crypto-store.js','mock-backend.js','vendor/yjs-bundle.min.js','sync-yjs.js','hechos.js','cartera.js','caja-chica.js']){
   const file=f==='sync-yjs.js'&&process.env.YJS_SOURCE_OVERRIDE?process.env.YJS_SOURCE_OVERRIDE:path.join(__dirname,'../docs',f);
   await p.addScriptTag({content:fs.readFileSync(file,'utf8')});
  }
  await p.waitForFunction(()=>window.OCYjs&&OCYjs.estado==='activo'&&OCYjs._store&&window.AMG&&AMG.Hechos,null,{timeout:10000});
  return p;
 }
 async function pump(a,b){const u=await a.evaluate(()=>Array.from(Y.encodeStateAsUpdate(OCYjs.doc)));await b.evaluate(u=>Y.applyUpdate(OCYjs.doc,new Uint8Array(u),'red'),u);}
 async function request(p,url,body){return p.evaluate(async([url,body])=>{const r=await fetch(url,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});return{status:r.status,value:await r.json()};},[url,body]);}
 async function until(p,fn,arg,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(20);}throw Error('Durable predicate did not become true');}
 try{
  let a=await open(0),b=await open(1);
  const productResponse=await request(a,'/api/productos',{nombre:'Synthetic stock item',barcode:'SYN-RECOVERY',precio:5,costo:2,stockInicial:10});assert.equal(productResponse.status,200,JSON.stringify(productResponse));const product=productResponse.value;
  const client=(await request(a,'/api/clientes',{nombre:'Synthetic credit customer'})).value;
  await request(a,'/api/clientes/'+client.id+'/fiar',{monto:15,motivo:'Synthetic credit',opId:'synthetic-credit-15'});
  await a.waitForFunction(()=>OCYjs.hechosMap.size>0);await a.evaluate(()=>OCYjs._store.sembrar());await pump(a,b);
  await until(b,async id=>{const r=await fetch('/api/productos');return(await r.json()).some(p=>p.id===id);},product.id);
  await request(a,'/api/productos/'+product.id+'/venta',{cantidad:2,info:{formaPago:'efectivo'}});
  await request(b,'/api/productos/'+product.id+'/venta',{cantidad:1,info:{formaPago:'efectivo'}});
  await b.evaluate(()=>{
   window.__aborts=0;
   for(const method of ['add','put']){const original=IDBObjectStore.prototype[method];IDBObjectStore.prototype[method]=function(row,...args){const req=original.call(this,row,...args);if(this.name==='hechos'&&row.tipo==='cartera_abono'&&__aborts<4){__aborts++;this.transaction.abort();}return req;};}
  });
  const paid=await request(a,'/api/clientes/'+client.id+'/abonar',{monto:5,motivo:'Synthetic partial payment',opId:'synthetic-pay-5'});assert.equal(paid.status,200);
  await a.waitForFunction(()=>Array.from(OCYjs.hechosMap.values()).some(h=>h.tipo==='cartera_abono'));
  await a.evaluate(()=>OCYjs._store.sembrar());await b.evaluate(()=>OCYjs._store.sembrar());
  await pump(a,b);await pump(b,a);
  await until(b,async()=>{const h=await AMG.Hechos.todos();return h.some(x=>x.tipo==='cartera_abono');}).catch(async e=>{throw Error(e.message+': '+JSON.stringify(await b.evaluate(async()=>({aborts:__aborts,ledger:(await AMG.Hechos.todos()).map(h=>h.tipo),yjs:Array.from(OCYjs.hechosMap.values()).map(h=>h.tipo)}))));});
  assert.equal(await b.evaluate(()=>__aborts),4,'four real IndexedDB transactions aborted before autonomous recovery: '+JSON.stringify(await b.evaluate(()=>AMG.Hechos.todos())));
  assert.equal((await b.evaluate(id=>AMG.Cartera.saldoDeCliente(id),client.id)).saldo,-10);
  assert.equal((await request(b,'/api/productos')).value.find(p=>p.id===product.id).stockActual,7);
  await pump(a,b);await pump(a,b);await pump(b,a);
  assert.equal((await b.evaluate(()=>AMG.Hechos.todos())).filter(h=>h.tipo==='cartera_abono').length,1);
  const bad=await request(a,'/api/clientes/'+client.id+'/abonar',{monto:6,motivo:'Synthetic partial payment',opId:'synthetic-pay-5'});assert.equal(bad.status,409);
  await b.evaluate(()=>{
   const original=AMG.Hechos.importarRemoto;window.__invalidAttempts=0;
   AMG.Hechos.importarRemoto=function(h){if(h.id==='synthetic-invalid')__invalidAttempts++;return original(h);};
   OCYjs.doc.transact(()=>OCYjs.hechosMap.set('synthetic-invalid',{id:'synthetic-invalid',instanceId:'synthetic-invalid',autor:'dueno',reloj:{synthetic:1},ts:1000,tipo:'cartera_abono',datos:{monto:999},hashPrevio:'',hash:'invalid'}),'red');
  });
  await until(b,()=>__invalidAttempts===1);await b.waitForTimeout(150);assert.equal(await b.evaluate(()=>__invalidAttempts),1,'permanently invalid facts stay rejected without a retry loop');
  // No further remote update is needed to replay durable Y.Doc facts after reopening.
  await a.evaluate(()=>OCSync.confirmarCatalogoDurable());await b.evaluate(()=>OCSync.confirmarCatalogoDurable());await a.waitForTimeout(150);
  await contexts[0].close();await contexts[1].close();a=await open(0);b=await open(1);
  for(const p of[a,b]){
   await until(p,async()=>Array.from(await AMG.Hechos.todos()).some(h=>h.tipo==='cartera_abono'));
   assert.equal((await p.evaluate(id=>AMG.Cartera.saldoDeCliente(id),client.id)).saldo,-10);
   assert.equal((await request(p,'/api/productos')).value.find(p=>p.id===product.id).stockActual,7);
   assert.equal((await p.evaluate(()=>AMG.Hechos.todos())).filter(h=>h.tipo==='cartera_abono').length,1);
  }
  await pump(a,b);
  assert.equal((await b.evaluate(()=>AMG.Hechos.todos())).filter(h=>h.tipo==='cartera_abono').length,1);
 }finally{for(const c of contexts)try{await c.close();}catch{}await new Promise(r=>server.close(r));}
});
