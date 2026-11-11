'use strict';
// P0 Local First phase 0: behavior in a Node VM, not physical iPhone evidence.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/tab-session.js'),'utf8');
const guard=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');

test('P0 own claim and epoch-only reinit may continue; real authority losses fail closed',async()=>{
 const persisted=new Map(),events=new Map(),docEvents=new Map();
 const store={getItem:k=>persisted.get(k)||null,setItem:(k,v)=>persisted.set(k,String(v)),removeItem:k=>persisted.delete(k)};
 store.setItem('f123_owned',JSON.stringify({licenseCode:'TEST-LICENSE-A'}));
 let role='Owner';
 const OCAuth={rolActual:()=>role,salir:()=>{role=''}};
 const window={OCAuth,OC_AUTH_SESSION_EPOCH:0,addEventListener:(k,fn)=>events.set(k,fn),dispatchEvent(){}};
 const document={hidden:false,createElement:()=>({style:{}}),getElementById:()=>null,
   addEventListener:(k,fn)=>docEvents.set(k,fn),head:{appendChild(){}}};
 const context=vm.createContext({window,document,localStorage:store,OCAuth,crypto:webcrypto,
   TextEncoder,Date,setTimeout,clearTimeout,console,Event:class Event{constructor(type){this.type=type}},
   BroadcastChannel:class BroadcastChannel{postMessage(){}},navigator:{}});
 vm.runInContext(source,context,{filename:'tab-session.js'});
 const api=window.OCTabSession;
 assert.equal(await api.authoritySnapshot(),null,'no login cannot claim authority');
 events.get('oc-login')();
 assert.equal(await api.waitOwnClaim(3000),true,'bounded polling awaits own async digest');
 const before=await api.authoritySnapshot();
 assert(before,'real lease acquired');
 const epoch=window.OC_AUTH_SESSION_EPOCH;
 events.get('oc-login')();
 assert.equal(await api.waitOwnClaim(3000),true);
 const check=await api.authorityContinuity(before);
 assert.equal(check.continues,true,'same role, license, notebook and owner survive epoch-only change');
 assert(window.OC_AUTH_SESSION_EPOCH>epoch);
 role='Employee';
 assert.equal((await api.authorityContinuity(before)).continues,false,'role change is 403');
 role='Owner';
 store.setItem('f123_owned',JSON.stringify({licenseCode:'TEST-LICENSE-B'}));
 assert.equal((await api.authorityContinuity(before)).continues,false,'license change is 403');
 store.setItem('f123_owned',JSON.stringify({licenseCode:'TEST-LICENSE-A'}));
 store.setItem(before.scope+'_claim',JSON.stringify({owner:'other-tab',at:Date.now()}));
 assert.equal((await api.authorityContinuity(before)).continues,false,'competing claim is 403');
 store.removeItem(before.scope+'_claim');
 store.setItem(before.scope,JSON.stringify({owner:'other-tab'}));
 assert.equal((await api.authorityContinuity(before)).continues,false,'lost tab lease is 403');
 store.setItem(before.scope,JSON.stringify({owner:before.owner}));
 events.get('oc-logout')();
 assert.equal((await api.authorityContinuity(before)).continues,false,'true logout is 403');
 assert.equal(await api.waitOwnClaim(3000),true===false,'logged out is never authorized');
});
test('backend guard checks authority at execution and CAS retry; no generic epoch bypass',()=>{
 const start=guard.indexOf('const _fetchConCandado =');
 const end=guard.indexOf('const _fetchInterno =',start);
 assert(start>=0&&end>start);
 const g=guard.slice(start,end);
 assert.match(g,/authorityIdentity\(\)/);
 assert.match(g,/waitOwnClaim\(3000\)/);
 assert.match(g,/authoritySnapshot\(\)/);
 assert.match(g,/authorityContinuity\(_autoridadAlPedir\)/);
 assert.match(g,/c\.noPendingClaim&&c\.currentLease/);
 assert.match(g,/rolCambio\|\|tabCambio/);
 assert.match(g,/epocaAlPedir !== \(window\.OC_AUTH_SESSION_EPOCH \|\| 0\)/);
 assert.doesNotMatch(g,/roleChanged:\s*true/);
});
