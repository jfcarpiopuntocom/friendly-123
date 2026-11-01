'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const start=file.indexOf('      function manejar(buf, source, peerReceipt) {');
const end=file.indexOf('      ws.onmessage = function (ev) {',start);
assert.ok(start>0&&end>start,'use the actual production frame consumer');
function receive(tag,source='pull'){
  const ctx=vm.createContext({
    API:{clave:{}},_pausado:false,permitido:()=>true,
    descifrarBin:async()=>new Uint8Array([tag,1,2,3]),
    Promise,Uint8Array,TextDecoder,Date,
  });
  vm.runInContext(file.slice(start,end),ctx);
  ctx.tag=tag;ctx.source=source;
  return vm.runInContext('manejar(new Uint8Array([tag,1,2,3]),source,null)',ctx);
}
test('S3: an unknown authenticated pull tag must never be ACKed or advance durable replay cursor',async()=>{
  assert.equal(await receive(8),false,'unknown future checkpoint is an unresolved page, not a consumed update');
});
test('S3: an unsupported compressed tag coming from a live peer must not certify remote replay',async()=>{
  assert.equal(await receive(7,'live'),false,'compressed ckpt belongs to authenticated pull only');
});
