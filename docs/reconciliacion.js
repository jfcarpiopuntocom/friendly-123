/*!
 * reconciliacion.js — friendly-123 · MICELIO FASE B
 * Gemelo de docs/reconciliacion.js en AMIGABLE. El motor es identico; solo
 * el panel cambia, porque aqui pasa por i18n (t()). Si se corrige un bug de
 * logica, corregirlo en AMBOS.
 * ============================================================================
 * QUE ES
 * ----------------------------------------------------------------------------
 * La Fase A (hechos.js) empezo a guardar HECHOS. Esta fase los LEE por primera
 * vez: reconstruye lo que los hechos dicen que deberia ser el inventario y lo
 * compara contra el estado que la app muestra hoy.
 *
 * REGLA DE ORO DE ESTA FASE — NO ROMPER
 * ----------------------------------------------------------------------------
 * Esta fase MIRA. No corrige, no escribe estado, no toca una sola pantalla.
 * Si encuentra una discrepancia, la reporta y ahi se detiene. Corregir
 * automaticamente seria justo la clase de decision que le corresponde al dueno:
 * una diferencia entre "lo que dicen los hechos" y "lo que dice el estado"
 * puede ser un bug NUESTRO o un robo REAL, y solo quien esta en el local sabe
 * cual de los dos. Adivinar y "arreglar" borraria la evidencia de un robo.
 *
 * POR QUE EXISTE ESTA FASE INTERMEDIA
 * ----------------------------------------------------------------------------
 * Antes de que los hechos manden (Fase C: fusionar entre dispositivos), hay que
 * demostrar que reconstruyen bien. Esta fase corre en silencio junto al sistema
 * real y acumula la prueba. Si durante semanas reconstruye identico, la Fase C
 * se puede encender con confianza. Si no, aparece aqui y no en produccion
 * habiendo ya pisado los datos de alguien.
 *
 * ARCHIVO ANTES DE FUSIONAR (lo mas importante de este archivo)
 * ----------------------------------------------------------------------------
 * JFC: "cuando el usuario se identifica pasa a fusionarse, pero no pueden
 * perderse datos si ya habia trabajado la persona en ese dispositivo... por
 * ultimo guardar todo y luego se puede recuperar."
 *
 * De ahi sale archivar(): guarda una copia COMPLETA e INTOCABLE del estado
 * antes de cualquier operacion que pueda pisar datos. Nunca sobrescribe una
 * copia anterior, nunca poda por antiguedad. Si algo sale mal, restaurar() la
 * devuelve entera. Es barato y es la unica garantia real detras de la promesa
 * de que no se pierde nada.
 *
 * ============================================================================
 */
(function (global) {
  "use strict";

  // FIX (JFC 2026-08-20, bug G2): literal compartido sin querer con
  // AMIGABLE/Consultorio-123 (mismo bug corregido hoy en consultorio-123).
  // Guarda copias de restauracion -- rename CON migracion, nunca se borra la
  // base vieja.
  var DB_NAME = "f123_archivo_db";
  var DB_NAME_VIEJA = "amg_archivo_db";
  var MIGRACION_KEY = "f123_reconciliacion_migrado_v1";
  var DB_VERSION = 1;
  var STORE = "copias";

  function _abrirCruda(nombre) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB no disponible")); return; }
      var req = global.indexedDB.open(nombre, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var st = db.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("ts", "ts", { unique: false });
          st.createIndex("motivo", "motivo", { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { reject(req.error || new Error("no se pudo abrir " + nombre)); };
    });
  }

  function _migrarDesdeBaseVieja(dbNueva) {
    try { if (localStorage.getItem(MIGRACION_KEY) === "1") return Promise.resolve(); } catch (_) {}
    return _abrirCruda(DB_NAME_VIEJA).then(function (dbVieja) {
      return new Promise(function (resolve) {
        try {
          var txLeer = dbVieja.transaction(STORE, "readonly");
          var reqTodos = txLeer.objectStore(STORE).getAll();
          reqTodos.onsuccess = function () {
            var registros = reqTodos.result || [];
            if (!registros.length) { try { localStorage.setItem(MIGRACION_KEY, "1"); } catch (_) {} resolve(); return; }
            var txEscribir = dbNueva.transaction(STORE, "readwrite");
            registros.forEach(function (r) { try { txEscribir.objectStore(STORE).put(r); } catch (_) {} });
            txEscribir.oncomplete = function () {
              try { localStorage.setItem(MIGRACION_KEY, "1"); } catch (_) {}
              try { console.warn("[reconciliacion] migradas " + registros.length + " copia(s) desde la base compartida vieja"); } catch (_) {}
              resolve();
            };
            txEscribir.onerror = function () { resolve(); };
          };
          reqTodos.onerror = function () { resolve(); };
        } catch (_) { resolve(); }
      });
    }).catch(function () { try { localStorage.setItem(MIGRACION_KEY, "1"); } catch (_) {} });
  }

  // ---------------------------------------------------------------------------
  // Archivo de copias completas (IndexedDB)
  // ---------------------------------------------------------------------------
  // Va en IndexedDB, NO en localStorage: un negocio con fotos de perchas pasa
  // de largo el limite de ~5MB de localStorage, y ahi el navegador falla en
  // silencio. Perder la copia de seguridad justo cuando se la necesita seria
  // el peor error posible de este archivo.
  var _db = null;
  function abrirDB() {
    if (_db) return Promise.resolve(_db);
    return _abrirCruda(DB_NAME).then(function (db) {
      return _migrarDesdeBaseVieja(db).then(function () { _db = db; return db; });
    });
  }

  async function leerEstadoActual() {
    var res = await fetch("/api/respaldo/exportar");
    if (!res.ok) throw new Error("No se pudo leer el estado actual (HTTP " + res.status + ")");
    return await res.json();
  }

  /**
   * Guarda una copia completa e intocable del estado.
   * @param {string} motivo  Por que se archiva. Queda guardado: dentro de un ano
   *                         nadie recuerda por que existe una copia sin motivo.
   * @returns {Promise<object>} la ficha de la copia (sin los datos, para no
   *                            devolver megabytes a quien solo queria el id).
   */
  async function archivar(motivo) {
    var datos = await leerEstadoActual();
    var copia = {
      id: "copia-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      isoTs: new Date().toISOString(),
      motivo: String(motivo || "sin motivo"),
      app: "friendly-123",
      // Se copia el schemaVersion que trae el propio estado, no uno fijo: si
      // se escribe a mano y el formato cambia, la copia mentiria sobre su
      // propio formato y una restauracion futura la leeria mal.
      schemaVersion: (datos && datos.schemaVersion) || null,
      // La version del codigo que genero la copia. Si manana el formato cambia,
      // esto es lo que permite leer una copia vieja de forma retrocompatible en
      // vez de descartarla por "formato desconocido". Nunca borrar este campo.
      generadoPor: (global.AMG && global.AMG.Hechos && global.AMG.Hechos.VERSION) || "desconocida",
      datos: datos
    };
    var db = await abrirDB();
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      // add() y no put(): add falla si el id ya existe. Es deliberado — una
      // copia de archivo JAMAS debe sobrescribir a otra. Si algun dia dos
      // copias colisionan de id, queremos el error, no la perdida silenciosa.
      tx.objectStore(STORE).add(copia);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    return { id: copia.id, ts: copia.ts, motivo: copia.motivo };
  }

  /** Fichas de todas las copias, de la mas reciente a la mas vieja. Sin datos. */
  async function listarArchivo() {
    var db = await abrirDB();
    var todas = await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readonly");
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
    return todas
      .map(function (c) {
        return {
          id: c.id, ts: c.ts, isoTs: c.isoTs, motivo: c.motivo,
          generadoPor: c.generadoPor,
          productos: (c.datos && c.datos.productos || []).length,
          ventas: (c.datos && c.datos.ventas || []).length
        };
      })
      .sort(function (a, b) { return b.ts - a.ts; });
  }

  /** Devuelve una copia completa, con datos. Para inspeccionar o exportar. */
  async function leerCopia(id) {
    var db = await abrirDB();
    return await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readonly");
      var req = tx.objectStore(STORE).get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /**
   * Restaura una copia archivada sobre el estado actual.
   *
   * ARCHIVA EL ESTADO ACTUAL ANTES DE PISARLO. Sin eso, restaurar seria en si
   * mismo una forma de perder datos: quien restaura por error una copia vieja
   * borraria el trabajo reciente sin vuelta atras. Asi, restaurar siempre es
   * reversible. NO quitar esa primera linea.
   */
  async function restaurar(id) {
    var copia = await leerCopia(id);
    if (!copia) throw new Error("No existe esa copia.");
    await archivar("antes-de-restaurar-" + id);
    // El importador espera el objeto de estado PLANO (body.productos,
    // body.ubicaciones, ...), tal como lo devuelve /api/respaldo/exportar. No
    // envolverlo en { datos: ... }: validarRespaldo() no encontraria los
    // arreglos y rechazaria la copia con "no parece un respaldo valido".
    var res = await fetch("/api/respaldo/importar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(copia.datos)
    });
    if (!res.ok) {
      var e = await res.json().catch(function () { return {}; });
      throw new Error(e.error || ("No se pudo restaurar (HTTP " + res.status + ")"));
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Reconstruccion desde los hechos
  // ---------------------------------------------------------------------------
  // Un hecho de la Fase A tiene la forma:
  //   { tipo: "venta_rapida", datos: { payload: {...}, resultado: {...} } }
  // donde payload son los argumentos de la accion y resultado el estado en que
  // quedo el producto. El resultado es el dato bueno: dice el stock que quedo,
  // no el que se pidio. Los hechos anteriores al 2026-07-28 no lo traen — por
  // eso se cuentan aparte como "sin resultado" en vez de tratarlos como cero.
  // Contarlos como cero seria inventar informacion que no tenemos.
  function extraer(hecho) {
    var d = hecho && hecho.datos ? hecho.datos : {};
    var payload = d.payload || {};
    var resultado = d.resultado || null;
    var productoId = resultado && resultado.productoId ? resultado.productoId : (payload.productoId || null);
    return {
      tipo: hecho.tipo || "",
      ts: hecho.ts || 0,
      productoId: productoId,
      stockResultante: resultado && typeof resultado.stockActual === "number" ? resultado.stockActual : null,
      delta: typeof payload.delta === "number" ? payload.delta : null
    };
  }

  // Tipos que mueven inventario. Los demas (etiquetas, escaneos, aperturas de
  // pantalla) no afectan el stock y se ignoran a proposito.
  // Los "inventario_*" salen de mock-backend.js, del punto exacto donde el
  // stock ya cambio: son los unicos que traen SIEMPRE el stock resultante y por
  // eso son los que de verdad permiten reconstruir. Los demas vienen de los
  // envoltorios de UI (ui-actions.js) y a veces traen resultado y a veces no,
  // segun si la funcion de pantalla devolvio algo. Se aceptan los dos: un hecho
  // sin resultado se cuenta aparte, nunca se interpreta como cero.
  var TIPOS_STOCK = [
    "inventario_venta", "inventario_anulacion", "inventario_ajuste",
    "venta_rapida", "venta", "stock_ajuste",
    "producto_alta", "producto_eliminacion", "transferencia"
  ];

  /**
   * Reconstruye, por producto, cual deberia ser el stock segun el ultimo hecho
   * que lo menciona. Se usa el ULTIMO stock resultante conocido, no la suma de
   * deltas: la suma acumula el error de cualquier hecho que falte, mientras que
   * el ultimo resultante es un valor absoluto que el propio sistema confirmo.
   */
  async function reconstruir() {
    if (!global.AMG || !global.AMG.Hechos) throw new Error("El registro de hechos no está cargado.");
    var hechos = await global.AMG.Hechos.todos();
    var porProducto = {};
    var stats = { total: hechos.length, deStock: 0, sinResultado: 0, sinProducto: 0 };

    hechos.forEach(function (h) {
      var e = extraer(h);
      if (TIPOS_STOCK.indexOf(e.tipo) === -1) return;
      stats.deStock++;
      if (!e.productoId) { stats.sinProducto++; return; }
      if (e.stockResultante === null) { stats.sinResultado++; return; }
      var prev = porProducto[e.productoId];
      // "Ultimo" por ts. Los hechos ya vienen ordenados de forma estable desde
      // Hechos.todos(), pero se compara igual: depender del orden de otro
      // modulo para algo que decide un numero es fragil.
      if (!prev || e.ts >= prev.ts) {
        porProducto[e.productoId] = { ts: e.ts, stock: e.stockResultante, tipo: e.tipo };
      }
    });

    return { porProducto: porProducto, stats: stats };
  }

  /**
   * Compara la reconstruccion contra el estado real y devuelve el informe.
   * No cambia nada. El informe distingue tres cosas que NO son lo mismo:
   *   coinciden    los hechos y el estado dicen el mismo numero.
   *   discrepan    dicen numeros distintos. Esto es lo que hay que mirar.
   *   sinCobertura el producto existe pero ningun hecho utilizable lo menciona
   *                todavia (normal: la Fase A arranco el 2026-07-28, los
   *                productos anteriores no tienen historia). NO es un error.
   */
  async function comparar() {
    var recon = await reconstruir();
    var estado = await leerEstadoActual();
    var productos = Array.isArray(estado.productos) ? estado.productos : [];

    var informe = {
      generadoEn: new Date().toISOString(),
      hechos: recon.stats,
      productos: productos.length,
      coinciden: 0,
      discrepan: [],
      sinCobertura: 0
    };

    productos.forEach(function (p) {
      var r = recon.porProducto[p.id];
      if (!r) { informe.sinCobertura++; return; }
      var real = typeof p.stockActual === "number" ? p.stockActual : null;
      if (real === null) { informe.sinCobertura++; return; }
      if (real === r.stock) { informe.coinciden++; return; }
      informe.discrepan.push({
        productoId: p.id,
        nombre: p.nombre || "(sin nombre)",
        sku: p.sku || "",
        segunEstado: real,
        segunHechos: r.stock,
        diferencia: real - r.stock,
        ultimoHecho: r.tipo,
        ultimoHechoEn: new Date(r.ts).toISOString()
      });
    });

    // Se guarda el informe para poder mirar la evolucion en el tiempo. Solo el
    // ultimo: el historico util son los hechos, no los informes.
    try { localStorage.setItem("amg_reconciliacion_ultimo_v1", JSON.stringify(informe)); } catch (_) {}
    return informe;
  }

  function ultimoInforme() {
    try { return JSON.parse(localStorage.getItem("amg_reconciliacion_ultimo_v1") || "null"); } catch (_) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Modo sombra (Fase C, arranque 2026-08-04) — comparar() en silencio
  // ---------------------------------------------------------------------------
  // Hasta ahora comparar() solo corria si el dueno tocaba "Revisar" a mano.
  // Antes de que los hechos manden de verdad (reemplazar el stock guardado por
  // el reconstruido), hace falta ACUMULAR semanas de comparaciones reales sin
  // que nadie las mire — la prueba de que la reconstruccion funciona antes de
  // apostarle el negocio de alguien. Este historial es esa prueba: nunca
  // cambia una pantalla, nunca corrige nada, solo registra.
  var HIST_KEY = "amg_reconciliacion_historial_v1";
  var HIST_TOPE = 120; // ~4 meses a 1/dia, suficiente para ver tendencia sin crecer sin limite

  function leerHistorialSombra() {
    try { var h = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); return Array.isArray(h) ? h : []; }
    catch (_) { return []; }
  }

  function compararEnSombra() {
    return comparar().then(function (inf) {
      try {
        var hist = leerHistorialSombra();
        // Resumen liviano, no el informe completo (que incluye detalle por
        // producto) — el historial es para ver TENDENCIA en el tiempo, no para
        // repetir lo que ultimoInforme() ya guarda entero.
        hist.push({
          ts: Date.now(),
          hechosTotal: inf.hechos.total,
          hechosDeStock: inf.hechos.deStock,
          productos: inf.productos,
          coinciden: inf.coinciden,
          discrepanCantidad: inf.discrepan.length,
          sinCobertura: inf.sinCobertura
        });
        localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(-HIST_TOPE)));
      } catch (_) {}
      return inf;
    }).catch(function (e) {
      // Modo sombra nunca puede afectar la app real si falla.
      try { console.warn("[reconciliacion] comparacion en sombra fallo (silencioso):", e && e.message); } catch (_) {}
      return null;
    });
  }

  function historialSombra() { return leerHistorialSombra(); }

  // Corre como maximo 1 vez cada 24h, mismo criterio que archivoDiario() de
  // abajo, y solo en dispositivos activados (en demo no hay nada real que
  // reconciliar). Silencioso: si falla, no se nota nada en la pantalla.
  function sombraDiaria() {
    try {
      var K = "amg_reconciliacion_sombra_ultimo_v1";
      var ultimo = parseInt(localStorage.getItem(K) || "0", 10) || 0;
      if (Date.now() - ultimo < 86400000) return;
      var owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      if (!owned.instanceId) return;
      compararEnSombra().then(function () {
        try { localStorage.setItem(K, String(Date.now())); } catch (_) {}
      });
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Panel en Avanzado
  // ---------------------------------------------------------------------------
  // Lenguaje deliberadamente sin jerga: el dueno no tiene por que saber que es
  // una reconciliacion ni un hecho. Ve "puntos de retorno" y "revision".
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fecha(ts) {
    try { return new Date(ts).toLocaleString("es"); } catch (_) { return String(ts); }
  }

  // Atajo a i18n. Si por lo que sea i18n.js no cargo, se devuelve la clave: es
  // feo pero visible, y muy preferible a una pantalla en blanco.
  function T(k) {
    try { return (global.t ? global.t(k) : k); } catch (_) { return k; }
  }

  function montarPanel(mount) {
    if (!mount) return;
    // Owner only, and never in demo: an employee must not be able to roll the
    // whole business back, and a demo has nothing real to protect.
    try {
      var rol = (global.OCAuth && global.OCAuth.rolActual) ? String(global.OCAuth.rolActual() || "") : "";
      var esDemo = !!(global.OCAuth && global.OCAuth.esDemo && global.OCAuth.esDemo());
      var esDueno = rol === "dueno" || rol === "dueño" || rol === "owner";
      if (!esDueno || esDemo) { mount.innerHTML = ""; return; }
    } catch (_) { mount.innerHTML = ""; return; }

    mount.innerHTML =
      '<h3 class="seccion">' + esc(T("rec.title")) + '</h3>'
      + '<div class="panel-escaner tag-card" style="text-align:left;">'
      + '<p style="margin:0 0 10px;font-size:16px;line-height:1.5;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">'
      + esc(T("rec.intro")) + '</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
      + '<button class="ir" id="oc-rec-crear">' + esc(T("rec.save")) + '</button>'
      + '<button class="ir" id="oc-rec-revisar" style="background:transparent;color:#2E6278;border:2px solid #2E6278;">' + esc(T("rec.check")) + '</button>'
      + '</div>'
      + '<div id="oc-rec-msg" style="font-size:15px;font-weight:700;margin-bottom:10px;color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;"></div>'
      + '<div id="oc-rec-lista" class="tabla-wrap" style="max-height:260px;overflow-y:auto;"></div>'
      + '</div>';

    function msg(t, c) {
      var m = document.getElementById("oc-rec-msg");
      if (!m) return;
      m.textContent = t;
      m.style.setProperty("color", c || "#2E6278", "important");
      m.style.setProperty("-webkit-text-fill-color", c || "#2E6278", "important");
    }

    function pintarLista() {
      listarArchivo().then(function (fichas) {
        var cont = document.getElementById("oc-rec-lista");
        if (!cont) return;
        if (!fichas.length) {
          cont.innerHTML = '<p style="font-size:15px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">' + esc(T("rec.none")) + '</p>';
          return;
        }
        cont.innerHTML = '<table class="reporte"><thead><tr>'
          + '<th>' + esc(T("rec.when")) + '</th><th>' + esc(T("rec.why")) + '</th>'
          + '<th>' + esc(T("rec.products")) + '</th><th>' + esc(T("rec.sales")) + '</th><th></th>'
          + '</tr></thead><tbody>'
          + fichas.map(function (f) {
            return '<tr><td>' + esc(fecha(f.ts)) + '</td><td>' + esc(f.motivo) + '</td>'
              + '<td>' + f.productos + '</td><td>' + f.ventas + '</td>'
              + '<td><button class="ir oc-rec-volver" data-id="' + esc(f.id) + '"'
              + ' style="padding:6px 12px;min-height:44px;">' + esc(T("rec.goBack")) + '</button></td></tr>';
          }).join("")
          + '</tbody></table>';
        Array.prototype.forEach.call(cont.querySelectorAll(".oc-rec-volver"), function (b) {
          b.addEventListener("click", function () { pedirRestaurar(b.getAttribute("data-id")); });
        });
      }).catch(function (e) { msg(T("rec.readFail") + e.message, "#E8365D"); });
    }

    // Restoring overwrites the current state, so it is asked in full words.
    // archivar() already saves today's state before overwriting it, and the
    // user is TOLD so: knowing the action is reversible is what lets someone
    // decide without fear.
    function pedirRestaurar(id) {
      if (!global.confirm(T("rec.confirmRestore"))) return;
      msg(T("rec.restoring"), "#2E6278");
      restaurar(id).then(function () {
        msg(T("rec.restored"), "#00C87A");
        pintarLista();
      }).catch(function (e) { msg(T("rec.restoreFail") + e.message, "#E8365D"); });
    }

    document.getElementById("oc-rec-crear").addEventListener("click", function () {
      msg(T("rec.saving"), "#2E6278");
      archivar("a-mano").then(function () {
        msg(T("rec.saved"), "#00C87A");
        pintarLista();
      }).catch(function (e) { msg(T("rec.saveFail") + e.message, "#E8365D"); });
    });

    document.getElementById("oc-rec-revisar").addEventListener("click", function () {
      msg(T("rec.checking"), "#2E6278");
      comparar().then(function (inf) {
        if (!inf.discrepan.length) {
          msg(T("rec.allGood") + inf.coinciden
            + (inf.sinCobertura ? " (" + inf.sinCobertura + T("rec.noHistory") + ")" : ""), "#00C87A");
          return;
        }
        // Reported, NOT corrected. A difference can be our bug or a real
        // shortage on the shelf, and only the owner knows which.
        var det = inf.discrepan.slice(0, 6).map(function (d) {
          return "\u2022 " + d.nombre + ": "
            + T("rec.mismatchLine").replace("{a}", d.segunEstado).replace("{b}", d.segunHechos);
        }).join("\n");
        msg(inf.discrepan.length + T("rec.mismatch"), "#E8A020");
        global.alert(T("rec.mismatchTitle") + "\n\n" + det
          + (inf.discrepan.length > 6 ? "\n\n" + T("rec.mismatchMore").replace("{n}", inf.discrepan.length - 6) : "")
          + "\n\n" + T("rec.mismatchFoot"));
      }).catch(function (e) { msg(T("rec.checkFail") + e.message, "#E8365D"); });
    });

    pintarLista();
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  global.AMG = global.AMG || {};
  global.AMG.Reconciliacion = {
    montarPanel: montarPanel,
    VERSION: "1.0.0-faseB",
    // Archivo — la red de seguridad
    archivar: archivar,
    listarArchivo: listarArchivo,
    leerCopia: leerCopia,
    restaurar: restaurar,
    // Reconciliacion — solo mira
    reconstruir: reconstruir,
    comparar: comparar,
    ultimoInforme: ultimoInforme,
    // Modo sombra — acumula evidencia en silencio, ver comentario arriba
    compararEnSombra: compararEnSombra,
    historialSombra: historialSombra
  };

  // Copia automatica al arrancar, como maximo una por dia. Barata y silenciosa:
  // el dia que algo salga mal, existe un punto de retorno reciente sin que
  // nadie haya tenido que acordarse de crearlo. Una por dia es el equilibrio
  // entre tener de donde volver y no llenar el disco del telefono.
  function archivoDiario() {
    try {
      var K = "amg_archivo_ultimo_v1";
      var ultimo = parseInt(localStorage.getItem(K) || "0", 10) || 0;
      if (Date.now() - ultimo < 86400000) return;
      // Solo si el dispositivo esta activado: en demo no hay nada real que
      // proteger y llenariamos IndexedDB con datos de juguete.
      var owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      if (!owned.instanceId) return;
      archivar("automatico-diario").then(function () {
        try { localStorage.setItem(K, String(Date.now())); } catch (_) {}
      }).catch(function (e) {
        try { console.warn("[reconciliacion] copia diaria no pudo guardarse:", e && e.message); } catch (_) {}
      });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(archivoDiario, 6000); setTimeout(sombraDiaria, 9000); }, { once: true });
  } else {
    setTimeout(archivoDiario, 6000);
    setTimeout(sombraDiaria, 9000);
  }
})(typeof window !== "undefined" ? window : this);
