/*!
 * caja-chica.js — friendly-123 · Roadmap Agosto 2026, Fase 2
 * ============================================================================
 * Caja chica por percha. Mismo patron EXACTO que cartera.js (Fase 1): el
 * "dueño del saldo" es una percha (ubicacionId) en vez de un cliente. Ver
 * _private/ROADMAP-AGOSTO-2026.md Fase 2.
 *
 * "Solo como un plus para que las cuentas cuadren" (JFC): esto NO reemplaza
 * el P&L ni las comisiones — es un control operativo rapido de cuanto
 * efectivo hay en cada punto fisico ahora mismo. Sirve para los 3 tipos de
 * percha (fisica, evento, cafeteria/bar) por igual.
 *
 * Mismo chokepoint que Fase 1: AMG.CajaChica.registrarMovimiento() es el
 * UNICO punto de escritura. El saldo SIEMPRE se deriva de los hechos
 * "caja_chica_ingreso"/"caja_chica_retiro" ya persistidos por hechos.js.
 * Motivo obligatorio — mismo patron que el ajuste de stock +/- que ya lo exige.
 * ============================================================================
 */
(function (global) {
  "use strict";

  var TIPOS = { ingreso: "caja_chica_ingreso", retiro: "caja_chica_retiro" };

  function bus() {
    try { return global.AMG && global.AMG.EventBus; } catch (_) { return null; }
  }

  // tipo: "ingreso" | "retiro". motivo es OBLIGATORIO (a diferencia de
  // cartera.js, donde es opcional) — mismo requisito que el ajuste de stock.
  function registrarMovimiento(perchaId, tipo, monto, motivo) {
    if (tipo !== "ingreso" && tipo !== "retiro") {
      return Promise.reject(new Error("caja-chica: tipo debe ser 'ingreso' o 'retiro'"));
    }
    var m = Number(monto);
    if (!(m > 0)) return Promise.reject(new Error("caja-chica: monto debe ser mayor a cero"));
    if (!perchaId) return Promise.reject(new Error("caja-chica: falta perchaId"));
    var motivoLimpio = String(motivo || "").trim();
    if (!motivoLimpio) return Promise.reject(new Error("caja-chica: el motivo es obligatorio"));

    var payload = {
      perchaId: String(perchaId),
      monto: +m.toFixed(2),
      motivo: motivoLimpio.slice(0, 300),
      quien: (function () {
        try {
          return (global.OCAuth && global.OCAuth.usuarioActual && global.OCAuth.usuarioActual().nombre) || "Sistema";
        } catch (_) { return "Sistema"; }
      })()
    };

    var eventBus = bus();
    if (eventBus) {
      eventBus.emit("caja_chica_" + tipo + ":completado", { payload: payload });
    }
    if (global.AMG && global.AMG.Hechos && global.AMG.Hechos.registrar) {
      return global.AMG.Hechos.registrar(TIPOS[tipo], payload);
    }
    return Promise.reject(new Error("caja-chica: AMG.Hechos no disponible"));
  }

  // Deriva el saldo de UNA percha reproduciendo todos los hechos conocidos.
  function saldoDePercha(perchaId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) {
      return Promise.resolve({ saldo: 0, movimientos: [] });
    }
    return global.AMG.Hechos.todos().then(function (todos) {
      var mios = todos.filter(function (h) {
        return (h.tipo === TIPOS.ingreso || h.tipo === TIPOS.retiro) &&
          h.datos && h.datos.payload && String(h.datos.payload.perchaId) === String(perchaId);
      });
      var saldo = 0;
      var movimientos = mios.map(function (h) {
        var signo = h.tipo === TIPOS.ingreso ? 1 : -1;
        var monto = Number(h.datos.payload.monto) || 0;
        saldo += signo * monto;
        return {
          tipo: h.tipo === TIPOS.ingreso ? "ingreso" : "retiro",
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

  global.AMG = global.AMG || {};
  global.AMG.CajaChica = {
    VERSION: "1.0.0-fase2",
    registrarMovimiento: registrarMovimiento,
    saldoDePercha: saldoDePercha
  };
})(typeof window !== "undefined" ? window : this);
