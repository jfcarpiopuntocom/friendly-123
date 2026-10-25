'use strict';
// E4 / 1AAA. Execute REAL estado-idb.js, guardarEstadoLocal(), _payoutDurable().
// No network, no actual client storage, no real payouts. Designed to fail (RED)
// on any false success or rejected payout later resurrected by a photo snapshot.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const idb = fs.readFileSync(path.join(root, 'docs/estado-idb.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'docs/mock-backend.js'), 'utf8');

function actualFragment(left, right) {
  const a = backend.indexOf(left);
  const b = backend.indexOf(right, a + left.length);
  assert.ok(a >= 0 && b > a, `production function boundaries moved: ${left}`);
  return backend.slice(a, b);
}
const mirror = actualFragment('  function _espejarEnIDB(', '  /* #3 (JFC');
const save = actualFragment('  function guardarEstadoLocal(exigirCompleto = false, preservarFotos = false) {', '  /* SOLO CONSOLA');
const payout = actualFragment('  async function _payoutDurable(accion, falloGuardado) {', '  /* mes opcional');
const rename = actualFragment('      if (path === "/api/instancia/nombre" && opts && opts.method === "POST") {', '      /* DIAGNOSTICO FORENSE DE RELOJ');
assert.match(backend, /hidratarFotosProductos\(\)/);
assert.match(backend, /if \(n\) \{ try \{ guardarEstadoLocal\(\); \} catch \(_\) \{\} try \{ window\.dispatchEvent/,
  'hydrated photos must be able to initiate background persistence');

function fixture(options = {}) {
  const timers = [];
  const disk = {current: null, writes: [], attempts: 0};
  const storage = new Map();
  const db = {
    transaction() {
      const tx = {};
      tx.objectStore = () => ({
        put(snapshot) {
          Promise.resolve().then(() => {
            if ((options.failCommits || []).includes(++disk.attempts)) {
              tx.error = Error('synthetic IDB transaction abort');
              tx.onabort?.();
              return;
            }
            disk.current = JSON.parse(JSON.stringify(snapshot));
            disk.writes.push({payouts: disk.current.payouts.map(p => p.id), photo: disk.current.photo});
            tx.oncomplete?.();
          });
        },
        get() {
          const request = {};
          Promise.resolve().then(() => {
            request.result = disk.current && JSON.parse(JSON.stringify(disk.current));
            request.onsuccess?.();
          });
          return request;
        },
        delete() {
          Promise.resolve().then(() => { disk.current = null; tx.oncomplete?.(); });
        },
      });
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const request = {result: db};
      Promise.resolve().then(() => request.onsuccess?.());
      return request;
    },
  };
  const win = {indexedDB,dispatchEvent() {}};
  const setFakeTimer = (fn, ms) => {
    const timer = {fn, ms};
    timers.push(timer);
    return timer;
  };
  const clearFakeTimer = timer => {
    const i = timers.indexOf(timer);
    if (i >= 0) timers.splice(i, 1);
  };
  // Execute the entire shipped IndexedDB module: not a rewritten version.
  new Function('window', 'indexedDB', 'navigator', 'setTimeout', 'clearTimeout', 'console', idb)(
    win, indexedDB, {}, setFakeTimer, clearFakeTimer, {error() {}});

  const ctx = {
    _guardadoEstrictoPendiente: null, _retencionPendiente: null, _rolLocal: () => 'dueno',
    window: win,
    localStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem(k, v) {
        if (String(k).startsWith('f123_estado_v4_')) throw Error('synthetic localStorage quota');
        storage.set(k, String(v));
      },
    },
    OC_STATE_PTR: 'f123_estado_v4_ptr', claveBuffer: x => 'f123_estado_v4_' + x,
    _localRev: 0, _localRevReservado: 0, payouts: [], gastos: [], movimientos: [], ventas: [], ajustesComision: [],
    selloUltimo: '', photo: null, nombreNegocio: 'Name A', nombreNegocioRev:1, nombreNegocioTs:12, _payoutConfirmando: false, _payoutPendiente: null,
    _payoutCatalogosPendientes: [],
    clonar: x => JSON.parse(JSON.stringify(x)),
    aplicarCatalogo() {}, avisarCatalogoCambiado() {},
    estadoActualExportable: () => ({
      payouts: JSON.parse(JSON.stringify(ctx.payouts)),
      photo: ctx.photo, nombreNegocio:ctx.nombreNegocio, movimientos: [], _rev: ctx._localRev,
    }),
    ocultarAvisoRecorte() {}, despejarAvisoMemoriaLlena() {}, _publicarAdminPins() {},
    avisoEspacioJusto() {}, avisoMemoriaLlena() {}, avisarCatalogoCambiado() {},
    J:(data,status)=>({status:status??200,...data}),CustomEvent:class{},Date,
  };
  // Reuse exact production function bodies and their lexical dependencies.
  new Function('ctx', `with(ctx){${mirror}\n${save}\n${payout}\nctx.save=guardarEstadoLocal;ctx.pay=_payoutDurable;}`)(ctx);
  ctx.rename = new Function('ctx','body',`with(ctx){${mirror}\n${save}\nconst path='/api/instancia/nombre',opts={method:'POST'}; return (async()=>{${rename}})();}`);
  const runner=ctx.rename;ctx.rename=body=>runner(ctx,body);
  const reopen = () => {
    const fresh = {indexedDB};
    new Function('window', 'indexedDB', 'navigator', 'setTimeout', 'clearTimeout', 'console', idb)(
      fresh, indexedDB, {}, setFakeTimer, clearFakeTimer, {error() {}});
    return fresh.OCEstadoIDB.leer();
  };
  return {ctx, disk, timers, reopen};
}

// Advance whichever local synthetic timers are actually scheduled. Tests assert
// durable outcomes, NOT that a particular batching algorithm or delay survives.
async function drain(f) {
  for (let cycle=0; cycle<9; cycle++) {
    for (let micro=0; micro<25; micro++) await Promise.resolve();
    while (f.timers.length) {
      const item=f.timers.shift();
      item.fn();
    }
  }
}

test('1AAA: payout acknowledged only after own commit; failed payout never resurrects from photo', async () => {
  const f=fixture();
  assert.equal(await f.ctx.save(true,true),true);
  assert.deepEqual(f.disk.current.payouts,[]);
  const pendingPayout=f.ctx.pay(()=>{
    f.ctx.payouts.push({id:'synthetic-payout-42',amount:42});
    return {ok:true,payouts:f.ctx.payouts.slice()};
  });
  let falseAck=false;
  const observed=pendingPayout.then(result=>{
    if (result.status !== 507 &&
      !f.disk.current?.payouts.some(x=>x.id==='synthetic-payout-42')) falseAck=true;
    return result;
  });
  f.ctx.photo='synthetic-photo-hash';
  const pendingPhoto=f.ctx.save();
  await drain(f);
  const [result]=await Promise.all([observed,pendingPhoto]);
  assert.equal(falseAck,false,'cannot ACK a payout before the actual durable commit');
  const present=f.disk.current.payouts.some(p=>p.id==='synthetic-payout-42');
  if (result.status===507) {
    assert.equal(f.ctx.payouts.length,0,'failed payout rolled back in RAM');
    assert.equal(present,false,'rejected payout resurrected after photo save');
  } else {
    assert.equal(result.ok,true);
    assert.equal(present,true,'acknowledged payout missing from disk');
  }
  assert.equal(f.disk.current.photo,'synthetic-photo-hash');
});

test('1AAA: owner rename acknowledged only after own commit; 507 cannot resurrect via photo', async () => {
  const f=fixture();
  assert.equal(await f.ctx.save(true,true),true);
  assert.equal(f.disk.current.nombreNegocio,'Name A');
  const pendingRename=f.ctx.rename({nombre:'Name B'});
  let falseAck=false;
  const observed=pendingRename.then(result=>{
    if(result.status===200 && f.disk.current?.nombreNegocio!=='Name B') falseAck=true;
    return result;
  });
  f.ctx.photo='synthetic-photo-C';
  const pendingPhoto=f.ctx.save();
  await drain(f);
  const [result]=await Promise.all([observed,pendingPhoto]);
  assert.equal(falseAck,false,'cannot ACK business name before durable commit');
  if(result.status===507) {
    assert.equal(f.ctx.nombreNegocio,'Name A','rejected rename rolled back in RAM');
    assert.equal(f.disk.current.nombreNegocio,'Name A','rejected rename revived on disk');
  } else {
    assert.equal(result.status,200);
    assert.equal(f.disk.current.nombreNegocio,'Name B');
  }
  assert.equal(f.disk.current.photo,'synthetic-photo-C');
});

for (const operation of ['payout', 'rename']) {
  test(`1AAA: aborted ${operation} stays rejected after background photo and fresh IDB reader`, async () => {
    const f = fixture({failCommits: [2]});
    assert.equal(await f.ctx.save(true, true), true);
    const pending = operation === 'payout' ? f.ctx.pay(() => {
      f.ctx.payouts.push({id:'synthetic-payout-42', amount:42});
      return {ok:true};
    }) : f.ctx.rename({nombre:'Rejected name B'});
    f.ctx.photo = 'photo-after-abort';
    const photo = f.ctx.save();
    await drain(f);
    const [result] = await Promise.all([pending, photo]);
    assert.equal(result.status, 507);
    assert.notEqual(result.ok, true);
    assert.deepEqual(f.ctx.payouts, []);
    assert.equal(f.ctx.nombreNegocio, 'Name A');
    const reopened = await f.reopen();
    assert.deepEqual(reopened.payouts, []);
    assert.equal(reopened.nombreNegocio, 'Name A');
    assert.equal(reopened.photo, 'photo-after-abort');
  });
}

test('IDB erase settles canceled batch and stays ordered with later writes', async () => {
  const f = fixture();
  assert.equal(await f.ctx.save(), true);
  f.ctx.photo = 'canceled-batch';
  const pending = f.ctx.save();
  const erased = f.ctx.window.OCEstadoIDB.borrar();
  assert.equal(await pending, false);
  assert.equal(await erased, true);
  assert.equal(await f.reopen(), null);
  const eraseAgain = f.ctx.window.OCEstadoIDB.borrar();
  f.ctx.photo = 'new-state-after-erase';
  const next = f.ctx.save(true, true);
  assert.equal(await eraseAgain, true);
  assert.equal(await next, true);
  assert.equal((await f.reopen()).photo, 'new-state-after-erase');
});
