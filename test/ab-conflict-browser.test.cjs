'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer,openDevice,enterAs}=require('./helpers/e2e-app.cjs');

test('native storage conflict with no valid copy preserves both raw copies in export, blocks writes and records it in the health line (no banner)',async()=>{
  const {srv,base}=await startServer();let browser;
  try{
    browser=await chromium.launch({headless:true});
    const {ctx,page}=await openDevice(browser,base);page.setDefaultTimeout(5000);
    await enterAs(page);
    assert.equal(await page.evaluate(async()=>await OCSync.confirmarCatalogoDurable()),true,
      'IDB CAS must durably commit before asynchronous A/B mirror');
    await page.waitForFunction(()=>{
      try {
        const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
        return j && j.phase==='COMMITTED' && !!j.candidateRaw &&
          localStorage.getItem('f123_estado_v4_'+j.destino)===j.candidateRaw;
      }catch(_){return false;}
    },null,{timeout:8000});
    const originals=await page.evaluate(async()=>{
      const journal=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
      // v761: a valid copy now wins; only a conflict with NO valid copy still blocks.
      const confirmada=JSON.parse(journal.candidateRaw);confirmada.productos='not-a-list';
      journal.candidateRaw=JSON.stringify(confirmada);
      localStorage.setItem('f123_estado_v4_journal',JSON.stringify(journal));
      localStorage.setItem('f123_estado_v4_'+journal.destino,journal.candidateRaw);
      const body=JSON.parse(journal.candidateRaw);body.nombreNegocio='Synthetic conflicting copy';body._rev+=50;
      const foreign=JSON.stringify(body);
      localStorage.setItem('f123_estado_v4_'+(journal.destino==='A'?'B':'A'),foreign);
      return {foreign,confirmed:journal.candidateRaw};
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.OCAuth&&window.OCSync);
    await enterAs(page);
    // v767: JFC rule 28 oct 2026, no banners. The conflict is still surfaced, through the
    // existing health channel (OCSalud, Sonar in Advanced), never a fixed red bar.
    assert.equal(await page.locator('#oc-ab-conflicto').count(),0,'no fixed conflict banner');
    assert.ok(await page.evaluate(()=>(window.OCSalud.fallos()['ab-conflicto']||0)>=1),'conflict recorded in the health line');
    const result=await page.evaluate(async()=>{
      const backup=await (await fetch('/api/respaldo/exportar')).json();
      const response=await fetch('/api/config/retencion',{method:'PUT',body:JSON.stringify({dias:30})});
      return {backup,status:response.status,published:OCSync.catalogoPropio()};
    });
    assert.equal(result.status,507);assert.equal(result.published,null);
    assert.ok(result.backup.recuperacionAB.copias.some(copy=>copy.raw===originals.foreign));
    assert.ok(result.backup.recuperacionAB.copias.some(copy=>copy.raw===originals.confirmed));
    assert.ok(result.backup.recuperacionAB.journal);assert.ok(result.backup.recuperacionAB.base);
    await ctx.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>srv.close(resolve));}
});
