'use strict';
// C251: JFC explicitly requires Commissions group buttons to be independent,
// not a single-select tab set. Browser executes actual served bundle and
// commissions-by-person.js, with synthetic read-only receipts only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const URL=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const SALES=[{
  id:'c251-01',fecha:'2026-11-21',cantidad:1,precioUnit:35,
  productoId:'c251-prod',productoNombre:'Synthetic pencil',sku:'SKU-TEST',
  ubicacionId:'c251-rack',ubicacionNombre:'Test rack',
  clienteId:'c251-client',clienteNombre:'Test customer',
  promotoraId:'c251-artist',asociadoNombre:'Test associate',
  comisionAsociado:7,netoCasa:28,comisionPendiente:7,
  direccionComision:'casaPaga',direccionProducto:'casaPaga',
  formaPago:'cash'
}];
for (const engine of [chromium,webkit]) {
  test('C251 '+engine.name()+': independent Commissions groups, RAW, person, repaint',async()=>{
    const browser=await engine.launch({headless:true});
    try {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await page.goto(URL,{waitUntil:'load'});
      await page.waitForFunction(()=>window.__ocMockBackendReady &&
        typeof window.resumenComisionesGlobalHtml==='function' &&
        typeof window.cambiarRangoComisionesGlobal==='function' &&
        !!window.F123CommissionsByPerson);
      await page.addStyleTag({content:'#oc-gate,#puerta,#oc-splash{display:none!important;pointer-events:none!important}'});
      await page.evaluate(sales=>{
        window.OCAuth=Object.assign(window.OCAuth||{},{rolActual:()=> 'dueno',esDemo:()=>false});
        window._ocComHistoryGroups=['producto'];
        window._ocComHistoryGroup='producto';
        window._ocComHistorySales=sales;
        var cont=document.getElementById('listaComisiones');
        cont.innerHTML=barraComisionesHtml([], '')+resumenComisionesGlobalHtml(sales);
      },SALES);
      const group=key=>page.locator('[data-commissions-view-global="'+key+'"]');
      const pressed=async key=>(await group(key).getAttribute('aria-selected'))==='true';
      await group('cliente').click();
      assert.equal(await pressed('producto'),true,'Product stays selected after Customer');
      assert.equal(await pressed('cliente'),true,'Customer toggles on independently');
      assert.equal(await page.locator('[data-commissions-current-view="producto"]').count(),1);
      assert.equal(await page.locator('[data-commissions-current-view="cliente"]').count(),1);
      const totals=await page.locator('[data-commissions-summary="all"] .rotulo').allTextContents();
      assert.equal(totals.filter(x=>/total commissions|total de comisiones/i.test(x)).length,1,
        'multi-group report contains ONE financial summary');
      const detail=await page.locator('[data-comm-history-group]').evaluateAll(nodes=>
        nodes.map(node=>node.getAttribute('data-comm-group')));
      assert.ok(detail.some(k=>k.startsWith('["producto",')),'Product details keyed by group');
      assert.ok(detail.some(k=>k.startsWith('["cliente",')),'Customer details keyed by group');
      const keyUnique=new Set(detail);assert.equal(detail.length,keyUnique.size,'no detail ID collisions');
      await group('producto').click();
      assert.equal(await pressed('cliente'),true,'Turning off Product keeps Customer');
      assert.equal(await pressed('producto'),false);
      await group('cliente').click();
      assert.equal(await pressed('cliente'),false);
      assert.equal(await page.locator('[data-commissions-current-view="total"]').count(),1,
        'all independent switches off -> RAW');

      // By artist is also independently selectable with a group still active.
      await group('percha').click();
      await page.locator('#comm-tab-person').click();
      await page.waitForFunction(()=>window._ocVistaComisiones==='person');
      assert.equal(await pressed('percha'),true,'By artist never releases Rack');
      assert.equal(await page.locator('#comm-panel-person').isVisible(),true);
      assert.equal(await page.locator('[data-commissions-current-view="percha"]').count(),1);
      await group('cliente').click();
      assert.equal(await pressed('percha'),true);
      assert.equal(await pressed('cliente'),true);
      assert.equal(await page.locator('#comm-panel-person').isVisible(),true);
      await page.locator('#comm-tab-person').click();
      assert.equal(await pressed('percha'),true,'Turning Person off leaves Rack');
      assert.equal(await pressed('cliente'),true,'Turning Person off leaves Customer');

      // Full-history repaint (e.g. Sync4) retains selections and original UI classes.
      await page.evaluate(sales=>{
        const c=document.getElementById('listaComisiones');
        c.innerHTML=barraComisionesHtml([], '')+resumenComisionesGlobalHtml(sales);
      },SALES);
      await page.waitForFunction(()=>!!document.querySelector('#comm-tab-person'));
      assert.equal(await pressed('percha'),true);
      assert.equal(await pressed('cliente'),true);
      assert.equal(await page.locator('[data-commissions-summary="all"] .rotulo').filter({hasText:/total de comisiones|total commissions/i}).count(),1);
      await page.close();
    } finally {await browser.close();}
  });
}
