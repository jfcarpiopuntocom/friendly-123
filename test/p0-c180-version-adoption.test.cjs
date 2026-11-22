'use strict';
// C180: source and actual published bundle must both adopt the new shell.
// Browser-state simulation only; no customer data, no network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
for (const file of ['src/app/app-inline-03.js','docs/app-inline-03.min.js']) {
  const script=fs.readFileSync(path.join(root,file),'utf8');
  const start=script.indexOf('(function actualizacionSola()'),end=script.indexOf('// Microcirugia 5',start);
  // The minified JS has no comments; its IIFE starts after the _ocActSolaOn declaration.
  const from=start>=0?start:script.indexOf('(function(){if(!_ocActSolaOn');
  const to=end>from?end:script.indexOf('window.addEventListener("oc-datos-importados"',from);
  assert.ok(from>=0&&to>from,file+' updater source must exist');
  const updater=script.slice(from,to);
  function fixture({durable=true,editing=false,matching=true,visible=false,recovering=false,pending=true}={}) {
    let calls=0,saves=0,now=100000;
    const session=new Map([['f123_sesion','1'],...(pending?[['f123_act_sola_pendiente','1']]:[])]);
    const local=new Map([['f123_version_vista','v0.8.73|f123-shell-v873']]);
    const storage=m=>({getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)});
    const listeners={};
    const sw={controller:{postMessage(){const fn=listeners.message;if(fn)fn({data:{tipo:'shell-actual',shell:matching?'f123-shell-v873':'f123-shell-v872'}});}},
      addEventListener:(k,fn)=>listeners[k]=fn,removeEventListener:(k,fn)=>{if(listeners[k]===fn)delete listeners[k]},
      getRegistration:async()=>({update:async()=>{}})};
    const document={visibilityState:visible?'visible':'hidden',activeElement:editing?{tagName:'INPUT'}:null,
      getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}};
    const window={addEventListener(){},OCYjs:recovering?{estado:'activo',canal:{recuperando:true}}:null,
      OCSync:{confirmarCatalogoDurable:async()=>{saves++;return durable}}};
    const ctx={window,navigator:{serviceWorker:sw},document,localStorage:storage(local),sessionStorage:storage(session),
      Date:{now:()=>now},setTimeout:()=>1,clearTimeout(){},setInterval(){},getComputedStyle:()=>({display:'block'}),
      _ventasEnCurso:new Set(),_ocActSolaOn:true,_recargarSeguroVersion(){},location:{reload(){calls++}},
      fetch:async()=>({ok:false})};
    vm.runInNewContext(updater,ctx);
    return {window,session,stats:()=>({calls,saves})};
  }
  test(file+' applies a confirmed new SW exactly once with durable ACK',async()=>{
    const f=fixture();assert.equal(await f.window._ocActSola.intentar(),true);
    assert.equal(f.stats().calls,1);assert.equal(f.stats().saves,1);
    assert.equal(f.session.get('f123_act_sola_pendiente'),undefined);
    assert.equal(await f.window._ocActSola.intentar(),false);
    assert.equal(f.stats().calls,1);
  });
  test(file+' defers editor, recovery, stale SW, recent interaction, failed save',async()=>{
    for(const o of [{editing:true},{recovering:true},{matching:false},{visible:true},{durable:false},{pending:false}]) {
      const f=fixture(o);assert.equal(await f.window._ocActSola.intentar(),false,JSON.stringify(o));
      assert.equal(f.stats().calls,0,JSON.stringify(o));
    }
  });
}
