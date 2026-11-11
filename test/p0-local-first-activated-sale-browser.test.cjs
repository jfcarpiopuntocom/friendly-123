'use strict';
// Real local HTTP app with synthetic activated notebook, no production data.
// Not a substitute for physical iPhone PWA or a release proof.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const DOCS=path.join(__dirname,'../docs');
const TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
function server(){return http.createServer((req,res)=>{
  let u=decodeURIComponent((req.url||'/').split('?')[0]);
  if(u==='/')u='/index.html';
  const target=path.resolve(DOCS,'.'+u);
  if(!target.startsWith(path.resolve(DOCS)+path.sep)||!fs.existsSync(target)||fs.statSync(target).isDirectory()){
    res.writeHead(404);return res.end('Not found');
  }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(target)]||'application/octet-stream'});
  return res.end(fs.readFileSync(target));
});}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 '+name+' activated notebook: valid own lease sells, real logout/foreign claim 403, re-login fresh sale', {timeout:75000},async()=>{
  const srv=server();await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const browser=await engine.launch({headless:true});
  try{
   const origin='http://127.0.0.1:'+srv.address().port;
   const ctx=await browser.newContext();
   // Do not contact any real relay, license, telemetry or outside host.
   await ctx.route('**/*',route=>{
     if(route.request().url().startsWith(origin+'/'))return route.continue();
     return route.abort();
   });
   const page=await ctx.newPage();
   await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCAuth&&!!window.OCTabSession&&!!window.OCEstadoIDB);
   // Prepare a synthetic product before session activation. This test is
   // about the real SALE fence, not a product-creation request racing login.
   const initial=await page.evaluate(async browserName=>{
     OCAuth.rolActual=()=> 'dueno';
     const p=await fetch('/api/productos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
       nombre:'Activated P0 '+browserName,barcode:'P0-ACTIVATED-'+browserName,precio:15,stockInicial:4,costo:5})});
     const json=await p.json();if(!p.ok)throw Error('fixture product '+p.status+' '+JSON.stringify(json));return json.id;
   },name);
   // RED contract: even an apparent Owner role with the activated license
   // is NOT authority until this browser actually owns its tab lease.
   // Intentionally do not dispatch oc-login or seed any lease before this sale.
   const withoutLease=await page.evaluate(async ({id,browserName})=>{
     localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-P0-LOCAL-'+browserName}));
     localStorage.setItem('f123_tienda_activa','P0-ACTIVATED-NOTEBOOK-'+browserName);
     const r=await fetch('/api/productos/'+id+'/venta',{
       method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cantidad:1})
     });
     const db=await OCEstadoIDB.leer();
     const product=db&&db.productos.find(p=>p.id===id);
     return {status:r.status,stock:product&&product.stockActual,
       sales:db&&db.ventas.filter(v=>v.productoId===id).length,
       leasePending:OCTabSession.pending,liveLease:!!(await OCTabSession.authoritySnapshot())};
   },{id:initial,browserName:name});
   assert.deepEqual(withoutLease,{status:403,stock:4,sales:0,leasePending:false,liveLease:false},
     'activated Owner cannot sell without own lease: a 403 must have zero stock and money effects');
   await page.evaluate((browserName)=>{
     localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-P0-LOCAL-'+browserName}));
     localStorage.setItem('f123_tienda_activa','P0-ACTIVATED-NOTEBOOK-'+browserName);
     OCAuth.rolActual=()=> 'dueno';
     window.dispatchEvent(new Event('oc-login'));
   },name);
   await page.waitForFunction(async()=>!!(await OCTabSession.authoritySnapshot()),null,{timeout:8000});
   const sale=()=>page.evaluate(async id=>{
     const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cantidad:1})});
     return {status:r.status,json:await r.json()};
   },initial);
   // P0 missing transition: FIRST CONFIRM is initiated immediately after this tab
   // begins its OWN asynchronous PIN re-claim. The request must capture its
   // identity before waiting, then prove the live lease again at execution.
   // No artificial sleep/timeout and no change to the production 403 fence.
   const duringOwnPin=await page.evaluate(async id=>{
     window.dispatchEvent(new Event('oc-login'));
     const pendingWhenConfirmStarted=OCTabSession.pending;
     const r=await fetch('/api/productos/'+id+'/venta',{
       method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cantidad:1})
     });
     return {status:r.status,json:await r.json(),pendingWhenConfirmStarted};
   },initial);
   assert.equal(duringOwnPin.pendingWhenConfirmStarted,true,
     'first CONFIRM must start while the same tab genuinely owns a pending claim');
   assert.equal(duringOwnPin.status,200,
     'sale initiated during same-tab PIN claim must work after owner lease is proved');
   const before=await sale();assert.equal(before.status,200,'activated, current lease must be able to sell');
   const blocked=await page.evaluate(async id=>{
     const snapshot=await OCTabSession.authoritySnapshot();
     localStorage.setItem(snapshot.scope+'_claim',JSON.stringify({owner:'other-tab',at:Date.now()}));
     const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1})});
     const json=await r.json();
     localStorage.removeItem(snapshot.scope+'_claim');
     return {status:r.status,json};
   },initial);
   assert.equal(blocked.status,403,'foreign active claim must not sell');
   const logout=await page.evaluate(async id=>{
     window.dispatchEvent(new Event('oc-logout'));
     const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1})});
     return {status:r.status,json:await r.json()};
   },initial);
   assert.equal(logout.status,403,'real logout must remain forbidden');
   await page.evaluate(()=>{
     OCAuth.rolActual=()=> 'dueno';
     window.dispatchEvent(new Event('oc-login'));
   });
   await page.waitForFunction(async()=>!!(await OCTabSession.authoritySnapshot()),null,{timeout:8000});
   const afterLogin=await sale();
   assert.equal(afterLogin.status,200,'new explicit PIN sign-in starts a new valid sale');
   const persisted=await page.evaluate(async id=>{
     const s=await (await fetch('/api/respaldo/exportar')).json();
     const p=s.productos.find(p=>p.id===id);
     return {stock:p.stockActual,sales:s.ventas.filter(v=>v.productoId===id).length};
   },initial);
   assert.deepEqual(persisted,{stock:1,sales:3},
     'only three authorized sales changed stock and sales; 403s never committed');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCEstadoIDB&&typeof OCEstadoIDB.leer==='function');
   const reopened=await page.evaluate(async id=>{
     const s=await OCEstadoIDB.leer();
     const p=s.productos.find(p=>p.id===id);
     return {stock:p.stockActual,sales:s.ventas.filter(v=>v.productoId===id).length};
   },initial);
   assert.deepEqual(reopened,{stock:1,sales:3},'single device survives reload');
  } finally {await browser.close();await new Promise(r=>srv.close(r));}
 });
}
