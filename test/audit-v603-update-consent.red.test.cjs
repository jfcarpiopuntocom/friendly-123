'use strict';
// INDEPENDENT RED CONTRACT — intentionally catches silent reload after 90 s.
// Does not change app code, PWA caches, licenses, inventory, or payments.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
function fragment(begin,end){
 const a=src.indexOf(begin),b=src.indexOf(end,a);
 assert(a>=0&&b>a,'exact runtime function changed or missing: '+begin);
 return src.slice(a,b);
}
test('JFC: new-version notice must appear immediately even after recovery is completed',()=>{
 const srcFn=fragment('function vigilar() {','// E2: a takeover');
 let shown=0,removed=0;
 const context={
  pendiente:()=>true,recuperacionPendiente:()=>false,
  limpiarFrenada:()=>{},quitarAviso:()=>{removed++;},
  marcarFrenada:()=>{},mostrarAviso:()=>{shown++}
 };
 vm.runInNewContext(srcFn+'\nvigilar();',context);
 assert.equal(shown,1,'Expected immediate update notice for ready notebook, not only pending recovery');
 assert.equal(removed,0,'Must not remove active update notice after successful recovery');
});
test('JFC: idle/hidden alone must never authorize an unsolicited PWA page reload',()=>{
 const srcFn=fragment('function intentar() {','function shellDelSW()');
 const store=new Map([['f123_version_vista','shell v604|f123-shell-v604']]);
 let reloads=0,marked=0;
 const context={
  vigilar:()=>{},pendiente:()=>true,seguro:()=>true,
  document:{visibilityState:'hidden'},ultimoToque:0,
  Date:{now:()=>180001},JSON,
  localStorage:{
   getItem:k=>store.get(k)||null,
   setItem:(k,v)=>store.set(k,v)
  },
  sessionStorage:{removeItem:()=>{}},KP:'pending',KA:'autoreload',
  limpiarFrenada:()=>{},marcarRecarga:()=>{marked++},
  location:{reload:()=>{reloads++;}}
 };
 vm.runInNewContext(srcFn+'\nintentar();',context);
 assert.equal(reloads,0,'No implicit consent from hidden/idle: only explicit user click after durable save');
 assert.equal(marked,0,'No automatic version-idle reload entry');
});
