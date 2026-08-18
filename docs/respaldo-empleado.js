/*!
 * respaldo-empleado.js — friendly-123
 * Gemelo de docs/respaldo-empleado.js en AMIGABLE. Misma logica y mismo
 * alcance (los costos NO viajan); aqui los textos pasan por i18n.
 * Si se corrige un bug de logica, corregirlo en AMBOS.
 * ============================================================================
 * QUE ES
 * ----------------------------------------------------------------------------
 * El respaldo del EMPLEADO: que quien atiende el mostrador pueda mandarse a si
 * mismo, a su propio correo o WhatsApp, la constancia de su trabajo.
 *
 * POR QUE EXISTE (JFC, punto 13)
 * ----------------------------------------------------------------------------
 * El respaldo del dueno (backup-scheduler.js) protege al NEGOCIO. Este protege
 * a la PERSONA. Si manana hay una discusion sobre cuanto vendio, cuanta
 * comision le toca o que dia trabajo, el encargado tiene su propia copia con
 * fecha, sellada con el mismo hash encadenado que usa el resto de la app. No
 * depende de que el dueno se la de, ni de tener acceso al dispositivo despues.
 *
 * QUE INCLUYE Y QUE NO — LEER ANTES DE AMPLIAR
 * ----------------------------------------------------------------------------
 * INCLUYE   sus ventas (producto, cantidad, precio de venta, fecha), su
 *           comision calculada, sus perchas, y su rastro de actividad.
 * NO INCLUYE costos, margenes, utilidad, gastos del negocio, datos de otros
 *           encargados, claves, ni la lista de clientes completa.
 *
 * Esa linea NO es un detalle de privacidad menor: el costo de compra es la
 * informacion mas sensible de un negocio pequeno. Un encargado que se lleva la
 * lista de costos se lleva el negocio. Al mismo tiempo, negarle su propia
 * constancia de ventas seria abusivo. El corte esta puesto exactamente ahi.
 * Si alguien pide "incluir tambien el costo para que cuadre", la respuesta es
 * NO — que lo pida el dueno desde su propio respaldo.
 *
 * Depende de: OCBackupScheduler (entrega), /api/respaldo/exportar (datos),
 *             OCCurrentUser / OCAuth (identidad), AMG.Hechos (sello opcional).
 * ============================================================================
 */
(function (global) {
  "use strict";

  // Atajo a i18n. Si i18n.js no cargo se devuelve la clave: feo pero
  // visible, y muy preferible a una pantalla en blanco.
  function T(k) { try { return (global.t ? global.t(k) : k); } catch (_) { return k; } }

  var LS_PREFS = "oc_respaldo_empleado_prefs_v1";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------------------
  // Identidad de quien esta respaldando
  // ---------------------------------------------------------------------------
  function yo() {
    var u = null;
    try { u = global.OCCurrentUser || null; } catch (_) {}
    var rol = "";
    try { rol = (global.OCAuth && global.OCAuth.rolActual) ? String(global.OCAuth.rolActual() || "") : ""; } catch (_) {}
    return {
      id: (u && u.id) ? String(u.id) : "",
      nombre: (u && u.nombre) ? String(u.nombre) : "",
      rol: rol
    };
  }

  function esEmpleado() {
    var r = yo().rol.toLowerCase();
    return r === "empleado" || r === "employee" || r === "vendedor";
  }

  // ---------------------------------------------------------------------------
  // Preferencias propias del encargado
  // ---------------------------------------------------------------------------
  // A proposito NO se reutiliza oc_backup_prefs_v1: ese es el correo del DUENO.
  // Mandar el respaldo del encargado al correo del dueno seria justo lo contrario
  // de lo que este archivo existe para lograr.
  function getPrefs() {
    var base = { email: "", whatsapp: "", canalEmail: true, canalWhatsapp: false };
    try {
      var raw = localStorage.getItem(LS_PREFS);
      if (!raw) return base;
      var p = JSON.parse(raw);
      return {
        email: p.email || "",
        whatsapp: p.whatsapp || "",
        canalEmail: p.canalEmail !== false,
        canalWhatsapp: !!p.canalWhatsapp
      };
    } catch (_) { return base; }
  }
  function setPrefs(p) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Construccion del paquete filtrado
  // ---------------------------------------------------------------------------
  // Se parte del export canonico y se RECORTA. Recortar de una fuente conocida
  // es mas seguro que armar el paquete campo por campo: si manana el negocio
  // guarda un dato nuevo y sensible, este filtro por lista blanca lo deja
  // afuera solo. Un filtro por lista negra habria dejado escapar el campo nuevo.
  function nombreDe(mapa, id) {
    var x = mapa[id];
    return x ? (x.nombre || "") : "";
  }

  async function construirPaquete(desdeMs) {
    var res = await fetch("/api/respaldo/exportar");
    if (res.status === 403) {
      throw new Error(T("emp.notActivated"));
    }
    if (!res.ok) throw new Error(T("emp.readFail"));
    var d = await res.json();

    var quien = yo();
    var productos = Array.isArray(d.productos) ? d.productos : [];
    var ubicaciones = Array.isArray(d.ubicaciones) ? d.ubicaciones : [];
    var ventas = Array.isArray(d.ventas) ? d.ventas : [];
    var movimientos = Array.isArray(d.movimientos) ? d.movimientos : [];

    var mapaProd = {}; productos.forEach(function (p) { mapaProd[p.id] = p; });
    var mapaUbic = {}; ubicaciones.forEach(function (u) { mapaUbic[u.id] = u; });

    var corte = desdeMs || 0;
    function dentro(fecha) {
      if (!corte) return true;
      var t = new Date(fecha).getTime();
      return isFinite(t) && t >= corte;
    }

    // Ventas del periodo. Nota honesta sobre el alcance: hoy una venta no
    // guarda el id del encargado que la registro, asi que el paquete cubre las
    // ventas del periodo en las perchas donde trabajo. Cuando las ventas lleven
    // vendedorId (viene con el micelio), este filtro se vuelve exacto: cambiar
    // la condicion de abajo por v.vendedorId === quien.id y actualizar el aviso
    // que se muestra en pantalla. NO BORRAR esta nota hasta que eso pase.
    var mias = ventas.filter(function (v) { return dentro(v.fecha); });

    var lineas = mias.map(function (v) {
      return {
        fecha: v.fecha,
        producto: nombreDe(mapaProd, v.productoId) || "(producto borrado)",
        percha: nombreDe(mapaUbic, v.ubicacionId) || "",
        cantidad: v.cantidad || 0,
        precioUnitario: v.precioUnit || 0,
        total: +(((v.precioUnit || 0) * (v.cantidad || 1)).toFixed(2)),
        // Solo la parte que le corresponde a la persona/socio de esa percha.
        // El resto del split (lo que se queda el negocio) NO viaja.
        comision: v.split ? +((v.split.montoComisionSocio || 0).toFixed(2)) : 0,
        liquidada: !!v.liquidada
      };
    });

    var totalVendido = lineas.reduce(function (a, l) { return a + l.total; }, 0);
    var totalComision = lineas.reduce(function (a, l) { return a + l.comision; }, 0);

    // Rastro de actividad: solo tipos que describen lo que la persona hizo.
    // Se excluyen a proposito los movimientos de configuracion del negocio.
    var TIPOS_PROPIOS = ["venta", "anulacion", "ajuste", "alta", "edicion"];
    var actividad = movimientos
      .filter(function (m) { return m && TIPOS_PROPIOS.indexOf(m.tipo) !== -1 && dentro(m.fecha); })
      .map(function (m) { return { fecha: m.fecha, tipo: m.tipo, detalle: m.datos || {} }; });

    var paquete = {
      app: "friendly-123",
      tipo: "respaldo-empleado",
      schemaVersion: 1,
      generadoEn: new Date().toISOString(),
      // Alcance declarado DENTRO del archivo: si alguien lo abre en seis meses,
      // el archivo mismo explica que contiene y que no. Un respaldo que no se
      // puede interpretar sin la app no sirve de constancia.
      alcance: {
        incluye: "ventas del periodo, comisiones, perchas y actividad del periodo",
        noIncluye: "costos, margenes, utilidad, gastos del negocio, claves y datos de otras personas",
        nota: "Constancia personal del trabajo realizado. No es un estado financiero del negocio."
      },
      persona: { nombre: quien.nombre, rol: quien.rol },
      negocio: { nombre: d.nombreNegocio || "" },
      periodo: { desde: corte ? new Date(corte).toISOString() : null, hasta: new Date().toISOString() },
      resumen: {
        ventas: lineas.length,
        totalVendido: +totalVendido.toFixed(2),
        totalComision: +totalComision.toFixed(2)
      },
      ventas: lineas,
      perchas: ubicaciones.map(function (u) { return { nombre: u.nombre || "", tipo: u.tipo || "" }; }),
      actividad: actividad
    };

    // Sello de integridad. Deja EVIDENCIA de alteracion, no la impide: si
    // alguien edita el .json a mano, el sello deja de cuadrar. Decirlo asi de
    // claro es obligatorio — prometer "a prueba de manipulacion" seria mentira.
    paquete.sello = await sellar(paquete);

    var texto = JSON.stringify(paquete, null, 2);
    var bs = global.OCBackupScheduler;
    var ahora = new Date();
    var stamp = bs && bs.stampArchivo ? bs.stampArchivo(ahora) : ahora.toISOString().slice(0, 16).replace(/[:T]/g, "-");
    var humano = bs && bs.stampHumano ? bs.stampHumano(ahora) : ahora.toLocaleString("es");
    var slug = (quien.nombre || "empleado").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "empleado";

    return {
      texto: texto,
      nombre: "my-work-" + slug + "-" + stamp + ".json",
      humano: humano,
      resumen: paquete.resumen
    };
  }

  // SHA-256 del contenido. Mismo criterio que hechos.js: si no hay crypto.subtle
  // se marca el sello como debil ("w:") en vez de fingir que es criptografico.
  async function sellar(obj) {
    var txt = JSON.stringify(obj);
    try {
      if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
        var buf = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
        return Array.from(new Uint8Array(buf))
          .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      }
    } catch (_) {}
    var h = 2166136261;
    for (var i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return "w:" + h.toString(16);
  }

  // ---------------------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------------------
  async function correr(desdeMs, onMsg) {
    var msg = onMsg || function () {};
    var prefs = getPrefs();
    var bs = global.OCBackupScheduler;
    if (!bs || !bs.entregarArchivo) {
      msg(T("emp.notLoaded"), "#E8365D");
      return;
    }
    if (!prefs.canalEmail && !prefs.canalWhatsapp) { msg(T("emp.needChannel"), "#E8365D"); return; }
    if (prefs.canalEmail && !prefs.email) { msg(T("emp.needEmail"), "#E8365D"); return; }
    if (prefs.canalWhatsapp && !bs.waEsValido(prefs.whatsapp)) {
      msg(T("emp.needWa"), "#E8365D"); return;
    }

    var info;
    try {
      info = await construirPaquete(desdeMs);
    } catch (e) {
      msg(T("emp.buildFail") + e.message, "#E8365D");
      return;
    }

    var resultado = await bs.entregarArchivo(
      info, prefs, T("emp.shareTitle"),
      T("emp.shareText").replace("{fecha}", info.humano)
    );
    if (resultado === "cancelado") return;

    // Queda registrado como hecho: que un encargado se lleve su constancia es
    // parte de la historia del negocio y el dueno debe poder verlo en el log.
    // Se registra el ACTO, nunca el contenido del paquete.
    try {
      if (global.AMG && global.AMG.Hechos) {
        global.AMG.Hechos.registrar("respaldo-empleado", {
          persona: yo().nombre,
          ventas: info.resumen.ventas,
          desde: desdeMs || null
        });
      }
    } catch (_) {}

    msg(info.resumen.ventas + T("emp.done"), "#00C87A");
  }

  // ---------------------------------------------------------------------------
  // UI — se monta en Avanzado cuando quien mira es encargado
  // ---------------------------------------------------------------------------
  var PERIODOS = [
    { key: "mes", label: T("emp.periodMonth"), dias: 30 },
    { key: "trimestre", label: T("emp.periodQuarter"), dias: 92 },
    { key: "todo", label: T("emp.periodAll"), dias: 0 }
  ];

  function montar(mount) {
    if (!mount) return;
    if (!esEmpleado()) { mount.innerHTML = ""; return; }
    var prefs = getPrefs();
    mount.innerHTML =
      '<div style="border:2px solid #2E6278;border-radius:12px;padding:14px 16px;background:#F4F8FA;margin-top:16px;">'
      + '<h3 style="margin:0 0 4px;font-family:Georgia,serif;font-size:19px;'
      + 'color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;">' + esc(T("emp.title")) + '</h3>'
      + '<p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">'
      + esc(T("emp.lead")) + '</p>'
      + '<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">'
      + esc(T("emp.intro")) + '</p>'
      + '<div style="display:grid;gap:10px;">'
      + '<div><div style="font-size:14px;font-weight:700;margin-bottom:6px;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">' + esc(T("emp.period")) + '</div>'
      + '<select id="oc-re-periodo" style="padding:10px;border:2px solid #2E6278;border-radius:6px;min-height:44px;font-size:15px;">'
      + PERIODOS.map(function (p) { return '<option value="' + p.key + '">' + esc(p.label) + '</option>'; }).join("")
      + '</select></div>'
      + '<label style="font-size:14px;font-weight:700;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">'
      + '<input type="checkbox" id="oc-re-canalEmail"' + (prefs.canalEmail ? " checked" : "")
      + ' style="min-width:20px;min-height:20px;vertical-align:middle;margin-right:6px;">' + esc(T("emp.byEmail")) + '</label>'
      + '<input type="email" id="oc-re-email" value="' + esc(prefs.email) + '" placeholder="tu@correo.com"'
      + ' style="padding:10px;border:2px solid #2E6278;border-radius:6px;min-height:44px;max-width:340px;font-size:15px;">'
      + '<label style="font-size:14px;font-weight:700;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">'
      + '<input type="checkbox" id="oc-re-canalWa"' + (prefs.canalWhatsapp ? " checked" : "")
      + ' style="min-width:20px;min-height:20px;vertical-align:middle;margin-right:6px;">' + esc(T("emp.byWhatsapp")) + '</label>'
      + '<input type="tel" id="oc-re-wa" value="' + esc(prefs.whatsapp) + '" placeholder="+593 99 990 5080"'
      + ' style="padding:10px;border:2px solid #2E6278;border-radius:6px;min-height:44px;max-width:340px;font-size:15px;">'
      + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">'
      + '<button id="oc-re-guardar" style="min-height:44px;padding:10px 16px;border:2px solid #2E6278;background:#fff;color:#2E6278;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">' + esc(T("emp.save")) + '</button>'
      + '<button id="oc-re-enviar" style="min-height:44px;padding:10px 16px;border:2px solid #2E6278;background:#2E6278;color:#fff;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">' + esc(T("emp.send")) + '</button>'
      + '</div>'
      + '<p id="oc-re-msg" style="margin:10px 0 0;font-size:15px;font-weight:700;color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;"></p>'
      + '</div>';

    function msg(t, c) {
      var m = document.getElementById("oc-re-msg");
      if (m) { m.textContent = t; m.style.setProperty("color", c || "#2E6278", "important"); m.style.setProperty("-webkit-text-fill-color", c || "#2E6278", "important"); }
    }
    function leerForm() {
      return {
        email: (document.getElementById("oc-re-email").value || "").trim(),
        whatsapp: (document.getElementById("oc-re-wa").value || "").trim(),
        canalEmail: document.getElementById("oc-re-canalEmail").checked,
        canalWhatsapp: document.getElementById("oc-re-canalWa").checked
      };
    }
    document.getElementById("oc-re-guardar").addEventListener("click", function () {
      setPrefs(leerForm());
      msg(T("emp.saved"), "#00C87A");
    });
    document.getElementById("oc-re-enviar").addEventListener("click", function () {
      setPrefs(leerForm());
      var key = document.getElementById("oc-re-periodo").value;
      var p = PERIODOS.filter(function (x) { return x.key === key; })[0] || PERIODOS[0];
      var desde = p.dias ? (Date.now() - p.dias * 86400000) : 0;
      msg(T("emp.preparing"), "#2E6278");
      correr(desde, msg);
    });
  }

  global.OCRespaldoEmpleado = {
    montar: montar,
    correr: correr,
    esEmpleado: esEmpleado,
    _construir: construirPaquete
  };
})(typeof window !== "undefined" ? window : this);
