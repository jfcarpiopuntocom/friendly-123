'use strict';
// P0 sales #608/#609: real DOM and strict IndexedDB CAS on ONE browser.
// Synthetic data, no customer license or remote network. Sync3 code stays intact.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

const INDEX=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const WS_STUB='window.WebSocket=class { constructor(){this.readyState=3;} send(){} close(){} addEventListener(){} removeEventListener(){} };window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;';

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 one browser '+name+': slow durable sale + double tap creates one receipt, stock -1 and survives reload',
 {timeout:60000},async()=>{
  const web=await engine.launch({headless:true});
  try{
   const context=await web.newContext();
   await context.route(u=>!/^(file|data|blob|about):/.test(u.protocol),route=>route.abort());
   const page=await context.newPage();
   await page.addInitScript(WS_STUB);
   page.setDefaultTimeout(10000);
   await page.goto(INDEX,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof window.venderUno==='function'&&
     typeof window.OCEstadoIDB?.guardarConRevision==='function'&&!!window.OCAuth);
   const id=await page.evaluate(async engineName=>{
     OCAuth.rolActual=()=> 'dueno';
     document.getElementById('oc-gate')?.remove();
     const res=await fetch('/api/productos',{
       method:'POST',
       body:JSON.stringify({nombre:'Synthetic slow durable sale '+engineName,
         barcode:'P0-SALE-BROWSER-'+engineName,precio:15,costo:6,stockInicial:3})
     });
     const body=await res.json();
     if(!res.ok)throw new Error('fixture product creation: '+JSON.stringify(body));
     return body.id;
   },name);
   await page.evaluate(productId=>{
     const idb=window.OCEstadoIDB;
     const save=idb.guardarConRevision.bind(idb);
     let release;
     const latch=new Promise(resolve=>release=resolve);
     window.__p0Sale={attempts:0,settled:false,release:()=>release(),receipt:null};
     idb.guardarConRevision=(snapshot,revision)=>{
       if(!(snapshot.ventas||[]).some(v=>v.productoId===productId))return save(snapshot,revision);
       window.__p0Sale.attempts++;
       return latch.then(()=>save(snapshot,revision));
     };
     const originalToast=window.mostrarToastAnular;
     window.mostrarToastAnular=(saleId,...args)=>{
       window.__p0Sale.receipt=saleId;
       return originalToast(saleId,...args);
     };
     window.__p0Sale.first=window.venderUno(productId).then(()=>{
       window.__p0Sale.settled=true;
     });
     window.__p0Sale.second=window.venderUno(productId);
   },id);
   await page.waitForFunction(()=>window.__p0Sale?.attempts===1);
   assert.deepEqual(await page.evaluate(()=>({
     attempts:window.__p0Sale.attempts,settled:window.__p0Sale.settled
   })),{attempts:1,settled:false},'no acknowledgement before strict durable CAS');
   // Repeat the actual product while the first strict save is unresolved.
   await page.evaluate(productId=>window.venderUno(productId),id);
   assert.equal(await page.evaluate(()=>window.__p0Sale.attempts),1,
     'rapid second touch cannot create a second sale');
   await page.evaluate(async()=>{
     window.__p0Sale.release();
     await Promise.all([window.__p0Sale.first,window.__p0Sale.second]);
   });
   const result=await page.evaluate(async productId=>{
     const snapshot=await(await fetch('/api/respaldo/exportar')).json();
     const sales=snapshot.ventas.filter(v=>v.productoId===productId);
     const product=snapshot.productos.find(p=>p.id===productId);
     return {stock:product?.stockActual,sales:sales.map(v=>v.id),
       receipt:window.__p0Sale.receipt,attempts:window.__p0Sale.attempts};
   },id);
   assert.equal(result.stock,2,'exactly one unit deducted');
   assert.equal(result.sales.length,1,'exactly one durable sale recorded');
   assert.equal(result.receipt,result.sales[0],'visible receipt points to the single saved sale');
   assert.equal(result.attempts,1,'only one actual strict CAS sale attempt');

   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCAuth&&window.OCEstadoIDB);
   const reopened=await page.evaluate(async productId=>{
     OCAuth.rolActual=()=> 'dueno';
     const state=await(await fetch('/api/respaldo/exportar')).json();
     return {stock:state.productos.find(p=>p.id===productId)?.stockActual,
       count:state.ventas.filter(v=>v.productoId===productId).length};
   },id);
   assert.deepEqual(reopened,{stock:2,count:1},
     'same browser after reload preserves the sale and stock without another device');
  }finally{await web.close();}
 });
}


for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 one browser '+name+': rejected strict CAS does not create a phantom sale, stock or audit',
 {timeout:60000},async()=>{
  const web=await engine.launch({headless:true});
  try{
   const context=await web.newContext();
   await context.route(u=>!/^(file|data|blob|about):/.test(u.protocol),route=>route.abort());
   const page=await context.newPage();
   await page.addInitScript(WS_STUB);
   page.setDefaultTimeout(10000);
   await page.goto(INDEX,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCAuth&&
     typeof window.OCEstadoIDB?.guardarConRevision==='function');
   const id=await page.evaluate(async engineName=>{
     OCAuth.rolActual=()=> 'dueno';
     const res=await fetch('/api/productos',{
       method:'POST',
       body:JSON.stringify({nombre:'Synthetic rejected sale '+engineName,
         barcode:'P0-REJECT-SALE-'+engineName,precio:18,costo:7,stockInicial:4})
     });
     const p=await res.json();
     if(!res.ok)throw Error('setup product: '+JSON.stringify(p));
     return p.id;
   },name);
   const baseline=await page.evaluate(async productId=>{
     const s=await(await fetch('/api/respaldo/exportar')).json();
     return {
       stock:s.productos.find(p=>p.id===productId)?.stockActual,
       saleIds:s.ventas.filter(v=>v.productoId===productId).map(v=>v.id),
       movementCount:s.movimientos.length
     };
   },id);
   assert.equal(baseline.stock,4);
   assert.equal(baseline.saleIds.length,0);
   await page.evaluate(productId=>{
     const idb=window.OCEstadoIDB;
     const original=idb.guardarConRevision.bind(idb);
     window.__p0RejectedCAS=0;
     idb.guardarConRevision=(state,revision)=>{
       if((state.ventas||[]).some(v=>v.productoId===productId)){
         window.__p0RejectedCAS++;
         return Promise.resolve(false);
       }
       return original(state,revision);
     };
   },id);
   const response=await page.evaluate(async productId=>{
     const r=await fetch('/api/productos/'+productId+'/venta',{
       method:'POST',body:JSON.stringify({cantidad:1,info:{formaPago:'efectivo'}})
     });
     const json=await r.json();
     return {status:r.status,code:json.code,error:json.error,
       attempted:window.__p0RejectedCAS};
   },id);
   assert.equal(response.status,503,'non-quota strict CAS refusal is not a fake space error');
   assert.equal(response.code,'SALE_DURABILITY_UNCONFIRMED');
   assert.equal(response.attempted,1,'refusal must not be replayed without a newer durable revision');
   const after=await page.evaluate(async productId=>{
     const s=await(await fetch('/api/respaldo/exportar')).json();
     return {
       stock:s.productos.find(p=>p.id===productId)?.stockActual,
       saleIds:s.ventas.filter(v=>v.productoId===productId).map(v=>v.id),
       movementCount:s.movimientos.length
     };
   },id);
   assert.deepEqual(after,baseline,'no phantom sale, stock change or audit after refused commit');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCAuth&&!!window.OCEstadoIDB);
   const reopened=await page.evaluate(async productId=>{
     OCAuth.rolActual=()=> 'dueno';
     const s=await(await fetch('/api/respaldo/exportar')).json();
     return {
       stock:s.productos.find(p=>p.id===productId)?.stockActual,
       saleIds:s.ventas.filter(v=>v.productoId===productId).map(v=>v.id),
       movementCount:s.movimientos.length
     };
   },id);
   assert.deepEqual(reopened,baseline,'reloading one apparatus must not resurrect a refused sale');
  }finally{await web.close();}
 });
}


for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 one browser '+name+': synthetic real-quota classifier returns 507 and no phantom money',
 {timeout:60000},async()=>{
  const web=await engine.launch({headless:true});
  try{
   const context=await web.newContext();
   await context.route(u=>!/^(file|data|blob|about):/.test(u.protocol),route=>route.abort());
   const page=await context.newPage();
   await page.addInitScript(WS_STUB);
   page.setDefaultTimeout(10000);
   await page.goto(INDEX,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCAuth&&
     typeof window.OCEstadoIDB?.guardarConRevision==='function');
   const productId=await page.evaluate(async engineName=>{
     OCAuth.rolActual=()=> 'dueno';
     const r=await fetch('/api/productos',{method:'POST',body:JSON.stringify({
       nombre:'Synthetic full IDB quota '+engineName,
       barcode:'P0-QUOTA-SALE-'+engineName,precio:18,costo:7,stockInicial:4
     })});
     const p=await r.json();
     if(!r.ok)throw Error('fixture creation failed: '+JSON.stringify(p));
     return p.id;
   },name);
   const read=async()=>page.evaluate(async id=>{
     const s=await(await fetch('/api/respaldo/exportar')).json();
     return {
       stock:s.productos.find(p=>p.id===id)?.stockActual,
       sales:s.ventas.filter(v=>v.productoId===id).map(v=>v.id),
       movements:s.movimientos.length
     };
   },productId);
   const baseline=await read();
   assert.equal(baseline.stock,4);
   assert.equal(baseline.sales.length,0);
   await page.evaluate(id=>{
     const obj=window.OCEstadoIDB,orig=obj.guardarConRevision.bind(obj);
     const prevError=obj.ultimoError.bind(obj);
     const quota=new DOMException('Synthetic exact IDB quota failure','QuotaExceededError');
     window.__p0QuotaAttempts=0;
     obj.guardarConRevision=(state,rev)=>{
       if((state.ventas||[]).some(v=>v.productoId===id)){
         window.__p0QuotaAttempts++;
         return Promise.resolve(false);
       }
       return orig(state,rev);
     };
     obj.ultimoError=()=>window.__p0QuotaAttempts>0?quota:prevError();
   },productId);
   const result=await page.evaluate(async id=>{
     const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',
       body:JSON.stringify({cantidad:1,info:{formaPago:'efectivo'}})});
     const body=await r.json();
     return {status:r.status,code:body.code,error:body.error,attempts:window.__p0QuotaAttempts};
   },productId);
   assert.equal(result.status,507,'a genuine QuotaExceededError classifies as storage full');
   assert.equal(result.code,'SALE_STORAGE_QUOTA');
   assert.equal(result.attempts,1,'no blind retry after actual quota');
   assert.match(result.error,/not saved|no se guard/i,'sale must explicitly report failure');
   assert.deepEqual(await read(),baseline,
     'synthetic full quota must not invent a sale, audit movement or stock delta');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCAuth&&!!window.OCEstadoIDB);
   await page.evaluate(()=>{OCAuth.rolActual=()=> 'dueno';});
   assert.deepEqual(await read(),baseline,'reopen may not resurrect an uncommitted sale');
  }finally{await web.close();}
 });
}
