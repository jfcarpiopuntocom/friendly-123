// Gate D against the QA store's REAL Yjs state (read by extraer.cjs). Copied at run time into the
// workshop's yparty-worker/qa/ so the PR #116 fixture and real Tienda are used unchanged.
// Local Workerd/Miniflare only: the forward write lives in the runner's temporary DO and dies with it.
// Logs only counts, SHA-256 and client ids of pending parents (never content).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import WebSocket from 'ws';import * as Y from 'yjs';import YProvider from 'y-partyserver/provider';
import authorityWorker,{RegistroLicencias} from '../../../../app/cloudflare-worker/worker.js';
import {pinAuthority} from '../../../../app/cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const log=(k,v)=>console.log('GATE_D_REAL_'+k+': '+JSON.stringify(v));
// Local-only synthetic identity for the runner relay; the real QA license never enters Workerd.
const license='F123-SYNT-GATED-REAL',instance='synthetic-gate-d-runner',key='synthetic-gate-d-service-key-32-bytes!!';
const DIR=process.env.GATE_D_REAL_DIR;
const bundle=(await build({entryPoints:[path.join(import.meta.dirname,'fixtures/gate-d-open-existing-worker.mjs')],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
const room=await salaDeLicencia(license);
const pending=d=>d.store.pendingStructs||d.store.pendingDs;

const src={};
for(const ch of ['cat','ops']){
 const bytes=new Uint8Array(fs.readFileSync(path.join(DIR,ch+'.bin')));
 const doc=new Y.Doc();Y.applyUpdate(doc,bytes,'firebase');
 const missing=doc.store.pendingStructs?[...doc.store.pendingStructs.missing.keys()]:[];
 src[ch]={doc,bytes,missing,pendingDs:!!doc.store.pendingDs,
  proof:{channel:ch,frozenHead:'qa-store-runner-read',completeToHead:true,frames:[[...bytes]],
   expectedStateSha256:sha(Y.encodeStateAsUpdate(doc)),expectedVectorSha256:sha(Y.encodeStateVector(doc)),
   ...(ch==='ops'?{expectedOpIds:doc.getMap('eventos').size}:{})}};
 log('FUENTE_'+ch.toUpperCase(),{bytes:bytes.length,clientesYjs:doc.store.clients.size,
  eventos:ch==='ops'?doc.getMap('eventos').size:undefined,padresPendientes:missing.length,padresPendientesClientes:missing,
  pendingDs:!!doc.store.pendingDs,stateSha256:src[ch].proof.expectedStateSha256,vectorSha256:src[ch].proof.expectedVectorSha256});
}

async function authority(){
 let records=new Map(),tail=Promise.resolve();
 const db={get:async k=>structuredClone(records.get(k)),
  transaction:async fn=>{let release;const prev=tail;tail=new Promise(r=>release=r);await prev;
   const snap=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
   try{const out=await fn({get:async k=>structuredClone(snap.get(k)),put:async(k,v)=>snap.set(k,structuredClone(v)),
    delete:async k=>snap.delete(k),list:async({prefix,limit})=>new Map([...snap].filter(([k])=>k.startsWith(prefix)).slice(0,limit))});
    records=snap;return out;}finally{release();}}};
 await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance}));
 const env={PIN_PEPPER:'synthetic-owner-secret-more-than-32bytes',TEAM_PIN_PEPPER:'synthetic-team-secret-separate-32bytes',
  TEAM_AUTHORITY_QA:'1',TEAM_AUTHORITY_LICENSE:license,WS_AUTHORITY_QA:'1',
  WS_SIGNING_KEY:'synthetic-ws-signing-secret-more-than-32bytes',WS_SERVICE_KEY:key};
 const owner=pinAuthority(db,env.PIN_PEPPER);await owner.masterSet(license,'123',0,[instance]);await owner.masterActivate(license,'123',0,[instance]);
 const registry=new RegistroLicencias({storage:db},env);
 env.REGISTROS={idFromName:()=>({}),get:()=>({fetch:(i,o)=>registry.fetch(new Request(i,o))})};
 return env;
}
async function relay(source){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-gate-d-real-')),env=await authority();let mf,url;
 const bindings={SALA_PILOTO:room,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:key,WS_OPEN_EXISTING_QA:'1',
  GATE_D_TEST_SOURCE:JSON.stringify(source)};
 const boot=async()=>{mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(dir,'do'),
  kvNamespaces:['LICENCIAS'],bindings,
  serviceBindings:{WS_AUTHORITY:async r=>authorityWorker.fetch(new Request(r.url,r),env)}});
  await(await mf.getKVNamespace('LICENCIAS')).put('inst:'+instance,JSON.stringify({licenseCode:license,instanceId:instance}));
  url=await mf.ready;};
 await boot();
 const open=[];
 return {
  async connect(ch,scopes){
   const t=await authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({credentials:{kind:'owner',licenseCode:license,instanceId:instance,pin:'123'},room:room+'-'+ch,scopes,ttlMs:60000})}),env);
   const {token}=await t.json();assert.equal(t.status,200);
   const doc=new Y.Doc(),provider=new YProvider(url.host,room+'-'+ch,doc,{party:'tienda',
    params:{licencia:license,instancia:instance,cap:token},WebSocketPolyfill:WebSocket,disableBc:true});
   open.push(()=>{provider.destroy();doc.destroy();});
   await waitFor(()=>provider.synced,ch+' sync',30000);return doc;},
  gate(ch,body){return mf.dispatchFetch('http://localhost/parties/tienda/'+room+'-'+ch,{method:body?'POST':'GET',
    headers:{'x-f123-synthetic-gate-d':'1'},body});},
  async restart(){open.splice(0).forEach(f=>f());await mf.dispose();await boot();},
  async close(){open.splice(0).forEach(f=>f());await mf.dispose();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function waitFor(pred,label,ms=8000){const t=Date.now();while(!pred()){if(Date.now()-t>ms)throw Error('timeout '+label);await new Promise(r=>setTimeout(r,25));}}

test('Gate D on the QA store real history: as-is, forward, cold restart, failback only-new',{timeout:240000},async()=>{
 const w=await relay({cat:src.cat.proof,ops:src.ops.proof});
 try{
  const s0=await(await w.gate('cat')).json(),o0=await(await w.gate('ops')).json();
  log('APERTURA',{cat:{opened:s0.gateD?.opened,failback:s0.gateD?.failback??null,bloques:s0.blocks},
   ops:{opened:o0.gateD?.opened,failback:o0.gateD?.failback??null,bloques:o0.blocks}});
  assert.equal(src.cat.missing.length+src.ops.missing.length,0,'padres pendientes en la fuente real');
  assert.equal(s0.gateD.opened,true);assert.equal(s0.gateD.receipt.sha256,src.cat.proof.expectedStateSha256);
  assert.equal(o0.gateD.opened,true);assert.equal(o0.gateD.receipt.sha256,src.ops.proof.expectedStateSha256);
  const writer=await w.connect('cat',['cat:read','cat:write']);
  assert.equal(pending(writer),null);
  assert.equal(sha(Y.encodeStateVector(writer)),src.cat.proof.expectedVectorSha256,'cat served as-is');
  const ops=await w.connect('ops',['ops:read']);
  assert.equal(pending(ops),null);
  assert.equal(sha(Y.encodeStateVector(ops)),src.ops.proof.expectedVectorSha256,'ops served as-is');
  // Forward: one NEW synthetic write, only in this runner's local DO.
  writer.getMap('_gate_d_runner_probe').set('n',Date.now());
  const reader=await w.connect('cat',['cat:read']);
  await waitFor(()=>reader.getMap('_gate_d_runner_probe').has('n'),'forward',15000);
  const vecForward=sha(Y.encodeStateVector(reader)),structs=d=>[...d.store.clients.values()].reduce((n,a)=>n+a.length,0);
  const nForward=structs(reader);
  await w.restart();
  const cold=await w.connect('cat',['cat:read']);
  assert.equal(pending(cold),null);
  assert.equal(sha(Y.encodeStateVector(cold)),vecForward,'cold restart = history + forward');
  const again=await(await w.gate('cat')).json();
  assert.deepEqual([again.gateD.opened,again.gateD.already],[true,true],'no re-import');
  log('ADELANTE_Y_REINICIO',{vectorSha256:vecForward,structsAntes:nForward,structsTrasReinicio:structs(cold),reimportado:!again.gateD.already});
  assert.equal(structs(cold),nForward,'no duplicates after restart');
  const r=await w.gate('cat',Y.encodeStateVector(src.cat.doc));
  assert.equal(r.status,200);
  const update=new Uint8Array(await r.arrayBuffer());
  const clients=[...new Set(Y.decodeUpdate(update).structs.map(s=>s.id.client))];
  const historicos=clients.filter(c=>src.cat.doc.store.clients.has(c));
  Y.applyUpdate(src.cat.doc,update);const once=sha(Y.encodeStateAsUpdate(src.cat.doc));
  Y.applyUpdate(src.cat.doc,update);const twice=sha(Y.encodeStateAsUpdate(src.cat.doc));
  log('FAILBACK',{bytes:update.length,clientesEnUpdate:clients.length,clientesHistoricosReenviados:historicos.length,
   shaIgualServidor:once===r.headers.get('x-state-sha256'),idempotente:once===twice});
  assert.deepEqual(historicos,[],'failback resends no history');
  assert.equal(once,r.headers.get('x-state-sha256'));assert.equal(twice,once);
 }finally{await w.close();}
});
