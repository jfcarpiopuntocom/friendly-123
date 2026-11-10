'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/tab-session.js'),'utf8');
const start=src.indexOf(' function check(){');
const end=src.indexOf(' async function claim(){',start);
assert.ok(start>0&&end>start,'run actual production handoff check function');
const code=src.slice(start,end);
function fixture({pending,hasLease=false}) {
 const calls=[];const ctx={claimed:true,pending,suspendida:false,
   window:{OCAuth:{rolActual:()=> 'dueno'}},
   OCAuth:{rolActual:()=> 'dueno',salir:()=>calls.push('logout')},
   current:()=>hasLease,
   avisarSync:()=>calls.push('sync'),
   render:()=>calls.push('handoff')};
 vm.createContext(ctx);vm.runInContext(code+'\nthis.runCheck=check;',ctx);
 return {ctx,calls};
}
test('Fable P0-2 RED: focus during a pending same-tab lease claim must not log out the PIN owner',()=>{
 const {ctx,calls}=fixture({pending:true});
 assert.equal(ctx.current(),false,'write-fence remains closed while claim is pending');
 ctx.runCheck();
 assert.deepEqual(calls,[],'no self-expulsion while own claim is awaiting SHA-256');
 assert.equal(ctx.suspendida,false,'do not mark the active owner suspended during pending claim');
});
test('Fable P0-2: confirmed lost claim still fails closed after pending is cleared',()=>{
 const {ctx,calls}=fixture({pending:false,hasLease:false});
 ctx.runCheck();
 assert.deepEqual(calls,['sync','logout','handoff'],'real displacement must close previous owner');
 assert.equal(ctx.suspendida,true);
});
test('Fable P0-2: already current owner does not close its session',()=>{
 const {ctx,calls}=fixture({pending:false,hasLease:true});
 ctx.runCheck();
 assert.deepEqual(calls,[]);
});


test('Fable P0 lease TOCTOU RED: logging out old tab must never remove a newly owned lease',()=>{
 const start=src.indexOf(" window.addEventListener('oc-logout',function(){");
 const end=src.indexOf(" window.addEventListener('oc-lang-change'",start);
 assert.ok(start>=0&&end>start,'exercise real production logout lease handler');
 const handlers={};let owner='new-tab',removed=0,epoch=0;
 const ctx={
   window:{addEventListener:(event,fn)=>{handlers[event]=fn;}},
   claimed:true,pending:false,suspendida:false,id:'old-tab',scopeKey:'synthetic-lease',
   // Previous owner saw its own lease immediately before a rival committed.
   // Deleting by key alone is a non-atomic check-then-delete.
   lease:()=>({owner:'old-tab'}),
   localStorage:{removeItem:key=>{assert.equal(key,'synthetic-lease');removed++;owner=null;}},
   avisarSync:()=>{},epoch:()=>{epoch++;},
 };
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
 assert.equal(typeof handlers['oc-logout'],'function');
 handlers['oc-logout']();
 assert.equal(owner,'new-tab','old tab cannot delete the newer authenticated tab lease');
 assert.equal(removed,0,'no compare-and-delete exists on localStorage: never remove a shared lease in logout');
 assert.equal(epoch,1);
 assert.equal(ctx.claimed,false);
 assert.equal(ctx.suspendida,true,'logout must continue fencing the old tab');
});
