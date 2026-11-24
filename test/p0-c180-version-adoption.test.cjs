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
  const updater=script.slice(from,to).replace(/,$/, ';');
  function fixture({durable=true,editing=false,matching=true,visible=false,recovering=false,pending=true,pin=false,authenticated=true,sale=false}={}) {
    let calls=0,saves=0,now=100000,splash=null;
    const session=new Map([...(authenticated?[['f123_sesion','1']]:[]),...(pending?[['f123_act_sola_pendiente','1']]:[])]);
    const local=new Map([['f123_version_vista','v0.8.73|f123-shell-v873']]);
    const storage=m=>({getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)});
    const listeners={};
    const sw={controller:{postMessage(){const fn=listeners.message;if(fn)fn({data:{tipo:'shell-actual',shell:matching?'f123-shell-v873':'f123-shell-v872'}});}},
      addEventListener:(k,fn)=>listeners[k]=fn,removeEventListener:(k,fn)=>{if(listeners[k]===fn)delete listeners[k]},
      getRegistration:async()=>({update:async()=>{}})};
    const gate=pin?{style:{display:'flex'},getClientRects:()=>[{}]}:null;
    const document={visibilityState:visible?'visible':'hidden',activeElement:editing?{tagName:'INPUT'}:null,
      getElementById:id=>id==='oc-gate'?gate:null,querySelectorAll:()=>[],addEventListener(){},
      body:{appendChild(el){splash=el}},createElement:()=>({style:{},setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]},innerHTML:''})};
    const window={addEventListener(){},requestAnimationFrame:fn=>fn(),OCYjs:recovering?{estado:'activo',canal:{recuperando:true}}:null,
      OCSync:authenticated?{confirmarCatalogoDurable:async()=>{saves++;return durable}}:undefined};
    const ctx={window,navigator:{serviceWorker:sw},document,localStorage:storage(local),sessionStorage:storage(session),
      Date:{now:()=>now},setTimeout:()=>1,clearTimeout(){},setInterval(){},getComputedStyle:()=>({display:'block'}),
      _ventasEnCurso:new Set(sale?['pending-sale']:[]),_ocActSolaOn:true,_recargarSeguroVersion(){},location:{reload(){calls++}},
      fetch:async()=>({ok:false})};
    vm.runInNewContext(updater,ctx);
    return {window,session,splash:()=>splash,stats:()=>({calls,saves})};
  }
  test(file+' applies a confirmed new SW exactly once with durable ACK when visible, never when hidden',async()=>{
    const hidden=fixture({pin:true,authenticated:false,visible:false});
    assert.equal(await hidden.window._ocActSola.intentar(),false,'must never reload while Safari is hidden');
    assert.equal(hidden.stats().calls,0);
    const f=fixture({pin:true,authenticated:false,visible:true});assert.equal(await f.window._ocActSola.intentar(),true);
    assert.equal(f.stats().calls,1);assert.equal(f.stats().saves,0);
    assert.equal(f.session.get('f123_act_sola_pendiente'),undefined);
    assert.equal(await f.window._ocActSola.intentar(),false);
    assert.equal(f.stats().calls,1);
  });
  test(file+' updates at PIN before login even during PIN typing, without waiting or OCSync',async()=>{
    const f=fixture({pin:true,authenticated:false,editing:true,visible:true});
    assert.equal(await f.window._ocActSola.intentar(),true);
    assert.deepEqual(f.stats(),{calls:1,saves:0});
    assert.match(f.splash().innerHTML,/Updating/,'a real splash is visible before adoption');
    assert.equal(f.splash().getAttribute?.('role'),'status');
    assert.equal(f.session.get('f123_act_sola_pendiente'),undefined);
    assert.equal(await f.window._ocActSola.intentar(),false,'same shell cannot repeatedly navigate');
    assert.equal(f.stats().calls,1);
  });
  test(file+' at PIN blocks stale SW, recovering IDB, active sale and not-yet-confirmed update',async()=>{
    for(const o of [{matching:false},{recovering:true},{sale:true},{pending:false}]){
      const f=fixture({pin:true,authenticated:false,editing:true,visible:true,...o});
      assert.equal(await f.window._ocActSola.intentar(),false,JSON.stringify(o));
      assert.equal(f.stats().calls,0);
    }
    const gateMissing=fixture({pin:false,authenticated:false,visible:true});
    assert.equal(await gateMissing.window._ocActSola.intentar(),false);
  });
  test(file+' never automatically reloads a logged-in working app, even idle or backgrounded',async()=>{
    for(const o of [{},{editing:true},{recovering:true},{visible:true},{durable:false},{pending:false},{sale:true}]) {
      const f=fixture(o);
      assert.equal(await f.window._ocActSola.intentar(),false,JSON.stringify(o));
      assert.equal(f.stats().calls,0);
      assert.equal(f.splash(),null,'no Updating overlay inside app');
    }
  });
}
