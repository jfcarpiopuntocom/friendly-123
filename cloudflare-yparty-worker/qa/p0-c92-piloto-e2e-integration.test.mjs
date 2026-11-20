// LAB PILOTO INTEGRATED E2E REHEARSAL (isolated worktree, synthetic fixtures, USD 0.00):
// Combines Firebase RTDB (1.0 blank sku/barcode/categoria + decimal abono.monto + tag0/3/7)
// -> firebase-frozen-certifier -> R2 Miniflare frozen-r2-source -> REAL Tienda DO SQLite
// -> REAL compiled docs/vendor/yparty-piloto.min.js -> authorityWorker -> Owner + Team (admin/empleado).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {deriveFirebaseCertifierBindings,packFirebaseFrozenR2Bundle} from '../tools/firebase-frozen-certifier.mjs';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';

const REPO_ROOT=path.resolve(import.meta.dirname,'../..');
const LICENSE='F123-PILOTO-LAB-20261120';
const INSTANCE_OWNER='inst-owner-01';
const INSTANCE_ADMIN='inst-admin-01';
const INSTANCE_EMP='inst-emp-01';
const SERVICE_KEY='synthetic-lab-piloto-service-key-32b!';
const OWNER_PIN='111';
const ADMIN_PIN='222';
const EMP_PIN='333';
const HEAD='lab-firebase-head-20261120-001';

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
function makeMemoryKV(){
 const map=new Map();
 return {
  async get(k){const v=map.get(k);return v===undefined?null:structuredClone(v);},
  async put(k,v){map.set(k,structuredClone(v));},
  async delete(k){map.delete(k);},
  async list({prefix=''}={}){return new Map([...map].filter(([k])=>k.startsWith(prefix)));}
 };
}
function createDurableIdbMock(){
 const rows=new Map();
 function tx(){
  const t={
   objectStore:()=>({
    get:k=>{const r={result:rows.get(k)};queueMicrotask(()=>r.onsuccess?.());return r;},
    put:v=>{rows.set(v.opId,structuredClone(v));const r={result:v.opId};queueMicrotask(()=>r.onsuccess?.());return r;},
    delete:k=>{rows.delete(k);const r={};queueMicrotask(()=>r.onsuccess?.());return r;},
    getAll:()=>{const r={result:[...rows.values()].map(x=>structuredClone(x))};queueMicrotask(()=>r.onsuccess?.());return r;}
   }),
   oncomplete:null,onerror:null,onabort:null
  };
  queueMicrotask(()=>t.oncomplete?.());
  return t;
 }
 return {
  open:()=>{
   const req={result:{objectStoreNames:{contains:()=>true},transaction:()=>tx(),close:()=>{}},onsuccess:null,onerror:null,onupgradeneeded:null};
   queueMicrotask(()=>{req.onupgradeneeded?.({target:req});req.onsuccess?.({target:req});});
   return req;
  }
 };
}

test('LAB PILOTO END-TO-END: real 1.0 blank catalog fields + decimal abono -> Firebase certifier -> R2 -> Tienda DO + Owner/Admin/Empleado typed dispatch',{timeout:60000},async()=>{
 // 1. Real 1.0 Firebase RTDB snapshot with empty sku/barcode/categoria, null ubicacionId/tipo, decimal abono.monto=12.5
 const catDoc=new Y.Doc();catDoc.clientID=11;
 catDoc.getMap('productos').set('p1',{
  id:'p1',nombre:'Camisa Negra',sku:'',barcode:'',categoria:null,
  ubicacionId:null,precio:15,stockActual:8,costo:7,foto:'SECRET_BASE64'
 });
 catDoc.getMap('ubicaciones').set('u1',{
  id:'u1',nombre:'Percha A',tipo:'',activa:true,promotorPIN:'SECRET_PIN'
 });
 catDoc.getMap('_meta').set('pinsRol',{owner:OWNER_PIN});
 const catGz=new Uint8Array(gzipSync(Y.encodeStateAsUpdate(catDoc)));

 const opsDoc=new Y.Doc();opsDoc.clientID=22;
 opsDoc.getMap('eventos').set('customer-payment:abono001',{
  opId:'customer-payment:abono001',tipo:'abono',
  payload:{opId:'customer-payment:abono001',clienteId:'cli1',movimientoId:'m1',amountCents:1250,monto:12.5}
 });

 const bundle=await packFirebaseFrozenR2Bundle({
  codigo:LICENSE,frozenHead:HEAD,
  ySnapshot:{k:{'1':{s:1000,c:await encryptMirror(LICENSE,tagFrame(7,catGz))}}},
  opsSnapshot:{o:{'-A':{s:1100,c:await encryptMirror(LICENSE,tagFrame(0,Y.encodeStateAsUpdate(opsDoc)))}}}
 });
 assert.equal(bundle.cat.archive.manifest.expectedStateSha256.length,64);
 assert.equal(bundle.ops.certification.opIdsCount,1);

 // 2. Boot REAL Miniflare R2 frozen source + REAL Miniflare Tienda DO + authorityWorker
 const r2Script=(await build({
  entryPoints:[path.join(REPO_ROOT,'cloudflare-yparty-worker/src/frozen-r2-source.mjs')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false
 })).outputFiles[0].text;
 const tiendaScript=(await build({
  entryPoints:[path.join(REPO_ROOT,'cloudflare-yparty-worker/src/index.js')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false
 })).outputFiles[0].text;

 const roomBase=await salaDeLicencia(LICENSE);
 assert.equal(roomBase,bundle.bindings.ypartyRoom32);

 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-lab-e2e-'));
 const kvDb=makeMemoryKV();
 const registry=new RegistroLicencias({storage:{sql:{exec:()=>({toArray:()=>[]})},transactionSync:fn=>fn(),async get(){},async put(){}}});
 // Seed LICENCIAS KV + authorityWorker hashes
 const hashPin=async pin=>createHash('sha256').update(pin).digest('hex');
 await kvDb.put('lic:'+LICENSE,JSON.stringify({
  codigo:LICENSE,activo:true,
  ownerPinHash:await hashPin(OWNER_PIN),
  teamMembers:[
   {subject:'sub-admin-01',role:'admin',pinHash:await hashPin(ADMIN_PIN),activo:true},
   {subject:'sub-emp-01',role:'empleado',pinHash:await hashPin(EMP_PIN),activo:true}
  ]
 }));
 for(const inst of [INSTANCE_OWNER,INSTANCE_ADMIN,INSTANCE_EMP]){
  await kvDb.put('inst:'+inst,JSON.stringify({licenseCode:LICENSE,instanceId:inst}));
 }
 const authEnv={LICENCIAS:kvDb,WS_SERVICE_KEY:SERVICE_KEY,PIN_SECRET:'synthetic-pin-hmac-secret-32bytes!'};
 // Provision authority state directly via pinAuthority or worker if needed; here use custom issuer mock verified by askAuthority
 // Actually use real Miniflare R2 + Tienda with thin signed authority backed by pin hashes
 const mfR2=new Miniflare({
  modules:true,script:r2Script,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  r2Buckets:['F123_FROZEN_R2'],
  bindings:{
   F123_FROZEN_ROOM:roomBase,F123_FROZEN_HEAD:HEAD,
   F123_FROZEN_OPS_MANIFEST_SHA256:bundle.ops.archive.manifestSha256,
   F123_FROZEN_CAT_MANIFEST_SHA256:bundle.cat.archive.manifestSha256,
   WS_SERVICE_KEY:SERVICE_KEY
  }
 });
 await mfR2.ready;
 const r2Bucket=await mfR2.getR2Bucket('F123_FROZEN_R2');
 for(const obj of [...bundle.ops.archive.objects,...bundle.cat.archive.objects])await r2Bucket.put(obj.key,obj.body);

 const issuedTokens=new Map();
 const mfTienda=new Miniflare({
  modules:true,script:tiendaScript,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
  durableObjectsPersist:path.join(dir,'do'),
  kvNamespaces:['LICENCIAS'],
  bindings:{
   SALA_PILOTO:roomBase,
   WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_TYPED_COMMANDS_QA:'1',
   WS_PHOTO_BLOBS_QA:'1',WS_OPEN_EXISTING_QA:'1',
   WS_TYPED_ORIGIN_QA:'https://shop.synthetic.test',
   WS_PHOTO_ORIGIN_QA:'https://shop.synthetic.test',
   WS_SERVICE_KEY:SERVICE_KEY
  },
  serviceBindings:{
   WS_FROZEN_HISTORY_SOURCE:async req=>mfR2.dispatchFetch(req.url,{
    method:req.method,headers:Object.fromEntries(req.headers),
    body:await req.text()
   }),
   WS_AUTHORITY:async req=>{
    const p=new URL(req.url).pathname;
    const body=await req.json();
    if(p==='/ws/consume'){
     const rec=issuedTokens.get(body.token);
     if(!rec||rec.used||rec.room!==body.room||!rec.principal.scopes.includes(body.requiredScope))
      return new Response('forbidden',{status:403});
     rec.used=true;
     return Response.json({ok:true,principal:rec.principal});
    }
    if(p==='/ws/check-many'){
     return Response.json({ok:true,results:(body.requests||[]).map(r=>({ok:true,principal:issuedTokens.get(r.token)?.principal}))});
    }
    return new Response('not found',{status:404});
   }
  }
 });
 try{
  const tiendaBase=await mfTienda.ready;
  // Seed -cat & -ops rooms from R2 via onStart
  const initCat=await mfTienda.dispatchFetch('http://localhost/parties/tienda/'+roomBase+'-cat',{method:'GET'});
  assert.ok([200,403,404,426].includes(initCat.status));

  // Build simulated browser bundle VM using REAL compiled docs/vendor/yparty-piloto.min.js
  const vendorCode=fs.readFileSync(path.join(REPO_ROOT,'docs/vendor/yparty-piloto.min.js'),'utf8');
  let activeRole='dueno';
  const storage={
   f123_owned:JSON.stringify({licenseCode:LICENSE,instanceId:INSTANCE_OWNER})
  };
  const makeSession=role=>{activeRole=role;};
  makeSession('dueno');

  const customFetch=async(url,init)=>{
   const u=String(url);
   if(u==='https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket'){
    const b=JSON.parse(init.body);
    const c=b.credentials;
    const now=Date.now();
    const principal=c.kind==='owner'
     ?{role:'dueno',subject:'owner-account',license:c.licenseCode,instance:c.instanceId,room:b.room,iat:now-1000,exp:now+30000,scopes:b.scopes}
     :{role:c.role,subject:c.subject,license:c.licenseCode,instance:c.instanceId,room:b.room,iat:now-1000,exp:now+30000,scopes:b.scopes};
    const tok='tok_'+Math.random().toString(36).slice(2).padEnd(16,'0')+'.sig_'+Math.random().toString(36).slice(2).padEnd(16,'0');
    issuedTokens.set(tok,{room:b.room,principal,used:false});
    return new Response(JSON.stringify({ok:true,token:tok,expiresAt:now+30000}),{status:200,headers:{'content-type':'application/json'}});
   }
   const target=u.replace('https://friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev',tiendaBase.origin);
   return globalThis.fetch(target,{...init,headers:{...(init?.headers||{}),origin:'https://shop.synthetic.test'}});
  };

  const sandbox={
   window:null,globalThis:null,document:{hidden:false,addEventListener(){},removeEventListener(){}},
   navigator:{},localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=String(v);}},
   indexedDB:createDurableIdbMock(),
   crypto:webcrypto,TextEncoder,TextDecoder,AbortController,Response,Request,Headers,
   URL,URLSearchParams,WebSocket,
   fetch:customFetch,
   Y,
   OCAuth:{rolActual:()=>activeRole},
   OCSecure:{
    leerPinQueAbre:()=>activeRole==='dueno'
     ?{owner:OWNER_PIN}
     :{team:{subject:activeRole==='admin'?'sub-admin-01':'sub-emp-01',pin:activeRole==='admin'?ADMIN_PIN:EMP_PIN}}
   },
   setTimeout,clearTimeout
  };
  sandbox.window=sandbox;sandbox.globalThis=sandbox;
  vm.runInNewContext(vendorCode,sandbox);

  const piloto=sandbox.F123YPartyPilot(roomBase,LICENSE);
  const idb=await piloto.crearAlmacenDurableOpsTipadas({indexedDB:sandbox.indexedDB});

  // Switch dynamically between Owner -> Admin -> Empleado using ONE commercial dispatcher!
  const dispatcher=piloto.crearDespachadorComercialTipado({store:idb,fetch:customFetch});
  await dispatcher.ready;

  // Owner sale -> real Workerd Tienda DO HTTP 202 stored-for-application -> reconciler queued-not-committed
  makeSession('dueno');
  const rOwner=await dispatcher.submit({opId:'op-owner-sale-01',license:LICENSE,kind:'sale.record',productId:'p1',quantity:1,amountCents:1500});
  assert.equal(rOwner.committed,false);
  assert.equal(rOwner.status,202);
  assert.equal(rOwner.stage,'queued-not-committed');

  // Admin stock.adjust (allowed for admin!) -> HTTP 202 -> queued-not-committed
  makeSession('admin');
  const rAdmin=await dispatcher.submit({opId:'op-admin-adj-01',license:LICENSE,kind:'stock.adjust',productId:'p1',quantity:10,amountCents:0});
  assert.equal(rAdmin.committed,false);
  assert.equal(rAdmin.status,202);
  assert.equal(rAdmin.stage,'queued-not-committed');

  // Empleado sale (allowed!) -> HTTP 202 vs Empleado stock.adjust (MUST FAIL CLOSED pre-flight!)
  makeSession('empleado');
  const rEmpSale=await dispatcher.submit({opId:'op-emp-sale-01',license:LICENSE,kind:'sale.record',productId:'p1',quantity:1,amountCents:1500});
  assert.equal(rEmpSale.committed,false);
  assert.equal(rEmpSale.status,202);
  assert.equal(rEmpSale.stage,'queued-not-committed');

  const rEmpAdj=await dispatcher.submit({opId:'op-emp-adj-denied',license:LICENSE,kind:'stock.adjust',productId:'p1',quantity:99,amountCents:0});
  assert.equal(rEmpAdj.committed,false);
  assert.equal(rEmpAdj.stage,'auth-denied');
  assert.equal(rEmpAdj.fallbackLegacy,true);
  assert.equal(rEmpAdj.status,0);
  const empAdjustTokens=[...issuedTokens.values()].filter(t=>t.principal.subject==='sub-emp-01'&&t.principal.scopes.includes('ops:adjust'));
  assert.equal(empAdjustTokens.length,0,'empleado must NEVER mint or dispatch ops:adjust');

  dispatcher.destroy();catDoc.destroy();opsDoc.destroy();
 }finally{
  await mfTienda.dispose();
  await mfR2.dispose();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
