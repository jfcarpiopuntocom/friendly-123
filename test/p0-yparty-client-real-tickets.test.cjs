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
test('bridge A SECURE: Owner catalog and all economic ops remain on encrypted legacy, no raw Worker connection',async()=>{
 const f=pilotHarness();
 const cat=f.create('cat'),ops=f.create('ops');
 cat.conectar();ops.conectar();await tick();
 assert.equal(f.providers.length,0,'no sensitive Owner Y.Doc on unsealed YParty provider');
 assert.equal(f.requests.length,0,'no owner ticket should be consumed for an unsafe catalog');
 assert.deepEqual(f.fallbacks,['cat','ops'],'both flows retain encrypted legacy channel');
 assert.equal(cat.proveedor,null);assert.equal(ops.proveedor,null);
});
test('bridge A SECURE: unsafe catalog returns directly to existing encrypted relay',async()=>{
 const f=pilotHarness(),cat=f.create('cat');
 cat.conectar();await tick();
 assert.equal(f.providers.length,0,'never send unsealed catalog to a socket');
 assert.equal(f.requests.length,0,'no credential request to an unavailable transport');
 assert.deepEqual(f.fallbacks,['cat'],'fallback is immediate, not delayed until auth rejection');
 assert.equal(cat.proveedor,null);
});
test('bridge A SECURE: no Worker deadline or pending socket blocks encrypted fallback',async()=>{
 const f=pilotHarness(),cat=f.create('cat');
 cat.conectar();await tick();
 assert.deepEqual(f.fallbacks,['cat'],'fallback happens synchronously');
 assert.equal(f.providers.length,0);
 assert.equal(f.timers.some(t=>!t.cancelled&&t.delay>0),false,'no outstanding Worker timer');
 assert.equal(cat.proveedor,null);
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

test('bridge A SECURE: Safari background and foreground keep legacy without creating second writer',async()=>{
 const f=pilotHarness(),cat=f.create('cat');
 cat.conectar();await tick();
 assert.deepEqual(f.fallbacks,['cat']);
 f.setHidden(true);f.setHidden(false);await tick();
 f.setHidden(false);await tick();
 assert.equal(f.providers.length,0,'no unsealed provider on foreground');
 assert.equal(f.requests.length,0);
 assert.deepEqual(f.fallbacks,['cat'],'no duplicated startup against legacy');
 assert.equal(cat.proveedor,null);
});
test('bridge A SECURE: repeated visibility and reconnect cannot open plaintext catalog or duplicate fallback',async()=>{
 const f=pilotHarness(),cat=f.create('cat');
 cat.conectar();await tick();
 f.setHidden(true);f.setHidden(false);await tick();
 cat.conectar();await tick();
 assert.equal(f.providers.length,0,'explicit reconnect also fails closed to encrypted relay');
 assert.equal(f.requests.length,0,'no owner capability leaked');
 assert.deepEqual(f.fallbacks,['cat','cat'],'one fallback per explicit connect, none from visibility');
 assert.equal(cat.proveedor,null);
});
