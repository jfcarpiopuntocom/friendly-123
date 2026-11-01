'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/sync-rollout.json'),'utf8'));
const start=source.indexOf('  async function _politicaRollout(codigo) {'),end=source.indexOf('\n  function crearCanal(',start);
assert.ok(start>0&&end>start,'actual rollout function exists');
async function evaluate(entry,stage='consenting-client'){
 const code='F123-EXAMPLE-NOT-A-REAL-LICENSE';
 const key=crypto.createHash('sha256').update('friendly123-rollout-v1:'+code).digest('hex');
 const cfg={schema:1,stage,licenses:{[key]:entry}};
 const ctx=vm.createContext({crypto:crypto.webcrypto,TextEncoder,Uint8Array,Array,Number,Promise,
   fetch:async()=>({ok:true,json:async()=>cfg})});
 vm.runInContext(source.slice(start,end),ctx);
 return vm.runInContext('_politicaRollout(__code)',Object.assign(ctx,{__code:code}));
}
test('unapproved and wrong-stage licenses are kept on v1',async()=>{
 const p=await evaluate({stage:'owner-canary',approved:true,outboxV2:true,gzipWrite:true});
 assert.equal(p.outboxV2,false);assert.equal(p.gzipWrite,false);
});
test('opted-in customer may use outbox v2 while old readers forbid tag7 writes',async()=>{
 const p=await evaluate({stage:'consenting-client',approved:true,outboxV2:true,gzipWrite:true,
 allDevicesOnNewShell:false,minimumShell:700,deviceCensusSha256:'a'.repeat(64),censusDate:'2026-11-01',gzipApproved:true});
 assert.equal(p.outboxV2,true);assert.equal(p.gzipWrite,false);
});
test('gzip writer requires full device census, minimum shell and signoff',async()=>{
 const approved={stage:'consenting-client',approved:true,outboxV2:true,gzipWrite:true,
 allDevicesOnNewShell:true,minimumShell:637,deviceCensusSha256:'a'.repeat(64),censusDate:'2026-11-01',gzipApproved:true};
 assert.equal((await evaluate(approved)).gzipWrite,true);
 assert.equal((await evaluate({...approved,deviceCensusSha256:''})).gzipWrite,false);
 assert.equal((await evaluate({...approved,minimumShell:636})).gzipWrite,false);
});
test('checked-in pilot policy disables gzip and contains no plain license',()=>{
 assert.equal(config.stage,'owner-canary');
 assert.ok(Object.values(config.licenses).every(x=>x.gzipWrite===false));
 assert.doesNotMatch(JSON.stringify(config),/F123-[A-Z0-9]+-/);
});
