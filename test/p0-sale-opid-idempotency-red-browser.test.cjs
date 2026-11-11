'use strict';
// P0 RED contract: same accounting opId must NOT decrement inventory or post
// money twice. This runs against the actual browser fetch/backend/IDB path.
// It is deliberately expected to fail until the real sale implementation is
// idempotent; NO production data, no invented device evidence.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const INDEX=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const WS_STUB='window.WebSocket=class { constructor(){this.readyState=3;} send(){} close(){} addEventListener(){} removeEventListener(){} };window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;';

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 RED '+name+': duplicate sale opId is same single durable effect', {timeout:60000},async()=>{
  const browser=await engine.launch({headless:true});
  try {
   const context=await browser.newContext();
   await context.route(u=>!/^(file|data|blob|about):/.test(u.protocol),route=>route.abort());
   const page=await context.newPage();
   await page.addInitScript(WS_STUB);
   await page.goto(INDEX,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof window.OCEstadoIDB?.guardarConRevision==='function'&&!!window.OCAuth);
   const result=await page.evaluate(async engineName=>{
    OCAuth.rolActual=()=> 'dueno';
    document.getElementById('oc-gate')?.remove();
    const fetchBody=async(url,payload)=>{
     const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
     const body=await response.json();
     if(!response.ok)throw Error('synthetic route '+url+': '+JSON.stringify(body));
     return body;
    };
    const p=await fetchBody('/api/productos',{nombre:'Synthetic opId RED '+engineName,
     barcode:'P0-OPID-RED-'+engineName,precio:15,costo:5,stockInicial:3});
    const opId=crypto.randomUUID();
    const command={cantidad:1,opId,info:{formaPago:'cash'}};
    const first=await fetchBody('/api/productos/'+p.id+'/venta',command);
    const second=await fetchBody('/api/productos/'+p.id+'/venta',command);
    const product=await (await fetch('/api/productos/'+p.id)).json();
    const state=await OCEstadoIDB.leer();
    const linked=(state?.ventas||[]).filter(v=>v.productoId===p.id);
    return {opId,firstId:first.ventaId,secondId:second.ventaId,stock:product.stockActual,
     count:linked.length,accountingIds:linked.map(v=>v.opId||null)};
   },name);
   // One aggregate assertion reports every independent failed invariant, rather
   // than stopping at two different receipt IDs and hiding the stock/money result.
   assert.deepEqual({
    sameReceipt:result.firstId===result.secondId,
    stockAfterSingleSale:result.stock,
    saleCount:result.count,
    opIdInEveryReceipt:result.accountingIds.length===1&&result.accountingIds[0]===result.opId
   },{
    sameReceipt:true,
    stockAfterSingleSale:2,
    saleCount:1,
    opIdInEveryReceipt:true
   },'one opId must represent a single durable receipt, stock movement and accounting fact');
  }finally{await browser.close();}
 });
}
