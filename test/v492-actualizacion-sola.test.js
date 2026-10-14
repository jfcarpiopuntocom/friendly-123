// v492 (JFC 2026-10-13, decision mayor: los clientes nunca reenganchan). A pending new
// version reloads by itself only at a safe moment, keeps the session (no PIN) and never
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
 const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html');
 await page.waitForFunction(()=>window._ocActSola&&window.OCAuth);
 return {web,page};
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('pending version reloads itself only when safe, once per version ('+name+')',async()=>{
  const {web,page}=await abrir(engine);try{
  // The real published version is used, so the pre-existing load-time version check stays quiet.
  const prep=()=>page.evaluate(async()=>{const vj=await (await fetch('./version.json',{cache:'no-store'})).json();
   sessionStorage.setItem('f123_sesion',JSON.stringify({rol:'dueno'}));sessionStorage.setItem('f123_act_sola_pendiente','1');
   localStorage.setItem('f123_version_vista',vj.version+'|'+vj.shell);const g=document.getElementById('oc-gate');if(g)g.style.display='none';
   if(document.activeElement)document.activeElement.blur();window.__marca=Math.random();return window.__marca;});
  // Unsafe: a confirmation dialog is open -> no reload.
  let m=await prep();
  await page.evaluate(()=>{const o=document.getElementById('oc-modal-overlay');o.style.display='flex';window._ocActSola.intentar();});
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__marca),m,'must not reload while a dialog is open');
  // Safe: reloads, and the pending flag is cleared.
  await page.evaluate(()=>{document.getElementById('oc-modal-overlay').style.display='none';});
  await Promise.all([page.waitForEvent('load'),page.evaluate(()=>window._ocActSola.intentar())]);
  await page.waitForFunction(()=>window._ocActSola);
  assert.equal(await page.evaluate(()=>window.__marca),undefined,'page reloaded');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('f123_sesion')!==null),true,'session kept: no PIN');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('f123_act_sola_pendiente')),null,'pending flag cleared');
  // Anti-loop: same version again within 10 min -> no second reload.
  m=await prep();
  await page.evaluate(()=>window._ocActSola.intentar());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__marca),m,'no second automatic reload for the same version');
  // The old version-floor flag alone must NOT trigger the automatic reload.
  m=await page.evaluate(()=>{localStorage.removeItem('f123_autorecarga');sessionStorage.removeItem('f123_act_sola_pendiente');sessionStorage.setItem('f123_reload_al_entrar','1');window.__marca=7;window._ocActSola.intentar();return 7;});
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__marca),7,'legacy flag alone does not reload');
  }finally{await web.close();}
 });
}
