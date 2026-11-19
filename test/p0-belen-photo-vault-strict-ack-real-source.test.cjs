'use strict';
// Belén H2 v802: real source handler, not a duplicated fake policy.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/vista-perchas.js'),'utf8');
const start=src.indexOf("    const vr = e.target.closest && e.target.closest('[data-vault-restore]');");
const end=src.indexOf('    // Cerrar carpeta',start);
assert.ok(start>0&&end>start,'actual vault restore delegated click must be found in production source');
const block=src.slice(start,end);
const HASH='a'.repeat(64);
async function run({reply={ok:true},switchWhen='',save=true}={}){
 let shop='shop-A',puts=0,refresh=0,alerts=[],writes=0,stopped=0;
 const window={
  OCTienda:{licenciaActual:()=>shop},
  OCFotos:{
    leerPorHash:async()=>{if(switchWhen==='read')shop='shop-B';return 'data:image/jpeg;base64,AAAA';},
    guardarFoto:async()=>{writes++;return save;}
  }
 };
 const ctx={window,document:{querySelector:()=>({value:'shelf-A'})},
  CSS:{escape:x=>x},API:'/api',fotoCache:{},
  fetch:async()=>{puts++;if(switchWhen==='fetch')shop='shop-B';if(reply==='throw')throw Error('offline');return reply;},
  cargar:()=>{refresh++},alert:x=>alerts.push(String(x)),console};
 vm.runInNewContext('this.handle = async function (e) {\n'+block+'\n}',ctx,{filename:'vista-perchas-vault-restore.js'});
 await ctx.handle({target:{closest:()=>({dataset:{vaultRestore:HASH}})},stopPropagation:()=>{stopped++;}});
 return {shop,puts,refresh,alerts,writes,stopped,hash:ctx.fotoCache['shelf-A']};
}
for (const [name,reply] of [['null',null],['no-ok',{status:500}],['explicit-fail',{ok:false,status:500}],['network-fail','throw']])
 test('RED vault restore: '+name+' is never a confirmed restored photo',async()=>{
   const r=await run({reply});
   assert.equal(r.refresh,0,'only explicit success may refresh');
   assert.equal(r.alerts.length,1,'rejected restoration must be visible');
   assert.equal(r.writes,1,'local bytes must still be retained on response failure');
 });
test('RED vault restore: active notebook switch during photo history prevents old-shop PUT',async()=>{
 const r=await run({switchWhen:'read'});
 assert.equal(r.puts,0,'do not write old shop pointer after switch');
 assert.equal(r.refresh,0);
 assert.equal(r.alerts.length,1);
});
test('RED vault restore: active notebook switch during fetch cannot claim restored success',async()=>{
 const r=await run({switchWhen:'fetch'});
 assert.equal(r.refresh,0,'late ACK from another notebook must never confirm');
 assert.equal(r.alerts.length,1);
});
test('vault restore: explicit ok:true in the same notebook succeeds once',async()=>{
 const r=await run();
 assert.equal(r.puts,1);assert.equal(r.refresh,1);assert.equal(r.alerts.length,0);
 assert.match(r.hash,/^data:image\/jpeg;base64/);
});
test('vault restore: failed local photo save never writes remote pointer',async()=>{
 const r=await run({save:false});
 assert.equal(r.puts,0,'remote pointer cannot reference bytes that failed local save');
 assert.equal(r.refresh,0);assert.equal(r.alerts.length,1);
});
