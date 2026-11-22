'use strict';
// C167 Safari P0: one registration check per ordinary page open, not duplicate
// explicit update immediately afterwards. Source-executed production bootstrap.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
function registrationFixture(){
 const start=source.indexOf('if ("serviceWorker" in navigator) {');
 const end=source.indexOf('// 4D: compare the PUBLIC shell',start);
 assert.ok(start>=0&&end>start,'extract live Safari bootstrap');
 let handler=null,registerCalls=0,forcedUpdates=0,urlSeen='',optionsSeen=null;
 const reg={update(){forcedUpdates++;return Promise.resolve(this);}};
 const sw={controller:{},addEventListener(){},
   register(url,options){urlSeen=url;optionsSeen=options;registerCalls++;return Promise.resolve(reg);}
 };
 const sandbox={window:{addEventListener(type,fn){if(type==='load')handler=fn;}},navigator:{serviceWorker:sw},
  localStorage:{getItem(){return 'v0.8.62|f123-shell-v862';}},console};
 vm.runInNewContext(source.slice(start,end),sandbox,{filename:'app-inline-03-sw-bootstrap.js'});
 return {start(){assert.equal(typeof handler,'function');handler();return Promise.resolve().then(()=>Promise.resolve());},
   counts(){return {registerCalls,forcedUpdates,urlSeen,optionsSeen}}};
}
test('C167 RED: ordinary Safari load registers once, performs ZERO forced SW update fetches',async()=>{
 const f=registrationFixture();await f.start();const v=f.counts();
 assert.equal(v.registerCalls,1,'keep ordinary registered PWA and offline shell');
 assert.equal(v.forcedUpdates,0,'register already checks; redundant update strains Safari');
 assert.equal(v.urlSeen,'./sw.js');
 assert.equal(v.optionsSeen.updateViaCache,'none','preserve cache bypass on actual version checks');
});
test('C167: repeated current-version Safari page opens do not multiply forced update checks',async()=>{
 let forced=0;
 for(let n=0;n<5;n++){const f=registrationFixture();await f.start();forced+=f.counts().forcedUpdates;}
 assert.equal(forced,0,'old code requested 5 additional SW update checks in 5 page opens');
});
test('C167: keep explicit updates when server version differs and safe reload path intact',()=>{
 assert.match(source,/const r = await fetch\("\.\/version\.json\?ts="/);
 assert.match(source,/for \(const g of regs\) \{ try \{ await g\.update\(\); \} catch \(_\) \{\} \}/);
 assert.match(source,/function _recargarSeguroVersion\(\)/);
 assert.match(source,/reg\.waiting\.postMessage\(\{ tipo: "skip-waiting" \}\)/);
});

test('C167: source-executed version change STILL requests one explicit SW update and defers reload safely',async()=>{
 const start=source.indexOf('(async function () {',source.indexOf('// 4D:'));
 const end=source.indexOf('})();',start)+5;
 assert.ok(start>=0&&end>start,'extract real version-check IIFE');
 const store=new Map([['f123_version_vista','v0.8.62|f123-shell-v862']]);
 let updates=0;
 const sandbox={
   navigator:{serviceWorker:{controller:{},getRegistrations:async()=>[{update:async()=>{updates++;}}]}},
   window:{},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
   sessionStorage:{setItem:(k,v)=>store.set('session:'+k,v)},
   fetch:async()=>({ok:true,json:async()=>({version:'v0.8.64',shell:'f123-shell-v864'})}),
   Date,JSON,Promise,setTimeout:()=>0
 };
 vm.runInNewContext(source.slice(start,end),sandbox,{filename:'app-inline-03-live-version-check.js'});
 for(let i=0;i<24;i++)await Promise.resolve();
 assert.equal(updates,1,'real version mismatch still actively updates the registered SW');
 assert.equal(store.get('f123_version_vista'),'v0.8.64|f123-shell-v864');
 assert.equal(store.get('session:f123_reload_al_entrar'),'1','reload remains deferred until safe login');
});
