/* core/demo-huellas.js (v457, JFC 2026-10-07). LEY: EL DEMO NUNCA SE MEZCLA CON UN NEGOCIO CON LICENCIA.
   Huellas EXACTAS de la semilla demo para quien NO carga mock-backend.js (el tablero). Es la misma regla que usa la app
   (mock-backend.js: _es*DemoExacto + _seleccionarSemillaDemoPura con sinEvidencia): un registro es semilla solo si
   coinciden TODOS los campos que nacieron juntos en el demo. NUNCA se borra nada: esto solo dice que ids no se ven.
   Un registro demo con ventas REALES (id que no empieza por "vs-") que lo referencian se queda visible, y con el sus
   perchas y asociados dependientes. Si la semilla de mock-backend.js cambia, test/demo-no-mezcla-v457.test.js falla
   (compara esta tabla contra el respaldo del demo): regenerar las tablas desde /api/respaldo/exportar del demo limpio.
   Sin dependencias, sin DOM, sin red. */
(function (root) {
  "use strict";
  /* [id, nombre, sku, barcode] */
  var PRODUCTOS = [
    ["p01", "Original oil \u2014 City rooftops", "ART-OIL-001", "7862000010011"],
    ["p02", "Original watercolor \u2014 River bend", "ART-WAT-002", "7862000010028"],
    ["p03", "Print \u2014 Mountain series I", "ART-PRN-003", "7862000010035"],
    ["p04", "Print \u2014 Old doors", "ART-PRN-004", "7862000010042"],
    ["p05", "Consignment \u2014 The weaver (oil)", "CON-OIL-005", "7862000010059"],
    ["p06", "Consignment \u2014 Market morning", "CON-OIL-006", "7862000010066"],
    ["p07", "Consignment \u2014 Mountain lake print", "CON-PRN-007", "7862000010073"],
    ["p08", "Antique brass compass", "ANT-BRS-008", "7862000010080"],
    ["p09", "Vintage typewriter", "ANT-TYP-009", "7862000010097"],
    ["p10", "Antique wall clock", "ANT-CLK-010", "7862000010103"],
    ["p11", "Aged Manchego 200g", "CHE-MAN-011", "7862000010110"],
    ["p12", "Brie wheel", "CHE-BRI-012", "7862000010127"],
    ["p13", "Blue cheese 150g", "CHE-BLU-013", "7862000010134"],
    ["p14", "Cheese & charcuterie board", "CHE-BRD-014", "7862000010141"],
    ["p15", "Local fresh cheese 250g", "CHE-FRE-015", "7862000010158"],
    ["p16", "Malbec Reserve (bottle)", "WIN-MAL-016", "7862000010165"],
    ["p17", "Cabernet Sauvignon (bottle)", "WIN-CAB-017", "7862000010172"],
    ["p18", "Sauvignon Blanc (bottle)", "WIN-SAU-018", "7862000010189"],
    ["p19", "Sparkling Brut (bottle)", "WIN-BRU-019", "7862000010196"],
    ["p20", "House wine (glass)", "BAR-HRE-020", "7862000010202"],
    ["p21", "Ros\u00e9 (bottle)", "WIN-ROS-021", "7862000010219"],
    ["p22", "Espresso", "BAR-ESP-022", "7862000010226"],
    ["p23", "Cappuccino", "BAR-CAP-023", "7862000010233"],
    ["p24", "Craft beer (pint)", "BAR-BEE-024", "7862000010240"],
    ["p25", "Aperitif spritz", "BAR-SPR-025", "7862000010257"],
    ["p26", "Sparkling water", "BAR-WAT-026", "7862000010264"],
    ["p27", "Tapas plate", "KIT-TAP-027", "7862000010271"],
    ["p28", "Toasted sandwich", "KIT-SAN-028", "7862000010288"],
    ["p29", "Empanadas (2 pcs)", "KIT-EMP-029", "7862000010295"],
    ["p30", "Olives & nuts bowl", "KIT-OLV-030", "7862000010301"],
    ["p31", "Poetry anthology", "LIB-POE-031", "7862000010318"],
    ["p32", "Local art history (book)", "LIB-ART-032", "7862000010325"],
    ["p33", "Wine & cheese tasting (ticket)", "EVT-CAT-033", "7862000010332"],
    ["p34", "Live jazz night (ticket)", "EVT-JAZ-034", "7862000010349"],
    ["p35", "Watercolor workshop (seat)", "EVT-ACU-035", "7862000010356"],
    ["p36", "Tango night (ticket)", "EVT-TAN-036", "7862000010363"],
    ["p37", "Photo exhibition (ticket)", "EVT-FOT-037", "7862000010370"],
    ["p38", "Poetry reading (ticket)", "EVT-POE-038", "7862000010387"]
  ];
  /* [id, codigo, nombre, telefono] */
  var CLIENTES = [
    ["c01", "C-1001", "Ashley Rivera", "3055550101"],
    ["c02", "C-1002", "Marcus Bennett", "3055550102"],
    ["c03", "C-1003", "Lucy Tran", "3055550103"],
    ["c04", "C-1004", "Evan Cross", "3055550104"],
    ["c05", "C-1005", "Maribel Santos", "3055550105"],
    ["c06", "C-1006", "Pete Gorman", "3055550106"],
    ["c07", "C-1007", "Carmen Ulloa", "3055550107"],
    ["c08", "C-1008", "Andre Vinson", "3055550108"]
  ];
  /* [id, nombre, tipo, sucursalId, promotoraId] */
  var UBICACIONES = [
    ["galeria", "Sample Gallery", "propio", "suc01", ""],
    ["consigna", "Artist consignment", "consignacion", "suc01", "pr01"],
    ["bar", "Bar & Caf\u00e9", "propio", "suc02", ""],
    ["eventos", "Cultural events", "socio", "suc03", "pr02"]
  ];
  /* [id, nombre, comisionBase] */
  var PROMOTORAS = [
    ["pr01", "Consignment Artist (sample)", 85],
    ["pr02", "Event Partner (sample)", 10]
  ];
  /* [id, nombre] */
  var SUCURSALES = [
    ["suc01", "Gallery"],
    ["suc02", "Bar & Caf\u00e9"],
    ["suc03", "Events"]
  ];
  function mapa(filas) { var m = {}; filas.forEach(function (f) { m[String(f[0])] = f; }); return m; }
  var MP = mapa(PRODUCTOS), MC = mapa(CLIENTES), MU = mapa(UBICACIONES), MR = mapa(PROMOTORAS), MS = mapa(SUCURSALES);
  function s(x) { return String(x == null ? "" : x); }
  function esProducto(p) { var d = p && p.id != null ? MP[s(p.id)] : null; return !!d && s(p.nombre) === d[1] && s(p.sku) === d[2] && s(p.barcode) === d[3]; }
  function esCliente(c) { var d = c && c.id != null ? MC[s(c.id)] : null; return !!d && s(c.codigo) === d[1] && s(c.nombre) === d[2] && s(c.telefono) === d[3]; }
  function esUbicacion(u) { var d = u && u.id != null ? MU[s(u.id)] : null; return !!d && s(u.nombre) === d[1] && s(u.tipo) === d[2] && s(u.sucursalId) === d[3] && s(u.promotoraId) === d[4]; }
  function esPromotora(p) {
    var d = p && p.id != null ? MR[s(p.id)] : null;
    return !!d && s(p.nombre) === d[1] && (Number(p.comisionBase != null ? p.comisionBase : p.comision) || 0) === d[2];
  }
  function esSucursal(x) { var d = x && x.id != null ? MS[s(x.id)] : null; return !!d && s(x.nombre) === d[1]; }
  function esVenta(v) { return !!(v && /^vs-/.test(s(v.id))); }
  function arr(a) { return Array.isArray(a) ? a : []; }

  /* Devuelve { productos, clientes, ventas, ubicaciones, promotoras, sucursales }: mapas de ids (texto) que NO se ven. */
  function ocultos(estado) {
    var ps = arr(estado && estado.productos), cs = arr(estado && estado.clientes), vs = arr(estado && estado.ventas);
    var us = arr(estado && estado.ubicaciones), prs = arr(estado && estado.promotoras), sus = arr(estado && estado.sucursales);
    var ventasReales = vs.filter(function (v) { return !esVenta(v); });
    var prodReal = {}, cliReal = {};
    ventasReales.forEach(function (v) { if (v && v.productoId != null) prodReal[s(v.productoId)] = 1; if (v && v.clienteId != null) cliReal[s(v.clienteId)] = 1; });
    var rp = ps.filter(function (p) { return esProducto(p) && !prodReal[s(p.id)]; });
    var rc = cs.filter(function (c) { return esCliente(c) && !cliReal[s(c.id)]; });
    var idP = {}; rp.forEach(function (p) { idP[s(p.id)] = 1; });
    var quedan = ps.filter(function (p) { return !idP[s(p && p.id)]; });
    var ubicUsadas = {}; quedan.forEach(function (p) { if (p && p.ubicacionId) ubicUsadas[s(p.ubicacionId)] = 1; });
    var ru = us.filter(function (u) { return esUbicacion(u) && !ubicUsadas[s(u.id)]; });
    var idU = {}; ru.forEach(function (u) { idU[s(u.id)] = 1; });
    var ubicQuedan = us.filter(function (u) { return !idU[s(u && u.id)]; });
    var promUsadas = {}, sucUsadas = {};
    ubicQuedan.forEach(function (u) { if (u && u.promotoraId) promUsadas[s(u.promotoraId)] = 1; if (u && u.sucursalId) sucUsadas[s(u.sucursalId)] = 1; });
    quedan.forEach(function (p) { if (p && p.comisionistaId) promUsadas[s(p.comisionistaId)] = 1; });
    var rpr = prs.filter(function (p) { return esPromotora(p) && !promUsadas[s(p.id)]; });
    var rsu = sus.filter(function (x) { return esSucursal(x) && !sucUsadas[s(x.id)]; });
    function set(a) { var o = {}; a.forEach(function (x) { o[s(x.id)] = true; }); return o; }
    return {
      productos: set(rp), clientes: set(rc), ventas: set(vs.filter(esVenta)),
      ubicaciones: set(ru), promotoras: set(rpr), sucursales: set(rsu)
    };
  }
  /* true si hay que aplicar la regla: el negocio tiene licencia (licenseCode o syncCode en f123_owned) o es una tienda unida (sufijo). */
  function negocioConLicencia(owned, sufijo) {
    var o = owned || {};
    return !!(s(o.licenseCode).trim() || s(o.syncCode).trim() || sufijo);
  }
  /* Copia superficial del estado SIN la semilla demo (el original no se toca). */
  function sinDemo(estado) {
    var oc = ocultos(estado);
    var copia = {}; Object.keys(estado || {}).forEach(function (k) { copia[k] = estado[k]; });
    function f(a, t) { return arr(a).filter(function (x) { return !(x && x.id != null && oc[t][s(x.id)]); }); }
    copia.productos = f(estado.productos, "productos");
    copia.clientes = f(estado.clientes, "clientes");
    copia.ventas = f(estado.ventas, "ventas");
    copia.ubicaciones = f(estado.ubicaciones, "ubicaciones");
    copia.promotoras = f(estado.promotoras, "promotoras");
    copia.sucursales = f(estado.sucursales, "sucursales");
    return copia;
  }
  root.OCDemoHuellas = { ocultos: ocultos, sinDemo: sinDemo, negocioConLicencia: negocioConLicencia,
    esProducto: esProducto, esCliente: esCliente, esUbicacion: esUbicacion, esPromotora: esPromotora, esSucursal: esSucursal, esVenta: esVenta };
})(typeof window !== "undefined" ? window : this);
