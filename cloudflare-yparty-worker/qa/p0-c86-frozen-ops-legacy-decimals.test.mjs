// RED->GREEN: Real 1.0 Firebase -ops history includes decimal dollar fields
// (e.g. OCSyncEmit("abono", { amountCents: 1250, monto: 12.5 })) and optional
// undefined keys. Gate D import/packager must certify and round-trip them cleanly
// while still failing closed on NaN, Infinity, oversized floats, and non-plain objects.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import * as Y from 'yjs';
import {prepareImportedOpsBaseline} from '../src/frozen-ops-baseline.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';
import {packFrozenR2Archive} from '../tools/frozen-r2-packager.mjs';
import {salaDeLicencia} from '../src/sala.js';

const LICENSE='F123-TEST-ABONO-DECIMAL-10';
const HEAD='firebase-legacy-abono-head-001';
const SERVICE_KEY='synthetic-abono-decimal-service-key-32b';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function framesSha(frames){
 const out=Buffer.allocUnsafe(frames.reduce((n,f)=>n+4+f.byteLength,0));
 let off=0;
 for(const f of frames){
  out.writeUInt32BE(f.byteLength,off);off+=4;
  Buffer.from(f).copy(out,off);off+=f.byteLength;
 }
 return sha(out);
}

function buildLegacyOpsDoc(){
 const d=new Y.Doc();d.clientID=909;
 const frames=[];d.on('update',u=>frames.push(new Uint8Array(u)));
 // Exact legacy OCSyncEmit("abono", ...) envelope from docs/mock-backend.js:9385 + docs/sync-realtime.js:1713
 d.getMap('eventos').set('customer-payment:abono0001',{
  opId:'customer-payment:abono0001',
  deviceId:'dev-ios-01',
  deviceNombre:null,
  lamport:14,
  tipo:'abono',
  payload:{
   opId:'customer-payment:abono0001',
   clienteId:'cli-1',
   movimientoId:'mov-0001',
   amountCents:1250,
   monto:12.5,
   optionalTag:undefined
  },
  fecha:'2026-11-20T18:00:00.000Z',
  _salaOrigen:LICENSE
 });
 d.getMap('eventos').set('sale-int-0002',{
  opId:'sale-int-0002',
  kind:'sale.record',
  productId:'p-1',
  quantity:2,
  amountCents:500,
  negZero:-0
 });
 const state=Y.encodeStateAsUpdate(d);
 const vector=Y.encodeStateVector(d);
 return {d,frames,state,vector};
}

test('RED->GREEN: real 1.0 decimal abono.monto and optional undefined keys pass baseline, R2 packager, and Workerd SQLite reopen',{timeout:45000},async()=>{
 const {d,frames,state,vector}=buildLegacyOpsDoc();
 const baseline=prepareImportedOpsBaseline(d);
 assert.equal(baseline.count,2);

 const roomBase=await salaDeLicencia(LICENSE);
 const room=roomBase+'-ops';
 const proofInput={
  room,channel:'ops',frozenHead:HEAD,frames,
  externalProof:{
   sourceHead:HEAD,
   completeToHead:true,
   sourceFramesSha256:framesSha(frames),
   expectedStateSha256:sha(state),
   expectedVectorSha256:sha(vector),
   expectedOpIds:2
  }
 };
 const archive=await packFrozenR2Archive(proofInput);
 assert.equal(archive.manifest.expectedOpIds,2);

 const frozen=await prepareFrozenImport({
  frames,channel:'ops',frozenHead:HEAD,completeToHead:true,
  expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),expectedOpIds:2
 });
 assert.equal(frozen.eventCount,2);

 const compiled=(await build({
  entryPoints:[path.join(import.meta.dirname,'fixtures/c14-imported-ops-baseline-worker.mjs')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false
 })).outputFiles[0].text;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c86-sql-'));
 let mf;
 try{
  const boot=async()=>{
   mf=new Miniflare({
    modules:true,script:compiled,compatibilityDate:'2026-06-01',
    compatibilityFlags:['nodejs_compat'],durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
    durableObjectsPersist:path.join(dir,'durable'),kvNamespaces:['LICENCIAS'],
    bindings:{SALA_PILOTO:roomBase,WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:SERVICE_KEY},
    serviceBindings:{
     WS_AUTHORITY:async()=>new Response('synthetic'),
     WS_FROZEN_HISTORY_SOURCE:async()=>Response.json({
      room,channel:'ops',frozenHead:HEAD,completeToHead:true,
      frames:frames.map(f=>[...f]),
      expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),expectedOpIds:2
     })
    }
   });
   await mf.ready;
  };
  await boot();
  const first=await (await mf.dispatchFetch('http://localhost/parties/tienda/'+room,{
   headers:{'x-f123-c14-fixture':'synthetic-only','x-f123-c14-action':'inspect'}
  })).json();
  assert.equal(first.opened,true);
  assert.equal(first.baselineCount,2);
  await mf.dispose();
  await boot();
  const cold=await (await mf.dispatchFetch('http://localhost/parties/tienda/'+room,{
   headers:{'x-f123-c14-fixture':'synthetic-only','x-f123-c14-action':'inspect'}
  })).json();
  assert.equal(cold.opened,true);
  assert.equal(cold.already,true);
  assert.equal(cold.values['customer-payment:abono0001'].payload.monto,12.5);
  assert.equal(cold.values['sale-int-0002'].negZero,0);
 }finally{
  if(mf)await mf.dispose();
  fs.rmSync(dir,{recursive:true,force:true});
  d.destroy();
 }
});

test('fails closed on NaN, Infinity, out-of-range floats, undefined array items, and non-plain objects',()=>{
 for(const [label,bad,pattern] of [
  ['NaN',{opId:'bad1',amt:NaN},/unsafe economic amount/i],
  ['Infinity',{opId:'bad2',amt:Infinity},/unsafe economic amount/i],
  ['-Infinity',{opId:'bad3',amt:-Infinity},/unsafe economic amount/i],
  ['oversized float',{opId:'bad4',amt:1e25},/unsafe economic amount/i],
  ['undefined array item',{opId:'bad5',items:[undefined]},/unsupported economic payload type/i],
  ['Date object',{opId:'bad6',at:new Date(0)},/unsupported economic payload type/i]
 ]){
  const d=new Y.Doc();
  d.getMap('eventos').set('bad',bad);
  assert.throws(()=>prepareImportedOpsBaseline(d),pattern,label);
  d.destroy();
 }
});
