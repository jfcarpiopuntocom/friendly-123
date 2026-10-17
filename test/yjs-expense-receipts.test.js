const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const catalog = { gastos: [{ id: 'synthetic-expense', monto: 18, facturaFotoHash: 'synthetic-receipt' }] };
  const photo = 'data:image/jpeg;base64,c3ludGhldGlj';
  const blobs = new Map();
  const seeds = [];
  const context = {
    crypto: require('node:crypto').webcrypto, TextEncoder,
    API: { fotosCanal: {}, fotosDoc: {}, fotosMap: blobs },
    window: {
      OCSync: { catalogoPropio: () => catalog },
      // Exercise the legacy adapter without leerTodosPorHash, too.
      OCFotos: { leerPorHash: async hash => hash === 'synthetic-receipt' ? photo : null },
      Y: {
        Doc: class { constructor() { this.blobs = new Map(); } getMap() { return this.blobs; } destroy() {} },
        encodeStateAsUpdate: doc => Array.from(doc.blobs),
        applyUpdate: (_doc, update) => seeds.push(update),
      },
    },
  };
  vm.createContext(context);
  const seed = source.slice(source.indexOf('  var _fotosSembradas ='), source.indexOf('  /* SEMBRAR VENTAS'));
  const publish = source.slice(source.indexOf('  function publicarFotosLocales()'), source.indexOf('  // ===================================================================', source.indexOf('  function publicarFotosLocales()')));
  vm.runInContext(seed + publish, context);
  return { context, catalog, photo, blobs, seeds };
}

test('expense receipt references publish their blob separately and deduplicate repeat events', async () => {
  const f = fixture();
  const before = JSON.stringify(f.catalog);
  f.context.publicarFotosLocales();
  await tick();
  assert.equal(f.blobs.get('synthetic-receipt'), f.photo);
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
  assert.deepEqual(f.seeds[0], [['synthetic-receipt', f.photo]]);
  f.context.sembrarFotosAlRelay();
  await tick();
  assert.equal(f.seeds.length, 1, 'the existing session seed guard also covers receipts');
});
