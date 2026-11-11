'use strict';
// Behavioral—not string matching—regression of the P0 session primitive.
// This is a VM browser fixture; physical iOS and durable sale still need proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/tab-session.js'),'utf8');
const data=new Map(), session=new Map(), winEvents=new Map(), docEvents=new Map();
function storage(map){return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>{map.set(k,String(v));},removeItem:k=>map.delete(k)};}
const localStorage=storage(data), sessionStorage=storage(session);
localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-QA-A'}));
let role='Owner';
const OCAuth={rolActual:()=>role,salir:()=>{role='';}};
const window={OCAuth,OC_AUTH_SESSION_EPOCH:0,addEventListener:(k,fn)=>winEvents.set(k,fn),dispatchEvent:()=>{}};
const document={visibilityState:'visible',get hidden(){return this.visibilityState==='hidden';},wasDiscarded:false,
 addEventListener:(k,fn)=>docEvents.set(k,fn),getElementById:()=>null,
 createElement:()=>({textContent:''}),head:{appendChild:()=>{}}};
const context=vm.createContext({window,document,localStorage,sessionStorage,OCAuth,crypto:webcrypto,TextEncoder,Event:class Event{constructor(type){this.type=type;}},BroadcastChannel:class BroadcastChannel{postMessage(){}},console,Date,setTimeout,clearTimeout});
vm.runInContext(source,context,{filename:'tab-session.js'});
async function claimReady(api){
 for(let attempt=0;attempt<100;attempt++){
  const snapshot=await api.authoritySnapshot();
  if(snapshot)return snapshot;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 return null;
}
(async()=>{
 const api=window.OCTabSession;
 const before=await claimReady(api);
 assert(before&&typeof before.licenseHash==='string',
  'initial owner must claim lease; pending='+api.pending+', epoch='+window.OC_AUTH_SESSION_EPOCH);
 let c=await api.authorityContinuity(before);
 assert.equal(c.sameLicense,true);assert.equal(c.sameRole,true);
 assert.equal(c.sameTab,true);assert.equal(c.leaseCurrent,true);
 assert.equal(c.otherClaimPending,false);
 const epoch=window.OC_AUTH_SESSION_EPOCH;
 winEvents.get('pageshow')({persisted:true});
 assert.equal(window.OC_AUTH_SESSION_EPOCH,epoch,'bfcache restore does not bump epoch');
 const rows=JSON.parse(localStorage.getItem('f123_p0_page_lifecycle_v1'));
 assert.equal(rows.at(-1).pageshowPersisted,true,'code records bfcache flag');
 assert.equal(api.diagnosticLifecycle().pageshowPersisted,true,'diagnostic API carries the actual flag');
 assert.equal(typeof api.diagnosticLifecycle().loadId,'string','load identity recorded');
 winEvents.get('pageshow')({persisted:false});
 assert.equal(JSON.parse(localStorage.getItem('f123_p0_page_lifecycle_v1')).at(-1).pageshowPersisted,false,'false must be logged, not called a kill');
 document.visibilityState='hidden';docEvents.get('visibilitychange')();
 document.visibilityState='visible';docEvents.get('visibilitychange')();
 assert.equal(typeof JSON.parse(localStorage.getItem('f123_p0_page_lifecycle_v1')).at(-1).hiddenDurationMs,'number');
 assert.equal(typeof api.diagnosticLifecycle().hiddenDurationMs,'number','hidden gap code generated');
 docEvents.get('freeze')();docEvents.get('resume')();
 assert.equal(JSON.parse(localStorage.getItem('f123_p0_page_lifecycle_v1')).at(-1).kind,'resume','Document lifecycle handlers are wired');
 assert.equal(JSON.stringify(JSON.parse(localStorage.getItem('f123_p0_page_lifecycle_v1'))).includes('F123-QA-A'),false,'lifecycle trace never stores license value');
 localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-QA-B'}));
 c=await api.authorityContinuity(before);
 assert.equal(c.sameLicense,false,'license switch blocks despite same notebook lease');
 localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-QA-A'}));
 role='Employee';c=await api.authorityContinuity(before);
 assert.equal(c.sameRole,false,'role switch blocks');
 role='Owner';
 localStorage.setItem(before.scope+'_claim',JSON.stringify({owner:'other-tab',at:Date.now()}));
 c=await api.authorityContinuity(before);
 assert.equal(c.leaseCurrent,false,'other-tab claim blocks snapshot');
 assert.equal(c.otherClaimPending,true);
 localStorage.removeItem(before.scope+'_claim');
 localStorage.setItem(before.scope,JSON.stringify({owner:'other-tab'}));
 c=await api.authorityContinuity(before);
 assert.equal(c.leaseCurrent,false,'lost lease blocks');
 localStorage.setItem(before.scope,JSON.stringify({owner:before.owner}));
 winEvents.get('oc-logout')();
 c=await api.authorityContinuity(before);
 assert.equal(c.sameLicense,false,'logout invalidates snapshot');
 assert.equal(c.leaseCurrent,false);
 assert(window.OC_AUTH_SESSION_EPOCH>epoch,'logout revokes epoch');
 console.log('P0 authority behavioral VM: stable, bfcache flag, license, role, competing claim, lost lease, logout: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
