'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const file of ['src/app/app-inline-03.js','docs/app-inline-03.min.js']){
 const src=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const begin=src.indexOf('async function intentar()'),end=src.indexOf('function shellDelSW()',begin);
 assert.ok(begin>=0&&end>begin,file+' handler exists');
 const fragment=src.slice(begin,end);
 async function run({safe=true,matching=true}={}){
  let reloads=0,shown=0,removed=0,checks=0,marks=[];
  const values=new Map([['pending','1']]);
  const ctx={document:{visibilityState:'visible'},window:{requestAnimationFrame:fn=>fn()},
    recargando:false,Date,JSON,KA:'history',vigilar(){},limpiarFrenada(){},
    pendiente:()=>values.get('pending')==='1',puedeRecargarVersion:()=>true,
    shellDelSW:async()=>matching?'f123-shell-v874':'f123-shell-v873',
    localStorage:{getItem:()=> 'v0.8.74|f123-shell-v874'},
    KP:'pending',seguro:()=>{checks++;return typeof safe==='function'?safe(checks):safe;},
    mostrarSplashActualizando(){shown++;return {remove(){removed++;}};},
    sessionStorage:{removeItem:k=>values.delete(k),setItem:(k,v)=>values.set(k,String(v))},
    location:{reload(){reloads++;}},marcarRecarga:x=>marks.push(x)};
  vm.createContext(ctx);vm.runInContext(fragment+'\nthis.press=intentar;',ctx);
  await ctx.press();
  return {reloads,shown,removed,marks,session:values,checks};
 }
 test(file+' refuses upgrade without PIN-screen safety',async()=>{
   const r=await run({safe:false});assert.equal(r.reloads,0);assert.equal(r.shown,0);
 });
 test(file+' refuses stale SW and keeps the update pending',async()=>{
   const r=await run({matching:false});assert.equal(r.reloads,0);assert.equal(r.shown,0);
   assert.equal(r.session.get('pending'),'1');
 });
 test(file+' removes Updating splash when PIN disappears during handoff',async()=>{
   const r=await run({safe:k=>k<3});
   assert.equal(r.reloads,0);assert.equal(r.shown,1);assert.equal(r.removed,1);
   assert.equal(r.session.get('pending'),'1');
 });
 test(file+' PIN adoption shows splash, then navigates and records the new shell',async()=>{
   const r=await run();assert.equal(r.reloads,1);assert.equal(r.shown,1);
   assert.deepEqual(r.marks,['version-pin']);
   assert.equal(r.session.has('pending'),false);
 });
}
