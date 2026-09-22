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

function cargar() {
  const w = { console: { log() {}, warn() {}, error() {} } };
  w.window = w; w.globalThis = w; w.self = w;
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

test('a real one-way latency is measured across two devices with unsynced clocks', () => {
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
  assert.equal(r.n, 0, 'no entró al historial');
  assert.equal(r.descartadas, 1, 'pero queda contada: el descarte es visible, no silencioso');
});

test('the SLA verdict stays null until there are enough samples to mean anything', () => {
  const L = cargar();
  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 5, ahora + 10);

  for (let i = 0; i < 4; i++) L.anotarMuestra(L.ahoraRelay() - 100, 'catalogo');
  assert.equal(L.resumen().cumpleSLA, null, 'con 4 muestras un p95 no significa nada');

  L.anotarMuestra(L.ahoraRelay() - 100, 'catalogo');
  assert.equal(L.resumen().cumpleSLA, true, 'con 5 ya se puede opinar, y 100 ms cumple');
});

test('it reports a breach honestly instead of rounding it away', () => {
  const L = cargar();
  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 5, ahora + 10);

  for (let i = 0; i < 9; i++) L.anotarMuestra(L.ahoraRelay() - 200, 'catalogo');
  L.anotarMuestra(L.ahoraRelay() - 5000, 'catalogo'); // una de 5 s

  const r = L.resumen();
  assert.equal(r.n, 10);
  assert.ok(r.p95 > 2000, 'el p95 refleja la mala');
  assert.equal(r.cumpleSLA, false, 'y el veredicto dice NO se cumple, sin suavizarlo');
  assert.ok(r.max >= 5000);
});

test('the summary text never states a number it cannot back', () => {
  const L = cargar();
  assert.match(L.texto(), /sin reloj/, 'sin reloj lo dice');
  const ahora = Date.now();
  L.anotarPing(ahora, ahora + 5, ahora + 10);
  assert.match(L.texto(), /sin cambios medidos/, 'con reloj pero sin muestras, lo dice');
  L.anotarMuestra(L.ahoraRelay() - 300, 'catalogo');
  assert.match(L.texto(), /±/, 'y cuando da un número, viene con su margen');
});
