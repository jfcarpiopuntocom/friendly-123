'use strict';
// v762 (QA limpia2, 13 nov 2026): a new device of a store whose history has a causal parent that NO device holds
// (an absent client) stays "recuperando" forever. With HEAD read and no pending struct touching PIN/role metadata
// (canal.accesoListo, v753) the PIN gate must not wait for the full history any more.
// Synthetic data only. Real Yjs bundle, real accesoSinPendientes/accesoListo of sync-yjs.js, real login region of
// auth-ui.js. Set F123_AUTH_SRC / F123_SYNC_SRC to run against another version (RED run on master 6b91590f).
// v764 (measured on limpia2 with a fresh browser): HEAD moved every ~46 s (other devices writing) and was only re-read
// after the 30 s+ replay backoff, so HEAD never equalled the cursor and headAcceso was never proven.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.join(__dirname, '../docs');
const syncSrc = fs.readFileSync(process.env.F123_SYNC_SRC || path.join(docs, 'sync-yjs.js'), 'utf8');
const authSrc = fs.readFileSync(process.env.F123_AUTH_SRC || path.join(docs, 'auth-ui.js'), 'utf8');
const w = {};
new Function('window', 'self', fs.readFileSync(path.join(docs, 'vendor/yjs-bundle.min.js'), 'utf8'))(w, w);
const Y = w.Y || globalThis.Y;

function cortar(nombre) {
  const i = syncSrc.indexOf('function ' + nombre + '(');
  assert.ok(i > 0, 'falta ' + nombre);
  let n = 0;
  for (let k = syncSrc.indexOf('{', i); k < syncSrc.length; k++) {
    if (syncSrc[k] === '{') n++; else if (syncSrc[k] === '}' && --n === 0) return syncSrc.slice(i, k + 1);
  }
}
const listoSrc = syncSrc.match(/canal\.accesoListo = function \(\) \{[^\n]*\};/)[0];
// Canal of a cold device that read the durable layer up to HEAD but cannot finish recovery.
function canalDe(doc, headAcceso) {
  const canal = { recuperando: true, headAcceso };
  new Function('Y', 'doc', 'canal', cortar('accesoSinPendientes') + '\n' + listoSrc)(Y, doc, canal);
  return canal;
}

// Long history from two sellers + one absent client whose ops never reached the relay. pins: optional pinsRol.
function tienda({ pins = null, pinPendiente = false } = {}) {
  const dueno = new Y.Doc(), a = new Y.Doc(), ausente = new Y.Doc(), ups = [];
  const propio = (u, o, doc, tr) => { if (tr.local) ups.push(u); }; // relay holds only each device's own ops
  dueno.on('update', propio); a.on('update', propio);
  if (pins) dueno.getMap('_meta').set('pinsRol', pins);
  for (let i = 0; i < 300; i++) (i % 2 ? a : dueno).getMap('productos').set('p' + i, { id: 'p' + i, stock: i });
  ausente.getArray('cola').insert(0, ['x']);                    // only the absent device ever had this
  Y.applyUpdate(a, Y.encodeStateAsUpdate(ausente));
  a.getArray('cola').insert(1, ['y']);                          // seller op whose parent nobody else has
  if (pinPendiente) {                                           // a PIN change that depends on the missing parent
    Y.applyUpdate(dueno, Y.encodeStateAsUpdate(ausente));
    dueno.getArray('cola').insert(0, ['z']);
    dueno.getMap('_meta').set('pinsRol', { owner: '777', emp: '260' });
  }
  const d = new Y.Doc();
  ups.forEach(u => Y.applyUpdate(d, u));
  assert.ok(d.store.pendingStructs, 'la tienda sintetica debe quedar con un padre faltante');
  return d;
}

const rStart = authSrc.indexOf('if(central==="wrong"&&rolHash==="dueno")');
const rEnd = authSrc.indexOf('if (rolHash === "dueno") {', rStart);
assert.ok(rStart > 0 && rEnd > rStart, 'login region not found');
const region = authSrc.slice(rStart, rEnd);
function login(doc, canal, { code = '789', rolHash = 'dueno', central = 'unconfigured', unido = true } = {}) {
  let msg = null;
  const meta = doc.getMap('_meta');
  const window = { OCTienda: { esUnida: () => unido }, OCYjs: { meta: { get: k => meta.get(k) }, canal } };
  const localStorage = { getItem: k => (k === 'f123_owned' ? JSON.stringify({ licenseCode: 'F123-SYNTHETICV762' }) : null) };
  const fn = new Function('rolHash', 'code', 'ACTIVATION_PIN', 'central', 'joinPendienteVivo', 'window', 'localStorage', 'error',
    region + '\nreturn "entra";');
  const r = fn(rolHash, code, '789', central, () => unido, window, localStorage, m => { msg = m; });
  return r === 'entra' && !msg ? 'entra' : 'rechaza: ' + msg;
}

test('tienda sin PIN propio, historial largo y un padre sin dueno: el aparato nuevo entra con HEAD leido', () => {
  const t0 = Date.now(), d = tienda(), canal = canalDe(d, true);
  assert.equal(canal.accesoListo(), true);
  assert.equal(login(d, canal), 'entra');
  assert.ok(Date.now() - t0 < 30000);
});
test('tienda con PIN propio ya integrado: dueno y empleado tienen sus credenciales sin esperar la historia', () => {
  const d = tienda({ pins: { owner: '555', emp: '260' } }), canal = canalDe(d, true);
  assert.equal(canal.accesoListo(), true);
  assert.deepEqual(d.getMap('_meta').get('pinsRol'), { owner: '555', emp: '260' });
  assert.equal(login(d, canal, { code: '555' }), 'entra');
  assert.equal(login(d, canal, { code: '260', rolHash: 'empleado' }), 'entra');
});
test('negativo: 789 no abre una tienda que ya tiene PIN propio', () => {
  const d = tienda({ pins: { owner: '555', emp: '260' } });
  assert.match(login(d, canalDe(d, true)), /^rechaza:/);
});
test('negativo: si la autoridad central conoce un PIN propio, 789 no abre', () => {
  const d = tienda();
  assert.match(login(d, canalDe(d, true), { central: 'wrong' }), /^rechaza:/);
});
test('negativo: sin HEAD leido el aparato sigue esperando', () => {
  const d = tienda();
  assert.match(login(d, canalDe(d, false)), /^rechaza: Your store's name and team PINs have not finished/);
});
test('negativo: con un cambio de PIN aun en cola, ni 789 ni el PIN anterior se aceptan', () => {
  const d = tienda({ pins: { owner: '555', emp: '260' }, pinPendiente: true }), canal = canalDe(d, true);
  assert.equal(canal.accesoListo(), false);
  assert.match(login(d, canal), /^rechaza:/);
});

// Real pull-page handler + procesarHead of sync-yjs.js (same harness as sync3-head-causal-gap.test.cjs).
function pull() {
  const start = syncSrc.indexOf('    function clavePendientes() {', syncSrc.indexOf('function crearCanal('));
  const end = syncSrc.indexOf('    function reprogramar() {', start);
  const sent = [], ws = { readyState: 1, send: m => sent.push(JSON.parse(m)) };
  const ctx = { ws, Promise, Number, Math, JSON, Object, Map, Array, Uint8Array, sent,
    doc: { store: { pendingStructs: { missing: new Map([[7, 9]]) } } }, partesEntrantes: {},
    canal: { ws, recuperando: true }, _pullCursorReady: Promise.resolve(),
    _pullCursor: { rev: 3, seq: 120 }, _appliedPullCursor: { rev: 3, seq: 120 }, _ultimoCursorLimpio: { rev: 3, seq: 120 },
    _replayUsed: 0, _replayKey: null, _tReplay: null, _soloMemoria: false, PULL_PAGE_SIZE: 64, nombre: 'catalogo',
    API: { _store: { aplicar() {} }, clave: {} }, setTimeout: () => 17, clearTimeout: () => {}, log() {},
    Y: { encodeStateVector: () => new Uint8Array([1]) }, _colaRecepcion: Promise.resolve(),
    pullEstado: { enCurso: true, fallos: 0, usarHead: true } };
  ctx.guardarPullCursor = async c => { ctx._pullCursor = { rev: c.rev, seq: c.seq }; };
  vm.createContext(ctx); vm.runInContext(syncSrc.slice(start, end), ctx);
  const s2 = syncSrc.indexOf('      ws.onmessage = function (ev) {', syncSrc.indexOf('function crearCanal('));
  vm.runInContext(syncSrc.slice(s2, syncSrc.indexOf('      _directReceive = function (buf) {', s2)), ctx);
  ctx.pagina = async (seq, more) => { ws.onmessage({ data: JSON.stringify({ k: 'pull-page', rev: 3, seq, more }) }); await ctx._colaRecepcion; await new Promise(r => setImmediate(r)); };
  return ctx;
}
test('v764: al leer la ultima pagina con un padre faltante se pregunta HEAD enseguida y queda probado el acceso', async () => {
  const c = pull();
  await c.pagina(150, false);
  assert.deepEqual(c.sent.map(x => x.k), ['head'], 'HEAD right after the last page, not after the 30 s+ replay backoff');
  await c.procesarHead(c.ws, c.pullEstado, { rev: 3, seq: 150 });
  assert.equal(c.canal.headAcceso, true);
  assert.equal(c.canal.recuperando, true, 'the missing parent still keeps full recovery open');
});
test('v764: sin cursor nuevo no se vuelve a preguntar HEAD (no satura el relay)', async () => {
  const c = pull();
  await c.pagina(150, false);
  await c.procesarHead(c.ws, c.pullEstado, { rev: 3, seq: 190 }); // another device wrote meanwhile
  await c.pagina(150, false);                                     // relay had nothing new for this cursor
  assert.deepEqual(c.sent.map(x => x.k), ['head', 'pull'], 'no second HEAD for the same cursor');
  assert.notEqual(c.canal.headAcceso, true, 'HEAD ahead of the cursor proves nothing');
  await c.pagina(190, false);                                     // new frames arrived: ask once more
  assert.deepEqual(c.sent.map(x => x.k), ['head', 'pull', 'head']);
});
