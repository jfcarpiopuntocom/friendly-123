/*!
 * panel-licencias.js — friendly-123 · Lista dinamica de licencias del panel
 * maestro (JFC 2026-09-24). Pensada para 1.000-10.000 licencias por gremios.
 * ============================================================================
 * POR QUE EXISTE. La lista vieja (inline en panel.html) re-armaba TODA la
 * tabla en cada tecla del buscador, sin paginar, sin orden por columna, sin
 * seleccion multiple y con texto gris de 12px en las filas plegadas. Con 30
 * licencias no se notaba; con 3.000 se congela el navegador y JFC no puede
 * cambiar de estado 200 licencias de un gremio sin 200 clics.
 *
 * QUE HACE (logica pura, sin tocar el DOM salvo en pintar()):
 *   indexar()   una pasada: normaliza, agrupa por licencia (una licencia = un
 *               negocio = una fila; los aparatos extra se pliegan), elige la
 *               cabeza por identidad completa (el cliente antes que el aparato
 *               de pruebas de JFC), y precomputa el texto de busqueda.
 *   filtrar()   texto + estado + lote + pago + inactividad, sobre los grupos.
 *   ordenar()   por columna, estable.
 *   paginar()   100 por pagina: pintar 100 filas es instantaneo; 10.000 no.
 *   stats()     totales honestos (licencias, aparatos, pagadas, vencidas,
 *               inactivas 30 dias).
 *   ejecutarEnLotes()  acciones masivas con concurrencia acotada (4) y
 *               reporte de fallos por item: nunca se para a la mitad en
 *               silencio, nunca dispara 500 fetch a la vez contra el Worker.
 *   csv()       exporta lo FILTRADO (lo que ves es lo que bajas).
 *   pintar()    la tabla, con checkbox por fila, pagos y lote.
 *
 * REGLAS QUE NO SE ROMPEN (DESIGN.md): tinta de verdad (nada gris/opaco),
 * minimo 13px, cuatro esquinas, sin emojis. Lo pagado no se edita: un pago
 * malo se corrige con otro asiento negativo (ver worker.js).
 *
 * DEPENDE de panel.html: licEsc, licFmtDate, licWaHref, licNormEstado,
 * licEditarCampo, licCambiarEstado, licToggleDisp, licUnificarNombre,
 * licAMiLicencia, licEmitirMaestro, licReenganchar, licBorrar (globales).
 */
(function (global) {
  "use strict";

  var MI_CORREO = "jfcarpio@gmail.com";
  var TAM_PAGINA = 100;
  var DIA_MS = 86400000;

  function norm(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }
  function normCod(s) { return String(s || "").trim().toUpperCase(); }
  function esMio(r) { return norm(r && r.email) === MI_CORREO; }
  function puntajeIdentidad(r) {
    var p = 0;
    if (String(r && r.nombreNegocio || "").trim()) p += 2;
    if (String(r && r.nombre || "").trim()) p += 1;
    if (String(r && r.apellido || "").trim()) p += 1;
    if (String(r && r.email || "").trim()) p += 1;
    return p;
  }
  function ts(v) { var n = v instanceof Date ? v.getTime() : (typeof v === "number" ? v : Date.parse(v)); return Number.isFinite(n) ? n : 0; }
  function nombreCompleto(r) { return ((r.nombre || "") + " " + (r.apellido || "")).trim(); }

  /* ---------- indexar ---------- */
  function indexar(rows, opciones) {
    var lotes = (opciones && opciones.lotes) || [];           // [{etiqueta, codigos:[]}]
    var codigoALote = {};
    lotes.forEach(function (l) { (l.codigos || []).forEach(function (c) { codigoALote[normCod(c)] = l.etiqueta; }); });
    var ahora = (opciones && opciones.ahora) || Date.now();
    var grupos = [], idx = {}, porEmail = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var cod = normCod(r.licenseCode);
      var e = norm(r.email);
      if (e) { (porEmail[e] = porEmail[e] || {})[cod] = true; }
      if (!cod) { grupos.push({ cod: "", filas: [r] }); return; }
      if (idx[cod] === undefined) { idx[cod] = grupos.length; grupos.push({ cod: cod, filas: [] }); }
      grupos[idx[cod]].filas.push(r);
    });
    grupos.forEach(function (g) {
      var cliente = g.filas.filter(function (x) { return !esMio(x); });
      var mios = g.filas.filter(esMio);
      cliente.sort(function (a, b) { return (puntajeIdentidad(b) - puntajeIdentidad(a)) || (ts(b.lastSeen) - ts(a.lastSeen)); });
      g.filas = cliente.concat(mios);
      var c = g.filas[0];
      g.cabeza = c;
      g.n = g.filas.length;
      g.nCliente = cliente.length;
      g.nMios = mios.length;
      g.soloJfc = g.n > 1 && g.nMios === g.n && !!g.cod;
      g.estado = global.licNormEstado ? global.licNormEstado(c.estado) : String(c.estado || "minima");
      g.lastSeen = Math.max.apply(null, g.filas.map(function (x) { return ts(x.lastSeen); }));
      g.activatedAt = g.filas.map(function (x) { return ts(x.activatedAt); }).filter(Boolean).sort()[0] || 0;
      g.lote = codigoALote[g.cod] || (g.filas.map(function (x) { return x.lote; }).filter(Boolean)[0]) || "";
      g.pago = g.filas.map(function (x) { return x.pagoResumen; }).filter(function (p) { return p && p.n; })
        .sort(function (a, b) { return (b.n || 0) - (a.n || 0); })[0] || null;
      g.vencida = !!(g.pago && g.pago.hasta && ts(g.pago.hasta) < ahora);
      g.diasInactivo = g.lastSeen ? Math.floor((ahora - g.lastSeen) / DIA_MS) : null;
      var em = norm(c.email);
      g.mismoEmail = em && porEmail[em] ? Object.keys(porEmail[em]).filter(Boolean).length : 0;
      /* El prefijo fijo "F123-" NO entra al texto de busqueda: buscar "12" o
         "f1" daria las 3.000 licencias (cazado por el humo en Chromium). */
      g.q = norm(g.filas.map(function (x) {
        return [String(x.licenseCode || "").replace(/^F123-/i, ""), x.nombreNegocio, x.nombre, x.apellido, x.email, x.whatsapp, x.cedula, x.instanceId].join(" ");
      }).join(" ") + " " + g.lote);
    });
    return { grupos: grupos, total: (rows || []).length };
  }

  /* ---------- filtrar / ordenar / paginar ---------- */
  function filtrar(grupos, f) {
    f = f || {};
    var q = norm(f.q), est = f.estado || "", lote = norm(f.lote), pago = f.pago || "";
    var dias = Number(f.inactivoDias) || 0;
    var palabras = q ? q.split(/\s+/) : [];
    return grupos.filter(function (g) {
      if (est && g.estado !== est) return false;
      if (lote && norm(g.lote) !== lote) return false;
      if (pago === "con" && !g.pago) return false;
      if (pago === "sin" && g.pago) return false;
      if (pago === "vencido" && !g.vencida) return false;
      if (dias && !(g.diasInactivo !== null && g.diasInactivo >= dias)) return false;
      for (var i = 0; i < palabras.length; i++) if (g.q.indexOf(palabras[i]) === -1) return false;
      return true;
    });
  }

  var CLAVES_ORDEN = {
    lastSeen: function (g) { return g.lastSeen; },
    activatedAt: function (g) { return g.activatedAt; },
    estado: function (g) { return ({ full: 0, minima: 1, bloqueada: 2 })[g.estado] != null ? ({ full: 0, minima: 1, bloqueada: 2 })[g.estado] : 9; },
    negocio: function (g) { return norm(g.cabeza.nombreNegocio); },
    nombre: function (g) { return norm(nombreCompleto(g.cabeza)); },
    codigo: function (g) { return g.cod; },
    lote: function (g) { return norm(g.lote); },
    pago: function (g) { return g.pago ? (g.pago.total || 0) : -1; },
    dispositivos: function (g) { return g.n; }
  };
  function ordenar(grupos, campo, dir) {
    var k = CLAVES_ORDEN[campo] || CLAVES_ORDEN.lastSeen;
    var s = dir === "asc" ? 1 : -1;
    return grupos.map(function (g, i) { return { g: g, i: i, k: k(g) }; })
      .sort(function (a, b) { return (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) * s || (a.i - b.i); })
      .map(function (x) { return x.g; });
  }
  function paginar(lista, pagina, tam) {
    tam = tam || TAM_PAGINA;
    var paginas = Math.max(1, Math.ceil(lista.length / tam));
    var p = Math.min(Math.max(1, pagina || 1), paginas);
    return { items: lista.slice((p - 1) * tam, p * tam), pagina: p, paginas: paginas, total: lista.length, tam: tam };
  }

  /* ---------- stats ---------- */
  function stats(grupos) {
    var s = { licencias: 0, demos: 0, dispositivos: 0, full: 0, minima: 0, bloqueada: 0, pagadas: 0, vencidas: 0, inactivas30: 0, totalCobrado: 0 };
    grupos.forEach(function (g) {
      if (g.cod) s.licencias++; else s.demos++;
      s.dispositivos += g.nCliente || g.n;
      if (s[g.estado] !== undefined) s[g.estado]++;
      if (g.pago) { s.pagadas++; s.totalCobrado += Number(g.pago.total) || 0; }
      if (g.vencida) s.vencidas++;
      if (g.diasInactivo !== null && g.diasInactivo >= 30) s.inactivas30++;
    });
    s.totalCobrado = +s.totalCobrado.toFixed(2);
    return s;
  }

  /* ---------- acciones masivas ---------- */
  function ejecutarEnLotes(items, fn, opciones) {
    opciones = opciones || {};
    var conc = Math.max(1, Math.min(8, opciones.concurrencia || 4));
    var ok = [], fallos = [], i = 0, hechos = 0;
    var lista = items.slice();
    return new Promise(function (resolver) {
      if (!lista.length) return resolver({ ok: ok, fallos: fallos });
      var activos = 0;
      /* lanzar() recibe el item como parametro a proposito: con un `var item`
         dentro del while, los 4 primeros callbacks veian el MISMO item (el
         ultimo despachado) y el reporte de fallos mentia (cazado por
         test/panel-licencias.test.js: "3:boom" cuatro veces). */
      function lanzar(item) {
        activos++;
        Promise.resolve().then(function () { return fn(item); }).then(
          function (r) { ok.push({ item: item, resultado: r }); },
          function (e) { fallos.push({ item: item, error: (e && e.message) || String(e) }); }
        ).then(function () {
          activos--; hechos++;
          try { if (opciones.onProgreso) opciones.onProgreso(hechos, lista.length, fallos.length); } catch (_) {}
          if (hechos === lista.length) resolver({ ok: ok, fallos: fallos }); else siguiente();
        });
      }
      function siguiente() {
        while (activos < conc && i < lista.length) lanzar(lista[i++]);
      }
      siguiente();
    });
  }

  /* ---------- csv ---------- */
  function csvCelda(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
  function csv(grupos, fmtFecha) {
    fmtFecha = fmtFecha || function (t) { return t ? new Date(t).toISOString() : ""; };
    var cols = ["licenseCode", "lote", "estado", "nombreNegocio", "nombre", "email", "whatsapp", "cedula", "dispositivos", "pagos", "totalPagado", "pagadoHasta", "activatedAt", "lastSeen", "instanceId"];
    var filas = grupos.map(function (g) {
      var c = g.cabeza;
      return [g.cod, g.lote, g.estado, c.nombreNegocio, nombreCompleto(c), c.email, c.whatsapp, c.cedula, g.n,
        g.pago ? g.pago.n : 0, g.pago ? g.pago.total : "", g.pago ? (g.pago.hasta || "") : "", fmtFecha(g.activatedAt), fmtFecha(g.lastSeen), c.instanceId].map(csvCelda).join(",");
    });
    return [cols.join(",")].concat(filas).join("\n");
  }
  function csvCodigos(codigos, etiqueta) {
    return ["codigo,lote"].concat((codigos || []).map(function (c) { return csvCelda(c) + "," + csvCelda(etiqueta); })).join("\n");
  }

  /* ---------- pintar (unico punto que toca el DOM) ---------- */
  var estadoUI = { pagina: 1, orden: "lastSeen", dir: "desc", seleccion: {}, ultimaLista: [] };
  function pintar(indice, filtros, ids) {
    ids = ids || {};
    var esc = global.licEsc || function (s) { return String(s == null ? "" : s); };
    var fmt = global.licFmtDate || function (t) { return t ? new Date(t).toLocaleString() : "—"; };
    var wa = global.licWaHref || function () { return ""; };
    var lista = ordenar(filtrar(indice.grupos, filtros), estadoUI.orden, estadoUI.dir);
    estadoUI.ultimaLista = lista;
    var pag = paginar(lista, estadoUI.pagina);
    estadoUI.pagina = pag.pagina;
    var tb = document.getElementById(ids.tbody || "lic-tbody");
    var vacio = document.getElementById(ids.vacio || "lic-empty");
    var tabla = document.getElementById(ids.tabla || "lic-tabla");
    if (!tb) return pag;
    if (!lista.length) { if (vacio) vacio.style.display = "block"; if (tabla) tabla.style.display = "none"; tb.innerHTML = ""; pintarPaginacion(pag, ids); return pag; }
    if (vacio) vacio.style.display = "none"; if (tabla) tabla.style.display = "table";
    var html = [];
    pag.items.forEach(function (g) {
      var r = g.cabeza, id = esc(r.instanceId), est = g.estado, n = g.n;
      var etiquetaDisp = g.nCliente ? (g.nCliente + " device" + (g.nCliente === 1 ? "" : "s") + (g.nMios > 0 ? " · +" + g.nMios + " tuyo" + (g.nMios === 1 ? "" : "s") : "")) : (n + " device" + (n === 1 ? "" : "s"));
      var chipClaim = g.mismoEmail >= 2 ? ' <span class="lic-chip" title="Same email on ' + g.mismoEmail + ' licenses — likely the same person. Use claim &amp; merge in the app.">same email on ' + g.mismoEmail + ' licenses</span>' : "";
      var pago = g.pago
        ? '<strong>' + esc((g.pago.moneda || "USD") + " " + Number(g.pago.total || 0).toFixed(2)) + '</strong><br><span class="lic-sub">' + g.pago.n + ' payment' + (g.pago.n === 1 ? "" : "s") + (g.pago.hasta ? ' · until ' + esc(g.pago.hasta) : "") + (g.vencida ? ' · <span class="lic-badge bloqueada">expired</span>' : "") + '</span>'
        : '<span class="lic-sub">no payment on file</span>';
      var sel = !!estadoUI.seleccion[r.instanceId];
      html.push('<tr' + (sel ? ' class="lic-sel"' : "") + '>' +
        '<td><input type="checkbox" class="lic-check" data-iid="' + id + '" data-cod="' + esc(g.cod) + '"' + (sel ? " checked" : "") + ' aria-label="Select ' + esc(r.nombreNegocio || g.cod || id) + '"></td>' +
        '<td><span class="lic-badge ' + esc(est) + '">' + esc(est) + '</span>' + (g.diasInactivo !== null && g.diasInactivo >= 30 ? '<br><span class="lic-sub">' + g.diasInactivo + ' days quiet</span>' : "") + '</td>' +
        '<td class="mono" style="color:var(--gold);">' + esc(g.cod || "—") + (g.lote ? '<br><span class="lic-chip">' + esc(g.lote) + '</span>' : "") +
          (n > 1 ? '<br><button type="button" class="btn-ok lic-mini" onclick="licToggleDisp(\'' + id + '\')" title="See each device on this license">' + esc(etiquetaDisp) + '</button>' : "") + '</td>' +
        '<td>' + (r.nombreNegocio ? '<strong>' + esc(r.nombreNegocio) + '</strong>' : '—') + ' <button type="button" class="lic-lapiz" onclick="licEditarCampo(\'' + id + '\',\'negocio\')" title="Edit business name">✎</button></td>' +
        '<td>' + esc(nombreCompleto(r) || "—") + ' <button type="button" class="lic-lapiz" onclick="licEditarCampo(\'' + id + '\',\'nombre\')" title="Edit owner name">✎</button></td>' +
        '<td>' + esc(r.email || "—") + (esMio(r) ? ' <span class="lic-chip">tu aparato</span>' : "") + chipClaim + '</td>' +
        '<td>' + (wa(r.whatsapp) ? '<a href="' + esc(wa(r.whatsapp)) + '" target="_blank" rel="noopener" style="color:#25D366;">' + esc(r.whatsapp) + '</a>' : "—") + '</td>' +
        '<td>' + pago + '<br><button type="button" class="btn-ok lic-mini" onclick="licAbrirPago(\'' + id + '\')">Record payment</button> <button type="button" class="btn-ok lic-mini" onclick="licVerPagos(\'' + id + '\')">History</button></td>' +
        '<td class="date">' + esc(fmt(g.activatedAt)) + '</td>' +
        '<td class="date">' + esc(fmt(g.lastSeen)) + '</td>' +
        '<td><select id="lic-sel-' + id + '" aria-label="State">' +
          '<option value="minima"' + (est === "minima" ? " selected" : "") + '>Minimal — free</option>' +
          '<option value="full"' + (est === "full" ? " selected" : "") + '>Full — uncapped</option>' +
          '<option value="bloqueada"' + (est === "bloqueada" ? " selected" : "") + '>Blocked</option>' +
        '</select><button type="button" class="btn-ok" onclick="licCambiarEstado(\'' + id + '\')">OK</button>' +
        '<details class="lic-mas"><summary>More</summary>' +
          (g.soloJfc ? '<button type="button" class="btn-ok lic-mini" onclick="licUnificarNombre(\'' + esc(g.cod) + '\')">Unify my devices\' name</button> ' : "") +
          '<button type="button" class="btn-ok lic-mini" onclick="licAMiLicencia(\'' + id + '\')">Attach to my license</button> ' +
          '<button type="button" class="btn-ok lic-mini" onclick="licEmitirMaestro(\'' + id + '\')">5-min recovery</button> ' +
          '<button type="button" class="btn-ok lic-mini" onclick="licReenganchar(\'' + id + '\')">Re-attach</button> ' +
          '<button type="button" class="btn-ok lic-mini lic-peligro" onclick="licBorrar(\'' + id + '\')">Delete device</button>' +
        '</details></td></tr>');
      g.filas.slice(1).forEach(function (h) {
        var hid = esc(h.instanceId);
        html.push('<tr class="lic-disp lic-disp-' + id + '" style="display:none;">' +
          '<td></td><td class="lic-sub">↳ device</td>' +
          '<td class="mono">' + esc(h.licenseCode || "—") + '</td>' +
          '<td>' + esc(h.nombreNegocio || "—") + '</td>' +
          '<td>' + esc(nombreCompleto(h) || "—") + '</td>' +
          '<td>' + esc(h.email || "—") + (esMio(h) ? ' <span class="lic-chip">tu aparato</span>' : "") + '</td>' +
          '<td>' + (wa(h.whatsapp) ? '<a href="' + esc(wa(h.whatsapp)) + '" target="_blank" rel="noopener" style="color:#25D366;">' + esc(h.whatsapp) + '</a>' : "—") + '</td>' +
          '<td class="lic-sub">same license</td>' +
          '<td class="date">' + esc(fmt(h.activatedAt)) + '</td><td class="date">' + esc(fmt(h.lastSeen)) + '</td>' +
          '<td><button type="button" class="btn-ok lic-mini" onclick="licReenganchar(\'' + hid + '\')">Re-attach</button> ' +
          '<button type="button" class="btn-ok lic-mini lic-peligro" onclick="licBorrar(\'' + hid + '\')">Delete device</button></td></tr>');
      });
    });
    tb.innerHTML = html.join("");
    tb.querySelectorAll(".lic-check").forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (cb.checked) estadoUI.seleccion[cb.dataset.iid] = cb.dataset.cod || true; else delete estadoUI.seleccion[cb.dataset.iid];
        cb.closest("tr").classList.toggle("lic-sel", cb.checked);
        pintarSeleccion(ids);
      });
    });
    pintarPaginacion(pag, ids);
    pintarSeleccion(ids);
    return pag;
  }
  function pintarPaginacion(pag, ids) {
    var el = document.getElementById((ids && ids.paginacion) || "lic-paginacion"); if (!el) return;
    if (pag.total <= pag.tam) { el.innerHTML = pag.total ? pag.total + " license" + (pag.total === 1 ? "" : "s") : ""; return; }
    var desde = (pag.pagina - 1) * pag.tam + 1, hasta = Math.min(pag.total, pag.pagina * pag.tam);
    el.innerHTML = '<button type="button" class="btn-ok lic-mini" ' + (pag.pagina <= 1 ? "disabled" : "") + ' onclick="licPagina(' + (pag.pagina - 1) + ')">Previous</button> ' +
      '<strong>' + desde + '–' + hasta + '</strong> of ' + pag.total + ' · page ' + pag.pagina + '/' + pag.paginas + ' ' +
      '<button type="button" class="btn-ok lic-mini" ' + (pag.pagina >= pag.paginas ? "disabled" : "") + ' onclick="licPagina(' + (pag.pagina + 1) + ')">Next</button>';
  }
  function pintarSeleccion(ids) {
    var el = document.getElementById((ids && ids.seleccion) || "lic-bulk"); if (!el) return;
    var n = Object.keys(estadoUI.seleccion).length;
    el.style.display = n ? "flex" : "none";
    var c = el.querySelector("[data-n]"); if (c) c.textContent = n + " selected";
  }
  function seleccionar(lista, valor) { lista.forEach(function (g) { if (valor) estadoUI.seleccion[g.cabeza.instanceId] = g.cod || true; else delete estadoUI.seleccion[g.cabeza.instanceId]; }); }
  function seleccionados() { return Object.keys(estadoUI.seleccion); }
  function limpiarSeleccion() { estadoUI.seleccion = {}; }

  global.PanelLic = {
    TAM_PAGINA: TAM_PAGINA, MI_CORREO: MI_CORREO,
    indexar: indexar, filtrar: filtrar, ordenar: ordenar, paginar: paginar, stats: stats,
    ejecutarEnLotes: ejecutarEnLotes, csv: csv, csvCodigos: csvCodigos,
    pintar: pintar, ui: estadoUI, seleccionar: seleccionar, seleccionados: seleccionados, limpiarSeleccion: limpiarSeleccion,
    _norm: norm
  };
})(typeof window !== "undefined" ? window : globalThis);
