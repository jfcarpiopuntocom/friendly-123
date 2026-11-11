const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fakeRun(license, { joined = false, customOwnerPin = false, recoveringCatalog = false, diagFailsAfterJoin = false, missingYjs = false, localHydrationPending = false, idbUnsynced = false, pendingStructs = false, pendingDs = false, missingOwnerMetadata = false, recoverAfterMs = null, progressEveryMs = null, repeatedPagesOnly = false } = {}) {
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
        const finished = recoverAfterMs !== null && now >= recoverAfterMs;
        const steps = progressEveryMs ? Math.floor(now / progressEveryMs) : 0;
        return { licenciaAdoptada: true, syncCodeIgual: true, salaCorrecta: true, tieneDispositivo: true, tieneRoomYjs: !missingYjs, tieneCanalCatalogo: !missingYjs, tienePinOwnerNoFactory: customOwnerPin,
          tieneMetadatosPin: !missingOwnerMetadata, catalogoRecuperando: recoveringCatalog && !finished, hidratacionLocalPendiente: localHydrationPending && !finished,
          catalogoIdbSincronizado: !idbUnsynced || finished, catalogoClientesAplicados: repeatedPagesOnly ? 0 : steps, catalogoEstructurasAplicadas: repeatedPagesOnly ? 0 : steps,
          pullAvances: repeatedPagesOnly ? 0 : steps, pullFrames: steps * 12, pullPaginas: steps, catalogoPadresFaltantes: pendingStructs && !finished ? 5 : 0,
          catalogoPendientesOutbox: 0, catalogoHuerfanos: 0,
          catalogoSinPendientesCausales: !(pendingStructs || pendingDs) || finished };
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
  const full = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8').replace(/\r\n/g, '\n');
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
  assert.ok(pulses.length >= 4 && pulses.length <= 8,
    'expect 4–8 bounded progress samples during a stalled recovery, got ' + pulses.length);
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

test('P0: recovery progressing past 30 seconds reaches the access gate, not a false timeout', async () => {
  const r = await fakeRun('SYNTHETIC-ONLY', {
    joined: true, recoveringCatalog: true, pendingStructs: true,
    recoverAfterMs: 52000, progressEveryMs: 2000
  });
  assert.ok(r.now >= 52000, 'readiness cannot be fabricated before causal recovery');
  assert.ok(r.messages.some(m => /"fase":"barreras-verificadas","estado":"completo"/.test(m)));
  assert.ok(!r.messages.some(m => /FALLA RECUPERACION:/.test(m)),
    'progressing recovery should not fail at an arbitrary 20/30 seconds');
  assert.ok(r.messages.some(m => /FALLA ACCESO:/.test(m)),
    'synthetic login still fails without a real authenticated Owner');
  assert.equal(r.keypadClicks, 6, 'single Owner PIN attempt only after all barriers');
});

test('P0: a nonprogressing catch-up stops after an inactivity segment, never enters PIN', async () => {
  const r = await fakeRun('SYNTHETIC-ONLY', { joined: true, recoveringCatalog: true, pendingStructs: true });
  assert.ok(r.now >= 45000 && r.now < 70000, 'idle failure must be based on no useful progress');
  assert.ok(r.messages.some(m => /sin avance comprobado/.test(m)));
  assert.equal(r.keypadClicks, 3);
});

test('P0: repeated pages alone are not evidence of progress or recovery', async () => {
  const r = await fakeRun('SYNTHETIC-ONLY', {
    joined: true, recoveringCatalog: true, pendingStructs: true,
    progressEveryMs: 2000, repeatedPagesOnly: true
  });
  assert.ok(r.now < 70000, 'duplicate encrypted frames cannot perpetually renew observation');
  assert.ok(r.messages.some(m => /sin avance comprobado/.test(m)));
  assert.equal(r.keypadClicks, 3);
});

test('P0: genuine continued progress cannot certify incomplete data, even at the CI budget', async () => {
  const r = await fakeRun('SYNTHETIC-ONLY', {
    joined: true, recoveringCatalog: true, pendingStructs: true, progressEveryMs: 2000
  });
  assert.ok(r.now >= 300000 && r.now < 320000);
  assert.ok(r.messages.some(m => /progreso incompleto al agotar presupuesto/.test(m)));
  assert.ok(!r.messages.some(m => /"estado":"completo"/.test(m)));
  assert.equal(r.keypadClicks, 3);
});

test('P0: passive pull observer counts bounded replay pages and cursor motion without exposing timestamps or room IDs', async () => {
  const full = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = full.indexOf('const observarPull = ');
  const end = full.indexOf('\nconst diagnostico = ', start);
  assert.ok(start > 0 && end > start, 'observer must be isolated and read-only before diagnostico');
  const listeners = [];
  const socket = { addEventListener: (name, handler) => { assert.equal(name, 'message'); listeners.push(handler); } };
  const context = { window: { OCYjs: { canal: { ws: socket } } }, JSON };
  vm.runInNewContext(full.slice(start, end) + '\n;this.observe = observarPull;', context);
  const page = { evaluate: async fn => fn() };
  assert.equal(await context.observe(page), true);
  assert.equal(await context.observe(page), true, 'repeat attach must not add duplicate listener');
  assert.equal(listeners.length, 1);
  const emit = payload => listeners[0]({ data: JSON.stringify(payload) });
  emit({ k: 'head-result', rev: 17, seq: 987654321, room: 'SECRET-ROOM' });
  emit({ k: 'pull-page', rev: 17, seq: 100, n: 12, more: true, room: 'SECRET-ROOM' });
  emit({ k: 'pull-page', rev: 17, seq: 100, n: 5, more: true });
  emit({ k: 'pull-page', rev: 17, seq: 200, n: 2, more: false });
  emit({ k: 'op', c: 'SECRET-CIPHERTEXT', id: 'SECRET-ID' });
  emit({ k: 'pull-page', seq: 201, n: -1, more: true });
  const { socket: attached, data } = context.window.__f123CanarioPull;
  assert.equal(attached, socket);
  assert.equal(data.paginas, 3);
  assert.equal(data.frames, 19);
  assert.equal(data.mas, 2);
  assert.equal(data.avances, 1);
  assert.equal(data.iguales, 1);
  assert.equal(data.heads, 1);
  assert.equal(data.ultimaMas, false);
  const report = JSON.stringify(data);
  for (const secret of ['SECRET-ROOM', 'SECRET-ID', 'SECRET-CIPHERTEXT', '987654321']) {
    assert.ok(!report.includes(secret), 'no raw relay record, timestamp, ciphertext or room in observer report');
  }
});

test('P0: read-only checkpoint probe reports existence without exposing revision, timestamp or room capability', async () => {
  const full = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = full.indexOf('const consultarCheckpoint = ');
  const end = full.indexOf('\n// Only safe booleans', start);
  assert.ok(start > 0 && end > start, 'checkpoint metadata probe must exist in synthetic canary');
  let reads = 0, rev = 0, seq = 123456789, fail = false;
  const syntheticRoom = 'a'.repeat(40);
  const privateUrl = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + syntheticRoom + '-y';
  // The REAL relay-selector returns an EventTarget wrapper WITHOUT ws.url.
  const ws = { relayLayer: 'f123_relay_cupo_fb_v1' };
  const ctx = {
    window: { OCYjs: { roomId: syntheticRoom, canal: { ws } },
      F123FirebaseRelay: { leerHead: async url => {
        assert.equal(url, privateUrl); reads++;
        if (fail) throw Error('SENSITIVE-ERROR-WITH-ROOM');
        return { rev, seq };
      } } },
    Promise, Number, setTimeout, clearTimeout
  };
  vm.runInNewContext(full.slice(start, end) + '\n;this.query = consultarCheckpoint;', ctx);
  const page = { evaluate: async fn => fn() };
  const absent = await ctx.query(page);
  assert.equal(absent.consultado, true);
  assert.equal(absent.checkpointExiste, false);
  assert.equal(absent.hayOperaciones, true);
  rev = 3;
  const present = await ctx.query(page);
  assert.equal(present.consultado, true);
  assert.equal(present.checkpointExiste, true);
  fail = true;
  const unknown = await ctx.query(page);
  assert.equal(unknown.consultado, false, 'failed GET must be unknown, never claim no checkpoint');
  assert.equal(unknown.checkpointExiste, null);
  assert.equal(reads, 3, 'exactly one read-only metadata request per probe');
  for (const result of [absent, present, unknown]) {
    const report = JSON.stringify(result);
    for (const secret of [privateUrl, 'SECRET-ROOM', 'SENSITIVE-ERROR', '123456789']) {
      assert.ok(!report.includes(secret), 'no capability, server cursor, timestamp or error details in outputs');
    }
  }
  ws.relayLayer = 'other-layer';
  const skipped = await ctx.query(page);
  assert.equal(skipped.consultado, false, 'probe must never cross relays');
  assert.equal(reads, 3);
});

test('P0: checkpoint cut age is a bounded category from metadata-only GET, never raw relay sequence', async () => {
  const full = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = full.indexOf('const consultarCheckpoint = ');
  const end = full.indexOf('\n// Only safe booleans', start);
  assert.ok(start > 0 && end > start);
  const room = 'b'.repeat(40);
  const roomUrl = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + room + '-y';
  let rev = 0, headSeq = 123456789, checkpointSeq = 0, badMetadata = false, metaReads = 0;
  const ctx = {
    window: { OCYjs: { roomId: room, canal: { ws: { relayLayer: 'f123_relay_cupo_fb_v1' } } },
      F123FirebaseRelay: { leerHead: async url => {
        assert.equal(url, roomUrl);
        return { rev, seq: headSeq };
      } } },
    fetch: async (url, opts) => {
      assert.equal(url, 'https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/' + room + '-y/k/3/s.json');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.credentials, 'omit');
      metaReads++;
      return badMetadata ? { ok: false } : { ok: true, json: async () => checkpointSeq };
    },
    Promise, Number, setTimeout, clearTimeout
  };
  vm.runInNewContext(full.slice(start, end) + '\n;this.query=consultarCheckpoint;', ctx);
  const page = { evaluate: async fn => fn() };
  const noCheckpoint = await ctx.query(page);
  assert.equal(noCheckpoint.corte, 'sin-checkpoint');
  assert.equal(metaReads, 0, 'no extra read when there is no checkpoint');
  rev = 3;
  const genesis = await ctx.query(page);
  assert.equal(genesis.corte, 'cursor-cero', 'a nonzero revision can still have genesis cut');
  checkpointSeq = 123456000;
  const recent = await ctx.query(page);
  assert.equal(recent.corte, 'menos-1min');
  checkpointSeq = 123000000;
  const old = await ctx.query(page);
  assert.equal(old.corte, '1min-1h');
  checkpointSeq = 123456789;
  const covered = await ctx.query(page);
  assert.equal(covered.corte, 'head-no-supera-checkpoint');
  badMetadata = true;
  const unknown = await ctx.query(page);
  assert.equal(unknown.consultado, true, 'HEAD remains confirmed despite secondary metadata failure');
  assert.equal(unknown.corte, 'desconocido', 'secondary failure never claims old checkpoint');
  assert.equal(metaReads, 5);
  for (const result of [noCheckpoint, genesis, recent, old, covered, unknown]) {
    const output = JSON.stringify(result);
    assert.ok(!output.includes(room) && !output.includes('123456789') &&
      !output.includes('123456000') && !output.includes('123000000'),
      'log only age class; no room capability or raw server cursor');
  }
});

test('P0 RED: cold-join reports only bounded budget and pause metadata for each known durable layer', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = src.indexOf('const diagnosticoPresupuesto = ');
  const end = src.indexOf('\nconst diagnostico = ', start);
  assert.ok(start >= 0 && end > start, 'must have real read-only budget probe before catalog diagnostics');
  const MiB = 1048576;
  const code = src.slice(start, end) + '\nthis.probe = diagnosticoPresupuesto;';
  let reads = 0;
  const ctx = {
    window: { F123Relay: { estadoCupo: () => [
      { capa: 'f123_relay_cupo_v1', up: MiB, down: 2*MiB, usable: true },
      { capa: 'f123_relay_cupo_fb_v1', up: MiB/2, down: 20*MiB, usable: false }
    ] } },
    localStorage: { getItem: key => {
      reads++;
      return key === 'f123_relay_cupo_v1'
        ? JSON.stringify({ dia: '2026-11-11', up: MiB, down: 2*MiB, pausaHasta: 0, room: 'SECRET-ROOM' })
        : JSON.stringify({ dia: '2026-11-11', up: MiB/2, down: 20*MiB, pausaHasta: 99999999, pin: 'SECRET-PIN' });
    } },
    Date: class FakeDate extends Date { static now() { return 50000; } },
    JSON, Number
  };
  vm.runInNewContext(code, ctx);
  const info = await ctx.probe({evaluate: async fn => fn()});
  assert.equal(reads, 2, 'only two fixed local budget keys, no room or credential scans');
  assert.equal(info.conocido, true);
  assert.equal(info.capas.length, 2);
  assert.equal(info.capas[0].capa, 'supabase');
  assert.equal(info.capas[0].bajadaMiB, 2);
  assert.equal(info.capas[0].enPausa, false);
  assert.equal(info.capas[1].capa, 'firebase');
  assert.equal(info.capas[1].bajadaMiB, 20);
  assert.equal(info.capas[1].limiteAlcanzado, true);
  assert.equal(info.capas[1].enPausa, true);
  assert.equal(info.capas[1].usable, false);
  const text = JSON.stringify(info);
  for (const secret of ['SECRET-ROOM','SECRET-PIN','2026-11-11','f123_relay_cupo']) {
    assert.ok(!text.includes(secret), 'only rounded numbers, flags and neutral layer names');
  }
});

test('P0 RED: missing or malformed budget cannot report false zero or a healthy relay', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = src.indexOf('const diagnosticoPresupuesto = ');
  const end = src.indexOf('\nconst diagnostico = ', start);
  assert.ok(start >= 0 && end > start, 'the real budget probe is required');
  const ctx = {
    window: { F123Relay: { estadoCupo: () => [
      { capa: 'f123_relay_cupo_v1', up: -1, down: NaN, usable: true }
    ] } },
    localStorage: { getItem: () => '{BROKEN-PRIVATE-STATE' },
    Date, JSON, Number
  };
  vm.runInNewContext(src.slice(start, end) + '\nthis.probe=diagnosticoPresupuesto;', ctx);
  const result = await ctx.probe({ evaluate: async fn => fn() });
  assert.equal(result.conocido, false);
  assert.ok(result.capas.every(x => x.bajadaMiB === null && x.enPausa === null));
  const report = JSON.stringify(result);
  assert.ok(!report.includes('BROKEN-PRIVATE-STATE'));
  assert.match(src, /CANARIO_CAPAS:/, 'the remote canary must print a bounded budget report on exit');
});

test('P0 RED: cold-join network probe classifies relay refusals without URLs or credentials', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  const start = source.indexOf('const crearObservadorRed = ');
  const end = source.indexOf('\n// Passive relay budget snapshot', start);
  assert.ok(start >= 0 && end > start, 'read-only network observer should have a standalone implementation');
  const ctx = { JSON, URL, Number };
  vm.runInNewContext(source.slice(start,end)+'\nthis.create = crearObservadorRed;',ctx);
  const obs = ctx.create();
  const req = (url, status) => ({url:()=>url,status:()=>status});
  obs.respuesta(req('https://uhvzdrlhmznxxelniizi.supabase.co/rest/v1/rpc/f123_relay_pull?room=SECRET-ROOM', 403));
  obs.respuesta(req('https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/SECRET-ROOM/k.json', 200));
  obs.respuesta(req('https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/SECRET-ROOM/k.json', 503));
  obs.fallida({url:()=> 'https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/SECRET-ROOM/o.json'});
  obs.respuesta(req('https://some-other-site.example/secret?code=SECRET-LICENSE', 429));
  const handlers = {};
  obs.socket({url:()=> 'wss://uhvzdrlhmznxxelniizi.supabase.co/realtime/v1/websocket?token=SECRET-TOKEN',
    on: (event, fn) => {handlers[event] = fn;}});
  handlers.close();
  const report=obs.resumen();
  assert.equal(report.supabase.rechazo403, 1);
  assert.equal(report.supabase.websocketCreado, 1);
  assert.equal(report.supabase.websocketCerrado, 1);
  assert.equal(report.firebase.ok2xx, 1);
  assert.equal(report.firebase.error5xx, 1);
  assert.equal(report.firebase.errorRed, 1);
  assert.equal(report.firebase.rechazo403, 0);
  const serialized=JSON.stringify(report);
  for (const secret of ['SECRET-ROOM','SECRET-LICENSE','SECRET-TOKEN','f123_relay_pull','firebaseio.com','supabase.co']) {
    assert.ok(!serialized.includes(secret), 'never print raw request paths, URLs or tokens');
  }
  assert.match(source, /CANARIO_RED:/, 'must log bounded network status counters at the end of the synthetic run');
});

test('P0 RED: unknown networks and malformed statuses never count as successful transport', () => {
  const source=fs.readFileSync(path.join(__dirname,'../scripts/canario-union-fria.cjs'),'utf8');
  const start=source.indexOf('const crearObservadorRed = ');
  const end=source.indexOf('\n// Passive relay budget snapshot',start);
  assert.ok(start>=0&&end>start);
  const ctx={JSON,URL,Number};vm.runInNewContext(source.slice(start,end)+'\nthis.create=crearObservadorRed;',ctx);
  const obs=ctx.create();
  obs.respuesta({url:()=> 'https://bad-domain.example/private',status:()=>200});
  obs.respuesta({url:()=> 'https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/a',status:()=>NaN});
  obs.fallida({url:()=> 'broken-url'});
  const r=obs.resumen();
  assert.equal(r.firebase.ok2xx,0);
  assert.equal(r.firebase.other,1);
  assert.equal(r.supabase.ok2xx,0);
  assert.ok(JSON.stringify(r).length < 2000, 'bounded counters only');
});
