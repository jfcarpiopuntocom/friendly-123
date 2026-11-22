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
