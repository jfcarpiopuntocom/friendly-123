/*!
 * plan-pagos.js — friendly-123 · Cuotas y abonos irregulares
 * ============================================================================
 * LA IDEA QUE ORDENA TODO ESTE ARCHIVO:
 *
 *   Un plan de pagos NO ES DINERO. ES UNA EXPECTATIVA.
 *
 * De ahi se sigue absolutamente todo lo demas, y por eso este modulo es corto:
 *
 *   - El plan NUNCA mueve el saldo. Crear un plan no hace aparecer deuda que
 *     nadie contrajo. La deuda se contrajo entera el dia del cartera_cargo.
 *   - El plan NO genera cargos automaticos al vencer una cuota. Si lo hiciera,
 *     el mismo dinero se contaria dos veces.
 *   - "al dia" / "atrasado" se DERIVA, igual que el saldo. No se guarda.
 *
 * Consecuencia practica: las cuotas fijas y los abonos irregulares no son dos
 * sistemas. Son el mismo sistema con y sin expectativa encima. Quien debe $50
 * al mes y en tres meses puso $30, $80 y $45 esta AL DIA: puso $155 contra
 * $150 esperados. Nunca abono el monto exacto de una cuota y no hace falta.
 *
 * ---------------------------------------------------------------------------
 * SIN PENALIDAD. Regla dura de JFC, igual que en cartera.js: este modulo no
 * tiene, y no debe tener nunca, ningun campo de interes, mora ni recargo. Un
 * plan vencido produce un AVISO, jamas un cargo. Si alguien va a agregar uno,
 * que hable con JFC primero.
 *
 * SIN DIAS DE GRACIA POR DEFECTO, PERO TODO EDITABLE (JFC, 2026-08-13): un dia
 * de atraso es un dia de atraso. avisarDesdeDias existe y arranca en 0; es el
 * unico lugar donde vive la idea de gracia y se ajusta cliente por cliente,
 * sin tocar codigo.
 *
 * PAGAR DE MAS ABONA A FAVOR (JFC, 2026-08-13): el calendario no se toca nunca.
 * Quedan las mismas cuotas en las mismas fechas y el excedente queda como saldo
 * a favor, que es lo que cartera.js ya sabe representar (saldo positivo).
 * Por eso proximoVencimiento() no mira ni un centavo de lo abonado.
 *
 * ---------------------------------------------------------------------------
 * FECHAS DE CALENDARIO, NO "CADA 30 DIAS" (research 2026-08-13):
 * sumar 30 dias produce deriva (5 ene -> 4 feb -> 6 mar) y la gente la lee como
 * un error, porque nadie acuerda "cada 30 dias": acuerda "el 5 de cada mes".
 * Se usa fecha de aniversario con clamp de fin de mes, igual que los sistemas
 * de facturacion serios: si el ancla es 31 y el mes tiene 30, vence el 30, y
 * al mes siguiente VUELVE al 31. El clamp no se queda pegado.
 *
 * POR QUE NO HAY LIBRERIA: rrule.js (RFC 5545) es la correcta si hiciera falta
 * "el tercer martes de cada mes". Para mensual con ancla y clamp son las 20
 * lineas de sumarPeriodos(), y rrule pesa mas que todo cartera.js junto. Estas
 * apps corren sin conexion, sin build y con todo embebido: no hay CDN. Una
 * libreria entra cuando resuelve algo que no sabemos resolver bien, no cuando
 * reemplaza veinte lineas que entendemos.
 * ============================================================================
 */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------------------
     Normalizacion y dedupe. Ver el comentario del fix de doble escritura
     (2026-08-13). NO simplificar esto a h.datos: hay hechos reales guardados
     con las dos formas y ninguna se puede dejar de leer.
     --------------------------------------------------------------------------- */
  function _d(h) { return (h && h.datos && h.datos.payload) ? h.datos.payload : ((h && h.datos) || {}); }
  function _anidado(h) { return !!(h && h.datos && h.datos.payload); }
  function _sinDuplicados(hs, campoDueno) {
    var grupos = {};
    hs.forEach(function (h) {
      var d = _d(h);
      var k = [h.tipo, d[campoDueno], d.monto, d.motivo || "", Math.floor((Number(h.ts) || 0) / 2000)].join("|");
      (grupos[k] = grupos[k] || []).push(h);
    });
    var out = [];
    Object.keys(grupos).forEach(function (k) {
      var g = grupos[k];
      var an = g.filter(_anidado);
      var pl = g.filter(function (h) { return !_anidado(h); });
      /* Un anidado + un plano en la misma ventana = el par que dejo el bug.
         Se cuenta una sola vez. Si son todos de la misma forma, son
         movimientos distintos de verdad y van todos. */
      if (an.length && pl.length) out = out.concat(an.length >= pl.length ? an : pl);
      else out = out.concat(g);
    });
    return out;
  }

  var TIPO_CREADO = "plan_pago_creado";
  var TIPO_ANULADO = "plan_pago_anulado";
  var FRECUENCIAS = { mensual: 1, quincenal: 15, semanal: 7 };

  function bus() {
    try { return global.AMG && global.AMG.EventBus; } catch (_) { return null; }
  }

  function quienSoy() {
    try {
      return (global.OCAuth && global.OCAuth.usuarioActual && global.OCAuth.usuarioActual().nombre) || "Sistema";
    } catch (_) { return "Sistema"; }
  }

  // ---------------------------------------------------------------------------
  // Fechas
  // ---------------------------------------------------------------------------

  function aDia(d) {
    // Normaliza a medianoche local. Sin esto, un plan creado a las 23:50
    // "vence" doce minutos despues y el cliente aparece atrasado sin serlo.
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function ultimoDiaDelMes(anio, mes) {
    return new Date(anio, mes + 1, 0).getDate();
  }

  /* Suma n periodos a la fecha base.
     Mensual: aniversario con clamp. El ancla es siempre el dia ORIGINAL, no el
     ultimo resultado, para que despues de febrero se vuelva al 31.
     Quincenal y semanal: dias corridos, que ahi si es lo que la gente acuerda. */
  function sumarPeriodos(base, frecuencia, n, diaAncla) {
    var b = aDia(base);
    if (frecuencia !== "mensual") {
      var dias = FRECUENCIAS[frecuencia] || 30;
      var r = new Date(b);
      r.setDate(r.getDate() + dias * n);
      return aDia(r);
    }
    var ancla = diaAncla || b.getDate();
    var mes = b.getMonth() + n;
    var anio = b.getFullYear() + Math.floor(mes / 12);
    mes = ((mes % 12) + 12) % 12;
    var dia = Math.min(ancla, ultimoDiaDelMes(anio, mes));
    return aDia(new Date(anio, mes, dia));
  }

  // ---------------------------------------------------------------------------
  // Lectura de hechos
  // ---------------------------------------------------------------------------

  function hechosDe(clienteId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) {
      return Promise.resolve([]);
    }
    return global.AMG.Hechos.todos().then(function (todos) {
      return _sinDuplicados((todos || []).filter(function (h) {
        return String(_d(h).clienteId || "") === String(clienteId);
      }), "clienteId");
    }).catch(function (e) {
      try { console.error("plan-pagos: no se pudieron leer los hechos", e); } catch (_) {}
      return [];
    });
  }

  /* hechos.js sella con ts, no con fecha. Leer h.fecha daba 0 para TODOS los
     hechos, y el orden y el corte "abonos desde que existe el plan" quedaban
     al azar. Se deja h.fecha como respaldo por si algun hecho viejo lo trae. */
  function fechaDe(h) {
    return Number(h && (h.ts || h.fecha)) || 0;
  }

  /* Devuelve el plan vigente, o null. Un plan_pago_anulado posterior lo mata.
     null es el caso NORMAL: la mayoria de los fiados no tienen plan y asi debe
     seguir siendo. No inventar un plan por defecto. */
  function planActivo(clienteId) {
    return hechosDe(clienteId).then(function (hs) {
      var creados = hs.filter(function (h) { return h.tipo === TIPO_CREADO; }).sort(function (a, b) { return fechaDe(a) - fechaDe(b); });
      if (!creados.length) return null;
      var ultimo = creados[creados.length - 1];
      var anuladoDespues = hs.some(function (h) {
        return h.tipo === TIPO_ANULADO && fechaDe(h) >= fechaDe(ultimo);
      });
      if (anuladoDespues) return null;
      var p = _d(ultimo);
      return {
        creadoEn: fechaDe(ultimo),
        montoTotal: Number(p.montoTotal) || 0,
        numCuotas: Number(p.numCuotas) || 0,
        montoCuota: Number(p.montoCuota) || 0,
        primerVencimiento: p.primerVencimiento,
        frecuencia: p.frecuencia || "mensual",
        diaAncla: Number(p.diaAncla) || null,
        avisarDesdeDias: Number(p.avisarDesdeDias) || 0,
        motivo: p.motivo || ""
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  function crearPlan(clienteId, datos) {
    if (!clienteId) return Promise.reject(new Error("plan-pagos: falta clienteId"));
    var total = Number(datos && datos.montoTotal);
    var n = Math.floor(Number(datos && datos.numCuotas));
    if (!(total > 0)) return Promise.reject(new Error("plan-pagos: el monto total debe ser mayor a cero"));
    if (!(n > 0)) return Promise.reject(new Error("plan-pagos: debe haber al menos una cuota"));
    var frecuencia = (datos && datos.frecuencia) || "mensual";
    if (!FRECUENCIAS[frecuencia]) return Promise.reject(new Error("plan-pagos: frecuencia no valida"));

    var primero = aDia(datos.primerVencimiento || Date.now());
    var payload = {
      clienteId: String(clienteId),
      montoTotal: +total.toFixed(2),
      numCuotas: n,
      // La ultima cuota absorbe el redondeo: n cuotas iguales rara vez suman el
      // total exacto, y que la suma no cuadre es justo lo que hace desconfiar.
      montoCuota: +(total / n).toFixed(2),
      primerVencimiento: primero.toISOString(),
      frecuencia: frecuencia,
      diaAncla: frecuencia === "mensual" ? primero.getDate() : null,
      avisarDesdeDias: Math.max(0, Number(datos.avisarDesdeDias) || 0),
      motivo: String((datos && datos.motivo) || "").slice(0, 300),
      quien: quienSoy()
    };

    /* UN SOLO CAMINO DE ESCRITURA (fix 2026-08-13). Antes esto emitia
       ":completado" ANTES de registrar, y hechos.js lo persistia por su cuenta:
       dos hechos por un solo movimiento. Ahora se registra primero, se espera a
       que quede en disco, y recien entonces se avisa. El sufijo es
       ":registrado" a proposito: hechos.js solo persiste ":completado", asi que
       este aviso no puede volver a duplicar nada. */
    if (global.AMG && global.AMG.Hechos && global.AMG.Hechos.registrar) {
      return global.AMG.Hechos.registrar(TIPO_CREADO, payload).then(function (r) {
        var eb = bus();
        if (eb) eb.emit(TIPO_CREADO + ":registrado", { payload: payload });
        return r;
      });
    }
    return Promise.reject(new Error("plan-pagos: AMG.Hechos no disponible"));
  }

  /* Anular un acuerdo NO perdona una deuda: el saldo queda exactamente igual.
     Confundir las dos cosas seria un bug de dinero de los graves. */
  function anularPlan(clienteId, motivo) {
    if (!clienteId) return Promise.reject(new Error("plan-pagos: falta clienteId"));
    var payload = {
      clienteId: String(clienteId),
      motivo: String(motivo || "").slice(0, 300),
      quien: quienSoy()
    };
    /* UN SOLO CAMINO DE ESCRITURA (fix 2026-08-13). Antes esto emitia
       ":completado" ANTES de registrar, y hechos.js lo persistia por su cuenta:
       dos hechos por un solo movimiento. Ahora se registra primero, se espera a
       que quede en disco, y recien entonces se avisa. El sufijo es
       ":registrado" a proposito: hechos.js solo persiste ":completado", asi que
       este aviso no puede volver a duplicar nada. */
    if (global.AMG && global.AMG.Hechos && global.AMG.Hechos.registrar) {
      return global.AMG.Hechos.registrar(TIPO_ANULADO, payload).then(function (r) {
        var eb = bus();
        if (eb) eb.emit(TIPO_ANULADO + ":registrado", { payload: payload });
        return r;
      });
    }
    return Promise.reject(new Error("plan-pagos: AMG.Hechos no disponible"));
  }

  // ---------------------------------------------------------------------------
  // El corazon: el estado, todo derivado
  // ---------------------------------------------------------------------------

  function cuotasVencidasA(plan, hoy) {
    var n = 0;
    for (var i = 0; i < plan.numCuotas; i++) {
      var v = sumarPeriodos(plan.primerVencimiento, plan.frecuencia, i, plan.diaAncla);
      if (v.getTime() <= hoy.getTime()) n++; else break;
    }
    return n;
  }

  function proximoVencimiento(plan, hoy) {
    for (var i = 0; i < plan.numCuotas; i++) {
      var v = sumarPeriodos(plan.primerVencimiento, plan.frecuencia, i, plan.diaAncla);
      if (v.getTime() > hoy.getTime()) return v.toISOString();
    }
    return null; // todas vencidas
  }

  /* HUECO PACO (2026-08-13): un plan es una expectativa SOBRE UNA DEUDA. Si la
     deuda ya se salso, la expectativa se cumplio y no quedan cuotas que
     anunciar. Sin esto, alguien que pago todo seguia viendo "Proxima cuota".
     La consulta al saldo es blanda a proposito: si el modulo de saldos no esta
     cargado, el motor sigue funcionando como antes. */
  function saldoActual(duenoId) {
    try {
      if (global.AMG && global.AMG.Cartera && global.AMG.Cartera.saldoDeCliente) {
        return global.AMG.Cartera.saldoDeCliente(duenoId).then(function (s) { return s.saldo; });
      }
      /* SOLO Cartera. Ver el comentario gemelo en consultorio-123: cada app
         consulta su propio modulo de saldo, nunca el primero que exista. */
    } catch (_) {}
    return Promise.resolve(null);
  }

  function estadoDelPlan(clienteId, ahora) {
    var hoy = aDia(ahora || Date.now());
    return planActivo(clienteId).then(function (plan) {
      if (!plan) return { hayPlan: false, estado: "sin_plan" };
      return saldoActual(clienteId).then(function (saldo) {
        /* saldo >= 0 significa que no debe nada: el plan esta cumplido.
           null = no se pudo consultar, y entonces se sigue de largo. */
        if (saldo !== null && saldo >= 0) {
          return { hayPlan: true, estado: "cumplido", montoCuota: plan.montoCuota,
                   numCuotas: plan.numCuotas, montoTotal: plan.montoTotal,
                   frecuencia: plan.frecuencia, cuotasVencidas: plan.numCuotas,
                   esperadoAHoy: plan.montoTotal, abonadoDesdeElPlan: plan.montoTotal,
                   diferencia: 0, proximoVencimiento: null,
                   avisarDesdeDias: plan.avisarDesdeDias };
        }
        return hechosDe(clienteId).then(function (hs) {
        var abonado = hs.filter(function (h) {
          return h.tipo === "cartera_abono" && fechaDe(h) >= plan.creadoEn;
        }).reduce(function (a, h) { return a + (Number(_d(h).monto) || 0); }, 0);

        var vencidas = cuotasVencidasA(plan, hoy);
        var esperado = +(vencidas * plan.montoCuota).toFixed(2);
        var diferencia = +(abonado - esperado).toFixed(2);

        // avisarDesdeDias corre desde el vencimiento de la cuota mas vieja
        // impaga. Con 0 (el default) el atraso empieza el mismo dia.
        var estado;
        if (diferencia >= 0) {
          estado = diferencia > 0 ? "adelantado" : "al_dia";
        } else if (plan.avisarDesdeDias > 0) {
          var venc = sumarPeriodos(plan.primerVencimiento, plan.frecuencia, Math.max(0, vencidas - 1), plan.diaAncla);
          var diasCorridos = Math.floor((hoy - venc) / 86400000);
          estado = diasCorridos >= plan.avisarDesdeDias ? "atrasado" : "al_dia";
        } else {
          estado = "atrasado";
        }

        return {
          hayPlan: true,
          montoCuota: plan.montoCuota,
          numCuotas: plan.numCuotas,
          montoTotal: plan.montoTotal,
          frecuencia: plan.frecuencia,
          cuotasVencidas: vencidas,
          esperadoAHoy: esperado,
          abonadoDesdeElPlan: +abonado.toFixed(2),
          diferencia: diferencia,
          estado: estado,
          proximoVencimiento: proximoVencimiento(plan, hoy),
          avisarDesdeDias: plan.avisarDesdeDias
        };
        });
      });
    }).catch(function (e) {
      try { console.error("plan-pagos: no se pudo derivar el estado", e); } catch (_) {}
      return { hayPlan: false, estado: "sin_plan" };
    });
  }

  /* Fecha en palabras: "15 de septiembre". Nunca 2026-09-15 en pantalla. */
  var MESES = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"];
  function fechaEnPalabras(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return MESES[d.getMonth()] + " " + d.getDate();
  }

  global.AMG = global.AMG || {};
  global.AMG.PlanPagos = {
    VERSION: "1.0.0",
    crearPlan: crearPlan,
    anularPlan: anularPlan,
    planActivo: planActivo,
    estadoDelPlan: estadoDelPlan,
    fechaEnPalabras: fechaEnPalabras,
    // expuesta para poder probar el clamp de fin de mes sin montar la UI
    _sumarPeriodos: sumarPeriodos
  };
})(typeof window !== "undefined" ? window : this);
