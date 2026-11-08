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
