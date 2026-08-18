/*!
 * cartera.js — friendly-123 · Roadmap Agosto 2026, Fase 0 + Fase 1
 * ============================================================================
 * Cartera de clientes (fiado / abono). Sigue al pie la regla dura del roadmap:
 * "ninguna feature nueva que toque dinero se construye como estado mutable.
 * Todas emiten hechos." Ver _private/ROADMAP-AGOSTO-2026.md.
 *
 * CHOKEPOINT (Fase 0): AMG.Cartera.registrarMovimiento() es el UNICO punto de
 * entrada para tocar el saldo de un cliente. Nadie — ni la UI, ni mock-backend
 * — escribe un campo "saldo" directo. El saldo SIEMPRE se deriva sumando los
 * hechos "cartera_cargo"/"cartera_abono" ya guardados por hechos.js. Mismo
 * espiritu que guardarConHistorial() en el Worker.
 *
 * Por que reusa hechos.js en vez de tener su propio storage: hechos.js ya
 * emite/escucha en AMG.EventBus cualquier evento que termine en ":completado"
 * y lo persiste con reloj vectorial + cadena de hash. Cartera solo necesita
 * emitir el evento correcto — cero storage nuevo, cero riesgo de reinventar
 * la sincronizacion que ya funciona para inventario.
 *
 * Concepto (tabla del roadmap, no confundir):
 *   cartera_cargo  -> fiado/deuda. Resta del saldo del cliente.
 *   cartera_abono  -> abono/credito (pago adelantado o credito por devolucion
 *                     via Fase 3, o seña de reserva via Fase 4). Suma al saldo.
 * Saldo negativo = el cliente debe. Saldo positivo = el cliente tiene credito.
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

  var TIPOS = { cargo: "cartera_cargo", abono: "cartera_abono" };

  function bus() {
    try { return global.AMG && global.AMG.EventBus; } catch (_) { return null; }
  }

  // Unico punto de escritura. tipo: "cargo" | "abono". monto siempre positivo;
  // el signo lo decide el tipo, no quien llama — asi nadie puede "abonar
  // negativo" para simular un cargo sin dejar rastro correcto.
  function registrarMovimiento(clienteId, tipo, monto, motivo) {
    if (tipo !== "cargo" && tipo !== "abono") {
      return Promise.reject(new Error("cartera: tipo debe ser 'cargo' o 'abono'"));
    }
    var m = Number(monto);
    if (!(m > 0)) return Promise.reject(new Error("cartera: monto debe ser mayor a cero"));
    if (!clienteId) return Promise.reject(new Error("cartera: falta clienteId"));

    var payload = {
      clienteId: String(clienteId),
      monto: +m.toFixed(2),
      motivo: String(motivo || "").slice(0, 300),
      quien: (function () {
        try {
          return (global.OCAuth && global.OCAuth.usuarioActual && global.OCAuth.usuarioActual().nombre) || "Sistema";
        } catch (_) { return "Sistema"; }
      })()
    };

    /* UN SOLO CAMINO DE ESCRITURA (fix 2026-08-13). Antes esto emitia
       ":completado" ANTES de registrar, y hechos.js lo persistia por su cuenta:
       dos hechos por un solo movimiento. Ahora se registra primero, se espera a
       que quede en disco, y recien entonces se avisa. El sufijo es
       ":registrado" a proposito: hechos.js solo persiste ":completado", asi que
       este aviso no puede volver a duplicar nada. */
    if (global.AMG && global.AMG.Hechos && global.AMG.Hechos.registrar) {
      return global.AMG.Hechos.registrar(TIPOS[tipo], payload).then(function (r) {
        var eb = bus();
        if (eb) eb.emit(TIPOS[tipo] + ":registrado", { payload: payload });
        return r;
      });
    }
    return Promise.reject(new Error("cartera: AMG.Hechos no disponible"));
  }

  // Deriva el saldo y el historial de UN cliente reproduciendo todos los
  // hechos conocidos. Nunca lee ni escribe un campo "saldo" guardado.
  function saldoDeCliente(clienteId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) {
      return Promise.resolve({ saldo: 0, movimientos: [] });
    }
    return global.AMG.Hechos.todos().then(function (todos) {
      var mios = _sinDuplicados(todos.filter(function (h) {
        return (h.tipo === TIPOS.cargo || h.tipo === TIPOS.abono) &&
          String(_d(h).clienteId || "") === String(clienteId);
      }), "clienteId");
      var saldo = 0;
      var movimientos = mios.map(function (h) {
        var signo = h.tipo === TIPOS.cargo ? -1 : 1;
        var monto = Number(_d(h).monto) || 0;
        saldo += signo * monto;
        return {
          tipo: h.tipo === TIPOS.cargo ? "cargo" : "abono",
          monto: monto,
          motivo: _d(h).motivo || "",
          quien: _d(h).quien || "",
          fecha: h.ts
        };
      });
      movimientos.sort(function (a, b) { return a.fecha - b.fecha; });
      return { saldo: +saldo.toFixed(2), movimientos: movimientos };
    });
  }

  // Capa de proyeccion por rol (pedido explicito de JFC, ver roadmap Fase 1
  // "Guard de privacidad"). Se llama en el UNICO lugar donde se renderiza
  // cartera, para que sea imposible que la UI de encargado reciba mas de lo
  // que debe — no depende de que cada pantalla nueva se acuerde de ocultarlo.
  function vistaCarteraSegunRol(saldoInfo, rol) {
    var esEmpleado = rol === "empleado";
    return {
      saldo: saldoInfo.saldo,
      tienePendiente: saldoInfo.saldo < 0,
      // El encargado ve el saldo de ESTE cliente (case by case), pero nunca el
      // historial completo de movimientos ni la posibilidad de exportar.
      historial: esEmpleado ? [] : saldoInfo.movimientos,
      puedeExportar: !esEmpleado,
      puedeVerListaGlobal: !esEmpleado
    };
  }

  // ---------------------------------------------------------------------------
  // Alerta de saldo pendiente — activable/desactivable POR CLIENTE (JFC,
  // 2026-07-29): "registro sin penalidad pero con alerta activable o
  // desactivable por caso". Nunca interes ni recargo — la unica perilla es
  // si se avisa o no. Es preferencia de UI, no dinero: vive en localStorage,
  // no como hecho (no es algo que "paso", es una configuracion de vista).
  var ALERTA_KEY = "amg_cartera_alertas_v1";
  function leerAlertas() {
    try { return JSON.parse(localStorage.getItem(ALERTA_KEY) || "{}") || {}; } catch (_) { return {}; }
  }
  // Default true: la alerta esta ENCENDIDA salvo que el dueño la apague para
  // ese cliente puntual (ej. un cliente de confianza con saldo alto normal).
  function alertaActiva(clienteId) {
    var m = leerAlertas();
    return m[clienteId] !== false;
  }
  function fijarAlerta(clienteId, activa) {
    var m = leerAlertas();
    if (activa) delete m[clienteId]; else m[clienteId] = false;
    try { localStorage.setItem(ALERTA_KEY, JSON.stringify(m)); } catch (_) {}
    return alertaActiva(clienteId);
  }

  global.AMG = global.AMG || {};
  global.AMG.Cartera = {
    VERSION: "1.1.0-fase1",
    registrarMovimiento: registrarMovimiento,
    saldoDeCliente: saldoDeCliente,
    vistaCarteraSegunRol: vistaCarteraSegunRol,
    alertaActiva: alertaActiva,
    fijarAlerta: fijarAlerta
  };
})(typeof window !== "undefined" ? window : this);
