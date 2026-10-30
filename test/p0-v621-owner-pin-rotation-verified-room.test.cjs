'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const crypto=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../docs/avanzado-extra.js'),'utf8');
const start=crypto.indexOf('  async function fijarOwnerPinDesdeSesion(nuevoPin) {');
const end=crypto.indexOf('  // Cambia SOLO el PIN de encargado',start);
assert.ok(start>0&&end>start,'RED: current owner cannot rotate PIN when login came from recovered room and local verifier is missing');
const method=crypto.slice(start,end);
const license='F123-SYNTHETIC-ROOM';
async function simulate({local='vacio',ready=true,sameLicense=true,role='dueno',entered='432',roomOwner='432',storeOk=true}={}){
 const calls=[],state={status:local};
 const fn=new Function('status','ready','sameLicense','role','entered','roomOwner','storeOk','license','calls',`
 const window={OCAuth:{rolActual:()=>role},OCTienda:{licenciaActual:()=>license},
   OCYjs:{roomId:'room-synthetic',canal:{recuperando:!ready},
    meta:{get:key=>key==='pinsRol'?{owner:roomOwner,emp:'671',acct:'128'}:null}}};
 const localStorage={getItem:key=>key==='f123_owned'?JSON.stringify({licenseCode:sameLicense?license:'F123-OTHER-ROOM'}):null};
 const estadoSecreto=()=>status.status;
 const leerPinQueAbre=()=>({owner:entered});
 const fijarOwnerPin=async(v)=>{calls.push('rotate:'+v);return storeOk;};
 const instalarCredencialesDesdeSala=async(team)=>{calls.push('bootstrap:'+team.owner); status.status='ok';return true};
 `+method+`;
 return fijarOwnerPinDesdeSesion('864').then(result=>({result,calls,status:status.status}));`);
 return fn(state,ready,sameLicense,role,entered,roomOwner,storeOk,license,calls);
}
test('owner who entered verified recovered-room PIN can rotate when local verifier is absent',async()=>{
 const x=await simulate();
 assert.equal(x.result,true);assert.deepEqual(x.calls,['bootstrap:432','rotate:864']);assert.equal(x.status,'ok');
});
test('refuse mismatched notebook, unfinished recovery, non-owner or stale logged PIN; never synthesize local creds',async()=>{
 for(const options of [{ready:false},{sameLicense:false},{role:'empleado'},{entered:'777'},{roomOwner:'456'}]){
  const x=await simulate(options);assert.equal(x.result,false);assert.deepEqual(x.calls,[]);
 }
});
test('existing local verifier stays on normal path; failed durable write is not called success',async()=>{
 let x=await simulate({local:'ok'});assert.equal(x.result,true);assert.deepEqual(x.calls,['rotate:864']);
 x=await simulate({local:'vacio',storeOk:false});assert.equal(x.result,false);
 x=await simulate({local:'corrupto'});assert.equal(x.result,false);assert.deepEqual(x.calls,[]);
});
test('Advanced owner pencil uses verified-room recovery helper, other roles retain existing editors',()=>{
 assert.match(crypto,/fijarOwnerPinDesdeSesion,/);
 assert.match(ui,/rol === "owner" && window\.OCSecure\.fijarOwnerPinDesdeSesion/);
 assert.match(ui,/window\.OCSecure\[fn\]\(v\)/);
});
