"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),http=require("node:http");
// Local npm test prerequisite: npx playwright install chromium (CI already installs it).
const {chromium}=require("playwright");
const html=fs.readFileSync("docs/index.html","utf8");
const swOriginal=fs.readFileSync("docs/sw.js","utf8");
// Only the localhost fixture narrows SW precache. Production sw.js is untouched.
const sw=swOriginal.replace(/const SHELL = \[[\s\S]*?\n\];/,
  'const SHELL = ["./index.html"];');
assert.notEqual(sw,swOriginal,"fixture must replace the real SW precache manifest");
const shellNow=(sw.match(/const CACHE = "(f123-shell-v[0-9]+)";/)||[])[1];
assert.ok(shellNow,"read the real release shell from sw.js");
const shellNext=shellNow+"-e2fixture";
const swNew=sw.replace(`const CACHE = "${shellNow}";`,`const CACHE = "${shellNext}";`);
assert.notEqual(swNew,sw,"updated SW fixture must change actual bytes");
const reg=html.split("\n").find(s=>s.includes('navigator.serviceWorker.register("./sw.js"'));
const start=html.indexOf("const _ocActSolaOn = true;");
const end=html.indexOf("// Microcirugia 5",start);
assert.ok(reg&&start>0&&end>start,"use actual E2 registration and auto-update IIFE");
const auto=html.slice(start,end);
function pageHtml(candidate) {
 const setup='sessionStorage.setItem("f123_sesion","synthetic-e2");'+
  'sessionStorage.setItem("e2-loads",String(1+Number(sessionStorage.getItem("e2-loads")||0)));';
 return '<!doctype html><html><body><div id="app">E2 synthetic notebook</div><script>'+
  setup+'\n'+(candidate?reg+'\n'+auto:
  'window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}));')+
  '</script></body></html>';
}
test("E2 Chromium: existing installed SW adopts new shell automatically without Purge", {timeout:120000},async()=>{
 let phase="old",candidate=false;
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,"http://127.0.0.1").pathname;
  res.setHeader("Cache-Control","no-store");
  if(path==="/app/sw.js"){
   res.setHeader("Content-Type","text/javascript");
   return res.end(phase==="old"?sw:swNew);
  }
  if(path==="/app/version.json"){res.setHeader("Content-Type","application/json");
    return res.end(JSON.stringify({version:"1.0",shell:phase==="old"?shellNow:shellNext}));}
  if(path==="/app/index.html"){res.setHeader("Content-Type","text/html");return res.end(pageHtml(candidate));}
  res.statusCode=404;res.end("E2 fixture only");
 });
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const origin="http://127.0.0.1:"+server.address().port;
 let browser;
 try {
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({serviceWorkers:"allow"});
  let p=await ctx.newPage();
  p.on("pageerror", e=>console.log("E2 page error:",e.message));
  ctx.on("serviceworker", w=>console.log("E2 worker:",w.url()));
  await p.goto(origin+"/app/index.html");
  const state=await p.evaluate(async()=>{
   const reg=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});
   await navigator.serviceWorker.ready;
   return {scope:reg.scope,active:reg.active?.state};
  });
  console.log("E2 old worker ready:",JSON.stringify(state));
  // The first visit is normally uncontrolled; exercise the installed PWA's return visit.
  await p.waitForFunction(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return r?.active?.state==="activated";
  },null,{timeout:20000});
  // A real installed PWA is opened in a fresh tab after worker activation.
  await p.close();
  p=await ctx.newPage();
  p.on("pageerror",e=>console.log("E2 reopened page error:",e.message));
  await p.goto(origin+"/app/index.html");
  const ctl=await p.evaluate(async()=>({
    url:location.href,controller:navigator.serviceWorker.controller?.scriptURL,
    active:(await navigator.serviceWorker.getRegistration())?.active?.state
  }));
  console.log("E2 reopened PWA:",JSON.stringify(ctl));
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:15000});
  await p.clock.install(); // only after the old worker is fully controlling this tab
  // Inject the exact E2 IIFE from the candidate source into the controlled tab.
  // This models a long-lived PWA without a navigation to bootstrap a new shell.
  await p.addScriptTag({content:auto});
  await p.waitForFunction(()=>window._ocActSola&&navigator.serviceWorker.controller,null,{timeout:10000});
  candidate=true; // only the eventual safe reload serves the candidate HTML
  const initial=await p.evaluate(()=>Number(sessionStorage.getItem("e2-loads")));
  phase="new"; // change only the localhost test server, never GitHub Pages
  // Returning to a visible installed PWA must ask for a fresh worker.
  await p.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  await p.clock.fastForward(21000); // actual revisar() timer, no manual update button
  await p.waitForFunction(()=>sessionStorage.getItem("f123_act_sola_pendiente")==="1",{timeout:25000});
  await p.clock.fastForward(92000); // simulate user idle, honoring the existing safe gate
  await p.waitForFunction(n=>Number(sessionStorage.getItem("e2-loads"))===n+1,initial,{timeout:15000});
  const result=await p.evaluate(()=>({loads:Number(sessionStorage.getItem("e2-loads")),
    session:sessionStorage.getItem("f123_sesion"),
    version:localStorage.getItem("f123_version_vista"),
    text:document.body.innerText}));
  assert.equal(result.loads,initial+1,"only one automatic safe reload for this shell");
  assert.equal(result.session,"synthetic-e2","preserve session on worker replacement");
  assert.equal(result.version,"1.0|"+shellNext,"record precise version and current SW shell");
  assert.doesNotMatch(result.text,/Purge|reload/i);
  // RED regression: returning to an already-open installed PWA requests one
  // worker update, never one request per repeated visible event.
  await p.waitForFunction(()=>document.readyState==="complete");
  await p.evaluate(async()=>{
    const reg=await navigator.serviceWorker.ready;
    await reg.update(); // settle load-time update BEFORE counting foreground events
  });
  await p.evaluate(async()=>{
    window.__e2UpdateCalls=0;
    let done;const invoked=new Promise(resolve=>{done=resolve;});
    ServiceWorkerRegistration.prototype.update=function(){
      window.__e2UpdateCalls++;done();return Promise.resolve();
    };
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    await invoked;
    await new Promise(resolve=>{
      const port=new MessageChannel();
      port.port1.onmessage=()=>{port.port1.close();port.port2.close();resolve();};
      port.port2.postMessage(0); // real macrotask, independent of Playwright fake clock
    });
  });
  assert.equal(await p.evaluate(()=>window.__e2UpdateCalls),1,
    "two rapid foreground events must issue one throttled worker update");
  await ctx.close();
 } finally {if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
});
