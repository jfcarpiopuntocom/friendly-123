'use strict';
// v628 contract: FIFO only inside one tab; CAS guards cross-tab durable writes.
// Old 10-second Web Locks were removed intentionally. Do not reinstate them.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = src.indexOf('  let _colaEscriturasLocal = Promise.resolve();');
const end = src.indexOf('  const _fetchInterno = async function', start);
assert.ok(start >= 0 && end > start, 'actual production wrapper must be present');
const body = src.slice(start, end);

const post = {method:'POST',body:'{}'};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function fixture({ response, idb, locks } = {}) {
  let calls = 0, reloads = 0, roomApplies = 0, reads = 0;
  const ctx = {
    Promise, Response, URL, JSON,
    navigator: { locks: locks || { request() { throw Error('Web Locks were not authorized'); } } },
    _rolLocal: () => 'dueno', _negadoPorRol: () => null,
    _conflictoEstadoAB: null, _ventaPendiente: null, _payoutPendiente: null, _retencionPendiente: null,
    _ventaConfirmando: false, _payoutConfirmando: false, _retencionConfirmando: false,
    _estadoLecturaBloqueada: false, _guardadoCatalogoPendiente: null,
    _localRev: 5, _localRevReservado: 5, _estadoPublicableConfirmado: null,
    _huellaPublicable: () => 'synthetic confirmed',
    _recargarSiOtraPestanaEscribio: () => { reloads++; },
    validarRespaldo: b => b && Array.isArray(b.productos) && Array.isArray(b.ubicaciones) ? null : 'invalid',
    aplicarRespaldo: () => { roomApplies++; },
    _fetchInterno: async (url,opts) => { calls++; return response ? response(calls,url,opts) : new Response('{"ok":true}',{status:200}); },
    window: {
      location: {origin:'https://synthetic.example'}, OC_AUTH_SESSION_EPOCH: 0,
      OCTabSession: {isCurrent:()=>true}, OC_TAB_READONLY: false,
      OCEstadoIDB: idb || {soportado:true, async leer(){ reads++; return {_rev:5,productos:[],ubicaciones:[]}; }}
    }
  };
  const factory = vm.runInNewContext('(function(){'+body+';return _fetchConCandado;})', ctx);
  return {
    fetch: factory(), ctx,
    get calls(){return calls;}, get reloads(){return reloads;},
    get applies(){return roomApplies;}, get reads(){return reads;}
  };
}

test('success path does not request cross-tab Web Locks or timer',async()=>{
  let locks = 0;
  const f = fixture({locks:{request(){locks++;throw Error('slow zombie lock');}}});
  assert.equal((await f.fetch('/api/ventas',post)).status,200);
  assert.equal(f.calls,1);
  assert.equal(locks,0,'normal sale does not ask the browser for a global lock');
});

test('two same-tab writes execute FIFO, even if the first is awaiting durable ACK',async()=>{
  const first = deferred();
  const f = fixture({response:n => n===1 ? first.promise : new Response('{"ok":true}',{status:200})});
  const a=f.fetch('/api/ventas',post), b=f.fetch('/api/ventas',post);
  await tick();
  assert.equal(f.calls,1,'the second sale cannot begin before the first settles');
  first.resolve(new Response('{"ok":true}',{status:200}));
  assert.equal((await a).status,200);
  assert.equal((await b).status,200);
  assert.equal(f.calls,2);
});

test('queued sale fails closed when role or login epoch changes',async()=>{
  const first=deferred();
  const f=fixture({response:n=>n===1?first.promise:new Response('{"ok":true}',{status:200})});
  const a=f.fetch('/api/ventas',post), b=f.fetch('/api/ventas',post);
  await tick();
  f.ctx.window.OC_AUTH_SESSION_EPOCH=1;
  first.resolve(new Response('{}',{status:200}));
  assert.equal((await a).status,200);
  assert.equal((await b).status,403,'queued request is not authorized under the old login');
  assert.equal(f.calls,1);
});

test('read-only compatibility tab blocks writes, leaving state untouched',async()=>{
  const f=fixture();f.ctx.window.OC_TAB_READONLY=true;
  assert.equal((await f.fetch('/api/ventas',post)).status,409);
  assert.equal(f.calls,0);
});

test('conflicted physical A/B buffers block writes; reads remain available',async()=>{
  const f=fixture();f.ctx._conflictoEstadoAB={kind:'synthetic conflict'};
  assert.equal((await f.fetch('/api/ventas',post)).status,507);
  assert.equal(f.calls,0);
  assert.equal((await f.fetch('/api/productos',{method:'GET'})).status,200);
});

test('GET waits for a pending financial write rather than observing provisional state',async()=>{
  const guard=deferred(),f=fixture();f.ctx._ventaPendiente=guard.promise;
  let settled=false;
  const reading=f.fetch('/api/productos',{method:'GET'}).then(r=>{settled=true;return r;});
  await tick();
  assert.equal(settled,false);assert.equal(f.calls,0);
  guard.resolve();
  assert.equal((await reading).status,200);assert.equal(f.calls,1);
});

test('rejected CAS sale rebases only when durable revision is newer; retries once',async()=>{
  const f=fixture({
    idb:{soportado:true,leer:async()=>({_rev:6,productos:[],ubicaciones:[]})},
    response:n=>new Response('{}',{status:n===1?507:200})
  });
  assert.equal((await f.fetch('/api/productos/p1/venta',post)).status,200);
  assert.equal(f.calls,2);assert.equal(f.ctx._localRev,6);assert.equal(f.applies,1);
});

test('same-revision or quota failure cannot be reclassified as successful sale',async()=>{
  const f=fixture({response:()=>new Response('{}',{status:507})});
  assert.equal((await f.fetch('/api/productos/p1/venta',post)).status,507);
  assert.equal(f.calls,1);assert.equal(f.applies,0);
});

test('at most one replay: repeated 507 must remain an explicit failed sale',async()=>{
  const f=fixture({
    idb:{soportado:true,leer:async()=>({_rev:6,productos:[],ubicaciones:[]})},
    response:()=>new Response('{}',{status:507})
  });
  assert.equal((await f.fetch('/api/productos/p1/venta',post)).status,507);
  assert.equal(f.calls,2);assert.equal(f.applies,1);
});
