'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/index.html'),'utf8').replace(/\r\n/g,'\n');
const swSource=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const shell=/^const CACHE = "([^"]+)";/m.exec(swSource)?.[1];
const generation=/^const CACHE_GENERACION = "([^"]+)";/m.exec(swSource)?.[1];
assert.match(shell,/^f123-shell-v\d+$/);assert.match(generation,/^-golden\d+$/);
const canonical=shell+generation;
const allCaches=[canonical,'f123-shell-v564-golden127',canonical+'-next',canonical+'-previo','amigable-123-shell','other-app-cache'];
const home='https://jfcarpiopuntocom.github.io/friendly-123/';
const begin=source.indexOf('// SW nuke: flag va PRIMERO');
const end=source.indexOf('</script>',begin);
assert.ok(begin>0&&end>begin);
const script=source.slice(source.indexOf('(function(){',begin),end);
async function run({path='',quota=false,flagged=false,empty=false,foreignOnly=false,loggedIn=false}={}){
 const p=home+path;
 const actions={get:0,mark:0,unregister:[],deleted:[],reloaded:0};
 const entries=empty?[]:[
   {scope:p,active:{scriptURL:p+'sw.js'},unregister(){actions.unregister.push('self');return Promise.resolve(true)}},
   {scope:home+'other-app/',active:{scriptURL:home+'other-app/sw.js'},unregister(){actions.unregister.push('other');return Promise.resolve(true)}}
 ];
 if(foreignOnly)entries.shift();
 const context={URL,location:{href:p,reload(){actions.reloaded++}},navigator:{serviceWorker:{getRegistrations(){actions.get++;return Promise.resolve(entries)}}},
 sessionStorage:{getItem:k=>loggedIn&&k==='f123_sesion'?'synthetic-session':null},
 localStorage:{getItem(){return flagged?'1':null},setItem(){actions.mark++;if(quota)throw Object.assign(Error('quota'),{name:'QuotaExceededError'})}},
 caches:{keys(){return Promise.resolve(allCaches)},delete(k){actions.deleted.push(k);return Promise.resolve(true)}},
 Promise,console,setTimeout(fn){fn()}};
 vm.runInNewContext(script,context);for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));return actions;
}
test('stable unregisters only its own SW',async()=>{const a=await run();assert.deepEqual(a.unregister,['self'])});
test('stable deletes only its own current and historical golden caches',async()=>{const a=await run();assert.deepEqual(a.deleted,[canonical,'f123-shell-v564-golden127'])});
test('next deletes only next channel cache',async()=>{const a=await run({path:'next/'});assert.deepEqual(a.unregister,['self']);assert.deepEqual(a.deleted,[canonical+'-next'])});
test('previo deletes only previo channel cache',async()=>{const a=await run({path:'previo/'});assert.deepEqual(a.unregister,['self']);assert.deepEqual(a.deleted,[canonical+'-previo'])});
test('under full localStorage quota no destructive action is attempted',async()=>{const a=await run({quota:true});assert.equal(a.get,0);assert.deepEqual(a.deleted,[]);assert.deepEqual(a.unregister,[]);assert.equal(a.reloaded,0)});
test('already flagged or no SW does not clear caches',async()=>{const a=await run({flagged:true});assert.equal(a.get,0);const b=await run({empty:true});assert.deepEqual(b.deleted,[])});
test('foreign SW alone does not trigger cleanup or reload',async()=>{const a=await run({foreignOnly:true});assert.equal(a.get,1);assert.deepEqual(a.unregister,[]);assert.deepEqual(a.deleted,[]);assert.equal(a.reloaded,0)});

test('active client session forbids all SW unregister, cache purge and reload',async()=>{const a=await run({loggedIn:true});assert.equal(a.get,0);assert.equal(a.mark,0);assert.deepEqual(a.deleted,[]);assert.deepEqual(a.unregister,[]);assert.equal(a.reloaded,0);});
