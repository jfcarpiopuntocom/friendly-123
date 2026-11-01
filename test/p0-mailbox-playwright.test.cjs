'use strict';
// P0 cross-engine test: real IndexedDB, WebCrypto and Yjs in Chromium/WebKit,
// Worker intercepted in memory. No real license, traffic or customer notebook.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const {webcrypto}=require('node:crypto');
const LICENSE='F123-SYNTHETIC-CROSSBROWSER',PIN='123',ROOM='e'.repeat(40);
globalThis.crypto||=webcrypto;
function doStorage(){
 const rows=new Map(),clone=v=>v===undefined?undefined:structuredClone(v);
 const tx={get:async k=>clone(rows.get(k)),put:async(k,v)=>{rows.set(k,clone(v))},
   list:async({prefix='',startAfter='',limit=100})=>new Map(
     [...rows].filter(([k])=>k.startsWith(prefix)&&k>startAfter)
       .sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([k,v])=>[k,clone(v)]))};
 return {...tx,transaction:fn=>fn(tx)};
}
test('Chromium PC closes -> WebKit Safari opens -> changes -> Chromium PC reopens',{timeout:180000},async()=>{
 const {mailboxPublicRoute,mailboxDoRoute}=await import('../cloudflare-worker/mailbox-api.mjs');
 const env={PIN_PEPPER:'synthetic-cross-browser-owner-pepper-for-test',REGISTROS:{},MAILBOXES:{},MAILBOX_CANARY_LICENSE_CODE:LICENSE,MAILBOX_CANARY_WRITES:'1'};
 const stores=new Map(),pinDo={fetch:async(_,options)=>{
   const d=JSON.parse(options.body);
   let data;
   if(d.action==='verify')data=(d.licenseCode===LICENSE&&d.pin===PIN)
     ?{ok:true,revision:1}:{ok:false,reason:'invalid-pin'};
   else data={configured:true,revision:1};
   return new Response(JSON.stringify(data),{status:data.ok===false?401:200});
 }};
 const hooks={getPinDo:()=>pinDo,getMailboxDo:(_,license)=>({fetch:(url,options)=>{
   if(!stores.has(license))stores.set(license,doStorage());
   return mailboxDoRoute(new Request(url,options),stores.get(license));
 }})};
 const cors={'access-control-allow-origin':'*',
   'access-control-allow-methods':'GET,POST,OPTIONS',
   'access-control-allow-headers':'content-type,authorization',
   'content-type':'application/json'};
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{
   const urls={'/docs/mailbox-bridge.mjs':'docs/mailbox-bridge.mjs',
     '/docs/vendor/yjs-bundle.min.js':'docs/vendor/yjs-bundle.min.js'};
   if(urls[req.url]){
     res.writeHead(200,{'content-type':req.url.endsWith('.mjs')?'text/javascript':'application/javascript',
       'cache-control':'no-store'});
     res.end(fs.readFileSync(path.join(root,urls[req.url])));return;
   }
   res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>synthetic mailbox</title>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let chrome,safari;
 const intercept=async page=>{
   await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
   await page.route('https://friendly123-licencias.jfcarpio.workers.dev/**',async route=>{
     const req=route.request();
     if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
     try{
       const resp=await mailboxPublicRoute(new Request(req.url(),{
         method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})
       }),env,hooks);
       return route.fulfill({status:resp.status,headers:cors,body:await resp.text()});
     }catch(e){return route.fulfill({status:503,headers:cors,body:JSON.stringify({ok:false})})}
   });
 };
 const setup=async(page,device)=>{
   await intercept(page);await page.goto(origin);
   await page.addScriptTag({url:origin+'/docs/vendor/yjs-bundle.min.js'});
   return page.evaluate(async args=>{
     const {browserMailboxStore,createMailboxYjs}=await import('/docs/mailbox-bridge.mjs');
     const symmetric=await crypto.subtle.importKey('raw',
       new Uint8Array(32).fill(42),{name:'AES-GCM'},false,['encrypt','decrypt']);
     const Y=window.Y;
     const docs={catalogo:new Y.Doc(),ops:new Y.Doc(),fotos:new Y.Doc()};
     const store=browserMailboxStore(args.room);
     const client=createMailboxYjs({licenseCode:args.license,roomId:args.room,
       deviceId:args.device,key:symmetric,Y,docs,store});
     await client.login(args.pin);
     window.syntheticMailbox={docs,client,store};
     return true;
   },{license:LICENSE,room:ROOM,device,pin:PIN});
 };
 try{
   chrome=await chromium.launch({headless:true});
   const aContext=await chrome.newContext({serviceWorkers:'block'});
   const pc=await aContext.newPage();await setup(pc,'synthetic_pc_device_01');
   const sent=await pc.evaluate(async()=>{
     const {docs,client}=window.syntheticMailbox;
     docs.catalogo.getMap('productos').set('p-one',JSON.stringify({
       id:'p-one',stockBase:8,epoch:'synthetic-epoch-01',pn:{pc:{add:0,sub:3}}}));
     docs.ops.getMap('eventos').set('movement-001',
       JSON.stringify({id:'movement-001',product:'p-one',kind:'SALE',qty:3}));
     docs.fotos.getMap('blobs').set('synthetic-photo', 'data:image/png;base64,'+'R'.repeat(80000));
     return client.flush();
   });
   assert.equal(sent.ok,true);assert.ok(sent.sent>4,'large photo must use real fragments');
   await pc.close(); // PC page stopped. IDB browser context remains on disk.
   safari=await webkit.launch({headless:true});
   const bContext=await safari.newContext({serviceWorkers:'block'});
   const phone=await bContext.newPage();await setup(phone,'synthetic_iphone_device_02');
   const received=await phone.evaluate(async()=>{
     const {docs,client}=window.syntheticMailbox;
     const result=await client.pull();
     return {result,
       products:[...docs.catalogo.getMap('productos').keys()],
       sales:[...docs.ops.getMap('eventos').keys()],
       photoLength:docs.fotos.getMap('blobs').get('synthetic-photo')?.length||0};
   });
   assert.equal(received.result.complete,true);
   assert.deepEqual(received.products,['p-one']);assert.deepEqual(received.sales,['movement-001']);
   assert.ok(received.photoLength>80000);
   await phone.evaluate(async()=>{
     const {docs,client}=window.syntheticMailbox;
     docs.ops.getMap('eventos').set('movement-002',
       JSON.stringify({id:'movement-002',product:'p-one',kind:'RETURN',qty:1}));
     await client.flush();
   });
   await phone.close();
   const reopened=await aContext.newPage();await setup(reopened,'synthetic_pc_device_01');
   const back=await reopened.evaluate(async()=>{
     const {docs,client}=window.syntheticMailbox;
     const recovered=await client.pull();
     return {complete:recovered.complete,
       sales:[...docs.ops.getMap('eventos').keys()].sort(),
       photoLength:docs.fotos.getMap('blobs').get('synthetic-photo')?.length||0};
   });
   assert.equal(back.complete,true);assert.deepEqual(back.sales,['movement-001','movement-002']);
   assert.ok(back.photoLength>80000);
   await reopened.close();await bContext.close();await aContext.close();
 }finally{
   await safari?.close();await chrome?.close();
   await new Promise(resolve=>server.close(resolve));
 }
});
