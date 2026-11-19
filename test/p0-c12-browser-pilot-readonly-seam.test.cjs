'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/yparty-piloto.js'),'utf8');
function fixture({role='dueno',pin='123',hidden=false}={}){
 const calls=[],sourceOnly=source.split('\n').filter(s=>!/^import /.test(s)).join('\n');
 const stored={licenseCode:'F123-SYNTH-READONLY',instanceId:'synthetic-c12-browser'};
 const win={Y:{Doc:class{}},OCAuth:{rolActual:()=>role},
  OCSecure:{leerPinQueAbre:()=>({owner:pin})}};
 const context={window:win,localStorage:{getItem:()=>JSON.stringify(stored)},
  document:{hidden,addEventListener(){},removeEventListener(){}},
  openCertifiedReadOnlyPublicCatalog:async v=>{calls.push(v);v.getCredentials();return{readOnly:true}},
  setTimeout,clearTimeout,Promise,URL,Uint8Array,JSON,Array,crypto:require('node:crypto').webcrypto};
 vm.runInNewContext(sourceOnly,context);
 const pilot=win.F123YPartyPilot('a'.repeat(32),stored.licenseCode);
 return{pilot,stored,calls};
}
test('C12 pilot exposes an explicit read-only catalog seam without touching legacy channel',async()=>{
 const f=fixture(),privateDoc={private:true};
 const r=await f.pilot.leerCatalogoPublicoCertificado(privateDoc,'certified-qa-head');
 assert.equal(r.readOnly,true);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].privateDoc,privateDoc);
 assert.equal(f.calls[0].room,'a'.repeat(32)+'-cat');
 assert.equal(f.calls[0].expectedFrozenHead,'certified-qa-head');
 assert.equal(f.calls[0].instanceId,'synthetic-c12-browser');
 assert.equal(f.calls[0].getCredentials().pin,'123');
});
test('C12 pilot cannot request a read-only probe for Team, missing PIN or hidden browser',async()=>{
 for(const options of [{role:'empleado'},{pin:null},{hidden:true}]){
  const f=fixture(options);
  await assert.rejects(f.pilot.leerCatalogoPublicoCertificado({},'certified-qa-head'));
  if(options.hidden)assert.equal(f.calls.length,0);
 }
});
test('C12 source exports the certified browser read-only seam and still retains failback',()=>{
 assert.match(source,/import \{openCertifiedReadOnlyPublicCatalog\}/);
 assert.match(source,/leerCatalogoPublicoCertificado\(/);
 assert.match(source,/usarRelayHabitual\(\);\s*return;/);
});
