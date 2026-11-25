'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function getFunc(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<=a)throw Error("function bounds "+start);return s.slice(a,b);}
function renderCase(src,query="",previous=false,lang="en") {const nodes={listaPromotoras:{innerHTML:"",querySelector(){return previous?{open:true}:null},querySelectorAll(){return[]}},promBuscarConteo:{textContent:""}};const people=[{id:"due",nombre:"Due",sinComisiones:false},{id:"none",nombre:"None",sinComisiones:true},{id:"unknown",nombre:"Unknown"}];new Function("document","window","normalizarTexto","_promotorasVivasCache","tarjetaPromotora","escHtml",src+"\nrenderListaPromotorasViva("+JSON.stringify(query)+");")({getElementById:id=>nodes[id],documentElement:{lang}},{tf:(k,a)=>JSON.stringify(a),t:k=>k},s=>s.toLowerCase(),people,p=>'<article data-person="'+p.id+'"></article>',s=>s);return nodes.listaPromotoras.innerHTML;}
const checkRender=s=>{const h=renderCase(s),d=h.indexOf("data-promotoras-sin-comisiones");return d>0&&h.indexOf('data-person="due"')<d&&h.indexOf('data-person="unknown"')<d&&h.indexOf('data-person="none"')>d&&!h.includes('data-promotoras-sin-comisiones open')&&renderCase(s,"none").includes("data-promotoras-sin-comisiones open")&&renderCase(s,"",true,"es").includes("Sin comisiones")}
const app=read('src/app/app-inline-01.js'), backend=read('docs/mock-backend.js');
const renderSrc=getFunc(app,'function renderListaPromotorasViva(query)','let _promotorasGestionRun');
const helper=getFunc(backend,'  function _promotorasConSaldoORevision()','  function ventasParaReportes(uid)');
const core=require('../docs/core/payout-ledger.js');
function ledgerCase(sales,adjusts=[],conflicts=[],quarantine=[]){return new Function("_payoutCore","ventasActivas","ventas","ubicaciones","ajustesComision","payouts","payoutConflicts","payoutQuarantine","ajusteRetencion","_demoOculto",helper+"\nreturn _promotorasConSaldoORevision();")(()=>core,()=>sales.filter(v=>!v.anulada),sales,[{id:"r"}],adjusts,[],conflicts,quarantine,{dias:7},()=>false);}
const sales=[{"id":"old","fecha":"2026-01-01","ubicacionId":"r","promotoraId":"due","split":{"montoComisionSocio":10}},{"id":"paid","fecha":"2026-01-01","ubicacionId":"r","promotoraId":"paid","liquidada":true,"split":{"montoComisionSocio":10}},{"id":"held","fecha":new Date().toISOString(),"ubicacionId":"r","promotoraId":"held","split":{"montoComisionSocio":10}},{"id":"unknown","fecha":"2026-01-01","ubicacionId":"r","promotoraId":"unknown"},{"id":"collect","fecha":"2026-01-01","ubicacionId":"r","promotoraId":"collect","direccionComision":"asociadoPaga","split":{"montoComisionSocio":10}}];
test('directory: positive and unknown visible, verified zero collapsed, search opens, bilingual and state preserved',()=>{assert.ok(checkRender(renderSrc));assert.match(app,/<details data-promotoras-directorio/);assert.match(app,/promotoras\?saldo=1/);});
test('actual ledger: historical unpaid, retained and uncertain stay visible; paid and associate-collected do not',()=>{const b=ledgerCase(sales);for(const id of ['due','held','unknown'])assert.ok(b.has(id),id);for(const id of ['paid','collect','none'])assert.ok(!b.has(id),id);assert.equal(ledgerCase(sales,[],[{}]),null);assert.equal(ledgerCase(sales,[],[],[{}]),null);});

for(const engine of ['chromium','webkit'])test('native '+engine+': both disclosure arrows, search, edit and refresh',async()=>{
  const browser=await require('playwright')[engine].launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent('<html lang="en"><body><div id="gestionPromotoras"></div></body></html>');
    const code=getFunc(app,'function tarjetaPromotora(pr)','async function abrirEditorComisionista');
    await page.evaluate(({code})=>{
      const people=[{id:'due',nombre:'Due',sinComisiones:false},{id:'zero',nombre:'Zero',sinComisiones:true},{id:'unknown',nombre:'Unknown'}];
      window.t=k=>k==='comm.g.listHeading'?'Sales associates and consignors':k;
      window.tf=(k,a)=>JSON.stringify(a);
      window.fetch=async u=>({ok:true,json:async()=>String(u).includes('/promotoras')?people:[]});
      const API='/api';let _promotorasVivasCache=[];
      const normalizarTexto=s=>String(s).toLowerCase();
      const escHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const abrirEditorComisionista=id=>{window.edited=id;};
      new Function('API','normalizarTexto','escHtml','abrirEditorComisionista', 'let _promotorasVivasCache=[];'+code+';window.renderGestionPromotoras=renderGestionPromotoras;')(API,normalizarTexto,escHtml,abrirEditorComisionista);
    },{code});
    await page.evaluate(()=>window.renderGestionPromotoras());
    const dir=page.locator('[data-promotoras-directorio]'), zero=page.locator('[data-promotoras-sin-comisiones]');
    assert.equal(await dir.evaluate(e=>e.open),true);
    assert.equal(await zero.evaluate(e=>e.open),false);
    assert.equal(await page.locator('[data-abrir-promotora="due"]').isVisible(),true);
    assert.equal(await page.locator('[data-abrir-promotora="unknown"]').isVisible(),true);
    assert.equal(await page.locator('[data-abrir-promotora="zero"]').isVisible(),false);
    await zero.locator(':scope > summary').click();
    assert.equal(await page.locator('[data-abrir-promotora="zero"]').isVisible(),true);
    await page.locator('[data-abrir-promotora="zero"]').click();
    assert.equal(await page.evaluate(()=>window.edited),'zero');
    await zero.locator(':scope > summary').click();
    await page.locator('#promBuscar').fill('Zero');
    assert.equal(await zero.evaluate(e=>e.open),true);
    assert.equal(await page.locator('[data-abrir-promotora="zero"]').isVisible(),true);
    await page.locator('#promBuscar').fill('');
    await dir.locator(':scope > summary').click();
    assert.equal(await dir.evaluate(e=>e.open),false);
    await page.evaluate(()=>window.renderGestionPromotoras());
    assert.equal(await dir.evaluate(e=>e.open),false);
    await dir.locator(':scope > summary').click();
    assert.equal(await page.locator('[data-abrir-promotora="due"]').isVisible(),true);
  } finally {await browser.close();}
});
