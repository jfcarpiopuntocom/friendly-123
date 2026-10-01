/* invariantes.js — revision de coherencia de las ventas al arrancar (JFC 2026-09-30).

   NOTAS PARA QUIEN LO TOQUE DESPUES (no borrar):
   - Regla de JFC (2026-09-29): REPARAR SOLO LO DERIVABLE; AVISAR SIEMPRE EN LO QUE TOQUE DINERO.
     Por eso `revisar` no muta nada y `aplicar` solo ejecuta `reparaciones`, que hoy es UNA:
     llenar la percha (ubicacionId) de una venta que la trae vacia, tomandola del producto.
     Jamas sobrescribe un valor existente. Ningun monto se recalcula NUNCA: reescribir dinero
     historico esconde el bug en vez de mostrarlo. No agregar reparaciones de dinero.
   - No borra duplicados ni huerfanos: pueden ser el unico rastro de una venta real.
   - Las ventas anuladas no se revisan: su dinero ya no cuenta.
   - Todo es local: nada de aqui sale del aparato.
   - Los montos se comparan en CENTAVOS enteros (v425): tolerancia de 1 centavo por redondeo. */
(function (global) {
  "use strict";

  function ce(n) { return Math.round((Number(n) || 0) * 100); }
  function num(n) { return typeof n === "number" && isFinite(n); }

  function revisar(estado) {
    var ventas = (estado && estado.ventas) || [];
    var productos = (estado && estado.productos) || [];
    var avisos = [], reparaciones = [];
    var prodPorId = {};
    Array.prototype.forEach.call(productos, function (p) { if (p && p.id != null) prodPorId[p.id] = p; });
    var vistos = {};

    function avisar(codigo, v, detalle) { try { if (typeof window !== "undefined") { if (window.OCSalud && window.OCSalud.fallo) window.OCSalud.fallo("comisiones", "dinero-" + codigo); else (window.__ocFallos = window.__ocFallos || []).push(["comisiones", "dinero-" + codigo]); } } catch (_) {} avisos.push({ codigo: codigo, ventaId: v && v.id != null ? v.id : null, detalle: detalle }); }

    Array.prototype.forEach.call(ventas, function (v) {
      if (!v || v.anulada) return;

      if (v.id != null) {
        if (vistos[v.id]) avisar("id-duplicado", v, "Two sales share the same id.");
        vistos[v.id] = true;
      }

      if (!num(v.cantidad) || !num(v.precioUnit) || !num(v.costoUnit) || v.cantidad < 0 || v.precioUnit < 0 || v.costoUnit < 0) {
        avisar("numero-invalido", v, "A quantity, price or cost is missing, not a number, or negative.");
      }

      var p = v.productoId != null ? prodPorId[v.productoId] : null;
      if (v.productoId != null && !p) avisar("producto-huerfano", v, "The product of this sale no longer exists.");

      var s = v.split;
      if (s && typeof s === "object") {
        var bruto = ce(s.montoBruto), com = ce(s.montoComisionSocio), neto = ce(s.montoNetoDueno);
        if (Math.abs((com + neto) - bruto) > 1) avisar("dinero-partido", v, "Commission plus owner net does not add up to the sale amount.");
        if (com > bruto) avisar("comision-mayor-que-venta", v, "The commission is larger than the sale itself.");
        if (num(v.cantidad) && num(v.precioUnit) && Math.abs(bruto - ce(v.precioUnit * v.cantidad)) > 1) {
          avisar("bruto-distinto", v, "The recorded sale amount differs from price times quantity.");
        }
      }

      // Unica reparacion: derivable, sin dinero, y solo si esta VACIO.
      if (!v.ubicacionId && p && p.ubicacionId) {
        reparaciones.push({ codigo: "ubicacion-vacia", ventaId: v.id, ubicacionId: p.ubicacionId });
      }
    });

    return { avisos: avisos, reparaciones: reparaciones };
  }

  /* Ejecuta SOLO las reparaciones del informe sobre el arreglo vivo de ventas.
     Devuelve cuantas aplico. Vuelve a comprobar que el campo siga vacio. */
  function aplicar(informe, ventas) {
    var n = 0;
    ((informe && informe.reparaciones) || []).forEach(function (r) {
      Array.prototype.forEach.call(ventas || [], function (v) {
        if (v && v.id === r.ventaId && !v.ubicacionId && r.codigo === "ubicacion-vacia") { v.ubicacionId = r.ubicacionId; n++; }
      });
    });
    return n;
  }

  global.OCInvariantes = { revisar: revisar, aplicar: aplicar };
})(typeof window !== "undefined" ? window : globalThis);
