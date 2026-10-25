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
const helperStart=html.indexOf("function _recargarSeguroVersion() {");
const helperEnd=html.indexOf("\n}",helperStart)+2;
const start=html.indexOf("const _ocActSolaOn = true;");
const end=html.indexOf("// Microcirugia 5",start);
assert.ok(reg&&helperStart>0&&helperEnd>helperStart&&start>helperEnd&&end>start,
  "use actual E2 registration, safe-version helper and auto-update IIFE");
const safeReloadHelper=html.slice(helperStart,helperEnd);
const auto=html.slice(start,end);
assert.match(safeReloadHelper,/sessionStorage\.setItem\("f123_reload_al_entrar", "1"\)/,
  "fixture must extract the actual deferred-reload helper, not stub it");
function pageHtml(candidate) {
 const setup='sessionStorage.setItem("f123_sesion","synthetic-e2");'+
  'sessionStorage.setItem("e2-loads",String(1+Number(sessionStorage.getItem("e2-loads")||0)));';
 return '<!doctype html><html><body><div id="app">E2 synthetic notebook</div><script>'+
  setup+'\n'+(candidate?safeReloadHelper+'\n'+reg+'\n'+auto:
  'window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}));')+
  '</script></body></html>';
}
test("E2 Chromium: existing installed SW adopts new shell automatically without Purge", {timeout:120000},async()=>{
 let phase="old",candidate=false;
 const mark=label=>console.log("E2 phase:",label);
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
  const pageErrors=[];
  const collectPageErrors=p=>p.on("pageerror",e=>{pageErrors.push(e.message);console.log("E2 page error:",e.message);});
  let p=await ctx.newPage();
  collectPageErrors(p);
  ctx.on("serviceworker", w=>console.log("E2 worker:",w.url()));
  mark("initial navigation");
  await p.goto(origin+"/app/index.html");
  const state=await p.evaluate(async()=>{
   const reg=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});
   await navigator.serviceWorker.ready;
   return {scope:reg.scope,active:reg.active?.state};
  });
  console.log("E2 old worker ready:",JSON.stringify(state));
  // The first visit is normally uncontrolled; exercise the installed PWA's return visit.
  mark("wait old worker activated");
  await p.waitForFunction(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return r?.active?.state==="activated";
  },null,{timeout:20000});
  // A real installed PWA is opened in a fresh tab after worker activation.
  await p.close();
  p=await ctx.newPage();
  collectPageErrors(p);
  mark("reopened navigation");
  await p.goto(origin+"/app/index.html");
  const ctl=await p.evaluate(async()=>({
    url:location.href,controller:navigator.serviceWorker.controller?.scriptURL,
    active:(await navigator.serviceWorker.getRegistration())?.active?.state
  }));
  console.log("E2 reopened PWA:",JSON.stringify(ctl));
  mark("wait reopened controller");
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:15000});
  mark("install page clock");
  await p.clock.install(); // only after the old worker is fully controlling this tab
  // Inject the exact E2 IIFE from the candidate source into the controlled tab.
  // This models a long-lived PWA without a navigation to bootstrap a new shell.
  mark("inject helper and auto-update IIFE");
  await p.addScriptTag({content:safeReloadHelper+'\n'+auto});
  mark("wait IIFE ready");
  await p.waitForFunction(()=>window._ocActSola&&navigator.serviceWorker.controller,null,{timeout:10000});
  candidate=true; // only the eventual safe reload serves the candidate HTML
  const initial=await p.evaluate(()=>Number(sessionStorage.getItem("e2-loads")));
  phase="new"; // change only the localhost test server, never GitHub Pages
  // Returning to a visible installed PWA must ask for a fresh worker.
  mark("dispatch visible event");
  await p.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  mark("fast-forward 21s initial check");
  await p.clock.fastForward(21000); // actual revisar() timer, no manual update button
  mark("wait pending safe reload marker");
  await p.waitForFunction(()=>sessionStorage.getItem("f123_act_sola_pendiente")==="1",{timeout:25000});
  mark("fast-forward 92s safe idle gate");
  await p.clock.fastForward(92000); // simulate user idle, honoring the existing safe gate
  mark("wait one safe reload");
  await p.waitForFunction(n=>Number(sessionStorage.getItem("e2-loads"))===n+1,initial,{timeout:15000});
  mark("assert adoption state");
  const result=await p.evaluate(()=>({loads:Number(sessionStorage.getItem("e2-loads")),
    session:sessionStorage.getItem("f123_sesion"),
    version:localStorage.getItem("f123_version_vista"),
    text:document.body.innerText}));
  assert.equal(result.loads,initial+1,"only one automatic safe reload for this shell");
  assert.equal(result.session,"synthetic-e2","preserve session on worker replacement");
  assert.equal(result.version,"1.0|"+shellNext,"record precise version and current SW shell");
  assert.doesNotMatch(result.text,/Purge|reload/i);
  // The exact foreground throttle listener is exercised with a deterministic
  // clock in e2-shell-auto-update.test.js; navigation resets this document.
  assert.deepEqual(pageErrors,[],"actual helper and auto-update IIFE must run without page JavaScript errors");
  await ctx.close();
 } finally {if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
});
