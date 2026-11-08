'use strict';
// #613 P0: REAL Commissions UI in Chromium and WebKit, synthetic HTTP only.
// Assert live fetches through JSON body (not started batches), HTTP fail-closed,
// and the final selected month. No real money, remote network, or Sync3 changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const URL=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const noWS='window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;';

async function setup(engine){
 const web=await engine.launch({headless:true});
 const ctx=await web.newContext();
 await ctx.route(u=>!/^(file|data|blob|about):/.test(u.protocol),r=>r.abort());
 const page=await ctx.newPage();
 await page.addInitScript(noWS);
 page.setDefaultTimeout(12000);
 await page.goto(URL,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof window.cambiarMesComisiones==='function'&&
   typeof window.cargarComisiones==='function'&&!!window.OCAuth);
 await page.evaluate(()=>{
   OCAuth.rolActual=()=> 'dueno';
   document.getElementById('oc-gate')?.remove();
   document.querySelectorAll('.vista').forEach(x=>x.style.display='none');
   document.getElementById('vista-comisiones').style.display='block';
   window._ocMesAuto=null;window._ocMesAutoHecho=true;
   const original=window.fetch.bind(window);
   const observed={requests:[],live:0,peak:0};
   observed.payload=(url)=>{
     if(url.includes('/liquidaciones/meses'))return [
       {mes:'2025-01',actual:false,pendiente:0},
       {mes:'2025-02',actual:false,pendiente:0},
       {mes:'2025-03',actual:false,pendiente:0},
       {mes:'2026-11',actual:true,pendiente:0}
     ];
     if(url.includes('/comisiones/cuadre'))return null;
     return [];
   };
   const re=/^\/api\/(?:liquidaciones(?:\?|\/meses)|promotores\/desempeno|ventas\/todas\?ubicacionId=todas|comisiones\/cuadre\?)/;
   window.fetch=(input,options)=>{
     const url=String(input);
     if(!re.test(url))return original(input,options);
     observed.live++;
     observed.peak=Math.max(observed.peak,observed.live);
     let resolve;
     let finished=false;
     const finish=()=>{if(!finished){finished=true;observed.live--;}};
     const promise=new Promise(r=>resolve=r);
     const req={url,
       ok:()=>{
         resolve({ok:true,status:200,json:async()=>{
           const data=observed.payload(url);
           finish();
           return data;
         }});
       },
       fail:()=>{
         finish();
         resolve({ok:false,status:503,json:async()=>({error:'synthetic unavailable'})});
       },
       failEmpty:()=>{
         finish();
         resolve({ok:false,status:503,json:async()=>[]});
       }
     };
     observed.requests.push(req);
     return promise;
   };
   window.__p0CommissionBrowser=observed;
 });
 return {web,page};
}

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 Commissions '+name+': early HTTP 503 cannot admit 14 live reads; last month wins',
   {timeout:60000},async()=>{
    const {web,page}=await setup(engine);
    try{
     await page.evaluate(()=>{
       cambiarMesComisiones('2025-01');
       cambiarMesComisiones('2025-02');
       cambiarMesComisiones('2025-03');
     });
     await page.waitForFunction(()=>__p0CommissionBrowser.requests.length===10);
     const initial=await page.evaluate(()=>({
       started:__p0CommissionBrowser.requests.length,
       live:__p0CommissionBrowser.live,
       peak:__p0CommissionBrowser.peak
     }));
     assert.deepEqual(initial,{started:10,live:10,peak:10},
       'two and only two active five-read batches');
     await page.evaluate(()=>__p0CommissionBrowser.requests[0].fail());
     await page.waitForFunction(()=>__p0CommissionBrowser.live===9);
     assert.equal(await page.evaluate(()=>__p0CommissionBrowser.requests.length),10,
       'third month must not start while failed first batch has four outstanding siblings');
     await page.evaluate(()=>__p0CommissionBrowser.requests.slice(1,5).forEach(r=>r.ok()));
     await page.waitForFunction(()=>__p0CommissionBrowser.requests.length===15);
     assert.ok((await page.evaluate(()=>__p0CommissionBrowser.peak))<=10,
       'third month begins only after the entire first batch settled');
     await page.evaluate(()=>{
       __p0CommissionBrowser.requests.slice(5,10).forEach(r=>r.ok());
       __p0CommissionBrowser.requests.slice(10,15).forEach(r=>r.ok());
     });
     await page.waitForFunction(()=>__p0CommissionBrowser.live===0&&
       document.querySelector('[data-commissions-month]')?.value==='2025-03');
     const result=await page.evaluate(()=>({
       live:__p0CommissionBrowser.live,peak:__p0CommissionBrowser.peak,
       months:__p0CommissionBrowser.requests
         .filter(r=>r.url.startsWith('/api/liquidaciones?')).map(r=>r.url.match(/mes=([^&]+)/)?.[1]),
       selector:document.querySelector('[data-commissions-month]')?.value,
       error:document.getElementById('listaComisiones')?.textContent||''
     }));
     assert.equal(result.live,0);
     assert.ok(result.peak<=10,'max ten actual live fetch/JSON bodies');
     assert.deepEqual(result.months,['2025-01','2025-02','2025-03']);
     assert.equal(result.selector,'2025-03','latest selected month must remain visible');
     assert.doesNotMatch(result.error,/Could not load commissions/,
       'a stale HTTP error must not blank the newer valid month');
    }finally{await web.close();}
 });

 test('P0 Commissions '+name+': current HTTP 503 shows error instead of false empty success',
   {timeout:60000},async()=>{
    const {web,page}=await setup(engine);
    try{
      await page.evaluate(()=>cambiarMesComisiones('2026-11'));
      await page.waitForFunction(()=>__p0CommissionBrowser.requests.length===5);
      await page.evaluate(()=>{
        __p0CommissionBrowser.requests[0].fail();
        __p0CommissionBrowser.requests.slice(1,5).forEach(r=>r.ok());
      });
      await page.waitForFunction(()=>
        document.getElementById('listaComisiones')?.textContent?.includes('Could not load commissions'));
      const result=await page.evaluate(()=>({
        live:__p0CommissionBrowser.live,
        msg:document.getElementById('listaComisiones')?.textContent||'',
        falseEmpty:!!document.querySelector('[data-commissions-month]')
      }));
      assert.equal(result.live,0,'all network bodies accounted for');
      assert.match(result.msg,/Could not load commissions/);
      assert.equal(result.falseEmpty,true,
        'failed read must preserve a usable month selector');
      assert.equal(await page.locator('[data-commissions-retry]').count(),1,
        'failed read must expose a visible retry control');
    }finally{await web.close();}
 });
}


for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 for(const target of ['/api/ventas/todas?', '/api/liquidaciones/meses']){
  test('P0 Commissions '+name+': HTTP 503 on '+target+' fails closed, preserves month and offers retry',
    {timeout:60000},async()=>{
     const {web,page}=await setup(engine);
     try{
      await page.evaluate(()=>cambiarMesComisiones('2026-11'));
      await page.waitForFunction(()=>__p0CommissionBrowser.requests.length===5);
      await page.evaluate(target=>{
        const requests=__p0CommissionBrowser.requests;
        const broken=requests.find(r=>r.url.startsWith(target));
        if(!broken)throw Error('fixture did not intercept '+target);
        for(const req of requests){if(req===broken)req.failEmpty();else req.ok();}
      },target);
      await page.waitForFunction(()=>__p0CommissionBrowser.live===0);
      await page.waitForTimeout(80);
      const state=await page.evaluate(()=>({
        error:document.getElementById('listaComisiones')?.textContent||'',
        month:document.querySelector('[data-commissions-month]')?.value,
        retry:!!document.querySelector('[data-commissions-retry]')
      }));
      assert.match(state.error,/Could not load commissions/,
        'HTTP 503 '+target+' must not masquerade as a financially empty month');
      assert.equal(state.month,'2026-11',
        'the operator must retain the selected period after a request failure');
      assert.equal(state.retry,true,'retry remains available without app reload');
     }finally{await web.close();}
  });
 }
}
