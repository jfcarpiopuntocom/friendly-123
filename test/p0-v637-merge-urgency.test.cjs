'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const start=source.indexOf('  const URGENCIA_MERGE = Object.freeze(');
const end=source.indexOf('  function aplicarCatalogo(',start);
assert.ok(start>0&&end>start,'persist urgency classifier exists in shipped app');
const ctx=vm.createContext({});
vm.runInContext(source.slice(start,end)+'\nthis.urgency=_urgenciaPersistenciaMerge;',ctx);
const classify=(remote,productOnly,pins=[],name=false)=>ctx.urgency(remote,productOnly,pins,name);
test('an incremental product+activity projection may paint before A/B backup',()=>{
 assert.equal(classify({productos:[{id:'sku'}],actividad:[{id:'event'}],gastos:[],ventas:[]},true),'diferible');
});
for(const [label,remote,pins,name] of [
 ['expense',{productos:[{id:'sku'}],gastos:[{id:'expense',monto:5}]},[],false],
 ['sale',{productos:[{id:'sku'}],ventas:[{id:'sale'}]},[],false],
 ['PIN',{productos:[{id:'sku'}]},[Promise.resolve(true)],false],
 ['owner business-name change',{productos:[{id:'sku'}]},[],true],
 ['unknown future collection',{productos:[{id:'sku'}],futuro:[{id:'new'}]},[],false],
])test(label+' always requires immediate durability',()=>{
 assert.equal(classify(remote,true,pins,name),'inmediato');
});
test('full catalogues remain immediate, including a payload of products only',()=>{
 assert.equal(classify({productos:[{id:'sku'}]},false),'inmediato');
});
