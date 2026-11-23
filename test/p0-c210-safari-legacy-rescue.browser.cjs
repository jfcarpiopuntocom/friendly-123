'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const {chromium,webkit}=require('playwright');
const rescue=fs.readFileSync('docs/reenganchar.html','utf8');
const legacyHtml='<!doctype html><html><head><title>old v0.8.90</title></head><body><p id="old">v0.8.90 cached</p></body></html>';
const freshHtml='<!doctype html><html><head><title>fresh v0.8.93</title><script>(function(){var u=new URL(location.href);if(u.searchParams.has("_purge")){u.searchParams.delete("_purge");history.replaceState(history.state,"",u.pathname+u.search+u.hash)}})();</script></head><body><p id="fresh">v0.8.93</p></body></html>';
const legacySW=`
const CACHE='f123-shell-v890-golden426';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.put('./',new Response(${JSON.stringify(legacyHtml)},{headers:{'Content-Type':'text/html'}}))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 // Faithful to v890: a bare root navigation uses the old cached shell first.
 if(e.request.mode==='navigate'&&u.pathname==='/'&&!u.search){
   e.respondWith(caches.match('./').then(c=>c||fetch(e.request)));
 }
});
`;
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('C210 '+name+' old cache-first SW -> rescue -> exactly one new navigation, data retained',{timeout:120000},async()=>{
   let purgeHits=0,normalHits=0,versionOnline=false;
   const server=http.createServer((req,res)=>{
     const u=new URL(req.url,'http://localhost');
     let body='',type='text/html';
     if(u.pathname==='/old-sw.js'){body=legacySW;type='application/javascript'}
     else if(u.pathname==='/reenganchar.html')body=rescue;
     else if(u.pathname==='/version.json'){res.statusCode=versionOnline?200:503;body=versionOnline?'{"shell":"f123-shell-v893","version":"v0.8.93"}':'offline';type='application/json'}
     else if(u.pathname==='/'){
       if(u.searchParams.has('_purge')){purgeHits++;body=freshHtml}
       else{normalHits++;body=freshHtml}
     } else {res.statusCode=404;body='missing'}
     res.setHeader('Cache-Control','no-store');
     res.setHeader('Content-Type',type+'; charset=utf-8');
     res.end(body);
   });
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const base='http://127.0.0.1:'+server.address().port+'/';
   let browser;
   try {
     browser=await engine.launch({headless:true});
     const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
     const page=await context.newPage();
     await page.goto(base,{waitUntil:'load'});
     await page.evaluate(async()=>{
       localStorage.setItem('f123_test_owner','preserved');
       await navigator.serviceWorker.register('/old-sw.js');
       await navigator.serviceWorker.ready;
     });
     await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
     await page.goto(base,{waitUntil:'load'});
     assert.equal(await page.locator('#old').count(),1,'old v890 cache-first behavior reproduced before escape');
     assert.equal(await page.locator('#fresh').count(),0);
     assert.equal(await page.evaluate(()=>localStorage.getItem('f123_test_owner')),'preserved');
     // Offline preflight: old shell and cache survive rather than being erased.
     await page.goto(base+'reenganchar.html',{waitUntil:'domcontentloaded'});
     await page.locator('#manual:not([hidden])').waitFor({timeout:12000});
     const offline=await page.evaluate(async()=>({
       oldCache:(await caches.keys()).some(k=>k.indexOf('f123-shell-v890')===0),
       oldReg:(await navigator.serviceWorker.getRegistrations()).length,
       owner:localStorage.getItem('f123_test_owner')
     }));
     assert.equal(offline.oldCache,true,'offline never deletes the old shell');
     assert.equal(offline.oldReg,1,'offline never unregisters the old SW');
     assert.equal(offline.owner,'preserved');
     assert.equal(purgeHits,0,'offline never navigates to a broken half-updated app');
     versionOnline=true;
     // /reenganchar.html is outside the old SHELL, and therefore fetched from the network.
     await page.goto(base+'reenganchar.html?retry=1',{waitUntil:'domcontentloaded'}).catch(e=>{
       if(!/interrupted|aborted/i.test(String(e.message)))throw e;
     });
     await page.locator('#fresh').waitFor({timeout:30000});
     await page.waitForFunction(()=>location.pathname==='/' && !location.search);
     const evidence=await page.evaluate(async()=>({
       owner:localStorage.getItem('f123_test_owner'),
       caches:await caches.keys(),
       regs:(await navigator.serviceWorker.getRegistrations()).length,
       title:document.title,
       url:location.href
     }));
     assert.equal(evidence.title,'fresh v0.8.93');
     assert.equal(evidence.owner,'preserved','local user storage survives repair');
     assert.equal(evidence.regs,0,'old worker removed');
     assert.ok(!evidence.caches.some(n=>/^f123-shell-v/.test(n)),'old cached shell removed');
     assert.equal(purgeHits,1,'exactly one network navigation to the newest shell '+JSON.stringify(evidence));
     await context.close();
   } finally {
     if(browser)await browser.close();
     await new Promise(resolve=>server.close(resolve));
   }
 });
}
