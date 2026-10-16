/* sync-latencia.js — diagnóstico local, sin datos del negocio ni polling.
   El presupuesto vigente es 150 ms MAXIMO, no p95 de 2 segundos.
   La medición comprobable usa un único reloj monotónico del emisor: desde
   publicar un update Yjs hasta recibir el ACK de aplicación + render remoto.
   Incluye la vuelta del ACK: es una cota superior, NO latencia exacta de ida
   ni tiempo desde el clic del usuario. Solo cubre peers conocidos al enviar.
   k:"lat" y el reloj NTP legado siguen siendo diagnóstico de control; nunca
   certifican entrega/aplicación visible ni cuentan para el veredicto.
   Los límites siguientes acotan SOLO memoria diagnóstica, jamás datos sync. */
(function () {
  "use strict";

  var TOPE_MUESTRAS = 200;   // buffer circular: memoria acotada en un teléfono
  var TOPE_EDAD_MS = 10 * 60 * 1000; // una muestra de hace 10 min ya no describe el ahora
  var SLA_MS = 150;
  var MIN_MUESTRAS_VEREDICTO = 5;
  var RTT_MAX_MS = 30000;           // ida y vuelta de 30 s no describe nada util

  var muestras = [];      // { ms, etiqueta, en }
  var mejorPing = null;   // { rtt, desfase, en } — la de MENOR rtt
  var descartadas = 0;    // muestras tiradas por no tener reloj común (se reporta)
  var entregas = new Map();
  var confirmadas = [];
  var totalConfirmadas = 0;
  var maxConfirmado = null;
  var ultimaConfirmacion = null;
  var noVerificadas = 0;
  var TOPE_PEERS = 32;

  function monotono() {
    try {
      var n = window.performance && window.performance.now();
      return typeof n === "number" && isFinite(n) && n >= 0 ? n : null;
    } catch (_) { return null; }
  }
  function idValido(id) { return typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id); }
  function canalValido(canal) { return canal === "catalogo" || canal === "ops" || canal === "fotos"; }

  /* id/peers son identificadores aleatorios efímeros, nunca IDs del negocio.
     [] significa cobertura desconocida (peer antiguo, desconectado, etc.).
     No se reinicia el cronómetro al reintentar ni se convierte falta de ACK
     en éxito. Si se agota memoria, el descarte impide aprobar esta sesión. */
  function iniciarEntrega(id, canal, peers) {
    if (entregas.has(id)) return false;
    var ahora = monotono();
    if (!idValido(id) || !canalValido(canal) || !Array.isArray(peers) ||
        !peers.length || peers.length > TOPE_PEERS || !peers.every(idValido) ||
        new Set(peers).size !== peers.length || ahora === null || entregas.size >= TOPE_MUESTRAS) {
      noVerificadas++;
      return false;
    }
    entregas.set(id, { inicio: ahora, canal: canal, faltan: new Set(peers) });
    return true;
  }
  function confirmarEntrega(id, peer) {
    var entrega = entregas.get(id);
    if (!entrega || !entrega.faltan.has(peer)) return false;
    var ahora = monotono();
    if (ahora === null || ahora < entrega.inicio) { noVerificadas++; return false; }
    entrega.faltan.delete(peer);
    // El update termina cuando TODOS los peers esperados confirmaron.
    if (entrega.faltan.size) return true;
    var ms = ahora - entrega.inicio;
    entregas.delete(id);
    totalConfirmadas++;
    maxConfirmado = maxConfirmado === null ? ms : Math.max(maxConfirmado, ms);
    ultimaConfirmacion = ahora;
    confirmadas.push(ms);
    if (confirmadas.length > TOPE_MUESTRAS) confirmadas.shift();
    return true;
  }

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

  function resumenControl() {
    var v = vigentes();
    var ms = v.map(function (m) { return m.ms; }).sort(function (a, b) { return a - b; });
    return {
      n: ms.length, p50: percentil(ms, 50), p95: percentil(ms, 95),
      max: ms.length ? ms[ms.length - 1] : null,
      ultima: v.length ? v[v.length - 1].ms : null,
      margenMs: hayReloj() ? Math.round(mejorPing.rtt / 2) : null,
      rttMs: hayReloj() ? Math.round(mejorPing.rtt) : null,
      desfaseMs: hayReloj() ? Math.round(mejorPing.desfase) : null,
      descartadas: descartadas, medible: hayReloj(), cumpleSLA: null,
      alcance: "sonda de control; no acredita aplicación visible",
    };
  }

  function resumen() {
    var control = resumenControl();
    var ahora = monotono();
    var ms = confirmadas.slice().sort(function (a, b) { return a - b; });
    var fresca = ahora !== null && ultimaConfirmacion !== null &&
      ahora >= ultimaConfirmacion && ahora - ultimaConfirmacion <= TOPE_EDAD_MS;
    var vencidas = 0;
    entregas.forEach(function (e) { if (ahora !== null && ahora - e.inicio > SLA_MS) vencidas++; });
    var cumple = null;
    if (fresca && maxConfirmado > SLA_MS) cumple = false;
    else if (fresca && totalConfirmadas >= MIN_MUESTRAS_VEREDICTO && !entregas.size && !noVerificadas) cumple = true;
    return {
      n: totalConfirmadas, p50: percentil(ms, 50), p95: percentil(ms, 95),
      max: maxConfirmado, ultima: confirmadas.length ? confirmadas[confirmadas.length - 1] : null,
      muestrasPercentiles: ms.length,
      pendientes: entregas.size, vencidas: vencidas, noVerificadas: noVerificadas,
      medible: ahora !== null, vigente: fresca, cumpleSLA: cumple, objetivoMs: SLA_MS,
      alcance: "publicación Yjs → aplicación y render de peers conocidos → ACK; incluye vuelta",
      periodo: "desde reiniciar; máximo acumulado, percentiles de últimas 200 confirmaciones",
      // Compatibilidad de diagnóstico de reloj, separado de la entrega.
      margenMs: control.margenMs, rttMs: control.rttMs, desfaseMs: control.desfaseMs,
      descartadas: control.descartadas, control: control,
    };
  }

  function texto() {
    var r = resumen();
    if (!r.n) return "entrega visible: sin confirmaciones verificadas · objetivo máximo 150 ms";
    var estado = r.cumpleSLA === true ? "dentro del presupuesto medido" :
      r.cumpleSLA === false ? "presupuesto de confirmación excedido" : "sin veredicto";
    return "publicación → render remoto → ACK: máximo " + Math.ceil(r.max) +
      " ms (incluye vuelta) · " + r.n + " cambios · " + estado +
      " · pendientes " + r.pendientes + " · no verificadas " + r.noVerificadas;
  }

  /* DESVIO DE HORA (JFC 2026-09-30). Si el reloj del aparato esta corrido, las
     ventas quedan con fecha/hora equivocada y el orden entre aparatos se enreda.
     Aqui SOLO se detecta y se avisa: no se corrige ni se toca ningun dato guardado.
     Umbral 60 s por encima del margen de medicion (rtt/2): un desvio menor no
     cambia ninguna venta de dia ni de orden; uno mayor si. */
  var UMBRAL_DESVIO_MS = 60 * 1000;
  function desvioReloj() {
    if (!hayReloj()) return { medible: false, hayAviso: false, desfaseMs: null, minutos: 0, adelantado: false };
    var margen = mejorPing.rtt / 2;
    var abs = Math.abs(mejorPing.desfase);
    return {
      medible: true,
      hayAviso: abs - margen > UMBRAL_DESVIO_MS,
      desfaseMs: Math.round(mejorPing.desfase),
      minutos: abs / 60000,
      adelantado: mejorPing.desfase < 0, // relay atras de nosotros = nuestro reloj va adelantado
    };
  }

  function reiniciar() {
    muestras = []; mejorPing = null; descartadas = 0;
    entregas.clear(); confirmadas = []; totalConfirmadas = 0;
    maxConfirmado = null; ultimaConfirmacion = null; noVerificadas = 0;
  }

  window.OCLatencia = {
    /* SELLO DE RELOJ (JFC 2026-10-01, "worlds best practices, datos de miles de tiendas").
       Practica de sistemas distribuidos: no fiarse del reloj del aparato para el dato;
       guardar con cada venta CUANTO iba corrido, para poder corregir despues sin
       reescribir nada. Devuelve {} si no hay medicion fresca (nunca inventa). Campos
       NUEVOS y opcionales: una app vieja los ignora; la nueva los copia en import/export.
       relojDesfaseMs = hora del relay - hora del aparato (positivo = aparato atrasado).
       relojMargenMs  = incertidumbre de esa medicion (mitad de la ida y vuelta). */
    sello: function () {
      try {
        if (!hayReloj()) return {};
        return { relojDesfaseMs: Math.round(mejorPing.desfase), relojMargenMs: Math.round(mejorPing.rtt / 2) };
      } catch (_) { return {}; }
    },
    anotarPing: anotarPing, anotarMuestra: anotarMuestra, marcarOrigen: marcarOrigen,
    ahoraRelay: ahoraRelay, hayReloj: hayReloj, desvioReloj: desvioReloj, resumen: resumen, texto: texto, reiniciar: reiniciar,
    iniciarEntrega: iniciarEntrega, confirmarEntrega: confirmarEntrega, resumenControl: resumenControl,
    SLA_MS: SLA_MS,
  };
})();
