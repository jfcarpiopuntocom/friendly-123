'use strict';
// Contract parity: the new Dashboard validator MUST accept/reject the exact
// business fact chains that existing docs/hechos.js checks, without DB writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash,webcrypto}=require('node:crypto');
const app=fs.readFileSync(path.join(__dirname,'../docs/hechos.js'),'utf8');
const pure=fs.readFileSync(path.join(__dirname,'../docs/core/hechos-chain-readonly.js'),'utf8');
function context(crypto=webcrypto){
 const w={crypto,TextEncoder,localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener(){},AMG:{},console};
 w.window=w;vm.runInNewContext(app,w);vm.runInNewContext(pure,w);
 assert.equal(typeof w.AMG.Hechos.verificarCadenas,'function');
 assert.equal(typeof w.F123HechosChain.verificarCadenas,'function');
 return w;
}
function weak(s){
 let h1=0x811c9dc5,h2=0x01000193;
 for(let i=0;i<s.length;i++){let c=s.charCodeAt(i);h1=(h1^c)>>>0;h1=(h1*0x01000193)>>>0;h2=(h2+c*(i+1))>>>0}
 return 'w:'+h1.toString(16)+h2.toString(16);
}
function create(author,num,previous,kind='cartera_abono',mode='strong'){
 const h={id:author+'-'+num,instanceId:author,autor:'dueno',reloj:{[author]:num},
   ts:1763400000000+num,tipo:kind,datos:{monto:12.35},hashPrevio:previous||'',hash:''};
 const raw=JSON.stringify({id:h.id,instanceId:h.instanceId,autor:h.autor,reloj:h.reloj,
   ts:h.ts,tipo:h.tipo,datos:h.datos,hashPrevio:h.hashPrevio});
 h.hash=mode==='weak'?weak(raw):createHash('sha256').update(raw).digest('hex');return h;
}
test('H6 source parity with app: SHA, weak legacy, mixed authors, gaps, edits, links, invalid identity, missing crypto',async()=>{
 const a=create('a',1,''),b=create('a',2,a.hash,'caja_chica_ingreso');
 const c=create('b',1,'','cartera_abono','weak');
 const gap=create('a',3,a.hash);
 const tampered=Object.assign({},a,{datos:{monto:100}});
 const wrongLink=Object.assign({},b,{hashPrevio:'no'});
 const wrongId=Object.assign({},a,{id:'WRONG-1'});
 const variants=[
  ['empty',[]],['sha',[a,b]],['weak',[c]],['mixed',[b,c,a]],
  ['gap',[gap]],['tamper',[tampered]],['broken-link',[a,wrongLink]],
  ['wrong-id',[wrongId]],['duplicate-id',[a,a]],
 ];
 for(const [label,rows] of variants){
  const w=context();
  const old=await Promise.resolve(w.AMG.Hechos.verificarCadenas(rows));
  const fresh=await Promise.resolve(w.F123HechosChain.verificarCadenas(rows));
  assert.equal(fresh.ok,old.ok,label+' verdict must match app');
  assert.equal(fresh.razon||null,old.razon||null,label+' reason must match app');
 }
 const w=context(null);const old=await Promise.resolve(w.AMG.Hechos.verificarCadenas([a]));
 const fresh=await Promise.resolve(w.F123HechosChain.verificarCadenas([a]));
 assert.equal(fresh.ok,old.ok);assert.equal(fresh.razon,old.razon);
});
test('H6 pure helper never references storage, network, UI, PIN or finance mutation APIs',()=>{
 assert.doesNotMatch(pure,/\b(?:indexedDB|localStorage|fetch|WebSocket|document|querySelector|PIN|\.put\(|\.delete\(|\.add\()\b/);
 assert.match(pure,/Object\.freeze\(\{ verificarCadenas/);
});
