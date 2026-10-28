'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const scripts={
 '/vendor.js':'docs/vendor/yjs-bundle.min.js',
 '/engine.js':'lab/stock-journal/engine.cjs',
 '/bridge.js':'lab/stock-journal/yjs-bridge.cjs'
};
async function send(from,to){
 const update=await from.evaluate(()=>Array.from(Y.encodeStateAsUpdate(window.lab.doc)));
 await to.evaluate(bytes=>{Y.applyUpdate(window.lab.doc,new Uint8Array(bytes),'red');},update);
 await to.evaluate(()=>window.lab.bridge.flush());
}
const initScript=`(function(){
 const journal=new F123StockJournalShadow.Journal('browser-fixture-only');
 const doc=new Y.Doc();
 const bridge=new F123StockJournalYjsShadow.ShadowYjsBridge(doc,journal);
 window.lab={journal,doc,bridge};
})();`;
test('Chromium: two PWA-like browsers keep the last-unit preorders and backup replayed events', {timeout:120000},async()=>{
 const server=http.createServer((req,res)=>{
   const requested=new URL(req.url,'http://127.0.0.1').pathname;
   if(scripts[requested]){
     res.setHeader('Content-Type','text/javascript');
     res.setHeader('Cache-Control','no-store');
     res.end(fs.readFileSync(path.join(root,scripts[requested])));return;
   }
   if(requested==='/'){
     res.setHeader('Content-Type','text/html');
     res.end('<!doctype html><html><head><script src="/vendor.js"></script><script src="/engine.js"></script><script src="/bridge.js"></script></head><body><main>StockJournal isolated browser fixture</main></body></html>');
     return;
   }
   res.statusCode=404;res.end('fixture only');
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 let browser;
 try {
   browser=await chromium.launch({headless:true});
   const context=await browser.newContext();
   const baseUrl='http://127.0.0.1:'+server.address().port+'/';
   const a=await context.newPage(),b=await context.newPage();
   await Promise.all([a.goto(baseUrl),b.goto(baseUrl)]);
   await Promise.all([a.evaluate(initScript),b.evaluate(initScript)]);
   const base={id:'base:1',kind:'OPEN',notebook:'browser-fixture-only',device:'base',seq:1,product:'cream',qty:1};
   await a.evaluate(e=>lab.bridge.publish(e),base);
   await send(a,b);
   const order=(device,orderId)=>({id:device+':1',kind:'ORDER',notebook:'browser-fixture-only',device,seq:1,product:'cream',qty:1,orderId});
   await a.evaluate(e=>lab.bridge.publish(e),order('pc','sale-pc'));
   await b.evaluate(e=>lab.bridge.publish(e),order('phone','sale-phone'));
   await send(a,b);await send(b,a);
   const results=await Promise.all([a.evaluate(()=>lab.journal.project('cream')),b.evaluate(()=>lab.journal.project('cream'))]);
   assert.deepEqual(results[0],results[1]);
   assert.equal(results[0].onHand,1);
   assert.equal(results[0].unfulfilled,2);
   assert.equal(results[0].preorder,1);
   assert.equal(results[0].available,0);
   await a.evaluate(()=>localStorage.setItem('shadow-journal-backup',JSON.stringify(lab.journal.export())));
   await a.close();
   const again=await context.newPage();await again.goto(baseUrl);
   await again.evaluate(initScript);
   const seeded=await again.evaluate(async()=>{
     const snapshot=JSON.parse(localStorage.getItem('shadow-journal-backup'));
     const imported=lab.journal.import(snapshot);
     const witnesses=await lab.bridge.seedFromJournal();
     return {imported,witnesses};
   });
   assert.equal(seeded.imported.ok,true);
   assert.equal(seeded.witnesses,3);
   await send(again,b);await send(b,again);
   const later=await again.evaluate(()=>lab.journal.project('cream'));
   assert.deepEqual(later,results[0]);
   await context.close();
 } finally {
   if(browser)await browser.close();
   await new Promise(ok=>server.close(ok));
 }
});
