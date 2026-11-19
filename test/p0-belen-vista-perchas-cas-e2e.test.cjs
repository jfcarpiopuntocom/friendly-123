'use strict';
// P0 Belén: RED->GREEN end-to-end CAS (expectedFotoHash + expectedFotoRev) across
// ALL THREE PUT /api/ubicaciones/:id writers in real docs/vista-perchas.js against
// real docs/mock-backend.js, plus strict ACK and notebook guard on vault-restore.
// Synthetic fixtures only; no customer data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {browser} = require('./helpers/browser.cjs');

const source = fs.readFileSync(path.join(__dirname, '../docs/vista-perchas.js'), 'utf8').replace(/\r\n/g, '\n');
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const PHOTO = 'data:image/png;base64,' + Buffer.from('synthetic-belen-cas-e2e').toString('base64');

async function backendFixture() {
  const w = browser();
  w.OCAuth = {rolActual: () => 'dueno'};
  const shelf = await w.request('/api/ubicaciones', 'POST', {nombre: 'Percha CAS Belén QA'});
  assert.equal((await w.fetch('/api/ubicaciones/' + shelf.id, {
    method: 'PUT', body: JSON.stringify({fotoHash: A})
  })).status, 200);
  const current = () => JSON.parse(JSON.stringify(w.catalog().ubicaciones.find(u => u.id === shelf.id)));
  return {w, shelf, current};
}

test('Belén CAS #1 (recuperarFotosPerchas): sends expectedFotoHash/expectedFotoRev and gets 409 instead of overwriting C', async () => {
  const {w, shelf, current} = await backendFixture();
  const observedA = current();
  // Concurrent device advances shelf A -> C before recovery PUT fires.
  assert.equal((await w.fetch('/api/ubicaciones/' + shelf.id, {
    method: 'PUT',
    body: JSON.stringify({fotoHash: C, expectedFotoHash: A, expectedFotoRev: observedA.fotoRev})
  })).status, 200);
  const afterC = current();

  const a = source.indexOf('  async function recuperarFotosPerchas(perchasVisibles, estaCarga) {');
  const b = source.indexOf('  async function cargar() {', a);
  assert.ok(a > 0 && b > a);
  const writes = [];
  let ack = null;
  const ctx = {
    window: {
      OCTienda: {licenciaActual: () => 'F123-SYNT-BELEN'},
      OCAuth: {rolActual: () => 'dueno'},
      OCYjs: {get: () => ({}), fotosMap: {get: () => null}},
      OCFotos: {leerPorHash: async () => null, leerFoto: async () => null, guardarPorHash: async () => true, guardarFoto: async () => true, hashDeDataUrl: async () => B},
      OCSalud: {fallo: () => {}},
      F123Application: {
        recoverShelfPhoto: async (s, ports) => {
          ack = await ports.setPointer(s.id, B);
          return {pointerChanged: ack, pointerHash: B};
        }
      }
    },
    API: '/api',
    fetch: async (url, req) => {
      writes.push(JSON.parse(req.body));
      return w.fetch(url, req);
    },
    historialFotosExacto: async () => ({}),
    historialFotosCheckpointsExacto: async () => ({}),
    fotoCache: {},
    cargaEnCurso: 1,
    console
  };
  vm.runInNewContext(source.slice(a, b) + '\nglobalThis.__run = recuperarFotosPerchas;', vm.createContext(ctx));
  await ctx.__run([observedA], 1);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedFotoHash, A, 'recovery writer must send observed expectedFotoHash');
  assert.deepEqual(writes[0].expectedFotoRev, observedA.fotoRev, 'recovery writer must send observed expectedFotoRev');
  assert.equal(ack, false, '409 conflict must not be treated as ACK');
  assert.deepEqual(current(), afterC, 'stale recovery A->B must NEVER overwrite newer photo C');
});

test('Belén CAS #2 (inputFoto): concurrent A->C during photo resize/hash gets 409, warns conflict and preserves C', async () => {
  const {w, shelf, current} = await backendFixture();
  const observedA = current();

  const start = source.indexOf("  inputFoto.addEventListener('change', () => {");
  const end = source.indexOf('  // ── un solo listener delegado', start);
  assert.ok(start > 0 && end > start);

  const warnings = [], alerts = [], writes = [];
  let handler = null, done = null, reloads = 0;
  const ctx = {
    window: {
      OCTienda: {licenciaActual: () => 'F123-SYNT-BELEN'},
      OCSync: {catalogoPropio: () => w.catalog()},
      OCSalud: {fallo: (scope, code) => warnings.push([scope, code])},
      addEventListener: () => {},
      OCFotos: {
        guardarFoto: async () => true,
        guardarFotoContenido: async () => {
          // Concurrent device advances A -> C while this device hashes photo B.
          const r = await w.fetch('/api/ubicaciones/' + shelf.id, {
            method: 'PUT',
            body: JSON.stringify({fotoHash: C, expectedFotoHash: A, expectedFotoRev: observedA.fotoRev})
          });
          assert.equal(r.status, 200);
          return B;
        }
      }
    },
    inputFoto: {files: [{name: 'b.png'}], value: 'x', addEventListener: (n, fn) => { if (n === 'change') handler = fn; }},
    perchaFotoPendiente: shelf.id,
    fotoCache: {},
    redimensionar: (_f, cb) => { done = Promise.resolve().then(() => cb(PHOTO)); },
    fetch: async (url, req) => {
      writes.push(JSON.parse(req.body));
      return w.fetch(url, req);
    },
    alert: msg => alerts.push(String(msg)),
    cargar: () => { reloads++; },
    API: '/api',
    console
  };
  vm.runInNewContext(source.slice(start, end), vm.createContext(ctx));
  handler();
  await done;

  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedFotoHash, A, 'camera upload must send captured expectedFotoHash');
  assert.deepEqual(writes[0].expectedFotoRev, observedA.fotoRev, 'camera upload must send captured expectedFotoRev');
  assert.equal(current().fotoHash, C, 'stale upload B must NOT overwrite concurrent photo C');
  assert.ok(warnings.some(x => x[1] === 'foto-pointer-conflicto'), '409 must report explicit conflict diagnostic');
  assert.equal(alerts.length, 1);
  assert.equal(reloads, 1);
});

test('Belén CAS #3 (vault-restore): sends CAS preimage, rejects null/non-ok ACK, blocks cross-notebook restore', async () => {
  const {w, shelf, current} = await backendFixture();
  const observedA = current();

  const start = source.indexOf("  document.addEventListener('click', async (e) => {");
  const end = source.indexOf("    // Cerrar carpeta", start);
  assert.ok(start > 0 && end > start);
  const restoreBlock = source.slice(start, end) + '\n  });';

  async function runRestore({responseOverride = null, switchShop = false, advanceToC = false} = {}) {
    let clickHandler = null, shop = 'F123-SYNT-BELEN', reloads = 0;
    const alerts = [], writes = [], fotoCache = {};
    const ctx = {
      document: {
        addEventListener: (ev, fn) => { if (ev === 'click') clickHandler = fn; },
        querySelector: () => ({value: shelf.id})
      },
      CSS: {escape: s => s},
      window: {
        OCTienda: {licenciaActual: () => shop},
        OCSync: {catalogoPropio: () => w.catalog()},
        OCFotos: {
          leerPorHash: async () => {
            if (switchShop) shop = 'F123-SYNT-OTHER';
            if (advanceToC) {
              await w.fetch('/api/ubicaciones/' + shelf.id, {
                method: 'PUT',
                body: JSON.stringify({fotoHash: C, expectedFotoHash: A, expectedFotoRev: observedA.fotoRev})
              });
            }
            return PHOTO;
          },
          guardarFoto: async () => true
        }
      },
      API: '/api',
      fotoCache,
      fetch: async (url, req) => {
        writes.push(JSON.parse(req.body));
        if (responseOverride !== null) return responseOverride === 'null' ? null : responseOverride;
        return w.fetch(url, req);
      },
      alert: msg => alerts.push(String(msg)),
      cargar: () => { reloads++; },
      console
    };
    vm.runInNewContext(restoreBlock, vm.createContext(ctx));
    await clickHandler({
      target: {closest: () => ({dataset: {vaultRestore: B}})},
      stopPropagation: () => {}
    });
    return {alerts, writes, reloads, fotoCache};
  }

  // (a) Null response is NEVER an ACK
  const rNull = await runRestore({responseOverride: 'null'});
  assert.equal(rNull.reloads, 0, 'null PUT reply must not claim restore succeeded');
  assert.equal(rNull.alerts.length, 1);

  // (b) Cross-notebook switch mid-restore blocks write completely
  const rSwitch = await runRestore({switchShop: true});
  assert.equal(rSwitch.writes.length, 0, 'notebook switch must block cross-shop restore PUT');
  assert.equal(rSwitch.fotoCache[shelf.id], undefined);

  // (c) Concurrent A -> C returns 409 and preserves C
  const rConflict = await runRestore({advanceToC: true});
  assert.equal(rConflict.writes.length, 1);
  assert.equal(rConflict.writes[0].expectedFotoHash, A);
  assert.deepEqual(rConflict.writes[0].expectedFotoRev, observedA.fotoRev);
  assert.equal(current().fotoHash, C, 'stale vault restore must NOT overwrite newer photo C');
  assert.equal(rConflict.alerts.length, 1);
});

test('Belén CAS P0: missing observed photo preimage must never send an unguarded PUT in ANY of the 3 writers', async () => {
  // (1) A synthetic recovery callback asks for a pointer outside the shelves
  // whose preimages were captured. The safe answer is false, with zero HTTP.
  const rs=source.indexOf('  async function recuperarFotosPerchas(perchasVisibles, estaCarga) {');
  const re=source.indexOf('  async function cargar() {',rs);
  const recoveryCalls=[];let recoveryAck;
  const recoveryCtx={
    window:{
      OCTienda:{licenciaActual:()=> 'F123-SYNT-BELEN'},
      OCYjs:{get:()=>({}),fotosMap:{get:()=>null}},
      OCFotos:{leerPorHash:async()=>null,leerFoto:async()=>null,guardarPorHash:async()=>true,guardarFoto:async()=>true,hashDeDataUrl:async()=>B},
      F123Application:{recoverShelfPhoto:async (s,ports)=>{
        recoveryAck=await ports.setPointer('not-observed-shelf',B);
        return{pointerChanged:recoveryAck};
      }}
    },
    API:'/api',fetch:async (...args)=>{recoveryCalls.push(args);return{ok:true}},
    historialFotosExacto:async()=>({}),historialFotosCheckpointsExacto:async()=>({}),
    fotoCache:{},cargaEnCurso:1,console
  };
  vm.runInNewContext(source.slice(rs,re)+'\nglobalThis.__run = recuperarFotosPerchas;',vm.createContext(recoveryCtx));
  await recoveryCtx.__run([{id:'observed-shelf',fotoHash:A,fotoRev:1}],1);
  assert.equal(recoveryAck,false);
  assert.equal(recoveryCalls.length,0,'recovery must not issue a naked PUT without expectedHash/revision');

  // (2) Camera takes a photo before catalog has a shelf preimage.
  // Keep bytes locally and warn, but never overwrite remote pointer blindly.
  const cs=source.indexOf("  inputFoto.addEventListener('change', () => {");
  const ce=source.indexOf('  // ── un solo listener delegado',cs);
  let cameraHandler,cameraDone;
  const cameraCalls=[],cameraAlerts=[];
  const cameraCtx={
    window:{
      OCTienda:{licenciaActual:()=> 'F123-SYNT-BELEN'},
      OCSync:{catalogoPropio:()=>({ubicaciones:[]})},
      OCFotos:{guardarFoto:async()=>true,guardarFotoContenido:async()=>B},
      OCSalud:{fallo:()=>{}},addEventListener:()=>{}
    },
    inputFoto:{files:[{name:'synthetic.png'}],value:'x',addEventListener:(e,fn)=>{if(e==='change')cameraHandler=fn}},
    perchaFotoPendiente:'missing-shelf',fotoCache:{},
    redimensionar:(_f,cb)=>{cameraDone=Promise.resolve().then(()=>cb(PHOTO));},
    fetch:async (...args)=>{cameraCalls.push(args);return{ok:true}},
    alert:s=>cameraAlerts.push(s),cargar:()=>{},API:'/api',console
  };
  vm.runInNewContext(source.slice(cs,ce),vm.createContext(cameraCtx));
  cameraHandler();await cameraDone;
  assert.equal(cameraCalls.length,0,'camera must not PUT photoHash without a verified preimage');
  assert.equal(cameraAlerts.length,1,'bytes preserved locally; caller warned to retry');

  // (3) Vault restore without any catalog/preimage must preserve the photo
  // and refuse to publish the pointer, even if server would return 200.
  const vs=source.indexOf("  document.addEventListener('click', async (e) => {");
  const ve=source.indexOf('    // Cerrar carpeta',vs);
  const vaultCalls=[],vaultAlerts=[];let clickHandler;
  const vaultCtx={
    document:{addEventListener:(name,fn)=>{if(name==='click')clickHandler=fn},
      querySelector:()=>({value:'missing-shelf'})},
    CSS:{escape:s=>s},
    window:{
      OCTienda:{licenciaActual:()=> 'F123-SYNT-BELEN'},
      OCSync:{catalogoPropio:()=>({ubicaciones:[]})},
      OCFotos:{leerPorHash:async()=>PHOTO,guardarFoto:async()=>true}
    },
    fotoCache:{},API:'/api',
    fetch:async (...args)=>{vaultCalls.push(args);return{ok:true}},
    alert:s=>vaultAlerts.push(s),cargar:()=>{},console
  };
  vm.runInNewContext(source.slice(vs,ve)+'\n  });',vm.createContext(vaultCtx));
  await clickHandler({target:{closest:()=>({dataset:{vaultRestore:B}})},stopPropagation:()=>{}});
  assert.equal(vaultCalls.length,0,'vault must not PUT photoHash without a verified preimage');
  assert.equal(vaultAlerts.length,1);
});
