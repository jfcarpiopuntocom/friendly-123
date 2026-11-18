'use strict';
// RED->GREEN against actual client source (no production PIN or remote fetch).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const location=path.join(__dirname,'../src/');
const src=fs.readFileSync(path.join(location,'yparty-piloto.js'),'utf8');
const importedPath=pathToFileURL(path.join(location,'ws-owner-ticket-params.mjs')).href;
const license='F123-SYNT-TEAM',instance='synthetic-tab-client';
const room='a'.repeat(32);
const tick=()=>new Promise(r=>setImmediate(r));

function pilotHarness({role='dueno',pin='123',hidden=false,owned=true}={}){
 const requests=[],providers=[],fallbacks=[],timers=[],visibility=[];let currentPin=pin,currentRole=role;
 class FakeAuthorizedProvider{
  constructor(host,roomName,doc,options){this.host=host;this.room=roomName;this.doc=doc;this.options=options;
   this.synced=false;this.ws=null;this.events={};providers.push(this);
  }
  on(name,fn){(this.events[name]||=[]).push(fn);}
  off(){}
  connect(){this.connected=true;return Promise.resolve(true);}
  disconnect(){this.disconnected=true;}
  destroy(){this.destroyed=true;}
  awareness={destroy(){}};
 }
 const ctx={window:{
   OCSecure:{leerPinQueAbre(){return{owner:currentPin};}},
   OCAuth:{rolActual(){return currentRole;}},
   Y:{encodeStateAsUpdate(){return new Uint8Array([1]);}}
 },document:{hidden,addEventListener(type,fn){if(type==='visibilitychange')visibility.push(fn);},removeEventListener(type,fn){if(type==='visibilitychange'){const i=visibility.indexOf(fn);if(i>=0)visibility.splice(i,1);}}},localStorage:{getItem(k){return k==='f123_owned'&&owned?JSON.stringify({licenseCode:license,instanceId:instance}):null;}},
  crypto:require('node:crypto').webcrypto,
  setTimeout(fn,delay){timers.push({fn,delay,cancelled:false});return timers.length;},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true;},Uint8Array,Array,Promise,JSON,
  AuthorizedYProvider:FakeAuthorizedProvider,
  createOwnerTicketParams(args){
   requests.push(args);
   return async()=>({licencia:args.licenseCode,instancia:args.instanceId,cap:'fresh-signed-token'});
  }};
 const body=src.split('\n').filter(line=>!/^import /.test(line)).join('\n');
 vm.runInNewContext(body,ctx,{filename:'yparty-piloto.js'});
 const doc={store:{pendingStructs:null,pendingDs:null},isDestroyed:false,on(){},once(){},off(){}};
 return {ctx,requests,providers,fallbacks,timers,visibility,
  setHidden(v){ctx.document.hidden=v;visibility.slice().forEach(fn=>fn());},
  get PIN(){return currentPin;},set PIN(v){currentPin=v;},
  set role(v){currentRole=v;},
  create(type='cat'){
   const app=ctx.window.F123YPartyPilot(room,license);
   return app.canal(doc,type,{synced:true,once(){}},()=>{},()=>fallbacks.push(type));
  }};
}
test('pilot imports the established AuthorizedYProvider; never constructs bare YProvider',()=>{
 assert.match(src,/import AuthorizedYProvider from ['"]\.\/authorized-yprovider\.mjs['"]/);
 assert.match(src,/import \{\s*createOwnerTicketParams\s*\} from ['"]\.\/ws-owner-ticket-params\.mjs['"]/);
 assert.doesNotMatch(src,/new YProvider\(/);
});
test('bridge A: only Owner catalog opens secure YParty; ALL ops sales stay on proven encrypted relay',{timeout:5000},async()=>{
 const f=pilotHarness();
 const cat=f.create('cat'),ops=f.create('ops');
 cat.conectar();ops.conectar();await tick();
 assert.equal(f.providers.length,1,'ops must NOT open a read-only economic WebSocket');
 assert.deepEqual(f.providers.map(p=>p.room),[room+'-cat']);
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].room,room+'-cat');
 assert.equal(f.requests[0].getCredentials().pin,'123');
 f.PIN='149';
 assert.equal(f.requests[0].getCredentials().pin,'149','PIN read live on next catalog ticket');
 assert.equal(f.providers[0].options.connect,false);
 assert.equal(f.providers[0].options.disableBc,true);
 assert.deepEqual(f.fallbacks,['ops'],'every Owner sale must remain publishable by the old encrypted path');
 assert.equal(ops.proveedor,null);
});
test('bridge A: signed catalog rejection immediately releases socket and returns to old relay',{timeout:5000},async()=>{
 const f=pilotHarness(),cat=f.create('cat');cat.conectar();await tick();
 assert.equal(f.providers.length,1);
 assert.ok(f.timers.some(t=>t.delay>0&&t.delay<8000),
   'new catalog sync must have a strict <8s failback deadline');
 assert.equal(typeof f.providers[0].events['authorization-error']?.[0],'function');
 f.providers[0].events['authorization-error'][0]([{reason:'connection-not-confirmed'}]);
 assert.deepEqual(f.fallbacks,['cat']);
 assert.equal(f.providers[0].destroyed,true);
 assert.equal(cat.proveedor,null);
});
test('bridge A: stalled catalog sync switches to old relay before eight seconds',{timeout:5000},async()=>{
 const f=pilotHarness(),cat=f.create('cat');cat.conectar();await tick();
 const timeout=f.timers.find(t=>t.delay>0&&t.delay<8000);
 assert.ok(timeout,'catalog fallback deadline <8s is configured');
 timeout.fn();
 assert.deepEqual(f.fallbacks,['cat']);
 assert.equal(cat.proveedor,null,'no abandoned provider beside legacy relay');
});
test('pilot never opens YParty without a live Owner PIN; photos stay on encrypted legacy relay',{timeout:5000},async()=>{
 const f=pilotHarness({pin:null});
 f.create('cat').conectar();
 f.create('ops').conectar();
 f.create('fotos').conectar();
 await tick();
 assert.equal(f.providers.length,0);
 assert.deepEqual(f.fallbacks,['cat','ops','fotos']);
});
test('pilot denies accidental Team/broken identity/hidden tab and does not produce socket capabilities',{timeout:5000},async()=>{
 for(const options of [{role:'empleado'},{owned:false},{hidden:true},{pin:'456'}]){
  const f=pilotHarness(options);
  f.create('cat').conectar();await tick();
  assert.equal(f.providers.length,0,JSON.stringify(options));
  if(!options.hidden)assert.ok(f.fallbacks.length>=1);
 }
});
test('ticket helper requests correct central issuer scopes and never reuses capability across callbacks',async()=>{
 const {createOwnerTicketParams}=await import(importedPath);
 const plans=[['cat',['cat:read','cat:write']],['ops',['ops:read','ops:sale']],['priv',['priv:read','priv:write']]];
 for(const [suffix,scopes] of plans){
  let counter=0,livePin='123';const sent=[];
  const params=createOwnerTicketParams({licenseCode:license,instanceId:instance,room:room+'-'+suffix,
   getCredentials:()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:livePin}),
   fetch:async(_url,args)=>{const p=JSON.parse(args.body);sent.push(p);
    assert.deepEqual(p.scopes,scopes);
    return{ok:true,json:async()=>({ok:true,token:'synthetic'+(++counter)+'.signature',expiresAt:Date.now()+15000})};
   }});
  const first=await params(),second=await params();
  assert.equal(sent.length,2);
  assert.notEqual(first.cap,second.cap);
  assert.deepEqual(first,{licencia:license,instancia:instance,cap:'synthetic1.signature'});
  livePin='124';await params();
  assert.equal(sent[2].credentials.pin,'124','live session PIN changes must invalidate old credential');
 }
});
test('ticket helper refuses fotos, unknown channel, expired issuance and changed Owner PIN during request',{timeout:5000},async()=>{
 const {createOwnerTicketParams}=await import(importedPath);
 const cred=()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:'123'});
 for(const suffix of ['fotos','evil'])assert.throws(()=>createOwnerTicketParams({licenseCode:license,instanceId:instance,room:room+'-'+suffix,getCredentials:cred,fetch:async()=>{}}));
 const expired=createOwnerTicketParams({licenseCode:license,instanceId:instance,room:room+'-cat',getCredentials:cred,
   fetch:async()=>({ok:true,json:async()=>({ok:true,token:'ok.signature',expiresAt:Date.now()-10})})});
 await assert.rejects(expired(),/WS authorization unavailable/);
 let changed=false;
 const changedParams=createOwnerTicketParams({licenseCode:license,instanceId:instance,room:room+'-ops',
   getCredentials:()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:changed?'124':'123'}),
   fetch:async()=>{changed=true;return{ok:true,json:async()=>({ok:true,token:'ok.signature',expiresAt:Date.now()+10000})};}});
 await assert.rejects(changedParams(),/WS authorization unavailable/);
});

test('bridge A Safari/Android background -> foreground creates fresh signed catalog transport once, not a dead socket',{timeout:5000},async()=>{
 const f=pilotHarness(),cat=f.create('cat');
 cat.conectar();await tick();
 const first=f.providers[0];
 assert.equal(f.providers.length,1);
 f.setHidden(true);
 assert.equal(first.destroyed,true,'background must close stale auth socket');
 assert.equal(cat.proveedor,null);
 f.setHidden(false);await tick();
 assert.equal(f.providers.length,2,'foreground must try a NEW socket and fresh ticket');
 assert.notEqual(cat.proveedor,first);
 assert.equal(f.requests.length,2,'fresh credentials for every actual connection attempt');
 f.setHidden(false);await tick();
 assert.equal(f.providers.length,2,'duplicate foreground events must not spawn another socket');
 assert.equal(f.fallbacks.length,0,'temporary background alone must not erase 2.0 option');
});
test('bridge A repeated hidden authorization failures -> foreground fresh socket or old relay within 7.5s',{timeout:5000},async()=>{
 const f=pilotHarness(),cat=f.create('cat');cat.conectar();await tick();
 f.setHidden(true);
 const previous=f.providers[0];
 previous.events['authorization-error']?.[0]?.([{reason:'invalid-in-suspended-tab'}]);
 assert.deepEqual(f.fallbacks,[],'late revoked callback from destroyed socket has no effect');
 f.setHidden(false);await tick();
 const fresh=f.providers[1];
 assert.ok(fresh&&fresh!==previous&&cat.proveedor===fresh);
 fresh.events['authorization-error']?.[0]?.([{reason:'permission-still-expired'}]);
 assert.deepEqual(f.fallbacks,['cat'],'on actual auth denial, old encrypted relay is re-enabled');
 assert.equal(cat.proveedor,null);
 const before=f.providers.length;
 f.setHidden(false);await tick();
 assert.equal(f.providers.length,before,'once in failback, visibility cannot spawn a second competing catalog writer');
 assert.ok(f.timers.some(t=>t.delay>0&&t.delay<8000));
});
