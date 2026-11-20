// PORT2 · Independent Firebase RTDB -> Yjs/R2 frozen HEAD certifier QA (RED->GREEN).
// Zero network calls, zero Firebase/R2 writes (USD 0.00), zero PII/PIN logging.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import * as Y from 'yjs';
import {
 deriveFirebaseCertifierBindings,
 certifyFirebaseChannelSnapshot,
 packFirebaseFrozenR2Bundle
} from '../tools/firebase-frozen-certifier.mjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';

const TEST_LICENSE='F123-TEST-SOL6-FIREBASE-99';
const HEAD='firebase-head-cert-20261120-001';
const SERVICE_KEY='synthetic-firebase-cert-service-key-32b!';
const sha256Hex=bytes=>createHash('sha256').update(bytes).digest('hex');

async function encryptMirror(codigo,plainBytes){
 const normalized=String(codigo||'').trim().toUpperCase();
 const enc=new TextEncoder();
 const base=await webcrypto.subtle.importKey('raw',enc.encode(normalized),'PBKDF2',false,['deriveKey']);
 const key=await webcrypto.subtle.deriveKey(
  {name:'PBKDF2',salt:enc.encode('amigable-sync-v1'),iterations:100000,hash:'SHA-256'},
  base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
 );
 const iv=webcrypto.getRandomValues(new Uint8Array(12));
 const cipher=new Uint8Array(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,plainBytes));
 const out=new Uint8Array(12+cipher.byteLength);
 out.set(iv,0);out.set(cipher,12);
 return Buffer.from(out).toString('base64');
}
function tagFrame(tag,payload){
 const out=new Uint8Array(1+payload.byteLength);
 out[0]=tag;out.set(payload,1);
 return out;
}
function fragmentFrames(tag,payload,chunkBytes,groupId='g1234567890abcde'){
 const total=Math.ceil(payload.byteLength/chunkBytes);
 const chunks=[];
 for(let i=0;i<total;i++){
  const slice=payload.subarray(i*chunkBytes,(i+1)*chunkBytes);
  const frame=new Uint8Array(22+slice.byteLength);
  frame[0]=3;frame[1]=tag;
  for(let j=0;j<16;j++)frame[2+j]=groupId.charCodeAt(j);
  frame[18]=i>>8;frame[19]=i&255;
  frame[20]=total>>8;frame[21]=total&255;
  frame.set(slice,22);
  chunks.push(frame);
 }
 return chunks;
}

test('derives exact 1.0 Firebase room40 and 2.0 YParty room32 bindings deterministically',async()=>{
 const b=await deriveFirebaseCertifierBindings('  '+TEST_LICENSE.toLowerCase()+'  ');
 const expected40=sha256Hex(Buffer.from('amigable-sala:'+TEST_LICENSE)).slice(0,40);
 const expected32=sha256Hex(Buffer.from('f123-yparty-v1:'+TEST_LICENSE)).slice(0,32);
 assert.equal(b.firebaseRoom40,expected40);
 assert.equal(b.ypartyRoom32,expected32);
 assert.equal(b.isJfcCleanRoom,false);
 assert.equal(b.firebasePaths.y,'/f123/'+expected40+'-y');
 assert.equal(b.firebasePaths.ops,'/f123/'+expected40+'-ops');
 assert.equal(b.ypartyRooms.cat,expected32+'-cat');
 assert.equal(b.ypartyRooms.ops,expected32+'-ops');

 // Verify JFC canonical ::limpio-2026-09-16 room offset (sync-yjs.js:2773) switches ONLY firebaseRoom40 while preserving ypartyRoom32
 const clean=await deriveFirebaseCertifierBindings(TEST_LICENSE,{firebaseCleanSuffix:true});
 const expectedClean40=sha256Hex(Buffer.from('amigable-sala:'+TEST_LICENSE+'::limpio-2026-09-16')).slice(0,40);
 assert.equal(clean.isJfcCleanRoom,true);
 assert.equal(clean.firebaseRoom40,expectedClean40);
 assert.equal(clean.ypartyRoom32,expected32);
});

test('decodes AES-GCM + tag0 + tag3 fragments + tag7 gzip ckpt, detects stale ckpt ancestors, and round-trips through REAL Miniflare R2 -> prepareFrozenImport',{timeout:45000},async()=>{
 // Build catalog with private + public roots, plus split checkpoint / pre-checkpoint ops
 const catDoc=new Y.Doc();catDoc.clientID=101;
 catDoc.getMap('productos').set('p1',{id:'p1',nombre:'Arroz',precio:250,stockActual:12,costo:180});
 catDoc.getMap('ubicaciones').set('u1',{id:'u1',nombre:'Bodega',activa:true});
 catDoc.getMap('_meta').set('pinsRol',{owner:'SECRET_OWNER_PIN_DO_NOT_LEAK'});
 catDoc.getMap('clientes').set('c1',{id:'c1',nombre:'Privado Cliente',telefono:'0999999999'});
 const catCkptBytes=new Uint8Array(gzipSync(Y.encodeStateAsUpdate(catDoc)));
 // Second independent writer adds another product using fragmented tag 3 update
 const catDoc2=new Y.Doc();catDoc2.clientID=202;
 Y.applyUpdate(catDoc2,Y.encodeStateAsUpdate(catDoc));
 const beforeV=Y.encodeStateVector(catDoc2);
 catDoc2.getMap('productos').set('p2',{id:'p2',nombre:'Aceite',precio:400,stockActual:5,costo:300});
 const catDelta=Y.encodeStateAsUpdate(catDoc2,beforeV);
 const catFrags=fragmentFrames(0,catDelta,Math.max(8,Math.ceil(catDelta.byteLength/2)),'fragcat000000001');

 const ySnapshot={
  k:{'1':{s:1000,c:await encryptMirror(TEST_LICENSE,tagFrame(7,catCkptBytes))}},
  o:{
   '-K_frag2':{s:1005,c:await encryptMirror(TEST_LICENSE,catFrags[1])},
   '-K_frag1':{s:1005,c:await encryptMirror(TEST_LICENSE,catFrags[0])}
  }
 };

 // Ops channel: writer A makes parent + child, independent writer B has pre-checkpoint op (s=900 <= k.s=1000!)
 const opsFull=new Y.Doc();
 const opsA=new Y.Doc();opsA.clientID=301;
 const opsB=new Y.Doc();opsB.clientID=302;
 const updatesA=[];opsA.on('update',u=>updatesA.push(new Uint8Array(u)));
 opsA.getMap('eventos').set('op-a-001',{kind:'sale.record',opId:'op-a-001',productId:'p1',quantity:1,amountCents:250});
 const svBeforeB=Y.encodeStateVector(opsB);
 opsB.getMap('eventos').set('op-b-001',{kind:'stock.adjust',opId:'op-b-001',productId:'p1',quantity:10,amountCents:0});
 const updateBPreCkpt=Y.encodeStateAsUpdate(opsB,svBeforeB);
 // Partial checkpoint only contains opsA (does NOT contain opsB), timestamped s=1000 AFTER op-b at s=900!
 const partialCkptOps=Y.encodeStateAsUpdate(opsA);
 // Equal-ms timestamp tie test: op-a-002 comes in lexicographical Firebase key order
 const svA2=Y.encodeStateVector(opsA);
 opsA.getMap('eventos').set('op-a-002',{kind:'credit.customer.payment.record',opId:'customer-payment:pay00001',clienteId:'c1',amountCents:500});
 const updateA2=Y.encodeStateAsUpdate(opsA,svA2);

 Y.applyUpdate(opsFull,partialCkptOps);
 Y.applyUpdate(opsFull,updateBPreCkpt);
 Y.applyUpdate(opsFull,updateA2);
 const expectedOpsStateSha=sha256Hex(Y.encodeStateAsUpdate(opsFull));
 const expectedOpsVectorSha=sha256Hex(Y.encodeStateVector(opsFull));

 const opsSnapshot={
  k:{'1':{s:1000,c:await encryptMirror(TEST_LICENSE,tagFrame(0,partialCkptOps))}},
  o:{
   '-Z_later_same_ms':{s:1005,c:await encryptMirror(TEST_LICENSE,tagFrame(0,updateA2))},
   '-A_early_independent':{s:900,c:await encryptMirror(TEST_LICENSE,tagFrame(0,updateBPreCkpt))}
  }
 };

 const bundle=await packFirebaseFrozenR2Bundle({
  codigo:TEST_LICENSE,
  frozenHead:HEAD,
  ySnapshot,
  opsSnapshot
 });

 assert.equal(bundle.ops.certification.opIdsCount,3);
 assert.equal(bundle.ops.certification.expectedStateSha256,expectedOpsStateSha);
 assert.equal(bundle.ops.certification.expectedVectorSha256,expectedOpsVectorSha);
 assert.equal(bundle.ops.certification.staleCheckpointDetected,true);
 assert.equal(bundle.ops.certification.unsafeEconomicPayloads,0);
 assert.equal(bundle.cat.certification.privateRootsStripped.includes('_meta'),true);
 assert.equal(bundle.cat.certification.privateRootsStripped.includes('clientes'),true);

 // Never leak license, secret PIN, or private phone number anywhere in serialized bundle/manifests
 const bundleText=JSON.stringify(bundle);
 assert.equal(bundleText.includes('SECRET_OWNER_PIN_DO_NOT_LEAK'),false);
 assert.equal(bundleText.includes('0999999999'),false);
 assert.equal(bundleText.includes(TEST_LICENSE),false);

 // Feed generated R2 archives into REAL Miniflare frozen-r2-source.mjs -> readTrustedFrozenSource -> prepareFrozenImport
 const script=(await build({
  entryPoints:[path.join(import.meta.dirname,'../src/frozen-r2-source.mjs')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false
 })).outputFiles[0].text;
 const mf=new Miniflare({
  modules:true,script,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  r2Buckets:['F123_FROZEN_R2'],
  bindings:{
   F123_FROZEN_ROOM:bundle.bindings.ypartyRoom32,
   F123_FROZEN_HEAD:HEAD,
   F123_FROZEN_OPS_MANIFEST_SHA256:bundle.ops.archive.manifestSha256,
   F123_FROZEN_CAT_MANIFEST_SHA256:bundle.cat.archive.manifestSha256,
   WS_SERVICE_KEY:SERVICE_KEY
  }
 });
 try{
  await mf.ready;
  const bucket=await mf.getR2Bucket('F123_FROZEN_R2');
  for(const obj of [...bundle.ops.archive.objects,...bundle.cat.archive.objects]){
   await bucket.put(obj.key,obj.body);
  }
  const env={
   WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   SALA_PILOTO:bundle.bindings.ypartyRoom32,WS_SERVICE_KEY:SERVICE_KEY,
   WS_FROZEN_HISTORY_SOURCE:{
    fetch:async req=>mf.dispatchFetch(req.url,{
     method:req.method,headers:Object.fromEntries(req.headers),body:await req.text()
    })
   }
  };
  const opsRec=await readTrustedFrozenSource({env,room:bundle.bindings.ypartyRooms.ops,channel:'ops'});
  const opsProof=await prepareFrozenImport(opsRec);
  assert.equal(opsProof.eventCount,3);
  assert.equal(opsProof.sha256,expectedOpsStateSha);

  const catRec=await readTrustedFrozenSource({env,room:bundle.bindings.ypartyRooms.cat,channel:'cat'});
  const catProof=await prepareFrozenImport(catRec);
  assert.equal(catProof.sha256,bundle.cat.archive.manifest.expectedStateSha256);
 }finally{
  await mf.dispose();
  catDoc.destroy();catDoc2.destroy();opsFull.destroy();opsA.destroy();opsB.destroy();
 }
});

test('fails closed on wrong key, incomplete tag 3 fragments, missing Yjs causal parents, non-eventos root in ops, and live-only tags',async()=>{
 const d=new Y.Doc();d.clientID=501;
 d.getMap('eventos').set('e1',{kind:'sale.record',opId:'op-ok-001',productId:'p1',quantity:1,amountCents:100});
 const full=Y.encodeStateAsUpdate(d);
 const validEnc=await encryptMirror(TEST_LICENSE,tagFrame(0,full));

 // 1. Wrong license / tampered ciphertext
 await assert.rejects(
  certifyFirebaseChannelSnapshot({codigo:'F123-WRONG-KEY-00000001',channel:'ops',snapshot:{o:{'-A':{s:100,c:validEnc}}}}),
  /decrypt|auth|invalid/i
 );

 // 2. Incomplete tag 3 fragments (only 1 of 2 pieces)
 const frags=fragmentFrames(0,full,Math.max(4,Math.ceil(full.byteLength/2)),'incompletefrag01');
 await assert.rejects(
  certifyFirebaseChannelSnapshot({
   codigo:TEST_LICENSE,channel:'ops',
   snapshot:{o:{'-A':{s:100,c:await encryptMirror(TEST_LICENSE,frags[0])}}}
  }),
  /incomplete fragment/i
 );

 // 3. Missing Yjs ancestor (drop parent update, keep only child update -> pendingStructs!)
 const d2=new Y.Doc();d2.clientID=601;
 d2.getMap('eventos').set('p1',{kind:'sale.record',opId:'op-p1-001',productId:'x',quantity:1,amountCents:10});
 const v1=Y.encodeStateVector(d2);
 d2.getMap('eventos').set('p2',{kind:'sale.record',opId:'op-p2-001',productId:'x',quantity:1,amountCents:20});
 const childOnly=Y.encodeStateAsUpdate(d2,v1);
 await assert.rejects(
  certifyFirebaseChannelSnapshot({
   codigo:TEST_LICENSE,channel:'ops',
   snapshot:{o:{'-A':{s:200,c:await encryptMirror(TEST_LICENSE,tagFrame(0,childOnly))}}}
  }),
  /pending Yjs ancestors/i
 );

 // 4. Disallowed root in -ops
 const badOps=new Y.Doc();badOps.clientID=701;
 badOps.getMap('eventos').set('e1',{opId:'x'});
 badOps.getMap('clientes').set('c1',{secret:'leak'});
 await assert.rejects(
  certifyFirebaseChannelSnapshot({
   codigo:TEST_LICENSE,channel:'ops',
   snapshot:{o:{'-A':{s:300,c:await encryptMirror(TEST_LICENSE,tagFrame(0,Y.encodeStateAsUpdate(badOps)))}}}
  }),
  /disallowed root/i
 );

 // 5. Non-durable signal tag (tag 4) inside /o
 await assert.rejects(
  certifyFirebaseChannelSnapshot({
   codigo:TEST_LICENSE,channel:'ops',
   snapshot:{o:{'-A':{s:400,c:await encryptMirror(TEST_LICENSE,tagFrame(4,new Uint8Array([123,125])))}}}
  }),
  /unsupported durable wire tag/i
 );
 d.destroy();d2.destroy();badOps.destroy();
});

test('C90 RED: accepts the exact Firebase REST array form of /k (sequential revs 1..N) and still fails closed on malformed arrays',async()=>{
 const d=new Y.Doc();d.clientID=901;
 d.getMap('eventos').set('a',{kind:'sale.record',opId:'op-c90-001',productId:'p',quantity:1,amountCents:1250});
 const u1=Y.encodeStateAsUpdate(d);
 const v1=Y.encodeStateVector(d);
 d.getMap('eventos').set('b',{kind:'sale.record',opId:'op-c90-002',productId:'p',quantity:2,amountCents:500});
 const u2=Y.encodeStateAsUpdate(d,v1);
 const k1={s:100,c:await encryptMirror(TEST_LICENSE,tagFrame(7,gzipSync(u1)))};
 const k2={s:200,c:await encryptMirror(TEST_LICENSE,tagFrame(0,u2))};
 const asObject=await certifyFirebaseChannelSnapshot({codigo:TEST_LICENSE,channel:'ops',frozenHead:HEAD,snapshot:{k:{'1':k1,'2':k2}}});
 // Firebase RTDB REST turns integer keys 1..N into a JSON array with null at index 0.
 const asArray=await certifyFirebaseChannelSnapshot({codigo:TEST_LICENSE,channel:'ops',frozenHead:HEAD,snapshot:{k:[null,k1,k2]}});
 assert.deepEqual(asArray.certification.checkpointRevs,[1,2]);
 assert.equal(asArray.certification.expectedStateSha256,asObject.certification.expectedStateSha256);
 assert.equal(asArray.certification.sourceFramesSha256,asObject.certification.sourceFramesSha256);
 assert.equal(asArray.certification.opIdsCount,2);
 // Holes stay holes (missing revs are not invented); index 0 must be null; non-record entries fail closed.
 const holes=await certifyFirebaseChannelSnapshot({codigo:TEST_LICENSE,channel:'ops',frozenHead:HEAD,snapshot:{k:[null,k1,null,null]}});
 assert.deepEqual(holes.certification.checkpointRevs,[1]);
 await assert.rejects(certifyFirebaseChannelSnapshot({codigo:TEST_LICENSE,channel:'ops',snapshot:{k:[k1,k2]}}),/invalid checkpoint/i);
 await assert.rejects(certifyFirebaseChannelSnapshot({codigo:TEST_LICENSE,channel:'ops',snapshot:{k:[null,'x']}}),/invalid checkpoint/i);
});
