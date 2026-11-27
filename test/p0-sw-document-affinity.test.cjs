'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const {waitResolved}=require('./helpers/wait-resolved.cjs');
const production=fs.readFileSync('docs/sw.js','utf8');
const legacy=execFileSync('git',['show','89551cc07db38e0eaa8c8f690f17720c3097ab1f:docs/sw.js'],{encoding:'utf8'});
const narrow=src=>src.replace(/const SHELL = \[[\s\S]*?\n\];/,'const SHELL = ["./index.html","./late.js"];');
const current=narrow(production),old=narrow(legacy);
const shell=src=>/^const CACHE = "([^"]+)";/m.exec(src)[1];
const generation=src=>/^const CACHE_GENERACION = "([^"]+)";/m.exec(src)[1];
const nextShell='f123-shell-v'+(Number(shell(current).split('v').pop())+1);
const nextGeneration='-golden'+(Number(generation(current).replace('-golden',''))+1);
const later=current.replace('const CACHE = "'+shell(current)+'";','const CACHE = "'+nextShell+'";').replace('const CACHE_GENERACION = "'+generation(current)+'";','const CACHE_GENERACION = "'+nextGeneration+'";');
assert.notEqual(later,current,'second takeover must remain distinct on every release');

const debugWorker = '\nconst fixtureWarnings=[],fixtureFetches=[];self.addEventListener("fetch",e=>{fixtureFetches.push({url:e.request.url,clientId:e.clientId,resultingClientId:e.resultingClientId,mode:e.request.mode});if(fixtureFetches.length>64)fixtureFetches.shift();});const fixtureWarn=console.warn.bind(console);console.warn=(...args)=>{fixtureWarnings.push(args.map(String).join(" "));fixtureWarn(...args);};\nself.addEventListener("message",event=>{if(event.data?.tipo!=="fixture-diagnostic")return;event.waitUntil((async()=>{const id=event.source.id,names=await caches.keys(),pins={};for(const n of names.filter(n=>n.includes("client-pins"))){const c=await caches.open(n);for(const k of await c.keys())pins[k.url]=await(await c.match(k)).text();}const matches={};for(const n of names.filter(n=>/^f123-shell-v/.test(n))){const c=await caches.open(n);matches[n]={plain:!!await c.match("./late.js"),query:!!await c.match("./late.js?after=takeover",{ignoreSearch:true})};}event.ports[0].postMessage({id,names,pins,matches,warnings:fixtureWarnings,fetches:fixtureFetches,clients:(await self.clients.matchAll({type:"window",includeUncontrolled:true})).map(c=>({id:c.id,url:c.url}))});})().catch(e=>event.ports[0].postMessage({error:String(e)})));});';
// Trace exact production navigation checkpoints only in the fixture, without changing assertions or timing.
const traceNavigation=src=>src.replace('const cache = await abrirCacheLocal();\n            const local = await cache.match(entrada);','console.log("AFF navigation begin",evento.resultingClientId);const cache = await abrirCacheLocal();\n            const local = await cache.match(entrada);console.log("AFF cached",!!local);').replace('try { fresca = await fetch(evento.request, { cache: "no-cache" }); } catch (_) {}','try { fresca = await fetch(evento.request, { cache: "no-cache" }); } catch (_) {} console.log("AFF network",!!fresca);').replaceAll('await fijarShellDeDocumento(evento.resultingClientId, CACHE_LOCAL);','console.log("AFF pin begin",evento.resultingClientId);await fijarShellDeDocumento(evento.resultingClientId, CACHE_LOCAL);console.log("AFF pin done");');
const workers=[old,traceNavigation(current)+debugWorker,traceNavigation(later)+debugWorker],labels=['old','new','next'];
async function diagnostic(page){
 return page.evaluate(()=>new Promise(resolve=>{const sw=navigator.serviceWorker.controller;if(!sw)return resolve({noController:true});const c=new MessageChannel(),t=setTimeout(()=>{c.port1.close();resolve({timeout:true})},3000);c.port1.onmessage=e=>{clearTimeout(t);c.port1.close();resolve(e.data)};sw.postMessage({tipo:"fixture-diagnostic"},[c.port2]);}));
}

async function identity(page,expected) {
 await waitResolved(page,wanted=>new Promise(resolve=>{
  // A reply during activation is not proof that fetches are controlled yet.
  const c=navigator.serviceWorker.controller;if(!c||c.state!=='activated')return resolve(false);
  const ch=new MessageChannel(),timer=setTimeout(()=>{ch.port1.close();resolve(false)},1500);
  ch.port1.onmessage=e=>{clearTimeout(timer);ch.port1.close();resolve(navigator.serviceWorker.controller===c&&c.state==='activated'&&e.data?.shell===wanted)};
  c.postMessage({tipo:'que-shell'},[ch.port2]);
 }),expected,{timeout:30000,label:'activated controller '+expected});
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test('SW document affinity '+name+': old document, late asset, two takeovers, PIN navigation and other channel',{timeout:120000},async()=>{
 let stage=0;
 const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname; console.log('AFF HTTP',name,stage,req.method,p);
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
  const a=await ctx.newPage();a.on('console',m=>console.log('AFF A',m.text()));a.on('requestfailed',r=>console.log('AFF A failure',r.url(),r.failure()));await a.goto(url);await identity(a,shell(old));
  await a.reload();await identity(a,shell(old));
  const b=await ctx.newPage();b.on('console',m=>console.log('AFF B',m.text()));b.on('requestfailed',r=>console.log('AFF B failure',r.url(),r.failure()));await b.goto(url);await identity(b,shell(old));
  await a.evaluate(()=>caches.open('f123-shell-v100-golden1-next'));
  assert.deepEqual(await read(a),[200,'/* old */']);
  stage=1;await update(a);await identity(a,shell(current));await identity(b,shell(current));
  assert.equal(await a.locator('body').getAttribute('data-release'),'old');
  const oldLate=await read(a,'late.js?after=takeover');
  if(oldLate[0]!==200||oldLate[1]!=='/* old */')console.log('SW affinity failure diagnostics',JSON.stringify(await diagnostic(a)),JSON.stringify(await diagnostic(b)));
  assert.deepEqual(oldLate,[200,'/* old */']);
  assert.deepEqual(await read(b),[200,'/* old */']);
  assert.equal((await read(a,'missing.js'))[0],503);
  assert.ok(await a.evaluate(()=>caches.keys().then(a=>a.includes('f123-shell-v100-golden1-next'))));
  await a.reload();await identity(a,shell(current));
  assert.equal(await a.locator('body').getAttribute('data-release'),'new');
  assert.deepEqual(await read(a),[200,'/* new */']);
  assert.deepEqual(await read(b),[200,'/* old */']);
  stage=2;await update(a);await identity(a,shell(later));await identity(b,shell(later));
  const lateA=await read(a),lateB=await read(b);if(lateA[1]!=='/* new */'||lateB[1]!=='/* old */')console.log('AFF second takeover failure',JSON.stringify({a:lateA,b:lateB,worker:await diagnostic(a),other:await diagnostic(b)}));
  assert.deepEqual(lateA,[200,'/* new */']);
  assert.deepEqual(lateB,[200,'/* old */']);
  try { await b.reload();await identity(b,shell(later)); } catch(e) {console.log('AFF B reload failure',JSON.stringify(await diagnostic(a)));throw e;}
  assert.equal(await b.locator('body').getAttribute('data-release'),'next');
  assert.deepEqual(await read(b),[200,'/* next */']);
  assert.deepEqual(await read(a),[200,'/* new */']);
  await ctx.close();
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

// Permanent deterministic regression: exact fetch handler, simulated network and clock.
const runNavigationFixture = async function run(src,mode){
 let handler,settled=false,value,error,aborts=0,reads=0,now=0,n=0;const pins=[],timers=new Map(),warnings=[];
 class U{constructor(u,b){if(b&&u.startsWith("./"))u=(typeof b==="string"?b:b.href)+u.slice(2);const m=/^(https?:\/\/[^/]+)([^?]*)(\?.*)?$/.exec(u);if(!m)throw Error("bad url "+u);this.origin=m[1];this.pathname=m[2];this.search=m[3]||"";this.href=u}}
 class R{constructor(body,o={}){this.body=body;this.status=o.status??200;this.ok=this.status>=200&&this.status<300;this.redirected=false;this.tag=o.tag||"fallback"}clone(){return this}async arrayBuffer(){if(this.tag==="network-hang-body")return new Promise(()=>{});return Uint8Array.from([...this.body].map(c=>c.charCodeAt(0))).buffer}}
 class AC{constructor(){this.signal={aborted:false}}abort(){this.signal.aborted=true;aborts++}}
 const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve()};
 const self={location:{origin:"https://fixture.test",href:"https://fixture.test/app/sw.js"},registration:{scope:"https://fixture.test/app/"},addEventListener(t,fn){handler=fn}};
 const local=mode==="no-cache"?null:new R("old",{tag:"cached"});
 const env={self,URL:U,Response:R,AbortController:AC,HOSTS_PERMITIDOS:["https://fixture.test"],SHELL:["./index.html"],CACHE_LOCAL:"f123-shell-v933-golden471",abrirCacheLocal:async()=>({match:async()=>local}),fijarShellDeDocumento:async(id,name)=>pins.push([id,name]),caches:{},crypto:{subtle:{digest:async(_,b)=>b}},fetch:async()=>{reads++;if(mode==="hang-headers")return new Promise(()=>{});if(mode==="offline")throw Error("offline");return new R(mode==="different"?"new":"old",{tag:mode==="hang-body"?"network-hang-body":"network"})},setTimeout:(fn,ms)=>{timers.set(++n,{fn,at:now+ms});return n},clearTimeout:id=>timers.delete(id),console:{warn(...x){warnings.push(x.map(String).join(" "))}}};
 new Function(...Object.keys(env),src.slice(src.indexOf('self.addEventListener("fetch"'),src.indexOf("/* A4")))(...Object.values(env));
 handler({request:{url:"https://fixture.test/app/index.html",mode:"navigate",method:"GET"},resultingClientId:"new-document",respondWith:p=>Promise.resolve(p).then(r=>{settled=true;value={status:r.status,body:r.body,tag:r.tag}},e=>{settled=true;error=String(e)})});
 await flush();const beforeDeadline=settled;now=3000;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await flush();
 return {beforeDeadline,settled,value,error,pins,reads,aborts,timers:timers.size,warnings};
};
for(const mode of ["hang-headers","hang-body","same","different","offline","no-cache"])test('SW navigation bounded revalidation: '+mode,async()=>{
 const result=await runNavigationFixture(production,mode);
 assert.equal(result.settled,true);assert.equal(result.error,undefined);assert.equal(result.timers,0);
 assert.equal(result.value.status,mode==='no-cache'?503:200);assert.equal(result.pins.length,mode==='no-cache'?0:1);
 if(mode.startsWith('hang')){assert.equal(result.beforeDeadline,false);assert.equal(result.value.tag,'cached');assert.equal(result.aborts,1);}
 if(mode==='same')assert.equal(result.value.tag,'network');
 if(mode==='different'||mode==='offline')assert.equal(result.value.tag,'cached');
});

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test('SW bounded revalidation '+name+': stalled network headers and body retain certified HTML',{timeout:60000},async()=>{
 let stall='none',requests=0,browser;const held=new Set();
 const html='<!doctype html><html><body data-release="certified"><script>navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});</script></body></html>';
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');const p=new URL(req.url,'http://localhost').pathname;
  if(p==='/app/sw.js'){res.setHeader('Content-Type','text/javascript');return res.end(current);}
  if(p==='/app/late.js'){res.setHeader('Content-Type','text/javascript');return res.end('/* certified */');}
  if(p==='/app/index.html'){
   res.setHeader('Content-Type','text/html');
   if(stall==='none')return res.end(html);
   requests++;held.add(res);res.on('close',()=>held.delete(res));
   if(stall==='body'){res.writeHead(200);res.write('<!doctype html>');}
   return;
  }
  res.statusCode=404;res.end('missing');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  browser=await engine.launch({headless:true});
  const page=await browser.newPage({serviceWorkers:'allow'});
  await page.goto('http://127.0.0.1:'+server.address().port+'/app/index.html');
  await identity(page,shell(current));
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
  for(const mode of ['headers','body']){
   stall=mode;const prior=requests,started=Date.now();
   await page.reload({timeout:12000});
   assert.ok(Date.now()-started<12000);
   assert.ok(requests>prior,'actual network revalidation must have been attempted');
   assert.equal(await page.locator('body').getAttribute('data-release'),'certified');
   await identity(page,shell(current));
   assert.deepEqual(await page.evaluate(async()=>{const r=await fetch('./late.js');return [r.status,await r.text()]}),[200,'/* certified */']);
   for(const res of held)res.destroy();
  }
 }finally{for(const res of held)res.destroy();if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
