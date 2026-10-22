"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),http=require("node:http");
const {chromium}=require("playwright");
const html=fs.readFileSync("docs/index.html","utf8");
const swOriginal=fs.readFileSync("docs/sw.js","utf8");
// Only the localhost fixture narrows SW precache. Production sw.js is untouched.
const sw=swOriginal.replace(/const SHELL = \[[\s\S]*?\n\];/,
  'const SHELL = ["./index.html"];');
assert.notEqual(sw,swOriginal,"fixture must replace the real SW precache manifest");
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
test("E2 Chromium: existing v559 SW adopts new shell automatically without Purge", {timeout:120000},async()=>{
 let phase="old",candidate=false;
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,"http://127.0.0.1").pathname;
  res.setHeader("Cache-Control","no-store");
  if(path==="/app/sw.js"){
   res.setHeader("Content-Type","text/javascript");
   const source=phase==="old"?sw:sw.replace('const CACHE = "f123-shell-v559";',
     'const CACHE = "f123-shell-v560-e2fixture";');
   assert.notEqual(phase==="new"?source:sw,"", "SW bytes must be present");
   return res.end(source);
  }
  if(path==="/app/version.json"){res.setHeader("Content-Type","application/json");
    return res.end(JSON.stringify({version:"1.0",shell:phase==="old"?"f123-shell-v559":"f123-shell-v560-e2fixture"}));}
  if(path==="/app/index.html"){res.setHeader("Content-Type","text/html");return res.end(pageHtml(candidate));}
  res.statusCode=404;res.end("E2 fixture only");
 });
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const origin="http://127.0.0.1:"+server.address().port;
 let browser;
 try {
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({serviceWorkers:"allow"});
  const p=await ctx.newPage();
  p.on("pageerror", e=>console.log("E2 page error:",e.message));
  ctx.on("serviceworker", w=>console.log("E2 worker:",w.url()));
  await p.goto(origin+"/app/index.html");
  const state=await p.evaluate(async()=>{
   const reg=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});
   await navigator.serviceWorker.ready;
   return {scope:reg.scope,active:reg.active?.state};
  });
  console.log("E2 old worker ready:",JSON.stringify(state));
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:20000});
  await p.clock.install(); // only after the old worker is fully controlling this tab
  candidate=true;
  await p.reload();
  await p.waitForFunction(()=>window._ocActSola&&navigator.serviceWorker.controller,{timeout:10000});
  const initial=await p.evaluate(()=>Number(sessionStorage.getItem("e2-loads")));
  phase="new"; // change only the localhost test server, never GitHub Pages
  await p.clock.fastForward(21000); // actual revisar() timer, no manual update button
  await p.waitForFunction(()=>sessionStorage.getItem("f123_act_sola_pendiente")==="1",{timeout:25000});
  await p.clock.fastForward(92000); // simulate user idle, honoring the existing safe gate
  await p.waitForFunction(n=>Number(sessionStorage.getItem("e2-loads"))===n+1,initial,{timeout:15000});
  const result=await p.evaluate(()=>({loads:Number(sessionStorage.getItem("e2-loads")),
    session:sessionStorage.getItem("f123_sesion"),
    version:localStorage.getItem("f123_version_vista"),
    text:document.body.textContent}));
  assert.equal(result.loads,initial+1,"only one automatic safe reload for this shell");
  assert.equal(result.session,"synthetic-e2","preserve session on worker replacement");
  assert.match(String(result.version),/f123-shell-v560-e2fixture/);
  assert.doesNotMatch(result.text,/Purge|reload/i);
  await ctx.close();
 } finally {if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
});
