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
    return Promise.reject(new Error("caja-chica: AMG.Hechos no disponible"));
  }

  // Deriva el saldo de UNA percha reproduciendo todos los hechos conocidos.
  function saldoDePercha(perchaId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) {
      return Promise.resolve({ saldo: 0, movimientos: [] });
    }
    return global.AMG.Hechos.todos().then(function (todos) {
      var mios = _sinDuplicados(todos.filter(function (h) {
        return (h.tipo === TIPOS.ingreso || h.tipo === TIPOS.retiro) &&
          String(_d(h).perchaId || "") === String(perchaId);
      }), "perchaId");
      var saldo = 0;
      var movimientos = mios.map(function (h) {
        var signo = h.tipo === TIPOS.ingreso ? 1 : -1;
        var monto = Number(_d(h).monto) || 0;
        saldo += signo * monto;
        return {
          tipo: h.tipo === TIPOS.ingreso ? "ingreso" : "retiro",
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

  global.AMG = global.AMG || {};
  global.AMG.CajaChica = {
    VERSION: "1.0.0-fase2",
    registrarMovimiento: registrarMovimiento,
    saldoDePercha: saldoDePercha
  };
})(typeof window !== "undefined" ? window : this);
