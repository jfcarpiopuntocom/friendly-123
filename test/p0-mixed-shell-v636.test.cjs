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

test('mixed-shell: a compacted tag0 Yjs update keeps old v636 reader semantics',async()=>{
 const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
 const ctx=vm.createContext({window:{},Uint8Array,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto});
 vm.runInContext(vendor,ctx);
 const start=modern.indexOf('  function _compactarYjsSinCambiarCausalidad(Y, full) {');
 const end=modern.indexOf('\n  function crearCanal(',start);
 assert.ok(start>0&&end>start);
 vm.runInContext(modern.slice(start,end),ctx);
 vm.runInContext("var a=new Y.Doc(); a.getMap('productos').set('one',{stockActual:2}); a.getMap('productos').set('two',{stockActual:3}); var full=Y.encodeStateAsUpdate(a);",ctx);
 const compact=vm.runInContext('_compactarYjsSinCambiarCausalidad(Y,full)',ctx);
 const payload=compact||ctx.full;
 const oldStart=old.indexOf('      function manejar(buf, source, peerReceipt) {');
 const oldEnd=old.indexOf('      ws.onmessage = function (ev) {',oldStart);
 // Yjs root types must be declared on the receiver before applying remote updates.
 // Otherwise toJSON() omits a valid, but as-yet-uninitialized, remote map.
 const oldDoc=vm.runInContext("var oldDoc=new Y.Doc(); oldDoc.getMap('productos'); oldDoc",ctx);
 const decrypt=async()=>{const frame=new Uint8Array(payload.length+1);frame[0]=0;frame.set(payload,1);return frame;};
 Object.assign(ctx,{API:{clave:{},_catalogoRevision:0},_pausado:false,permitido:()=>true,
  descifrarBin:decrypt,doc:oldDoc,pullEstado:{},nombre:'catalogo',appliedUpdate(){},clavePendientes(){}});
 vm.runInContext(old.slice(oldStart,oldEnd),ctx);
 assert.equal(await vm.runInContext('manejar(new Uint8Array([0]),"pull",null)',ctx),true);
 assert.equal(vm.runInContext('JSON.stringify(a.toJSON())===JSON.stringify(doc.toJSON())',ctx),true);
 assert.equal(vm.runInContext('Y.equalSnapshots(Y.snapshot(a),Y.snapshot(doc))',ctx),true);
});

test('published v636 reader applies a 786432-byte ciphertext-budget tag0 Yjs checkpoint',async()=>{
 const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
 const ctx=vm.createContext({window:{},Uint8Array,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto});
 vm.runInContext(vendor,ctx);
 const make=n=>vm.runInContext("var large=new Y.Doc(); large.getMap('productos').set('synthetic-1',{nota:'x'.repeat("+n+")}); Y.encodeStateAsUpdate(large)",ctx);
 const target=786432-30; // 1 byte frame + 29 bytes AES-GCM envelope
 let n=786300,payload=make(n);
 n+=target-payload.byteLength;payload=make(n);
 assert.equal(payload.byteLength,target,'synthetic update must exercise exact 768KiB ciphertext budget');
 const oldDoc=vm.runInContext("var oldDocLarge=new Y.Doc();oldDocLarge.getMap('productos');oldDocLarge",ctx);
 const frame=new Uint8Array(payload.byteLength+1);frame[0]=0;frame.set(payload,1);
 const start=old.indexOf('      function manejar(buf, source, peerReceipt) {');
 const end=old.indexOf('      ws.onmessage = function (ev) {',start);
 Object.assign(ctx,{API:{clave:{},_catalogoRevision:0},_pausado:false,permitido:()=>true,
  descifrarBin:async()=>frame,doc:oldDoc,pullEstado:{},nombre:'catalogo',
  appliedUpdate(){},clavePendientes(){}});
 vm.runInContext(old.slice(start,end),ctx);
 assert.equal(await vm.runInContext('manejar(new Uint8Array([0]),"pull",null)',ctx),true);
 assert.equal(vm.runInContext("oldDocLarge.getMap('productos').get('synthetic-1').nota.length",ctx),n);
});
