'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/app-inline-01.js','utf8');
function extract(s){const a=s.indexOf("function tarjetaPromotora(pr)"),b=s.indexOf("function rankingComisionistasPlegable",a);if(a<0||b<a)throw Error("bounds");return s.slice(a,b);}
async function exercise(s,{open,query=""}={}){
const nodes=new Map(),listeners={},people=[{id:"a",nombre:"Alpha",comisionBase:0},{id:"b",nombre:"Beta",comisionBase:25}];let html="",edits=[],requests=[];
const make=id=>({id,value:"",dataset:{},style:{},innerHTML:"",textContent:"",querySelectorAll(sel){if(id!=="listaPromotoras")return [];const re=sel.includes("archivar")?/data-archivar-promotora="([^"]+)" data-nombre-promotora="([^"]+)"/g:/data-abrir-promotora="([^"]+)"/g;return [...this.innerHTML.matchAll(re)].map(m=>({dataset:{abrirPromotora:m[1],archivarPromotora:m[1],nombrePromotora:m[2]},addEventListener(n,f){listeners[(sel.includes("archivar")?"archive-":"edit-")+m[1]]=f}}))},addEventListener(n,f){listeners[id+"-"+n]=f}});
const box={querySelector(sel){if(sel==="[data-comm-directory-fold]")return open===undefined?null:{open};if(sel==="#promBuscar")return query?{value:query}:null;return null;},set innerHTML(s){html=s;nodes.clear();for(const m of s.matchAll(/id="([^"]+)"/g))nodes.set(m[1],make(m[1]))},get innerHTML(){return html}};
const document={getElementById:id=>id==="gestionPromotoras"?box:nodes.get(id),querySelectorAll:()=>[]};
const fetch=async(url,opt)=>{requests.push([url,opt?.method||"GET"]);return {json:async()=>url==="/api/promotoras"?people:[]}};
const env={document,fetch,API:"/api",window:{t:k=>k,tf:(k,a)=>k+JSON.stringify(a)},normalizarTexto:s=>String(s).toLowerCase(),escHtml:s=>String(s),abrirEditorComisionista:id=>edits.push(id),ocConfirm:async()=>false,ocAlert:async()=>{}};
await new Function(...Object.keys(env),"let _promotorasVivasCache=[];"+extract(s)+"\nreturn renderGestionPromotoras();")(...Object.values(env));const list=nodes.get("listaPromotoras");if(listeners["edit-b"])listeners["edit-b"]();if(listeners["archive-b"])await listeners["archive-b"]();
return {fold:html.includes("data-comm-directory-fold"),open:html.includes("data-comm-directory-fold open"),heading:(html.match(/comm\.g\.listHeading/g)||[]).length,formOutside:html.indexOf("btnAltaPromotora")<html.indexOf("data-comm-directory-fold"),query:nodes.get("promBuscar").value,alpha:list.innerHTML.includes('data-abrir-promotora="a"'),beta:list.innerHTML.includes('data-abrir-promotora="b"'),edits,requests,archive:!!listeners["archive-b"]};
}
test('directory: independent disclosure, one heading, all agents including zero, edit and archive preserved',async()=>{const r=await exercise(source);assert.ok(r.fold&&r.open&&r.formOutside&&r.alpha&&r.beta&&r.archive);assert.equal(r.heading,1);assert.deepEqual(r.edits,['b']);assert.ok(r.requests.every(x=>x[1]==='GET'));});
test('directory: opened disclosure survives reactive repaint',async()=>{const r=await exercise(source,{open:true});assert.equal(r.open,true);});
test('directory: closed disclosure and search survive reactive repaint',async()=>{const r=await exercise(source,{open:false,query:'beta'});assert.equal(r.open,false);assert.equal(r.query,'beta');assert.equal(r.alpha,false);assert.equal(r.beta,true);});

for(const engine of ['chromium','webkit'])test('native '+engine+': management disclosure, search and controls remain functional',{timeout:30000},async()=>{
 const browser=await require('playwright')[engine].launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<html><body><div id="gestionPromotoras"></div><details data-comm-ranking-fold open><summary>Sales associates and consignors by results</summary></details></body></html>');
  await page.addStyleTag({content:fs.readFileSync('docs/ui2.css','utf8')});
  await page.evaluate(code=>{
   const people=[{id:'a',nombre:'Alpha',comisionBase:0},{id:'b',nombre:'Beta',comisionBase:25}];
   window.t=k=>k==='comm.g.listHeading'?'Sales associates and consignors':k;
   window.tf=(k,a)=>k+JSON.stringify(a);
   window.calls=[];window.edits=[];window.confirms=[];
   const env={API:'/api',fetch:async(url,opt)=>{window.calls.push([url,opt?.method||'GET']);return{json:async()=>url==='/api/promotoras'?people:[]}},normalizarTexto:s=>String(s).toLowerCase(),escHtml:s=>String(s),abrirEditorComisionista:id=>window.edits.push(id),ocConfirm:async m=>{window.confirms.push(m);return false;},ocAlert:async()=>{}};
   new Function(...Object.keys(env),'let _promotorasVivasCache=[];'+code+';window.renderGestionPromotoras=renderGestionPromotoras;')(...Object.values(env));
  },extract(source));
  await page.evaluate(()=>window.renderGestionPromotoras());
  const fold=page.locator('[data-comm-directory-fold]'),summary=fold.locator(':scope > summary');
  const form=page.locator('#btnAltaPromotora'),search=page.locator('#promBuscar'),rank=page.locator('[data-comm-ranking-fold]');
  assert.equal(await fold.count(),1);assert.equal(await summary.locator('h3').count(),1);assert.equal(await fold.evaluate(e=>e.open),true);
  assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').borderLeftColor),'rgb(0, 0, 0)');
  assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').borderLeftWidth),'8px');
  assert.notEqual(await summary.evaluate(e=>getComputedStyle(e,'::before').transform),'none');
  assert.equal(await page.locator('[data-abrir-promotora="a"]').isVisible(),true);
  await summary.click();assert.equal(await fold.evaluate(e=>e.open),false);
  assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').transform),'none');
  assert.equal(await page.locator('#promBuscarConteo').isVisible(),false);
  assert.equal(await page.locator('#listaPromotoras').isVisible(),false);
  assert.equal(await search.isVisible(),false);assert.equal(await form.isVisible(),true);assert.equal(await rank.evaluate(e=>e.open),true);
  await page.evaluate(()=>window.renderGestionPromotoras());assert.equal(await fold.evaluate(e=>e.open),false);
  await summary.click();await search.fill('Beta');
  assert.equal(await page.locator('[data-abrir-promotora="a"]').count(),0);
  await page.locator('[data-abrir-promotora="b"]').click();await page.locator('[data-archivar-promotora="b"]').click();
  assert.deepEqual(await page.evaluate(()=>window.edits),['b']);assert.equal(await page.evaluate(()=>window.confirms.length),1);
  await page.evaluate(()=>window.renderGestionPromotoras());assert.equal(await search.inputValue(),'Beta');
  assert.equal(await page.locator('[data-abrir-promotora="b"]').isVisible(),true);
  assert.ok((await page.evaluate(()=>window.calls)).every(c=>c[1]==='GET'));
 }finally{await browser.close();}
});
