'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {startServer}=require('./helpers/e2e-app.cjs');
for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]])
for(const width of [390,768,1366])
test('JFC panel PIN editor fits '+engineName+' at '+width+'px',{timeout:35000},async()=>{
 const {srv,base}=await startServer();let browser;
 try{
  browser=await engine.launch({headless:true});
  const page=await browser.newPage({viewport:{width,height:820},serviceWorkers:'block'});
  await page.route(url=>!url.href.startsWith(base)&&!url.href.startsWith('data:'),r=>r.abort());
  await page.goto(base+'/panel.html',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(()=>{
   const card=document.getElementById('lic-pin-control');
   if(!card)return {error:'card missing'};
   card.hidden=false;
   const rectangles=['lic-pin-control','lic-pin-new','lic-pin-confirm','lic-pin-stage','lic-pin-activate']
     .map(id=>{const n=document.getElementById(id),r=n?.getBoundingClientRect();return {id,left:r?.left??-1,right:r?.right??-1,visible:!!r&&r.width>0}});
   return {viewport:document.documentElement.clientWidth,rectangles,
     inputCount:card.querySelectorAll('input[type="password"]').length,
     buttonCount:card.querySelectorAll('button').length};
  });
  assert.ok(!result.error,result.error||'');
  for(const box of result.rectangles){
   assert.equal(box.visible,true,box.id+' visible');
   assert.ok(box.left>=-1,box.id+' starts inside viewport');
   assert.ok(box.right<=result.viewport+1,box.id+' fits '+result.viewport);
  }
  assert.equal(result.inputCount,2);
  assert.ok(result.buttonCount>=3);
 }finally{await browser?.close();await new Promise(r=>srv.close(r))}
});
