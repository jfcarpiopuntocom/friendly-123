'use strict';
// QA-only real app journey: single physical-like browser context, no relay.
// Exact v698 source is served from docs/, with synthetic owner and test data.
// No changes to production runtime, specs, sync flags, PIN or inventory rules.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {startServer,openDevice,enterAs}=require('./helpers/e2e-app.cjs');
for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  test('P0 single-device ticket/event sale, stock, cash and commission survive reload · '+engineName,{timeout:120000},async()=>{
    const {srv,base}=await startServer();
    const web=await engine.launch({headless:true});
    let dev;
    try{
      const pageErrors=[];
      dev=await openDevice(web,base,{width:390,height:844,errors:pageErrors});
      const page=dev.page;
      await enterAs(page,'dueno','es');
      const fx=await page.evaluate(async()=>{
        const req=async (url,method='GET',payload)=>{
          const response=await fetch(url,{method,body:payload===undefined?undefined:JSON.stringify(payload)});
          if(!response.ok)throw Error('synthetic REST '+method+' '+url+' returned '+response.status);
          return response.json();
        };
        const associate=await req('/api/promotoras','POST',{nombre:'Synthetic browser event associate',comisionBase:40});
        const shelf=await req('/api/ubicaciones','POST',{nombre:'Synthetic browser event shelf',tipo:'socio'});
        await req('/api/ubicaciones/'+shelf.id,'PUT',{promotoraId:associate.id});
        const product=await req('/api/productos','POST',{
          nombre:'Synthetic browser class ticket',barcode:'P0-UI-ONE-V698',
          sku:'P0-UI-ONE-V698',tipoProducto:'ticket',fechaEvento:'2026-11-09',
          precio:100,costo:20,stockInicial:5,ubicacionId:shelf.id
        });
        return {pid:product.id,uid:shelf.id,associate:associate.id};
      });
      const ui=await page.evaluate(async pid=>{
        await abrirPanelVentaInfo(pid,true);
        const people=document.getElementById('vi-personas');
        const date=document.getElementById('vi-fecha');
        if(!people||!date)throw Error('Ticket sale UI people/date not visible');
        people.value='2';date.value='';
        const start=performance.now();
        await confirmarVentaConInfo(pid,true);
        return {elapsedMs:Math.round(performance.now()-start)};
      },fx.pid);
      await page.waitForFunction(async pid=>{
        const r=await fetch('/api/ventas/todas');
        return r.ok&&(await r.json()).some(v=>v.productoId===pid);
      },fx.pid,{timeout:10000,polling:150});
      const before=await page.evaluate(async fx=>{
        const req=async (url,method='GET',body)=>{
          const r=await fetch(url,{method,body:body===undefined?undefined:JSON.stringify(body)});
          if(!r.ok)throw Error('synthetic '+method+' returned '+r.status);
          return r.json();
        };
        const sales=(await req('/api/ventas/todas')).filter(v=>v.productoId===fx.pid);
        const products=await req('/api/productos');
        const sale=sales[0];
        if(!sale)throw Error('No acknowledged synthetic ticket sale');
        const settlements=await req('/api/liquidaciones?mes='+encodeURIComponent(sale.mes));
        const owing=settlements.find(x=>x.ubicacionId===fx.uid);
        const receipt=await req('/api/payouts','POST',{
          ubicacionId:fx.uid,payeeId:fx.associate,
          amountCents:1500,medioPago:'efectivo',opId:'p0-browser-v698-synthetic-receipt'
        });
        return {
          quantity:sale.cantidad,
          saleCount:sales.length,
          total:sale.total,
          stock:products.find(p=>p.id===fx.pid)?.stockActual,
          commission:sale.comisionAsociado,
          stillDue:owing?.stillDue,
          saleId:sale.id,
          receiptId:receipt.payout?.id
        };
      },fx);
      assert.equal(before.saleCount,1,'one UI confirmation must commit exactly one sale');
      assert.equal(before.quantity,2,'people=2 means two paid tickets, not one');
      assert.equal(before.stock,3,'single-device sale must subtract two physical units');
      assert.equal(before.commission,80,'40 percent of 2×$100 must be recorded');
      assert.equal(before.stillDue,80,'amount owed must match the event sale');
      assert.ok(before.receiptId,'a $15 cash commission payout must have durable receipt');

      // RED contract first: an owner physical +1 correction AFTER this
      // ticket sale/payment must be an independent durable movement, without
      // emitting a second sale or changing a commission receipt.
      const adjusted=await page.evaluate(async fx=>{
        const read=async()=>await (await fetch('/api/respaldo/exportar')).json();
        const prior=await read();
        const after=await read();
        return {
          beforeStock:prior.productos.find(p=>p.id===fx.pid)?.stockActual,
          afterStock:after.productos.find(p=>p.id===fx.pid)?.stockActual,
          additionalMovements:after.movimientos.length-prior.movimientos.length,
          saleCount:after.ventas.filter(v=>v.productoId===fx.pid).length,
          payoutCount:after.payouts.filter(p=>p.opId==='p0-browser-v698-synthetic-receipt').length
        };
      },fx);
      assert.deepEqual(adjusted,{
        beforeStock:3,afterStock:4,additionalMovements:1,
        saleCount:1,payoutCount:1
      },'physical +1 must produce exactly one local stock movement without touching sales/money');

      // Same browser context, real reload (fresh JS runtime and persistent IDB).
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.OCAuth&&typeof fetch==='function');
      const after=await page.evaluate(async ({pid,uid,saleId})=>{
        const get=async url=>{
          const r=await fetch(url);
          if(!r.ok)throw Error('post-reload read failed '+r.status);
          return r.json();
        };
        const products=await get('/api/productos');
        const sales=(await get('/api/ventas/todas')).filter(v=>v.productoId===pid);
        const sale=sales.find(v=>v.id===saleId);
        if(!sale)throw Error('sale vanished after page reload');
        const owes=(await get('/api/liquidaciones?mes='+encodeURIComponent(sale.mes)))
          .find(r=>r.ubicacionId===uid);
        const backup=await get('/api/respaldo/exportar');
        return {
          stock:products.find(x=>x.id===pid)?.stockActual,
          quantity:sale.cantidad,
          saleCount:sales.length,
          commission:sale.comisionAsociado,
          stillDue:owes?.stillDue,
          payoutCount:backup.payouts.filter(x=>x.opId==='p0-browser-v698-synthetic-receipt').length
        };
      },{pid:fx.pid,uid:fx.uid,saleId:before.saleId});
      assert.deepEqual(after,{
        stock:4,quantity:2,saleCount:1,commission:80,stillDue:65,payoutCount:1
      },'stock, event ticket sale, payment and commission must persist after reload');
      console.log('P0_ONE_DEVICE_EVENT_BROWSER',JSON.stringify({
        engine:engineName,uiSaleReturnMs:ui.elapsedMs,
        saleCount:after.saleCount,quantity:after.quantity,stock:after.stock,
        cashPayoutReceipts:after.payoutCount,commissionDue:after.stillDue,
        relayNetworkBlocked:true
      }));
    }finally{
      if(dev)await dev.ctx.close().catch(()=>{});
      await web.close().catch(()=>{});
      await new Promise(resolve=>srv.close(resolve));
    }
  });
}
