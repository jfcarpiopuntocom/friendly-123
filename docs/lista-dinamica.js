// COMPARTIDO: portado y mantenido identico entre apps hermanas a proposito.
/*!
 * lista-dinamica.js — friendly-123 · listas dinámicas (búsqueda + orden)
 * ============================================================================
 * Componente genérico y reusable: búsqueda en vivo + ordenar por columna
 * (ascendente/descendente) sobre un array ya cargado en memoria. Pedido
 * explícito de JFC (2026-07-29): "el feature MÁS faltante para organizar sus
 * bases de datos". Se usa igual para Clientes, Productos y Perchas — un solo
 * componente, tres pantallas, para que "ningún feature rompa otro".
 *
 * 100% vanilla JS, cero dependencias externas — el manifiesto NO CLOUD exige
 * cero llamadas externas y la PWA debe funcionar offline. No hay CDN aquí.
 *
 * MODO RESTRINGIDO (privacidad por rol, pedido de JFC el mismo día): esta es
 * la capa de proyección genérica para "el encargado ve búsquedas parciales,
 * nunca la lista completa". La política de QUIÉN entra en modo restringido
 * la decide cada pantalla que llama a este componente (igual que ya decide
 * `esDueno` hoy) — este archivo solo IMPLEMENTA la restricción, no decide
 * cuándo aplicarla. En modo restringido:
 *   - No se muestra ninguna fila hasta que se escriba una búsqueda real.
 *   - Los resultados se capan a un máximo (aunque haya más coincidencias).
 *   - No aparece ningún control de exportar/imprimir/ver todo.
 * Nada de esto es "seguridad dura" (la app no tiene servidor que lo imponga)
 * — es fricción deliberada y humana: sube el costo de fisgonear sin tratar
 * a nadie como sospechoso. Copy siempre neutral, nunca acusatorio.
 * ============================================================================
 */
(function (global) {
  "use strict";

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // valor(item, columna) — soporta key simple ("nombre") o funcion accessor.
  function valorDe(item, col) {
    if (typeof col.valor === "function") return col.valor(item);
    return item[col.key];
  }

  function comparar(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), "es", { sensitivity: "base", numeric: true });
  }

  // texto(item, columna) — para el filtro de busqueda, siempre como string.
  function textoDe(item, col) {
    var v = valorDe(item, col);
    return v == null ? "" : String(v).toLowerCase();
  }

  // Busqueda con tolerancia a errores de tipeo (JFC 2026-07-30: "que hagan
  // parecer amateur la que tenemos" / "world standards"). uFuzzy es
  // opcional y esta vendorizado localmente (./vendor/ufuzzy.min.js) - si
  // no cargo o lanza, cae SOLA a la busqueda por substring de siempre.
  // Nunca debe poder romper el resto de la lista: ver
  // feedback_aislar_fallos_ui_nunca_datos (JFC, "pecado mortal").
  function filtrarConTolerancia(datos, columnas, q) {
    try {
      if (typeof global.uFuzzy !== "function") throw new Error("uFuzzy no cargado");
      var haystack = datos.map(function (item) {
        return columnas.map(function (c) { return textoDe(item, c); }).join(" ");
      });
      // intraMode:1 + intraIns/Sub/Trn/Del habilitan tolerancia real a
      // errores de tipeo DENTRO de cada palabra (insertar/cambiar/
      // transponer/borrar una letra). Sin esto, uFuzzy por defecto es
      // solo "coincide el orden y separacion de terminos", sin tolerar
      // ni un solo error de tipeo - probado en vivo, "Ashly" no
      // encontraba "Ashley" hasta agregar esto.
      var uf = new global.uFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1 });
      var idxs = uf.filter(haystack, q);
      if (idxs == null) return [];
      return Array.prototype.map.call(idxs, function (i) { return datos[i]; });
    } catch (_) {
      return datos.filter(function (item) {
        return columnas.some(function (c) { return textoDe(item, c).indexOf(q) !== -1; });
      });
    }
  }

  /**
   * crear(opts):
   *  contenedorId: id del elemento donde se monta TODO (barra + tabla/lista).
   *  columnas: [{ key o valor(item), label, ordenable:true }]
   *  datos(): () => array (se relee cada vez que se pinta — el llamador
   *           decide si cachea o refetch; este componente NO guarda copia
   *           propia de los datos entre pintadas, evita datos viejos).
   *  renderFila(item): (item) => string HTML de una fila/tarjeta.
   *  restringido: bool — modo encargado (busqueda obligatoria + tope).
   *  minCaracteres: minimo de caracteres para mostrar algo en modo restringido (default 2).
   *  limite: tope de resultados en modo restringido (default 8).
   *  placeholderBusqueda, mensajeVacio, mensajeRestringido: copy opcional.
   */
  function crear(opts) {
    var cont = document.getElementById(opts.contenedorId);
    if (!cont) return null;
    var columnas = opts.columnas || [];
    var restringido = !!opts.restringido;
    var minCaracteres = opts.minCaracteres != null ? opts.minCaracteres : 2;
    var limite = opts.limite != null ? opts.limite : 8;

    var estado = { busqueda: "", ordenPor: null, ordenAsc: true };

    var barra = document.createElement("div");
    barra.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = opts.placeholderBusqueda || "Buscar...";
    input.style.cssText = "flex:1;min-width:160px;padding:9px 10px;border:2px solid var(--azul-medio,#2c4a68);border-radius:7px;font-size:15px;box-sizing:border-box;";
    barra.appendChild(input);

    var encabezados = null;
    if (columnas.some(function (c) { return c.ordenable; })) {
      encabezados = document.createElement("div");
      encabezados.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
      columnas.forEach(function (c) {
        if (!c.ordenable) return;
        var b = document.createElement("button");
        b.type = "button";
        b.dataset.ordCol = c.key || c.label;
        b.style.cssText = "font-size:13px;padding:5px 10px;border-radius:6px;border:1.5px solid var(--azul-medio,#2c4a68);background:transparent;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;cursor:pointer;";
        b.textContent = c.label;
        encabezados.appendChild(b);
      });
      barra.appendChild(encabezados);
    }

    var lista = document.createElement("div");
    var mensaje = document.createElement("p");
    mensaje.style.cssText = "font-size:14px;color:var(--ink-soft,#5d5340);margin:6px 0 0;";

    cont.innerHTML = "";
    cont.appendChild(barra);
    cont.appendChild(lista);
    cont.appendChild(mensaje);

    function colDe(key) {
      return columnas.find(function (c) { return (c.key || c.label) === key; });
    }

    function pintar() {
      var datos = (opts.datos() || []).slice();
      var q = estado.busqueda.trim().toLowerCase();

      if (restringido && q.length < minCaracteres) {
        lista.innerHTML = "";
        mensaje.textContent = opts.mensajeRestringido || ("Escribe al menos " + minCaracteres + " caracteres para buscar.");
        return;
      }

      var filtrados = q ? filtrarConTolerancia(datos, columnas, q) : datos;

      if (estado.ordenPor) {
        var col = colDe(estado.ordenPor);
        if (col) {
          filtrados = filtrados.slice().sort(function (a, b) {
            var r = comparar(valorDe(a, col), valorDe(b, col));
            return estado.ordenAsc ? r : -r;
          });
        }
      }

      var truncado = false;
      if (restringido && filtrados.length > limite) {
        filtrados = filtrados.slice(0, limite);
        truncado = true;
      }

      if (!filtrados.length) {
        lista.innerHTML = "";
        // BUG FIJADO (JFC 2026-08-19, caza produccion): fallbacks en espanol
        // en app cuyo default es ingles.
        var _es_l = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
        mensaje.textContent = opts.mensajeVacio || (_es_l ? "Sin resultados." : "No results.");
        return;
      }

      lista.innerHTML = filtrados.map(opts.renderFila).join("");
      var _es_l2 = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
      mensaje.textContent = truncado
        ? (_es_l2 ? "Mostrando los primeros " + limite + " resultados — afina la búsqueda para ver otros."
                  : "Showing the first " + limite + " results — refine your search to see others.")
        : "";
    }

    input.addEventListener("input", function () {
      estado.busqueda = input.value;
      pintar();
    });

    if (encabezados) {
      encabezados.addEventListener("click", function (e) {
        var b = e.target.closest("[data-ord-col]");
        if (!b) return;
        var key = b.dataset.ordCol;
        if (estado.ordenPor === key) estado.ordenAsc = !estado.ordenAsc;
        else { estado.ordenPor = key; estado.ordenAsc = true; }
        encabezados.querySelectorAll("[data-ord-col]").forEach(function (btn) {
          var activo = btn.dataset.ordCol === estado.ordenPor;
          btn.style.background = activo ? "var(--azul-medio,#2c4a68)" : "transparent";
          btn.style.color = activo ? "#fbf5e8" : "var(--azul-medio,#2c4a68)";
          btn.style.setProperty("-webkit-text-fill-color", activo ? "#fbf5e8" : "var(--azul-medio,#2c4a68)");
          if (activo) btn.textContent = (colDe(key) || {}).label + (estado.ordenAsc ? " ↑" : " ↓");
          else { var c2 = columnas.find(function (c) { return (c.key || c.label) === btn.dataset.ordCol; }); if (c2) btn.textContent = c2.label; }
        });
        pintar();
      });
    }

    pintar();
    return { repintar: pintar, elementoInput: input };
  }

  global.AMG = global.AMG || {};
  global.AMG.ListaDinamica = { crear: crear, _escHtml: escHtml };
})(typeof window !== "undefined" ? window : this);
