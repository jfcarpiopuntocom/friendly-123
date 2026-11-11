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
test('Fable P0-2 (JFC order 2026-11-11): confirmed lost claim pauses sync but does NOT close the session',()=>{
 const {ctx,calls}=fixture({pending:false,hasLease:false});
 ctx.runCheck();
 // Before 2026-11-11 this asserted ['sync','logout','handoff'] (the old screen
 // was signed out and the "continues in another tab" panel appeared). JFC ordered
 // that removed: sync pauses, the user keeps working, no panel, no logout.
 assert.deepEqual(calls,['sync'],'losing the lease only pauses sync');
 assert.equal(ctx.suspendida,true,'sync stays paused on the screen that lost the lease');
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


function quotaClaimFixture(failWhich) {
 const leaseKey='f123_auth_tab_lease_'+'07'.repeat(32),claimKey=leaseKey+'_claim';
 const items=new Map([[leaseKey,JSON.stringify({owner:'first-tab'})],['f123_tienda_activa','SYNTHETIC-ONLY']]);
 const mutations=[],events=[];
 const localStorage={
  getItem:key=>items.get(key)||null,
  setItem:(key,value)=>{
   mutations.push(['set',key]);
   if((failWhich==='intent'&&key===claimKey) || (failWhich==='lease'&&key===leaseKey))
     throw Object.assign(new Error('quota full'),{name:'QuotaExceededError'});
   items.set(key,value);
  },
  removeItem:key=>{mutations.push(['remove',key]);items.delete(key);}
 };
 const ctx={id:'second-tab',scopeKey:'',claimed:false,pending:false,suspendida:false,
   channel:{postMessage:msg=>events.push(['channel',msg])},
   crypto:{subtle:{digest:async()=>new Uint8Array(32).fill(7).buffer}},
   TextEncoder,Uint8Array,localStorage,console:{warn:(...args)=>events.push(['warn',args])},
   window:{OC_AUTH_SESSION_EPOCH:0,OCAuth:{rolActual:()=> 'dueno'}},
   OCAuth:{rolActual:()=> 'dueno'},
   epoch:()=>{ctx.window.OC_AUTH_SESSION_EPOCH++;},
   clearPanel:()=>{},avisarSync:()=>events.push(['sync']),
   check:()=>events.push(['check']),
 };
 const start=src.indexOf(' function lease(){'),end=src.indexOf(' function puedeSincronizar(){',start);
 const claimStart=src.indexOf(' async function claim(){'),claimEnd=src.indexOf(" try{channel=new BroadcastChannel(",claimStart);
 assert.ok(start>0&&end>start&&claimStart>0&&claimEnd>claimStart);
 vm.createContext(ctx);
 vm.runInContext(src.slice(start,end)+'\n'+src.slice(claimStart,claimEnd)+'\nthis.runClaim=claim;',ctx);
 return {ctx,items,leaseKey,claimKey,mutations,events};
}
for(const failWhich of ['intent','lease']){
 test('Fable P1-4 RED: '+failWhich+' quota failure must preserve old tab and fence new tab',async()=>{
  const {ctx,items,leaseKey,claimKey,events}=quotaClaimFixture(failWhich);
  await ctx.runClaim(); // actual production claim(), with injected localStorage QuotaExceededError
  assert.equal(JSON.parse(items.get(leaseKey)).owner,'first-tab','never replace existing owner on quota failure');
  assert.equal(items.has(claimKey),false,'never leave a stale 2-minute takeover intent');
  assert.equal(ctx.pending,false,'no permanently pending login');
  assert.equal(ctx.current(),false,'failed new tab must never gain writing rights without a lease');
  assert.ok(events.some(([kind])=>kind==='warn'),'quota failure must leave a diagnosable warning');
 });
}


test('CodeRabbit RED: late SHA rejection after logout cannot un-fence an abandoned PIN claim',async()=>{
 const leaseKey='f123_auth_tab_lease_prior',items=new Map([
  [leaseKey,JSON.stringify({owner:'original-tab'})],['f123_tienda_activa','SYNTHETIC-ONLY']
 ]);
 let rejectDigest;
 const events={};
 const ctx={id:'original-tab',scopeKey:leaseKey,claimed:true,pending:false,suspendida:false,
  window:{OC_AUTH_SESSION_EPOCH:0,OCAuth:{rolActual:()=> 'dueno'},
    addEventListener:(name,cb)=>{events[name]=cb;}},
  OCAuth:{rolActual:()=> 'dueno'},
  crypto:{subtle:{digest:()=>new Promise((_,reject)=>{rejectDigest=reject;})}},
  TextEncoder,Uint8Array,localStorage:{
    getItem:key=>items.get(key)||null,
    setItem:(key,value)=>items.set(key,value),
    removeItem:key=>items.delete(key)
  },
  epoch:()=>{ctx.window.OC_AUTH_SESSION_EPOCH++;},clearPanel:()=>{},avisarSync:()=>{},check:()=>{},
  console:{warn:()=>{}}
 };
 const cStart=src.indexOf(' async function claim(){'),cEnd=src.indexOf(" try{channel=new BroadcastChannel(",cStart);
 const lStart=src.indexOf(" window.addEventListener('oc-logout',function(){");
 const lEnd=src.indexOf(" window.addEventListener('oc-lang-change'",lStart);
 assert.ok(cStart>0&&cEnd>cStart&&lStart>0&&lEnd>lStart);
 vm.createContext(ctx);vm.runInContext(src.slice(cStart,cEnd)+'\n'+src.slice(lStart,lEnd)+'\nthis.runClaim=claim;',ctx);
 const joining=ctx.runClaim();
 assert.equal(ctx.pending,true);
 assert.equal(typeof events['oc-logout'],'function');
 events['oc-logout']();
 assert.equal(ctx.suspendida,true);
 rejectDigest(new Error('synthetic late digest failure'));
 await joining;
 assert.equal(ctx.claimed,false,'a stale catch must not reclaim a logged-out tab');
 assert.equal(ctx.suspendida,true,'a stale digest failure must not reactivate sync');
 assert.equal(ctx.pending,false);
 assert.equal(JSON.parse(items.get(leaseKey)).owner,'original-tab','the lease remains immutable on logout');
});

test('CodeRabbit RED: release-control no-retry guard includes real session and two-tab filenames',()=>{
 const yaml=fs.readFileSync(path.join(__dirname,'../.github/workflows/release-control.yml'),'utf8');
 const line=yaml.split('\n').find(x=>x.includes('grep -Eiq')&&x.includes('tab-session'));
 assert.ok(line,'find production fail-first guard');
 const expression=line.match(/grep -Eiq '([^']+)'/);
 assert.ok(expression,'parse deployed grep -E expression');
 const protectedFile=new RegExp(expression[1],'i');
 for (const file of ['test/fable-p0-tab-claim.test.cjs','test/linus-dos-pestanas.test.js',
    'test/tab-session-handoff.test.js','test/p0-pre-ack-recovery.test.cjs']) {
   assert.equal(protectedFile.test(file),true,'first-attempt failure may never be retried: '+file);
 }
});
