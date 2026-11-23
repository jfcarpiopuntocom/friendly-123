'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('docs/repair.html');
const script=/<script id="f123-repair-standalone">([\s\S]*?)<\/script>/.exec(html)?.[1];
assert.ok(script,'real stand-alone recovery code must be inline in public HTML');

function fixture(opts={}){
  const calls={fetch:0,unreg:[],del:[],nav:[]};
  const base='https://jfcarpiopuntocom.github.io/friendly-123/';
  const href=base+'repair.html'+(opts.auto?'?from=pin':'');
  const btn={disabled:false,addEventListener(_,fn){this.click=fn}};
  const status={textContent:''},spin={style:{display:'none'}};
  const elements={repair:btn,status,spinner:spin};
  const regs=[
    {scope:base,unregister:async()=>{calls.unreg.push('main');return opts.alreadyRemoved?false:true;}},
    {scope:base+'next/',unregister:async()=>{calls.unreg.push('next');return true;}},
    {scope:'https://jfcarpiopuntocom.github.io/other/',unregister:async()=>{calls.unreg.push('other');return true;}}
  ];
  const cacheNames=['f123-shell-v890-golden426','f123-shell-v892-golden428-next','friendly-other-cache'];
  const cacheStore={
    keys:async()=>cacheNames,
    delete:async n=>{calls.del.push(n);return opts.alreadyRemoved?false:true}
  };
  const location=new URL(href);
  location.replace=url=>calls.nav.push(url);
  const ctx={
    document:{getElementById:id=>elements[id]},
    navigator:{serviceWorker:{getRegistrations:async()=>regs}},
    location,window:{caches:cacheStore},caches:cacheStore,
    fetch:async()=>{calls.fetch++;return {ok:opts.network!==false,status:503,
      json:async()=>({version:'v0.8.93',shell:'f123-shell-v893'})}},
    URL,Promise,setTimeout,clearTimeout,Date,
    // Accessing any customer storage would be an error.
    localStorage:new Proxy({}, {get(){throw Error('business localStorage touched')}}),
    sessionStorage:new Proxy({}, {get(){throw Error('business sessionStorage touched')}})
  };
  vm.runInNewContext(script,ctx,{filename:'docs/repair.html'});
  return {calls,btn,status,spin};
}

test('C210: stand-alone file avoids old SW cache-first shell list',()=>{
  const sw=read('docs/sw.js');
  assert.match(sw,/const esArchivoDelShell = !url\.search && SHELL\.some/);
  assert.doesNotMatch(sw,/"\.\/repair\.html"/,'fresh recovery document must remain outside shell precache');
  assert.doesNotMatch(html,/src="\.\/(?:auth-ui|app-inline|ui2)/,'independent page must not execute stale assets');
  assert.match(read('docs/auth-ui.js'),/location\.replace\(new URL\("\.\/repair\.html\?from=pin&_r="/);
  assert.match(read('docs/auth-ui.min.js'),/repair\.html\?from=pin/,'shipped PIN button must reach independent recovery');
});
test('C210: user click removes only this app SW/caches and opens fresh PIN once',async()=>{
  const f=fixture();
  assert.equal(f.calls.fetch,0,'direct landing initially offers explicit click');
  const p=f.btn.click();
  await f.btn.click();
  await p;
  assert.equal(f.calls.fetch,1,'concurrent clicks share a single repair');
  assert.deepEqual(f.calls.unreg,['main','next'],'other same-origin applications survive');
  assert.deepEqual(f.calls.del,['f123-shell-v890-golden426','f123-shell-v892-golden428-next']);
  assert.equal(f.calls.nav.length,1);
  assert.match(f.calls.nav[0],/^\/friendly-123\/\?_purge=[0-9]+$/);
});
test('C210: PIN button route auto-repairs without a second confirmation',async()=>{
  const f=fixture({auto:true});
  for(let i=0;i<10&&f.calls.nav.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.fetch,1);
  assert.equal(f.calls.nav.length,1);
});
test('C210: offline/error never destroys cached app and preserves retry',async()=>{
  const f=fixture({network:false});
  await f.btn.click();
  assert.equal(f.calls.unreg.length,0);
  assert.equal(f.calls.del.length,0);
  assert.equal(f.calls.nav.length,0);
  assert.equal(f.btn.disabled,false);
  assert.match(f.status.textContent,/incompleta/);
});

test('C210: already-removed SW and caches do not strand a Safari rejoin',async()=>{
  const f=fixture({alreadyRemoved:true});
  await f.btn.click();
  assert.equal(f.calls.nav.length,1,'absence already proves cleanup');
  assert.equal(f.calls.unreg.length,2);
  assert.equal(f.calls.del.length,2);
});
