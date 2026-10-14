const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const DOCS=path.resolve(__dirname,'../docs'),ORIGIN='http://localhost:18489';
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test(`dashboard entry describes its real owner/admin access, not the app demo (${name})`,async()=>{
 const browser=await engine.launch({headless:true});
 try{
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==ORIGIN)return route.abort();
   const file=path.resolve(DOCS,decodeURIComponent(u.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();
   try{await route.fulfill({status:200,contentType:{'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:'Not found'});}
  });
  const page=await ctx.newPage();await page.goto(ORIGIN+'/dashboard.html');
  // A new visitor must not be told that the app's public demo PIN opens
  // this authenticated business viewer. No change to the app demo itself.
  assert.doesNotMatch(await page.locator('#puerta').innerText(),/Try the demo|456|fully isolated/i);
  await page.locator('#pin').fill('456');await page.locator('#entrar').click();
  assert.match(await page.locator('#msg').innerText(),/Revisa el código|Check the code/i);
  assert.equal(await page.locator('#tablero').isVisible(),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('f123_owned')),null);
 }finally{await browser.close();}
});
