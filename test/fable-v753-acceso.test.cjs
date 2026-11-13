// v753: a cold device that already read the durable layer up to HEAD and still
// misses one causal parent must receive the store's PIN/role metadata, unless a
// pending (not yet integrable) struct rewrites those same metadata.
// Synthetic data only. Runs the real source of docs/sync-yjs.js and docs/crypto-store.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const docs = path.join(__dirname, '../docs');
const src = fs.readFileSync(path.join(docs, 'sync-yjs.js'), 'utf8');
// Same realm as the test, so plain objects keep their constructor for Yjs.
const w = {};
new Function('window', 'self', fs.readFileSync(path.join(docs, 'vendor/yjs-bundle.min.js'), 'utf8'))(w, w);
const Y = w.Y || globalThis.Y;

function tienda() {
  // Three devices: owner writes PIN metadata, two sellers write a long history.
  const dueno = new Y.Doc(), a = new Y.Doc(), b = new Y.Doc(), ups = [];
  [dueno, a, b].forEach((d, i) => d.on('update', u => ups.push({ de: i, u })));
  dueno.getMap('_meta').set('pinsRol', { owner: '555', emp: '260', acct: '357' });
  for (let i = 0; i < 60; i++) (i % 2 ? a : b).getMap('productos').set('p' + i, { id: 'p' + i, stock: i });
  return { dueno, a, b, ups };
}
function nuevo(ups, saltar) {
  const d = new Y.Doc();
  ups.forEach((x, i) => { if (i !== saltar) Y.applyUpdate(d, x.u); });
  return d;
}
function cortar(nombre) {
  const i = src.indexOf('function ' + nombre + '(');
  assert.ok(i > 0, 'falta ' + nombre + ' en sync-yjs.js');
  let n = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') n++; else if (src[k] === '}' && --n === 0) return src.slice(i, k + 1); }
}
function accesoSinPendientes(doc) {
  return new Function('Y', 'doc', cortar('accesoSinPendientes') + ' return accesoSinPendientes();')(Y, doc);
}

test('historial largo con un padre faltante: el PIN ya integrado no depende del hueco', () => {
  const t = tienda();
  const hueco = t.ups.findIndex((x, i) => x.de === 1 && i > 10); // one seller op never reached the layer
  const d = nuevo(t.ups, hueco);
  assert.ok(d.store.pendingStructs, 'la tienda sintetica debe dejar un padre faltante');
  assert.strictEqual(d.getMap('_meta').get('pinsRol').owner, '555');
  assert.strictEqual(accesoSinPendientes(d), true);
});

test('si lo pendiente reescribe el PIN, el aparato espera (no adopta un PIN viejo)', () => {
  const t = tienda();
  const antes = t.ups.length;
  t.dueno.getMap('productos').set('x', { id: 'x' });                 // this op is the missing parent
  t.dueno.getMap('_meta').set('pinsRol', { owner: '777', emp: '260', acct: '357' });
  const d = nuevo(t.ups, antes);
  assert.ok(d.store.pendingStructs);
  // Yjs applies the rewrite's delete at once and keeps the new value pending: the device holds NO PIN metadata.
  assert.strictEqual(d.getMap('_meta').get('pinsRol'), undefined);
  assert.strictEqual(accesoSinPendientes(d), false);
});

test('primer PIN de la tienda pendiente: tampoco se da por listo', () => {
  const dueno = new Y.Doc(), ups = [];
  dueno.on('update', u => ups.push({ u }));
  dueno.getMap('productos').set('x', { id: 'x' });
  dueno.getMap('_meta').set('pinsRol', { owner: '555' });
  const d = nuevo(ups, 0);
  assert.ok(d.store.pendingStructs);
  assert.strictEqual(accesoSinPendientes(d), false);
});

test('aplicar() entrega pinsRol con HEAD leido y acceso completo, y lo retiene si no', () => {
  const m = src.match(/pinsRol: (API\.canal && API\.canal\.recuperando[^,]*?API\.meta\.get\("pinsRol"\) \|\| null)/);
  assert.ok(m, 'no se encontro la entrega de pinsRol en aplicar()');
  const entrega = canal => vm.runInNewContext(m[1], { API: { canal, meta: { get: () => ({ owner: '555' }) } } });
  assert.strictEqual(entrega({ recuperando: true, accesoListo: () => false }), null);
  assert.deepStrictEqual(entrega({ recuperando: true, accesoListo: () => true }), { owner: '555' });
  assert.deepStrictEqual(entrega({ recuperando: false }), { owner: '555' });
});

test('accesoListo exige HEAD de la capa durable; nunca basta con no tener pendientes', () => {
  const f = src.match(/canal\.accesoListo = function \(\) \{[^\n]*\};/);
  assert.ok(f, 'falta canal.accesoListo');
  const listo = (canal, sinPend) => { vm.runInNewContext(f[0], { canal, accesoSinPendientes: () => sinPend }); return canal.accesoListo(); };
  assert.strictEqual(listo({ recuperando: true }, true), false);
  assert.strictEqual(listo({ recuperando: true, headAcceso: true }, false), false);
  assert.strictEqual(listo({ recuperando: true, headAcceso: true }, true), true);
  assert.strictEqual(listo({ recuperando: false }, false), true);
});

test('instalarCredencialesDesdeSala acepta la misma prueba y conserva el resto de sus condiciones', () => {
  const cs = fs.readFileSync(path.join(docs, 'crypto-store.js'), 'utf8');
  const i = cs.indexOf('async function instalarCredencialesDesdeSala(');
  const cuerpo = cs.slice(i, cs.indexOf('const estado = estadoSecreto();', i));
  assert.match(cuerpo, /Y\.canal\.recuperando !== false && !\(typeof Y\.canal\.accesoListo === "function" && Y\.canal\.accesoListo\(\)\)/);
  assert.match(cuerpo, /String\(actual\.owner \|\| ""\) !== owner && confirmado !== owner/);
});
