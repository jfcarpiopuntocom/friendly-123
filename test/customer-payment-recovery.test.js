const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const http=require('node:http');
const {chromium,webkit}=require('playwright');
const {browser}=require('./helpers/browser.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'../docs',f),'utf8');

function coreApp(){
 const app=browser(), facts=[];
 app.OCAuth={rolActual:()=> 'dueno'};
 app.AMG={Hechos:{todos:async()=>facts.slice(),verificarCadenas:()=>({ok:true}),registrar:async(tipo,datos)=>{
  await new Promise(resolve=>setTimeout(resolve,5));
  const h={id:'synthetic-'+facts.length,tipo,datos,ts:Date.now()};facts.push(h);return h;
 }}};
 vm.runInContext(read('cartera.js'),app);
 return {app,facts};
}
test('abono retries after lost response use one durable fact, including concurrent requests',async()=>{
 const {app,facts}=coreApp();
 const c=await app.request('/api/clientes','POST',{nombre:'Synthetic payment customer'});
 await app.request('/api/clientes/'+c.id+'/fiar','POST',{monto:15});
 const body={monto:15,motivo:'Payment',opId:'synthetic-one-payment'};
 await Promise.all([app.request('/api/clientes/'+c.id+'/abonar','POST',body),app.request('/api/clientes/'+c.id+'/abonar','POST',body)]);
 assert.equal(facts.filter(h=>h.tipo==='cartera_abono').length,1);
 assert.equal((await app.request('/api/clientes/'+c.id+'/cartera')).saldo,0);
 await app.request('/api/clientes/'+c.id+'/abonar','POST',body);
 assert.equal(facts.length,2,'a retry reads the existing receipt from facts');
 assert.equal((await app.request('/api/movimientos?limite=1000')).filter(m=>m.tipo==='cartera-abono' && m.detalle.movimientoId===facts[1].id).length,1,'audit history also records the receipt once');
 await assert.rejects(()=>app.request('/api/clientes/'+c.id+'/abonar','POST',{...body,monto:14}),/409/);
 const other=await app.request('/api/clientes','POST',{nombre:'Synthetic other customer'});
 await assert.rejects(()=>app.request('/api/clientes/'+other.id+'/abonar','POST',body),/409/);
 await app.request('/api/clientes/'+c.id+'/abonar','POST',{monto:2,motivo:'Second real payment',opId:'synthetic-second-payment'});
 assert.equal((await app.request('/api/clientes/'+c.id+'/cartera')).saldo,2,'a separate real payment remains separate');
});
test('invalid or zero-rounded money never writes a payment receipt',async()=>{
 const {app,facts}=coreApp();
 for(const amount of [Infinity,NaN,0.004,-1,0,Number.MAX_VALUE]){
  await assert.rejects(()=>app.AMG.Cartera.registrarMovimiento('synthetic','abono',amount,'bad amount'));
 }
 assert.equal(facts.length,0);
 app.AMG.Hechos.registrar=async()=>null;
 await assert.rejects(()=>app.AMG.Cartera.registrarMovimiento('synthetic','abono',15,'storage failed'));
 assert.equal(facts.length,0);
});

function balanceApp(info){
 const app=browser(),el={innerHTML:''};
 app.document.getElementById=()=>el;app.API='/api';app.escHtml=s=>String(s);
 app.fmtMoney=n=>'$'+Number(n).toFixed(2);app._accionesVinculoCartera=()=>'';app.t=s=>s;
 app.OCI18n={locale:()=> 'en-US'};app.fetch=async()=>({ok:true,json:async()=>info});
 const src=read('index.html'),a=src.indexOf('async function pintarSaldoCartera(clienteId) {');
 vm.runInContext(src.slice(a,src.indexOf('\nfunction ',a)),app);
 return {app,el};
}
const zero={saldo:0,integridad:{ok:true},historial:[{tipo:'cargo',monto:15,motivo:'Five purchases'},{tipo:'abono',monto:15,motivo:'Payment received'}]};
test('settled account keeps the receipt visible instead of erasing the entire zero balance',async()=>{
 const {app,el}=balanceApp(zero);await app.pintarSaldoCartera('synthetic');
 assert.match(el.innerHTML,/Account settled/);assert.match(el.innerHTML,/Payment received/);assert.match(el.innerHTML,/\+\$15\.00/);
 assert.doesNotMatch(el.innerHTML,/cust.recordPayment/,'do not request another payment on a settled account');
});
test('a real gap still warns while keeping the recorded payment visible',async()=>{
 const {app,el}=balanceApp({...zero,integridad:{ok:false,razon:'hueco de secuencia'}});
 await app.pintarSaldoCartera('synthetic');assert.match(el.innerHTML,/pending verification/);
 assert.match(el.innerHTML,/Payment received/);assert.doesNotMatch(el.innerHTML,/Account settled/);
});
test('an old balance response cannot repaint debt after a newer payment response',async()=>{
 const {app,el}=balanceApp(zero);let release,requests=0;
 app.fetch=async()=>({json:async()=>++requests===1?await new Promise(r=>{release=r}):zero});
 const older=app.pintarSaldoCartera('synthetic');await new Promise(r=>setImmediate(r));
 await app.pintarSaldoCartera('synthetic');release({...zero,saldo:-15});await older;
 assert.match(el.innerHTML,/Account settled/);assert.doesNotMatch(el.innerHTML,/Debt \$15/);
});

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('two tabs retry the same customer payment without a second receipt ('+name+')',async()=>{
  const server=http.createServer((_req,res)=>res.end('<!doctype html><title>synthetic tab race</title>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const web=await engine.launch({headless:true});
  try{
   const context=await web.newContext(),pages=[await context.newPage(),await context.newPage()];
   for(const page of pages){
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>localStorage.setItem('f123_owned',JSON.stringify({instanceId:'synthetic-shared-tabs'})));
    for(const f of ['hechos.js','cartera.js'])await page.addScriptTag({content:read(f)});
    await page.evaluate(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{window.__hashReady=true;await new Promise(r=>window.__hashRelease=r);crypto.subtle.digest=digest;return digest(...args);};});
   }
   for(const page of pages)await page.evaluate(()=>{window.__paymentRun=AMG.Cartera.registrarMovimiento('synthetic','abono',15,'same receipt',{opId:'synthetic-two-tabs'});});
   for(const page of pages)await page.waitForFunction(()=>window.__hashReady);
   await Promise.all(pages.map(p=>p.evaluate(()=>window.__hashRelease())));
   await Promise.all(pages.map(p=>p.evaluate(()=>window.__paymentRun)));
   const result=await pages[0].evaluate(async()=>({facts:await AMG.Hechos.todos(),balance:await AMG.Cartera.saldoDeCliente('synthetic')}));
   assert.equal(result.facts.length,1);assert.equal(result.balance.saldo,15);assert.equal(result.balance.integridad.ok,true);
  }finally{await web.close();await new Promise(r=>server.close(r));}
 });
 test('fact writer preserves identity changes and lost metadata across reload ('+name+')',async()=>{
  const server=http.createServer((_req,res)=>{res.end('<!doctype html><title>synthetic payment fixture</title>')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const web=await engine.launch({headless:true});
  try{
   const page=await web.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
   for(const f of ['hechos.js','cartera.js'])await page.addScriptTag({content:read(f)});
   await page.evaluate(async()=>{
    await AMG.Cartera.registrarMovimiento('synthetic','cargo',3,'first purchase');
    await AMG.Cartera.registrarMovimiento('synthetic','cargo',12,'other purchases');
    localStorage.setItem('f123_owned',JSON.stringify({instanceId:'synthetic-activated-device'}));
    await AMG.Cartera.registrarMovimiento('synthetic','abono',15,'payment received');
   });
   const paid=await page.evaluate(async()=>({balance:await AMG.Cartera.saldoDeCliente('synthetic'),facts:await AMG.Hechos.todos()}));
   assert.equal(paid.balance.saldo,0);assert.equal(paid.balance.integridad.ok,true,'activation must start the new author at sequence 1');
   assert.equal(paid.facts.find(h=>h.tipo==='cartera_abono').id,'synthetic-activated-device-1');
   await page.evaluate(()=>localStorage.removeItem('f123_hechos_meta_v1'));
   await page.reload();for(const f of ['hechos.js','cartera.js'])await page.addScriptTag({content:read(f)});
   const next=await page.evaluate(async()=>{
    const receipt=await AMG.Cartera.registrarMovimiento('synthetic','abono',2,'next real payment');
    return {receipt,balance:await AMG.Cartera.saldoDeCliente('synthetic'),facts:await AMG.Hechos.todos()};
   });
   assert.ok(next.receipt);assert.equal(next.receipt.id,'synthetic-activated-device-2');
   assert.equal(next.balance.saldo,2);assert.equal(next.balance.integridad.ok,true);
   assert.deepEqual(next.facts.slice(0,3),paid.facts,'old receipts stay byte-for-byte unchanged');
  }finally{await web.close();await new Promise(r=>server.close(r));}
 });
}
