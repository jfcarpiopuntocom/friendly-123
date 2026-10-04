const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer() {
  const w = browser();
  delete w.JSON;
  Object.assign(w, {
    crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-GOLDEN-448' }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i=0; i<100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  return w;
}
function update(from,to,applyStore=true) {
  const u=from.Y.encodeStateAsUpdate(from.OCYjs.doc);
  to.Y.applyUpdate(to.OCYjs.doc,u,'red');
  if (applyStore) to.OCYjs._store.aplicar();
}
function legacyReseed(w, shelfId, mutate) {
  const original=w.OCSync.catalogoPropio.bind(w.OCSync);
  w.OCSync.catalogoPropio=()=>{
    const cat=original();
    const s=cat.ubicaciones.find(x=>x.id===shelfId);
    if (s) mutate(s);
    return cat;
  };
  try { w.OCYjs._store.sembrar(); }
  finally { w.OCSync.catalogoPropio=original; }
}

test('v448 golden RED Yjs: stale legacy reseed cannot erase an archived shelf state for a new third device', async () => {
  const a=await peer(), b=await peer(), c=await peer();
  const shelf=await a.request('/api/ubicaciones','POST',{nombre:'Yjs archive guard',tipo:'propio'});
  a.OCYjs._store.sembrar(); update(a,b,true);
  assert.equal((await b.request('/api/ubicaciones')).some(x=>x.id===shelf.id),true);

  await a.request('/api/ubicaciones/'+shelf.id+'/desactivar','POST');
  a.OCYjs._store.sembrar();

  // B receives modern Yjs state but behaves like a pre-hotfix app whose local
  // store has not applied it yet, then periodically re-seeds its stale catalog.
  update(a,b,false);
  assert.equal(b.OCYjs.mapas.ubicaciones.get(shelf.id).activa,false);
  assert.ok(b.OCYjs.mapas.ubicaciones.get(shelf.id).estadoRev);

  legacyReseed(b,shelf.id,(s)=>{
    s.activa=true; s.borrado=false; delete s.estadoRev;
    s.rev={c:999999,d:'legacy-stale'};
  });

  const canonical=b.OCYjs.mapas.ubicaciones.get(shelf.id);
  assert.equal(canonical.activa,false,'Yjs canonical record must keep the modern archived state');
  assert.ok(canonical.estadoRev,'legacy reseed must not strip lifecycle revision');

  update(b,c,true);
  assert.equal((await c.request('/api/ubicaciones')).some(x=>x.id===shelf.id),false,
    'a fresh third device must not see the archived shelf as active');
});

test('v448 golden RED Yjs: stale legacy reseed cannot erase current shelf fotoHash/fotoRev for a new device', async () => {
  const a=await peer(), b=await peer(), c=await peer();
  const shelf=await a.request('/api/ubicaciones','POST',{nombre:'Yjs photo guard',tipo:'propio'});
  a.OCYjs._store.sembrar(); update(a,b,true);

  await a.request('/api/ubicaciones/'+shelf.id,'PUT',{fotoHash:'hash-golden-current'});
  const state=(await a.request('/api/respaldo/exportar')).ubicaciones.find(x=>x.id===shelf.id);
  assert.equal(state.fotoHash,'hash-golden-current');
  assert.ok(state.fotoRev);
  a.OCYjs._store.sembrar();

  update(a,b,false);
  assert.equal(b.OCYjs.mapas.ubicaciones.get(shelf.id).fotoHash,'hash-golden-current');
  assert.ok(b.OCYjs.mapas.ubicaciones.get(shelf.id).fotoRev);

  legacyReseed(b,shelf.id,(s)=>{
    s.fotoHash=null; delete s.fotoRev;
    s.rev={c:999999,d:'legacy-stale-photo'};
  });

  const canonical=b.OCYjs.mapas.ubicaciones.get(shelf.id);
  assert.equal(canonical.fotoHash,'hash-golden-current','Yjs canonical pointer must survive legacy null');
  assert.ok(canonical.fotoRev,'legacy reseed must not strip photo revision');

  update(b,c,true);
  const fresh=(await c.request('/api/respaldo/exportar')).ubicaciones.find(x=>x.id===shelf.id);
  assert.equal(fresh.fotoHash,'hash-golden-current','fresh device must receive current photo pointer');
  assert.ok(fresh.fotoRev);
});
