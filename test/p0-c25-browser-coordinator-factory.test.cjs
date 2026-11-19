'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');

const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'src', 'yparty-piloto.js');
const BUNDLE_PATH = path.join(ROOT, 'docs', 'vendor', 'yparty-piloto.min.js');
const SYNC_YJS_PATH = path.join(ROOT, 'docs', 'sync-yjs.js');

const LICENSE = 'F123-SYNT-C25COORD';
const INSTANCE = 'synthetic-c25-device';
const ROOM = 'd'.repeat(32);

const YJS_BUNDLE = fs.readFileSync(path.join(ROOT, 'docs', 'vendor', 'yjs-bundle.min.js'), 'utf8');

function makePilotEnv({
  role = 'dueno',
  ownerPin = '123',
  team = { subject: 'emp_01', pin: '234' },
  hidden = false,
  owned = { licenseCode: LICENSE, instanceId: INSTANCE },
  fetchImpl = async () => { throw new Error('unexpected fetch'); }
} = {}) {
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const indexedDB = new IDBFactory();
  const docListeners = new Map();
  const winListeners = new Map();

  const document = {
    hidden,
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) {
      docListeners.get(ev)?.delete(fn);
    }
  };

  const window = {
    indexedDB,
    OCAuth: { rolActual: () => role },
    OCSecure: {
      leerPinQueAbre: () => ({
        owner: ownerPin,
        team
      })
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) {
      winListeners.get(ev)?.delete(fn);
    }
  };

  const localStorage = {
    getItem(k) {
      if (k === 'f123_owned') return owned ? JSON.stringify(owned) : null;
      return null;
    }
  };

  const ctx = vm.createContext({
    window,
    self: window,
    globalThis: null,
    document,
    localStorage,
    indexedDB,
    fetch: (url, opts) => fetchImpl(url, opts),
    crypto: crypto.webcrypto,
    atob,
    btoa,
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob,
    Response,
    Request,
    Headers,
    structuredClone,
    setTimeout,
    clearTimeout
  });
  ctx.globalThis = ctx;
  window.globalThis = ctx;
  window.window = window;
  window.document = document;
  window.localStorage = localStorage;
  window.fetch = ctx.fetch;
  window.crypto = crypto.webcrypto;
  window.atob = atob;
  window.btoa = btoa;

  vm.runInContext(YJS_BUNDLE, ctx, { filename: 'yjs-bundle.min.js' });
  window.Y = window.Y || ctx.Y;
  vm.runInContext(bundleCode, ctx, { filename: 'yparty-piloto.min.js' });
  const pilot = window.F123YPartyPilot(ROOM, LICENSE);
  return {
    pilot,
    Y: window.Y,
    ctx,
    window,
    document,
    indexedDB,
    setRole(r) { role = r; },
    setHidden(h) { document.hidden = h; },
    firePageHide() { for(const fn of winListeners.get('pagehide')||[])fn({persisted:true}); },
    listenerCount(event) { return winListeners.get(event)?.size||0; }
  };
}


test('C25 RED: actual shipped browser bundle and guarded Sync3 facade expose C21a coordinator factory, not a disconnected source module',()=>{
  const src=fs.readFileSync(SOURCE_PATH,'utf8');
  const bundle=fs.readFileSync(BUNDLE_PATH,'utf8');
  const facade=fs.readFileSync(SYNC_YJS_PATH,'utf8');
  for(const body of [src,bundle,facade]){
    assert.match(body,/crearCoordinadorCorte20/,'C25 method must be part of the actual published app');
  }
  assert.match(src,/createVerifiedCrossDeviceFailbackCoordinator/);
  assert.match(bundle,/settled_ops/,'C21b atomic terminal tombstone must remain bundled');
  const env=makePilotEnv();
  assert.equal(typeof env.pilot.crearCoordinadorCorte20,'function');
  assert.equal(env.pilot.fotoSha(),null);
});

test('C25 real bundle: certified 2.0 commercial op commits once, survives browser reload, blocks same opId on legacy; pagehide releases catalog writer',{timeout:20000},async()=>{
  const head='certified-c25-head-20261119',sha='f'.repeat(64);
  const sale={license:LICENSE,opId:'op_c25_committed_0001',kind:'sale.record',
    productId:'sku_1',quantity:1,amountCents:1500};
  const digest=crypto.createHash('sha256').update(JSON.stringify(sale)).digest('hex');
  let requests=0,opens=0,closes=0;
  const env=makePilotEnv({fetchImpl:async(url,options={})=>{
    const path=String(url);
    if(path.endsWith('/ws/ticket')){
      ++requests;
      return new Response(JSON.stringify({ok:true,token:'synthetic-ticket-'+requests+'.sig',expiresAt:Date.now()+30000}),
        {status:200,headers:{'content-type':'application/json'}});
    }
    if(path.includes('frozen-proof=1')){
      return new Response(JSON.stringify({ok:true,room:ROOM+'-cat',channel:'cat',
        frozenHead:head,stateSha256:sha,vectorSha256:sha}),
        {status:200,headers:{'content-type':'application/json'}});
    }
    if(path.includes('-ops')){
      ++opens;
      return new Response(JSON.stringify({ok:true,duplicate:false,receipt:{
        opId:sale.opId,license:LICENSE,kind:sale.kind,stage:'business-committed',
        receiptId:digest.slice(0,24),acceptedAt:Date.now()}}),
        {status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error('unexpected synthetic route '+path);
  }});
  const privateDoc=vm.runInContext(`(()=>{
   const d=new Y.Doc();d.getMap('productos').set('p-1',{id:'p-1',nombre:'Synthetic',precio:10,stockActual:2});
   d.getMap('ubicaciones').set('s-1',{id:'s-1',nombre:'Shelf',activa:true});
   d.getMap('_meta').set('pin','SECRET_PRIVATE_STAYS_LOCAL');return d;
  })()`,env.ctx);
  const createProvider=({doc,params,readOnly})=>{
    assert.equal(readOnly,false);
    const listeners=new Map();
    return {
      on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},
      off(event,fn){listeners.get(event)?.delete(fn);},
      async connect(){
        await params();
        doc.getMap('productos').set('p-1',{id:'p-1',nombre:'Synthetic',precio:10,stockActual:2});
        doc.getMap('ubicaciones').set('s-1',{id:'s-1',nombre:'Shelf',activa:true});
        for(const fn of listeners.get('synced')||[])fn(true);
      },
      destroy(){++closes;}
    };
  };
  let a;
  try{
    a=await env.pilot.crearCoordinadorCorte20(privateDoc,head,{indexedDB:env.indexedDB,createProvider});
    assert.equal(a.mode(),'failback-legacy-1.0','must not auto activate new transport');
    const activated=await a.activate20();
    assert.equal(activated.ok,true,'real C19a C11-certified writer must be active; state='+activated.reason+', ticketCalls='+requests);
    assert.equal(activated.frozenHead,head);
    const result=await a.submitCommercial(sale);
    assert.equal(result.committed,true);
    assert.equal(opens,1,'one trusted typed business effect');
    assert.equal(await a.canDispatchOnLegacy(sale.opId),false);
    env.firePageHide();
    assert.equal(a.mode(),'failback-legacy-1.0','pagehide releases C10 writer');
    assert.ok(closes>=1);
    a.destroy();a=null;
    const reloadedPilot=env.window.F123YPartyPilot(ROOM,LICENSE);
    const second=await reloadedPilot.crearCoordinadorCorte20(privateDoc,head,{indexedDB:env.indexedDB,createProvider});
    try {
      assert.equal(await second.canDispatchOnLegacy(sale.opId),false,
        'committed opId still blocked on legacy after fresh browser lifecycle');
      await assert.rejects(second.assertLegacyAllowed(sale.opId),/latched-same-do-only/);
      assert.equal(await second.canDispatchOnLegacy('op_c25_untouched_002'),true);
      assert.equal(opens,1,'no duplicate sale from construction/reload');
    }finally{second.destroy();}
    assert.equal(env.listenerCount('pagehide'),0,'browser hooks must be cleaned');
  }finally{a?.destroy();privateDoc.destroy();}
});

test('C25 rejects Team/non-owner and background browser before opening any transport',async()=>{
 const hidden=makePilotEnv({hidden:true});
 const team=makePilotEnv({role:'empleado'});
 const hDoc=vm.runInContext('new Y.Doc()',hidden.ctx);
 const tDoc=vm.runInContext('new Y.Doc()',team.ctx);
 try {
  await assert.rejects(hidden.pilot.crearCoordinadorCorte20(hDoc,'head_c25'),
    /unavailable|hidden|owner/);
  await assert.rejects(team.pilot.crearCoordinadorCorte20(tDoc,'head_c25'),
    /unavailable|owner/);
 }finally{hDoc.destroy();tDoc.destroy();}
});
