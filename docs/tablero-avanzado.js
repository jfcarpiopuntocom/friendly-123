// COMPARTIDO: portado y mantenido identico entre apps hermanas a proposito.
/* ============================================================================
   tablero-avanzado.js — Avanzado, con sitio para leerlo.
   AMIGABLE-123 · 2026-08-15 · JFC

   POR QUÉ EXISTE: la app del día a día mete todo Avanzado en una columna de
   teléfono. En el tablero hay pantalla de sobra, y eso cambia lo que se puede
   hacer con la misma información.

   CÓMO FUNCIONA, y esto es lo importante: el tablero NO tiene backend y NO
   reimplementa ni una regla de negocio. Manda una ORDEN cifrada y el
   dispositivo del dueño la ejecuta contra su propio /api y devuelve el
   resultado. Si mañana cambia cómo se agrega un encargado, cambia en
   mock-backend.js y esta pantalla se entera sola. Dos implementaciones de la
   misma regla es como se rompen los negocios.

   QUÉ SE PUEDE PEDIR: lo que diga ORDENES_PERMITIDAS en sync-realtime.js, que
   es una lista blanca estricta del lado del dispositivo. Aquí no se decide
   nada de eso: aunque alguien manipule este archivo en su navegador, el
   teléfono solo atiende lo que su propia lista permite.

   QUÉ NO ENTRA, a propósito: ventas, ajustes de stock, código maestro,
   respaldo y cambio de código de sala. Lo primero se hace con el producto
   delante; lo demás es del aparato, no del negocio.

   Si este archivo no carga, el tablero sigue mostrando todo lo demás.
   ============================================================================ */
(function () {
  "use strict";

  // BUG FIJADO (JFC 2026-08-19, caza produccion): las etiquetas de
  // secciones estaban solo en espanol. Al menos las cabeceras (que son lo
  // primero que se ve al entrar a Avanzado) ahora respetan el idioma
  // activo. El cuerpo de cada seccion queda como TODO — se prioriza para
  // un pase de i18n mas amplio.
  function _es_ta(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}}
  var TA = {
    equipo:      _es_ta() ? "Mi equipo"                  : "My team",
    actividad:   _es_ta() ? "Log de actividad"           : "Activity log",
    integridad:  _es_ta() ? "Control anti fraude"        : "Anti-fraud check",
    transf:      _es_ta() ? "Transferencias"             : "Transfers",
    reporte:     _es_ta() ? "Reporte para el contador"   : "Report for the accountant"
  };

  /* El puente lo expone tablero.html. Sin él, esta sección simplemente no
     aparece: nada de errores en pantalla por algo que el usuario no pidió. */
  var L = window.__lienzo;
  if (!L) return;

  var $ = L.$, esc = L.esc, money = L.money, fecha = L.fecha, ordenar = L.ordenar;

  var ROLNOM = { dueno: "Dueño", admin: "Admin", empleado: "Encargado", contador: "Contador" };

  /* El detalle de un movimiento a veces es texto y a veces un objeto con los
     campos que cambiaron. Pintarlo crudo daba "[object Object]" en pantalla. */
  function detalleLegible(d) {
    if (d == null) return "";
    if (typeof d === "string") return d;
    if (typeof d !== "object") return String(d);
    try {
      return Object.keys(d).map(function (k) {
        var v = d[k];
        if (v && typeof v === "object") v = JSON.stringify(v);
        return k + ": " + v;
      }).join(" · ");
    } catch (_) { return ""; }
  }

  function plural(n, uno, muchos) { return n + " " + (n === 1 ? uno : muchos); }

  function msg(txt, malo) {
    var e = $("avz-msg");
    if (!e) return;
    e.style.color = malo ? "#A8123A" : "#00975C";
    e.style.webkitTextFillColor = malo ? "#A8123A" : "#00975C";
    e.textContent = txt || "";
  }

  function cargando(c, qué) {
    c.innerHTML = '<p style="font-size:15px;padding:14px 2px;">' + esc(qué) + "</p>";
  }
  function noLlego(c, r, qué) {
    c.innerHTML = '<p style="font-size:15px;padding:14px 2px;">' +
      esc((r.datos && r.datos.error) || qué) + "</p>";
  }

  function tabla(cols, filas, vacio) {
    if (!filas.length) return '<p style="font-size:15px;padding:14px 2px;">' + esc(vacio) + "</p>";
    return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
      cols.map(function (c) {
        return '<th style="text-align:left;padding:9px 8px;border-bottom:2px solid var(--ink);' +
          'font-family:var(--font-mono);font-size:13px;text-transform:uppercase;">' + esc(c) + "</th>";
      }).join("") + "</tr></thead><tbody>" +
      filas.map(function (fila) {
        return "<tr>" + fila.map(function (celda) {
          return '<td style="padding:9px 8px;border-bottom:1px solid var(--hairline);font-size:15px;">' + celda + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* Chip de color sólido con texto sólido encima. Nunca color sobre el mismo
     tono: eso es exactamente lo que se vuelve ilegible en un teléfono al sol. */
  function chip(txt, bg, tinta) {
    return '<span style="display:inline-block;padding:3px 11px;border-radius:20px;font-size:13px;font-weight:700;' +
      "background:" + bg + ";color:" + tinta + " !important;-webkit-text-fill-color:" + tinta + ' !important;">' +
      esc(txt) + "</span>";
  }

  var campo = "min-height:44px;padding:10px 13px;border:2px solid var(--hairline);border-radius:9px;" +
    "font-size:16px;background:#FFFFFF;color:var(--ink);text-align:left;text-transform:none;" +
    "letter-spacing:normal;font-family:var(--font-body);";

  /* ====================================================== LAS SECCIONES === */
  var AVZ = {

    equipo: {
      nombre: TA.equipo,
      pintar: async function (c) {
        cargando(c, "Pidiendo la lista a tu dispositivo…");
        var r = await ordenar("GET", "/api/usuarios");
        if (!r.ok || !Array.isArray(r.datos)) return noLlego(c, r, "No llegó la lista.");

        var filas = r.datos.map(function (u) {
          var act = u.activo !== false;
          return [
            "<strong>" + esc(u.nombre) + "</strong>",
            esc(ROLNOM[u.rol] || u.rol || ""),
            esc(u.email || "—"),
            act ? chip("Activo", "#00C87A", "#0A2E1E") : chip("Dado de baja", "#E8365D", "#FFFFFF"),
            '<button type="button" data-u="' + esc(u.id) + '" data-act="' + (act ? "0" : "1") + '" ' +
              'style="min-height:44px;padding:9px 14px;border-radius:9px;border:2px solid var(--hairline);' +
              'background:#FFFFFF;font-size:14px;font-weight:700;cursor:pointer;">' +
              (act ? "Dar de baja" : "Reactivar") + "</button>",
          ];
        });

        c.innerHTML =
          '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">' +
          "Each person signs in with their own PIN. PINs are not shown here." + "</p>" +
          tabla(["Nombre", "Rol", "Correo", "Estado", ""], filas, "Todavía no hay nadie más en el equipo.") +

          '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--hairline);">' +
          '<h3 style="font-size:16px;margin:0 0 8px;">Agregar a alguien</h3>' +
          '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end;">' +
          '<div><label for="avz-nom" style="display:block;font-size:14px;font-weight:700;margin:0 0 4px;">Nombre</label>' +
          '<input id="avz-nom" type="text" maxlength="40" style="' + campo + '"></div>' +
          '<div><label for="avz-rol" style="display:block;font-size:14px;font-weight:700;margin:0 0 4px;">Rol</label>' +
          '<select id="avz-rol" style="' + campo + '"><option value="empleado">Encargado</option>' +
          '<option value="admin">Admin</option></select></div>' +
          '<button type="button" id="avz-add" class="btn" style="width:auto;margin:0;padding:13px 22px;">Agregar</button>' +
          "</div>" +
          '<p style="font-size:14px;line-height:1.5;margin:9px 0 0;">' +
          "Their PIN appears on your device, not here.</p>" +
          "</div>";

        c.querySelectorAll("[data-u]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            msg("Pidiendo el cambio a tu dispositivo…");
            var r2 = await ordenar("PATCH", "/api/usuarios/" + b.dataset.u, { activo: b.dataset.act === "1" });
            b.disabled = false;
            if (!r2.ok) { msg((r2.datos && r2.datos.error) || "No se pudo.", true); return; }
            msg("Hecho.");
            AVZ.equipo.pintar(c);
          });
        });

        var add = document.getElementById("avz-add");
        if (add) add.addEventListener("click", async function () {
          var nombre = document.getElementById("avz-nom").value.trim();
          if (!nombre) { msg("Escribe el nombre.", true); return; }
          add.disabled = true;
          msg("Asking your device to add them…");
          var r2 = await ordenar("POST", "/api/usuarios", { nombre: nombre, rol: document.getElementById("avz-rol").value });
          add.disabled = false;
          if (!r2.ok) { msg((r2.datos && r2.datos.error) || "No se pudo agregar.", true); return; }
          msg('"' + nombre + '" agregado. Su PIN está en tu dispositivo.');
          AVZ.equipo.pintar(c);
        });
      },
    },

    actividad: {
      nombre: TA.actividad,
      pintar: async function (c) {
        cargando(c, "Pidiendo el registro…");
        var r = await ordenar("GET", "/api/actividad");
        if (!r.ok || !Array.isArray(r.datos)) return noLlego(c, r, "No llegó el registro.");
        c.innerHTML =
          '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Los últimos ' +
          plural(r.datos.length, "movimiento", "movimientos") +
          ", newest first. Each one records who did it and when.</p>" +
          tabla(["Cuándo", "Quién", "Qué", "Detalle"], r.datos.map(function (m) {
            return ['<span class="num">' + esc(fecha(m.fecha)) + "</span>",
                    esc(m.usuarioNombre || "—"),
                    "<strong>" + esc(m.tipo || "") + "</strong>",
                    esc(detalleLegible(m.detalle))];
          }), "No activity recorded yet.");
      },
    },

    integridad: {
      nombre: TA.integridad,
      pintar: async function (c) {
        cargando(c, "Revisando el historial…");
        var r = await ordenar("GET", "/api/integridad");
        var d = r.datos || {};
        if (!r.ok) return noLlego(c, r, "No se pudo revisar.");
        var bien = !!d.ok;
        c.innerHTML =
          '<div style="padding:15px 17px;border-radius:12px;font-size:17px;font-weight:700;background:' +
          (bien ? "#00C87A" : "#E8365D") + ";color:" + (bien ? "#0A2E1E" : "#FFFFFF") +
          " !important;-webkit-text-fill-color:" + (bien ? "#0A2E1E" : "#FFFFFF") + ' !important;">' +
          (bien ? "History is intact." : "History was altered.") + "</div>" +

          '<p style="font-size:15px;line-height:1.55;margin:13px 0 0;">' +
          "Every movement is sealed and chained to the previous one: if anyone edits or deletes one, it shows. " +
          "Sellados: " + (d.sellados || 0) + " de " + (d.total || 0) + "." +
          (d.historico ? " Hay " + d.historico + " movimientos anteriores al sellado, que no se pueden verificar." : "") +
          "</p>" +

          (d.ruptura
            ? '<div class="cierre" style="margin-top:13px;"><strong>Dónde se rompió</strong>' +
              esc(fecha(d.ruptura.fecha)) + " · " + esc(d.ruptura.usuarioNombre || "?") + " · " +
              esc(d.ruptura.tipo || "") + " · " +
              (d.ruptura.motivo === "editado" ? "the movement was edited" : "it was deleted or reordered") +
              "</div>"
            : "");
      },
    },

    transferencias: {
      nombre: TA.transf,
      pintar: async function (c) {
        cargando(c, "Pidiendo las transferencias…");
        var r = await ordenar("GET", "/api/transferencias");
        if (!r.ok || !Array.isArray(r.datos)) return noLlego(c, r, "No llegaron.");
        var COL = { pendiente: ["#FFC700", "#3D2E00"], aceptada: ["#00C87A", "#0A2E1E"], rechazada: ["#E8365D", "#FFFFFF"] };
        c.innerHTML =
          '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">' +
          "Product moves between your shelves. Pending ones are accepted by whoever receives them.</p>" +
          tabla(["Cuándo", "Producto", "De", "A", "Cant.", "Estado"], r.datos.map(function (t) {
            var col = COL[t.estado] || ["#FFFFFF", "#2C3E50"];
            return ['<span class="num">' + esc(fecha(t.fecha)) + "</span>",
                    "<strong>" + esc(t.productoNombre || "") + "</strong>",
                    esc(t.origenNombre || ""), esc(t.destinoNombre || ""),
                    '<span class="num">' + esc(String(t.cantidad || 0)) + "</span>",
                    chip(t.estado || "", col[0], col[1])];
          }), "No product has moved between shelves yet.");
      },
    },

    contable: {
      nombre: TA.reporte,
      pintar: async function (c) {
        cargando(c, "Armando el reporte…");
        var res = await Promise.all([
          ordenar("GET", "/api/reportes/pl?ubicacionId=todas"),
          ordenar("GET", "/api/reportes/balance?ubicacionId=todas"),
        ]);
        var pl = (res[0].ok && res[0].datos) || null;
        var bal = (res[1].ok && res[1].datos) || null;
        if (!pl || pl.error) return noLlego(c, res[0], "No llegó el reporte.");

        var linea = function (a, b, fuerte) {
          return '<div style="display:flex;justify-content:space-between;gap:14px;padding:9px 0;' +
            "border-bottom:1px solid var(--hairline);" + (fuerte ? "font-weight:700;" : "") +
            '"><span style="font-size:15px;">' + esc(a) + '</span>' +
            '<span class="num" style="font-size:15px;">' + esc(money(b)) + "</span></div>";
        };
        c.innerHTML =
          '<h3 style="font-size:16px;margin:0 0 8px;">Pérdidas y ganancias (hoy)</h3>' +
          linea("Ventas cobradas, con IVA", pl.ingresosConIva) +
          linea("IVA cobrado, se liquida al SRI", pl.ivaCobrado) +
          linea("Ingresos netos, sin IVA", pl.ingresos) +
          linea("Costo de ventas", pl.costoVentas) +
          linea("Utilidad bruta", pl.utilidadBruta, true) +
          linea("Gastos operativos", pl.gastosOperativos) +
          linea("Utilidad neta", pl.utilidadNeta, true) +
          (bal && !bal.error
            ? '<h3 style="font-size:16px;margin:19px 0 8px;">Balance simplificado</h3>' +
              linea("Estimated cash for the day", bal.activos && bal.activos.efectivoEstimado) +
              linea("Inventario a costo", bal.activos && bal.activos.inventarioCosto)
            : "") +
          '<p style="font-size:15px;line-height:1.55;margin:15px 0 0;">' +
          "Input for your bookkeeper. It is not a filing-ready tax return. " +
          "The closed-month PDF is further up, under Monthly report.</p>";
      },
    },
  };

  /* ============================================================== pintar === */
  var vista = "equipo";
  function pintar() {
    var sel = $("avz-sel"), cuerpo = $("avz-cuerpo");
    if (!sel || !cuerpo) return;
    if (!sel.children.length) {
      sel.innerHTML = Object.keys(AVZ).map(function (k) {
        return '<button type="button" data-a="' + k + '"' + (k === vista ? ' class="on"' : "") + ">" +
          esc(AVZ[k].nombre) + "</button>";
      }).join("");
      sel.addEventListener("click", function (e) {
        var b = e.target.closest("[data-a]");
        if (!b) return;
        vista = b.dataset.a;
        Array.prototype.forEach.call(sel.children, function (x) { x.classList.toggle("on", x === b); });
        msg("");
        AVZ[vista].pintar(cuerpo);
      });
    }
    AVZ[vista].pintar(cuerpo);
  }

  window.OCTableroAvanzado = { pintar: pintar };
})();
