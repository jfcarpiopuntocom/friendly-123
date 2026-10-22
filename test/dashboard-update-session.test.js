const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const DOCS=path.join(__dirname,'../docs'),ORIGIN='http://localhost:18488';
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test(`automatic dashboard reload preserves verified session and rejects changed credentials (${name})`,async()=>{
 const browser=await engine.launch({headless:true});
 try{
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==ORIGIN)return route.abort();
   const file=path.resolve(DOCS,decodeURIComponent(u.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();
   try{await route.fulfill({status:200,contentType:{'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:'not found'});}
  });
  await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};});
  const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html');
  await page.evaluate(async()=>{
   localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-TEST-0000-0000-00000',nombreNegocio:'Synthetic handoff',instanceId:'synthetic-handoff-device'}));
   OCAuth.rolActual=()=> 'dueno'; const request=async(u,b)=>{const r=await fetch(u,{method:'POST',body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json();}; const rack=await request('/api/ubicaciones',{nombre:'Synthetic rack',tipo:'propio'});await request('/api/productos',{nombre:'Synthetic item',barcode:'HANDOFF',precio:10,costo:2,stockInicial:2,ubicacionId:rack.id});
   await OCSecure.guardarSecreto('789',[],'357','');
  });
  await page.goto(ORIGIN+'/dashboard.html');await page.locator('#pin').fill('789');await page.locator('#entrar').click();try { await page.locator('#tablero').waitFor({state:'visible',timeout:5000}); } catch(e) { throw new Error(await page.locator('#msg').innerText(),{cause:e}); }
  const before=await page.evaluate(()=>localStorage.getItem('f123_estado_v4_B'));
  await page.locator('a[data-ruta="herramientas"]').click();
  await page.locator('#cu-total').fill('100');await page.locator('#cu-unid').fill('10');await page.locator('#cu-unid').blur();
  await page.locator('a[data-ruta="hoy"]').click();
  await page.locator('#buscar').fill('Synthetic');await page.locator('#buscar').blur();
  assert.equal(await page.evaluate(()=>__dashboardUpdate.prepare()),true);
  const handoff=await page.evaluate(()=>sessionStorage.getItem('f123_dashboard_update_handoff'));
  // A hexadecimal SHA-256 proof can contain three PIN-like digits by
  // coincidence. Inspect the handoff STRUCTURE instead of scanning the digest:
  // a false match previously failed the WebKit regression at random.
  const parsedHandoff=JSON.parse(handoff);
  assert.deepEqual(Object.keys(parsedHandoff).sort(),
    ['at','code','local','token','proof','scroll','draft'].sort(),
    'handoff has only explicitly approved fields, never a raw PIN');
  assert.match(parsedHandoff.proof,/^[a-f0-9]{64}$/,
    'credentials are represented by a fixed-size non-reversible digest');
  assert.equal(parsedHandoff.pin,undefined,'no PIN field is transferred');
  assert.equal(parsedHandoff.password,undefined,'no password field is transferred');
  await page.reload();await page.locator('#tablero').waitFor({state:'visible',timeout:6000});
  assert.equal(await page.locator('#cu-total').inputValue(),'100','a blurred calculator draft survives the hotfix');
  assert.equal(await page.locator('#cu-unid').inputValue(),'10');
  assert.equal(await page.locator('#buscar').inputValue(),'Synthetic','report search survives the hotfix');
  assert.equal(await page.evaluate(()=>localStorage.getItem('f123_estado_v4_B')),before);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('f123_dashboard_update_handoff')),null,'one use only');
  await page.locator('a[data-ruta="hoy"]').click();assert.equal(await page.evaluate(()=>__dashboardUpdate.prepare()),true);
  await page.evaluate(()=>localStorage.setItem('f123_admins_pins','["555"]'));
  await page.reload();await page.waitForTimeout(300);assert.equal(await page.locator('#tablero').isVisible(),false,'credential change invalidates handoff');
 }finally{await browser.close();}
});
