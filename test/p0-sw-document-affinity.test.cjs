'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const production=fs.readFileSync('docs/sw.js','utf8');
const legacy=execFileSync('git',['show','26b374a38505908ff79d65433e7eaf234557fc6b:docs/sw.js'],{encoding:'utf8'});
const narrow=src=>src.replace(/const SHELL = \[[\s\S]*?\n\];/,'const SHELL = ["./index.html","./late.js"];');
const current=narrow(production),old=narrow(legacy);
const shell=src=>/^const CACHE = "([^"]+)";/m.exec(src)[1];
const generation=src=>/^const CACHE_GENERACION = "([^"]+)";/m.exec(src)[1];
const later=current.replace('const CACHE = "'+shell(current)+'";','const CACHE = "f123-shell-v932";').replace('const CACHE_GENERACION = "'+generation(current)+'";','const CACHE_GENERACION = "-golden470";');
const workers=[old,current,later],labels=['old','new','next'];
async function identity(page,expected) {
 await page.waitForFunction(wanted=>new Promise(resolve=>{
  const c=navigator.serviceWorker.controller;if(!c)return resolve(false);
  const ch=new MessageChannel(),timer=setTimeout(()=>{ch.port1.close();resolve(false)},1500);
  ch.port1.onmessage=e=>{clearTimeout(timer);ch.port1.close();resolve(e.data?.shell===wanted)};
  c.postMessage({tipo:'que-shell'},[ch.port2]);
 }),expected,{timeout:30000});
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test('SW document affinity '+name+': old document, late asset, two takeovers, PIN navigation and other channel',{timeout:120000},async()=>{
 let stage=0;
 const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(p==='/app/sw.js'){res.setHeader('Content-Type','text/javascript');return res.end(workers[stage]);}
  if(p==='/app/index.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><body data-release="'+labels[stage]+'"><script>navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});</script></body></html>');}
  if(p==='/app/late.js'||p==='/app/missing.js'){res.setHeader('Content-Type','text/javascript');return res.end('/* '+labels[stage]+' */');}
  if(p==='/app/version.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({shell:shell(workers[stage])}));}
  res.statusCode=404;res.end('missing fixture');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/app/index.html';let browser;
 const read=async(page,file='late.js')=>page.evaluate(async f=>{const r=await fetch('./'+f);return [r.status,await r.text()]},file);
 const update=async(page)=>page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
 try{
  browser=await engine.launch({headless:true});const ctx=await browser.newContext({serviceWorkers:'allow'});
  const a=await ctx.newPage();await a.goto(url);await identity(a,shell(old));
  await a.reload();await identity(a,shell(old));
  const b=await ctx.newPage();await b.goto(url);await identity(b,shell(old));
  await a.evaluate(()=>caches.open('f123-shell-v100-golden1-next'));
  assert.deepEqual(await read(a),[200,'/* old */']);
  stage=1;await update(a);await identity(a,shell(current));await identity(b,shell(current));
  assert.equal(await a.locator('body').getAttribute('data-release'),'old');
  assert.deepEqual(await read(a,'late.js?after=takeover'),[200,'/* old */']);
  assert.deepEqual(await read(b),[200,'/* old */']);
  assert.equal((await read(a,'missing.js'))[0],503);
  assert.ok(await a.evaluate(()=>caches.keys().then(a=>a.includes('f123-shell-v100-golden1-next'))));
  await a.reload();await identity(a,shell(current));
  assert.equal(await a.locator('body').getAttribute('data-release'),'new');
  assert.deepEqual(await read(a),[200,'/* new */']);
  assert.deepEqual(await read(b),[200,'/* old */']);
  stage=2;await update(a);await identity(a,shell(later));await identity(b,shell(later));
  assert.deepEqual(await read(a),[200,'/* new */']);
  assert.deepEqual(await read(b),[200,'/* old */']);
  await b.reload();await identity(b,shell(later));
  assert.equal(await b.locator('body').getAttribute('data-release'),'next');
  assert.deepEqual(await read(b),[200,'/* next */']);
  assert.deepEqual(await read(a),[200,'/* new */']);
  await ctx.close();
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
