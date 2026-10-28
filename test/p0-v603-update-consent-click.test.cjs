'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const files=['src/app/app-inline-03.js','docs/app-inline-03.min.js'];
for (const file of files) {
 const src=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const begin=src.indexOf('async function intentar()'),end=src.indexOf('function shellDelSW()',begin);
 assert.ok(begin>=0&&end>begin,'actual automatic adoption handler must exist');
 const fragment=src.slice(begin,end);
 async function run({safe,confirmed}){
  let reloads=0, durableCalls=0, marks=[];
  const values=new Map([['pending','1']]);
  const ctx={document:{visibilityState:'hidden'},recargando:false,ultimoToque:0,Date,JSON,KA:'history',vigilar(){},limpiarFrenada(){},pendiente:()=>true,localStorage:{getItem:()=>null,setItem(){}},
    KP:'pending',KF:'frozen',safeCalls:0,
    seguro:()=>{ctx.safeCalls++;return typeof safe==='function'?safe(ctx.safeCalls):safe;},
    guardarDuradero:async()=>{durableCalls++;return confirmed;},
    sessionStorage:{removeItem:k=>values.delete(k)},location:{reload:()=>{reloads++;}},
    marcarRecarga:x=>marks.push(x)};
  vm.createContext(ctx);
  vm.runInContext(fragment+'\nthis.press=intentar;',ctx);
  await ctx.press();
  return {reloads,durableCalls,marks,session:values,checks:ctx.safeCalls};
 }
 test(file+' — pending peer recovery refuses automatic upgrade',async()=>{
   const r=await run({safe:false,confirmed:true});
   assert.equal(r.reloads,0);assert.equal(r.durableCalls,0);

 });
 test(file+' — failed durable save must never reload',async()=>{
   const r=await run({safe:true,confirmed:false});
   assert.equal(r.reloads,0);assert.equal(r.durableCalls,1);
   assert.equal(r.session.get('pending'),'1');
 });
 test(file+' — editor or sale opening while save awaits must defer upgrade',async()=>{
   const r=await run({safe:k=>k===1,confirmed:true});
   assert.equal(r.reloads,0);assert.equal(r.durableCalls,1);
   assert.equal(r.session.get('pending'),'1');
 });
 test(file+' — safe automatic adoption + durable ACK reloads once and logs cause',async()=>{
   const r=await run({safe:true,confirmed:true});
   assert.equal(r.reloads,1);assert.equal(r.durableCalls,1);
   assert.deepEqual(r.marks,['version-segura']);
   assert.equal(r.session.has('pending'),false);
 });
}
