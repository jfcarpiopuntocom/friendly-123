/* sync-latencia.js — MEDIR el SLA de ≤2 s en vez de afirmarlo.
   (JFC 2026-09-22. Hasta hoy no existía UNA sola medición de latencia en todo
   el código: solo una línea que decía "connected / NOT connected". Es decir que
   la promesa de los 2 segundos no era falsa ni verdadera, era INDEMOSTRABLE.)

   ─────────────────────────────────────────────────────────────────────
   EL PROBLEMA DE FONDO: LOS RELOJES MIENTEN
   ─────────────────────────────────────────────────────────────────────
   La forma ingenua de medir esto es que el aparato A ponga su Date.now() en el
   cambio y que B reste su propio Date.now() al recibirlo. ESO NO SIRVE: el
   reloj del iPhone de Belén y el de la PC de JFC no están sincronizados. Pueden
   diferir segundos o minutos. Con eso saldrían latencias negativas, o de tres
   minutos, y ninguna sería real. Un número inventado es PEOR que no medir: da
   falsa confianza, que es justo lo que ya costó caro en este proyecto.

   ─────────────────────────────────────────────────────────────────────
   LA SOLUCIÓN: UN SOLO RELOJ DE REFERENCIA (el del relay)
   ─────────────────────────────────────────────────────────────────────
   El relay es el único punto por el que pasan los dos aparatos. Se estima el
   desfase de cada aparato contra el reloj del relay con el mismo intercambio
   que usa NTP:

       t0 = el aparato manda su hora        (reloj del aparato)
       t1 = el relay responde con la suya   (reloj del relay)
       t2 = el aparato recibe la respuesta  (reloj del aparato)

       rtt    = t2 - t0                  (ida y vuelta, medido con UN solo reloj)
       desfase = t1 - (t0 + t2) / 2      (cuánto adelanta el relay)

   Con el desfase, cada aparato traduce su hora local a "hora del relay", y ahí
   sí los dos hablan el mismo idioma: latencia = ahoraRelay() - marcaDeOrigen.

   HONESTIDAD DE LA MEDICIÓN: el supuesto de NTP es que la ida tarda lo mismo
   que la vuelta. Casi nunca es exacto, así que el error de una medición de una
   sola dirección está acotado por rtt/2. Por eso `resumen()` devuelve SIEMPRE
   el margen de error junto al número: "820 ms ±40" es una medición; "820 ms" a
   secas es una afirmación disfrazada de medición. Se usa la muestra de MENOR
   rtt (práctica estándar de NTP) porque es la de menor incertidumbre.

   ─────────────────────────────────────────────────────────────────────
   POR QUÉ ESTO NO PUEDE ROMPER EL SYNC
   ─────────────────────────────────────────────────────────────────────
   Este módulo NO toca el camino de datos de Yjs. No lee, no escribe y no
   modifica ni un byte del documento ni de las operaciones. Viaja por frames de
   control aparte (`k:"ts"` y `k:"lat"`), que un relay o un cliente viejo
   simplemente ignora. Si este archivo no cargara, el sync funciona igual: lo
   único que se pierde es el número. */
(function () {
  "use strict";

  var TOPE_MUESTRAS = 200;   // buffer circular: memoria acotada en un teléfono
  var TOPE_EDAD_MS = 10 * 60 * 1000; // una muestra de hace 10 min ya no describe el ahora
  /* LA PROMESA, con nombre. Es el numero mas importante del modulo y vivia
     anonimo dentro de un ternario. Si JFC endurece el SLA, se cambia aqui y
     en ningun otro lado. */
  var SLA_MS = 2000;
  var MIN_MUESTRAS_VEREDICTO = 5;   // con menos, un p95 es ruido: no se opina
  var RTT_MAX_MS = 30000;           // ida y vuelta de 30 s no describe nada util

  var muestras = [];      // { ms, etiqueta, en }
  var mejorPing = null;   // { rtt, desfase, en } — la de MENOR rtt
  var descartadas = 0;    // muestras tiradas por no tener reloj común (se reporta)

  /* Se queda con el ping de menor rtt porque es el de menor incertidumbre.
     Un ping viejo se deja caducar: el desfase de un reloj deriva con el tiempo
     y sobre todo salta cuando el sistema operativo lo re-sincroniza. */
  function anotarPing(t0, t1, t2) {
    if (![t0, t1, t2].every(function (v) { return typeof v === "number" && isFinite(v); })) return false;
    var rtt = t2 - t0;
    if (rtt < 0) return false;            // reloj corrido a mitad del intercambio
    if (rtt > RTT_MAX_MS) return false;
    var desfase = t1 - (t0 + t2) / 2;
    var ahora = Date.now();
    var caduco = mejorPing && (ahora - mejorPing.en) > TOPE_EDAD_MS;
    if (!mejorPing || caduco || rtt < mejorPing.rtt) mejorPing = { rtt: rtt, desfase: desfase, en: ahora };
    return true;
  }

  function hayReloj() { return !!mejorPing && (Date.now() - mejorPing.en) <= TOPE_EDAD_MS; }

  // Hora local traducida al reloj del relay. null = todavía no se puede medir.
  function ahoraRelay() { return hayReloj() ? Date.now() + mejorPing.desfase : null; }

  /* Marca de origen para un cambio que sale de ESTE aparato, ya en hora del
     relay. Si aún no hay reloj común se devuelve null y el cambio viaja SIN
     marca: preferimos no medir a medir mal. */
  function marcarOrigen() { return ahoraRelay(); }

  function anotarMuestra(marcaOrigen, etiqueta) {
    var ahora = ahoraRelay();
    if (ahora === null || typeof marcaOrigen !== "number" || !isFinite(marcaOrigen)) { descartadas++; return null; }
    var ms = ahora - marcaOrigen;
    /* Una latencia negativa es imposible físicamente: significa que el desfase
       está mal estimado (típicamente el reloj del sistema saltó). Se descarta
       y se cuenta, en vez de guardar un número bonito que mentiría. */
    if (ms < 0) { descartadas++; return null; }
    muestras.push({ ms: ms, etiqueta: etiqueta || "", en: Date.now() });
    if (muestras.length > TOPE_MUESTRAS) muestras.shift();
    return ms;
  }

  function percentil(ordenadas, p) {
    if (!ordenadas.length) return null;
    var i = Math.min(ordenadas.length - 1, Math.max(0, Math.ceil((p / 100) * ordenadas.length) - 1));
    return ordenadas[i];
  }

  function vigentes() {
    var corte = Date.now() - TOPE_EDAD_MS;
    return muestras.filter(function (m) { return m.en >= corte; });
  }

  /* El resumen dice SIEMPRE cuántas muestras lo sustentan y con qué margen.
     Un p95 de 2 muestras no es un p95, y quien lo lea debe poder notarlo. */
  function resumen() {
    var v = vigentes();
    var ms = v.map(function (m) { return m.ms; }).sort(function (a, b) { return a - b; });
    return {
      n: ms.length,
      p50: percentil(ms, 50),
      p95: percentil(ms, 95),
      max: ms.length ? ms[ms.length - 1] : null,
      ultima: v.length ? v[v.length - 1].ms : null,
      margenMs: hayReloj() ? Math.round(mejorPing.rtt / 2) : null, // error acotado de una sola dirección
      rttMs: hayReloj() ? Math.round(mejorPing.rtt) : null,
      desfaseMs: hayReloj() ? Math.round(mejorPing.desfase) : null,
      descartadas: descartadas,
      medible: hayReloj(),
      // El veredicto del SLA solo se emite con muestras suficientes; con pocas
      // se dice "sin datos" en vez de aprobar o reprobar a la ligera.
      cumpleSLA: ms.length >= MIN_MUESTRAS_VEREDICTO ? (percentil(ms, 95) <= SLA_MS) : null,
    };
  }

  function texto() {
    var r = resumen();
    if (!r.medible) return "latencia: sin reloj común todavía";
    if (!r.n) return "latencia: conectado, sin cambios medidos aún";
    return "latencia p50 " + Math.round(r.p50) + " ms · p95 " + Math.round(r.p95) +
           " ms ±" + r.margenMs + " (" + r.n + " muestras)";
  }

  function reiniciar() { muestras = []; mejorPing = null; descartadas = 0; }

  window.OCLatencia = {
    anotarPing: anotarPing, anotarMuestra: anotarMuestra, marcarOrigen: marcarOrigen,
    ahoraRelay: ahoraRelay, hayReloj: hayReloj, resumen: resumen, texto: texto, reiniciar: reiniciar,
    SLA_MS: SLA_MS,
  };
})();
