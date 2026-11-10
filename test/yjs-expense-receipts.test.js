const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash}=require('node:crypto');
const photoHash = d => createHash('sha256').update(Buffer.from(d.split(',')[1],'base64')).digest('hex');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const photo = 'data:image/jpeg;base64,c3ludGhldGlj', hash = photoHash(photo);
  const catalog = { gastos: [{ id: 'synthetic-expense', monto: 18, facturaFotoHash: hash }] };
  const blobs = new Map();
  const seeds = [];
  const context = {
    crypto: require('node:crypto').webcrypto, TextEncoder, Uint8Array, atob, setTimeout, clearTimeout,
    // Production Y.Doc exposes on/off; the seed observes update events to
    // detect whether Y.applyUpdate actually produced a new durable change.
    API: { fotosCanal: {}, fotosDoc: {
      _listeners: new Map(),
      on(event, cb) { this._listeners.set(event, cb); },
      off(event, cb) { if (this._listeners.get(event) === cb) this._listeners.delete(event); },
      emit(event) { this._listeners.get(event)?.(); }
    }, fotosMap: blobs },
    window: {
      OCSync: { catalogoPropio: () => catalog },
      // Exercise the legacy adapter without leerTodosPorHash, too.
      OCFotos: { leerPorHash: async h => h === hash ? photo : null,
        hashDeDataUrl: async data => photoHash(data) },
      Y: {
        Doc: class { constructor() { this.blobs = new Map(); this.listeners = new Map(); } getMap() { return this.blobs; } on(name, fn) { this.listeners.set(name, fn); } off(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); } emit(name) { this.listeners.get(name)?.(); } destroy() {} },
        encodeStateAsUpdate: doc => Array.from(doc.blobs),
        applyUpdate: (doc, update) => { seeds.push(update); doc.emit?.("update"); },
      },
    },
  };
  vm.createContext(context);
  const seed = source.slice(source.indexOf('  var _fotosSembradas ='), source.indexOf('  /* SEMBRAR VENTAS'));
  const publish = source.slice(source.indexOf('  function publicarFotosLocales()'), source.indexOf('  // ===================================================================', source.indexOf('  function publicarFotosLocales()')));
  vm.runInContext(seed + publish, context);
  return { context, catalog, photo, hash, blobs, seeds };
}

test('expense receipt references publish their blob separately and deduplicate repeat events', async () => {
  const f = fixture();
  const before = JSON.stringify(f.catalog);
  f.context.publicarFotosLocales();
  await tick();
  assert.equal(f.blobs.get(f.hash), f.photo);
  f.context.publicarFotosLocales();
  await tick();
  assert.equal(f.blobs.size, 1);
  assert.equal(JSON.stringify(f.catalog), before, 'transaction data keeps only the photo hash');
});

test('reconnection seeds referenced expense receipts with the existing photo channel', async () => {
  const f = fixture();
  f.context.sembrarFotosAlRelay();
  for (let i=0;i<50 && !f.seeds.length;i++) await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(f.seeds.length, 1);
  assert.deepEqual(f.seeds[0], [[f.hash, f.photo]]);
  f.context.sembrarFotosAlRelay();
  await tick();
  assert.equal(f.seeds.length, 1, 'the existing session seed guard also covers receipts');
});
