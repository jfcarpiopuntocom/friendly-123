'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

for (const [label,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
  test('C100 app toolbar shows beneficiary-first view with exact per-rack payee '+label,async()=>{
    const browser=await engine.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.F123CommissionsByPerson && typeof window.cambiarVistaComisiones==='function');
      await page.evaluate(()=>{
        window.__c100Payments=[];
        const origFetch=window.fetch;
        window.fetch=(url,...args)=>{
          if(String(url).startsWith('/api/liquidaciones?'))return Promise.resolve({ok:true,json:async()=>[
            {ubicacionId:'r1',ubicacion:'Books',pctEfectivo:85,payoutBalances:[
              {payeeId:'ana-id',nombre:'Ana',earned:85.10,paid:25.10,held:5,due:55},
              {payeeId:'alex-id',nombre:'Alex',earned:20,paid:5,held:0,due:15}]},
            {ubicacionId:'r2',ubicacion:'Posters',pctEfectivo:30,payoutBalances:[
              {payeeId:'ana-id',nombre:'Ana',earned:34.40,paid:10,held:0,due:24.40}]}
          ]});
          return origFetch(url,...args);
        };
        window.marcarComisionPagada=(rack,name,due,id)=>{window.__c100Payments.push({rack,name,due,id})};
        const cont=document.getElementById('listaComisiones');
        cont.innerHTML='<div data-commissions-toolbar><label>Month <select data-commissions-month><option value="2026-11">November</option></select></label><div role="tablist"><button data-commissions-view="product" aria-selected="true" role="tab">Product</button><button data-commissions-view="rack" aria-selected="false" role="tab">Rack</button></div></div><section id="comm-panel-product" data-commissions-section="by-product"></section><section id="comm-panel-rack" data-commissions-section="by-rack-event" hidden></section>';
      });
      const tab=page.locator('#comm-tab-person');await tab.waitFor();await tab.click();
      await page.waitForFunction(()=>document.querySelectorAll('#comm-panel-person [data-cm-person-id]').length===2);
      const x=await page.evaluate(()=>{
        const panel=document.querySelector('#comm-panel-person');
        return {
          visible:!panel.hidden, productHidden:document.querySelector('#comm-panel-product').hidden,
          aria:document.querySelector('#comm-tab-person').getAttribute('aria-selected'),
          month:document.querySelector('[data-commissions-month]').value,
          ana:panel.querySelector('[data-cm-person-id="ana-id"]').innerText,
          people:panel.querySelectorAll('[data-cm-person-id]').length,
          choice:[...document.querySelector('[data-commissions-person-select]').options].map(x=>x.textContent)
        };
      });
      assert.equal(x.visible,true);assert.equal(x.productHidden,true);assert.equal(x.aria,'true');assert.equal(x.month,'2026-11');
      assert.equal(x.people,2);assert.match(x.ana,/119\.50/);assert.match(x.ana,/35\.10/);assert.match(x.ana,/79\.40/);
      assert.deepEqual(x.choice,['All people','Alex','Ana']);
      await page.locator('[data-cm-person-id="ana-id"] details summary').click();
      const payments=page.locator('[data-cm-person-id="ana-id"] [data-cm-person-pay]');
      assert.equal(await payments.count(),2);
      await payments.nth(1).click();
      const calls=await page.evaluate(()=>window.__c100Payments);
      assert.deepEqual(calls,[{rack:'r2',name:'Ana',due:24.4,id:'ana-id'}]);
      await page.locator('[data-commissions-view="rack"]').click();
      assert.equal(await page.locator('#comm-panel-person').evaluate(el=>el.hidden),true);
      assert.equal(await page.locator('#comm-panel-rack').evaluate(el=>el.hidden),false);
      await page.evaluate(()=>window.cambiarVistaComisiones('person'));
      await page.waitForFunction(()=>document.querySelectorAll('#comm-panel-person [data-cm-person-id]').length===2);
      assert.equal(await page.locator('#comm-tab-person').getAttribute('aria-selected'),'true');
    }finally{await browser.close();}
  });
}
