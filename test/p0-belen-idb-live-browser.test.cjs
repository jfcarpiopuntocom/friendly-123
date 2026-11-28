'use strict';
// Real Chromium/WebKit HTTP+ESM+IndexedDB smoke, synthetic data only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const code={};
for(const name of ['plan-pagos-ui.js','pago-intento-idb.mjs'])
 code['/'+name]=fs.readFileSync(path.join(__dirname,'../docs',name));
const license='F123-SYNTHETIC-QUOTA-TEST';
function fixture(){
 const receipts=new Map(),allocations=new Map(),requests=[];
 const html=['<!doctype html><html><head><meta charset="utf-8"><title>Belén credit synthetic fixture</title>',
 '<script>',
 "localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'"+license+"',instanceId:'synthetic-device-alpha'}));",
 "window.__active='"+license+"';",
 'window.OCTienda={licenciaActual:()=>window.__active};',
 "window.OCAuth={rolActual:()=>window.__role||'dueno'};",
 "window.OCI18n={locale:()=> 'es'};",
 'window.AMG={PlanPagos:{estadoDelPlan:async()=>({hayPlan:false})}};',
 '</script>',
 '<script defer src="/plan-pagos-ui.js"></script></head><body></body></html>'].join('');
 const server=http.createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html);return;}
  if(req.method==='GET' && code[req.url]){
   res.writeHead(200,{'Content-Type':req.url.endsWith('.mjs')?'text/javascript':'application/javascript','Cache-Control':'no-store'});res.end(code[req.url]);return;
  }
  if(req.method==='GET'&&req.url.startsWith('/api/clientes/')&&req.url.endsWith('/cartera')){
   const client=req.url.split('/')[3];
   const paid=allocations.has(client+':sale:syn-1');
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({
    saldo:paid?0:-5,
    consumosPendientes:paid?[]:[{cargoKey:'sale:syn-1',monto:5,pendiente:5,estado:'pendiente',motivo:'Compra sintetica'}]
   }));return;
  }
  if(req.method==='POST'&&req.url.startsWith('/api/clientes/')&&req.url.endsWith('/abonar')){
   let chunks=[];for await(const c of req)chunks.push(c);
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const client=req.url.split('/')[3];
   requests.push({client,opId:body.opId,monto:body.monto});
   const existing=receipts.get(body.opId);
   if(existing && (existing.client!==client || existing.monto!==body.monto)){
    res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Synthetic opId conflicts'}));return;
   }
   if(!existing)receipts.set(body.opId,{client,monto:body.monto,movimientoId:'synthetic-receipt-'+receipts.size});
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({opId:body.opId,movimientoId:receipts.get(body.opId).movimientoId}));return;
  }
  if(req.method==='POST'&&req.url.startsWith('/api/clientes/')&&req.url.endsWith('/aplicar')){
   let chunks=[];for await(const c of req)chunks.push(c);
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const client=req.url.split('/')[3];
   const cargo=body.partes&&body.partes[0]&&body.partes[0].cargoKey;
   const aKey=client+':'+cargo;
   if(allocations.has(aKey)&&allocations.get(aKey).opId!==body.opId){
    res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Purchase already paid'}));return;
   }
   if(!allocations.has(aKey))allocations.set(aKey,{opId:body.opId,aplicacionId:'synthetic-alloc-'+allocations.size});
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({opId:body.opId,aplicacionId:allocations.get(aKey).aplicacionId}));return;
  }
  res.writeHead(404);res.end('missing fixture');
 });
 return {server,requests,receipts,allocations};
}
async function start(f){
 await new Promise(r=>f.server.listen(0,'127.0.0.1',r));
 return 'http://127.0.0.1:'+f.server.address().port+'/';
}
async function quota(page){
 await page.evaluate(()=>{
  const raw=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){
    if(String(key).startsWith('f123_customer_'))throw new DOMException('Synthetic full localStorage','QuotaExceededError');
    return raw.call(this,key,value);
  };
 });
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 Belén '+name+': localStorage full, POST committed, response lost, reload reuses exact IDB opId',async()=>{
  const f=fixture(),url=await start(f),web=await engine.launch({headless:true});
  try{
   const context=await web.newContext(),page=await context.newPage();
   await page.goto(url);await page.waitForFunction(()=>typeof window.ocEnviarAbono==='function');
   await quota(page);
   await page.evaluate(()=>{
      const raw=fetch.bind(window);
      window.fetch=async function(u,opts){const r=await raw(u,opts);if(String(u).endsWith('/abonar'))throw Error('Synthetic lost response after commit');return r;};
   });
   await assert.rejects(page.evaluate(()=>window.ocEnviarAbono('synthetic-client',5,'Abono')),/Synthetic lost response/);
   assert.equal(f.receipts.size,1);const op=f.requests[0].opId;
   await page.reload();await page.waitForFunction(()=>typeof window.ocEnviarAbono==='function');
   await quota(page);
   const reply=await page.evaluate(()=>window.ocEnviarAbono('synthetic-client',5,'Abono'));
   assert.equal(reply.movimientoId,'synthetic-receipt-0');
   assert.equal(f.receipts.size,1,'server recorded one business payment');
   assert.equal(f.requests.length,2,'same opId verifies prior receipt');
   assert.deepEqual(f.requests.map(x=>x.opId),[op,op]);
  }finally{await web.close();await new Promise(r=>f.server.close(r));}
 });
 test('P0 Belén '+name+': two tabs, pending receipt isolated to active notebook',async()=>{
  const f=fixture(),url=await start(f),web=await engine.launch({headless:true});
  try{
   const context=await web.newContext(),a=await context.newPage(),b=await context.newPage();
   await Promise.all([a.goto(url),b.goto(url)]);
   await Promise.all([a,b].map(p=>p.waitForFunction(()=>typeof window.ocEnviarAbono==='function')));
   await Promise.all([quota(a),quota(b)]);
   const out=await Promise.allSettled([a.evaluate(()=>ocEnviarAbono('syn-client-A',3,'Abono')),
     b.evaluate(()=>ocEnviarAbono('syn-client-A',3,'Abono'))]);
   assert.equal(out.filter(x=>x.status==='fulfilled').length>=1,true,'at least original payment can be confirmed');
   assert.equal(f.receipts.size,1,'no duplicate financial movement in same notebook');
   await a.evaluate(()=>window.__active='F123-SYNTHETIC-OTHER-SHOP');
   const newShop=await a.evaluate(()=>ocEnviarAbono('syn-client-A',3,'Abono'));
   assert.ok(newShop.movimientoId);
   assert.equal(f.receipts.size,2,'separate real business action keeps separate reference');
  }finally{await web.close();await new Promise(r=>f.server.close(r));}
 });
 test('P0 Belén '+name+': customer Pay modal works with localStorage quota and real HTTP ESM',async()=>{
  const f=fixture(),url=await start(f),web=await engine.launch({headless:true});
  try{
   const page=await web.newPage();await page.goto(url);
   await page.waitForFunction(()=>typeof window.abonarCliente==='function');
   await quota(page);
   await page.evaluate(()=>abonarCliente('syn-modal-client','Synthetic credit client'));
   await page.locator('#pp-ab-monto').fill('5');
   await page.locator('#pp-ab-ok').click({timeout:10000});
   await page.waitForFunction(()=>!document.getElementById('pp-modal-abono'),{},{timeout:10000});
   assert.equal(f.receipts.size,1,'modal confirms one payment under Safari quota');
   assert.equal(f.requests.length,1);
   assert.match(f.requests[0].opId,/^customer-payment:/);
  }finally{await web.close();await new Promise(r=>f.server.close(r));}
 });
}

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 Belén '+name+': stale empty observation cannot charge after another tab ACK; consecutive equal payments still work',async()=>{
  const f=fixture(),url=await start(f),web=await engine.launch({headless:true});
  try{
   const context=await web.newContext(),a=await context.newPage(),b=await context.newPage();
   await b.route('**/pago-intento-idb.mjs',route=>{
    const source=code['/pago-intento-idb.mjs'].toString().replace('export function createPaymentIntentStore','function originalPaymentStore');
    return route.fulfill({contentType:'text/javascript',body:source+
      '\nexport function createPaymentIntentStore(args){const s=originalPaymentStore(args);return {...s,putIfAbsent:async(p)=>{if(!window.__gatePassed){window.__gatePassed=true;await new Promise(resolve=>window.__releaseStale=resolve);}return s.putIfAbsent(p);}};}\n'});
   });
   await Promise.all([a.goto(url),b.goto(url)]);
   await Promise.all([a,b].map(p=>p.waitForFunction(()=>typeof window.ocEnviarAbono==='function')));
   await Promise.all([quota(a),quota(b)]);
   const stale=b.evaluate(()=>ocEnviarAbono('stale-client',3,'Abono')).then(value=>({value}),error=>({error:String(error)}));
   await b.waitForFunction(()=>typeof window.__releaseStale==='function');
   const first=await a.evaluate(()=>ocEnviarAbono('stale-client',3,'Abono'));
   await b.evaluate(()=>window.__releaseStale());
   const old=await stale;
   assert.match(old.error||'',/conflict|referencia|generation/i,'stale call must reject before POST');
   assert.equal(f.receipts.size,1);assert.equal(f.requests.length,1);
   const second=await a.evaluate(()=>ocEnviarAbono('stale-client',3,'Abono'));
   assert.notEqual(second.opId,first.opId,'sequential equal payments are distinct');
   assert.equal(f.receipts.size,2);assert.equal(f.requests.length,2);
  }finally{await web.close();await new Promise(r=>f.server.close(r));}
 });
 test('P0 Belén '+name+': two simultaneous Pay modals on same purchase cannot double-charge after first finishes',async()=>{
  const f=fixture(),url=await start(f),web=await engine.launch({headless:true});
  try{
   const context=await web.newContext(),a=await context.newPage(),b=await context.newPage();
   await Promise.all([a.goto(url),b.goto(url)]);
   await Promise.all([a,b].map(p=>p.waitForFunction(()=>typeof window.abonarCliente==='function')));
   await Promise.all([quota(a),quota(b)]);
   await Promise.all([
    a.evaluate(()=>abonarCliente('modal-race-client','Cliente simultaneo')),
    b.evaluate(()=>abonarCliente('modal-race-client','Cliente simultaneo'))
   ]);
   await Promise.all([
    a.locator('#pp-ab-consumos .pp-chip').first().waitFor({state:'visible',timeout:10000}),
    b.locator('#pp-ab-consumos .pp-chip').first().waitFor({state:'visible',timeout:10000})
   ]);
   await Promise.all([
    a.waitForFunction(()=>!document.getElementById('pp-ab-ok').disabled),
    b.waitForFunction(()=>!document.getElementById('pp-ab-ok').disabled)
   ]);
   await a.locator('#pp-ab-consumos .pp-chip').first().click();
   await b.locator('#pp-ab-consumos .pp-chip').first().click();
   await a.locator('#pp-ab-ok').click();
   await a.waitForFunction(()=>!document.getElementById('pp-modal-abono'),{},{timeout:10000});
   assert.equal(f.receipts.size,1,'tab A records one payment');
   assert.equal(f.allocations.size,1,'tab A records one allocation');
   await b.locator('#pp-ab-ok').click();
   await b.waitForFunction(()=>Boolean(document.getElementById('pp-ab-msg')&&document.getElementById('pp-ab-msg').textContent.trim().length>0),{},{timeout:10000});
   assert.equal(f.receipts.size,1,'tab B stale modal must fail closed BEFORE issuing a second /abonar');
   assert.equal(f.requests.length,1,'only tab A reached /abonar');
   assert.equal(await b.locator('#pp-ab-ok').isDisabled(),true,'tab B submit remains locked after conflict');
  }finally{await web.close();await new Promise(r=>f.server.close(r));}
 });
}
