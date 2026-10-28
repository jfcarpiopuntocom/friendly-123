// v492 (JFC 2026-10-13, decision mayor: los clientes nunca reenganchan). A pending new
// version adopts automatically at a safe moment after durable confirmation (no PIN), and never
// loops. Without this, a client with an open session stayed on the old version forever.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const ORIGIN='http://localhost:18492',DOCS=path.resolve(__dirname,'../docs');
async function abrir(engine){
 const web=await engine.launch({headless:true});
 const ctx=await web.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==ORIGIN)return r.abort();const f=path.resolve(DOCS,u.pathname.slice(1));if(!f.startsWith(DOCS+path.sep))return r.abort();try{await r.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2'})[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});}catch{await r.fulfill({status:404,body:'Missing fixture asset'});}});
 await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}addEventListener(){}send(){}close(){}};
  // serviceWorker is blocked in tests: give the auto-update code a minimal stand-in.
  if(!('serviceWorker' in navigator))Object.defineProperty(navigator,'serviceWorker',{value:{controller:null,addEventListener(){},removeEventListener(){},getRegistration:async()=>null,register:async()=>({})}});});
 const page=await ctx.newPage();await page.clock.install({time:new Date('2026-10-25T17:00:00Z')});await page.goto(ORIGIN+'/index.html');
 await page.waitForFunction(()=>window._ocActSola&&window.OCAuth);
 return {web,page};
}
async function assertNoMainFrameNavigation(page,label,action){
 const navigation=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame(),timeout:300}).then(()=>true,()=>false);
 let actionError=null;try{await action();}catch(error){actionError=error;}
 const navigated=await navigation;
 assert.equal(navigated,false,label+': must not navigate');
 if(actionError)throw actionError;
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('pending version adopts at safe idle after durable confirmation ('+name+')',async()=>{
  const {web,page}=await abrir(engine);try{
  // The real published version is used, so the pre-existing load-time version check stays quiet.
  const prep=()=>page.evaluate(async()=>{const vj=await (await fetch('./version.json',{cache:'no-store'})).json();
   sessionStorage.setItem('f123_sesion',JSON.stringify({rol:'dueno'}));sessionStorage.setItem('f123_act_sola_pendiente','1');
   localStorage.setItem('f123_version_vista',vj.version+'|'+vj.shell);const g=document.getElementById('oc-gate');if(g)g.style.display='none';
   if(document.activeElement)document.activeElement.blur();window.__marca=Math.random();return window.__marca;});
  // A recent input/gesture wins even if the version is already pending.
  let m=await prep();
  await page.evaluate(()=>{window.OCSync.confirmarCatalogoDurable=async()=>false;});
  await assertNoMainFrameNavigation(page,'recent input',()=>page.evaluate(()=>{window.dispatchEvent(new Event('input'));window._ocActSola.intentar();}));
  assert.equal(await page.evaluate(()=>window.__marca),m,'recent input preserves the current page');
  await assertNoMainFrameNavigation(page,'recent pointer gesture',()=>page.evaluate(()=>{window.dispatchEvent(new Event('pointerdown'));window._ocActSola.intentar();}));
  assert.equal(await page.evaluate(()=>window.__marca),m,'recent gesture preserves the current page');
  // After 92 virtual seconds idle, a visible dialog still blocks the interval-triggered attempt.
  await page.evaluate(()=>{document.getElementById('oc-modal-overlay').style.display='flex';});
  await assertNoMainFrameNavigation(page,'open dialog after idle window',()=>page.clock.fastForward(92000));
  assert.equal(await page.evaluate(()=>window.__marca),m,'idle interval does not reload while a dialog is open');
  // Even after the idle window, failed durable confirmation must defer adoption.
  await page.evaluate(()=>document.getElementById('oc-modal-overlay').style.display='none');
  await assertNoMainFrameNavigation(page,'idle without durable ACK',()=>page.evaluate(()=>window._ocActSola.intentar()));
  assert.equal(await page.evaluate(()=>window.__marca),m,'failed save preserves the page');
  // Safe idle adoption requires a durable ACK and no active recovery.
  await page.evaluate(()=>{
    window.OCYjs={estado:'apagado'};
    window.OCSync.confirmarCatalogoDurable=async()=>true;
    window._ocActSola.vigilar();
    if(document.activeElement)document.activeElement.blur();
  });
  const loaded=page.waitForEvent('load',{timeout:5000});
  assert.equal(await page.locator('#f123-aviso-version').count(),0,'no update banner');
  await page.evaluate(()=>window._ocActSola.intentar());
  await loaded;
  await page.waitForFunction(()=>window._ocActSola);
  assert.equal(await page.evaluate(()=>window.__marca),undefined,'safe idle durable adoption reloads');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('f123_sesion')!==null),true,'session kept');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('f123_act_sola_pendiente')),null,'pending cleared');
  // Anti-loop: once the page is idle again, the same shell still cannot reload twice within 10 min.
  m=await prep();
  await assertNoMainFrameNavigation(page,'same-version anti-loop after idle',()=>page.clock.fastForward(92000));
  assert.equal(await page.evaluate(()=>window.__marca),m,'no second automatic reload for the same version');
  // The old version-floor flag alone must NOT trigger the automatic reload.
  m=await page.evaluate(()=>{localStorage.removeItem('f123_autorecarga');sessionStorage.removeItem('f123_act_sola_pendiente');sessionStorage.setItem('f123_reload_al_entrar','1');window.__marca=7;return 7;});
  await assertNoMainFrameNavigation(page,'legacy flag without pending version',()=>page.evaluate(()=>window._ocActSola.intentar()));
  assert.equal(await page.evaluate(()=>window.__marca),7,'legacy flag alone does not reload');
  }finally{await web.close();}
 });
}
