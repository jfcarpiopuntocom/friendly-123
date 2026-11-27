"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),http=require("node:http");
// Local npm test prerequisite: npx playwright install chromium (CI already installs it).
const {chromium,webkit,devices}=require("playwright");
// E2 runtime was split out of index.html after v487; read the live authored JS.
const app=fs.readFileSync("src/app/app-inline-03.js","utf8");
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
const reg=app.split("\n").find(s=>s.includes('navigator.serviceWorker.register("./sw.js"'));
const helperStart=app.indexOf("function _recargarSeguroVersion() {");
const helperEnd=app.indexOf("\n}",helperStart)+2;
const start=app.indexOf("const _ocActSolaOn = true;");
const end=app.indexOf("// Microcirugia 5",start);
assert.ok(reg&&helperStart>0&&helperEnd>helperStart&&start>helperEnd&&end>start,
  "use actual E2 registration, safe-version helper and auto-update IIFE");
const safeReloadHelper=app.slice(helperStart,helperEnd);
const auto=app.slice(start,end)
 .replace("async function intentar() {","async function intentar() {\n __e2trace('enter',{pending:pendiente(),busy:recargando,visible:documentoVisible(),safe:seguro(),eligible:puedeRecargarVersion(),controller:navigator.serviceWorker.controller?.state});")
 .replace("if (!objetivo || await shellDelSW() !== objetivo ||","const observed = objetivo ? await shellDelSW() : ''; __e2trace('identity',{objetivo,observed,controller:navigator.serviceWorker.controller?.state}); if (!objetivo || observed !== objetivo ||")
 .replace("const pintado = await esperarPintadoSplash(splash);\n      if (!pintado || !documentoVisible() || !splashVisible(splash) ||\n          !seguro() || !pendiente() || !puedeRecargarVersion() ||","const pintado = await esperarPintadoSplash(splash);\n __e2trace('paint',{pintado,visible:documentoVisible(),splash:splashVisible(splash),safe:seguro(),pending:pendiente(),eligible:puedeRecargarVersion(),same:navigator.serviceWorker.controller===controlador,controller:controlador?.state,objetivo,target:localStorage.getItem('f123_version_vista')});\n      if (!pintado || !documentoVisible() || !splashVisible(splash) ||\n          !seguro() || !pendiente() || !puedeRecargarVersion() ||")
 .replace("function intentarOrescate() {","function intentarOrescate() {\n __e2trace('trigger',{pin:enPantallaPIN(),pending:pendiente()});")
 .replace("function fin(shell) {","function fin(shell) {\n __e2trace('shell-response',{shell,same:sw.controller===c,state:c.state});");
const tracedAuto="window.__e2Trace=[]; function __e2trace(k,v){window.__e2Trace.push({k,v,t:performance.now()});if(window.__e2Trace.length>100)window.__e2Trace.shift();}\n"+auto;
assert.match(safeReloadHelper,/sessionStorage\.setItem\("f123_reload_al_entrar", "1"\)/,
  "fixture must extract the actual deferred-reload helper, not stub it");
function pageHtml(candidate) {
 const setup='if(!sessionStorage.getItem("e2-logged-out"))sessionStorage.setItem("f123_sesion","synthetic-e2");'+
  'else document.getElementById("oc-gate").style.display="flex";'+
  'sessionStorage.setItem("e2-loads",String(1+Number(sessionStorage.getItem("e2-loads")||0)));';
 return '<!doctype html><html><body><div id="app">E2 synthetic notebook</div>'+
  '<div id="oc-gate" style="display:none;position:fixed;inset:0;background:#0F1923;color:#fff">Enter PIN</div><script>'+
  setup+'\n'+(candidate?safeReloadHelper+'\n'+reg+'\n'+auto:
  'window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}));')+
  '</script></body></html>';
}
for(const [browserName,engine,options] of [
  ["Chromium",chromium,{serviceWorkers:"allow"}],
  ["WebKit iPhone",webkit,{...devices["iPhone 13"],serviceWorkers:"allow"}]
]){
test("E2 "+browserName+": SW update NEVER navigates in-app; PIN screen adopts with Updating splash", {timeout:120000},async()=>{
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
  browser=await engine.launch({headless:true});
  const ctx=await browser.newContext(options);
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
  await p.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated',null,{timeout:15000});
  // A cached health script uses MessagePort, while older callers use the global listener.
  const identity=await p.evaluate(()=>new Promise(resolve=>{
    const c=navigator.serviceWorker.controller,channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();resolve(null);},3000);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
    c.postMessage({tipo:'que-shell'},[channel.port2]);
  }));
  assert.equal(identity?.tipo,'shell-actual');
  assert.equal(identity?.shell,shellNow);

  mark("mounted real update handler on controlled page");
  // Inject the exact E2 IIFE from the candidate source into the controlled tab.
  // This models a long-lived PWA without a navigation to bootstrap a new shell.
  mark("inject helper and auto-update IIFE");
  await p.addScriptTag({content:safeReloadHelper+'\n'+tracedAuto});
  mark("wait IIFE ready");
  await p.waitForFunction(()=>window._ocActSola&&navigator.serviceWorker.controller,null,{timeout:10000});
  candidate=true; // A future navigation serves the updated document.
  const initial=await p.evaluate(()=>Number(sessionStorage.getItem("e2-loads")));
  phase="new";
  mark("request worker update while inside app");
  await p.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForFunction(expected=>new Promise(resolve=>{
    const c=navigator.serviceWorker.controller;if(!c||c.state!=='activated')return resolve(false);
    let complete=false;
    const timer=setTimeout(()=>{if(!complete){complete=true;navigator.serviceWorker.removeEventListener('message',onMsg);resolve(false)}},1200);
    function onMsg(e){if(e.data?.tipo==='shell-actual'){if(!complete){complete=true;clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',onMsg);resolve(e.source===c&&navigator.serviceWorker.controller===c&&c.state==='activated'&&e.data.shell===expected)}}}
    navigator.serviceWorker.addEventListener('message',onMsg);c.postMessage({tipo:'que-shell'});
  }),shellNext,{timeout:30000});
  mark("wait for the real controllerchange / update-pending event");
  await p.waitForFunction(()=>sessionStorage.getItem('f123_act_sola_pendiente')==='1',null,{timeout:15000});
  mark("confirm working app stays on old document");
  const inside=await p.evaluate(async()=>({
    result:await window._ocActSola.intentar(),
    loads:Number(sessionStorage.getItem('e2-loads')),
    pending:sessionStorage.getItem('f123_act_sola_pendiente'),
    splash:!!document.getElementById('f123-update-splash')
  }));
  assert.equal(inside.result,false,'never reload while authenticated inside');
  assert.equal(inside.loads,initial,'no in-app navigation even with new SW controller');
  assert.equal(inside.pending,'1','retain pending update for next PIN screen');
  assert.equal(inside.splash,false,'no Updating splash in operational app');
  mark("navigate at PIN, with visible Updating splash");
  await p.evaluate(()=>{
    new MutationObserver(()=>{
      if(document.getElementById('f123-update-splash')?.textContent?.includes('Updating'))
        sessionStorage.setItem('e2-updating-splash-seen','1');
    }).observe(document.body,{subtree:true,childList:true});
  });
  const navigation=p.waitForEvent("framenavigated",{predicate:frame=>frame===p.mainFrame(),timeout:15000});
  await p.evaluate(()=>{
    sessionStorage.setItem("e2-logged-out","1");
    sessionStorage.removeItem("f123_sesion");
    document.getElementById("oc-gate").style.display="flex";
    // The real MutationObserver on the PIN gate must trigger adoption.

  });
  try { await navigation; } catch (error) {
    console.log('E2 PIN failure state:',JSON.stringify(await p.evaluate(async()=>({
      controller:navigator.serviceWorker.controller?.state||null,
      active:(await navigator.serviceWorker.getRegistration())?.active?.state||null,
      target:localStorage.getItem('f123_version_vista'),
      pending:sessionStorage.getItem('f123_act_sola_pendiente'),
      visible:document.visibilityState,
      safe:window._ocActSola.seguro(),
      splash:!!document.getElementById('f123-update-splash'),
      loads:sessionStorage.getItem('e2-loads'),trace:window.__e2Trace
    }))));
    throw error;
  }
  await p.waitForFunction(n=>Number(sessionStorage.getItem("e2-loads"))===n+1,initial,{timeout:15000});
  const result=await p.evaluate(()=>({
    loads:Number(sessionStorage.getItem("e2-loads")),
    version:localStorage.getItem("f123_version_vista"),
    splash:sessionStorage.getItem('e2-updating-splash-seen'),
    pinVisible:getComputedStyle(document.getElementById('oc-gate')).display!=='none'
  }));
  assert.equal(result.loads,initial+1,'the PIN-page navigation gets the current shell');
  assert.equal(result.version,"1.0|"+shellNext);
  assert.equal(result.splash,'1','Updating splash painted before navigation');
  assert.equal(result.pinVisible,true,'stays on PIN screen rather than entering the app');
  assert.deepEqual(pageErrors,[],'real SW and app update code produce no JS errors');
  await ctx.close();
 } finally {if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
});
}
