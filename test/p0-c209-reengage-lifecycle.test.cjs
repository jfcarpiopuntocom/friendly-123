'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
const a=src.indexOf('(function actualizacionSola()');
const b=src.indexOf('// Microcirugia 5',a);
assert.ok(a>=0&&b>a);
const code=src.slice(a,b);
test('C209 manual _purge reentry updates old SW controller in place, then allows a later new-shell upgrade', async()=>{
  const local=new Map([['f123_version_vista','v0.8.92|f123-shell-v892']]);
  const session=new Map([['f123_act_sola_pendiente','1'],['f123_autorecarga','{"shell":"f123-shell-v891"}']]);
  const st=m=>({
    getItem:k=>m.has(k)?m.get(k):null,
    setItem:(k,v)=>m.set(k,String(v)),
    removeItem:k=>m.delete(k)
  });
  let serverShell='f123-shell-v892',controllerShell='f123-shell-v891';
  let reloads=0,updates=0,skips=0;
  const swListeners=new Map();
  const emit=(ev,data)=>{for(const fn of swListeners.get(ev)||[])fn({data});};
  const sw={
    controller:{postMessage({tipo}){if(tipo==='que-shell')emit('message',{tipo:'shell-actual',shell:controllerShell});}},
    addEventListener(type,fn){const list=swListeners.get(type)||[];list.push(fn);swListeners.set(type,list);},
    removeEventListener(type,fn){swListeners.set(type,(swListeners.get(type)||[]).filter(x=>x!==fn));},
    getRegistration:async()=>({
      update:async()=>{updates++},
      waiting:{postMessage(){skips++}}
    })
  };
  const gate={style:{display:'block'},getClientRects:()=>[{}]};
  const document={
    visibilityState:'hidden',
    getElementById:id=>id==='oc-gate'?gate:null,
    querySelectorAll:()=>[],addEventListener(){},
    body:{appendChild(){}},
    createElement:()=>({style:{},setAttribute(){},remove(){},innerHTML:''})
  };
  const window={__f123ManualPurgeReentry:true,addEventListener(){},OCYjs:null};
  const ctx={window,navigator:{serviceWorker:sw},document,
    localStorage:st(local),sessionStorage:st(session),
    getComputedStyle:()=>({display:'block'}),
    fetch:async()=>({ok:true,json:async()=>({shell:serverShell,version:serverShell==='f123-shell-v892'?'v0.8.92':'v0.8.93'})}),
    Date:{now:()=>10},setTimeout:()=>123,clearTimeout(){},setInterval(){},
    location:{reload(){reloads++}},_ocActSolaOn:true,_recargarSeguroVersion(){}
  };
  vm.runInNewContext(code,ctx);
  assert.equal(session.has('f123_act_sola_pendiente'),false,'startup clears stale update flag');
  assert.equal(session.has('f123_autorecarga'),false,'startup clears previous anti-loop marker');
  await window._ocActSola.revisar();
  assert.equal(updates,1,'old controller is explicitly updated to fresh document shell');
  assert.equal(reloads,0,'manual reentry already fetched new document');
  assert.equal(session.has('f123_act_sola_pendiente'),false);
  assert.equal(await window._ocActSola.intentar(),false,'same release never causes second navigation');
  assert.equal(reloads,0);

  serverShell='f123-shell-v893';
  controllerShell='f123-shell-v892';
  await window._ocActSola.revisar();
  // revisar() starts intentar() asynchronously on a version mismatch.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates,2,'later server version remains eligible for update');
  controllerShell='f123-shell-v893';
  assert.equal(await window._ocActSola.intentar(),true,'later version adopts at PIN');
  assert.equal(reloads,1,'new release navigates exactly once');
  assert.equal(await window._ocActSola.intentar(),false,'same new release cannot reload twice');
  assert.equal(reloads,1);
  assert.ok(skips>=1,'waiting SW takeover requested');
});
