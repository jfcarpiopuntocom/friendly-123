'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');
const begin=source.indexOf('    if (!localStorage.getItem("f123_secure")) {',source.indexOf('async function migrarSiHaceFalta()'));
const end=source.indexOf('    } else if (estadoSecreto() === "corrupto") {',begin);
if(begin<0||end<0)throw new Error('migration source boundary missing');
const branch=source.slice(begin,end)+'    }';
async function migrateFixture(stored,seedLegacy=null){
 const data=new Map(Object.entries(stored));
 if(seedLegacy!==null)data.set('f123_auth',JSON.stringify(seedLegacy));
 let writes=0;
 const localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const context={localStorage,JSON,guardarSecreto:async()=>{writes++;data.set('f123_secure','generated');}};
 vm.createContext(context);
 const result=await vm.runInContext('(async function(){'+branch+'})()',context);
 return {result,writes,secret:data.get('f123_secure'),legacy:data.get('f123_auth')};
}
test('activated browser with missing verifier must not invent factory PINs',async()=>{
 const x=await migrateFixture({'f123_owned':JSON.stringify({instanceId:'synthetic-peer-b'})});
 assert.equal(x.result,false);assert.equal(x.writes,0);assert.equal(x.secret,undefined);
});
test('legacy PIN migration remains available to activated browser',async()=>{
 const x=await migrateFixture({'f123_owned':JSON.stringify({instanceId:'synthetic-peer-b'})},{owner:'111',encargados:[],acct:'222'});
 assert.equal(x.writes,1);assert.equal(x.secret,'generated');assert.equal(x.legacy,undefined);
});
test('new unactivated browser retains original onboarding behavior',async()=>{
 const x=await migrateFixture({});
 assert.equal(x.writes,1);assert.equal(x.secret,'generated');
});
test('existing verifier is never replaced by missing-secret migration',async()=>{
 const x=await migrateFixture({'f123_owned':JSON.stringify({instanceId:'synthetic'}),'f123_secure':'unchanged'});
 assert.equal(x.writes,0);assert.equal(x.secret,'unchanged');
});

test('legacy licensed notebook without instanceId never invents a new owner PIN',async()=>{
 const x=await migrateFixture({'f123_owned':JSON.stringify({licenseCode:'F123-SYNTHETIC-LICENSE'})});
 assert.equal(x.result,false);assert.equal(x.writes,0);
});
test('joined business without owned metadata never invents new PINs',async()=>{
 const x=await migrateFixture({'f123_tienda_activa':'synthetic-business'});
 assert.equal(x.result,false);assert.equal(x.writes,0);
});
test('a stored collection of businesses without active selection is protected',async()=>{
 const x=await migrateFixture({'f123_tiendas':JSON.stringify({'synthetic-store':{}})});
 assert.equal(x.result,false);assert.equal(x.writes,0);
});
