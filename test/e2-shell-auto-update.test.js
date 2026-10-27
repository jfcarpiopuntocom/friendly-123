"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const auth=fs.readFileSync(path.join(__dirname,"../docs/auth-ui.js"),"utf8");
const html=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,"../docs/index.html"),"utf8");
const delay=()=>new Promise(resolve=>setImmediate(resolve));
test('E2: foreground updates are coalesced inside 15 minutes and resume after expiry',async()=>{
 const start=html.indexOf('  let ultimoUpdateAlVolver = 0;');
 const end=html.indexOf('  setInterval(function ()',start);
 assert.ok(start>0&&end>start);
 let now=10000000,updateCalls=0,listener,hiddenAttempts=0;
 const document={visibilityState:'visible',addEventListener:(name,fn)=>{assert.equal(name,'visibilitychange');listener=fn;}};
 vm.runInNewContext(html.slice(start,end),{document,Date:{now:()=>now},
  navigator:{serviceWorker:{getRegistration:async()=>({update:async()=>{updateCalls++;}})}},
  revisar(){},intentar(){hiddenAttempts++;}});
 listener();listener();await delay();
 assert.equal(updateCalls,1,'two initial foreground events request only one update');
 now+=1000;listener();listener();await delay();
 assert.equal(updateCalls,1,'events within the window make no additional request');
 now+=900001;listener();listener();await delay();
 assert.equal(updateCalls,2,'after expiry, two foreground events add exactly one update');
 document.visibilityState='hidden';listener();await delay();
 assert.equal(updateCalls,2,'hidden transition never requests a foreground update');
 assert.equal(hiddenAttempts,1,'hidden transition preserves safe adoption attempt');
});
async function flush(){for(let i=0;i<5;i++) await delay();}

test("E2: after load, service worker registers and calls update immediately",async()=>{
  const start=html.indexOf('if ("serviceWorker" in navigator) {',html.indexOf("Item 4 (revision"));
  const end=html.indexOf("  /* MEJORA #3",start);
  assert.ok(start>0&&end>start,"published registration code located");
  let load,regArgs,updates=0;
  const sw={register:async(...args)=>{regArgs=args;return {update:async()=>{updates++;}};}};
  vm.runInNewContext(html.slice(start,end)+"\n}",{
    navigator:{serviceWorker:sw},
    window:{addEventListener:(type,fn)=>{if(type==="load")load=fn;}}
  });
  assert.equal(typeof load,"function");
  load();await flush();
  assert.equal(regArgs[0],"./sw.js");
  assert.equal(regArgs[1].updateViaCache,"none");
  assert.equal(updates,1);
});

test("E2: gate recomputes SW version on controllerchange and broadcast, never instructs Purge",async()=>{
  const start=auth.indexOf("  function pintarBuildGate() {");
  const end=auth.indexOf("  pintarNegocioGate();",start);
  assert.ok(start>0&&end>start,"real shell painter and listeners located");
  const listeners=new Map(),el={textContent:"",style:{
    setProperty(){},removeProperty(){},opacity:"",color:""
  }};
  let serverShell="f123-shell-v560",activeShell="f123-shell-v559",fetches=0;
  const sw={
    controller:{postMessage(){setImmediate(()=>emit("message",{data:{tipo:"shell-actual",shell:activeShell}}));}},
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);}
  };
  function emit(type,ev={}){for(const fn of [...(listeners.get(type)||[])])fn(ev);}
  vm.runInNewContext(auth.slice(start,end),{
    navigator:{serviceWorker:sw},document:{getElementById:id=>id==="oc-gate-build"?el:null},
    fetch:async()=>{fetches++;return {ok:true,json:async()=>({version:"1.0",releaseName:"v569",shell:serverShell})};},
    setTimeout:()=>1,clearTimeout(){},Date,console
  });
  await flush();
  assert.match(el.textContent,/actualización automática pendiente/);
  assert.doesNotMatch(el.textContent,/Purge|reload/i);
  activeShell=serverShell;
  emit("controllerchange");await flush();
  assert.equal(el.textContent,"v569");
  assert.doesNotMatch(el.textContent,/vieja|Purge|pendiente/);
  assert.equal(el.style.color,"");
  serverShell="f123-shell-v561";
  emit("message",{data:{tipo:"shell-actualizado",shell:serverShell}});await flush();
  assert.match(el.textContent,/actualización automática pendiente/);
  assert.ok(fetches>=3,"status must be fetched again after each worker event");
});

test("E2: controllerchange and shell-actualizado arm safe deferred reload, never reload directly",()=>{
  const begin=html.indexOf("  var ultimoControladorSW =");
  const end=html.indexOf("  window._ocActSola =",begin);
  assert.ok(begin>0&&end>begin,"takeover listeners exist in real update module");
  const listeners=new Map(),pending=new Map(),events=[];
  const ctx={
    navigator:{serviceWorker:{controller:{id:"old"},addEventListener:(type,fn)=>listeners.set(type,fn)}},
    sessionStorage:{setItem:(k,v)=>pending.set(k,v)},
    document:{visibilityState:"visible"},
    Date:{now:()=>100000},ultimoToque:100000,
    KP:"pending",_recargarSeguroVersion:()=>events.push("defer"),
    intentar:()=>events.push("attempt"),
    location:{reload:()=>events.push("UNSAFE reload")}
  };
  vm.runInNewContext(html.slice(begin,end),ctx);
  ctx.navigator.serviceWorker.controller={id:"new"};
  listeners.get("controllerchange")();
  assert.equal(pending.get("pending"),"1");
  assert.deepEqual(events,["defer"],"typing user must not be interrupted");
  ctx.document.visibilityState="hidden";
  listeners.get("message")({data:{tipo:"shell-actualizado"}});
  assert.deepEqual(events,["defer"],"dual notification for the SAME SW may not arm twice");
  ctx.navigator.serviceWorker.controller={id:"newer"};
  listeners.get("controllerchange")();
  assert.deepEqual(events,["defer","defer","attempt"],"a genuinely NEW SW may arm again");
  assert.equal(events.includes("UNSAFE reload"),false);
});

test("E2: no user-facing stale-shell warning instructs cache purging",()=>{
 const line=auth.match(/el\.textContent = "shell-" \+ activaCorta[^\n]+/);
 assert.ok(line,"actual stale-shell text found");
 assert.doesNotMatch(line[0],/Purge|borrar cach[eé]|eliminar datos/i);
});

test("E2 RED: first install without old controller does not schedule an unnecessary reload",()=>{
 const begin=html.indexOf("  var ultimoControladorSW =");
 const end=html.indexOf("  window._ocActSola =",begin);
 assert.ok(begin>0&&end>begin);
 const listeners=new Map(),effects=[];
 const sw={controller:null,addEventListener:(type,fn)=>listeners.set(type,fn)};
 const ctx={navigator:{serviceWorker:sw},sessionStorage:{setItem:()=>effects.push("pending")},
  document:{visibilityState:"visible"},Date:{now:()=>100000},ultimoToque:100000,
  KP:"pending",_recargarSeguroVersion:()=>effects.push("defer"),
  intentar:()=>effects.push("reload-attempt")};
 vm.runInNewContext(html.slice(begin,end),ctx);
 sw.controller={id:"first"};
 listeners.get("controllerchange")();
 assert.deepEqual(effects,[],"a first-time installation is not an app update");
});
