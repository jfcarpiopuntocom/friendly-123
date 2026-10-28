'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sources=['src/app/app-inline-03.js','docs/app-inline-03.min.js'];
function safe(file,state,gateOpen=false) {
 const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const start=s.indexOf('function seguro()');
 const end=s.indexOf('async function intentar()',start);
 assert(start>0&&end>start,'real safety function must exist in '+file);
 const context={
  window:{OCYjs:state},
  sessionStorage:{getItem:k=>k==='f123_sesion'?'synthetic-session':null},
  document:{getElementById:id=>id==='oc-gate'&&gateOpen?{style:{display:'block'}}:null,
    querySelectorAll:()=>[],activeElement:null},
  visible:()=>false,getComputedStyle:()=>({display:'none'}),
 };
 return vm.runInNewContext(s.slice(start,end)+'\nseguro()',context);
}
for(const file of sources){
 test(file+' — never auto-reload during Yjs peer recovery',()=>{
   assert.equal(safe(file,{estado:'activo',canal:{recuperando:true,recuperacionLocal:'listo'}}),false);
 });
 test(file+' — never auto-reload during local IndexedDB recovery',()=>{
   assert.equal(safe(file,{estado:'activo',canal:{recuperando:false,recuperacionLocal:'pendiente'}}),false);
   assert.equal(safe(file,{estado:'activo',canal:{recuperando:false,recuperacionLocal:'listo'},
     _diag:()=>({recuperacionLocalPendiente:true})}),false);
 });
 test(file+' — keep upgrades possible only after completed sync recovery',()=>{
   const ready={recuperando:false,recuperacionLocal:'listo'};
   assert.equal(safe(file,{estado:'activo',canal:ready,opsCanal:ready,fotosCanal:ready,
     _diag:()=>({recuperacionLocalPendiente:false})}),true);
   assert.equal(safe(file,null),true,'a non-Yjs demo may update safely');
   assert.equal(safe(file,null,true),false,'PIN gate still blocks reload');
 });
}
