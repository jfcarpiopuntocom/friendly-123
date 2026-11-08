'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Execute the actual loading logic, not a hand-written replacement.
// Stop the source just before its HTML rendering so we can observe stale
// money reads without involving the entire DOM, authentication or real customers.
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const from=source.indexOf('async function cargarComisiones(){');
const until=source.indexOf('  // Rec 03: botón que arma el resumen',from);
assert.ok(from>0 && until>from,'must find real Commissions data-loading boundary');
const declaration=source.slice(from,until)+
  '  painted.push({month: _ocMesComisiones, rows: filas, sales: ventasTodas});\n}\n';
const globalVar='let _ocMesComisiones = null;\n'+
  (source.includes('let _ocComisionesSolicitud = 0;')?'let _ocComisionesSolicitud = 0;\n':'');
function deferred(){
 let resolve,reject;
 const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
 return {promise,resolve,reject};
}
function fixture(){
 const requests=[],painted=[],cont={innerHTML:''};
 // Count requests that are still awaiting a response/body, not historical
 // batches launched. This catches the original 14-live-reads failure mode.
 let liveReads=0, peakReads=0;
 const context={API:'/api',painted,console,Promise,
  document:{getElementById:()=>cont},
  renderGestionPromotoras:()=>{},
  agruparVentasPorProducto:()=>[{ubicacionIds:new Set()}],
  window:{_ocMesAuto:null,_ocMesAutoHecho:true},
  fetch:url=>{
    const d=deferred();
    liveReads++;
    peakReads=Math.max(peakReads,liveReads);
    let done=false;
    const finish=()=>{if(!done){done=true;liveReads--;}};
    // Preserve the actual asynchronous fetch/json semantics. A resolved
    // response with JSON still pending counts as a live data read.
    const tracked=d.promise.then(r=>{
      if(!r || r.ok===false || typeof r.json!=='function'){finish();return r;}
      return {...r,json:(...args)=>Promise.resolve().then(()=>r.json(...args)).finally(finish)};
    },e=>{finish();throw e;});
    requests.push({url,resolve:d.resolve,reject:d.reject});
    return tracked;
  }};
 vm.createContext(context);
 vm.runInContext(globalVar+declaration,context);
 return {context,requests,painted,cont,liveReads:()=>liveReads,peakReads:()=>peakReads};
}
const deliver=(req,payload)=>{
 req.resolve({ok:true,json:async()=>payload});
};
const fulfillBatch=(requests,offset,month)=>{
 const payloads=[
  [{ubicacionId:'event-rack',mes:month,paymentStatus:month==='2026-10'?'paid':'due'}],
  [],
  [{id:month==='2026-10'?'paid-oct':'new-nov',mes:month,productoId:'event',liquidada:month==='2026-10'}],
  [{mes:month,actual:month==='2026-11',pendiente:month==='2026-10'?0:12.75}],
  {mes:month,porPagar:month==='2026-10'?0:12.75},
 ];
 for(let i=0;i<5;i++)deliver(requests[offset+i],payloads[i]);
};
test('RED: late PAID October result cannot repaint current November after month selection',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-10"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const newer=vm.runInContext('cargarComisiones()',f.context);
 assert.equal(f.requests.length,10);
 fulfillBatch(f.requests,5,'2026-11');
 await newer;
 assert.equal(f.painted.length,1);
 assert.equal(f.painted[0].rows[0].paymentStatus,'due');
 fulfillBatch(f.requests,0,'2026-10');
 await older;
 assert.equal(f.painted.length,1,'a late old response MUST NOT replace the new month');
 assert.equal(f.painted[0].month,'2026-11');
});
test('RED: stale errors cannot replace a later successful month with a blank warning',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-10"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const newer=vm.runInContext('cargarComisiones()',f.context);
 fulfillBatch(f.requests,5,'2026-11');
 await newer;
 f.requests[0].reject(Error('stale old-month network failure'));
 // The read token is intentionally held until all four sibling requests settle.
 fulfillBatch(f.requests,0,'2026-10');
 await older;
 assert.equal(f.cont.innerHTML,'','old network error cannot erase November');
 assert.equal(f.painted.length,1);
});
test('a same-month newer sync repaint supersedes an older request',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 const newer=vm.runInContext('cargarComisiones()',f.context);
 assert.equal(f.requests.length,5,'same-period reads must be serialized');
 fulfillBatch(f.requests,0,'2026-11');
 await older;
 for(let i=0;i<12&&f.requests.length<10;i++)await Promise.resolve();
 assert.equal(f.requests.length,10,'one final fresh pass follows the in-flight read');
 fulfillBatch(f.requests,5,'2026-11');
 await newer;
 assert.equal(f.painted.length,1,'stale same-month result must not repaint');
});


test('P0 1AAA: bursts of same-month commission refreshes bound in-flight historical sales reads',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const calls=Array.from({length:20},()=>vm.runInContext('cargarComisiones()',f.context));
 assert.equal(f.requests.length,5,'burst must start ONE group of five data reads, not twenty');
 fulfillBatch(f.requests,0,'2026-11');
 await calls[0];
 for(let i=0;i<12&&f.requests.length<10;i++)await Promise.resolve();
 assert.equal(f.requests.length,10,'after initial read, coalesce all later refreshes into one current-data read');
 fulfillBatch(f.requests,5,'2026-11');
 await Promise.all(calls);
 assert.equal(f.painted.length,1,'only the latest requested month paints after the storm');
 assert.equal(f.painted[0].month,'2026-11');
});


test('P0 single apparatus: switching through many months never floods its own historical reads',async()=>{
 const f=fixture();
 const calls=[];
 for(let i=1;i<=12;i++){
   vm.runInContext('_ocMesComisiones="2025-'+String(i).padStart(2,'0')+'"',f.context);
   calls.push(vm.runInContext('cargarComisiones()',f.context));
 }
 assert.ok(f.requests.length<=10,
   'A single device may run at most TWO read batches (10 requests), not '+f.requests.length+' simultaneous requests');
 let delivered=0;
 for(let round=0;round<80;round++){
   while(delivered+5<=f.requests.length){
     const month=(f.requests[delivered].url.match(/[?&]mes=(\d{4}-\d{2})/)||[])[1]||'2025-12';
     fulfillBatch(f.requests,delivered,month);
     delivered+=5;
   }
   for(let tick=0;tick<15;tick++) await Promise.resolve();
 }
 assert.equal(delivered,15,'only the first two and the FINAL month should fetch; ten stale months skipped');
 assert.deepEqual(f.requests.filter((_,i)=>i%5===0).map(x=>(x.url.match(/[?&]mes=(\d{4}-\d{2})/)||[])[1]),['2025-01','2025-02','2025-12'],
   'the local UI must fetch only first two and last selected month');
 await Promise.all(calls);
 assert.equal(f.painted.length,1,'only the last selected month may paint the app');
 assert.equal(f.painted[0].month,'2025-12');
 assert.equal(f.painted[0].rows[0].mes,'2025-12','latest visible data must match selected month');
});


test('P0 active requests: a rejected liquidaciones read must not free its token while four requests are still alive',async()=>{
 const f=fixture(),calls=[];
 for(const mes of ['2025-01','2025-02','2025-03']){
   vm.runInContext('_ocMesComisiones='+JSON.stringify(mes),f.context);
   calls.push(vm.runInContext('cargarComisiones()',f.context));
 }
 assert.equal(f.requests.length,10,'two batches of five are initially active');
 assert.equal(f.liveReads(),10,'all ten fetches are actually unresolved');
 f.requests[0].reject(Error('liquidaciones failed before sibling requests settled'));
 for(let tick=0;tick<25;tick++)await Promise.resolve();
 assert.equal(f.liveReads(),9,'the early failed read settles but nine other network bodies remain live');
 assert.equal(f.requests.length,10,
   'still-active sibling requests keep the first token; 14 live requests must never result');
 assert.equal(f.peakReads(),10,'no more than ten reads may be live despite the early failure');
 fulfillBatch(f.requests,0,'2025-01');
 for(let tick=0;tick<60 && f.requests.length<15;tick++)await Promise.resolve();
 assert.equal(f.requests.length,15,'latest queued month starts only after entire first batch settles');
 assert.ok(f.peakReads()<=10,
   'a queued third month may start only after all five sibling bodies settled');
 fulfillBatch(f.requests,5,'2025-02');
 fulfillBatch(f.requests,10,'2025-03');
 await Promise.all(calls);
 assert.equal(f.liveReads(),0,'all fetch and JSON body reads have settled');
 assert.equal(f.painted.length,1);
 assert.equal(f.painted[0].month,'2025-03');
});

test('P0 commissions: failed liquidaciones HTTP must show an error rather than success-shaped empty data',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const run=vm.runInContext('cargarComisiones()',f.context);
 f.requests[0].resolve({ok:false,status:503,json:async()=>({error:'unavailable'})});
 fulfillBatch(f.requests,0,'2026-11');
 await run;
 assert.match(f.cont.innerHTML,/Could not load commissions/);
 assert.equal(f.painted.length,0,'a failed money read must never paint as valid');
});


test('P0 same month: a newly recorded payment must appear in the final same-month refresh',async()=>{
 const f=fixture();
 vm.runInContext('_ocMesComisiones="2026-11"',f.context);
 const older=vm.runInContext('cargarComisiones()',f.context);
 const later=vm.runInContext('cargarComisiones()',f.context);
 const latest=vm.runInContext('cargarComisiones()',f.context);
 assert.equal(f.requests.length,5,'multiple refreshes start only one live batch');
 // In this synthetic read fixture the first batch sees the pre-payment view.
 // The transaction itself is not executed here: its durability is covered
 // separately by the financial write tests. This asserts fresh read ordering.
 const before=[
   [{ubicacionId:'event-rack',mes:'2026-11',paymentStatus:'due',payoutId:null}],
   [],
   [{id:'synthetic-sale',mes:'2026-11',productoId:'event',liquidada:false}],
   [{mes:'2026-11',actual:true,pendiente:12.75}],
   {mes:'2026-11',porPagar:12.75}
 ];
 before.forEach((payload,i)=>deliver(f.requests[i],payload));
 await older;
 assert.equal(f.painted.length,0,'stale pre-payment read must not paint');
 for(let tick=0;tick<30&&f.requests.length<10;tick++)await Promise.resolve();
 assert.equal(f.requests.length,10,'only one trailing refresh may read after payment');
 // After the synthetic payment is durable, the trailing read sees the paid state.
 const after=[
   [{ubicacionId:'event-rack',mes:'2026-11',paymentStatus:'paid',payoutId:'synthetic-payout'}],
   [],
   [{id:'synthetic-sale',mes:'2026-11',productoId:'event',liquidada:true}],
   [{mes:'2026-11',actual:true,pendiente:0}],
   {mes:'2026-11',porPagar:0}
 ];
 after.forEach((payload,i)=>deliver(f.requests[5+i],payload));
 await Promise.all([later,latest]);
 assert.equal(f.painted.length,1,'coalesced later requests paint only once');
 assert.equal(f.painted[0].month,'2026-11');
 assert.equal(f.painted[0].rows[0].paymentStatus,'paid','last read must contain the newly recorded payment');
 assert.equal(f.painted[0].rows[0].payoutId,'synthetic-payout');
 assert.equal(f.painted[0].sales[0].liquidada,true,'final sale projection must reflect payment');
 assert.equal(f.cont.innerHTML,'','a successful payment read must not show an error');
});
