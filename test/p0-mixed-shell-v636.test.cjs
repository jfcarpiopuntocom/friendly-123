'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const oldSha='795635ea0b0de262cd982d9a5dc828fd8cffcfba'; // published v636
const old=cp.execFileSync('git',['show',oldSha+':docs/sync-yjs.js'],{encoding:'utf8'});
const modern=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
function oldReceive(tag) {
 const start=old.indexOf('      function manejar(buf, source, peerReceipt) {');
 const end=old.indexOf('      ws.onmessage = function (ev) {',start);
 assert.ok(start>0&&end>start,'v636 real production receiver available');
 let applied=0;
 const ctx=vm.createContext({API:{clave:{},_catalogoRevision:0},_pausado:false,permitido:()=>true,
 descifrarBin:async()=>new Uint8Array([tag,9,8,7]),Promise,Uint8Array,TextDecoder,Date,
 Y:{applyUpdate(){applied++;}},doc:{},pullEstado:{},nombre:'catalogo',
 appliedUpdate(){},clavePendientes(){},window:{}});
 vm.runInContext(old.slice(start,end),ctx);
 return vm.runInContext('manejar(new Uint8Array([0]),"pull",null)',ctx).then(ok=>({ok,applied}));
}
test('real published v636 applies legacy tag0 and cannot apply new tag7',async()=>{
 const legacy=await oldReceive(0);
 assert.equal(legacy.ok,true);assert.equal(legacy.applied,1);
 const compressed=await oldReceive(7);
 assert.equal(compressed.applied,0,'old app would silently miss compressed checkpoint');
});
test('new reader and staged writer protect any old shell in shared room',()=>{
 assert.match(modern,/if \(source !== "pull"\) return false/);
 assert.match(modern,/return API\.rollout && API\.rollout\.gzipWrite \? _gzipYjs\(full, false\) : null/);
 assert.match(modern,/entry\.allDevicesOnNewShell === true/);
 const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/sync-rollout.json'),'utf8'));
 assert.equal(Object.values(cfg.licenses).every(x=>x.gzipWrite===false),true);
});
