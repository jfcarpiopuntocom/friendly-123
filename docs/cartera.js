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

    var eventBus = bus();
    if (eventBus) {
      // hechos.js escucha "*" y filtra por sufijo ":completado" — este es el
      // MISMO mecanismo que ya usa mock-backend.js para inventario. Reusar
      // el mecanismo (en vez de llamar AMG.Hechos.registrar directo) evita
      // dos caminos distintos para lo mismo.
      eventBus.emit("cartera_" + tipo + ":completado", { payload: payload });
    }
    // Ademas de emitir (para quien escuche en vivo), registramos el hecho de
    // forma directa y esperamos a que quede en disco: quien llama a esta
    // funcion necesita saber que el movimiento YA se guardo, no solo que se
    // emitio un evento al aire.
    if (global.AMG && global.AMG.Hechos && global.AMG.Hechos.registrar) {
      return global.AMG.Hechos.registrar(TIPOS[tipo], payload);
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
      var mios = todos.filter(function (h) {
        return (h.tipo === TIPOS.cargo || h.tipo === TIPOS.abono) &&
          h.datos && h.datos.payload && String(h.datos.payload.clienteId) === String(clienteId);
      });
      var saldo = 0;
      var movimientos = mios.map(function (h) {
        var signo = h.tipo === TIPOS.cargo ? -1 : 1;
        var monto = Number(h.datos.payload.monto) || 0;
        saldo += signo * monto;
        return {
          tipo: h.tipo === TIPOS.cargo ? "cargo" : "abono",
          monto: monto,
          motivo: h.datos.payload.motivo || "",
          quien: h.datos.payload.quien || "",
          fecha: h.ts
        };
      });
      movimientos.sort(function (a, b) { return a.fecha - b.fecha; });
      return { saldo: +saldo.toFixed(2), movimientos: movimientos };
    });
  }

  // Capa de proyeccion por rol (pedido explicito de JFC, ver roadmap Fase 1
  // "Guard de privacidad"). Se llama en el UNICO lugar donde se renderiza
  // cartera, para que sea imposible que la UI de empleado reciba mas de lo
  // que debe — no depende de que cada pantalla nueva se acuerde de ocultarlo.
  function vistaCarteraSegunRol(saldoInfo, rol) {
    var esEmpleado = rol === "empleado";
    return {
      saldo: saldoInfo.saldo,
      tienePendiente: saldoInfo.saldo < 0,
      // El empleado ve el saldo de ESTE cliente (case by case), pero nunca el
      // historial completo de movimientos ni la posibilidad de exportar.
      historial: esEmpleado ? [] : saldoInfo.movimientos,
      puedeExportar: !esEmpleado,
      puedeVerListaGlobal: !esEmpleado
    };
  }

  global.AMG = global.AMG || {};
  global.AMG.Cartera = {
    VERSION: "1.0.0-fase1",
    registrarMovimiento: registrarMovimiento,
    saldoDeCliente: saldoDeCliente,
    vistaCarteraSegunRol: vistaCarteraSegunRol
  };
})(typeof window !== "undefined" ? window : this);
