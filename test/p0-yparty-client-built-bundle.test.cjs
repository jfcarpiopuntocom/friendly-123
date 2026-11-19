'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yparty-piloto.min.js'),'utf8');
function browserStub(pin=null){
 const fallback=[],win={Y:{Doc:class{}},OCSecure:{leerPinQueAbre:()=>({owner:pin})},
  OCAuth:{rolActual:()=> 'dueno'}};
 const ctx={window:win,localStorage:{getItem:k=>k==='f123_owned'?JSON.stringify({licenseCode:'F123-SYNT-TEAM',instanceId:'synthetic-tab-client'}):null},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},setTimeout(){return 1;},clearTimeout(){},TextEncoder,TextDecoder,URL,URLSearchParams,
  Promise,Array,Uint8Array,ArrayBuffer,Math,Date,JSON,crypto:require('node:crypto').webcrypto,
  console:{warn(){},error(){}},WebSocket:class{constructor(){throw Error('browser stub must not connect');}}};
 vm.runInNewContext(vendor,ctx,{filename:'yparty-piloto.min.js'});
 function connect(type){
  const d={store:{pendingStructs:null,pendingDs:null},isDestroyed:false,on(){},off(){},once(){}};
  const app=win.F123YPartyPilot('a'.repeat(32),'F123-SYNT-TEAM');
  const c=app.canal(d,type,{synced:true,once(){}},()=>{},()=>fallback.push(type));c.conectar();
  return c;
 }
 return{connect,fallback,win};
}
test('actual generated browser bundle exports the imported secure pilot, not only source',()=>{
 assert.ok(vendor.length>15000);
 const b=browserStub();
 assert.equal(typeof b.win.F123YPartyPilot,'function');
});
test('actual compiled bundle never opens bare WebSocket when no Owner session; cat/ops/photos fail back',{timeout:3000},()=>{
 const b=browserStub();
 for(const t of ['cat','ops','fotos'])assert.equal(b.connect(t).proveedor,null);
 assert.deepEqual(b.fallback,['cat','ops','fotos']);
});
test('compiled bundle leaves fotos on encrypted fallback even when Owner session exists',{timeout:3000},()=>{
 const b=browserStub('123');assert.equal(b.connect('fotos').proveedor,null);
 assert.deepEqual(b.fallback,['fotos']);
});

test('bridge A actual served browser bundle never opens read-only new -ops for an Owner sale',{timeout:3000},()=>{
 const b=browserStub('123');
 const economic=b.connect('ops');
 assert.equal(economic.proveedor,null);
 assert.deepEqual(b.fallback,['ops'],
   'money stays on the previously functioning encrypted relay until business-committed exists');
});

test('C12 exact shipped bundle includes the certified public reader seam and retains safe defaults',()=>{
 const b=browserStub('123');
 const pilot=b.win.F123YPartyPilot('a'.repeat(32),'F123-SYNT-TEAM');
 assert.equal(typeof pilot.leerCatalogoPublicoCertificado,'function',
  'the reviewed C12 browser route must actually be in docs/vendor, not source only');
 assert.equal(b.connect('cat').proveedor,null,
  'legacy must remain the active route until real certified historical cutover');
 assert.deepEqual(b.fallback,['cat']);
});
