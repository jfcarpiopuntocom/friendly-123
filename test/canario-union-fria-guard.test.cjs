const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fakeRun(license, { joined = false, customOwnerPin = false, recoveringCatalog = false, diagFailsAfterJoin = false, missingYjs = false, localHydrationPending = false, idbUnsynced = false, pendingStructs = false, pendingDs = false, missingOwnerMetadata = false } = {}) {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  let now = 0, keypadClicks = 0, exitCode = null, diagnosticCalls = 0;
  const messages = [];
  const pad = {
    waitFor: async () => {},
    click: async () => { keypadClicks++; },
    isVisible: async () => true,
  };
  const page = {
    on() {},
    setDefaultTimeout() {},
    goto: async () => {},
    locator: () => ({ first: () => pad }),
    click: async () => {},
    fill: async () => {},
    evaluate: async (fn) => {
      if (joined && String(fn).includes('licenciaAdoptada:')) {
        diagnosticCalls++;
        if (diagFailsAfterJoin && diagnosticCalls >= 2) return { lecturaDiagnosticoFallida: true };
        return { licenciaAdoptada: true, syncCodeIgual: true, salaCorrecta: true, tieneDispositivo: true, tieneRoomYjs: !missingYjs, tieneCanalCatalogo: !missingYjs, tienePinOwnerNoFactory: customOwnerPin, tieneMetadatosPin: !missingOwnerMetadata, catalogoRecuperando: recoveringCatalog, hidratacionLocalPendiente: localHydrationPending, catalogoIdbSincronizado: !idbUnsynced, catalogoSinPendientesCausales: !(pendingStructs || pendingDs) };
      }
      return null; // Owner never authenticates: exercise login budget
    },
    waitForTimeout: async (ms) => { now += ms; },
    waitForFunction: async () => {},
  };
  const browser = { newPage: async () => page, close: async () => {} };
  const fakeProcess = {
    argv: ['node', 'scripts/canario-union-fria.cjs'],
    env: license === null ? {} : { F123_CANARIO_LICENCIA: license },
    exit(n) { exitCode = n; throw Object.assign(new Error('CANARY_EXIT'), { canaryExit: true }); },
  };
  const ctx = {
    require(name) { assert.equal(name, 'playwright'); return { chromium: { launch: async () => browser } }; },
    process: fakeProcess,
    console: { log: (...xs) => messages.push(xs.join(' ')), error: (...xs) => messages.push(xs.join(' ')) },
    Date: class FakeDate extends Date { static now() { return now; } },
    setTimeout: (f) => { f(); return 1; },
    clearTimeout() {},
  };
  try { await vm.runInNewContext(script, ctx, { filename: 'canario-union-fria.cjs', timeout: 4000 }); }
  catch (error) { if (!error?.canaryExit) throw error; }
  return { keypadClicks, exitCode, messages, now };
}

test('P0: no repetir el PIN si la tienda no autentica en el primer intento', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002');
  assert.ok(r.keypadClicks <= 6, 'máximo 6 pulsaciones incluyendo selector de unión; recibido: ' + r.keypadClicks);
  assert.equal(r.exitCode, 1, 'la recuperación fallida debe seguir dando rojo');
});

test('P0: sin licencia sintética el canario no puede salir verde', async () => {
  const r = await fakeRun(null);
  assert.notEqual(r.exitCode, 0, 'ausencia de licencia NO cuenta como canario aprobado');
  assert.ok(r.messages.some(m => /F123_CANARIO_LICENCIA/.test(m)), 'diagnóstico de configuración claro');
});

test('P0: tras adoptar licencia, introduce un solo PIN de propietario', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true });
  assert.equal(r.keypadClicks, 6, 'selector de unión y un único login');
  assert.equal(r.exitCode, 1, 'un PIN que no entra termina rojo');
  assert.ok(r.messages.some(m => /ACCESO:/.test(m)), 'informa etapa de acceso');
});

test('P0: si el PIN Owner observado no es factory, no probar 789', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, customOwnerPin: true });
  assert.equal(r.keypadClicks, 3, 'solo selector de unión, nunca tantear PIN incorrecto');
  assert.equal(r.exitCode, 1);
  assert.ok(r.messages.some(m => /F123_CANARIO_PIN/.test(m)), 'pide secreto sintético actualizado sin revelar PIN');
});

test('P0: no escribir PIN mientras catalogo de una tienda unida sigue recuperando', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, recoveringCatalog: true });
  assert.equal(r.keypadClicks, 3, 'unicamente 789 inicial para elegir Join; NO se intenta login durante recuperación');
  assert.equal(r.exitCode, 1, 'la recuperación no terminada da rojo explícito');
  assert.ok(r.messages.some(m => /RECUPERACION:/.test(m)), 'etapa real: recuperación');
});


test('P0: diagnóstico perdido tras adoptar licencia no permite intentar PIN', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, diagFailsAfterJoin: true });
  assert.equal(r.keypadClicks, 3, 'PIN no se introduce si el diagnóstico es ilegible');
  assert.equal(r.exitCode, 1);
  assert.ok(r.messages.some(m => /RECUPERACION:/.test(m)), 'debe clasificar RECUPERACION');
});

test('P0: sala Yjs ausente no se confunde con recuperación completa', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, missingYjs: true });
  assert.equal(r.keypadClicks, 3, 'PIN no se introduce sin canal cifrado');
  assert.equal(r.exitCode, 1);
  assert.ok(r.messages.some(m => /RECUPERACION:/.test(m)), 'debe clasificar RECUPERACION');
});

// Same local hydration criteria as sync-yjs.js; network readiness alone is insufficient.
for (const [escenario, flags] of [
  ['local IndexedDB hydration pending', { localHydrationPending: true }],
  ['IndexedDB has not reported synced', { idbUnsynced: true }],
  ['Yjs pendingStructs causal gap', { pendingStructs: true }],
  ['Yjs pendingDs causal gap', { pendingDs: true }]
]) {
  test('P0: no probar Owner PIN con ' + escenario, async () => {
    const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, ...flags });
    assert.equal(r.keypadClicks, 3, 'solo el PIN de selección de unión, sin login');
    assert.equal(r.exitCode, 1, 'la hidratación incompleta debe dar rojo');
    assert.ok(r.messages.some(m => /RECUPERACION:/.test(m)), 'clasifica la falla como recuperación');
  });
}

test('P0: no probar PIN factory si el catálogo está hidratado pero faltan metadatos Owner', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, missingOwnerMetadata: true });
  assert.equal(r.keypadClicks, 3, 'solo selector de unión; no tantear PIN sin prueba de credencial');
  assert.equal(r.exitCode, 1, 'un meta Owner ausente es recuperación incompleta');
  assert.ok(r.messages.some(m => /RECUPERACION:/.test(m)), 'diagnosticar la causa sin exponer PIN');
});

test('P0: diagnóstico causal sintético distingue pendientes sin publicar IDs de sala', async () => {
  const full = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = full.indexOf('const diagnostico = ');
  const end = full.indexOf('\n\n(async () => {', start);
  assert.ok(start > 0 && end > start, 'se usa la función real de diagnóstico');
  const licencia = 'SYNTHETIC-CANARY-ONLY';
  const y = {
    roomId: 'SENSITIVE-ROOM-NOT-FOR-LOGS',
    canal: { recuperando: true, pendientesRelay: 4, huerfanosHeredados: 2, ws: { readyState: 1, relayLayer: 'f123_relay_cupo_v1' } },
    doc: { store: { pendingStructs: { missing: new Map([[42, 1], [77, 3]]) }, pendingDs: {}, clients: new Map([[42, [{}, {}]], [77, [{}]]]) } },
    idb: { synced: true }, meta: { get: () => null, size: 0 },
    mapas: { productos: { size: 15 } }, fotosMap: { size: 10 },
    _diag: () => ({ recuperacionLocalPendiente: false })
  };
  const ctx = {
    window: { OCYjs: y, OCAuth: { rolActual: () => null } },
    localStorage: { getItem: key => key === 'f123_owned'
      ? JSON.stringify({ licenseCode: licencia, syncCode: licencia, instanceId: 'synthetic' })
      : key === 'f123_sync_room' ? JSON.stringify({ codigo: licencia }) : null },
    JSON
  };
  vm.runInNewContext(full.slice(start, end) + ';this.probe = diagnostico;', ctx);
  const r = await ctx.probe({ evaluate: async (fn, lic) => fn(lic) }, licencia);
  assert.equal(r.catalogoPendientesStructs, true);
  assert.equal(r.catalogoPendientesDs, true);
  assert.equal(r.catalogoPadresFaltantes, 2);
  assert.equal(r.catalogoClientesAplicados, 2, 'count Yjs client groups, not their IDs');
  assert.equal(r.catalogoEstructurasAplicadas, 3, 'count applied Yjs structs, never serialize content');
  assert.equal(r.catalogoPendientesOutbox, 4, 'catalog relay outbox count only');
  assert.equal(r.catalogoHuerfanos, 2, 'inherited orphan count only');
  assert.equal(r.catalogoTransporte, 'supabase');
  assert.equal(r.catalogoIdbSincronizado, true);
  const logged = JSON.stringify(r);
  assert.ok(!logged.includes(licencia) && !logged.includes(y.roomId) && !logged.includes('42'),
    'telemetría solo booleana, numérica o enum de capa; nunca licencia/room/IDs causales');
});
test('P0: cold-join emits bounded causal progress pulses before failing recovery (no credentials)', async () => {
  const license = 'F123-SECRET-SYNTHETIC-CANARY-ONLY';
  const r = await fakeRun(license, { joined: true, recoveringCatalog: true, pendingStructs: true });
  const pulses = r.messages.filter(m => m.startsWith('CANARIO_CAUSAL_PULSO: '));
  assert.ok(pulses.length >= 2 && pulses.length <= 6,
    'expect 2–6 bounded progress samples during a 20s recovery, got ' + pulses.length);
  const parsed = pulses.map(m => JSON.parse(m.slice('CANARIO_CAUSAL_PULSO: '.length)));
  assert.ok(parsed.every(p => Number.isFinite(p.segundos) && p.segundos >= 0),
    'elapsed seconds must be numeric, not a wall-clock identifier');
  assert.ok(parsed.every(p => p.catalogoRecuperando === true),
    'recovering status must remain explicit for each pulse');
  assert.ok(parsed.every(p => Number.isSafeInteger(p.estructurasYjsAplicadas) &&
    Number.isSafeInteger(p.clientesYjsAplicados) &&
    Number.isSafeInteger(p.outboxCatalogo) && Number.isSafeInteger(p.huerfanosCatalogo)),
    'each causal pulse must capture numeric applied-vs-pending progress, without any IDs');
  assert.ok(r.messages.some(m => m.includes('FALLA RECUPERACION:')),
    'a red cold-join cannot become green because progress was observed');
  assert.equal(r.keypadClicks, 3, 'never retry Owner PIN during incomplete recovery');
  assert.ok(r.messages.every(m => !m.includes(license) && !m.includes('SENSITIVE-ROOM')),
    'pulses must never expose license, room or PIN');
});
