'use strict';
// Real markup/styles/identity handlers, synthetic local session and network only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const header=html.slice(html.indexOf('<header>'),html.indexOf('</header>')+9);
const start=html.indexOf('<section id="vista-avanzado"');
const advanced=html.slice(start,html.indexOf('</section>',start)+10);
const scriptStart=html.indexOf('(function () {',html.indexOf('// --- Nombre editable del negocio'));
const script=html.slice(scriptStart,html.indexOf('// --- Navegación ---',scriptStart));
const styles=Array.from(html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g),m=>m[0]).join('\n');
test('Advanced identity keeps header names, session roles and keyboard access at reduced viewports',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:600}});
    page.setDefaultTimeout(5000);
    await page.route('**/*',r=>r.abort());
    await page.setContent('<!doctype html><html><head>'+styles+'</head><body>'+header+advanced+'</body></html>');
    await page.evaluate(()=>{
      window.API='/api';window.role=null;window.demo=false;
      Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem(){}}});
      Object.defineProperty(window,'sessionStorage',{value:{getItem:()=>null,setItem(){}}});
      window.OCAuth={rolActual:()=>window.role,esDemo:()=>window.demo};
      window.OCTienda={nombreActivo:()=> 'Synthetic shop',esUnida:()=>false};
      window.OCMicelio={miApodo:()=> 'Synthetic tablet',ponerApodo:v=>{window.editedDevice=v;}};
      window.t=k=>k;window.tf=(k,v)=>v.name;
      window.fetch=async()=>({ok:true,json:async()=>({nombreNegocio:'Synthetic shop',ok:true})});
      window.prompt=()=>null;
    });
    await page.addScriptTag({content:script});
    await page.evaluate(()=>{role='dueno';dispatchEvent(new Event('oc-login'));document.querySelector('#vista-avanzado').classList.add('activa');});
    await page.waitForFunction(()=>document.querySelector('#oc-negocio-nombre').textContent==='Synthetic shop',null,{timeout:5000});
    assert.equal(await page.locator('header #oc-negocio-editar,header #oc-header-apodo-btn').count(),0);
    assert.equal(await page.locator('#oc-header-apodo-txt').textContent(),'Synthetic tablet');
    assert.equal(await page.locator('#oc-identity-settings').evaluate(e=>e.open),false);
    const summary=page.locator('#oc-identity-settings summary');
    await summary.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#oc-identity-settings').evaluate(e=>e.open),true);
    assert.equal(await page.locator('#oc-negocio-editar').isVisible(),true);
    assert.equal(await page.locator('#oc-header-apodo-btn').isVisible(),true);
    for(const width of [1000,390]){
      await page.setViewportSize({width,height:600});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'identity fixture must fit viewport');
      if(process.env.F123_UI_EVIDENCE)await page.screenshot({path:path.join(process.env.F123_UI_EVIDENCE,'advanced-'+width+'.png'),fullPage:true});
    }
    await page.evaluate(()=>{role='admin';dispatchEvent(new Event('oc-login'));});
    assert.equal(await page.locator('#oc-negocio-editar').isVisible(),false,'admin cannot edit store');
    assert.equal(await page.locator('#oc-header-apodo-btn').isVisible(),true);
    await page.evaluate(()=>{role='dueno';demo=true;dispatchEvent(new Event('oc-login'));});
    assert.equal(await page.locator('#oc-negocio-editar').isVisible(),false,'demo cannot rename store');
    await page.evaluate(()=>{role=null;dispatchEvent(new Event('oc-logout'));dispatchEvent(new Event('oc-lang-change'));});
    assert.equal(await page.locator('#oc-header-apodo-btn').isVisible(),false,'late paint must not restore editor');
  }finally{await browser.close();}
});
