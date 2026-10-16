/* Pruebas de la medición de latencia (JFC 2026-09-22).

   Lo que se protege aquí NO es que el sync sea rápido — eso se mide en la
   calle. Es que el NÚMERO NO MIENTA. Una medición equivocada es peor que no
   medir: da falsa confianza, que es exactamente lo que ya costó caro en este
   proyecto ("lo di por arreglado y no lo estaba").

   El riesgo concreto: los relojes de dos aparatos NO están sincronizados. Si
   el iPhone va 3 minutos adelantado respecto a la PC, una resta ingenua de
   Date.now() daría latencias absurdas o negativas. Por eso todo se ancla al
   reloj del relay con un intercambio estilo NTP, y estas pruebas verifican que
   esa corrección de verdad funcione — incluso con relojes muy descuadrados. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function cargar(reloj, horaSistema) {
  const w = { console: { log() {}, warn() {}, error() {} } };
  w.window = w; w.globalThis = w; w.self = w;
  if (reloj) w.performance = { now: reloj };
  if (horaSistema) w.Date = class extends Date { static now() { return horaSistema(); } };
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sync-latencia.js'), 'utf8'), w);
  return w.OCLatencia;
}

test('with no clock exchange yet, it refuses to measure instead of inventing a number', () => {
  const L = cargar();
  assert.equal(L.hayReloj(), false);
  assert.equal(L.ahoraRelay(), null);
  assert.equal(L.marcarOrigen(), null, 'un cambio sale SIN marca antes que con una marca falsa');
  assert.equal(L.anotarMuestra(12345, 'catalogo'), null, 'no se guarda una muestra sin reloj común');

  const r = L.resumen();
  assert.equal(r.medible, false);
  assert.equal(r.n, 0);
  assert.equal(r.cumpleSLA, null, 'sin datos NO se aprueba ni se reprueba el SLA');
});

test('the NTP-style exchange recovers the offset of a badly wrong clock', () => {
  const L = cargar();
  // Aparato con el reloj 3 MINUTOS atrasado respecto al relay, y 100 ms de RTT.
  // Este es el caso que rompe la resta ingenua de Date.now().
  const desfaseReal = 180000;
  const t0 = 1_000_000;            // reloj del aparato al enviar
  const t1 = t0 + desfaseReal + 50; // reloj del RELAY al responder (50 ms de ida)
  const t2 = t0 + 100;             // reloj del aparato al recibir

  assert.equal(L.anotarPing(t0, t1, t2), true);
  const r = L.resumen();
  assert.equal(r.rttMs, 100);
  assert.equal(r.desfaseMs, desfaseReal, 'recupera el desfase exacto cuando ida y vuelta son simétricas');
  assert.equal(r.margenMs, 50, 'y declara su margen de error: rtt/2, no se lo calla');
});

test('it keeps the lowest-RTT sample, because that is the least uncertain one', () => {
  const L = cargar();
  L.anotarPing(1000, 1000 + 400, 1800);  // rtt 800 — muy incierta
  assert.equal(L.resumen().rttMs, 800);
  L.anotarPing(2000, 2000 + 20, 2040);   // rtt 40 — mucho mejor
  assert.equal(L.resumen().rttMs, 40, 'se queda con la mejor');
  L.anotarPing(3000, 3000 + 500, 4000);  // rtt 1000 — peor: NO debe reemplazar
  assert.equal(L.resumen().rttMs, 40, 'una muestra peor no degrada la estimación');
});

test('absurd exchanges are rejected rather than poisoning the estimate', () => {
  const L = cargar();
  assert.equal(L.anotarPing(5000, 5000, 4000), false, 'rtt negativo (el reloj saltó a mitad)');
  assert.equal(L.anotarPing(0, 10, 60000), false, 'rtt de 60 s no describe nada útil');
  assert.equal(L.anotarPing('x', 1, 2), false, 'basura no numérica');
  assert.equal(L.hayReloj(), false, 'ninguna de las tres contaminó el estado');
});

test('the legacy control probe estimates arrival against the relay clock without certifying delivery', () => {
  const L = cargar();
  const ahora = Date.now();
  // Receptor con el reloj 90 s ADELANTADO respecto al relay.
  const desfaseReceptor = -90000; // relay - aparato
  L.anotarPing(ahora, ahora + desfaseReceptor + 10, ahora + 20);

  // El emisor (otro aparato, con OTRO desfase cualquiera) marcó su cambio en
  // hora del relay. El receptor lo recibe 800 ms después en hora del relay.
  const marcaOrigen = L.ahoraRelay() - 800;
  const ms = L.anotarMuestra(marcaOrigen, 'catalogo');

  assert.ok(ms >= 780 && ms <= 820, `latencia ~800 ms pese al desfase de 90 s, dio ${ms}`);
});

test('an impossible negative latency is discarded and counted, never stored', () => {
  const L = cargar();
  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 5, ahora + 10);

  // Marca de origen "en el futuro": pasa cuando el desfase quedó mal estimado
  // porque el sistema operativo re-sincronizó el reloj. Guardar esto daría un
  // número bonito y falso.
  assert.equal(L.anotarMuestra(L.ahoraRelay() + 5000, 'catalogo'), null);
  const r = L.resumen();
  assert.equal(L.resumenControl().n, 0, 'no entró al historial de control');
  assert.equal(r.descartadas, 1, 'pero queda contada: el descarte es visible, no silencioso');
});

test('control probes never certify applied and rendered delivery, even with enough fast samples', () => {
  const L = cargar();
  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 5, ahora + 10);
  for (let i = 0; i < 40; i++) L.anotarMuestra(L.ahoraRelay() - 100, 'catalogo');
  L.anotarMuestra(L.ahoraRelay() - 5000, 'catalogo');
  assert.equal(L.resumen().n, 0);
  assert.equal(L.resumen().cumpleSLA, null);
  assert.equal(L.resumenControl().n, 41);
  assert.equal(L.resumenControl().cumpleSLA, null);
});

function entrega(L, reloj, id, ms, peers = ['peer-a']) {
  assert.equal(L.iniciarEntrega(id, 'catalogo', peers), true);
  reloj.ms += ms;
  peers.forEach(peer => assert.equal(L.confirmarEntrega(id, peer), true));
}

test('uses sender monotonic confirmation bound, all expected peers, and exact 150 ms limit', () => {
  const reloj = { ms: 0 };
  const L = cargar(() => reloj.ms);
  for (let i = 0; i < 4; i++) entrega(L, reloj, 'change-' + i, 150);
  assert.equal(L.resumen().cumpleSLA, null);
  assert.equal(L.iniciarEntrega('last', 'catalogo', ['peer-a', 'peer-b']), true);
  reloj.ms += 100;
  assert.equal(L.confirmarEntrega('last', 'peer-a'), true);
  assert.equal(L.resumen().cumpleSLA, null, 'a fast first peer cannot stand in for the second');
  assert.equal(L.confirmarEntrega('last', 'peer-a'), false, 'duplicate ACK is ignored');
  assert.equal(L.confirmarEntrega('last', 'stranger'), false, 'unlisted peer is ignored');
  reloj.ms += 50;
  assert.equal(L.confirmarEntrega('last', 'peer-b'), true);
  assert.equal(L.resumen().cumpleSLA, true);
  assert.equal(L.resumen().max, 150);
  assert.equal(L.resumen().n, 5);
  assert.equal(L.hayReloj(), false, 'no remote clock estimate is needed');
  entrega(L, reloj, 'over', 150.01);
  assert.equal(L.resumen().cumpleSLA, false, 'never rounds 150.01 down to a pass');
});

test('wall-clock jumps cannot shorten delivery and invalid monotonic readings cannot pass', () => {
  const reloj = { ms: 0, pared: 100000 };
  const L = cargar(() => reloj.ms, () => reloj.pared);
  assert.equal(L.iniciarEntrega('clock', 'ops', ['peer']), true);
  reloj.pared -= 90000;
  reloj.ms += 5000;
  assert.equal(L.confirmarEntrega('clock', 'peer'), true);
  assert.equal(L.resumen().max, 5000);
  assert.equal(L.resumen().cumpleSLA, false);
  reloj.ms = NaN;
  assert.equal(L.iniciarEntrega('invalid-time', 'ops', ['peer']), false);
  assert.equal(L.resumen().cumpleSLA, null);
});

test('one 5-second outlier fails despite a fast p95 and remains visible after sample eviction', () => {
  const reloj = { ms: 0 };
  const L = cargar(() => reloj.ms);
  entrega(L, reloj, 'slow', 5000);
  for (let i = 0; i < 220; i++) entrega(L, reloj, 'fast-' + i, 100);
  const r = L.resumen();
  assert.equal(r.p95, 100);
  assert.equal(r.max, 5000);
  assert.equal(r.cumpleSLA, false);
  assert.equal(r.n, 221);
  assert.equal(r.muestrasPercentiles, 200);
});

test('pending, late, unsupported and stale delivery cannot turn into a pass', () => {
  const reloj = { ms: 0 };
  const L = cargar(() => reloj.ms);
  for (let i = 0; i < 5; i++) entrega(L, reloj, 'fast-' + i, 100);
  assert.equal(L.iniciarEntrega('pending', 'ops', ['peer-a']), true);
  reloj.ms += 1000;
  assert.equal(L.resumen().cumpleSLA, null);
  assert.equal(L.resumen().vencidas, 1);
  assert.equal(L.confirmarEntrega('pending', 'peer-a'), true);
  assert.equal(L.resumen().max, 1000, 'late ACK counts instead of being thrown away');
  assert.equal(L.resumen().cumpleSLA, false);
  reloj.ms += 600001;
  assert.equal(L.resumen().cumpleSLA, null, 'old evidence does not certify current performance');
  L.reiniciar();
  assert.equal(L.iniciarEntrega('unsupported', 'fotos', []), false);
  for (let i = 0; i < 5; i++) entrega(L, reloj, 'new-' + i, 100);
  assert.equal(L.resumen().cumpleSLA, null, 'five supported deliveries do not hide unsupported delivery');
  assert.equal(L.resumen().noVerificadas, 1);
});

test('memory pressure, unavailable/invalid monotonic clocks and invalid peer coverage stay unverified', () => {
  const reloj = { ms: 0 };
  const L = cargar(() => reloj.ms);
  for (let i = 0; i < 200; i++) assert.equal(L.iniciarEntrega('pending-' + i, 'ops', ['peer-a']), true);
  assert.equal(L.iniciarEntrega('overflow', 'ops', ['peer-a']), false);
  reloj.ms = 100;
  for (let i = 0; i < 200; i++) L.confirmarEntrega('pending-' + i, 'peer-a');
  assert.equal(L.resumen().cumpleSLA, null, 'dropping telemetry cannot hide an unverified update');
  assert.equal(L.resumen().pendientes, 0);
  assert.equal(L.resumen().noVerificadas, 1);
  assert.equal(cargar().iniciarEntrega('no-clock', 'catalogo', ['peer']), false);
  assert.equal(L.iniciarEntrega('duplicates', 'ops', ['peer', 'peer']), false);
  assert.equal(L.iniciarEntrega('unbounded', 'ops', Array.from({ length: 33 }, (_, i) => 'peer-' + i)), false);
  assert.equal(L.iniciarEntrega('invalid', 'business-name', ['peer']), false);
  assert.equal(L.iniciarEntrega('clock-backwards', 'ops', ['peer']), true);
  reloj.ms = 10;
  assert.equal(L.confirmarEntrega('clock-backwards', 'peer'), false);
  assert.equal(L.resumen().cumpleSLA, null);
});

test('retry does not reset the clock and control probes cannot dilute a slow delivery', () => {
  const reloj = { ms: 0 };
  const L = cargar(() => reloj.ms);
  L.iniciarEntrega('retry', 'catalogo', ['peer']);
  reloj.ms = 4999;
  assert.equal(L.iniciarEntrega('retry', 'catalogo', ['peer']), false);
  reloj.ms = 5000;
  L.confirmarEntrega('retry', 'peer');
  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 5, ahora + 10);
  for (let i = 0; i < 200; i++) L.anotarMuestra(L.ahoraRelay() - 1, 'catalogo');
  assert.equal(L.resumen().n, 1);
  assert.equal(L.resumen().max, 5000);
  assert.equal(L.resumen().cumpleSLA, false);
  assert.match(L.texto(), /incluye vuelta/);
  assert.match(L.texto(), /excedido/);
});

test('summary text labels the actual measured boundary and absence of verified delivery', () => {
  const reloj = { ms: 0 };
  const L = cargar(() => reloj.ms);
  assert.match(L.texto(), /sin confirmaciones verificadas/);
  entrega(L, reloj, 'visible', 100);
  assert.match(L.texto(), /render remoto/);
  assert.match(L.texto(), /incluye vuelta/);
  assert.match(L.texto(), /sin veredicto/);
});

test('structural cost guard: the clock ping is never on a timer', () => {
  /* GUARD ESTRUCTURAL, rotulado como tal: no prueba comportamiento, prueba la
     AUSENCIA de un temporizador — que es justo lo que era el bug de v335. Aquí
     un chequeo de fuente es la herramienta correcta, porque el defecto no es
     un resultado equivocado sino una estructura que cuesta plata.
     La v335 hacía ping cada 60 s en los TRES canales; el relay usa WebSocket
     Hibernation y cada mensaje lo despierta: 3 despertares/min/aparato en
     reposo. El ping ahora sale una vez al conectar y luego solo por actividad. */
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'docs', 'sync-yjs.js'), 'utf8');
  const bloquesPing = src.split('\n').filter(l => /k:\s*"ts"/.test(l));
  assert.ok(bloquesPing.length >= 1, 'el ping existe');
  assert.doesNotMatch(src, /_tPing/, 'no quedó el temporizador de ping por canal');
  // Ningún setInterval puede enviar un ping de reloj.
  const conIntervalo = src.match(/setInterval\([\s\S]{0,400}?\}\s*,\s*\d+\)/g) || [];
  assert.ok(!conIntervalo.some(b => /k:\s*"ts"/.test(b)), 'ningún setInterval envía k:"ts"');
});

/* Aviso de desvio de hora (JFC 2026-09-30, "mejores practicas: primero detectar y avisar,
   sin tocar datos"). Solo avisa; nunca corrige marcas de tiempo guardadas. */
test('desvioReloj: warns only when the device clock is really off, never before there is a clock', () => {
  const L = cargar();
  assert.equal(L.desvioReloj().hayAviso, false, 'sin reloj comun no se avisa ni se inventa un desvio');
  assert.equal(L.desvioReloj().medible, false);

  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 10 + 4 * 60 * 1000, ahora + 20); // relay 4 min adelante, rtt 20 ms
  const d = L.desvioReloj();
  assert.equal(d.medible, true);
  assert.equal(d.hayAviso, true);
  assert.equal(d.adelantado, false, 'el aparato va ATRASADO respecto al relay');
  assert.ok(Math.abs(d.minutos - 4) < 0.1);

  const L2 = cargar();
  const a2 = Date.now();
  L2.anotarPing(a2, a2 + 10 + 20 * 1000, a2 + 20); // 20 s: dentro de lo tolerable
  assert.equal(L2.desvioReloj().hayAviso, false);

  const L3 = cargar();
  const a3 = Date.now();
  L3.anotarPing(a3, a3 + 10 - 3 * 60 * 1000, a3 + 20); // relay 3 min atras => aparato ADELANTADO
  const d3 = L3.desvioReloj();
  assert.equal(d3.hayAviso, true);
  assert.equal(d3.adelantado, true);
});
