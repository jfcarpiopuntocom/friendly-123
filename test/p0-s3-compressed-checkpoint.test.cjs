'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
const at=source.indexOf('  async function _gzipYjs(bytes, decompress) {');
assert.ok(at>=0,'checkpoint gzip helper exists');
const end=source.indexOf('\n  function crearCanal(',at);
assert.ok(end>at,'helper is at module scope');
const helper=source.slice(at,end);
const ctx=vm.createContext({window:{CompressionStream,DecompressionStream},crypto:require('node:crypto').webcrypto,CompressionStream,DecompressionStream,Response,Uint8Array});
vm.runInContext(vendor,ctx);vm.runInContext(helper,ctx);
const gzip=(bytes,unpack)=>vm.runInContext('_gzipYjs(__bytes,__unpack)',Object.assign(ctx,{__bytes:bytes,__unpack:unpack}));
test('S3: 600KB valid Yjs state compresses to a checkpoint frame below Supabase cap',async()=>{
 const Y=ctx.Y,a=new Y.Doc();
 const p=a.getMap('productos');
 p.set('large-synthetic-product','x'.repeat(600000));
 const update=Y.encodeStateAsUpdate(a);
 assert.ok(update.length>262144,'old raw checkpoint did not fit');
 const compressed=await gzip(update,false);
 assert.ok(compressed&&compressed.length<180000,'new checkpoint fits encrypted+base64 limit');
 const restored=await gzip(compressed,true);
 assert.deepEqual(Array.from(restored),Array.from(update),'gzip roundtrip is exact');
 const b=new Y.Doc();Y.applyUpdate(b,restored);
 assert.equal(b.getMap('productos').get('large-synthetic-product').length,600000);
 assert.deepEqual(Array.from(Y.encodeStateVector(a)),Array.from(Y.encodeStateVector(b)));
});
test('S3: gzip writer requires an explicit per-license version-census gate',()=>{
 assert.match(source,/API\.rollout && API\.rollout\.gzipWrite \? _gzipYjs\(full, false\) : null/);
 assert.match(source,/entry\.allDevicesOnNewShell === true/);
 assert.match(source,/if \(source !== "pull"\) return false/);
 assert.match(source,/if \(canal\.recuperando \|\| \(_currentPullState && _currentPullState\.enCurso\)\) return/);
 assert.match(source,/doc\.store\.pendingStructs \|\| doc\.store\.pendingDs/);
});

test('S3: JFC checkpoint never holds the full-state base64 payload in its outbox',()=>{
 const at=source.indexOf('function hacerCkpt() {');
 const end=source.indexOf('function conectar()',at);
 assert.ok(at>0&&end>at);
 const b=source.slice(at,end);
 assert.match(b,/API\.rollout && API\.rollout\.outboxV2 \? updateHash\(full\)/);
 assert.match(b,/"sha256:" \+ hash/);
 assert.match(b,/diagnosticarCkpt\("snapshot-over-limit", buf\.byteLength\)/);
 assert.match(b,/diagnosticarCkpt\("checkpoint-encrypt-or-gzip-failed", 0\)/);
});
