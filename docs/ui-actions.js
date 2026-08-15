/*!
 * ui-actions.js — friendly-123
 * FASE 4, punto 4.1
 *
 * Objetivo (ver prompt maestro): "ninguna acción importante debe depender
 * directamente de un botón o pantalla concreta; toda interacción del
 * usuario debe transformarse en eventos que viajen por una arquitectura
 * única: UI Actions → Event Bus → ... → Persistencia → Render."
 *
 * CÓMO LO LOGRA SIN TOCAR LA LÓGICA EXISTENTE:
 * Este archivo NO reescribe ni copia la lógica de venderUno, ajustar,
 * crearProductoNuevo, etc. Las envuelve ("monkey patch" controlado): guarda
 * una referencia a la función original en window, la reemplaza por una
 * versión que emite eventos ANTES y DESPUÉS, pero que en el medio llama
 * exactamente a la función original, con los mismos argumentos, devolviendo
 * exactamente lo mismo (o relanzando exactamente el mismo error). El
 * comportamiento visible de la app es IDÉNTICO. Si algún día se quita este
 * archivo del index.html, la app funciona exactamente igual que hoy.
 *
 * REQUISITO DE ORDEN DE CARGA: debe ir DESPUÉS de todos los demás <script>
 * de la app (el inline principal y todos los módulos .js), porque necesita
 * que las funciones globales que va a envolver ya existan en window. Se
 * carga al final de <body>, justo antes de event-bus.js/logger.js/telemetry.js
 * o después — el orden entre estos 4 no importa entre sí, lo que importa es
 * que TODOS vayan después del resto de la app.
 *
 * RESILIENCIA: si una función que se espera envolver no existe (ej. una
 * versión futura de index.html le cambia el nombre, o falta un módulo),
 * este archivo NO revienta — loguea un WARN y sigue con las demás. Esto es
 * clave porque esta sesión no tuvo acceso a auth-ui.js ni avanzado-extra.js;
 * si esas más adelante exponen funciones globales relevantes, se agregan acá
 * como una línea más en WRAP_MAP, sin tocar nada más.
 *
 * Feature flag: window.AMG_FLAGS.uiActionsEnabled (default true). En false,
 * el archivo se carga pero no envuelve nada — cero cambio de comportamiento.
 */
(function (global) {
  "use strict";

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  var F = global.AMG_FLAGS;
  if (typeof F.uiActionsEnabled === "undefined") F.uiActionsEnabled = true;

  if (!F.uiActionsEnabled) {
    if (global.console) global.console.info("[AMG.UiActions] deshabilitado por feature flag — cero envoltura.");
    return;
  }
  if (!global.AMG || !global.AMG.EventBus) {
    if (global.console) global.console.warn("[AMG.UiActions] event-bus.js no cargado — no se puede envolver nada. Cargar event-bus.js antes que ui-actions.js.");
    return;
  }

  var Bus = global.AMG.EventBus;
  var Logger = global.AMG.Logger; // opcional, puede no estar cargado

  function log(level, tag, msg, data) {
    if (Logger) Logger.log(level, tag, msg, data);
  }

  /**
   * Mapa de funciones globales a envolver. Cada entrada:
   *   fnName: nombre exacto en window (debe existir como función global)
   *   eventPrefix: prefijo de los eventos emitidos (ej. "venta" → "venta:iniciada", "venta:completada", "venta:error")
   *   mapArgs: (args[]) => payload reducido y seguro para loguear (nunca mandar objetos gigantes completos)
   *
   * Fuente de la verdad de las firmas (verificadas línea por línea en
   * index.html de esta sesión, files_3_.zip):
   *   venderUno(id)
   *   confirmarVentaConInfo(id, esTicket)
   *   ajustar(id, delta)
   *   crearProductoNuevo(codigoEscaneado)
   *   guardarEdicionProducto(id)
   *   eliminarProductoUI(id, btn)          -> btn (elemento DOM) se excluye del payload
   *   solicitarTransferencia(origenId, destinoId, cantidad, btn)
   *   abrirEtiqueta(id)
   *   imprimirSoloBarcode(svgBarcode, producto)
   *   guardarBarcodeComoImagen(svgBarcode, producto)
   *   evaluarCliente(clienteId, campo, valor, btn)
   *   despedirCliente(clienteId, nombre)
   *   reactivarCliente(clienteId, nombre)
   *   marcarComisionPagada(ubicacionId, promotorNombre, monto)
   *   ejecutarEscaneo()
   *   abrirAltaProducto()
   */
  var WRAP_MAP = [
    { fnName: "venderUno", eventPrefix: "venta_rapida", mapArgs: function (a) { return { productoId: a[0] }; } },
    { fnName: "confirmarVentaConInfo", eventPrefix: "venta", mapArgs: function (a) { return { productoId: a[0], esTicket: !!a[1] }; } },
    { fnName: "ajustar", eventPrefix: "stock_ajuste", mapArgs: function (a) { return { productoId: a[0], delta: a[1] }; } },
    { fnName: "crearProductoNuevo", eventPrefix: "producto_alta", mapArgs: function (a) { return { codigoEscaneado: a[0] || null }; } },
    { fnName: "guardarEdicionProducto", eventPrefix: "producto_edicion", mapArgs: function (a) { return { productoId: a[0] }; } },
    { fnName: "eliminarProductoUI", eventPrefix: "producto_eliminacion", mapArgs: function (a) { return { productoId: a[0] }; } },
    { fnName: "solicitarTransferencia", eventPrefix: "transferencia", mapArgs: function (a) { return { origenId: a[0], destinoId: a[1], cantidad: a[2] }; } },
    { fnName: "abrirEtiqueta", eventPrefix: "etiqueta_apertura", mapArgs: function (a) { return { productoId: a[0] }; } },
    { fnName: "imprimirSoloBarcode", eventPrefix: "impresion_barcode", mapArgs: function (a) { return { producto: a[1] && (a[1].sku || a[1].nombre) || null }; } },
    { fnName: "guardarBarcodeComoImagen", eventPrefix: "exportacion_barcode", mapArgs: function (a) { return { producto: a[1] && (a[1].sku || a[1].nombre) || null }; } },
    { fnName: "evaluarCliente", eventPrefix: "cliente_evaluacion", mapArgs: function (a) { return { clienteId: a[0], campo: a[1], valor: a[2] }; } },
    { fnName: "despedirCliente", eventPrefix: "cliente_despido", mapArgs: function (a) { return { clienteId: a[0], nombre: a[1] }; } },
    { fnName: "reactivarCliente", eventPrefix: "cliente_reactivacion", mapArgs: function (a) { return { clienteId: a[0], nombre: a[1] }; } },
    { fnName: "marcarComisionPagada", eventPrefix: "comision_pago", mapArgs: function (a) { return { ubicacionId: a[0], promotorNombre: a[1], monto: a[2] }; } },
    { fnName: "ejecutarEscaneo", eventPrefix: "escaneo", mapArgs: function () { return {}; } },
    { fnName: "abrirAltaProducto", eventPrefix: "producto_alta_apertura", mapArgs: function () { return {}; } }
  ];

  // Resumen del valor devuelto por una accion, por LISTA BLANCA. Nunca copia el
  // objeto entero: un resultado puede traer la foto del producto en base64 y
  // meterla en cada hecho inflaria el registro sin aportar nada. Solo se
  // guardan los campos con los que se puede reconstruir el inventario.
  // Devuelve null si el resultado no tiene forma reconocible — eso es correcto
  // y esperado: no todas las acciones tocan stock.
  function resumirResultado(value) {
    try {
      if (!value || typeof value !== "object") return null;
      // Varias rutas devuelven { producto: {...} } y otras el producto directo.
      var p = value.producto && typeof value.producto === "object" ? value.producto : value;
      var out = {};
      if (p.id != null) out.productoId = String(p.id);
      if (typeof p.stockActual === "number") out.stockActual = p.stockActual;
      if (p.sku != null) out.sku = String(p.sku);
      if (value.ventaId != null) out.ventaId = String(value.ventaId);
      return Object.keys(out).length ? out : null;
    } catch (_) { return null; }
  }

  var envueltas = [];
  var noEncontradas = [];

  WRAP_MAP.forEach(function (spec) {
    var original = global[spec.fnName];
    if (typeof original !== "function") {
      noEncontradas.push(spec.fnName);
      return;
    }
    // Evitar doble envoltura si este script se cargara dos veces por error.
    if (original.__amgWrapped__) return;

    var wrapped = function () {
      var args = Array.prototype.slice.call(arguments);
      var payload;
      try { payload = spec.mapArgs(args); } catch (_) { payload = null; }
      var t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();

      Bus.emit(spec.eventPrefix + ":iniciado", payload);

      var result;
      try {
        result = original.apply(this, args);
      } catch (syncErr) {
        // La función original es en su mayoría async (devuelve Promise),
        // pero por si alguna lanza síncrono, lo cubrimos igual.
        var dur0 = ((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - t0;
        Bus.emit(spec.eventPrefix + ":error", { payload: payload, durationMs: dur0, error: String(syncErr && syncErr.message || syncErr) });
        throw syncErr; // comportamiento original intacto: el error sigue propagándose igual que antes
      }

      if (result && typeof result.then === "function") {
        return result.then(
          function (value) {
            var dur = ((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - t0;
            // resultado: el estado en que QUEDO el producto tras la accion.
            // Sin esto, un hecho de venta dice "se vendio algo del producto X"
            // pero no cuanto, y reconciliacion.js no puede reconstruir el
            // inventario — solo contar acciones. Con el stock resultante, dos
            // hechos consecutivos del mismo producto permiten deducir el
            // movimiento real aunque la cantidad no viniera en los argumentos.
            // Se extrae por lista blanca y dentro de try/catch: un resultado con
            // forma inesperada NO puede romper una venta.
            Bus.emit(spec.eventPrefix + ":completado", { payload: payload, durationMs: Math.round(dur), resultado: resumirResultado(value) });
            return value;
          },
          function (err) {
            var dur = ((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - t0;
            Bus.emit(spec.eventPrefix + ":error", { payload: payload, durationMs: Math.round(dur), error: String(err && err.message || err) });
            throw err; // re-lanzar intacto: quien llame a venderUno(id) sigue viendo el mismo comportamiento de siempre
          }
        );
      }

      // Función síncrona sin promesa (ej. imprimirSoloBarcode).
      var durSync = ((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - t0;
      Bus.emit(spec.eventPrefix + ":completado", { payload: payload, durationMs: Math.round(durSync) });
      return result;
    };
    wrapped.__amgWrapped__ = true;
    wrapped.__amgOriginal__ = original;

    global[spec.fnName] = wrapped;
    envueltas.push(spec.fnName);
  });

  // --- Navegación entre vistas: delegación de eventos, no toca los <button>
  // existentes ni sus onclick. Escucha en la fase de burbuja sobre el nav.
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest("nav button[data-vista]");
    if (btn) {
      Bus.emit("pantalla:navegacion", { vista: btn.getAttribute("data-vista") });
    }
  }, false);

  // --- Online/offline: la app ya debe manejar esto internamente (mock/PB),
  // esto es puramente observabilidad adicional, no interfiere en nada.
  global.addEventListener("online", function () { Bus.emit("conexion:online", {}); });
  global.addEventListener("offline", function () { Bus.emit("conexion:offline", {}); });

  log("AUDIT", "ui-actions", "Fase 4 activa: funciones envueltas", { envueltas: envueltas, noEncontradas: noEncontradas });
  if (global.console && global.console.info) {
    global.console.info("[AMG.UiActions] " + envueltas.length + " funciones envueltas: " + envueltas.join(", ") +
      (noEncontradas.length ? (" | no encontradas (ok si no existen en esta versión): " + noEncontradas.join(", ")) : ""));
  }

  global.AMG = global.AMG || {};
  global.AMG.UiActions = { wrapped: envueltas, notFound: noEncontradas, VERSION: "1.0.0" };
})(typeof window !== "undefined" ? window : this);
