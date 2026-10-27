const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const src = fs.readFileSync(require('node:path').join(__dirname, '../docs/avanzado-extra.js'), 'utf8');
const code = src.slice(src.indexOf('    const CAJA_MAX_SNAPSHOTS ='), src.indexOf('    function cajaPintarAlerta()'));
const hash = s => createHash('sha256').update(s).digest('hex');
const origin = (notebookId = 'F123-A') => ({ namespace: '', notebookId });
const key = o => 'f123_caja_snapshots::' + encodeURIComponent(JSON.stringify([o.namespace, o.notebookId]));
const data = (o = origin()) => ({ schemaVersion: 3, productos: [], ubicaciones: [], ventas: [], movimientos: [], clientes: [], promotoras: [], usuarios: [], gastos: [], _recuperacion: { ...o, completo: true, confirmado: true } });
const point = o => { const contenido = JSON.stringify({ fecha: '2026-10-27', datos: data(o) }); return { fecha: '2026-10-27', contenido, checksum: hash(contenido) }; };
function fixture(response = { ok: true, json: async () => data() }, role = 'dueno') {
  const disk = new Map(), requests = [], messages = [];
  const old = Array.from({ length: 7 }, () => point(origin()));
  disk.set('f123_caja_snapshots', JSON.stringify(old));
  disk.set(key(origin()), JSON.stringify(old));
  const w = { API: '/api', localStorage: { getItem: k => disk.get(k) ?? null, setItem: (k, v) => disk.set(k, v) },
    OCTienda: { cuadernoId: () => 'F123-A' }, OCAuth: { rolActual: () => role }, OCSecure: { hashTexto: async s => hash(s) },
    fetch: async (u, opts) => { requests.push({ u, opts }); return response; },
    msg: (...args) => messages.push(args), confirm: () => true, dispatchEvent() {}, CustomEvent: class {}, console };
  w.window = w;
  vm.createContext(w); vm.runInContext(code, w);
  return { w, disk, requests, messages, old: JSON.stringify(old) };
}
for (const [label, response] of [['HTTP error', { ok: false, json: async () => ({ error: 'unavailable' }) }],
  ['invalid JSON shape', { ok: true, json: async () => ({}) }], ['partial export', { ok: true, json: async () => ({ ...data(), parcial: true }) }]]) {
  test(`${label} never displaces healthy recovery points`, async () => {
    const f = fixture(response); await f.w.cajaGuardarPunto(false);
    assert.equal(f.disk.get('f123_caja_snapshots'), f.old);
    assert.equal(f.disk.get(key(origin())), f.old);
  });
}
test('employee timer cannot replace full recovery points with its restricted export', async () => {
  const f = fixture(undefined, 'empleado'); await f.w.cajaGuardarPunto(true);
  assert.equal(f.requests.length, 0); assert.equal(f.disk.get('f123_caja_snapshots'), f.old);
  assert.equal(f.disk.get(key(origin())), f.old);
});
test('capture requests confirmed complete data and preserves legacy bytes', async () => {
  const f = fixture(); await f.w.cajaGuardarPunto(false);
  assert.match(f.requests[0].u, /confirmado=1&completo=1/);
  assert.equal(f.disk.get('f123_caja_snapshots'), f.old);
  assert.equal(JSON.parse(f.disk.get(key(origin()))).length, 7);
});
test('rotation keeps its original anchor and latest recovery points', async () => {
  const f = fixture(); const initial = Array.from({ length: 7 }, (_, i) => ({ ...point(origin()), seq: i }));
  f.disk.set(key(origin()), JSON.stringify(initial));
  await f.w.cajaGuardarPunto(true);
  const kept = JSON.parse(f.disk.get(key(origin())));
  assert.deepEqual(kept[0], initial[0], 'independent anchor is not rotated away');
  assert.deepEqual(kept.slice(1, 6), initial.slice(2));
  assert.equal(kept.length, 7);
});
test('foreign recovery point cannot replace current notebook', async () => {
  const f = fixture(); const foreign = JSON.stringify([point(origin('F123-B'))]);
  f.disk.set('f123_caja_snapshots', foreign); f.disk.set(key(origin()), foreign);
  await f.w.cajaRestaurar(0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.disk.get('f123_caja_snapshots'), foreign);
});
test('legacy unknown-origin points are preserved without automatic restoration', async () => {
  const f = fixture(); const p = point(origin()); const body = JSON.parse(p.contenido); delete body.datos._recuperacion;
  p.contenido = JSON.stringify(body); p.checksum = hash(p.contenido);
  const legacy = JSON.stringify([p]); f.disk.set('f123_caja_snapshots', legacy); f.disk.delete(key(origin()));
  await f.w.cajaRestaurar(0); assert.equal(f.requests.length, 0);
  assert.equal(f.disk.get('f123_caja_snapshots'), legacy);
});
test('changing notebook during capture never writes the result into another notebook', async () => {
  const f = fixture({ ok: true, json: async () => { f.w.OCTienda.cuadernoId = () => 'F123-B'; return data(); } });
  await f.w.cajaGuardarPunto(true); assert.equal(f.disk.get(key(origin())), f.old);
  assert.equal(f.disk.has(key(origin('F123-B'))), false);
});

function photoHistory(points, scoped = true) {
  const view = fs.readFileSync(require('node:path').join(__dirname, '../docs/vista-perchas.js'), 'utf8');
  const start = view.indexOf('  async function historialFotosCheckpointsExacto()');
  const end = view.indexOf('\n  ', view.indexOf('\n  }', start) + 4);
  const w = { localStorage: { getItem: k => k === (scoped ? key(origin()) : 'f123_caja_snapshots') ? JSON.stringify(points) : null },
    OCTienda: { cuadernoId: () => 'F123-A' }, OCSecure: { hashTexto: async s => hash(s) } };
  w.window = w; vm.createContext(w);
  vm.runInContext('let _historialFotosCheckpointsPromise;\n' + view.slice(start, end), w);
  return w.historialFotosCheckpointsExacto();
}
const photoPoint = o => { const p = point(o); const body = JSON.parse(p.contenido);
  body.datos.ubicaciones = [{ id: 'cloned-shelf-id', fotoHash: 'photo-' + o.notebookId }];
  p.contenido = JSON.stringify(body); p.checksum = hash(p.contenido); return p; };
test('photo recovery ignores foreign notebook with cloned shelf IDs even inside current key', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(await photoHistory([photoPoint(origin('F123-B'))]))), {});
});
test('photo recovery preserves same-notebook exact shelf evidence', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(await photoHistory([photoPoint(origin())]))), { 'cloned-shelf-id': ['photo-F123-A'] });
});
test('photo recovery never guesses identity of global legacy evidence', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(await photoHistory([photoPoint(origin('F123-B'))], false))), {});
});
