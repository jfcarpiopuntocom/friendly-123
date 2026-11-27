'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const health=read('docs/salud-app.js'),worker=read('docs/sw.js');
function extractHealth(src){const a=src.indexOf("(function autodiagnosticoDeVersion()"),b=src.indexOf("\n})();",a);if(a<0||b<0)throw Error("health boundary");return src.slice(a,b+6);}
function extractWorker(src){const a=src.lastIndexOf('self.addEventListener("message",');if(a<0)throw Error("worker boundary");return src.slice(a);}
async function exercise(h,w,{silent=false,offline=false,spoof=false,swap=false,throws=false,alreadyWaiting=false,serverShell="f123-shell-v928",serverGeneration="golden466",workerShell="f123-shell-v928",workerGeneration="-golden466"}={}){
 const listeners=new Set(),timers=new Map(),messages=[],warnings=[];let n=0,now=0,updates=0,activations=0,reloads=0,handler;
 const wait={postMessage(m){if(m.tipo==="skip-waiting")activations++;reg.waiting=null;}};
 const reg={waiting:alreadyWaiting?wait:null,async update(){updates++;if(throws)throw Error("network");this.waiting=wait;}};
 const source={postMessage(data){for(const fn of [...listeners])fn({data,source:ctrl});}};
 const ctrl={postMessage(data,ports=[]){if(spoof){for(const fn of [...listeners])fn({source:{},data:{tipo:"shell-actual",shell:serverShell,cacheGeneration:"-"+serverGeneration}});}if(swap)sw.controller={};if(!silent)handler({data,ports,source});}};
 const sw={controller:ctrl,addEventListener(t,fn){if(t==="message")listeners.add(fn);},removeEventListener(t,fn){listeners.delete(fn);},getRegistration:async()=>reg};
 const W={AMG:{Salud:{registrar(m){messages.push(m);}}}};
 class MC{constructor(){this.port1={onmessage:null};this.port2={postMessage:data=>this.port1.onmessage?.({data})}}}
 const timer=(fn,ms)=>{timers.set(++n,{fn,at:now+ms});return n;};const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const step=async()=>{await flush();while(timers.size){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=t.at;t.fn();await flush();}};
 new Function("self","CACHE","CACHE_GENERACION",extractWorker(w))({addEventListener(t,fn){handler=fn;},skipWaiting(){}},workerShell,workerGeneration);
 new Function("navigator","window","document","fetch","MessageChannel","setTimeout","clearTimeout","console","location",extractHealth(h))({serviceWorker:sw},W,{readyState:"complete"},async()=>({ok:!offline,json:async()=>({shell:serverShell,cacheGeneration:serverGeneration})}),MC,timer,id=>timers.delete(id),{warn:m=>warnings.push(m)},{reload(){reloads++;}});
 await step();return {updates,activations,reloads,messages:messages.length,warnings:warnings.length,listeners:listeners.size,mezcla:!!W.__ocMezcla};
}
const cases=[["healthy",{},x=>x.updates===0&&x.warnings===0&&!x.mezcla],
["stale",{"workerShell":"f123-shell-v920","workerGeneration":"-golden457"},x=>x.updates===1&&x.activations===1&&x.mezcla&&x.warnings===0],
["same shell old golden",{"workerGeneration":"-golden457"},x=>x.updates===1&&x.mezcla],
["silent",{"silent":true},x=>x.updates===1&&x.warnings===1&&!x.mezcla],
["spoofed response",{"spoof":true,"silent":true},x=>x.updates===1&&x.warnings===1&&!x.mezcla],
["controller replaced",{"swap":true,"silent":true},x=>x.updates===0&&!x.mezcla],
["offline",{"offline":true},x=>x.updates===0&&x.warnings===0],
["update reject",{"silent":true,"throws":true},x=>x.updates===1&&x.activations===0],
["waiting before update",{"workerShell":"f123-shell-v920","alreadyWaiting":true},x=>x.updates===1&&x.activations===2]];
for(const [name,options,check] of cases)test('SW identity: '+name,async()=>{const result=await exercise(health,worker,options);assert.ok(check(result),JSON.stringify(result));assert.equal(result.reloads,0);assert.equal(result.listeners,0);});
test('SW identity: new health understands legacy global reply',async()=>{const legacy=worker.replace("    if (ev.data.tipo === \"que-shell\") {\n      const destino = (ev.ports && ev.ports[0]) || ev.source;\n      if (destino && destino.postMessage) destino.postMessage({ tipo: \"shell-actual\", shell: CACHE, cacheGeneration: CACHE_GENERACION });\n      return;\n    }","    if (ev.data.tipo === \"que-shell\" && ev.source && ev.source.postMessage) {\n      ev.source.postMessage({ tipo: \"shell-actual\", shell: CACHE, cacheGeneration: CACHE_GENERACION });\n      return;\n    }");assert.notEqual(legacy,worker);const result=await exercise(health,legacy,{workerShell:'f123-shell-v920',workerGeneration:'-golden457'});assert.ok(result.mezcla);assert.equal(result.updates,1);assert.equal(result.activations,1);assert.equal(result.warnings,0);});
test('SW identity: cached page using private MessagePort receives exact identity',()=>{let handler;new Function('self','CACHE','CACHE_GENERACION',extractWorker(worker))({addEventListener(t,fn){handler=fn;}},'f123-shell-v929','-golden467');let messages=[],global=0;handler({data:{tipo:'que-shell'},ports:[{postMessage:m=>messages.push(m)}],source:{postMessage(){global++;}}});assert.deepEqual(messages,[{tipo:'shell-actual',shell:'f123-shell-v929',cacheGeneration:'-golden467'}]);assert.equal(global,0);});

const updaterSource=read('src/app/app-inline-03.js');
function extractUpdaterIdentity(src){const a=src.indexOf('  function shellDelSW()'),b=src.indexOf('  async function revisar()',a);assert.ok(a>=0&&b>a);return src.slice(a,b)+'\nreturn shellDelSW;';}
for(const kind of ['port','legacy','foreign','swap','activating','silent','throw'])test('PIN updater identity: '+kind,async()=>{
 const listeners=new Set(), timers=new Map();let id=0,closed=0,requests=0;
 const ctrl={state:kind==='activating'?'activating':'activated',postMessage(data,ports=[]){
  requests++;const payload={tipo:'shell-actual',shell:'f123-shell-v936'};
  if(kind==='throw')throw Error('post failed');
  if(kind==='silent')return;
  if(kind==='foreign'){for(const fn of listeners)fn({source:{},data:payload});return;}
  if(kind==='swap')sw.controller={state:'activated'};
  if(kind==='legacy'||!ports.length){for(const fn of listeners)fn({source:ctrl,data:payload});}
  else ports[0].postMessage(payload);
 }};
 const sw={controller:ctrl,addEventListener(k,fn){listeners.add(fn);},removeEventListener(k,fn){listeners.delete(fn);}};
 class MC{constructor(){this.port1={onmessage:null,close(){closed++;}};this.port2={postMessage:data=>this.port1.onmessage?.({data})};}}
 const ask=new Function('navigator','MessageChannel','setTimeout','clearTimeout',extractUpdaterIdentity(updaterSource))({serviceWorker:sw},MC,fn=>{timers.set(++id,fn);return id;},i=>timers.delete(i));
 const pending=ask();for(const [i,fn] of [...timers]){timers.delete(i);fn();}
 assert.equal(await pending,kind==='port'||kind==='legacy'?'f123-shell-v936':'');
 assert.equal(listeners.size,0);assert.equal(timers.size,0);assert.equal(closed,kind==='activating'?0:1);assert.equal(requests,kind==='activating'?0:1);
});
