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
  /* Claude 2026-10-07: hecho ADITIVO "cartera_vinculo" = vinculo manual (dueno/admin) de un cargo
     antiguo a UNA venta fiada del mismo cliente. Payload { clienteId, cargoId, ventaId|null,
     accion: "vincular"|"desvincular", quien }. NO es cargo ni abono: el lector v459 filtra solo
     cartera_cargo/cartera_abono, asi que lo ignora (conserva su saldo viejo, sin crash ni doble
     descuento). Es append-only: deshacer = otro hecho "desvincular", jamas borrar. */
  var VINCULO = "cartera_vinculo";
  var cargosVentaEnCurso = Object.create(null);

  function bus() {
    try { return global.AMG && global.AMG.EventBus; } catch (_) { return null; }
  }
  function movimientoExistente(hechos, clienteId, tipo, monto, motivo, relacion) {
    var existente = hechos.find(function (h) { return _d(h).opId === String(relacion.opId); });
    if (!existente) return null;
    var d = _d(existente);
    if (existente.tipo !== TIPOS[tipo] || d.clienteId !== String(clienteId) ||
        Number(d.monto) !== Number(Number(monto).toFixed(2)) || d.motivo !== String(motivo || '').slice(0,300) ||
        String(d.ventaId || '') !== String(relacion.ventaId || '')) {
      var conflicto = new Error('This payment reference already belongs to a different movement.');
      conflicto.status = 409; throw conflicto;
    }
    return existente;
  }

  // Unico punto de escritura. tipo: "cargo" | "abono". monto siempre positivo;
  // el signo lo decide el tipo, no quien llama — asi nadie puede "abonar
  // negativo" para simular un cargo sin dejar rastro correcto.
  function registrarMovimiento(clienteId, tipo, monto, motivo, relacion, reusarCargoVenta) {
    // One payment intention survives retries and reloads in the immutable receipt itself.
    // Older callers without opId still create independent, legitimate movements.
    if (relacion && relacion.opId) {
      var opId = String(relacion.opId);
      var cola = cargosVentaEnCurso['op:' + opId] || Promise.resolve();
      var intento = cola.catch(function () {}).then(function () {
        return global.AMG.Hechos.todos();
      }).then(function (hechos) {
        var existente = movimientoExistente(hechos, clienteId, tipo, monto, motivo, relacion);
        if (existente) return existente;
        return guardarMovimiento(clienteId, tipo, monto, motivo, relacion);
      });
      cargosVentaEnCurso['op:' + opId] = intento;
      var soltar = function () { if (cargosVentaEnCurso['op:' + opId] === intento) delete cargosVentaEnCurso['op:' + opId]; };
      intento.then(soltar, soltar);
      return intento;
    }
    if (tipo !== "cargo" || !relacion || !relacion.ventaId) {
      return guardarMovimiento(clienteId, tipo, monto, motivo, relacion);
    }
    // Codex 2026-10-07: repeated UI requests for one sale share a local queue and re-read disk.
    // Manual debts have no sale key and must remain independent movements.
    var clave = JSON.stringify([String(clienteId), String(relacion.ventaId)]);
    var previo = cargosVentaEnCurso[clave] || Promise.resolve();
    var tarea = previo.catch(function () {}).then(function () {
      if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) {
        throw new Error("cartera: AMG.Hechos no disponible");
      }
      return global.AMG.Hechos.todos();
    }).then(function (hechos) {
      var vinculos = reusarCargoVenta ? _vinculosManuales(hechos, clienteId) : {};
      // v490 (2026-10-13): one sale, one debtor. A receipt for this sale under
      // another customer (legacy customer change) blocks a second charge.
      if (reusarCargoVenta && hechos.some(function (h) {
        var d = _d(h);
        return h.tipo === TIPOS.cargo && String(d.ventaId || "") === String(relacion.ventaId) &&
          String(d.clienteId) !== String(clienteId);
      })) {
        throw new Error("this sale already has a credit receipt for another customer");
      }
      var existente = hechos.find(function (h) {
        var d = _d(h);
        return h.tipo === TIPOS.cargo && String(d.clienteId) === String(clienteId) &&
          String(d.ventaId || vinculos[String(h.id)] || "") === String(relacion.ventaId);
      });
      if (existente) {
        if (!reusarCargoVenta && Math.round(Number(_d(existente).monto) * 100) !== Math.round(Number(monto) * 100)) {
          throw new Error("cartera: la venta ya tiene un cargo; requiere una correccion, no otro cargo");
        }
        return existente;
      }
      return guardarMovimiento(clienteId, tipo, monto, motivo, relacion);
    });
    cargosVentaEnCurso[clave] = tarea;
    var limpiar = function () { if (cargosVentaEnCurso[clave] === tarea) delete cargosVentaEnCurso[clave]; };
    tarea.then(limpiar, limpiar);
    return tarea;
  }

  function guardarMovimiento(clienteId, tipo, monto, motivo, relacion) {
    if (tipo !== "cargo" && tipo !== "abono") {
      return Promise.reject(new Error("cartera: tipo debe ser 'cargo' o 'abono'"));
    }
    var m = Number(monto);
    var redondeado = Number(m.toFixed(2));
    if (!Number.isFinite(m) || !Number.isSafeInteger(Math.round(redondeado * 100)) || !(redondeado > 0)) {
      return Promise.reject(new Error("cartera: monto debe ser finito y de al menos un centavo"));
    }
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
    // Codex 2026-10-07: new sale debts retain an exact, validated sale ID. Manual
    // and legacy debts keep their original shape; never infer links from names.
    if (tipo === "cargo" && relacion && relacion.ventaId) {
      payload.ventaId = String(relacion.ventaId);
    }
    if (relacion && relacion.opId) payload.opId = String(relacion.opId);

    /* UN SOLO CAMINO DE ESCRITURA (fix 2026-08-13). Antes esto emitia
       ":completado" ANTES de registrar, y hechos.js lo persistia por su cuenta:
       dos hechos por un solo movimiento. Ahora se registra primero, se espera a
       que quede en disco, y recien entonces se avisa. El sufijo es
       ":registrado" a proposito: hechos.js solo persiste ":completado", asi que
       este aviso no puede volver a duplicar nada. */
    if (global.AMG && global.AMG.Hechos && global.AMG.Hechos.registrar) {
      var opciones = relacion && relacion.opId ? { repetido: function (hechos) {
        return movimientoExistente(hechos, clienteId, tipo, monto, motivo, relacion);
      }} : null;
      return global.AMG.Hechos.registrar(TIPOS[tipo], payload, opciones).then(function (r) {
        if (!r) throw new Error("cartera: no se pudo guardar el hecho");
        var eb = bus();
        if (eb) eb.emit(TIPOS[tipo] + ":registrado", { payload: payload });
        return r;
      });
    }
    return Promise.reject(new Error("cartera: AMG.Hechos no disponible"));
  }

  /* ---------------------------------------------------------------------------
     Claude 2026-10-07 — LA DEUDA DE UNA VENTA FIADA SIGUE A LA VENTA.
     Un cargo ligado a una venta (por ventaId propio o por un hecho cartera_vinculo) NO aporta
     su monto guardado: aporta el valor ACTUAL de la venta (precioUnit x cantidad hoy).
     Corregir el precio en Sold no escribe NINGUN hecho: la venta ya tiene su propia version
     final (rev / sync), y la deuda la lee de ahi. Por eso dos correcciones concurrentes nunca
     se suman y repetir una correccion no cambia nada.
       valor actual = 0 si la venta esta anulada/devuelta (salvo que una restauracion activa la
                      reemplace: el undo de 30 s crea otra venta con restauracionDe) o si ya no
                      es fiado (info.formaPago !== "fiado").
       Si la venta no se encuentra, o ya es de OTRO cliente, se conserva el monto guardado
       (nunca se perdona deuda por no ver la venta).
     Pagos reales (cartera_abono) no se tocan: si superan el valor de la venta, el saldo queda
     POSITIVO = credito a favor del cliente (convencion existente: deuda negativa).
     --------------------------------------------------------------------------- */
  function _centavos(n) { return Math.round((Number(n) || 0) * 100); }
  function _ventasActuales(ventas) {
    if (Array.isArray(ventas)) return ventas;
    try { if (global.AMG && typeof global.AMG.ventasActuales === "function") return global.AMG.ventasActuales(); } catch (_) {}
    return null;
  }
  // Sigue la cadena anulada -> restaurada (undo) hasta la venta vigente.
  function _ventaEfectiva(v, restauradaDe, vistas) {
    if (!v || vistas[v.id]) return v;
    vistas[v.id] = true;
    if (v.anulada && restauradaDe[v.id]) return _ventaEfectiva(restauradaDe[v.id], restauradaDe, vistas);
    return v;
  }
  function _centavosVenta(v) {
    if (!v || v.anulada || v.devuelta) return 0;
    if (!v.info || v.info.formaPago !== "fiado") return 0;
    return _centavos((Number(v.precioUnit) || 0) * (Number(v.cantidad) || 0));
  }
  // cargoId -> ventaId vigente (ultimo hecho por ts, desempate por id) o null si se deshizo.
  function _vinculosManuales(todos, clienteId) {
    var mapa = {};
    todos.filter(function (h) { return h.tipo === VINCULO && String(_d(h).clienteId || "") === String(clienteId); })
      .sort(function (a, b) { return (Number(a.ts) || 0) - (Number(b.ts) || 0) || String(a.id).localeCompare(String(b.id)); })
      .forEach(function (h) {
        var d = _d(h);
        if (!d.cargoId) return;
        mapa[String(d.cargoId)] = (d.accion === "vincular" && d.ventaId) ? String(d.ventaId) : null;
      });
    return mapa;
  }
  /* Claude 2026-10-21 (reclamo de Belen; decision de JFC «elige quien cobra»): APLICACION de un
     abono a consumos fiados concretos. Hecho aditivo cartera_aplicacion
     { clienteId, abonoId, cargoKey, monto, accion: "aplicar"|"desaplicar", quien }.
     - NO cambia el saldo (sigue siendo cargos - abonos): solo etiqueta cada consumo como
       pagado / parcial / pendiente y cada abono con su parte «sin asignar».
     - Nunca hay reparto automatico (FIFO prohibido en las notas de JFC): los abonos viejos
       quedan «sin asignar» hasta que una persona los aplique.
     - cargoKey = "venta:<ventaId>" si el consumo tiene venta (estable entre aparatos),
       si no "cargo:<id del hecho>". Deshacer = otro hecho "desaplicar" con el mismo par.
     - Lectores viejos filtran solo cartera_cargo/cartera_abono: este hecho no les afecta. */
  var APLICACION = "cartera_aplicacion";
  /* v557 fast-track: proyectar aplicaciones en un orden comun, no sumar a ciegas.
     Los hechos incompatibles se CONSERVAN como evidencia; no se acreditan dos
     veces ni pueden hacer negativa la capacidad de un cargo o un abono.
     Se aceptan los hechos unitarios anteriores y el nuevo lote atomico. */
  function _partesAplicacion(d) {
    return Array.isArray(d.partes) ? d.partes : [{ cargoKey: d.cargoKey, monto: d.monto }];
  }
  function _aplicaciones(todos, clienteId, movimientos) {
    var limitesCargo = Object.create(null), limitesAbono = Object.create(null);
    (movimientos || []).forEach(function (m) {
      if (m.tipo === "cargo") limitesCargo[claveCargo(m)] = _centavos(m.monto);
      else limitesAbono[String(m.id)] = _centavos(m.monto);
    });
    var vigente = Object.create(null), porCargo = Object.create(null), porAbono = Object.create(null);
    var conflictos = 0, opIds = Object.create(null), aceptadas = [];
    todos.filter(function (h) {
      return h.tipo === APLICACION && String(_d(h).clienteId || "") === String(clienteId);
    }).sort(function (a, b) {
      return (Number(a.ts) || 0) - (Number(b.ts) || 0) || String(a.id).localeCompare(String(b.id));
    }).forEach(function (h) {
      var d = _d(h), ab = String(d.abonoId || "");
      if (!ab || !Object.prototype.hasOwnProperty.call(limitesAbono, ab)) { conflictos++; return; }
      if (d.accion === "desaplicar") {
        var undoKey = ab + "|" + String(d.cargoKey || ""), previo = vigente[undoKey] || 0;
        if (previo > 0) {
          porCargo[String(d.cargoKey)] -= previo;
          porAbono[ab] -= previo;
          delete vigente[undoKey];
        }
        return;
      }
      if (d.accion !== "aplicar") { conflictos++; return; }
      var opId = String(d.opId || "");
      if (opId && opIds[opId]) {
        if (opIds[opId] !== JSON.stringify([ab, _partesAplicacion(d)])) conflictos++;
        else aceptadas.push(String(h.id)); // mismo comando remoto: un efecto, ambos ACK válidos
        return;
      }
      var partes = _partesAplicacion(d), pedidoAbono = 0, pedidoCargo = Object.create(null);
      var correcto = partes.length > 0;
      partes.forEach(function (p) {
        var ck = String(p && p.cargoKey || ""), n = Number(p && p.monto), cent = Math.round(n * 100);
        if (!ck || !Number.isFinite(n) || !Number.isSafeInteger(cent) || cent < 1 ||
            !Object.prototype.hasOwnProperty.call(limitesCargo, ck) ||
            Object.prototype.hasOwnProperty.call(pedidoCargo, ck)) { correcto = false; return; }
        pedidoCargo[ck] = cent;
        pedidoAbono += cent;
      });
      if (!correcto || !Number.isSafeInteger(pedidoAbono) ||
          (porAbono[ab] || 0) + pedidoAbono > limitesAbono[ab]) { conflictos++; return; }
      Object.keys(pedidoCargo).forEach(function (ck) {
        if ((porCargo[ck] || 0) + pedidoCargo[ck] > limitesCargo[ck]) correcto = false;
      });
      if (!correcto) { conflictos++; return; }
      Object.keys(pedidoCargo).forEach(function (ck) {
        var k = ab + "|" + ck, cent = pedidoCargo[ck];
        vigente[k] = (vigente[k] || 0) + cent;
        porCargo[ck] = (porCargo[ck] || 0) + cent;
        porAbono[ab] = (porAbono[ab] || 0) + cent;
      });
      if (opId) opIds[opId] = JSON.stringify([ab, partes]);
      aceptadas.push(String(h.id));
    });
    return { vigente: vigente, conflictos: conflictos, aceptadas: aceptadas };
  }
  function claveCargo(mov) { return mov.ventaId ? "venta:" + String(mov.ventaId) : "cargo:" + String(mov.id); }
  function _marcarConsumos(movimientos, todos, clienteId) {
    var proyectado = _aplicaciones(todos, clienteId, movimientos);
    var apps = proyectado.vigente, porCargo = Object.create(null), porAbono = Object.create(null);
    Object.keys(apps).forEach(function (k) {
      var i = k.indexOf("|"), ab = k.slice(0, i), ck = k.slice(i + 1);
      porCargo[ck] = (porCargo[ck] || 0) + apps[k];
      porAbono[ab] = (porAbono[ab] || 0) + apps[k];
    });
    movimientos.forEach(function (m) {
      var monto = _centavos(m.monto);
      if (m.tipo === "cargo") {
        m.cargoKey = claveCargo(m);
        var ap = porCargo[m.cargoKey] || 0;
        m.aplicado = ap / 100;
        m.pendiente = (monto - ap) / 100;
        m.estado = monto <= 0 ? "sin-valor" : ap >= monto ? "pagado" : ap > 0 ? "parcial" : "pendiente";
      } else {
        var a = porAbono[String(m.id)] || 0;
        m.aplicado = a / 100;
        m.sinAsignar = (monto - a) / 100;
      }
    });
    movimientos.conflictosAplicacion = proyectado.conflictos;
    movimientos.aplicacionesAceptadas = proyectado.aceptadas;
    return movimientos;
  }
  /* Rechazo integral antes de tocar el ledger; se revalida dentro de la cola
     unica de Hechos.registrar para evitar dos escrituras locales sobre la
     misma foto del saldo. La concurrencia REMOTA converge por _aplicaciones. */
  function _validarPartesAplicacion(todos, clienteId, abonoId, partes, ventas) {
    var r = calcularSaldo(todos, clienteId, _ventasActuales(ventas));
    var abono = r.movimientos.find(function (m) {
      return m.tipo === "abono" && String(m.id) === String(abonoId);
    });
    if (!abono) throw new Error("cartera: el abono no pertenece a este cliente");
    var libre = _centavos(abono.sinAsignar), pedido = 0, vistos = Object.create(null), normal = [];
    partes.forEach(function (p) {
      var ck = String(p && p.cargoKey || ""), n = Number(p && p.monto), cent = Math.round(n * 100);
      if (!ck || vistos[ck]) throw new Error("cartera: consumo repetido en la misma asignación");
      vistos[ck] = true;
      var cargo = r.movimientos.find(function (m) {
        return m.tipo === "cargo" && m.cargoKey === ck;
      });
      if (!cargo) throw new Error("cartera: consumo no encontrado");
      if (!Number.isFinite(n) || !Number.isSafeInteger(cent) || !(cent > 0) ||
          cent > _centavos(cargo.pendiente)) {
        throw new Error("cartera: el monto supera lo que falta pagar de ese consumo");
      }
      pedido += cent;
      normal.push({ cargoKey: ck, monto: cent / 100 });
    });
    if (!Number.isSafeInteger(pedido) || pedido > libre) {
      throw new Error("cartera: el monto supera lo que queda sin asignar de ese pago");
    }
    return normal;
  }
  function _mismaAplicacion(h, clienteId, abonoId, partes) {
    var d = _d(h);
    var prev = _partesAplicacion(d);
    return h.tipo === APLICACION && d.accion === "aplicar" &&
      String(d.clienteId) === String(clienteId) && String(d.abonoId) === String(abonoId) &&
      JSON.stringify(prev) === JSON.stringify(partes);
  }
  function aplicarAbono(clienteId, abonoId, partes, ventas, opId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos ||
        !global.AMG.Hechos.registrar) return Promise.reject(new Error("cartera: AMG.Hechos no disponible"));
    if (!abonoId || !Array.isArray(partes) || !partes.length) return Promise.reject(new Error("cartera: falta el abono o los consumos elegidos"));
    if (opId !== undefined && (typeof opId !== "string" || !opId.trim() || opId.length > 160)) {
      return Promise.reject(new Error("cartera: referencia de asignación inválida"));
    }
    var clave = opId || "";
    return global.AMG.Hechos.todos().then(function (todos) {
      function buscarRepetido(lista) {
        if (!clave) return null;
        var anterior = lista.find(function (h) { return h.tipo === APLICACION && String(_d(h).opId || "") === clave; });
        if (!anterior) return null;
        if (!_mismaAplicacion(anterior, clienteId, abonoId, partes)) {
          var e = new Error("cartera: la referencia pertenece a otra asignación");
          e.status = 409; throw e;
        }
        return anterior;
      }
      var previo = buscarRepetido(todos);
      if (previo) return previo;
      var normal = _validarPartesAplicacion(todos, clienteId, abonoId, partes, ventas);
      var payload = {
        clienteId: String(clienteId), abonoId: String(abonoId),
        partes: normal, accion: "aplicar",
        quien: (function () { try { return (global.OCAuth && global.OCAuth.usuarioActual && global.OCAuth.usuarioActual().nombre) || "Sistema"; } catch (_) { return "Sistema"; } })()
      };
      if (clave) payload.opId = clave;
      return global.AMG.Hechos.registrar(APLICACION, payload, {
        repetido: function (lista) {
          var viejo = buscarRepetido(lista);
          if (viejo) return viejo;
          _validarPartesAplicacion(lista, clienteId, abonoId, partes, ventas);
          return null;
        }
      }).then(function (r) {
        if (!r) throw new Error("cartera: no se pudo confirmar la asignación; el pago permanece guardado");
        var eb = bus();
        if (eb) eb.emit(APLICACION + ":registrado", { payload: payload });
        return r;
      });
    });
  }
  function desaplicarAbono(clienteId, abonoId, cargoKey) {
    return global.AMG.Hechos.registrar(APLICACION, { clienteId: String(clienteId), abonoId: String(abonoId),
      cargoKey: String(cargoKey), monto: 0, accion: "desaplicar", quien: "Sistema" });
  }

  /* Funcion PURA (sin storage): todos = hechos; ventas = ventas actuales o null (=> montos guardados). */
  function calcularSaldo(todos, clienteId, ventas) {
    var mios = _sinDuplicados(todos.filter(function (h) {
      return (h.tipo === TIPOS.cargo || h.tipo === TIPOS.abono) &&
        String(_d(h).clienteId || "") === String(clienteId);
    }), "clienteId");
    var vinculos = _vinculosManuales(todos, clienteId);
    var porId = {}, restauradaDe = {};
    (ventas || []).forEach(function (v) {
      if (!v || !v.id) return;
      porId[v.id] = v;
      if (v.restauracionDe && !v.anulada) restauradaDe[v.restauracionDe] = v;
    });
    var centavos = 0;
    var movimientos = mios.map(function (h) {
      var esCargo = h.tipo === TIPOS.cargo;
      var d = _d(h);
      var guardado = _centavos(d.monto);
      var aporta = guardado, ventaId = "", manual = false;
      if (esCargo) {
        var propio = d.ventaId ? String(d.ventaId) : "";
        var manualId = vinculos[String(h.id)] || "";
        ventaId = propio || manualId;
        manual = !propio && !!manualId;
        var v = ventas && ventaId ? porId[ventaId] : null;
        // v490 (2026-10-13): a walk-in sale (no customer) also follows the sale,
        // so a receipt left by a failed walk-in -> on-account save adds 0 while
        // the sale is still cash. Sales of ANOTHER customer keep the stored amount.
        if (v && (String(v.clienteId || "") === String(clienteId) || !v.clienteId)) {
          aporta = _centavosVenta(_ventaEfectiva(v, restauradaDe, {}));
        }
      }
      centavos += (esCargo ? -1 : 1) * aporta;
      var mov = { id: h.id, tipo: esCargo ? "cargo" : "abono", monto: aporta / 100,
        motivo: d.motivo || "", quien: d.quien || "", fecha: h.ts };
      if (esCargo) { mov.montoOriginal = guardado / 100; mov.ventaId = ventaId; mov.vinculoManual = manual; }
      return mov;
    });
    /* New fiado sales carry a durable obligation with their sale record.
       If the second-stage receipt was interrupted, derive it here. If the
       receipt was saved, it wins and the synthetic charge disappears.
       Legacy (unmarked) sales retain the receipt-only behavior. */
    if (Array.isArray(ventas)) {
      var recibidas = Object.create(null);
      todos.forEach(function (h) {
        if (h.tipo !== TIPOS.cargo) return;
        var d = _d(h);
        if (d.ventaId) recibidas[String(d.ventaId)] = true;
      });
      mios.forEach(function (h) {
        if (h.tipo !== TIPOS.cargo) return;
        var mid = vinculos[String(h.id)];
        if (mid) recibidas[String(mid)] = true;
      });
      // An annulled sale and its restored copy are ONE effective debt.
      // Dedupe by effective ID, not by the historical sale ID being traversed.
      var recibidasEfectivas = Object.create(null), vistasEfectivas = Object.create(null);
      Object.keys(recibidas).forEach(function (id) {
        var v = porId[id];
        var efectiva = v ? _ventaEfectiva(v, restauradaDe, {}) : null;
        recibidasEfectivas[String(efectiva && efectiva.id || id)] = true;
      });
      Object.keys(porId).forEach(function (id) {
        var v = porId[id];
        if (!v || !v.info || v.info.fiadoAtomico !== true ||
            v.info.formaPago !== "fiado" || String(v.clienteId || "") !== String(clienteId)) return;
        var efectiva = _ventaEfectiva(v, restauradaDe, {});
        if (!efectiva || !efectiva.id) return;
        var vigenteId = String(efectiva.id);
        if (vistasEfectivas[vigenteId] || recibidasEfectivas[vigenteId]) return;
        vistasEfectivas[vigenteId] = true;
        var importe = _centavosVenta(efectiva);
        if (importe <= 0) return;
        centavos -= importe;
        movimientos.push({
          id: "fiado-venta-" + vigenteId, tipo: "cargo", monto: importe / 100,
          montoOriginal: importe / 100, motivo: "Venta fiada",
          quien: "", fecha: Number(new Date(efectiva.fecha).getTime()) || 0,
          ventaId: vigenteId, vinculoManual: false, fiadoAtomico: true
        });
      });
    }
    movimientos.sort(function (a, b) { return a.fecha - b.fecha; });
    _marcarConsumos(movimientos, todos, clienteId);
    return { saldo: +(centavos / 100).toFixed(2), movimientos: movimientos,
      conflictosAplicacion: movimientos.conflictosAplicacion || 0,
      aplicacionesAceptadas: movimientos.aplicacionesAceptadas || [] };
  }

  // Deriva el saldo y el historial de UN cliente reproduciendo todos los
  // hechos conocidos. Nunca lee ni escribe un campo "saldo" guardado.
  // Claude 2026-10-07: segundo argumento opcional = ventas actuales (si falta se pide a
  // AMG.ventasActuales(); si tampoco existe, los cargos se leen por su monto guardado).
  function saldoDeCliente(clienteId, ventas) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) {
      return Promise.resolve({ saldo: 0, movimientos: [] });
    }
    return global.AMG.Hechos.todos().then(function (todos) {
      var r = calcularSaldo(todos, clienteId, _ventasActuales(ventas));
      return Promise.resolve(global.AMG.Hechos.verificarCadenas(todos)).then(function (integridad) {
        return { saldo: r.saldo, movimientos: r.movimientos, integridad: integridad, conflictosAplicacion: r.conflictosAplicacion,
          aplicacionesAceptadas: r.aplicacionesAceptadas };
      });
    });
  }

  /* Claude 2026-10-07 — VINCULO MANUAL de un cargo antiguo a su venta (solo dueno/admin; el
     permiso y la validacion de la venta —mismo cliente, fiado, activa, sin otro cargo— los hace
     mock-backend, que es quien ve las ventas). Nunca por heuristica de nombre/monto/fecha: el
     llamador pasa el cargoId y la ventaId elegidos por una persona. */
  function _cargoDe(todos, clienteId, cargoId) {
    return todos.find(function (h) {
      return h.tipo === TIPOS.cargo && String(h.id) === String(cargoId) &&
        String(_d(h).clienteId || "") === String(clienteId);
    });
  }
  function _registrarVinculo(clienteId, cargoId, ventaId, accion) {
    var payload = {
      clienteId: String(clienteId), cargoId: String(cargoId),
      ventaId: ventaId ? String(ventaId) : null, accion: accion,
      quien: (function () {
        try { return (global.OCAuth && global.OCAuth.usuarioActual && global.OCAuth.usuarioActual().nombre) || "Sistema"; } catch (_) { return "Sistema"; }
      })()
    };
    return global.AMG.Hechos.registrar(VINCULO, payload).then(function (r) {
      if (!r) throw new Error("cartera: no se pudo guardar el hecho");
      var eb = bus();
      if (eb) eb.emit(VINCULO + ":registrado", { payload: payload });
      return r;
    });
  }
  function vincularCargo(clienteId, cargoId, ventaId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) return Promise.reject(new Error("cartera: AMG.Hechos no disponible"));
    return global.AMG.Hechos.todos().then(function (todos) {
      var cargo = _cargoDe(todos, clienteId, cargoId);
      if (!cargo) throw new Error("cartera: cargo no encontrado para este cliente");
      if (_d(cargo).ventaId) throw new Error("cartera: este cargo ya nacio ligado a su venta");
      if (_vinculosManuales(todos, clienteId)[String(cargoId)]) throw new Error("cartera: este cargo ya esta vinculado");
      return _registrarVinculo(clienteId, cargoId, ventaId, "vincular");
    });
  }
  function desvincularCargo(clienteId, cargoId) {
    if (!global.AMG || !global.AMG.Hechos || !global.AMG.Hechos.todos) return Promise.reject(new Error("cartera: AMG.Hechos no disponible"));
    return global.AMG.Hechos.todos().then(function (todos) {
      if (!_cargoDe(todos, clienteId, cargoId)) throw new Error("cartera: cargo no encontrado para este cliente");
      if (!_vinculosManuales(todos, clienteId)[String(cargoId)]) throw new Error("cartera: este cargo no tiene vinculo manual");
      return _registrarVinculo(clienteId, cargoId, null, "desvincular");
    });
  }
  /* Para la pantalla de vinculo: saldo antes/despues de ligar el cargo a cada venta candidata
     (mismo cliente, fiado, activa, que aun no tiene otro cargo). */
  function opcionesVinculo(clienteId, cargoId, ventas) {
    return global.AMG.Hechos.todos().then(function (todos) {
      var cargo = _cargoDe(todos, clienteId, cargoId);
      if (!cargo || _d(cargo).ventaId || _vinculosManuales(todos, clienteId)[String(cargoId)]) return null;
      var base = calcularSaldo(todos, clienteId, ventas);
      var ocupadas = {};
      base.movimientos.forEach(function (m) { if (m.ventaId) ocupadas[m.ventaId] = true; });
      var opciones = (ventas || []).filter(function (v) {
        return v && v.id && !ocupadas[v.id] && !v.anulada && !v.devuelta &&
          String(v.clienteId || "") === String(clienteId) && v.info && v.info.formaPago === "fiado";
      }).map(function (v) {
        var hip = { id: "hipotesis", tipo: VINCULO, ts: Number.MAX_SAFE_INTEGER,
          datos: { clienteId: String(clienteId), cargoId: String(cargoId), ventaId: v.id, accion: "vincular" } };
        return { ventaId: v.id, valorActual: _centavosVenta(v) / 100, saldoAntes: base.saldo,
          saldoDespues: calcularSaldo(todos.concat([hip]), clienteId, ventas).saldo };
      });
      return { cargo: { id: cargo.id, monto: Number(_d(cargo).monto) || 0, motivo: _d(cargo).motivo || "" }, opciones: opciones };
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
      integridad: saldoInfo.integridad,
      conflictosAplicacion: saldoInfo.conflictosAplicacion || 0,
      tienePendiente: saldoInfo.saldo < 0,
      // El encargado ve el saldo de ESTE cliente (case by case), pero nunca el
      // historial completo de movimientos ni la posibilidad de exportar.
      historial: esEmpleado ? [] : saldoInfo.movimientos,
      // 2026-10-21 (fiados de Belen): para COBRAR, todo rol necesita ver que consumos
      // siguen abiertos. Solo lo minimo (sin quien registro ni pagos ajenos).
      consumosPendientes: (saldoInfo.movimientos || []).filter(function (m) {
        return m.tipo === "cargo" && (m.estado === "pendiente" || m.estado === "parcial");
      }).map(function (m) {
        return { cargoKey: m.cargoKey, motivo: m.motivo, fecha: m.fecha, monto: m.monto, pendiente: m.pendiente, estado: m.estado };
      }),
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
    VERSION: "1.2.0-fiado-sigue-venta",
    registrarMovimiento: registrarMovimiento,
    // JFC-approved sale corrections keep the original receipt. Its current
    // amount comes from the durable sale projection, never a second charge.
    asegurarCargoVenta: function (clienteId, monto, motivo, ventaId) {
      if (!ventaId) return Promise.reject(new Error("cartera: falta ventaId"));
      if (!Number.isFinite(Number(monto)) || !Number.isSafeInteger(Math.round(Number(monto) * 100)) || Math.round(Number(monto) * 100) < 1) {
        return Promise.reject(new Error("cartera: monto debe ser finito y de al menos un centavo"));
      }
      return global.AMG.Cartera.registrarMovimiento(clienteId, "cargo", monto, motivo, { ventaId: ventaId }, true);
    },
    saldoDeCliente: saldoDeCliente,
    calcularSaldo: calcularSaldo,
    vincularCargo: vincularCargo,
    aplicarAbono: aplicarAbono,
    desaplicarAbono: desaplicarAbono,
    claveCargo: claveCargo,
    desvincularCargo: desvincularCargo,
    opcionesVinculo: opcionesVinculo,
    vistaCarteraSegunRol: vistaCarteraSegunRol,
    alertaActiva: alertaActiva,
    fijarAlerta: fijarAlerta
  };
})(typeof window !== "undefined" ? window : this);
