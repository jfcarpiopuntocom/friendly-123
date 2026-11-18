'use strict';
// Belén STK-H2: exercise the REAL shelf-camera callback, no customer data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/vista-perchas.js'),'utf8');
const start=source.indexOf("  inputFoto.addEventListener('change', () => {");
const end=source.indexOf('  // ── un solo listener delegado',start);
assert.ok(start>0&&end>start,'execute actual shelf photo capture handler');
const block=source.slice(start,end);
const photo='data:image/png;base64,'+Buffer.from('synthetic Belén STK-H2 QA, no real photo').toString('base64');
async function run({put='success',hash='success',byId=true,shopSwitch=false}={}){
 const warnings=[],alerts=[],writes=[],saved=[],events={},timeouts=[];
 let reloads=0,currentShop='shop-A',done=null,handler=null;
 const window={
  OCTienda:{licenciaActual:()=>currentShop},
  OCSalud:{fallo:(scope,code)=>warnings.push([scope,code])},
  addEventListener:(type,fn)=>{events[type]=fn},
  OCFotos:{
   guardarFoto:async(id,bytes)=>{saved.push([id,bytes]);return byId},
   guardarFotoContenido:async(bytes)=>{
    if(hash==='throw')throw Error('synthetic photo hash quota');
    if(shopSwitch)currentShop='shop-B';
    return 'sha-synthetic-photo';
   }
  }
 };
 const inputFoto={files:[{name:'synthetic.png'}],value:'x',addEventListener:(name,fn)=>{if(name==='change')handler=fn}};
 const ctx={window,inputFoto,perchaFotoPendiente:'shelf-A',fotoCache:{},
  redimensionar:(_file,cb)=>{done=Promise.resolve().then(()=>cb(photo));},
  fetch:async(url,options)=>{writes.push({url,body:JSON.parse(options.body)});if(put==='throw')throw Error('synthetic offline');
   return {ok:put==='success',status:put==='success'?200:500};},
  alert:message=>alerts.push(String(message)),cargar:()=>{reloads++;},
  API:'/api',setTimeout:fn=>{timeouts.push(fn);return timeouts.length},console};
 vm.runInNewContext(block,vm.createContext(ctx),{filename:'vista-perchas-photo-capture.js'});
 assert.equal(typeof handler,'function','photo change listener registered');
 handler();
 await done;
 return {warnings,alerts,writes,saved,events,timeouts,reloads,ctx,
  online:()=>events.online?.(),currentShop:()=>currentShop};
}
test('H2 RED: HTTP 500 after durable photo bytes does not claim shelf pointer success',async()=>{
 const x=await run({put:'fail'});
 assert.equal(x.saved.length,1,'exact per-id bytes remain saved');
 assert.equal(x.ctx.fotoCache['shelf-A'],photo,'photo still visible locally');
 assert.equal(x.writes.length,1,'first attempted pointer write is traceable');
 assert.equal(x.warnings.length,1,'pointer failed => non-silent diagnostic');
 assert.match(x.alerts[0]||'',/foto|photo/i,'user knows device copy is local-only');
});
test('H2 RED: network rejection is diagnosed, retained and recoverable',async()=>{
 const x=await run({put:'throw'});
 assert.equal(x.saved.length,1);
 assert.equal(x.warnings.length,1);
 assert.equal(x.reloads,1,'existing recovery path is rechecked');
});
test('H2: acknowledged PUT emits no false warning or duplicate upload',async()=>{
 const x=await run();
 assert.equal(x.writes.length,1);
 assert.equal(x.writes[0].body.fotoHash,'sha-synthetic-photo');
 assert.equal(x.warnings.length,0);
 assert.equal(x.alerts.length,0);
 assert.equal(x.reloads,1);
});
test('H2 RED: hash-store quota never silently pretends remote photo availability',async()=>{
 const x=await run({hash:'throw'});
 assert.equal(x.saved.length,1);
 assert.equal(x.writes.length,0);
 assert.equal(x.warnings.length,1);
 assert.equal(x.ctx.fotoCache['shelf-A'],photo);
});
test('H2 RED: do not publish old-shop photo pointer after notebook switches in await',async()=>{
 const x=await run({shopSwitch:true});
 assert.equal(x.writes.length,0,'old shop hash may never be applied to a new notebook');
 assert.equal(x.warnings.length,1);
});
test('H2 RED: reconnect re-runs exact-shelf policy recovery, not old blind PUT',async()=>{
 const x=await run({put:'fail'});
 const puts=x.writes.length, before=x.reloads;
 x.online();
 assert.equal(x.writes.length,puts,'online handler must not write old pointer directly');
 assert.ok(x.reloads>before,'recoverShelfPhoto policy will use only current shelf evidence');
});
test('H2: failed per-id save stops before hashing or PUT',async()=>{
 const x=await run({byId:false});
 assert.equal(x.writes.length,0);
 assert.equal(x.warnings.length,0);
 assert.equal(x.reloads,0);
 assert.equal(x.alerts.length,1);
});
