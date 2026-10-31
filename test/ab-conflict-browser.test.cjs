'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer,openDevice,enterAs}=require('./helpers/e2e-app.cjs');

test('native storage conflict preserves both raw copies in export and blocks writes with a visible alert',async()=>{
  const {srv,base}=await startServer();let browser;
  try{
    browser=await chromium.launch({headless:true});
    const {ctx,page}=await openDevice(browser,base);page.setDefaultTimeout(5000);
    await enterAs(page);
    await page.evaluate(async()=>{
      if(!await OCSync.confirmarCatalogoDurable())throw Error('synthetic setup must commit');
    });
    // Strict CAS commits to IDB before scheduling its nonblocking A/B backup.
    // Wait for that real backup instead of reading an absent journal in the same turn.
    await page.waitForFunction(()=>{
      try {
        const journal=JSON.parse(localStorage.getItem('f123_estado_v4_journal')||'null');
        return journal && journal.phase==='COMMITTED' &&
          typeof journal.candidateRaw==='string' && ['A','B'].includes(journal.destino);
      } catch (_) { return false; }
    },null,{timeout:6000});
    const originals=await page.evaluate(()=>{
      const journal=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
      const body=JSON.parse(journal.candidateRaw);body.nombreNegocio='Synthetic conflicting copy';body._rev+=50;
      const foreign=JSON.stringify(body);
      localStorage.setItem('f123_estado_v4_'+journal.destino,foreign);
      return {foreign,confirmed:journal.candidateRaw};
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.OCAuth&&window.OCSync);
    await enterAs(page);
    assert.equal(await page.locator('#oc-ab-conflicto').isVisible(),true);
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
