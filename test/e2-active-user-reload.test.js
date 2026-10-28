'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const start=html.indexOf('  function intentar() {'),end=html.indexOf('  function shellDelSW()',start);
assert.ok(start>0&&end>start);
function fixture(visibility,elapsed,safe=true){
 const saved=new Map([['version','1.0|f123-shell-synthetic']]);let reloads=0;
 const local={getItem:k=>k==='f123_version_vista'?saved.get('version'):saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 const attempt=new Function('document','Date','localStorage','sessionStorage','location','ultimoToque','KA','safe','KP',
  `function pendiente(){return true;}function seguro(){return safe;} ${html.slice(start,end)} return intentar;`)(
  {visibilityState:visibility},{now:()=>1000000},local,{removeItem(){}},{reload(){reloads++;}},1000000-elapsed,'reload-history',safe,'pending-marker');
 return {attempt,reloads:()=>reloads};
}
test('E2: version response cannot reload a visible app during recent user activity',()=>{
 const f=fixture('visible',1000);f.attempt();assert.equal(f.reloads(),0);
});
test('E2: idle or hidden is not consent for an app update',()=>{
 for(const [visibility,elapsed]of [['visible',90001],['hidden',1000]]){
  const f=fixture(visibility,elapsed);f.attempt();f.attempt();assert.equal(f.reloads(),0);
 }
 const blocked=fixture('hidden',100000,false);blocked.attempt();assert.equal(blocked.reloads(),0);
});
