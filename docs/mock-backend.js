// mock-backend.js — Backend simulado dentro del navegador, para la demo
// pública en GitHub Pages (que no puede correr Node). Intercepta fetch a
// /api/* y responde con la misma lógica que server.js, usando datos de
//
// NO CLOUD (JFC, regla dura, ver PRIVACY.md): TODO lo que este archivo
// maneja (productos, ventas, clientes, movimientos, comisiones, fotos) vive
// y muere en localStorage de ESTE navegador. Este archivo NUNCA debe hacer
// fetch() hacia un dominio externo — cero excepciones. El unico feature con
// permiso de tocar red es el ping de licencia en auth-ui.js (instanceId +
// datos de contacto opcionales), y ese vive en otro archivo a proposito.
// Antes de agregar cualquier fetch() aqui: parar y preguntar a JFC.
// ejemplo en memoria. En el servidor real este archivo NO se carga.
(function () {
  // Local-first: si pocketbase-client.js ya activó una conexión remota
  // (OC_PB_URL guardado en Avanzado), el mock NO debe pisar ese fetch.
  // Por defecto (sin URL guardada) todo corre local con este mock/servidor.
  if (window.OC_PB_CONNECTED) return;
  // Marca global para que index.html sepa que corre sin backend real y NUNCA
  // muestre un mensaje de "el servidor no responde" en la demo pública.
  window.OC_DEMO = true;
  // Timezone: reads from localStorage (set by store owner in Avanzado) or falls back to browser local.
  const ZONA = (() => {
    const tz = localStorage.getItem("f123_timezone");
    if (!tz) return Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; }
    catch (_) { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  })();
  function hoyISO() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  /* BUG DE DINERO (arreglado en amigable-123 el 2026-08-06, portado aqui el
     2026-08-18 en la caza Hugo/Paco/Luis).

     Las ventas se guardan con `new Date().toISOString()`, que es UTC. Comparar
     ese texto crudo contra el dia o el mes LOCAL —con .slice(0,10) o
     .slice(0,7)— es correcto solo en UTC+0. En Ecuador (UTC-5) toda venta
     hecha despues de las 19:00 ya tiene la fecha del dia siguiente en UTC:

       - desaparecia del "hoy" y reaparecia manana (el cierre de caja no cuadra)
       - la del ultimo dia del mes caia en la liquidacion del mes SIGUIENTE,
         o sea la comision se le pagaba a alguien un mes tarde

     Esta funcion traduce un ISO cualquiera al dia LOCAL del negocio. Toda
     comparacion de fechas tiene que pasar por aqui; ver el guard
     .claude/guards.sh, que falla si vuelve a aparecer un .slice() sobre una
     fecha cruda. */
  function fechaLocalDe(fechaISO) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(fechaISO));
    } catch (_) {
      /* Fecha ilegible: se devuelve el prefijo crudo. Peor que exacto, pero
         mucho mejor que romper el filtro entero por un dato malo. */
      return String(fechaISO || "").slice(0, 10);
    }
  }
  // Días reales del mes actual (28/29/30/31) — espejo de diasEnMesActual() en server.js.
  function diasEnMesActual() {
    const [anio, mes] = hoyISO().split("-").map(Number);
    return new Date(anio, mes, 0).getDate();
  }

  // Perchas (unidades operativas). sucursalId -> agrupador backend.
  const ubicaciones = [
    { "id": "galeria",  "nombre": "Sample Gallery",        "activa": true, "tipo": "propio",        "sucursalId": "suc01" },
    { "id": "consigna", "nombre": "Artist consignment", "activa": true, "tipo": "consignacion",  "sucursalId": "suc01", "promotoraId": "pr01", "comisionSocio": 85, "metaMensual": 800, "lecturaPreferida": "asociado", "escalasComision": [ {"hasta":80,"comision":85}, {"hasta":120,"comision":88}, {"hasta":999,"comision":90} ] },
    { "id": "bar",      "nombre": "Bar & Café",               "activa": true, "tipo": "propio",        "sucursalId": "suc02" },
    { "id": "eventos",  "nombre": "Cultural events",       "activa": true, "tipo": "socio",         "sucursalId": "suc03", "promotoraId": "pr02", "comisionSocio": 10, "metaMensual": 500, "escalasComision": [] }
  ];
  // Sucursales: agrupadores backend de perchas (encabezados de sección en Inventario).
  // Asociados/as: artistas en consignación (modalidad artista 85/15) y quien trae público.
  const promotoras = [
    { id: "pr01", nombre: "Consignment Artist (sample)",  comisionBase: 85, comision: 85 },
    { id: "pr02", nombre: "Event Partner (sample)",  comisionBase: 10, comision: 10 },
  ];
  const sucursales = [
    { id: "suc01", nombre: "Gallery",    activa: true },
    { id: "suc02", nombre: "Bar & Café", activa: true },
    { id: "suc03", nombre: "Events",    activa: true },
  ];

  const productos = [
    {"id":"p01","nombre":"Original oil — City rooftops","categoria":"Paintings","sku":"ART-OIL-001","barcode":"7862000010011","ubicacionId":"galeria","precio":420,"costo":180,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"In-house studio"},
    {"id":"p02","nombre":"Original watercolor — River bend","categoria":"Paintings","sku":"ART-WAT-002","estrella":true,"barcode":"7862000010028","ubicacionId":"galeria","precio":260,"costo":110,"stockActual":2,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"In-house studio"},
    {"id":"p03","nombre":"Print — Mountain series I","categoria":"Art & prints","sku":"ART-PRN-003","barcode":"7862000010035","ubicacionId":"galeria","precio":45,"costo":16,"stockActual":24,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Fine Art Press"},
    {"id":"p04","nombre":"Print — Old doors","categoria":"Art & prints","sku":"ART-PRN-004","barcode":"7862000010042","ubicacionId":"galeria","precio":38,"costo":14,"stockActual":30,"umbralRojo":8,"umbralAmarillo":15,"proveedor":"Fine Art Press"},
    {"id":"p05","nombre":"Consignment — The weaver (oil)","categoria":"Paintings","sku":"CON-OIL-005","barcode":"7862000010059","ubicacionId":"consigna","precio":520,"costo":0,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Consignment Artist (sample)"},
    {"id":"p06","nombre":"Consignment — Market morning","categoria":"Paintings","sku":"CON-OIL-006","estrella":true,"barcode":"7862000010066","ubicacionId":"consigna","precio":380,"costo":0,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Consignment Artist (sample)"},
    {"id":"p07","nombre":"Consignment — Mountain lake print","categoria":"Art & prints","sku":"CON-PRN-007","barcode":"7862000010073","ubicacionId":"consigna","precio":60,"costo":0,"stockActual":12,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Consignment Artist (sample)"},
    {"id":"p08","nombre":"Antique brass compass","categoria":"Antiques","sku":"ANT-BRS-008","barcode":"7862000010080","ubicacionId":"galeria","precio":145,"costo":70,"stockActual":3,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Downtown Antiques"},
    {"id":"p09","nombre":"Vintage typewriter","categoria":"Antiques","sku":"ANT-TYP-009","estrella":true,"barcode":"7862000010097","ubicacionId":"galeria","precio":320,"costo":160,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Downtown Antiques"},
    {"id":"p10","nombre":"Antique wall clock","categoria":"Antiques","sku":"ANT-CLK-010","barcode":"7862000010103","ubicacionId":"galeria","precio":180,"costo":90,"stockActual":2,"umbralRojo":1,"umbralAmarillo":2,"dormidoDesde":"2026-06-10","proveedor":"Downtown Antiques"},
    {"id":"p11","nombre":"Aged Manchego 200g","categoria":"Cheese & deli","sku":"CHE-MAN-011","barcode":"7862000010110","ubicacionId":"bar","precio":14,"costo":7,"stockActual":18,"umbralRojo":5,"umbralAmarillo":10,"perecible":true,"fechaCaducidad":"2026-09-24","proveedor":"Valley Cheese Co."},
    {"id":"p12","nombre":"Brie wheel","categoria":"Cheese & deli","sku":"CHE-BRI-012","barcode":"7862000010127","ubicacionId":"bar","precio":12,"costo":6,"stockActual":12,"umbralRojo":4,"umbralAmarillo":8,"perecible":true,"fechaCaducidad":"2026-09-18","proveedor":"Valley Cheese Co."},
    {"id":"p13","nombre":"Blue cheese 150g","categoria":"Cheese & deli","sku":"CHE-BLU-013","estrella":true,"barcode":"7862000010134","ubicacionId":"bar","precio":16,"costo":8.5,"stockActual":10,"umbralRojo":3,"umbralAmarillo":6,"perecible":true,"fechaCaducidad":"2026-09-16","proveedor":"Valley Cheese Co."},
    {"id":"p14","nombre":"Cheese & charcuterie board","categoria":"Cheese & deli","sku":"CHE-BRD-014","barcode":"7862000010141","ubicacionId":"bar","precio":18,"costo":8,"stockActual":20,"umbralRojo":5,"umbralAmarillo":10,"perecible":true,"fechaCaducidad":"2026-09-14","proveedor":"In-house kitchen"},
    {"id":"p15","nombre":"Local fresh cheese 250g","categoria":"Cheese & deli","sku":"CHE-FRE-015","barcode":"7862000010158","ubicacionId":"bar","precio":6,"costo":3,"stockActual":24,"umbralRojo":6,"umbralAmarillo":12,"perecible":true,"fechaCaducidad":"2026-09-12","proveedor":"Valley Farm"},
    {"id":"p16","nombre":"Malbec Reserve (bottle)","categoria":"Wine","sku":"WIN-MAL-016","estrella":true,"barcode":"7862000010165","ubicacionId":"bar","precio":28,"costo":14,"stockActual":48,"umbralRojo":12,"umbralAmarillo":24,"proveedor":"Andes Wine Distributors"},
    {"id":"p17","nombre":"Cabernet Sauvignon (bottle)","categoria":"Wine","sku":"WIN-CAB-017","barcode":"7862000010172","ubicacionId":"bar","precio":24,"costo":12,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"proveedor":"Andes Wine Distributors"},
    {"id":"p18","nombre":"Sauvignon Blanc (bottle)","categoria":"Wine","sku":"WIN-SAU-018","barcode":"7862000010189","ubicacionId":"bar","precio":22,"costo":11,"stockActual":40,"umbralRojo":10,"umbralAmarillo":20,"proveedor":"Andes Wine Distributors"},
    {"id":"p19","nombre":"Sparkling Brut (bottle)","categoria":"Wine","sku":"WIN-BRU-019","barcode":"7862000010196","ubicacionId":"bar","precio":32,"costo":17,"stockActual":30,"umbralRojo":8,"umbralAmarillo":16,"proveedor":"Andes Wine Distributors"},
    {"id":"p20","nombre":"House wine (glass)","categoria":"Bar","sku":"BAR-HRE-020","barcode":"7862000010202","ubicacionId":"bar","precio":6,"costo":2.2,"stockActual":90,"umbralRojo":20,"umbralAmarillo":40,"proveedor":"Andes Wine Distributors"},
    {"id":"p21","nombre":"Rosé (bottle)","categoria":"Wine","sku":"WIN-ROS-021","barcode":"7862000010219","ubicacionId":"bar","precio":19,"costo":9,"stockActual":36,"umbralRojo":9,"umbralAmarillo":18,"proveedor":"Andes Wine Distributors"},
    {"id":"p22","nombre":"Espresso","categoria":"Bar","sku":"BAR-ESP-022","barcode":"7862000010226","ubicacionId":"bar","precio":2.5,"costo":0.6,"stockActual":200,"umbralRojo":40,"umbralAmarillo":80,"proveedor":"Mountain Coffee Roasters"},
    {"id":"p23","nombre":"Cappuccino","categoria":"Bar","sku":"BAR-CAP-023","estrella":true,"barcode":"7862000010233","ubicacionId":"bar","precio":3.5,"costo":0.9,"stockActual":200,"umbralRojo":40,"umbralAmarillo":80,"proveedor":"Mountain Coffee Roasters"},
    {"id":"p24","nombre":"Craft beer (pint)","categoria":"Bar","sku":"BAR-BEE-024","barcode":"7862000010240","ubicacionId":"bar","precio":6,"costo":2.5,"stockActual":80,"umbralRojo":20,"umbralAmarillo":40,"proveedor":"Local Brewery"},
    {"id":"p25","nombre":"Aperitif spritz","categoria":"Bar","sku":"BAR-SPR-025","barcode":"7862000010257","ubicacionId":"bar","precio":8,"costo":3,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"proveedor":"In-house bar"},
    {"id":"p26","nombre":"Sparkling water","categoria":"Bar","sku":"BAR-WAT-026","barcode":"7862000010264","ubicacionId":"bar","precio":2.5,"costo":0.8,"stockActual":120,"umbralRojo":24,"umbralAmarillo":48,"proveedor":"City Distributors"},
    {"id":"p27","nombre":"Tapas plate","categoria":"Kitchen","sku":"KIT-TAP-027","estrella":true,"barcode":"7862000010271","ubicacionId":"bar","precio":9,"costo":3.5,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"perecible":true,"fechaCaducidad":"2026-09-05","proveedor":"In-house kitchen"},
    {"id":"p28","nombre":"Toasted sandwich","categoria":"Kitchen","sku":"KIT-SAN-028","barcode":"7862000010288","ubicacionId":"bar","precio":7,"costo":2.8,"stockActual":50,"umbralRojo":12,"umbralAmarillo":24,"perecible":true,"fechaCaducidad":"2026-09-04","proveedor":"In-house kitchen"},
    {"id":"p29","nombre":"Empanadas (2 pcs)","categoria":"Kitchen","sku":"KIT-EMP-029","barcode":"7862000010295","ubicacionId":"bar","precio":5,"costo":1.8,"stockActual":70,"umbralRojo":18,"umbralAmarillo":36,"perecible":true,"fechaCaducidad":"2026-09-03","proveedor":"In-house kitchen"},
    {"id":"p30","nombre":"Olives & nuts bowl","categoria":"Kitchen","sku":"KIT-OLV-030","barcode":"7862000010301","ubicacionId":"bar","precio":4.5,"costo":1.5,"stockActual":80,"umbralRojo":20,"umbralAmarillo":40,"proveedor":"In-house kitchen"},
    {"id":"p31","nombre":"Poetry anthology","categoria":"Books","sku":"LIB-POE-031","barcode":"7862000010318","ubicacionId":"galeria","precio":18,"costo":8,"stockActual":20,"umbralRojo":5,"umbralAmarillo":10,"proveedor":"Independent Press"},
    {"id":"p32","nombre":"Local art history (book)","categoria":"Books","sku":"LIB-ART-032","estrella":true,"barcode":"7862000010325","ubicacionId":"galeria","precio":24,"costo":11,"stockActual":15,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"Independent Press"},
    {"id":"p33","nombre":"Wine & cheese tasting (ticket)","categoria":"Tickets & events","sku":"EVT-CAT-033","estrella":true,"barcode":"7862000010332","ubicacionId":"eventos","precio":22,"costo":6,"stockActual":40,"umbralRojo":8,"umbralAmarillo":20,"proveedor":"In-house event"},
    {"id":"p34","nombre":"Live jazz night (ticket)","categoria":"Tickets & events","sku":"EVT-JAZ-034","barcode":"7862000010349","ubicacionId":"eventos","precio":18,"costo":5,"stockActual":60,"umbralRojo":12,"umbralAmarillo":30,"proveedor":"In-house event"},
    {"id":"p35","nombre":"Watercolor workshop (seat)","categoria":"Tickets & events","sku":"EVT-ACU-035","barcode":"7862000010356","ubicacionId":"eventos","precio":25,"costo":9,"stockActual":20,"umbralRojo":4,"umbralAmarillo":10,"proveedor":"In-house event"},
    {"id":"p36","nombre":"Tango night (ticket)","categoria":"Tickets & events","sku":"EVT-TAN-036","barcode":"7862000010363","ubicacionId":"eventos","precio":15,"costo":4,"stockActual":50,"umbralRojo":10,"umbralAmarillo":25,"proveedor":"In-house event"},
    {"id":"p37","nombre":"Photo exhibition (ticket)","categoria":"Tickets & events","sku":"EVT-FOT-037","barcode":"7862000010370","ubicacionId":"eventos","precio":8,"costo":2,"stockActual":80,"umbralRojo":16,"umbralAmarillo":40,"proveedor":"In-house event"},
    {"id":"p38","nombre":"Poetry reading (ticket)","categoria":"Tickets & events","sku":"EVT-POE-038","barcode":"7862000010387","ubicacionId":"eventos","precio":12,"costo":3,"stockActual":40,"umbralRojo":8,"umbralAmarillo":20,"dormidoDesde":"2026-07-01","proveedor":"In-house event"}
  ];

  const ventas = [];
  const movimientos = [];
  const transferencias = [];
  // GASTOS (2026-08-27): gastos individuales registrados por el dueño. Cada
  // gasto es un movimiento tipo "gasto" con concepto, monto, fecha y ubicación.
  // Se guardan en su propio array para listarlos y sumarlos sin mezclarlos con
  // la actividad operativa. Viajan por el sync como el resto del estado.
  const gastos = [];

  // ==========================================================================
  // CLIENTES (JFC 2026-07-07) — cada cliente tiene un CODIGO UNICO (C-####) y
  // vive una ESTACION segun su comportamiento de compra (metodo RFM vestido
  // de ciclo de siembra, para que el dueno lo lea como lee el semaforo):
  //   Primavera 🌱 = compra reciente, todavia poco valor (recien germina)
  //   Verano   ☀️ = compra reciente Y valor alto (plena cosecha)
  //   Otoño    🍂 = valor alto pero ya no viene (se esta enfriando: recuperalo)
  //   Invierno ❄️ = frio y sin valor reciente, o nunca ha comprado
  // R = recencia (dias desde la ultima compra), F = frecuencia (compras en 90
  // dias), M = monto ($ en 90 dias). "Valor alto" = monto >= mediana de los
  // clientes con compras — umbral honesto que se adapta al negocio.
  // ==========================================================================
  // evaluacion: { trato: -1|0|1, confiabilidad: -1|0|1, historial: [], despedido: false }
  // Valores demo pre-sembrados para mostrar las 4 categorias de la matriz.
  // trato:      -1=Difícil  0=Neutro  +1=Agradable
  // confiabilidad: -1=Precaución  0=Neutro  +1=Confiable
  const clientes = [
    {"id":"c01","codigo":"C-1001","nombre":"Ashley Rivera",      "telefono":"3055550101","evaluacion":{"trato":1,"confiabilidad":1,"historial":[]}},
    {"id":"c02","codigo":"C-1002","nombre":"Marcus Bennett",  "telefono":"3055550102","evaluacion":{"trato":-1,"confiabilidad":-1,"historial":[]}},
    {"id":"c03","codigo":"C-1003","nombre":"Lucy Tran",     "telefono":"3055550103","evaluacion":{"trato":0,"confiabilidad":0,"historial":[]}},
    {"id":"c04","codigo":"C-1004","nombre":"Evan Cross",     "telefono":"3055550104","evaluacion":{"trato":-1,"confiabilidad":1,"historial":[]}},
    {"id":"c05","codigo":"C-1005","nombre":"Maribel Santos","telefono":"3055550105","evaluacion":{"trato":0,"confiabilidad":0,"historial":[]}},
    {"id":"c06","codigo":"C-1006","nombre":"Pete Gorman",     "telefono":"3055550106","evaluacion":{"trato":1,"confiabilidad":-1,"historial":[]}},
    {"id":"c07","codigo":"C-1007","nombre":"Carmen Ulloa",     "telefono":"3055550107","evaluacion":{"trato":0,"confiabilidad":0,"historial":[]}},
    {"id":"c08","codigo":"C-1008","nombre":"Andre Vinson","telefono":"3055550108","evaluacion":{"trato":0,"confiabilidad":0,"historial":[]}}
  ];

  // ---- VENTAS SEMILLA (historial de ~120 dias) ----
  // Alimentan las dos matrices (estaciones de clientes y BCG de inventario)
  // y los estados negro/BCG con datos creibles. REGLA: jamas darle ventas
  // "solo viejas" a un producto que deba verse verde/amarillo (se volveria
  // negro por dias-sin-venta), ni tocar los productos con dormidoDesde.
  function sembrarVentasDemo() {
    const gen = (pid, dias, cli, cant) => {
      const p = productos.find((x) => x.id === pid);
      if (!p) return;
      dias.forEach((d, i) => {
        ventas.push({ id: "vs-" + pid + "-" + d + "-" + i, productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant || 1, precioUnit: p.precio, costoUnit: p.costo, fecha: new Date(Date.now() - d * 86400000).toISOString(), split: null, liquidada: true, clienteId: cli || null });
      });
    };
    // Bar & café: alto volumen, tickets chicos (lo que sostiene el día a día).
    gen("p22", [0,0,1,1,2,3,4,6,8,11,14], null, 1);      // espressos
    gen("p23", [0,1,1,2,3,5,7,9,12], "c01", 1);           // cappuccinos (c01 cliente frecuente reciente)
    gen("p24", [0,1,2,4,6,9], "c02", 1);                  // cervezas (c02 muy frecuente)
    gen("p20", [0,2,3,5,8], null, 2);                     // copas de vino de la casa
    gen("p27", [1,3,6,10], "c02", 1);                     // tapas
    gen("p29", [0,2,4,7], null, 2);                       // empanadas
    // Vinos y quesos por botella/tabla: ticket medio, menos frecuente.
    gen("p16", [3,12,20], "c01", 1);                      // Malbec (c01 valioso)
    gen("p11", [5,15], "c04", 1);                         // Manchego (c04 primavera)
    gen("p14", [7], "c03", 1);                            // tabla de quesos (c03 recién germina)
    // Galería y antigüedades: raro, ticket alto.
    gen("p02", [22], "c05", 1);                           // acuarela (c05 otoño, valía mucho)
    gen("p09", [30], "c06", 1);                           // máquina de escribir (c06 otoño)
    gen("p32", [40], "c06", 1);                           // libro de arte
    // Consignación de artista (comisión 85/15): dispara el cálculo de comisiones.
    gen("p06", [10], "c04", 1);                           // óleo en consignación
    gen("p07", [6, 18], null, 1);                         // láminas en consignación
    // Eventos culturales: por tandas.
    gen("p33", [4, 32], "c01", 2);                        // cata de vinos y quesos
    gen("p34", [11], null, 3);                            // jazz
    gen("p35", [8], "c03", 1);                            // taller de acuarela
    // c07 invierno (última compra vieja), c08 nunca compró.
    gen("p16", [95, 110], "c07", 1);
  }
  // Microcirugia 1 (2026-07-07): el arranque JAMAS puede tumbar el
  // interceptor — sin el, la app abre sin backend (pantallas vacias). Si la
  // siembra falla, se arranca sin historial; el error queda en consola.
  try { sembrarVentasDemo(); } catch (e) { console.error("Seed de ventas fallo (la app arranca sin historial):", e); }
  const gastosMensuales = {"galeria":900,"consigna":0,"bar":1500,"eventos":350};
  /* CONFIGURACIÓN DE CATEGORÍAS QUE VIAJA (JFC 2026-09-22, hallazgo #2 de Codex).
     borradores.js guarda en localStorage las categorías PROPIAS (aunque estén
     vacías) y las OCULTAS. Eso no viajaba ni por sync ni en el respaldo: un
     aparato nuevo no las veía. (Los productos sí viajan con su categoría; lo que
     se perdía era la configuración.)
     Mapa id(nombre en minúsculas) -> { id, nombre, estado, rev }, con estado:
       custom  = categoría propia (en la lista aunque esté vacía)
       borrada = se quitó de las propias (LÁPIDA: no resucita)
       oculta  = categoría semilla escondida
       visible = dejó de estar oculta
     Se fusiona como el resto del catálogo: gana la revisión mayor. NO se unen
     listas a ciegas: eso resucitaría el nombre viejo de una categoría renombrada
     (el "se aumenta en vez de reemplazar" que reportó Belén).
     Las dos listas de localStorage siguen siendo lo que lee la pantalla; este
     mapa solo las AJUSTA para las categorías que tienen registro. Una categoría
     sin registro jamás se toca. */
  const categoriasMeta = {};
  const _CAT_ESTADOS = ["custom", "borrada", "oculta", "visible"];
  /* v347 (auditoría Codex #2): las listas de categorías llevan el sufijo del
     cuaderno activo (OC_STATE_SUFIJO), igual que el estado. En el cuaderno
     propio el sufijo es "" y la clave es la de siempre: nada se mueve ni se
     borra. Antes, un aparato que se unía a OTRA tienda (sufijo "::<licencia>")
     leía las listas globales y _sembrarCategoriasLegado metía sus categorías
     en el catálogo de esa tienda. Se evalúa al usarse (no al cargar): esta
     línea corre antes de que exista OC_STATE_SUFIJO. */
  const _CAT_BASE_CUSTOM = "f123_categorias_custom";
  const _CAT_BASE_OCULTAS = "f123_categorias_ocultas";
  function _catKey(base) { try { return base + (OC_STATE_SUFIJO || ""); } catch (_) { return base; } }
  /* IMPUESTO CONFIGURABLE (JFC 2026-09-23): "no puede ser un given ni
     inmutable... somos ante todo un SHARED digital NOTEBOOK". Es un ajuste DEL
     CUADERNO: viaja a todos los aparatos de la licencia (colección "ajustes"
     del sync, con rev) y en el respaldo. Por defecto APAGADO = precios netos
     (estándar EE. UU.), que es lo que el P&G ya hacía desde 2026-07-15: nadie
     ve cambiar sus números hasta que el dueño lo encienda. Encendido = el
     precio INCLUYE el impuesto (IVA, VAT, GST…) y el P&G lo separa. */
  let ajusteImpuesto = null; // { id: "impuesto", activo, tasa, nombre, rev }
  function _normImpuesto(r) {
    if (!r || r.id !== "impuesto") return null;
    const t = Number(r.tasa);
    if (!Number.isFinite(t) || t < 0 || t > 100) return null;
    return { id: "impuesto", activo: !!r.activo, tasa: +t.toFixed(3), nombre: String(r.nombre || "Tax").trim().slice(0, 30) || "Tax",
      // v361: "incluido" = el precio ya trae el impuesto (IVA/VAT); "agregado" =
      // se suma al cobrar (sales tax de EE. UU./Canadá).
      modo: r.modo === "agregado" ? "agregado" : "incluido", rev: r.rev || null };
  }
  /* MONEDA DEL CUADERNO (v361, JFC 2026-09-23: app global). Código ISO 4217;
     por defecto USD (lo que la app mostraba siempre). Viaja como "ajustes". */
  let ajusteMoneda = null; // { id: "moneda", codigo, rev }
  function _normMoneda(r) {
    if (!r || r.id !== "moneda") return null;
    const c = String(r.codigo || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return null;
    return { id: "moneda", codigo: c, rev: r.rev || null };
  }
  window.OCMoneda = {
    codigo() { return (ajusteMoneda && ajusteMoneda.codigo) || "USD"; },
    formato(n, loc) {
      const v = Number(n);
      const c = this.codigo();
      try { return new Intl.NumberFormat(loc || (c === "USD" ? "en-US" : undefined), { style: "currency", currency: c }).format(isFinite(v) ? v : 0); }
      catch (_) { return "$" + (isFinite(v) ? v : 0).toFixed(2); }
    },
  };
  /* Impuesto de UNA línea de venta (v361). En centavos enteros y redondeado por
     línea (como un ticket), y se GUARDA en la venta: cambiar la tasa después
     no reescribe el pasado. Producto exento o impuesto apagado = null. */
  function _impuestoDeVenta(p, precioUnit, cant) {
    const imp = _impuestoVigente();
    if (!imp || (p && p.exentoImpuesto)) return null;
    const baseC = Math.round((Number(precioUnit) || 0) * (Number(cant) || 0) * 100);
    if (baseC <= 0) return null;
    const montoC = imp.modo === "agregado"
      ? Math.round(baseC * imp.tasa / 100)
      : baseC - Math.round(baseC / (1 + imp.tasa / 100));
    return { tasa: imp.tasa, nombre: imp.nombre, modo: imp.modo, monto: montoC / 100 };
  }
  function _impuestoVigente() { return ajusteImpuesto && ajusteImpuesto.activo && ajusteImpuesto.tasa > 0 ? ajusteImpuesto : null; }
  // Usuarios nombrados (encargados): hasta 49.
  // El dueno NO aparece aqui — su acceso es por PIN en crypto-store.
  // Cada entrada: { id, nombre, pin, rol:"empleado", activo, creadoEn }
  // NOTA DE SEGURIDAD: en la demo el PIN se almacena en texto porque no hay
  // servidor. En produccion (server.js) usar PBKDF2 igual que el dueno.
  const usuarios = [];
  // Apropiación 789 (2026-07-08): ID único de esta instancia. null en la demo;
  // se fija al activar con 789. Viaja en respaldos/sync para que los datos
  // queden atados a un negocio y no se confundan entre compradores.
  // instanceId se HIDRATA desde f123_owned en el arranque (JFC 2026-08-06):
  // antes arrancaba null y solo se seteaba al llamar al endpoint de activacion,
  // asi que tras CUALQUIER recarga de un dispositivo YA apropiado quedaba null y
  // el gate del plan gratuito (!instanceId) volvia a capar a 25 productos a
  // alguien que ya activo. (licenciaLimitada solo dispara con "limitada"
  // deliberada desde el panel, no con el default del worker.)
  /* FIX ONE-TIME: LICENCIA MAL TECLEADA S2324 -> S2J24 (JFC 2026-09-16, v296).
     El observatorio (panel privado JFC) mostro DOS licencias del MISMO email que
     difieren en UN caracter: el celular quedo activado bajo
     F123-A6YK-(privada) (con "3") en vez de la canonica
     F123-A6YK-(privada) (con "J"). Trampa clasica J/3. Son la misma persona
     (el panel lo detecta: "same email on 2 licenses - claim/merge"). Como la sala
     de sync se deriva de la licencia (v295), estar en S2324 = sala distinta = nunca
     converge con el PC. Aqui, en el aparato que tiene la licencia mal tecleada, se
     reescribe a la canonica para que se una solo a la misma sala. Gated a la cadena
     EXACTA equivocada (ningun otro aparato/licencia se toca). One-time (flag).
     DORMANT/removible una vez que el celular quede unificado. */
  try {
    /* El observatorio (KV de licencias en produccion) mostro VARIAS variantes con
       errata de la MISMA licencia canonica, generadas por codigo mio (rescate/
       reconcile) a lo largo de las semanas: BF2A<->B2FA y S2J24<->S2324. Cada
       variante = otra sala = no converge. Aqui se pliegan TODAS las variantes
       conocidas (coincidencia EXACTA, para no tocar la licencia de otro usuario) a
       la canonica. Flag v2 para que re-corra en aparatos que ya corrieron el fix v1
       (que solo cubria S2324). One-time. DORMANT/removible cuando ya no queden
       aparatos en variantes. */
    /* Huella (hash cyrb53) en vez del texto de la licencia (JFC 2026-09-22: el repo
       es PÚBLICO; nunca escribir una licencia completa aquí). Mismo resultado. */
    var _h53 = function(str){var h1=0xdeadbeef,h2=0x41c6ce57;for(var i=0,ch;i<str.length;i++){ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return 4294967296*(2097151&h2)+(h1>>>0);}
    var _H_BIEN = 6583453063440131;
    var _H_VARIANTES = [7204376699570609, 5045741297197422, 3653161193443980];
    if (localStorage.getItem("f123_fix_lic_v2") !== "1") {
      var _o = JSON.parse(localStorage.getItem("f123_owned") || "null");
      var _lc = _o && typeof _o.licenseCode === "string" ? _o.licenseCode.trim().toUpperCase().replace(/\s+/g, "") : "";
      var _BIEN = _lc.replace("B2FA", "BF2A").replace("S2324", "S2J24"); // variante -> canónica
      if (_o && _H_VARIANTES.indexOf(_h53(_lc)) !== -1 && _h53(_BIEN) === _H_BIEN) {
        _o.licenseCode = _BIEN;
        if (_o.syncCode) _o.syncCode = _BIEN;
        localStorage.setItem("f123_owned", JSON.stringify(_o));
        try { localStorage.setItem("f123_sync_room", JSON.stringify({ codigo: _BIEN })); } catch (_) {}
        // Deja correr la purga de semilla en este aparato (ya en la canonica) para
        // que no re-contamine la sala al unirse.
        try { localStorage.removeItem("f123_limpieza_demo_jfc_v1"); } catch (_) {}
        try { console.warn("[fix-lic] variante " + _lc + " reescrita a la canonica " + _BIEN + "."); } catch (_) {}
      }
      localStorage.setItem("f123_fix_lic_v2", "1");
    }
  } catch (_) {}
  /* RETIRO DEL LORD (#14, orden de JFC 2026-09-23: "hazlo ya"). JFC es el
     DUEÑO de la app; un aparato suyo es simplemente un aparato EN su licencia
     principal. La marca f123_lord y su "licencia canónica" eran del sync viejo.
     Una sola vez, en un aparato que tenía la marca: su licencia guardada se
     alinea con la canónica (la que _licenciaPropia ya usaba como su casa), se
     guarda copia de la anterior en f123_owned_pre_lord_v1 y se quita la marca.
     Un aparato sin marca (todos los de clientes) no se toca. */
  try {
    if (localStorage.getItem("f123_lord_retirado_v1") !== "1") {
      if (localStorage.getItem("f123_lord") === "1") {
        const _can = String(localStorage.getItem("f123_lord_licencia_canonica") || "").trim().toUpperCase().replace(/\s+/g, "");
        const _raw = localStorage.getItem("f123_owned");
        const _o = _raw ? JSON.parse(_raw) : null;
        if (_o && /^F123-/.test(_can) && (_o.licenseCode !== _can || (_o.syncCode && _o.syncCode !== _can))) {
          localStorage.setItem("f123_owned_pre_lord_v1", _raw);
          _o.licenseCode = _can;
          if (_o.syncCode) _o.syncCode = _can;
          localStorage.setItem("f123_owned", JSON.stringify(_o));
        }
        localStorage.removeItem("f123_lord");
      }
      localStorage.setItem("f123_lord_retirado_v1", "1");
    }
  } catch (_) {}
  let instanceId = (function () { try { return (JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).instanceId || null; } catch (_) { return null; } })();
  // Mejora #2 (JFC 2026-07-16): "limitada" = JFC bajo el estado desde el panel
  // (ej. cliente moroso) sin bloquear del todo. Se comporta como si el
  // dispositivo NUNCA se hubiera activado: vuelve a los topes free (25/100/1).
  function licenciaLimitada() {
    try { return (JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).licenseEstado === "limitada"; } catch (_) { return false; }
  }
  /* PRIME DIRECTIVE 1A (JFC 2026-09-02): JAMÁS capar a un dueño de licencia ya
     activado. A idiomARTE (primer cliente pagado) le salió el límite del plan
     gratis por un `instanceId` transitoriamente null tras un reload. Este helper
     falla ABIERTO: re-lee f123_owned EN VIVO en cada chequeo (no solo la
     hidratación de arranque, que pudo correr antes que localStorage) y trata como
     licenciado a cualquier dispositivo con instanceId o código de licencia, salvo
     que JFC lo haya bajado a "limitada" a mano desde el panel. Solo AFLOJA topes;
     nunca puede romperle a un cliente. La demo (sin f123_owned) sigue con su tope. */
  function estaLicenciado() {
    try {
      const o = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      if (o.licenseEstado === "limitada") return false; // baja deliberada desde el panel
      if (o.instanceId || o.licenseCode) {
        if (!instanceId && o.instanceId) instanceId = o.instanceId; // re-hidrata si el arranque quedó null
        return true;
      }
      /* SEÑALES DURABLES (JFC 2026-09-03, 1A — a idiomARTE le volvió a salir el
         tope de 25 productos). Un dispositivo YA activado que perdió el instanceId
         del f123_owned pelado (por un switch de tienda / reload) NO puede caer al
         tope free. Se considera licenciado ante CUALQUIER evidencia durable de uso
         real: está dentro de una tienda unida (f123_tienda_activa), conoce ≥1
         tienda en el registro (f123_tiendas), o ya tiene datos reales (productos/
         ventas que un demo recién abierto no tendría). Solo AFLOJA; nunca capa. */
      try { if (localStorage.getItem("f123_tienda_activa")) return true; } catch (_) {}
      try { var _reg = JSON.parse(localStorage.getItem("f123_tiendas") || "{}") || {}; if (Object.keys(_reg).length) return true; } catch (_) {}
      try { if ((productos && productos.length) || (ventas && ventas.length)) return true; } catch (_) {}
    } catch (_) {}
    return !!instanceId;
  }
  // Nombre editable del negocio (identidad de instancia, 2026-07-08). Viaja en
  // respaldos/sync. El header lo muestra; vacío = usa el título por defecto.
  let nombreNegocio = "";
  /* SELLO DE TIEMPO DEL NOMBRE (JFC 2026-09-15, v283). Desempate determinista para
     la convergencia entre dos aparatos DUEÑO: gana el rename de dueño MÁS RECIENTE.
     Sin esto, cada aparato-dueño reescribía el nombre compartido con el suyo cada
     vez que sembraba -> "guerra de nombres" y nunca convergía (Unificada vs Tienda
     Consolidada). Se persiste en f123_owned.nombreNegocioTs y viaja en el catálogo. */
  let nombreNegocioTs = 0;
  /* CONTADOR MONOTONICO DEL NOMBRE (v290, #2). El desempate por timestamp falla si
     dos aparatos-dueño tienen relojes desfasados (el de reloj adelantado gana aunque
     renombrara ANTES). Un contador estilo Lamport (sube +1 por rename, y al adoptar
     un rev mayor se sincroniza) desempata deterministamente: gana (rev, luego ts). */
  let nombreNegocioRev = 0;
  /* La revisión se carga del buffer namespaceado en aplicarRespaldo(). No leerla
     de f123_owned: ese sidecar describe el aparato/negocio propio y contaminaba
     el contador al abrir un cuaderno unido, pudiendo ganarle al nombre canónico
     de esa otra licencia. */
  // Cadena anti-tamper (2026-07-08): sello (hash) del último movimiento.
  let selloUltimo = "";
  // Item 1 (revisión JFC 2026-07-05): el estado vivía SOLO en memoria — al
  // recargar la página se perdían ventas/productos nuevos. Ahora todo el
  // estado se persiste en localStorage tras cada mutación (ver debePersistir
  // en el interceptor de fetch) y se recarga al arrancar (cargarEstadoLocal).
  // CRITICO (2026-07-17): la clave vieja "amigable_demo_state_v4" nunca tuvo
  // prefijo f123_, y GitHub Pages sirve friendly-123 y AMIGABLE bajo el MISMO
  // origen (jfcarpiopuntocom.github.io) — localStorage se comparte por origen,
  // no por carpeta. Con la clave vieja, TODO el estado del negocio (productos,
  // ventas, clientes) se mezclaba entre ambas apps en el mismo navegador.
  const OC_STATE_KEY_VIEJA = "amigable_demo_state_v4";
  const OC_STATE_KEY = "f123_estado_v4";
  // Migracion de un solo uso: si ya hay estado bajo la clave nueva, no tocar
  // nada. Si NO hay nada bajo la nueva pero SI bajo la vieja compartida,
  // copiarlo una vez para no perder datos de un cliente que ya venia usando
  // la app antes de este fix (aunque ese estado pudo venir mezclado con
  // AMIGABLE si el cliente tambien uso esa app en el mismo navegador).
  (function migrarEstadoSiHaceFalta() {
    try {
      if (localStorage.getItem(OC_STATE_KEY) != null) return;
      const viejo = localStorage.getItem(OC_STATE_KEY_VIEJA);
      if (viejo != null) localStorage.setItem(OC_STATE_KEY, viejo);
    } catch (_) {}
  })();
  // Severidad Simon (menor = mas grave). Usado para quedarse con la señal
  // mas urgente entre stock y vencimiento, y para ordenar alertas.
  const ORDEN = { rojo: 0, naranja: 1, amarillo: 2, negro: 3, verde: 5 };

  // Item 23: IDs con Date.now()+Math.random() podían colisionar. UUID real
  // (crypto.randomUUID) con fallback para navegadores viejos.
  function uuid(prefijo) {
    const c = globalThis.crypto;
    const id = (c && c.randomUUID) ? c.randomUUID() : (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
    return (prefijo || "") + id;
  }
  function clonar(obj) { return JSON.parse(JSON.stringify(obj)); }
  // Foto completa del estado, con schemaVersion (item 18) para poder migrar
  // formatos futuros sin romper respaldos viejos.
  function estadoActualExportable() {
    return {
      schemaVersion: 3,
      _rev: _localRev,
      modo: "demo-estatico",
      ubicaciones: clonar(ubicaciones), productos: clonar(productos), ventas: clonar(ventas),
      movimientos: clonar(movimientos), transferencias: clonar(transferencias), gastos: clonar(gastos),
      sucursales: clonar(sucursales), promotoras: clonar(promotoras), clientes: clonar(clientes),
      configuracion: { gastosMensuales: clonar(gastosMensuales), categoriasMeta: clonar(categoriasMeta), impuesto: ajusteImpuesto ? clonar(ajusteImpuesto) : null, moneda: ajusteMoneda ? clonar(ajusteMoneda) : null },
      usuarios: clonar(usuarios),
      instanceId: instanceId,
      nombreNegocio: nombreNegocio,
      nombreNegocioTs: nombreNegocioTs,
      nombreNegocioRev: nombreNegocioRev,
      selloUltimo: selloUltimo,
    };
  }
  // Item 19: validación profunda de respaldos antes de importar — ids únicos,
  // números finitos y no negativos, referencias a perchas existentes. Antes
  // solo se comprobaba que productos/ubicaciones fueran arrays.
  function esTextoCorto(v, max) { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
  function validarRespaldo(body) {
    if (!body || typeof body !== "object") return "That file does not look like a valid backup.";
    if (!Array.isArray(body.productos) || !Array.isArray(body.ubicaciones)) return "That file does not look like a valid backup.";
    if (body.productos.length > 20000 || body.ubicaciones.length > 2000) return "The backup is too large for this local mode.";
    const idsProd = new Set();
    for (const p of body.productos) {
      if (!p || typeof p !== "object") return "There is a corrupt product in the backup.";
      if (!esTextoCorto(String(p.id || ""), 120) || idsProd.has(String(p.id))) return "There are empty or duplicated product IDs.";
      idsProd.add(String(p.id));
      if (!esTextoCorto(String(p.nombre || ""), 240)) return "There is a product without a valid name.";
      if (!Number.isFinite(Number(p.precio)) || !Number.isFinite(Number(p.costo)) || !Number.isFinite(Number(p.stockActual))) return "There are invalid numeric values in products.";
      if (Number(p.precio) < 0 || Number(p.costo) < 0 || Number(p.stockActual) < 0) return "There are negative prices, costs or stock in products.";
    }
    const idsUbic = new Set();
    for (const u of body.ubicaciones) {
      if (!u || typeof u !== "object") return "There is a corrupt shelf in the backup.";
      if (!esTextoCorto(String(u.id || ""), 120) || idsUbic.has(String(u.id))) return "There are empty or duplicated shelf IDs.";
      idsUbic.add(String(u.id));
      if (!esTextoCorto(String(u.nombre || ""), 240)) return "There is a shelf without a valid name.";
    }
    for (const p of body.productos) {
      if (p.ubicacionId && p.ubicacionId !== "todas" && !idsUbic.has(String(p.ubicacionId))) return `The product "${p.nombre}" points to a shelf that does not exist.`;
    }
    if (body.ventas && !Array.isArray(body.ventas)) return "The sales section is corrupt.";
    if (body.movimientos && !Array.isArray(body.movimientos)) return "The activity section is corrupt.";
    if (body.transferencias && !Array.isArray(body.transferencias)) return "The transfers section is corrupt.";
    if (body.gastos && !Array.isArray(body.gastos)) return "The expenses section is corrupt.";
    if (body.clientes && !Array.isArray(body.clientes)) return "The customers section is corrupt.";
    return "";
  }
  function aplicarRespaldo(body) {
    productos.length = 0; productos.push(...body.productos);
    ubicaciones.length = 0; ubicaciones.push(...body.ubicaciones);
    ventas.length = 0; ventas.push(...(Array.isArray(body.ventas) ? body.ventas : []));
    movimientos.length = 0; movimientos.push(...(Array.isArray(body.movimientos) ? body.movimientos : []));
    transferencias.length = 0; transferencias.push(...(Array.isArray(body.transferencias) ? body.transferencias : []));
    gastos.length = 0; gastos.push(...(Array.isArray(body.gastos) ? body.gastos : []));
    if (Array.isArray(body.sucursales)) { sucursales.length = 0; sucursales.push(...body.sucursales); }
    if (Array.isArray(body.promotoras)) { promotoras.length = 0; promotoras.push(...body.promotoras); }
    if (Array.isArray(body.clientes)) {
      clientes.length = 0;
      // Retrocompat v3→v4: si el backup no tiene evaluacion, poner neutro por defecto.
      clientes.push(...body.clientes.map(c => c.evaluacion ? c : { ...c, evaluacion: { trato: 0, confiabilidad: 0, historial: [] } }));
    }
    if (Array.isArray(body.usuarios)) { usuarios.length = 0; usuarios.push(...body.usuarios); }
    if (typeof body.instanceId === "string" && body.instanceId) instanceId = body.instanceId;
    if (typeof body.nombreNegocio === "string") nombreNegocio = body.nombreNegocio;
    if (Number(body.nombreNegocioTs)) nombreNegocioTs = Number(body.nombreNegocioTs);
    if (Number(body.nombreNegocioRev)) nombreNegocioRev = Number(body.nombreNegocioRev);
    // Cadena anti-tamper: cargar el sello persistido TAL CUAL (no recalcularlo del
    // array). Así, si alguien recorta el final del log sin arreglar este valor, la
    // verificación de cola lo detecta (prev !== selloUltimo). En respaldos viejos
    // sin este campo, se recompone desde el último movimiento sellado (retrocompat).
    if (typeof body.selloUltimo === "string") {
      selloUltimo = body.selloUltimo;
    } else {
      selloUltimo = "";
      for (let i = movimientos.length - 1; i >= 0; i--) { if (movimientos[i] && movimientos[i].sello) { selloUltimo = movimientos[i].sello; break; } }
    }
    Object.keys(gastosMensuales).forEach((k) => delete gastosMensuales[k]);
    if (body.configuracion && body.configuracion.gastosMensuales && typeof body.configuracion.gastosMensuales === "object") Object.assign(gastosMensuales, body.configuracion.gastosMensuales);
    // Toda percha debe existir en gastosMensuales (mismo bug fix 2026-07-03
    // de las perchas creadas en runtime).
    ubicaciones.forEach((u) => { if (!(u.id in gastosMensuales)) gastosMensuales[u.id] = 0; });
    cacheUltimaVenta = { n: -1, map: null }; // el respaldo trae OTRAS ventas: cache fuera
    /* Categorías: un respaldo viejo no trae categoriasMeta y entonces NO se toca
       nada (las listas locales siguen como estaban). Si lo trae, se carga y se
       reflejan sus registros en las listas: es lo que hace que restaurar un
       respaldo devuelva también las categorías propias vacías y las ocultas. */
    // Impuesto (v359): un respaldo viejo no lo trae y no se toca nada.
    const _imp = body.configuracion && _normImpuesto(body.configuracion.impuesto);
    if (_imp) ajusteImpuesto = _imp;
    const _mon = body.configuracion && _normMoneda(body.configuracion.moneda);
    if (_mon) ajusteMoneda = _mon;
    const _cm = body.configuracion && body.configuracion.categoriasMeta;
    if (_cm && typeof _cm === "object") {
      Object.keys(categoriasMeta).forEach((k) => delete categoriasMeta[k]);
      const validas = [];
      Object.keys(_cm).forEach((k) => {
        const r = _cm[k];
        if (!r || !r.id || _CAT_ESTADOS.indexOf(r.estado) === -1) return;
        categoriasMeta[String(r.id)] = { id: String(r.id), nombre: String(r.nombre || r.id).slice(0, 120), estado: r.estado, rev: r.rev || null };
        validas.push(categoriasMeta[String(r.id)]);
      });
      _reflejarCategoriasEnListas(validas);
    }
  }
  function _leerListaCat(clave) {
    try { const a = JSON.parse(localStorage.getItem(clave) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  /* Aplica registros de categorías a las listas que lee la pantalla. SOLO toca
     los nombres que vienen en `registros`: una categoría sin registro (creada
     antes de este cambio, o de otro origen) nunca se quita. */
  function _reflejarCategoriasEnListas(registros) {
    try {
      if (!registros || !registros.length) return;
      let custom = _leerListaCat(_catKey(_CAT_BASE_CUSTOM)), ocultas = _leerListaCat(_catKey(_CAT_BASE_OCULTAS));
      const esta = (arr, n) => arr.some((x) => String(x).trim().toLowerCase() === n);
      const sin = (arr, n) => arr.filter((x) => String(x).trim().toLowerCase() !== n);
      registros.forEach((r) => {
        const n = String(r.nombre || r.id).trim();
        const id = n.toLowerCase();
        if (!id) return;
        if (r.estado === "custom" && !esta(custom, id)) custom.push(n);
        else if (r.estado === "borrada") custom = sin(custom, id);
        else if (r.estado === "oculta" && !esta(ocultas, id)) ocultas.push(n);
        else if (r.estado === "visible") ocultas = sin(ocultas, id);
      });
      localStorage.setItem(_catKey(_CAT_BASE_CUSTOM), JSON.stringify(custom));
      localStorage.setItem(_catKey(_CAT_BASE_OCULTAS), JSON.stringify(ocultas));
      try { window.dispatchEvent(new CustomEvent("oc-categorias-cambiadas")); } catch (_) {}
    } catch (_) {}
  }
  /* Siembra registros para las categorías que ya existían antes de este cambio
     (listas sin registro), para que un aparato nuevo también las reciba.
     Revisión MÍNIMA a propósito ({c:0}): cualquier cambio explícito posterior
     (una lápida, un renombre) gana siempre. Si se sembraran con una revisión
     normal, un aparato que estuvo offline y se actualiza tarde podría
     resucitar una categoría que otro aparato ya borró. */
  function _sembrarCategoriasLegado() {
    try {
      let d = "";
      try { d = String(localStorage.getItem("f123_device_id") || ""); } catch (_) {}
      let n = 0;
      const sembrar = (lista, estado) => lista.forEach((x) => {
        const nom = String(x).trim(), id = nom.toLowerCase();
        if (!id || categoriasMeta[id]) return;
        categoriasMeta[id] = { id, nombre: nom.slice(0, 120), estado, rev: { c: 0, d } };
        n++;
      });
      sembrar(_leerListaCat(_catKey(_CAT_BASE_CUSTOM)), "custom");
      sembrar(_leerListaCat(_catKey(_CAT_BASE_OCULTAS)), "oculta");
      if (n) guardarEstadoLocal();
    } catch (_) {}
  }
  // FIX 2026-07-07: si localStorage esta lleno, el dueno creia que guardaba
  // y un refresh le comia el dia. Ahora hay banda roja persistente.
  function avisoMemoriaLlena() {
    try {
      if (document.getElementById("oc-quota-aviso")) return;
      const d = document.createElement("div");
      d.id = "oc-quota-aviso";
      d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10002;background:#B0183E;padding:12px 16px;text-align:center;";
      // BUG FIJADO (JFC 2026-08-19, caza produccion): aviso hardcoded en
      // espanol en app cuyo default es ingles.
      var _es_q = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
      d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:16px;font-weight:700;">'
        + (_es_q ? 'La memoria de este navegador está llena: los cambios nuevos NO se están guardando. Ve a AVANZADO y descarga un respaldo AHORA.'
                 : 'This browser storage is full: new changes are NOT being saved. Go to ADVANCED and download a backup NOW.')
        + '</span>';
      (document.body || document.documentElement).appendChild(d);
    } catch (_) {}
  }
  // Fase 2 (2026-08-04): si no cabe el estado completo, antes de darse por
  // vencido se archivan los movimientos mas viejos en IndexedDB (idb-archivo.js
  // — sin techo practico de espacio) y se reintenta con el log recortado. Nada
  // se BORRA, solo se muda de almacen. Si IndexedDB tampoco esta disponible o
  // falla, se cae al aviso rojo de siempre (nada nuevo se pierde silenciosamente).
  function avisoArchivado(n) {
    // SOLO CONSOLA (JFC 2026-08-26): banner no autorizado; todo se guardó, solo
    // se archivó el log viejo. Sin romper la UI.
    try { console.warn("[storage] log de actividad viejo (" + n + " registros) movido a archivo local; nada se borró (aviso solo en consola)"); } catch (_) {}
  }
  let _localRev = 0; // contador monotónico — impide que una pestaña vieja sobreescriba estado más fresco
  // Fase 3 (2026-08-04): doble buffer A/B + puntero, en vez de una unica clave.
  // Cada guardado escribe SIEMPRE en el buffer INACTIVO y recien al final mueve
  // el puntero — asi una escritura interrumpida a medias (pestaña cerrada,
  // navegador matado por el SO a mitad del setItem) nunca puede dañar la unica
  // copia buena: el puntero sigue apuntando al buffer anterior, intacto.
  // Al cargar, si el buffer activo no pasa validarRespaldo() (ya existente,
  // detecta JSON truncado o con forma invalida), se prueba el otro buffer
  // ANTES de caer al aviso de "datos corruptos" — con SHA-256 no habria hecho
  // falta: JSON.parse() + validarRespaldo() ya detectan truncamiento igual de
  // bien, sin el costo de un hash criptografico en cada venta.
  /* MULTI-TIENDA LOCAL (JFC 2026-08-26). Cada licencia = una tienda aislada
     en localStorage. La tienda activa se marca en f123_tienda_activa (vacío =
     tienda propia, que sigue usando las claves legacy SIN sufijo → cero
     migración y cero riesgo para quien ya venía usando la app). Cambiar de
     licencia flushea la tienda actual, cambia este marcador y recarga; en el
     boot se cargan los buffers de la tienda correcta.
     El sufijo se calcula UNA sola vez al cargar el módulo: como cambiar de
     tienda siempre dispara location.reload(), no hay caso donde cambie en
     caliente. Propiedad de seguridad: si nadie escribió f123_tienda_activa,
     el sufijo es "" y TODAS las claves quedan byte-idénticas a antes. */
  /* f123_tienda_activa guarda el SUFIJO literal de la tienda activa:
     "" para la tienda propia (claves legacy), o "::<licencia>" para una unida.
     Se guarda el sufijo entero (no solo la licencia) para que el registro de
     tiendas pueda mapear licencia->sufijo sin ambigüedad, incluyendo el caso
     de la tienda propia cuyo sufijo es "". */
  function _sufijoTiendaActiva() {
    try { return localStorage.getItem("f123_tienda_activa") || ""; } catch (_) { return ""; }
  }
  /* ═══ SHARED DIGITAL NOTEBOOK: UN SOLO CUADERNO POR LICENCIA (JFC 2026-09-15, v283) ═══
     La app ES un cuaderno digital compartido: una licencia = UN cuaderno; los
     aparatos son réplicas (se distinguen por instanceId), NO cuadernos aparte. El
     split de namespaces por aparato ("" legacy vs "::<licencia>" unida) era el
     vestigio de "salas" que fragmentaba al cliente: dos aparatos con la misma
     licencia guardaban en cajones distintos y por eso mostraban nombre/inventario
     distintos. Aquí se CONSOLIDA, UNA sola vez y sin destruir nada, todo el
     cuaderno del dueño en el namespace canónico "" y de ahí en adelante el aparato
     usa SIEMPRE "" (sufijo vacío). Ver memoria: arquitectura_shared_notebook_canonica.

     Seguridad:
       - Solo add-only: se UNEN por id las colecciones de catálogo/equipo (perchas,
         productos, sucursales, promotoras, clientes, usuarios). El log financiero
         (ventas/movimientos/transferencias/gastos) y su cadena anti-tamper
         (selloUltimo) NO se fusionan a ciegas entre aparatos (rompería la cadena);
         se conserva intacto el del cuaderno BASE (el que ya tiene el negocio real).
       - Antes de escribir nada se guarda un snapshot de los buffers originales en
         f123_premigra_notebook_v1 (y no se borran los buffers "::L": quedan como
         red). Idempotente: corre una sola vez (flag f123_notebook_unificado_v1).
     _normLic/_licenciaPropia son hoisted y solo leen localStorage: seguro aquí. */
  try {
    /* FLAG v2 (v284): la v283 tenía una trampa — solo miraba el buffer
       "::<licenciaPropia>". Si en el aparato el buffer real estaba bajo OTRO sufijo
       (la licencia con que se creó no coincidía byte a byte con _licenciaPropia()),
       la migración NO lo encontraba pero IGUAL forzaba tienda_activa="" y marcaba
       hecho -> el aparato quedaba apuntando al cuaderno VACÍO y la data huérfana.
       v284 escanea TODOS los buffers del aparato (cualquier sufijo + legacy),
       elige el que tiene el negocio real (más productos) y lo consolida en "".
       El flag es NUEVO (v2) para que RE-CORRA en aparatos que ya sufrieron la v283. */
    if (localStorage.getItem("f123_notebook_unificado_v2") !== "1") {
      // Mejor buffer A/B válido de un sufijo dado.
      var _leerBuf = function (suf) {
        try {
          var base = OC_STATE_KEY + suf;
          var ptr = localStorage.getItem(base + "_ptr");
          var orden = ptr ? [ptr, ptr === "A" ? "B" : "A"] : ["A", "B"];
          for (var i = 0; i < orden.length; i++) {
            var raw = localStorage.getItem(base + "_" + orden[i]);
            if (raw == null) continue;
            var b; try { b = JSON.parse(raw); } catch (_) { continue; }
            if (b && typeof b === "object") return { body: b, raw: raw, suf: suf };
          }
        } catch (_) {}
        return null;
      };
      // Recolectar TODOS los sufijos presentes en claves de buffer del aparato.
      var _sufs = { "": true };
      try {
        for (var _i = 0; _i < localStorage.length; _i++) {
          var _k = localStorage.key(_i); if (!_k) continue;
          var _m = _k.match(/^f123_estado_v4(::.+)?_(A|B)$/);
          if (_m) _sufs[_m[1] || ""] = true;
        }
      } catch (_) {}
      var _bufs = [];
      Object.keys(_sufs).forEach(function (s) { var b = _leerBuf(s); if (b) _bufs.push(b); });
      // Candidato legacy: la clave de un solo buffer (aparatos muy viejos).
      try {
        var _lg = localStorage.getItem(OC_STATE_KEY);
        if (_lg) { var _lb; try { _lb = JSON.parse(_lg); } catch (_) {} if (_lb && typeof _lb === "object") _bufs.push({ body: _lb, raw: _lg, suf: "" }); }
      } catch (_) {}
      var _nProd = function (r) { return (r && r.body && Array.isArray(r.body.productos)) ? r.body.productos.length : -1; };
      var _nFin = function (r) { var b = (r && r.body) || {}; return (Array.isArray(b.ventas) ? b.ventas.length : 0) + (Array.isArray(b.movimientos) ? b.movimientos.length : 0); };
      /* DESEMPATE DETERMINISTA DEL GANADOR (v288, #3). Antes en empate de #productos
         se quedaba con el primer sufijo que enumeraba localStorage (no determinista)
         y con él SU log financiero -> podía conservar las ventas equivocadas. Ahora:
         más productos; empate -> más historial financiero (ventas+movimientos, para
         no perder el log real); empate -> mayor _rev. */
      var _gana = function (reta, campeon) {
        if (_nProd(reta) !== _nProd(campeon)) return _nProd(reta) > _nProd(campeon);
        if (_nFin(reta) !== _nFin(campeon)) return _nFin(reta) > _nFin(campeon);
        return (Number(reta.body._rev) || 0) > (Number(campeon.body._rev) || 0);
      };
      if (_bufs.length) {
        // GANADOR = el cuaderno con el negocio real. Un aparato hospeda UN negocio,
        // así que el resto solo aporta catálogo add-only.
        var _win = _bufs[0];
        _bufs.forEach(function (b) { if (_gana(b, _win)) _win = b; });
        if (_nProd(_win) >= 0) {
          // Snapshot de TODOS los buffers antes de tocar nada (no destructivo).
          try {
            localStorage.setItem("f123_premigra_notebook_v2", JSON.stringify({
              ts: Date.now(), win: _win.suf,
              bufs: _bufs.map(function (b) { return { suf: b.suf, raw: b.raw }; })
            }));
          } catch (_) {}
          // Base = ganador COMPLETO (conserva su log financiero y su sello).
          var _res = JSON.parse(JSON.stringify(_win.body));
          var _ADD = ["ubicaciones", "productos", "sucursales", "promotoras", "clientes", "usuarios"];
          var _maxRev = Number(_win.body._rev) || 0;
          _bufs.forEach(function (b) {
            if (b === _win || !b.body) return;
            _maxRev = Math.max(_maxRev, Number(b.body._rev) || 0);
            _ADD.forEach(function (col) {
              var bArr = Array.isArray(_res[col]) ? _res[col] : (_res[col] = []);
              var eArr = Array.isArray(b.body[col]) ? b.body[col] : [];
              var vistos = {};
              bArr.forEach(function (x) { if (x && x.id != null) vistos[String(x.id)] = true; });
              eArr.forEach(function (x) { if (x && x.id != null && !vistos[String(x.id)]) { bArr.push(x); vistos[String(x.id)] = true; } });
            });
            if (!String(_res.nombreNegocio || "").trim() && b.body.nombreNegocio) _res.nombreNegocio = b.body.nombreNegocio;
          });
          _res._rev = _maxRev + 1;
          // Escribir el cuaderno consolidado en AMBOS buffers "" (v288, #4). Antes
          // solo se escribía _A + ptr A y quedaba un _B viejo con posible _rev
          // MAYOR; si un flujo posterior leyera _B, ganaría estado viejo. Se
          // sobrescriben los dos con el consolidado para que ninguno esté rancio.
          try {
            var _cs = JSON.stringify(_res);
            localStorage.setItem(OC_STATE_KEY + "_A", _cs);
            localStorage.setItem(OC_STATE_KEY + "_B", _cs);
            localStorage.setItem(OC_STATE_KEY + "_ptr", "A");
          } catch (_) {}
        }
      }
      // De aquí en adelante el aparato usa SIEMPRE el cuaderno único "".
      try { localStorage.setItem("f123_tienda_activa", ""); } catch (_) {}
      try { localStorage.setItem("f123_notebook_unificado_v2", "1"); } catch (_) {}
    }
  } catch (_) {}
  const OC_STATE_SUFIJO = _sufijoTiendaActiva();
  const OC_STATE_PTR = OC_STATE_KEY + OC_STATE_SUFIJO + "_ptr";
  function claveBuffer(letra) { return OC_STATE_KEY + OC_STATE_SUFIJO + "_" + letra; }
  // Solo metadatos del conflicto, jamás el PIN remoto. El registro es por
  // cuaderno y sobrevive a un refresh hasta que el miembro sí logra aplicarse.
  const CONFLICTOS_EQUIPO_KEY = "f123_team_conflicts_v1" + OC_STATE_SUFIJO;
  let conflictosEquipo = [];
  try {
    const guardados = JSON.parse(localStorage.getItem(CONFLICTOS_EQUIPO_KEY) || "[]");
    if (Array.isArray(guardados)) conflictosEquipo = guardados.filter((x) => x && x.id && x.nombre).slice(-20);
  } catch (_) {}
  function _guardarConflictosEquipo() {
    try { localStorage.setItem(CONFLICTOS_EQUIPO_KEY, JSON.stringify(conflictosEquipo)); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("oc-equipo-conflictos")); } catch (_) {}
  }
  function _anotarConflictoEquipo(u) {
    const id = String(u.id || "");
    if (!id || conflictosEquipo.some((x) => x.id === id)) return;
    conflictosEquipo = conflictosEquipo.concat([{ id, nombre: String(u.nombre || "Team member").slice(0, 60), fecha: new Date().toISOString() }]).slice(-20);
    _guardarConflictosEquipo();
  }
  function _resolverConflictoEquipo(id) {
    const n = conflictosEquipo.filter((x) => x.id !== String(id));
    if (n.length !== conflictosEquipo.length) { conflictosEquipo = n; _guardarConflictosEquipo(); }
  }
  /* Espejo en IndexedDB. Se dispara SIEMPRE, sin esperarlo: es la red que hace
     que "localStorage lleno" deje de significar "tus cambios se pierden".
     Ver estado-idb.js (JFC 2026-08-17, portado desde amigable-123).

     NO reemplaza el orden de sacrificio de abajo (Fase 7): son dos capas
     distintas. El sacrificio decide QUE se cede cuando no cabe; el espejo hace
     que aunque no quepa NADA en localStorage, el estado completo quede a salvo
     igual en un almacen que si crece con el disco. */
  function _espejarEnIDB(completo) {
    try {
      if (!window.OCEstadoIDB) return Promise.resolve(false);
      return window.OCEstadoIDB.guardar(completo).catch(() => false);
    } catch (_) { return Promise.resolve(false); }
  }
  /* #3 (JFC 2026-09-10): "los PIN de admin TAMBIEN deben abrir el dashboard".
       Los admin cuentan como "empleado" a nivel cripto (mismo employeeHashes), así
       que el dashboard (que juzga con OCSecure) no puede distinguirlos. Aquí la app
       publica los PINs de admin ACTIVOS en una clave local del MISMO origen; el
       dashboard la lee en su gate para dejarlos entrar. Se reescribe en cada
       guardado, así queda fresca (alta/baja/cambio de rol). Cada dispositivo la
       arma de sus propios usuarios (que ya sincronizan), sin sync extra.
       Publicar SOLO después de confirmar el estado, para no dejar accesos
       fantasma si fallan localStorage e IndexedDB. */
  function _publicarAdminPins() {
    try {
      const _adminPins = usuarios
        .filter((u) => u && !u.borrado && u.activo !== false && u.rol === "admin" && /^\d{3}$/.test(String(u.pin || "")))
        .map((u) => String(u.pin));
      localStorage.setItem("f123_admins_pins", JSON.stringify(_adminPins));
    } catch (_) {}
  }
  function guardarEstadoLocal(exigirCompleto = false) {
    _localRev++;
    const completo = estadoActualExportable();
    const activo = localStorage.getItem(OC_STATE_PTR) || "B"; // sin puntero previo: A es el primer destino
    const destino = activo === "A" ? "B" : "A";
    const _idb = _espejarEnIDB(completo);
    try {
      localStorage.setItem(claveBuffer(destino), JSON.stringify(completo));
      localStorage.setItem(OC_STATE_PTR, destino); // flip atomico, al final
      ocultarAvisoRecorte();
      _publicarAdminPins();
      return true;
    } catch (_) {}
    // Fase 7 (2026-08-04): orden explicito de sacrificio de espacio. Antes de
    // tocar el log de ventas (irremplazable), ceder lo recuperable: fotos de
    // percha que hayan quedado en localStorage (legado pre-idb-fotos.js, o un
    // dispositivo sin soporte IndexedDB). Mismo criterio que
    // guardarSecureResiliente en crypto-store.js.
    try {
      const rmFotos = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("f123_foto_percha_") === 0) rmFotos.push(k); }
      if (rmFotos.length) {
        rmFotos.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
        localStorage.setItem(claveBuffer(destino), JSON.stringify(completo));
        localStorage.setItem(OC_STATE_PTR, destino);
        ocultarAvisoRecorte();
        _publicarAdminPins();
        return true;
      }
    } catch (_) {}
    // Los cambios de acceso requieren TODO el historial: nunca confirmarlos
    // con un recorte cuya escritura en el archivo aún no está comprobada.
    if (!exigirCompleto) {
      const viejos = completo.movimientos.slice(0, -300);
      const recortado = { ...completo, movimientos: completo.movimientos.slice(-300) };
      try {
        localStorage.setItem(claveBuffer(destino), JSON.stringify(recortado));
        localStorage.setItem(OC_STATE_PTR, destino);
        if (window.OCArchivo) window.OCArchivo.archivarLote(viejos).catch(() => {}); // fire-and-forget, idempotente, aislado del nucleo
        avisoArchivado(viejos.length);
        _publicarAdminPins();
        return true;
      } catch (_) {}
    }
    /* NO MENTIR (JFC 2026-08-17). Que localStorage se llene no quiere decir
       que el dispositivo este lleno: localStorage tiene un techo fijo de
       ~5 MB por origen, aunque al disco le sobren 900 GB. Si el espejo de
       IndexedDB —que si escala con el disco— acepto el estado, los cambios
       SI se guardaron y el cartel rojo seria falso. Solo se avisa cuando de
       verdad no entro en ningun lado. */
    return _idb.then((ok) => {
      if (ok) { ocultarAvisoRecorte(); avisoEspacioJusto(); _publicarAdminPins(); }
      else avisoMemoriaLlena();
      return !!ok;
    }).catch(() => { avisoMemoriaLlena(); return false; });
  }
  /* SOLO CONSOLA (JFC 2026-08-26): este aviso ("todo se guardó, la memoria
     rápida se llenó, ahora se usa la grande — no se perdió nada") NO fue
     autorizado y rompe la UI sin necesidad — el guardado ya ocurrió igual. Se
     conserva el dato en consola para diagnóstico; NUNCA se pinta un banner.
     (El fallo REAL de guardado sí avisa: avisoMemoriaLlena, intacto.) */
  function avisoEspacioJusto() {
    try { console.warn("[storage] memoria rápida llena; se usó el almacén grande, nada se perdió (aviso solo en consola)"); } catch (_) {}
  }
  /* Atajos defensivos: si i18n.js no cargo, se usa el texto de reserva en vez
     de dejar el cartel vacio justo cuando hace falta leerlo. */
  function tSeguro(clave, reserva) {
    try { return (window.OCI18n && window.OCI18n.t) ? (window.OCI18n.t(clave) || reserva) : reserva; }
    catch (_) { return reserva; }
  }
  function escHtmlSeguro(x) {
    return String(x == null ? "" : x).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function ocultarAvisoRecorte() { try { const d = document.getElementById("oc-recorte-aviso"); if (d) d.remove(); } catch (_) {} }
  function avisarBufferRecuperado() {
    // SOLO CONSOLA (JFC 2026-08-26): banner no autorizado; el guardado ya se
    // recuperó solo. Diagnóstico en consola, sin romper la UI.
    try { console.warn("[storage] guardado interrumpido recuperado desde la copia anterior; nada se perdió (aviso solo en consola)"); } catch (_) {}
    return;
  }
  /* A2 — REPARADOR DE ESTADO (JFC 2026-08-19).
     Patron de las librerias de validacion en runtime tipo Valibot: en vez de
     un si/no, se poda lo que no cumple y se conserva el resto. Escrito a mano
     porque el manifiesto de la app es sin dependencias.

     Hoy hay doble buffer A/B con validarRespaldo(): si uno esta corrupto se usa
     el otro, que ya salva casi todos los casos. El hueco es cuando fallan LOS
     DOS: ahi el estado entero se descarta y el negocio arranca en blanco. Un
     solo producto con el precio en NaN podia costar el inventario completo.

     Este reparador es el ULTIMO RECURSO, solo cuando ningun buffer valida:
     tira los registros rotos, se queda con los sanos, y devuelve cuantos se
     perdieron para poder decirlo en pantalla. Nunca inventa datos: lo que no se
     puede leer se descarta, no se rellena.

     NO se usa en la restauracion de un respaldo del usuario: ahi un archivo
     invalido tiene que ser rechazado de frente, porque el usuario puede ir a
     buscar el archivo bueno. Aqui no hay archivo bueno al que ir. */
  function repararRespaldo(body) {
    if (!body || typeof body !== "object") return null;
    if (!Array.isArray(body.productos) || !Array.isArray(body.ubicaciones)) return null;
    const podados = { productos: 0, ubicaciones: 0, listas: 0 };

    /* REPARAR, NO BORRAR (corregido el 2026-08-19 tras medirlo).
       La primera version PODABA la percha con el nombre corrupto. Medido con
       61 productos y 3 perchas: se perdian 2 perchas y 26 productos, porque
       todo producto que apunta a una percha borrada se cae con ella. El
       reparador estaba causando mas dano que el dano.

       Una percha solo se descarta si le falta la IDENTIDAD (el id): sin id no
       hay a que atar los productos. Un NOMBRE ilegible no es motivo para tirar
       nada: se reemplaza por uno provisional y el dueno lo renombra en dos
       toques, con su inventario intacto. */
    const ubicVistas = new Set();
    let ubicRenombradas = 0;
    const ubicOk = [];
    body.ubicaciones.forEach((u) => {
      const id = u && typeof u === "object" ? String(u.id || "") : "";
      if (!id || ubicVistas.has(id) || !esTextoCorto(id, 120)) { podados.ubicaciones++; return; }
      ubicVistas.add(id);
      const copia = Object.assign({}, u);
      if (!esTextoCorto(String(copia.nombre || ""), 240)) {
        copia.nombre = "Shelf " + (ubicOk.length + 1);   // provisional, renombrable
        ubicRenombradas++;
      }
      ubicOk.push(copia);
    });
    podados.renombradas = ubicRenombradas;
    if (!ubicOk.length) return null;   // sin una sola percha no hay negocio que salvar

    const prodVistos = new Set();
    const prodOk = body.productos.filter((p) => {
      if (!p || typeof p !== "object") { podados.productos++; return false; }
      const id = String(p.id || "");
      const numsOk = Number.isFinite(Number(p.precio)) && Number.isFinite(Number(p.costo)) && Number.isFinite(Number(p.stockActual))
        && Number(p.precio) >= 0 && Number(p.costo) >= 0 && Number(p.stockActual) >= 0;
      const ubicOkRef = !p.ubicacionId || p.ubicacionId === "todas" || ubicVistas.has(String(p.ubicacionId));
      const ok = !!id && !prodVistos.has(id) && esTextoCorto(id, 120)
        && esTextoCorto(String(p.nombre || ""), 240) && numsOk && ubicOkRef;
      if (ok) prodVistos.add(id); else podados.productos++;
      return ok;
    });

    const limpio = Object.assign({}, body, { productos: prodOk, ubicaciones: ubicOk });
    ["ventas", "movimientos", "transferencias", "clientes"].forEach((k) => {
      if (limpio[k] && !Array.isArray(limpio[k])) { limpio[k] = []; podados.listas++; }
    });
    if (validarRespaldo(limpio)) return null;   // ni reparado cuadra: no se fuerza
    return { limpio, podados };
  }

  function avisarEstadoReparado(podados) {
    try {
      const d = document.createElement("div");
      d.setAttribute("role", "status");
      d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10001;background:#B54E0A;padding:10px 16px;text-align:center;cursor:pointer;";
      const _es_r = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
      const n = (podados.productos || 0) + (podados.ubicaciones || 0);
      const ren = podados.renombradas || 0;
      d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:14px;font-weight:700;">'
        + (_es_r
            ? "Se recupero tu negocio de una copia danada. " + n + " registro(s) ilegibles quedaron fuera" + (ren ? " y " + ren + " percha(s) perdieron su nombre; renombralas en Perchas" : "") + ". Revisa tu inventario y exporta un respaldo en AVANZADO."
            : "Your business was recovered from a damaged copy. " + n + " unreadable record(s) were left out" + (ren ? ", and " + ren + " shelf(s) lost their name — rename them under Shelves" : "") + ". Check your inventory and export a backup in ADVANCED.")
        + "</span>";
      d.addEventListener("click", () => d.remove());
      (document.body || document.documentElement).appendChild(d);
    } catch (_) {}
  }

  /* Vacía las colecciones DEMO semilla cuando se entra a una tienda unida que
     todavía no tiene datos propios. Así arranca limpia y solo se llena con lo
     que llegue por sync — sin mezclar el catálogo real del equipo con los
     productos/perchas de ejemplo. Muta en sitio porque son const.
     NO toca instanceId (identidad de este aparato). (JFC 2026-08-26) */
  function _vaciarTiendaFresca() {
    try {
      ubicaciones.length = 0; productos.length = 0; sucursales.length = 0;
      promotoras.length = 0; clientes.length = 0; usuarios.length = 0;
      ventas.length = 0; movimientos.length = 0; transferencias.length = 0;
      Object.keys(gastosMensuales).forEach((k) => { delete gastosMensuales[k]; });
      nombreNegocio = "";
    } catch (_) {}
  }
  // GUARD DEMO (JFC 2026-09-11): se pone true en cuanto el arranque carga un
  // buffer REAL persistido (A/B, reparado o legacy). Si al terminar sigue en
  // false y el aparato NO es demo (está activado o entró con licencia), las
  // arrays solo tienen la SEMILLA de ejemplo y hay que vaciarla antes de que el
  // sync mezcle datos reales encima. Ver el guard tras cargarEstadoLocal().
  let _cargoBufferReal = false;
  function cargarEstadoLocal() {
    try {
      const activo = localStorage.getItem(OC_STATE_PTR);
      const orden = activo ? [activo, activo === "A" ? "B" : "A"] : ["A", "B"];
      for (const letra of orden) {
        const raw = localStorage.getItem(claveBuffer(letra));
        if (raw == null) continue;
        let body;
        try { body = JSON.parse(raw); } catch (_) { continue; } // corrupto: probar el otro buffer
        // Rechazar estados escritos por una pestaña más antigua (_rev más bajo) — solo en eventos onstorage
        if (typeof body._rev === "number" && body._rev < _localRev) return;
        const error = validarRespaldo(body);
        if (error) continue; // invalido: probar el otro buffer
        // Sincroniza el contador local con el _rev cargado — si no, una pestaña que
        // nunca guardó (_localRev=0) sobreescribe con un _rev más bajo el estado más
        // fresco que ya dejó otra pestaña, perdiendo silenciosamente sus cambios.
        if (typeof body._rev === "number" && body._rev > _localRev) _localRev = body._rev;
        aplicarRespaldo(body);
        _cargoBufferReal = true; // buffer A/B real cargado: no es semilla demo
        if (letra !== activo) {
          console.warn("[cargarEstadoLocal] el buffer activo estaba dañado, recuperado desde el buffer anterior");
          try { localStorage.setItem(OC_STATE_PTR, letra); } catch (_) {} // corrige el puntero
          setTimeout(avisarBufferRecuperado, 800);
        }
        return;
      }
      /* A2: ningun buffer valido. ANTES de darse por vencido y arrancar en
         blanco, se intenta reparar el mas fresco podando lo ilegible. */
      try {
        const _act = localStorage.getItem(OC_STATE_PTR);
        const _orden = _act ? [_act, _act === "A" ? "B" : "A"] : ["A", "B"];
        for (const _l of _orden) {
          const _raw = localStorage.getItem(claveBuffer(_l));
          if (_raw == null) continue;
          let _b; try { _b = JSON.parse(_raw); } catch (_) { continue; }
          const _rep = repararRespaldo(_b);
          if (!_rep) continue;
          aplicarRespaldo(_rep.limpio);
          _cargoBufferReal = true; // buffer reparado real cargado: no es semilla demo
          try { localStorage.setItem(OC_STATE_PTR, _l); } catch (_) {}
          console.warn("[cargarEstadoLocal] estado reparado; registros podados:", _rep.podados);
          setTimeout(function () { avisarEstadoReparado(_rep.podados); }, 800);
          return;
        }
      } catch (_) { /* si el reparador falla, se sigue al camino de siempre */ }

      // Ningun buffer A/B valido: migracion desde la clave de un solo buffer
      // (dispositivos que aun no corrieron esta version) o corrupcion total.
      // MULTI-TIENDA (2026-08-26): esta migracion legacy SOLO aplica a la tienda
      // propia (sufijo vacio). Una tienda unida (sufijo con licencia) que aun no
      // tiene buffers propios NO debe caer aqui, o cargaria los datos de la
      // tienda propia (James Bond) dentro de la tienda ajena.
      // Ademas: una tienda unida recien creada NO debe arrancar con los datos
      // DEMO semilla — si lo hiciera, cuando el equipo sincronice (merge
      // add-only) su catalogo real quedaria MEZCLADO con productos/perchas de
      // ejemplo. Se vacia para que la tienda arranque limpia y solo se llene con
      // lo que llegue por sync. (bug hallado en la revision pre-live 2026-08-26)
      if (OC_STATE_SUFIJO) { _vaciarTiendaFresca(); return; }
      const raw = localStorage.getItem(OC_STATE_KEY);
      if (!raw) return;
      let body;
      try { body = JSON.parse(raw); } catch (_) {
        // JSON truncado (no solo "invalido pero parseable"): mismo rescate que
        // la rama de abajo. Gap preexistente antes de Fase 3 — el parse vivia
        // fuera de su propio try y un JSON cortado a la mitad se tragaba en
        // silencio sin guardar el rescate ni avisar.
        try { localStorage.setItem("f123_rescate_v4", raw); } catch (_) {}
        setTimeout(() => {
          try {
            if (document.getElementById("oc-estado-corrupto-aviso")) return;
            const d = document.createElement("div");
            d.id = "oc-estado-corrupto-aviso";
            d.setAttribute("role", "alert");
            d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10003;background:#B0183E;padding:12px 16px;text-align:center;cursor:pointer;";
            // B14 (JFC 2026-08-19): cartel critico hardcoded en espanol en la
            // app cuyo idioma por defecto es ingles.
            var _es_c = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
            d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">'
              + (_es_c ? 'El inventario guardado no pudo cargarse (datos de ejemplo activos). Ve a AVANZADO para recuperar o importar tu respaldo.'
                       : 'Your saved inventory could not be loaded (example data is showing). Go to ADVANCED to recover or import your backup.')
              + '</span>';
            d.addEventListener("click", () => d.remove());
            (document.body || document.documentElement).appendChild(d);
          } catch (_) {}
        }, 800);
        return;
      }
      if (typeof body._rev === "number" && body._rev < _localRev) return;
      if (typeof body._rev === "number" && body._rev > _localRev) _localRev = body._rev;
      const error = validarRespaldo(body);
      if (!error) {
        aplicarRespaldo(body);
        _cargoBufferReal = true; // buffer legacy real cargado: no es semilla demo
      } else {
        // Estado guardado no pasa validación — rescatar raw ANTES de sobrescribir con datos semilla.
        // El dueño puede recuperar el archivo desde Avanzado > Exportar (busca oc_rescate_v4).
        try { localStorage.setItem("f123_rescate_v4", raw); } catch (_) {}
        // Banda roja: advertir inmediatamente, no fallar silencioso
        setTimeout(() => {
          try {
            if (document.getElementById("oc-estado-corrupto-aviso")) return;
            const d = document.createElement("div");
            d.id = "oc-estado-corrupto-aviso";
            d.setAttribute("role", "alert");
            d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10003;background:#B0183E;padding:12px 16px;text-align:center;cursor:pointer;";
            // B14 (JFC 2026-08-19): cartel critico hardcoded en espanol en la
            // app cuyo idioma por defecto es ingles.
            var _es_c = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
            d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">'
              + (_es_c ? 'El inventario guardado no pudo cargarse (datos de ejemplo activos). Ve a AVANZADO para recuperar o importar tu respaldo.'
                       : 'Your saved inventory could not be loaded (example data is showing). Go to ADVANCED to recover or import your backup.')
              + '</span>';
            d.addEventListener("click", () => d.remove());
            (document.body || document.documentElement).appendChild(d);
          } catch (_) {}
        }, 800);
      }
    } catch (_) {}
  }
  // Cuando otra pestaña guarda, recargar su estado si es más nuevo (evita last-writer-wins con estado viejo)
  window.addEventListener("storage", (e) => { if (e.key === OC_STATE_PTR) cargarEstadoLocal(); });

  function nombreUbic(id) { const u = ubicaciones.find((x) => x.id === id); return u ? u.nombre : "Ubicación desconocida"; }

  // ---- Reparto de comisiones (espejo de data.js) ----
  function mesActualISO() { return hoyISO().slice(0, 7); }
  function esDelMesActual(fechaISO) { return !!fechaISO && fechaLocalDe(fechaISO).slice(0, 7) === mesActualISO(); }
  // Conteo global de ventas del mes actual, TODAS las ubicaciones (free-tier
  // gating, 2026-07-15) — distinto de ventasMesAcumuladas (suma montos por
  // una sola ubicacion, para comisiones). Usado para el tope de 100/mes.
  function ventasCountMesGlobal() { return ventasActivas().filter((v) => esDelMesActual(v.fecha)).length; }
  function ventasMesAcumuladas(ubicacionId) {
    return ventasActivas().filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha)).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
  }
  /* BUG FIX (JFC/Belén 2026-09-03): al EDITAR una venta, el split se recalculaba
     con ventasMesAcumuladas(), que ya incluye a la propia venta editada (vive en
     el array) → el umbral de escala se contaba a sí mismo y la comisión salía mal.
     Este acumulado EXCLUYE la venta en curso, que es lo correcto para el "previo". */
  function ventasMesAcumuladasExcl(ubicacionId, ventaId) {
    return ventasActivas().filter((v) => v.id !== ventaId && v.ubicacionId === ubicacionId && esDelMesActual(v.fecha)).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
  }
    /* ==========================================================================
     MOTOR DE TRATOS — una sola cuenta para todas las formas de repartir
     ==========================================================================
     JFC, 2026-08-18: "lo de a quien se le cobra es lo que quiero que sea ductil
     y flexible en cada negocio, une ambas formas".

     EL PROBLEMA QUE RESUELVE. Habia dos maneras de decir lo mismo y cada app
     entendia una: la promotora piensa "me llevo el 10", la galeria piensa
     "retengo el 15 y el artista se lleva 85". Es el MISMO reparto leido al
     reves, pero como cada negocio lo dice a su manera, forzar una sola forma
     obliga a la mitad de la gente a restar de cabeza cada vez.

     LA DECISION. Se guarda SIEMPRE un solo numero canonico —`comisionSocio`,
     lo que se lleva el asociado— y la lectura preferida se guarda aparte, como
     preferencia de presentacion. Asi:

       - Ningun trato existente cambia de valor. Cero migracion, y nadie cobra
         distinto maniana por este cambio.
       - Cada negocio escribe y lee en su idioma: `lecturaPreferida` decide si
         la UI muestra "se lleva" o "la casa retiene".
       - Las dos lecturas son siempre coherentes porque una se deriva de la
         otra: es imposible guardar un reparto que no sume 100.

     DE DONDE SALE EL PORCENTAJE, en orden de prioridad:
       1. El trato propio de la persona (promotora.comisionBase), salvo que la
          percha diga explicitamente que manda el suyo (usarComisionPropia).
       2. El de la percha (ubicacion.comisionSocio).
     Esto es lo que permite que LA MISMA PERSONA sea vendedora al 10% en una
     percha y artista al 85% en otra: el trato no vive en la persona ni en la
     percha, vive en el cruce de las dos.

     Y ENCIMA, opcionales y combinables:
       - `contribFija`: aporte fijo que el asociado pone al evento ANTES del %.
         Se descuenta del bruto y el % se aplica a lo que queda.
       - `escalasComision`: el % sube al acercarse a la meta del mes.
       - `minimoGarantizado`: piso en dinero para el asociado. Si el % da menos,
         se le paga el piso — util para "te aseguro $50 por la feria, o el 20%,
         lo que sea mayor".

     GUARD: escalas y aporte fijo no se combinan. El modelo escalonado calcula
     el % venta por venta con el acumulado del mes, y restar un fijo ahi
     obligaria a recalcular retroactivamente cada venta ya registrada. Si estan
     los dos, manda la escala y el fijo se ignora — se dice en `avisos`, no en
     silencio.
     ========================================================================== */
  function resolverTrato(u, opciones) {
    opciones = opciones || {};
    var avisos = [];
    if (!u) return null;

    /* Percha propia: no reparte con nadie. Devolver null y no un trato al 0%
       es la diferencia entre "no aplica" y "le toca cero", que no es lo mismo
       ni en la pantalla ni en un reporte. */
    if (!u.tipo || u.tipo === "propio") return null;

    /* 1. De donde sale el porcentaje */
    var fuente = u, origen = "percha";
    try {
      if (u.promotoraId && !u.usarComisionPropia && typeof promotoras !== "undefined") {
        var pr = promotoras.find(function (x) { return x.id === u.promotoraId; });
        /* Solo se usa el trato de la persona si de verdad tiene uno definido.
           Un comisionista recien creado sin % no puede dejar la percha en cero. */
        if (pr && (Number(pr.comisionBase) > 0 || Number(pr.comisionSocio) > 0 || Number(pr.comision) > 0)) {
          fuente = pr; origen = "comisionista";
        }
      }
    } catch (_) {}

    var pctBase = Number(fuente.comisionBase !== undefined ? fuente.comisionBase : (fuente.comisionSocio !== undefined ? fuente.comisionSocio : fuente.comision)) || 0;
    if (pctBase < 0) pctBase = 0;
    if (pctBase > 100) pctBase = 100;

    /* 2. Escalas por meta, si las hay */
    var escalas = Array.isArray(fuente.escalasComision) ? fuente.escalasComision : [];
    var meta = Number(fuente.metaMensual) || 0;
    var contrib = Math.max(0, Number(u.contribFija) || 0);
    var tieneEscalas = escalas.length > 0 && meta > 0;

    if (tieneEscalas && contrib > 0) {
      avisos.push("The fixed contribution is ignored: this shelf uses goal-based tiers, and combining the two would force a recalculation of every sale already recorded.");
      contrib = 0;
    }

    return {
      /* CANONICO: lo que se lleva el asociado. Todo lo demas se deriva. */
      pct: pctBase,
      pctCasa: +(100 - pctBase).toFixed(2),
      /* Como lo dice ESTE negocio. Solo afecta la presentacion. */
      lectura: (u.lecturaPreferida === "casa") ? "casa" : "asociado",
      modalidad: pctBase >= 50 ? "artista" : "vendedor",
      origen: origen,
      fuenteId: origen === "comisionista" ? (u.promotoraId || null) : u.id,
      contribFija: contrib,
      escalas: tieneEscalas ? escalas.slice() : [],
      metaMensual: meta,
      minimoGarantizado: Math.max(0, Number(u.minimoGarantizado) || 0),
      avisos: avisos
    };
  }

  /* El % que toca a ESTA venta, ya con las escalas aplicadas si las hay. */
  function pctDeLaVenta(trato, acumuladoConEsta) {
    if (!trato) return 0;
    if (!trato.escalas.length || !trato.metaMensual) return trato.pct;
    var pctMeta = (acumuladoConEsta / trato.metaMensual) * 100;
    var ordenadas = trato.escalas.slice().sort(function (a, b) { return a.hasta - b.hasta; });
    var tramo = ordenadas.find(function (e) { return pctMeta <= e.hasta; }) || ordenadas[ordenadas.length - 1];
    var p = Number(tramo.comision);
    return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : trato.pct;
  }

  /* El reparto de UNA venta. Invariante que nunca se rompe:
     comision + neto == bruto, siempre, hasta el centavo. */
  function repartir(trato, montoBruto, acumuladoPrevio) {
    if (!trato) return null;
    var bruto = Math.max(0, Number(montoBruto) || 0);
    var pct = pctDeLaVenta(trato, (Number(acumuladoPrevio) || 0) + bruto);

    /* El aporte fijo sale ANTES del %: es lo que el asociado pone para estar
       ahi, no parte de lo que vendio. Si el aporte supera la venta, la base es
       cero y no negativa — nadie le debe plata a la casa por vender poco. */
    var base = trato.contribFija > 0 ? Math.max(0, bruto - trato.contribFija) : bruto;
    var comision = +(base * (pct / 100)).toFixed(2);

    if (trato.minimoGarantizado > 0 && comision < trato.minimoGarantizado) {
      comision = Math.min(trato.minimoGarantizado, bruto);   /* nunca mas que lo vendido */
    }
    if (comision > bruto) comision = bruto;

    return {
      comisionPct: pct,
      origenComision: trato.origen,
      montoBruto: +bruto.toFixed(2),
      contribFijaAplicada: trato.contribFija > 0 ? +Math.min(trato.contribFija, bruto).toFixed(2) : 0,
      montoComisionSocio: comision,
      montoNetoDueno: +(bruto - comision).toFixed(2)
    };
  }

  /* Se conservan los nombres viejos como puerta de entrada: todo el resto del
     archivo los llama, y cambiarlos seria tocar decenas de sitios sin ganar
     nada. Por dentro ya es el motor unico. */
  function comisionVigente(u, acumuladoConEsta) {
    const t = resolverTrato(u);
    return t ? pctDeLaVenta(t, acumuladoConEsta) : 0;
  }
  function calcularSplitVenta(u, montoBruto, acumuladoPrevio) {
    return repartir(resolverTrato(u), montoBruto, acumuladoPrevio);
  }
  // #19: agrupa ventas pendientes por producto -> lineas del recibo de liquidacion.
  function agruparPendientesPorProducto(pend) {
    const map = new Map();
    pend.forEach((v) => {
      const p = productos.find((x) => x.id === v.productoId);
      const cur = map.get(v.productoId) || { producto: p ? p.nombre : "Producto", sku: p ? p.sku : "", cantidad: 0, montoBruto: 0, comisionSocio: 0 };
      cur.cantidad += v.cantidad || 1;
      cur.montoBruto += v.split ? v.split.montoBruto : 0;
      cur.comisionSocio += v.split ? v.split.montoComisionSocio : 0;
      map.set(v.productoId, cur);
    });
    return [...map.values()].map((d) => ({ ...d, montoBruto: +d.montoBruto.toFixed(2), comisionSocio: +d.comisionSocio.toFixed(2) }));
  }
  function getLiquidaciones() {
    return ubicaciones.filter((u) => u.tipo && u.tipo !== "propio").map((u) => {
      const ventasMes = ventasActivas().filter((v) => v.ubicacionId === u.id && esDelMesActual(v.fecha) && v.split);
      const ventasBrutas = ventasMes.reduce((a, v) => a + v.split.montoBruto, 0);
      const comisionSocio = ventasMes.reduce((a, v) => a + v.split.montoComisionSocio, 0);
      const netoDueno = ventasMes.reduce((a, v) => a + v.split.montoNetoDueno, 0);
      const pendientes = ventasMes.filter((v) => !v.liquidada);
      // #19 Desglose de liquidacion: el socio necesita saber DE QUE ventas exactas
      // es el "te debo $X". Agrupamos las ventas pendientes por producto para armar
      // un recibo itemizado (producto, unidades, bruto, comision). Sin esto el pago
      // es un numero suelto y genera desconfianza. Ver marcarComisionPagada() en index.html.
      const detallePendientes = agruparPendientesPorProducto(pendientes);
      // Dias desde la ultima venta de esta percha (rec 05: asociado/a dormida).
      const ultima = ventasActivas().filter((v) => v.ubicacionId === u.id).reduce((mx, v) => (v.fecha > mx ? v.fecha : mx), "");
      const diasSinVenta = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 86400000) : null;
      const prom = u.promotoraId ? promotoras.find((x) => x.id === u.promotoraId) : null;
      /* Trato resuelto por el motor unico (JFC 2026-08-27): la meta y las
         escalas del comisionista mandan sobre las de la percha cuando aplica. */
      const _trato = resolverTrato(u) || {};
      const _meta = Number(_trato.metaMensual) || Number(u.metaMensual) || 0;
      return {
        ubicacionId: u.id, ubicacion: u.nombre, tipo: u.tipo, metaMensual: _meta,
        cumplimientoMeta: _meta ? +((ventasBrutas / _meta) * 100).toFixed(1) : null,
        ventasBrutas: +ventasBrutas.toFixed(2), comisionSocio: +comisionSocio.toFixed(2), netoDueno: +netoDueno.toFixed(2),
        estado: ventasMes.length === 0 ? "sin ventas" : pendientes.length === 0 ? "pagado" : "pendiente",
        ventasPendientes: pendientes.length, detallePendientes,
        diasSinVenta, promotorNombre: prom ? prom.nombre : null,
        promotoraId: u.promotoraId || null,
        asociadoNombre: prom ? prom.nombre : null,
        /* LAS DOS LECTURAS DEL MISMO REPARTO (JFC 2026-08-18). El asociado
           piensa "me llevo el 85"; la casa piensa "retengo el 15". Es el mismo
           numero y las dos frases son correctas, asi que se mandan las dos y
           nadie tiene que restar de cabeza.

           pctBase es lo CONFIGURADO; pctEfectivo es lo que de verdad se
           aplico, derivado de la plata repartida. Pueden diferir por las
           escalas por meta o porque alguien corrigio una comision en
           retrospectiva — mostrar solo el configurado hacia que la liquidacion
           dijera 10% al lado de una plata repartida al 85%. */
        /* El trato resuelto por el motor unico, no recalculado a mano aqui:
           asi la app, el tablero y el recibo dicen exactamente lo mismo. */
        ...(function () {
          const t = _trato;
          return {
            pctBase: t.pct || 0,
            pctQuedaEnCasa: t.pctCasa != null ? t.pctCasa : 100,
            lecturaPreferida: t.lectura || "asociado",
            origenComision: t.origen || "percha",
            contribFija: t.contribFija || 0,
            minimoGarantizado: t.minimoGarantizado || 0,
            tieneEscalas: !!(t.escalas && t.escalas.length),
            avisosTrato: t.avisos || [],
            modalidad: (t.pct || 0) >= 50 ? "artista" : "vendedor",
          };
        })(),
        pctEfectivo: ventasBrutas > 0 ? +((comisionSocio / ventasBrutas) * 100).toFixed(2) : (Number(u.comisionSocio) || 0),
        /* Ventas de este mes cuyo % se corrigio despues: quien liquida tiene que
           verlo, porque el papel que imprimio la semana pasada decia otra cosa. */
        ventasCorregidas: ventasMes.filter((v) => v.split && v.split.corregida).length,
      };
    });
  }
  // ---- Inventario compartido (espejo de data.js) ----
  /* =========================================================================
     CORREGIR UNA COMISION YA REGISTRADA (portado de amigable-123, 2026-08-18)
     =========================================================================
     El % se congelaba al vender. Si estaba mal configurado —que pasa: es un
     numero que se teclea una vez y se usa cien— la unica salida era anular
     ventas reales para rehacerlas, o sea ensuciar el historial para arreglar un
     dato. Aqui se recalcula el reparto y queda constancia de lo que decia
     antes: ese historial es justo lo que evita las discusiones de fin de mes,
     asi que una correccion se SUMA, no reemplaza.

     Solo se toca el reparto. El monto, el producto, el stock y la fecha no se
     mueven: eso seria otra cosa y tiene su propio camino (anular).
     ========================================================================= */
  function corregirComisionVenta(ventaId, pctNuevo, quien, motivo) {
    const v = ventas.find((x) => x.id === ventaId && !x.anulada);
    if (!v) return { error: "That sale no longer exists.", status: 404 };
    if (!v.split) return { error: "This sale doesn't split a commission with anyone: it was made on an owned shelf.", status: 400 };
    /* null, undefined o "" NO son 0%: son "no mandaste el dato", y Number() los
       convierte en 0 alegremente. Dejar pasar eso pondria la comision de
       alguien en cero por un campo vacio. El 0% escrito a proposito si vale. */
    if (pctNuevo === null || pctNuevo === undefined || pctNuevo === "") return { error: "The new percentage is missing.", status: 400 };
    const pct = Number(pctNuevo);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "The percentage must be between 0 and 100.", status: 400 };

    const bruto = Number(v.split.montoBruto) || 0;
    const antes = { comisionPct: v.split.comisionPct, montoComisionSocio: v.split.montoComisionSocio, montoNetoDueno: v.split.montoNetoDueno };
    const comision = +(bruto * (pct / 100)).toFixed(2);

    v.split.comisionPct = pct;
    v.split.montoComisionSocio = comision;
    v.split.montoNetoDueno = +(bruto - comision).toFixed(2);
    /* Marca permanente: esta venta ya no dice lo que dijo el dia que se hizo, y
       quien la mire dentro de seis meses tiene derecho a saberlo. */
    v.split.corregida = true;
    v.split.correcciones = Array.isArray(v.split.correcciones) ? v.split.correcciones : [];
    v.split.correcciones.push({
      fecha: new Date().toISOString(),
      quien: String(quien || "").trim().slice(0, 80) || "unidentified",
      motivo: String(motivo || "").trim().slice(0, 200),
      antes: antes,
      despues: { comisionPct: pct, montoComisionSocio: comision, montoNetoDueno: v.split.montoNetoDueno },
    });
    v.rev = _revNueva();

    mov("comision-corregida", { ventaId: v.id, ubicacion: nombreUbic(v.ubicacionId), pctAntes: antes.comisionPct, pctAhora: pct, diferencia: +(comision - antes.montoComisionSocio).toFixed(2), motivo: String(motivo || "").slice(0, 200) });
    guardarEstadoLocal();
    avisarCatalogoCambiado();
    return { ok: true, venta: { id: v.id, fecha: v.fecha, split: v.split } };
  }

  /* Corregir de golpe TODAS las del mes en una percha. Cuando el % se configuro
     mal, casi nunca esta mal una venta: estan mal las treinta del mes. */
  function corregirComisionesDelMes(ubicacionId, pctNuevo, quien, motivo, soloPendientes) {
    const objetivo = ventasActivas().filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha) && v.split && (!soloPendientes || !v.liquidada));
    if (!objetivo.length) return { error: "No commissioned sales this month on that shelf.", status: 400 };
    const res = objetivo.map((v) => corregirComisionVenta(v.id, pctNuevo, quien, motivo));
    const malas = res.filter((r) => r.error);
    if (malas.length === res.length) return malas[0];
    return { ok: true, corregidas: res.length - malas.length, fallidas: malas.length };
  }

  /* =========================================================================
     PANORAMA DE UNA PERCHA — todo lo que cuelga de ella, en una llamada
     =========================================================================
     JFC: "somos la app cuya unidad basica es la percha a diferencia de otras
     que solo permiten manejar locales". Abrir una percha mostraba su lista de
     productos y poco mas: para saber cuanto vale lo que hay, cuanto vendio, a
     quien se le debe o que viene en camino habia que recorrer cuatro pantallas
     y sumar de cabeza.

     Se arma aqui y no en la UI a proposito: es la misma cuenta que ya hacen
     getLiquidaciones() y el dashboard, y tenerla en un solo lugar es lo que
     evita que tres pantallas muestren tres numeros distintos del mismo negocio.
     ========================================================================= */
  function getPanoramaPercha(ubicacionId) {
    const u = ubicaciones.find((x) => x.id === ubicacionId);
    if (!u) return null;
    const prods = productos.filter((p) => p.ubicacionId === ubicacionId);

    let valorCosto = 0, valorVenta = 0, unidades = 0;
    const porEstado = { rojo: 0, naranja: 0, amarillo: 0, verde: 0, negro: 0, azul: 0 };
    prods.forEach((p) => {
      const st = Number(p.stockActual) || 0;
      unidades += st;
      valorCosto += (Number(p.costo) || 0) * st;
      valorVenta += (Number(p.precio) || 0) * st;
      const e = estadoDe(p).estado;
      if (porEstado[e] === undefined) porEstado[e] = 0;
      porEstado[e]++;
    });

    const vMes = ventasActivas().filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha));
    const vTodas = ventasActivas().filter((v) => v.ubicacionId === ubicacionId);
    const sumar = (arr) => arr.reduce((a, v) => a + (Number(v.precioUnit) || 0) * (Number(v.cantidad) || 1), 0);
    const costoDe = (arr) => arr.reduce((a, v) => a + (Number(v.costoUnit) || 0) * (Number(v.cantidad) || 1), 0);
    const ventaMes = +sumar(vMes).toFixed(2);
    const ultima = vTodas.reduce((mx, v) => (v.fecha > mx ? v.fecha : mx), "");

    const porProducto = {};
    vMes.forEach((v) => {
      const k = v.productoId;
      if (!porProducto[k]) porProducto[k] = { productoId: k, unidades: 0, monto: 0 };
      porProducto[k].unidades += Number(v.cantidad) || 1;
      porProducto[k].monto += (Number(v.precioUnit) || 0) * (Number(v.cantidad) || 1);
    });
    const masVendidos = Object.values(porProducto).map((g) => {
      const p = productos.find((x) => x.id === g.productoId);
      return { nombre: p ? p.nombre : "(deleted product)", unidades: g.unidades, monto: +g.monto.toFixed(2) };
    }).sort((a, b) => b.monto - a.monto).slice(0, 5);
    /* Dormidos: hay stock y NO se vendio nada este mes. Es plata quieta, y es el
       numero por el que se abre una percha mas veces que por ningun otro. */
    const dormidos = prods.filter((p) => (Number(p.stockActual) || 0) > 0 && !porProducto[p.id])
      .map((p) => ({ nombre: p.nombre, stock: p.stockActual, inmovilizado: +((Number(p.costo) || 0) * (Number(p.stockActual) || 0)).toFixed(2) }))
      .sort((a, b) => b.inmovilizado - a.inmovilizado).slice(0, 5);

    const liq = getLiquidaciones().find((l) => l.ubicacionId === ubicacionId) || null;
    const prom = u.promotoraId ? promotoras.find((x) => x.id === u.promotoraId) : null;

    const enCamino = transferencias.filter((t) => (t.estado === "en_transito" || t.estado === "solicitada") && (t.ubicacionOrigenId === ubicacionId || t.ubicacionDestinoId === ubicacionId))
      .map((t) => ({
        id: t.id, estado: t.estado, cantidad: t.cantidad,
        producto: (productos.find((p) => p.id === t.productoOrigenId) || productos.find((p) => p.id === t.productoDestinoId) || {}).nombre || "(product)",
        sentido: t.ubicacionDestinoId === ubicacionId ? "entra" : "sale",
        contraparte: nombreUbic(t.ubicacionDestinoId === ubicacionId ? t.ubicacionOrigenId : t.ubicacionDestinoId),
      }));

    return {
      id: u.id, nombre: u.nombre, tipo: u.tipo || "propio", activa: u.activa !== false,
      esEvento: !!u.esEvento, esFeria: !!u.esFeria,
      sucursalId: u.sucursalId || null,
      sucursalNombre: (sucursales.find((x) => x.id === u.sucursalId) || {}).nombre || null,
      inventario: { productos: prods.length, unidades: unidades, valorCosto: +valorCosto.toFixed(2), valorVenta: +valorVenta.toFixed(2), gananciaLatente: +(valorVenta - valorCosto).toFixed(2), porEstado: porEstado },
      mes: { venta: ventaMes, ganancia: +(ventaMes - costoDe(vMes)).toFixed(2), transacciones: vMes.length, meta: liq ? liq.metaMensual : (Number(u.metaMensual) || 0), cumplimiento: liq ? liq.cumplimientoMeta : null },
      historico: { venta: +sumar(vTodas).toFixed(2), transacciones: vTodas.length, ultimaVenta: ultima || null, diasSinVender: ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 864e5) : null },
      masVendidos: masVendidos, dormidos: dormidos,
      comision: liq ? { pct: liq.pctBase, origen: liq.origenComision, seLlevaElAsociado: liq.comisionSocio, quedaEnCasa: liq.netoDueno, estado: liq.estado, ventasPendientes: liq.ventasPendientes } : null,
      asociado: prom ? { id: prom.id, nombre: prom.nombre } : null,
      gastoMensual: Number(gastosMensuales[u.id]) || 0,
      enCamino: enCamino, reservasEvento: 0,
    };
  }

  function estadoSimple(p) { if (p.stockActual <= 0) return "rojo"; if (p.stockActual <= p.umbralRojo) return "rojo"; if (p.stockActual <= p.umbralAmarillo) return "amarillo"; return "verde"; }
  // Multi-percha real (homologado de AMIGABLE, 2026-07-23): el mismo SKU
  // vive como filas separadas por percha; esto las hace visibles y da una
  // forma rapida de agregar el producto a una percha nueva.
  function getHermanosPercha(productoId) {
    const p = productos.find((x) => x.id === productoId);
    if (!p) return [];
    return productos.filter((x) => x.sku === p.sku && x.id !== p.id).map((x) => ({ id: x.id, ubicacionId: x.ubicacionId, ubicacionNombre: nombreUbic(x.ubicacionId), stockActual: x.stockActual, estado: estadoDe(x).estado, precio: x.precio }));
  }
  function getSugerenciasTransferencia(productoId) {
    const p = productos.find((x) => x.id === productoId);
    // BUG FIX (2026-07-03): estadoSimple() ignoraba perecibles; un producto a
    // punto de vencer (rojo por vencimiento) se sugeria como origen de
    // transferencia aunque su stock fuera alto. Reemplazado por estadoDe().
    if (!p || !["naranja", "rojo"].includes(estadoDe(p).estado)) return [];
    const activasIds = new Set(ubicaciones.filter((u) => u.activa !== false).map((u) => u.id));
    return productos.filter((x) => x.sku === p.sku && x.id !== p.id && activasIds.has(x.ubicacionId) && estadoDe(x).estado !== "rojo" && x.stockActual > x.umbralAmarillo)
      .map((x) => ({ productoDestinoId: p.id, productoOrigenId: x.id, sku: p.sku, nombre: p.nombre, desde: x.ubicacionId, desdeNombre: nombreUbic(x.ubicacionId), hacia: p.ubicacionId, haciaNombre: nombreUbic(p.ubicacionId), stockOrigen: x.stockActual, cantidadSugerida: Math.min(Math.floor(x.stockActual / 2), x.stockActual - x.umbralAmarillo) }))
      .filter((s) => s.cantidadSugerida > 0);
  }
  // FIX 2026-07-07: una fecha mal tecleada (2026-13-45) daba NaN y el
  // semaforo IGNORABA el vencimiento en silencio. Ahora se valida al crear
  // y al editar el producto.
  function fechaValida(f) {
    return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(new Date(f + "T00:00:00").getTime());
  }
  // Días para vencer (negativo = ya venció). Espejo de diasParaVencer() en server.js.
  function diasParaVencer(fecha) {
    if (!fecha) return null;
    const hoy = new Date(hoyISO() + "T00:00:00");
    const venc = new Date(fecha + "T00:00:00");
    return Math.round((venc - hoy) / 86400000);
  }
  // Días sin venta de un producto. Si nunca se vendió: usa p.dormidoDesde
  // (fecha ISO opcional, para seed/vitrina o carga manual) o null — un
  // producto recién creado sin historial NO se castiga con negro.
  // FIX de rendimiento 2026-07-07: antes cada producto recorria TODAS las
  // ventas en cada render (O(productos x ventas)); con meses de historial el
  // inventario se arrastraria. Mapa "ultima venta por producto" cacheado e
  // invalidado por cantidad de ventas (venta/anulacion la cambian siempre).
  let cacheUltimaVenta = { n: -1, map: null };
  function ultimaVentaMapa() {
    if (cacheUltimaVenta.n !== ventas.length) {
      const map = {};
      for (const v of ventasActivas()) { if (!map[v.productoId] || v.fecha > map[v.productoId]) map[v.productoId] = v.fecha; }
      cacheUltimaVenta = { n: ventas.length, map };
    }
    return cacheUltimaVenta.map;
  }
  function diasSinVentaDe(p) {
    const ultima = ultimaVentaMapa()[p.id] || "";
    if (ultima) return Math.floor((Date.now() - new Date(ultima).getTime()) / 86400000);
    if (p.dormidoDesde) {
      const d = Math.floor((Date.now() - new Date(p.dormidoDesde + "T00:00:00").getTime()) / 86400000);
      return d >= 0 ? d : null;
    }
    // FIX 2026-07-07: productos nuevos sin ventas ni dormidoDesde usaban null
    // y nunca llegaban a negro aunque llevaran meses sin moverse. Ahora
    // se usa creadoEn como referencia: un producto recien dado de alta
    // empieza en 0 dias y sube con el tiempo igual que cualquier otro.
    if (p.creadoEn) {
      const d = Math.floor((Date.now() - new Date(p.creadoEn).getTime()) / 86400000);
      return d >= 0 ? d : null;
    }
    return null;
  }
  // ---- RFM -> estacion del cliente (ver nota grande junto al seed) ----
  function datosRFM(c) {
    const vc = ventasActivas().filter((v) => v.clienteId === c.id);
    const ultima = vc.reduce((mx, v) => (v.fecha > mx ? v.fecha : mx), "");
    const recencia = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 86400000) : null;
    const v90 = vc.filter((v) => (Date.now() - new Date(v.fecha).getTime()) / 86400000 <= 90);
    const monto = +v90.reduce((a, v) => a + v.precioUnit * v.cantidad, 0).toFixed(2);
    return { recencia, frecuencia: v90.length, monto };
  }
  // Umbral de "valor alto": la MITAD del promedio de los clientes que si
  // compran. (La mediana partia siempre en dos mitades exactas y dejaba a
  // los clientes de otono justo debajo del corte — umbral inestable.)
  function medianaMontos() {
    const ms = clientes.map((c) => datosRFM(c).monto).filter((m) => m > 0);
    if (!ms.length) return 0;
    return ms.reduce((a, b) => a + b, 0) / ms.length / 2;
  }
  function estacionDe(rfm, mediana) {
    const reciente = rfm.recencia != null && rfm.recencia <= 20;
    const valorAlto = rfm.monto > 0 && rfm.monto >= mediana;
    if (reciente && valorAlto) return "verano";
    if (reciente) return "primavera";
    if (valorAlto) return "otono";
    return "invierno";
  }
  function fichaCliente(c, mediana) {
    const rfm = datosRFM(c);
    // evaluacion: retrocompat con backups sin el campo (default neutro 0,0)
    const ev = c.evaluacion || { trato: 0, confiabilidad: 0, historial: [] };
    return { id: c.id, codigo: c.codigo, nombre: c.nombre, telefono: c.telefono || "", email: c.email || "", notas: c.notas || "",
      rangoEdad: c.rangoEdad || "", pais: c.pais || "",
      ...rfm, estacion: estacionDe(rfm, mediana == null ? medianaMontos() : mediana),
      evaluacion: { trato: Number(ev.trato)||0, confiabilidad: Number(ev.confiabilidad)||0, historial: ev.historial||[] },
      despedido: !!c.despedido };
  }
  function siguienteCodigoCliente() {
    const max = clientes.reduce((mx, c) => Math.max(mx, Number(String(c.codigo || "").replace(/\D/g, "")) || 0), 1000);
    return "C-" + (max + 1);
  }

  // ---- Matriz BCG del inventario (60 dias de ventas) ----
  // Participacion = $ vendidos del producto sobre el total; "alta" = mayor o
  // igual al promedio de los que SI vendieron. Crecimiento = ultimos 30 dias
  // contra los 30 anteriores. Sin ventas en 60 dias -> peso muerto.
  function matrizBCG(uid) {
    const ps = filtrar(uid);
    const ahora = Date.now();
    const rev = (p, d1, d2) => ventasActivas().filter((v) => { if (v.productoId !== p.id) return false; const d = (ahora - new Date(v.fecha).getTime()) / 86400000; return d >= d1 && d < d2; }).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
    const items = ps.map((p) => { const r0 = rev(p, 0, 30), r1 = rev(p, 30, 60); return { nombre: p.nombre, total: +(r0 + r1).toFixed(2), tendencia: +(r0 - r1).toFixed(2) }; });
    const conVentas = items.filter((i) => i.total > 0);
    const promedio = conVentas.length ? conVentas.reduce((a, i) => a + i.total, 0) / conVentas.length : 0;
    const q = { estrellas: [], vacas: [], promesas: [], pesosMuertos: [] };
    items.forEach((i) => {
      if (i.total <= 0) { q.pesosMuertos.push(i); return; }
      const alta = i.total >= promedio;
      if (alta && i.tendencia > 0) q.estrellas.push(i);
      else if (alta) q.vacas.push(i);
      else if (i.tendencia > 0) q.promesas.push(i);
      else q.pesosMuertos.push(i);
    });
    Object.keys(q).forEach((k) => q[k].sort((a, b) => b.total - a.total));
    return q;
  }

  // Espejo de calcularEstado() en server.js: combina stock + vencimiento,
  // se queda con la señal más grave de las dos (ORDEN).
  // =========================================================================
  // SEMÁNTICA SIMON — CONGELADA (JFC 2026-07-04, motor alineado 2026-07-07):
  //   Verde    = saludable ("todo marcha bien, sigue así")
  //   Amarillo = OPORTUNIDAD ("hay dinero esperándote": margen >= 50%)
  //   Naranja  = urgente-pronto ("se está acabando / véndelo primero")
  //   Rojo     = emergencia (sin stock, umbral rojo, vencido o por vencer)
  //   Azul     = DATO contable (la sabiduría del dinero: margen flaco, etc.)
  //   Negro    = capital dormido (45+ días sin venta con stock sano)
  // Antes este mock usaba amarillo="revisar pronto" y azul="buen margen":
  // contradecía el manual y la Ayuda. NO volver a ese mapeo.
  // Cada estado sale con su NIVEL de encendido 1-3 (semaforo de colores:
  // tenue · medio · encendido); index.html lo prefiere sobre su heurística.
  // =========================================================================
  // Mensajes bilingues via window.t/tf (i18n.js carga antes que este script).
  // Fallback a la clave misma si i18n.js no cargo por algun motivo — nunca
  // debe tronar la app por falta de traduccion.
  const _t = (k, v) => (window.tf ? window.tf(k, v) : k);
  function estadoDe(p) {
    const margen = p.precio > 0 ? (p.precio - p.costo) / p.precio : 0;
    const dias = p.perecible ? diasParaVencer(p.fechaCaducidad) : null;
    let porStock;
    if (p.stockActual <= 0) porStock = { estado: "rojo", nivel: 3, mensaje: _t("alert.noStock") };
    else if (p.stockActual <= p.umbralRojo) {
      porStock = { estado: "rojo", nivel: p.stockActual <= Math.ceil(p.umbralRojo / 2) ? 2 : 1, mensaje: _t("alert.lowRed", { n: p.stockActual }) };
    } else if (p.stockActual <= p.umbralAmarillo) {
      const diff = p.stockActual - p.umbralRojo;
      porStock = { estado: "naranja", nivel: diff <= 1 ? 3 : diff <= 3 ? 2 : 1, mensaje: _t("alert.lowOrange", { n: p.stockActual }) };
    } else {
      const sinVenta = diasSinVentaDe(p);
      if (sinVenta != null && sinVenta >= 45) {
        porStock = { estado: "negro", nivel: sinVenta >= 120 ? 3 : sinVenta >= 60 ? 2 : 1, mensaje: _t("alert.dormant", { n: sinVenta }) };
      } else if (margen >= 0.5) {
        porStock = { estado: "amarillo", nivel: margen >= 0.70 ? 3 : margen >= 0.55 ? 2 : 1, mensaje: _t("alert.goodMargin") };
      } else {
        porStock = { estado: "verde", nivel: p.stockActual >= 15 ? 3 : p.stockActual >= 7 ? 2 : 1, mensaje: _t("alert.healthy") };
      }
    }
    if (dias == null) return { ...porStock, dias };
    let porVenc = null;
    const unidad = (n) => (n === 1 ? _t("unit.day") : _t("unit.days"));
    if (dias < 0) porVenc = { estado: "rojo", nivel: 3, mensaje: _t("alert.expiredAgo", { n: Math.abs(dias), unit: unidad(Math.abs(dias)) }) };
    else if (dias <= 3) porVenc = { estado: "rojo", nivel: dias <= 1 ? 3 : 2, mensaje: _t("alert.expiresSoon", { n: dias, unit: unidad(dias) }) };
    else if (dias <= 7) porVenc = { estado: "naranja", nivel: dias <= 5 ? 2 : 1, mensaje: _t("alert.expiresWarn", { n: dias }) };
    if (!porVenc) return { ...porStock, dias };
    const masGrave = ORDEN[porVenc.estado] <= ORDEN[porStock.estado] ? porVenc : porStock;
    return { ...masGrave, dias };
  }
  function ficha(p) {
    const e = estadoDe(p);
    return { id: p.id, nombre: p.nombre, precio: p.precio, precioCasa: (p.precioCasa == null ? null : p.precioCasa), costo: p.costo || 0, sku: p.sku, barcode: p.barcode, proveedor: p.proveedor, stockActual: p.stockActual, estado: e.estado, nivelBloom: e.nivel, mensaje: e.mensaje, dormidoDesde: p.dormidoDesde || null, categoria: p.categoria, ubicacionId: p.ubicacionId, ubicacionNombre: nombreUbic(p.ubicacionId), perecible: !!p.perecible, exentoImpuesto: !!p.exentoImpuesto, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: e.dias, metodoCosteo: p.metodoCosteo || "FIFO", umbralRojo: p.umbralRojo || 0, umbralAmarillo: p.umbralAmarillo || 0, tipoProveedor: p.tipoProveedor || "compra", tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, comisionProveedorPct: p.comisionProveedorPct || 0, comisionistaId: p.comisionistaId || null, chip: p.chip || "", familiaId: p.familiaId || "", productoBaseId: p.productoBaseId || null, varianteAtributo: p.varianteAtributo || "", varianteValor: p.varianteValor || "", otrasPerchas: getHermanosPercha(p.id), stockComprometido: transferencias.filter((t) => t.productoOrigenId === p.id && t.estado === "solicitada").reduce((a, t) => a + t.cantidad, 0), foto: p.foto || null, archivado: !!p.archivado };
  }
  /* filtrar() devuelve TODOS los productos de la ubicación, incluidos los
     archivados: dashboards, resumen histórico, BCG y reportes financieros deben
     seguir viéndolos (world's best practice — archivar NO borra del historial,
     JFC 2026-09-08). La exclusión de archivados vive SOLO en el grid de
     Inventario (endpoint GET /productos), que es la vista operacional. */
  function filtrar(uid) { return productos.filter((p) => !p.borrado && (!uid || uid === "todas" || p.ubicacionId === uid)); }
  // BUG latente fijado 2026-07-07: "ventas de HOY" filtraba solo por
  // ubicacion; con historial de dias anteriores el resumen del dia mentia.
  function ventasHoyDe(uid) { const hoy = hoyISO(); return ventasActivas().filter((v) => fechaLocalDe(v.fecha) === hoy && (!uid || uid === "todas" || v.ubicacionId === uid)); }
  // Multi-usuario (2026-07-07): cada movimiento captura automaticamente
  // quien estaba logueado (window.OCCurrentUser). Si no hay usuario nombrado
  // (dueno por PIN clasico, sistema) aparece como "Sistema".
  // Cadena anti-tamper (2026-07-08): cada movimiento SELLA al anterior. Editar
  // o borrar uno rompe la cadena y "Verificar integridad" lo detecta. Es
  // tamper-EVIDENTE (un equipo local nunca es tamper-PROOF), suficiente contra
  // el falseo casual del encargado. Hash rápido y síncrono, sembrado con el
  // instanceId para que no se recalcule a ciegas.
  function selloHash(str) {
    // FNV-1a 32-bit -> hex. NO criptográfico: solo eleva el costo de forjar.
    let h = 0x811c9dc5;
    const semilla = String(str) + "|" + (instanceId || "amigable");
    for (let i = 0; i < semilla.length; i++) { h ^= semilla.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }
  function movHuella(m) {
    return (m.prevSello || "") + "|" + m.tipo + "|" + JSON.stringify(m.detalle) + "|" + m.fecha + "|" + (m.usuarioId || "sistema");
  }
  /* Aviso de "el equipo cambio" (JFC 2026-08-25). Lo escucha sync-realtime.js
     para EMPUJAR la lista de usuarios (roles/PINs) al resto del negocio en el
     acto, sin esperar a que el otro aparato reconecte y pida el catalogo. Por
     que aqui y no en la UI: TODA alta/edicion/baja pasa por estos endpoints, asi
     que un solo punto cubre botones, tablero y cualquier via futura. Es solo un
     evento del navegador; si nadie escucha (o no hay sync), no hace nada. */
  function avisarEquipoCambiado() {
    try { window.dispatchEvent(new CustomEvent("oc-equipo-cambiado")); } catch (_) {}
  }
  /* Aviso de "el catalogo cambio" (perchas/productos) — hermano del de equipo.
     sync-realtime.js lo escucha y EMPUJA el catalogo al resto del negocio, para
     que una percha nueva creada en un aparato aparezca en los demas sin merge
     manual (JFC 2026-08-25: "no se sincronizaron las racks"). Solo estructura
     (alta/edicion/baja de perchas y productos); el STOCK sigue viajando por sus
     propias ops, no por aqui. */
  function avisarCatalogoCambiado() {
    try { window.dispatchEvent(new CustomEvent("oc-catalogo-cambiado")); } catch (_) {}
  }

  function mov(tipo, detalle, avisar = true) {
    // Una fusión entrante no fue ejecutada por quien tiene abierta esta sesión.
    const usr = tipo === "merge-catalogo" ? null : window.OCCurrentUser;
    const rolSesion = tipo === "merge-catalogo" ? "sistema" : _rolLocal();
    const actorId = usr ? usr.id : (rolSesion || "sistema");
    const actorNombre = usr ? usr.nombre : ({ dueno: "Owner", admin: "Admin", empleado: "Staff (general)", contador: "Accounting", demo: "Demo" }[rolSesion] || "Sistema");
    // JFC 2026-09-02: cada acción va al log con el responsable (usuario que entró
    // con su PIN — el PIN nunca se guarda en claro, REGLA 8) Y el dispositivo
    // (apodo + id del micelio), para defender al negocio de quejas injustas.
    let dispApodo = "", dispId = "";
    try {
      if (window.OCMicelio) {
        dispApodo = window.OCMicelio.miApodo() || "";
        const _yo = window.OCMicelio.yo && window.OCMicelio.yo();
        dispId = (_yo && _yo.id) || "";
      }
    } catch (_) {}
    const m = {
      id: uuid("m"), tipo, detalle, fecha: new Date().toISOString(),
      usuarioId:     actorId,
      usuarioNombre: actorNombre,
      usuarioRol:    usr ? (usr.rol || "") : rolSesion,
      dispositivoApodo: dispApodo,
      dispositivoId:    dispId,
    };
    m.prevSello = selloUltimo;
    m.sello = selloHash(movHuella(m));
    selloUltimo = m.sello;
    movimientos.push(m);
    // Toda acción registrada puede cambiar una ficha, venta o comisión. El
    // puente Yjs compara el catálogo y solo envía los registros que cambiaron.
    if (avisar) avisarCatalogoCambiado();
  }
  function _fotoAntesDeEquipo() {
    let adminPinsRaw = null;
    try { adminPinsRaw = localStorage.getItem("f123_admins_pins"); } catch (_) {}
    return { usuarios: usuarios.map((u) => ({ ...u })), movimientosLen: movimientos.length, sello: selloUltimo, adminPinsRaw };
  }
  async function _confirmarEquipoORevertir(foto) {
    let guardado = false;
    try { guardado = await guardarEstadoLocal(true); } catch (_) {}
    if (!guardado) {
      // No afirmar éxito ni publicar un cambio de acceso que no sobrevivirá
      // al reinicio. El historial también vuelve al punto anterior.
      usuarios.splice(0, usuarios.length, ...foto.usuarios);
      movimientos.length = foto.movimientosLen;
      selloUltimo = foto.sello;
      try {
        if (foto.adminPinsRaw == null) localStorage.removeItem("f123_admins_pins");
        else localStorage.setItem("f123_admins_pins", foto.adminPinsRaw);
      } catch (_) {}
      return false;
    }
    avisarEquipoCambiado();
    return true;
  }
  /* Dos aparatos pueden crear la misma variante estando desconectados. Una
     identidad determinista por familia+atributo+valor hace que al reconectar
     converjan sobre el mismo registro en vez de dejar duplicados. Dos FNV con
     semillas distintas reducen la posibilidad de colision accidental. */
  function idVariante(familia, atributo, valor) {
    const texto = [familia, atributo, valor].map((v) => String(v || "").trim().toLocaleLowerCase()).join("\u001f");
    const fnv = (seed) => { let h = seed >>> 0; for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); };
    return "pvar-" + fnv(2166136261) + fnv(3339675911);
  }

  // === PUENTE DE SYNC (homologado de AMIGABLE, 2026-07-23) ===================
  // mock-backend.js NUNCA hace fetch externo — la red vive en sync-realtime.js.
  // Este puente es 100% local: emite deltas de stock para que sync-realtime.js
  // los cifre y transmita, y aplica los que lleguen de otros dispositivos.
  // Idempotente por opId — un opId repetido (reintento de red, reconexion) es
  // un no-op seguro. Solo DELTAS, nunca valores absolutos — dos ventas
  // simultaneas de las mismas ultimas unidades se SUMAN, nunca se pisan.
  const OPS_APLICADAS_KEY = "f123_sync_ops_aplicadas";
  let _opsAplicadas = null;
  function _cargarOpsAplicadas() {
    if (_opsAplicadas) return _opsAplicadas;
    try { _opsAplicadas = new Set(JSON.parse(localStorage.getItem(OPS_APLICADAS_KEY) || "[]")); }
    catch (_) { _opsAplicadas = new Set(); }
    return _opsAplicadas;
  }
  function _marcarOpAplicada(opId) {
    const s = _cargarOpsAplicadas();
    s.add(opId);
    /* Tope de dedup (FASE 2, 2026-08-27): antes 500. Si un opId se evicta del
       set y el par lo reenvía (catch-up), un delta de stock se aplica DOS
       veces (doble conteo). Subido a 2000 para que la evicción sea rarísima;
       el vector de catch-up (construido desde el log de ops) ya evita reenviar
       lo que el par conoce, así que este set es la última red. */
    if (s.size > 2000) { const arr = [...s]; s.clear(); arr.slice(-2000).forEach((x) => s.add(x)); }
    try { localStorage.setItem(OPS_APLICADAS_KEY, JSON.stringify([...s])); } catch (_) {}
  }
  function emitirOpStock(tipo, payload) {
    /* A3 (2026-08-28): el delta viaja con el NOMBRE del producto, no solo el id.
       Dos dispositivos del mismo negocio pueden tener el MISMO producto con ids
       distintos (creado por separado en cada uno). El receptor (aplicarOpRemota)
       usa el nombre como respaldo para aplicar el delta aunque el id no coincida.
       Se enriquece aquí, en el único punto por donde pasan todas las ops de stock. */
    if (payload && payload.productoId && !payload.nombre) {
      try { const _pp = productos.find((x) => x.id === payload.productoId); if (_pp) payload.nombre = _pp.nombre; } catch (_) {}
    }
    /* SELLO DE STOCK (JFC 2026-09-16). Punto UNICO por donde pasan TODAS las
       mutaciones de stock (venta, ajuste, anulacion, transferencia...). Aqui se
       sella stockTs para el LWW del sync nuevo: el cambio de stock viaja y gana el
       mas reciente. Se dispara oc-catalogo-cambiado para que sembrar() publique ya. */
    if (payload && payload.productoId) {
      try {
        const _sp = productos.find((x) => x.id === payload.productoId);
        if (_sp) {
          const delta = Number(payload.delta);
          if (Number.isFinite(delta) && delta !== 0) {
            // Base + hechos únicos: dos ventas sin red se SUMAN; un valor absoluto
            // con timestamp descartaba una. La mutación local ya ocurrió antes.
            if (!_sp.stockPN || _sp.stockBase == null || !Number.isFinite(Number(_sp.stockBase))) {
              _sp.stockBase = Number(_sp.stockActual) - delta;
              _sp.stockPN = {};
            }
            let idStock = "";
            try { idStock = (window.OCSyncControl && window.OCSyncControl.deviceIdActual && window.OCSyncControl.deviceIdActual()) || localStorage.getItem("f123_device_id") || ""; } catch (_) {}
            if (!idStock) { idStock = uuid("stock-device-"); try { localStorage.setItem("f123_device_id", idStock); } catch (_) {} }
            const contador = _sp.stockPN[idStock] || { add: 0, sub: 0 };
            if (delta > 0) contador.add += delta; else contador.sub += -delta;
            _sp.stockPN[idStock] = contador;
          }
          _sp.stockTs = Date.now();
        }
      } catch (_) {}
      try { window.dispatchEvent(new CustomEvent("oc-catalogo-cambiado")); } catch (_) {}
    }
    if (window.OCSyncEmit) { try { window.OCSyncEmit(tipo, payload); } catch (_) {} }
    // MYCELIUM PHASE B (2026-07-28). This is the only place where the stock
    // move has already happened AND the resulting stock is known. Emitting the
    // fact from here rather than from a UI wrapper matters: a UI function may
    // return nothing, which leaves the fact without its resulting number, and
    // then reconciliacion.js cannot rebuild inventory at all. Wrapped in
    // try/catch: a broken bus must NEVER break a sale.
    try {
      var _mp = productos.find(function (x) { return x.id === (payload && payload.productoId); });
      if (window.AMG && window.AMG.EventBus) {
        window.AMG.EventBus.emit("inventario_" + tipo + ":completado", {
          payload: payload,
          resultado: _mp ? { productoId: _mp.id, stockActual: _mp.stockActual, sku: _mp.sku } : null
        });
      }
    } catch (_) {}
  }
  /* ==========================================================================
     PASO 1 — HUELLA DEL CATALOGO (JFC 2026-08-19)

     POR QUE EXISTE: hasta hoy el panel del equipo decia "Up to date" mirando
     SOLO EL RELOJ — cuando llego el ultimo latido. Nunca comparaba un dato.
     Por eso JFC vio "sincronizado" en su PC y en su celular mientras uno tenia
     la percha "Rack1" y el otro "001". Decir "al dia" sin haber comparado nada
     es peor que no decir nada.

     La huella es un hash barato y DETERMINISTA del catalogo: dos dispositivos
     con el mismo catalogo dan la misma huella siempre, sin importar en que
     orden lo tengan guardado (por eso se ordena por id antes de sumar).

     Entra SOLO lo que define el catalogo: perchas (id + nombre) y productos
     (id + nombre + precio + costo). NO entra el stock: dos dispositivos del
     mismo negocio pueden tener stock distinto por un instante y eso es normal,
     no es estar desincronizado. Tampoco entran ventas ni clientes: se comparan
     aparte, cuando toque.

     Se muestra corta (#A7F3) para que una persona la pueda dictar por telefono
     o pegar en WhatsApp sin entender una palabra de hashes.

     NO viaja a ningun lado fuera del equipo. El nodo de licencias no la ve.
     ========================================================================== */
  function _huellaTexto() {
    const u = ubicaciones.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((x) => String(x.id) + "|" + String(x.nombre || "")).join(";");
    const p = productos.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((x) => String(x.id) + "|" + String(x.nombre || "") + "|" + Number(x.precio || 0) + "|" + Number(x.costo || 0)).join(";");
    /* El equipo entra en la huella (2026-08-21): sin esto el panel decia "al
       dia" cuando lo unico distinto entre dos dispositivos era quien es admin
       o el PIN de alguien — justo el caso que dejo gente sin poder entrar.
       El PIN NO se mezcla en claro: se usa su largo, que cambia la huella
       cuando cambia el PIN sin exponerlo en un valor que se dicta por
       telefono. */
    const e = usuarios.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((x) => String(x.id) + "|" + String(x.nombre || "") + "|" + String(x.rol || "") + "|" + (x.activo !== false ? "1" : "0") + "|" + String(x.pin || "").length).join(";");
    return "U:" + u + "#P:" + p + "#E:" + e;
  }
  /* FNV-1a de 32 bits. No es criptografico y no pretende serlo: aqui solo hace
     falta que dos catalogos distintos den huellas distintas con altisima
     probabilidad, y que sea instantaneo en un telefono viejo con 5000
     productos. Un SHA-256 seria mas lento y no compraria nada. */
  function _fnv1a(txt) {
    let h = 0x811c9dc5;
    for (let i = 0; i < txt.length; i++) {
      h ^= txt.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function huellaCatalogo() {
    try {
      const h = _fnv1a(_huellaTexto());
      return {
        /* 4 caracteres en mayuscula: dictable por telefono sin ambiguedad. */
        corta: "#" + h.toString(36).toUpperCase().slice(-4).padStart(4, "0"),
        completa: h.toString(36).toUpperCase(),
        productos: productos.length,
        perchas: ubicaciones.length,
      };
    } catch (_) { return null; }
  }

  /* ==========================================================================
     PASOS 4 y 5 — MERGE DE CATALOGO ENTRE DISPOSITIVOS DEL EQUIPO
     (JFC 2026-08-19)

     POR QUE HACIA FALTA: aplicarOpRemota() solo sabia aplicar deltas de stock
     sobre productos que YA existian en los dos lados. El catalogo —productos,
     perchas— nunca viajaba. Su propio mensaje de error lo decia ("sync the
     catalog first") y ese paso no existia. Por eso la PC de JFC quedo con
     "Rack1" y su celular con "001", conectados y sin juntarse nunca.

     LAS DOS REGLAS DURAS, y no se negocian:

     1. EL MERGE SUMA, NUNCA BORRA. Lo que existe solo de un lado se conserva.
        Perder inventario por unirse a un equipo seria peor que no sincronizar
        nunca. Por eso no hay ninguna rama que haga splice/delete.

     2. NADA SE APLICA SIN MOSTRARLO ANTES. compararCatalogo() calcula el
        cambio y la UI lo enseña; aplicarCatalogo() solo corre si una persona
        dijo que si. Sobre datos de dinero no se adivina.

     JERARQUIA para los choques (mismo id, datos distintos): dueño > admin >
     encargado. Si el otro tiene un rol MAS ALTO, gana el suyo. Si es igual o
     mas bajo, se conserva lo propio y el choque se REPORTA para que una
     persona lo mire. El stock NUNCA se pisa por jerarquia: es un hecho fisico
     de cada percha, no una opinion.
     ========================================================================== */
  const _RANGO = { dueno: 3, admin: 2, empleado: 1, contador: 1 };
  function _rango(rol) { return _RANGO[String(rol || "").toLowerCase()] || 0; }

  function compararCatalogo(remoto, rolRemoto) {
      /* BUG DE MI PROPIA PRIMERA VERSION, encontrado al probarlo (2026-08-19):
       era `_rango(rolRemoto) > _rango(_rolLocal())`, y cuando el rol local no
       se puede leer (demo, sesion recien abierta, contador) el rango local
       daba 0 y CUALQUIERA le ganaba. Un encargado le pisaba los precios al
       dueno. Medido: precio 22 pisado a 999 por un merge de un encargado.

       La regla segura es al reves: solo se pisa cuando se conocen LOS DOS
       roles y el de enfrente es estrictamente mayor. Ante la duda manda quien
       tiene el dispositivo en la mano, porque es quien va a vivir con el dato.
       Igual nada de esto se aplica sin que una persona lo confirme en
       pantalla; esto solo decide que se le PROPONE. */
  const _rl = _rango(_rolLocal()), _rr = _rango(rolRemoto);
  const out = { nuevasPerchas: [], nuevosProductos: [], conflictos: [], nuevosMiembros: [], miembrosActualizados: [], soloMios: 0, ganaElOtro: _rr > 0 && _rl > 0 && _rr > _rl };
    if (!remoto || !Array.isArray(remoto.ubicaciones) || !Array.isArray(remoto.productos)) return null;
    const misU = new Map(ubicaciones.map((u) => [String(u.id), u]));
    const misP = new Map(productos.map((p) => [String(p.id), p]));

    remoto.ubicaciones.forEach((u) => {
      if (!u || !u.id) return;
      const mia = misU.get(String(u.id));
      if (!mia) { out.nuevasPerchas.push({ id: u.id, nombre: u.nombre || "" }); return; }
      if (String(mia.nombre || "") !== String(u.nombre || "")) {
        out.conflictos.push({ que: "shelf", id: u.id, mio: mia.nombre, suyo: u.nombre });
      }
    });
    remoto.productos.forEach((p) => {
      if (!p || !p.id) return;
      const mio = misP.get(String(p.id));
      if (!mio) { out.nuevosProductos.push({ id: p.id, nombre: p.nombre || "", precio: Number(p.precio) || 0 }); return; }
      if (Number(mio.precio) !== Number(p.precio) || String(mio.nombre || "") !== String(p.nombre || "")) {
        out.conflictos.push({ que: "product", id: p.id, mio: { nombre: mio.nombre, precio: mio.precio }, suyo: { nombre: p.nombre, precio: p.precio } });
      }
    });
    /* EQUIPO (2026-08-21). Se cuenta aparte de productos y perchas porque en
       pantalla se explica aparte: a nadie le sirve leer "3 cambios" sin saber
       que uno de ellos le cambia el rol a una persona. */
    if (Array.isArray(remoto.usuarios)) {
      const misUsr = new Map(usuarios.map((u) => [String(u.id), u]));
      remoto.usuarios.forEach((u) => {
        if (!u || !u.id) return;
        if (u.borrado) return; // un tombstone es una BAJA, no se anuncia como cambio en el preview
        const mio = misUsr.get(String(u.id));
        if (!mio || mio.borrado) { out.nuevosMiembros.push({ id: u.id, nombre: u.nombre || "", rol: u.rol || "empleado" }); return; }
        /* Gana la edicion mas reciente, NO la jerarquia: si el dueno degrada a
           alguien en su celular, esa es la ultima palabra aunque el merge lo
           traiga un encargado. Sin `actualizadoEn` (registro viejo, de antes
           de este cambio) se conserva lo propio y no se toca nada. */
        const tMio = Date.parse(mio.actualizadoEn || mio.creadoEn || 0) || 0;
        const tSuyo = Date.parse(u.actualizadoEn || u.creadoEn || 0) || 0;
        const distinto = String(mio.rol) !== String(u.rol) || String(mio.pin) !== String(u.pin) ||
                         String(mio.nombre || "") !== String(u.nombre || "") || (mio.activo !== false) !== (u.activo !== false);
        if (distinto && tSuyo > tMio) {
          out.miembrosActualizados.push({ id: u.id, nombre: u.nombre || mio.nombre, rolAntes: mio.rol, rolDespues: u.rol });
        }
      });
    }
    const idsRemotos = new Set(remoto.productos.map((x) => String(x && x.id)));
    out.soloMios = productos.filter((x) => !idsRemotos.has(String(x.id))).length;
    return out;
  }

  function _rolLocal() {
    try { return (window.OCAuth && window.OCAuth.rolActual) ? window.OCAuth.rolActual() : ""; } catch (_) { return ""; }
  }
  /* PIN RESERVADO (JFC 2026-08-31). Esquema de PINs acordado:
       456 = demo · 789 = dueño de fábrica Y activador de instancia propia
       260 = empleado/encargado · 357 = contable/Accounting.
       888 queda LIBRE (no es dueño de fábrica). Un encargado no puede fijar
       como PIN suyo ninguno de los códigos de sistema. */
  const PINS_RESERVADOS = ["456", "789", "260", "357"];
  function _pinReservado(pin) { return PINS_RESERVADOS.indexOf(String(pin || "")) !== -1; }
  // La UI no es una frontera de autorización. Estas rutas se validan también
  // aquí; JS local no sustituye una autoridad verificable entre aparatos.
  function _puedeGestionarEquipo() { const r = _rolLocal(); return r === "dueno" || r === "admin"; }
  async function _pinIntegradoEnUso(pin) {
    try {
      // Si no podemos comprobar, no asignar un PIN potencialmente ambiguo.
      // null significa "no verificado", distinto de false (libre).
      if (!window.OCSecure || !window.OCSecure.coincidePin) return null;
      if (window.OCSecure.estadoSecreto && window.OCSecure.estadoSecreto() !== "ok") return null;
      for (const rol of ["owner", "emp", "acct"]) {
        if (await window.OCSecure.coincidePin(pin, rol)) return true; // hashes legados sin copia visible
      }
      const p = window.OCSecure && window.OCSecure.leerPinsVisibles && window.OCSecure.leerPinsVisibles();
      return !!(p && [p.owner, p.acct].concat(p.empleados || []).some((x) => x === pin));
    } catch (_) { return null; }
  }

  /* RELOJ LÓGICO DEL ROSTER (JFC 2026-08-26, Camino A "terminar bien lo nuestro").
     Cada edición del equipo se sella con rev = { c: contador Lamport, d: deviceId }.
     El contador viene del MISMO Lamport que ya sincroniza sync-realtime (version
     vectors), así el orden es causal y global, no del reloj de pared del aparato
     (dos celulares con la hora mal puesta se pisaban al promover/degradar/PIN).
     Si sync-realtime no está cargado (tablero, pruebas), cae a un contador local
     monótono + un deviceId estable: nunca lanza y nunca deja sin sellar. */
  let _revLocalFallback = 0;
  try { _revLocalFallback = Number(localStorage.getItem("f123_catalog_rev_counter")) || 0; } catch (_) {}
  function _revNueva() {
    let c = 0, d = "";
    try {
      if (window.OCSyncControl && typeof window.OCSyncControl.revTick === "function") {
        c = Number(window.OCSyncControl.revTick()) || 0;
        d = String(window.OCSyncControl.deviceIdActual() || "");
      }
    } catch (_) {}
    if (!c || c <= _revLocalFallback) { c = _revLocalFallback + 1; }
    if (c > _revLocalFallback) _revLocalFallback = c;
    try { localStorage.setItem("f123_catalog_rev_counter", String(_revLocalFallback)); } catch (_) {}
    if (!d) {
      try {
        d = String(localStorage.getItem("f123_device_id") || "");
        if (!d) { d = uuid("device-"); localStorage.setItem("f123_device_id", d); }
      } catch (_) { d = uuid("device-"); }
    }
    return { c: c, d: d };
  }
  function _observarRev(rev) {
    if (!rev || !Number.isFinite(Number(rev.c))) return;
    _revLocalFallback = Math.max(_revLocalFallback, Number(rev.c));
    try { localStorage.setItem("f123_catalog_rev_counter", String(_revLocalFallback)); } catch (_) {}
  }
  /* ¿El rev A (remoto) le gana al rev B (local)? Gana el contador mayor; empate
     de contador se rompe por deviceId (orden lexicográfico estable, determinista
     en los dos aparatos). Un registro SIN rev (dato viejo, pre-upgrade) se trata
     como rev {c:0} para no perder ante él por accidente: el que ya tiene rev es
     el que pasó por el camino nuevo. Devuelve null si NINGUNO tiene rev, para que
     el llamador caiga al reloj de pared (comportamiento idéntico a antes). */
  function _revDomina(a, b) {
    const tieneA = a && typeof a.c === "number";
    const tieneB = b && typeof b.c === "number";
    if (!tieneA && !tieneB) return null; // sin reloj lógico en ninguno: decide el llamador
    const ca = tieneA ? a.c : 0, cb = tieneB ? b.c : 0;
    if (ca !== cb) return ca > cb;
    const da = tieneA ? String(a.d || "") : "", db = tieneB ? String(b.d || "") : "";
    return da > db;
  }

  function ventasActivas() { return Array.prototype.filter.call(ventas, (v) => !v.anulada); }

  function aplicarCatalogo(remoto, rolRemoto) {
    const dif = compararCatalogo(remoto, rolRemoto);
    if (!dif) return { ok: false, error: "The catalog received is not readable." };
    const mandaElOtro = dif.ganaElOtro;
    let agregadasU = 0, agregadosP = 0, actualizados = 0, ventasAgregadas = 0;

    if (Array.isArray(remoto.gastos)) remoto.gastos.forEach((g) => {
      if (!g || !g.id || (!g.borrado && (!g.concepto || !(Number(g.monto) > 0)))) return;
      _observarRev(g.rev);
      const local = gastos.find((x) => String(x.id) === String(g.id));
      if (!local) { gastos.push(Object.assign({}, g)); actualizados++; }
      else if (_revDomina(g.rev, local.rev) === true) { Object.assign(local, g); actualizados++; }
    });
    if (Array.isArray(remoto.transferencias)) remoto.transferencias.forEach((t) => {
      if (!t || !t.id || !t.productoOrigenId || !t.productoDestinoId) return;
      _observarRev(t.rev);
      const local = transferencias.find((x) => String(x.id) === String(t.id));
      if (!local) { transferencias.push(Object.assign({}, t)); actualizados++; }
      else if (_revDomina(t.rev, local.rev) === true) { Object.assign(local, t); actualizados++; }
    });

    remoto.ubicaciones.forEach((u) => {
      if (!u || !u.id) return;
      const mia = ubicaciones.find((x) => String(x.id) === String(u.id));
      if (!mia) {
        ubicaciones.push(Object.assign({}, u, { activa: !u.borrado && u.activa !== false }));
        if (Number.isFinite(Number(u.gastoMensual)) && Number(u.gastoMensual) >= 0) gastosMensuales[u.id] = Number(u.gastoMensual);
        _observarRev(u.rev);
        _observarRev(u.gastoMensualRev);
        agregadasU++;
      } else {
        if (u.gastoMensualRev && _revDomina(u.gastoMensualRev, mia.gastoMensualRev) === true && Number.isFinite(Number(u.gastoMensual)) && Number(u.gastoMensual) >= 0) {
          gastosMensuales[mia.id] = Number(u.gastoMensual);
          mia.gastoMensualRev = u.gastoMensualRev; _observarRev(u.gastoMensualRev); actualizados++;
        }
        const ganaU = _revDomina(u.rev, mia.rev);
        if (ganaU === true || (ganaU === null && mandaElOtro)) {
          if (!u.borrado && !esTextoCorto(String(u.nombre || ""), 240)) return;
          const fotoAnterior = mia.fotoHash;
          Object.keys(u).forEach((k) => { if (k !== "id" && k !== "gastoMensual" && k !== "gastoMensualRev") mia[k] = u[k]; });
          if (fotoAnterior !== mia.fotoHash) mia.foto = null;
          _observarRev(u.rev); actualizados++;
        }
        /* B2: puntero de foto ADD-ONLY. Si la percha de aca no tiene foto y la
           del otro aparato si, se adopta el hash (los bytes se traen despues, B3).
           No se pisa una foto ya puesta aqui: cada aparato conserva la suya hasta
           que haya una regla mas fina; asi nunca se pierde una asignacion. */
        if (ganaU === null && u.fotoHash && !mia.fotoHash) { mia.fotoHash = u.fotoHash; actualizados++; }
      }
    });
    remoto.productos.forEach((p) => {
      if (!p || !p.id) return;
      // NO ADOPTAR SEMILLA DEMO (v297): id "p"+DIGITOS = ejemplo; aunque la sala la
      // tenga persistida, ningun aparato la vuelve a meter al store. Los reales son
      // "p"+UUID, no matchean.
      if (/^p\d+$/.test(String(p.id))) return;
      const mio = productos.find((x) => String(x.id) === String(p.id));
      if (!mio) {
        /* STOCK COMPARTIDO (JFC 2026-09-16, aprobado). Antes el producto entraba
           con stock 0 (filosofia "el stock es fisico de cada percha"). En un
           cuaderno COMPARTIDO el stock es dato del negocio y cruza: el articulo
           entra CON el stock del otro aparato. */
        productos.push(Object.assign({}, p, { stockActual: Math.max(0, Number(p.stockActual) || 0), stockTs: Number(p.stockTs) || 0, fotoHash: p.fotoHash || null }));
        _observarRev(p.rev);
        agregadosP++;
      } else {
        // FOTO DE PRODUCTO por hash, ADD-ONLY (JFC 2026-09-16): si aca no hay foto
        // y el otro aparato mando su fotoHash, se adopta; los bytes llegan por el
        // canal de fotos y se hidratan en volcarFotosAlStore. No pisa una ya puesta.
        const ganaP = _revDomina(p.rev, mio.rev);
        if (ganaP === null && p.fotoHash && !mio.fotoHash) { mio.fotoHash = p.fotoHash; actualizados++; }
        /* STOCK LWW por stockTs (JFC 2026-09-16). Simetrico: gana la ULTIMA
           edicion de stock por su sello de tiempo, venga de quien venga. Asi
           "subir a 3 en el celu" aparece en la PC en segundos. Trade-off aceptado:
           2 ventas simultaneas del MISMO producto -> LWW pisa una (raro, 1 caja). */
        const _tsR = Number(p.stockTs) || 0, _tsL = Number(mio.stockTs) || 0;
        const _pnR = p.stockPN && typeof p.stockPN === "object" ? p.stockPN : null;
        const _pnL = mio.stockPN && typeof mio.stockPN === "object" ? mio.stockPN : null;
        const _baseR = p.stockBase != null && Number.isFinite(Number(p.stockBase)) ? Number(p.stockBase) : null;
        const _baseL = mio.stockBase != null && Number.isFinite(Number(mio.stockBase)) ? Number(mio.stockBase) : null;
        if (_baseR !== null && (_baseL === _baseR || (_baseL === null &&
            (Number(mio.stockActual) === _baseR || Number(mio.stockActual) === Number(p.stockActual))))) {
          const pn = Object.assign({}, _pnL || {});
          Object.keys(_pnR || {}).forEach((id) => {
            const antes = pn[id] || {}, nuevo = _pnR[id] || {};
            pn[id] = { add: Math.max(Number(antes.add) || 0, Number(nuevo.add) || 0),
                       sub: Math.max(Number(antes.sub) || 0, Number(nuevo.sub) || 0) };
          });
          const calculado = Math.max(0, _baseR + Object.keys(pn).reduce((n, id) => n + (Number(pn[id].add) || 0) - (Number(pn[id].sub) || 0), 0));
          if (calculado !== Number(mio.stockActual) || JSON.stringify(pn) !== JSON.stringify(_pnL) || _baseL === null) actualizados++;
          mio.stockBase = _baseR; mio.stockPN = pn; mio.stockActual = calculado;
          mio.stockTs = Math.max(_tsL, _tsR);
        } else if (_baseL === null && _baseR === null && _tsR > _tsL && Number.isFinite(Number(p.stockActual)) && Number(p.stockActual) >= 0) {
          // Compatibilidad con aparatos anteriores al ledger de descuentos.
          mio.stockActual = Math.max(0, Number(p.stockActual)); mio.stockTs = _tsR; actualizados++;
        } else if (_baseR !== null && _baseL !== null && _baseR !== _baseL) {
          try { window.dispatchEvent(new CustomEvent("oc-stock-base-conflicto", { detail: { productoId: mio.id } })); } catch (_) {}
        }
        if (ganaP === true) {
          if (!p.borrado && !esTextoCorto(String(p.nombre || ""), 240)) return;
          const campos = ["nombre", "sku", "barcode", "categoria", "precio", "precioCasa", "costo", "ubicacionId", "umbralRojo", "umbralAmarillo", "perecible", "exentoImpuesto", "fechaCaducidad", "proveedor", "metodoCosteo", "tipoProveedor", "tipoProducto", "servingMl", "botellaMl", "comisionProveedorPct", "comisionistaId", "chip", "archivado", "fotoHash", "borrado", "rev"];
          const fotoAnterior = mio.fotoHash;
          campos.forEach((k) => { if (Object.prototype.hasOwnProperty.call(p, k)) mio[k] = p[k]; });
          if (fotoAnterior !== mio.fotoHash) mio.foto = null;
          _observarRev(p.rev); actualizados++;
        } else if (ganaP === null && mandaElOtro) {
          if (esTextoCorto(String(p.nombre || ""), 240) && String(mio.nombre) !== String(p.nombre)) { mio.nombre = p.nombre; actualizados++; }
          if (Number.isFinite(Number(p.precio)) && Number(p.precio) >= 0 && Number(mio.precio) !== Number(p.precio)) { mio.precio = Number(p.precio); actualizados++; }
          /* precioCasa (JFC/Belén 2026-09-15): converge entre aparatos. null lo
             borra; un número >=0 lo fija. */
          if (p.precioCasa === null && mio.precioCasa != null) { mio.precioCasa = null; actualizados++; }
          else if (Number.isFinite(Number(p.precioCasa)) && Number(p.precioCasa) >= 0 && Number(mio.precioCasa) !== Number(p.precioCasa)) { mio.precioCasa = Number(p.precioCasa); actualizados++; }
        }
      }
    });

    /* VENTAS / DINERO ADD-ONLY (JFC 2026-09-16, aprobado). Cada venta se SUMA una
       sola vez por id; nunca se pisa ni se borra una venta existente. No hay doble
       descuento de stock porque el stock es LWW ABSOLUTO aparte (v289), no se
       re-deriva de estas ventas. Asi el dinero (ventas, reportes) converge entre
       aparatos por el sync nuevo, sin depender del sync viejo. */
    if (Array.isArray(remoto.ventas)) {
      // FIX v293 (perf): Set de ids locales UNA vez, no ventas.some() por cada
      // venta remota (era O(n*m); con historiales grandes trababa el merge).
      const _idsVenta = new Map(ventas.map((x) => [String(x.id), x]));
      remoto.ventas.forEach((v) => {
        if (!v || v.id == null) return;
        _observarRev(v.rev);
        const local = _idsVenta.get(String(v.id));
        if (local) {
          if (_revDomina(v.rev, local.rev) !== true) return;
          Object.assign(local, v); actualizados++; return;
        }
        ventas.push({ id: v.id, productoId: v.productoId, ubicacionId: v.ubicacionId, cantidad: Number(v.cantidad) || 0, precioUnit: Number(v.precioUnit) || 0, costoUnit: Number(v.costoUnit) || 0, fecha: v.fecha || new Date().toISOString(), split: v.split || null, liquidada: !!v.liquidada, clienteId: v.clienteId || null, info: v.info || null, anulada: !!v.anulada, impuesto: v.impuesto || null, rev: v.rev || null, origenRemoto: true });
        _idsVenta.set(String(v.id), ventas[ventas.length - 1]);
        ventasAgregadas++;
      });
    }

    /* DISPOSITIVOS (apodos) POR EL SYNC NUEVO (v298). Cada aparato publico su
       entrada {id,apodo,rol}; aqui se alimenta la lista de micelio (misma que pinta
       Advanced -> "Your team right now") para que el dueño vea SUS aparatos por el
       sync nuevo, no por el viejo. No se cuenta como "agregado" (no dispara merge
       de negocio); solo refresca la lista de dispositivos. */
    if (Array.isArray(remoto.dispositivos) && window.OCMicelio && window.OCMicelio.recibir) {
      remoto.dispositivos.forEach((d) => {
        if (!d || !d.id) return;
        try {
          window.OCMicelio.recibir({
            tipo: window.OCMicelio.TIPO_LATIDO,
            payload: { id: String(d.id), apodo: String(d.apodo || "").slice(0, 28), rol: d.rol || "", visto: Date.now(), shell: "", huella: "" }
          });
        } catch (_) {}
      });
      try { window.dispatchEvent(new CustomEvent("oc-micelio-cambio")); } catch (_) {}
    }

    /* EL EQUIPO (2026-08-21). Misma regla dura que el catalogo: SUMA, NUNCA
       BORRA. Un miembro que solo existe aqui se queda; nunca se elimina a
       nadie por un merge, porque quedarse sin acceso al cuaderno por
       sincronizar seria peor que no sincronizar nunca. Para sacar a alguien
       de verdad esta el boton de borrar, que es una decision de una persona.
       El PIN duplicado se resuelve conservando el propio: dos personas con el
       mismo PIN dejaria entrar a la equivocada. */
    /* LWW-Element-Set con reloj LÓGICO + tombstones (JFC 2026-08-26, Camino A).
       ANTES esto era add-only y decidía por reloj de PARED (actualizadoEn):
         - no podía sacar a nadie del equipo entre aparatos (add-only nunca borra
           y el otro re-propagaba al borrado);
         - dos celulares con la hora mal puesta se pisaban al promover/degradar/PIN.
       AHORA cada registro trae rev = { c: Lamport, d: deviceId } y la baja es un
       tombstone (borrado:true). El ganador se decide por rev (causal, global); si
       NINGUNO de los dos tiene rev (dato viejo pre-upgrade) se cae al reloj de
       pared, idéntico a como era. La baja gana al re-add rancio y propaga. */
    let miembrosAgregados = 0, miembrosActualizados = 0, miembrosQuitados = 0;
    if (Array.isArray(remoto.usuarios)) {
      remoto.usuarios.forEach((u) => {
        if (!u || !u.id) return;
        const esTomb = !!u.borrado;
        // Un registro vivo necesita nombre y PIN legible; un tombstone puede llegar
        // sin ellos y aun así hay que respetarlo (es una BAJA, no un alta a medias).
        if (!esTomb) {
          if (!u.nombre) return;
          if (!/^\d{3}$/.test(String(u.pin || ""))) return; // PIN ilegible: no se importa a medias
        }
        const rolU = (u.rol === "admin" || u.rol === "empleado") ? u.rol : "empleado";
        const mio = usuarios.find((x) => String(x.id) === String(u.id));
        if (!mio) {
          if (esTomb) {
            // Baja de alguien que aquí nunca existió: se registra el tombstone para
            // que, si un tercer aparato lo re-agrega con rev menor, la baja gane.
            usuarios.push({ id: u.id, nombre: String(u.nombre || "").slice(0, 60), pin: u.pin || "",
                            rol: rolU, email: u.email || null, activo: false, borrado: true,
                            creadoEn: u.creadoEn || new Date().toISOString(),
                            actualizadoEn: u.actualizadoEn || null, rev: u.rev || null });
            return;
          }
          if (usuarios.some((x) => !x.borrado && x.pin === u.pin)) {
            /* AVISO DE COLISIÓN DE PIN (2026-08-26, code-review finding #4):
               Antes, esta colisión se descartaba silenciosamente. El resultado era
               que el operador no sabía por qué el miembro del equipo no llegó —
               desde su punto de vista el sync "funcionó" pero la persona no aparecía.
               Con el evento oc-pin-colision, la UI puede avisarle al dueño:
               "El PIN de [nombre] choca con uno que ya tienes — cámbiaselo antes de sincronizar."
               La política sigue siendo la misma: gana el PIN de casa (no se importa el remoto).
               El evento es informativo, no bloquea nada. */
            _anotarConflictoEquipo(u);
            try { window.dispatchEvent(new CustomEvent("oc-pin-colision", { detail: { nombre: u.nombre, id: u.id } })); } catch (_) {}
            return;
          }
          usuarios.push({ id: u.id, nombre: String(u.nombre).slice(0, 60), pin: u.pin, rol: rolU,
                          email: u.email || null, activo: u.activo !== false, borrado: false,
                          creadoEn: u.creadoEn || new Date().toISOString(),
                          actualizadoEn: u.actualizadoEn || null, rev: u.rev || null });
          miembrosAgregados++;
          _resolverConflictoEquipo(u.id);
          return;
        }
        // Ya existe aquí: decide el reloj lógico; si ninguno tiene rev, el de pared.
        const dom = _revDomina(u.rev, mio.rev);
        let ganaSuyo;
        if (dom === null) {
          const tMio = Date.parse(mio.actualizadoEn || mio.creadoEn || 0) || 0;
          const tSuyo = Date.parse(u.actualizadoEn || u.creadoEn || 0) || 0;
          ganaSuyo = tSuyo > tMio;
        } else {
          ganaSuyo = dom;
        }
        if (!ganaSuyo) return; // lo de aquí gana o empata: no se pisa
        // El PIN entrante no debe chocar con OTRO miembro vivo (dejaría entrar a la
        // persona equivocada). Un tombstone no trae PIN activo, así que no aplica.
        if (!esTomb && usuarios.some((x) => x.id !== mio.id && !x.borrado && x.pin === u.pin)) { _anotarConflictoEquipo(u); return; }
        const estabaVivo = !mio.borrado;
        mio.nombre = String(u.nombre || mio.nombre).slice(0, 60);
        if (u.pin) mio.pin = u.pin;
        mio.rol = rolU;
        mio.borrado = esTomb;
        mio.activo = esTomb ? false : (u.activo !== false);
        if (u.email !== undefined) mio.email = u.email || null;
        mio.actualizadoEn = u.actualizadoEn || mio.actualizadoEn;
        mio.rev = u.rev || mio.rev;
        _resolverConflictoEquipo(u.id);
        if (esTomb && estabaVivo) miembrosQuitados++;
        else miembrosActualizados++;
      });
    }

    /* CLIENTES — SUMA, NUNCA BORRA (JFC 2026-08-26). Add-only por id: si el
       cliente ya existe aquí, NO se pisa (se respeta la evaluación local trato/
       confiabilidad, que es criterio de cada operador). Solo se agregan los que
       faltan. Así Belén ve los clientes REALES del negocio y no la semilla demo. */
    let clientesAgregados = 0;
    if (Array.isArray(remoto.clientes)) {
      remoto.clientes.forEach((c) => {
        if (!c || !c.id || (!c.borrado && !c.nombre)) return;
        _observarRev(c.rev);
        const mio = clientes.find((x) => String(x.id) === String(c.id));
        if (mio) {
          if (_revDomina(c.rev, mio.rev) !== true) return;
          // La baja viaja como marca versionada: un catálogo viejo no la revive.
          Object.assign(mio, c);
          actualizados++;
          return;
        }
        clientes.push({
          id: c.id,
          codigo: c.codigo || "",
          nombre: String(c.nombre || "").slice(0, 80),
          telefono: c.telefono || "",
          email: c.email || "",
          evaluacion: (c.evaluacion && typeof c.evaluacion === "object") ? c.evaluacion : { trato: 0, confiabilidad: 0, historial: [] },
          notas: c.notas || "", rangoEdad: c.rangoEdad || "", pais: c.pais || "",
          despedido: !!c.despedido, borrado: !!c.borrado, rev: c.rev || null,
        });
        clientesAgregados++;
      });
    }

    /* COMISIONISTAS (promotoras) y SUCURSALES — SUMA, NUNCA PISA (JFC 2026-09-10,
       "sync integral"). Add-only por id, igual que los clientes: si ya existe
       aqui, NO se toca (se respeta su comision/datos locales — sobre plata no se
       adivina). Solo entran los que faltan. Asi un comisionista dado de alta en un
       aparato aparece en el otro sin arriesgar sus porcentajes. */
    let promotorasAgregadas = 0;
    if (Array.isArray(remoto.promotoras)) {
      remoto.promotoras.forEach((p) => {
        if (!p || !p.id || !p.nombre) return;
        _observarRev(p.rev);
        const mio = promotoras.find((x) => String(x.id) === String(p.id));
        if (mio) {
          if (_revDomina(p.rev, mio.rev) !== true) return;
          Object.assign(mio, p); actualizados++; return;
        }
        const base = Math.max(0, Number(p.comisionBase != null ? p.comisionBase : p.comision) || 0);
        promotoras.push({ id: p.id, nombre: String(p.nombre).slice(0, 80), comisionBase: base, comision: base,
          telefono: p.telefono || "", cedula: p.cedula || "", banco: p.banco || "", cuenta: p.cuenta || "",
          direccion: p.direccion || "", notas: p.notas || "", activa: p.activa !== false,
          metaMensual: Math.max(0, Number(p.metaMensual) || 0),
          escalasComision: Array.isArray(p.escalasComision) ? p.escalasComision : [],
          creadoEn: p.creadoEn || new Date().toISOString(), rev: p.rev || null, borrado: !!p.borrado });
        promotorasAgregadas++;
      });
    }
    let sucursalesAgregadas = 0;
    if (Array.isArray(remoto.sucursales)) {
      remoto.sucursales.forEach((s) => {
        if (!s || !s.id || !s.nombre) return;
        _observarRev(s.rev);
        const mio = sucursales.find((x) => String(x.id) === String(s.id));
        if (mio) {
          if (_revDomina(s.rev, mio.rev) !== true) return;
          Object.assign(mio, s); actualizados++; return;
        }
        sucursales.push({ id: s.id, nombre: String(s.nombre).slice(0, 80), activa: s.activa !== false, rev: s.rev || null, borrado: !!s.borrado });
        sucursalesAgregadas++;
      });
    }

    /* NOMBRE DE LA TIENDA (JFC 2026-08-27 + 2026-08-28 + DESEMPATE v283 2026-09-15).
       Al unirse a un equipo, el aparato adopta el nombre del negocio. Regla de
       jerarquía (JFC 2026-08-28: "la jerarquía le pertenece al PIN, el nombre sale
       del PIN de mayor jerarquía"): se adopta si el local está vacío O si el
       remitente es el DUEÑO. DESEMPATE (v283): cuando AMBOS son dueño, ya no gana
       "el último que sembró" (guerra de nombres, nunca convergía). Gana el rename
       de dueño MÁS RECIENTE por su sello de tiempo: solo se adopta el nombre remoto
       de un dueño si su nombreNegocioTs es MAYOR que el local (o si el local no
       tiene sello). Así los dos aparatos convergen al mismo nombre de forma estable. */
    /* DESEMPATE v290 (#2): PRIMARIO por rev monotónico (inmune a relojes
       desfasados), SECUNDARIO por ts. Se adopta el nombre remoto de un dueño si su
       rev es mayor, o si empatan en rev y su ts es mayor. */
    var _tsRemoto = Number(remoto && remoto.nombreNegocioTs) || 0;
    var _revRemoto = Number(remoto && remoto.nombreNegocioRev) || 0;
    var _adoptaNombre = false;
    if (remoto && typeof remoto.nombreNegocio === "string" && remoto.nombreNegocio.trim()) {
      if (!String(nombreNegocio || "").trim()) _adoptaNombre = true;           // local vacío: adoptar
      else if (rolRemoto === "dueno") {
        _adoptaNombre = (_revRemoto > nombreNegocioRev) ||
                        (_revRemoto === nombreNegocioRev && _tsRemoto > nombreNegocioTs);
      }
    }
    if (_adoptaNombre) {
      nombreNegocio = remoto.nombreNegocio.trim().slice(0, 80);
      if (_tsRemoto) nombreNegocioTs = _tsRemoto;
      if (_revRemoto > nombreNegocioRev) nombreNegocioRev = _revRemoto; // Lamport: sincroniza el contador
      try {
        const _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
        _ow.nombreNegocio = nombreNegocio;
        if (_tsRemoto) _ow.nombreNegocioTs = _tsRemoto;
        _ow.nombreNegocioRev = nombreNegocioRev;
        localStorage.setItem("f123_owned", JSON.stringify(_ow));
      } catch (_) {}
      try { window.dispatchEvent(new CustomEvent("oc-negocio-actualizado", { detail: { nombre: nombreNegocio } })); } catch (_) {}
      /* HEARTBEAT AL ADOPTAR NOMBRE POR SYNC (v301, #9). Antes el nombre convergia
         en el aparato pero el panel privado seguia mostrando el viejo hasta el
         proximo login (el panel lee el heartbeat, no el _meta del sync). Ahora, al
         adoptar un nombre nuevo, se manda un heartbeat para que el panel muestre un
         solo nombre por licencia de inmediato. */
      try {
        var _oh = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
        if (_oh.instanceId && window.OCAuth && window.OCAuth.heartbeat) {
          window.OCAuth.heartbeat({ instanceId: _oh.instanceId, licenseCode: _oh.licenseCode || "", email: _oh.email || "", whatsapp: _oh.whatsapp || "", nombre: _oh.nombre || "", nombreNegocio: nombreNegocio, accion: "sync-nombre" });
        }
      } catch (_) {}
    }
    try {
      const pr = remoto && remoto.pinsRol;
      if (pr && window.OCSecure) {
        const fabrica = { owner: "789", emp: "260", acct: "357" };
        const vis = (window.OCSecure.leerPinsVisibles && window.OCSecure.leerPinsVisibles()) || {};
        const take = function (remotoPin, localPin, fijar, rolAbre) {
          const p = String(remotoPin || "");
          if (!/^\d{3}$/.test(p) || p === "456") return;
          const fab = fabrica[rolAbre === "dueno" ? "owner" : (rolAbre === "empleado" ? "emp" : "acct")];
          let abrePin = "";
          try {
            const abre = (window.OCSecure.leerPinQueAbre && window.OCSecure.leerPinQueAbre()) || {};
            abrePin = rolAbre === "dueno" ? (abre.owner || "") : (rolAbre === "empleado" ? (abre.emp || "") : (abre.acct || ""));
          } catch (_) {}
          const local = String(localPin || abrePin || "");
          /* FIX (JFC 2026-09-15): 888 es un PIN de dueño LIBRE y VÁLIDO (ver el
             esquema en ~1621: 789=fábrica, 456=demo; 888 lo usan los usuarios,
             p.ej. Sarah/idiomARTE). Antes se trataba 888 como PIN de fábrica, así
             que NO se protegía como "custom" y un merge de otro aparato podía
             SOBREESCRIBIR el 888 del dueño -> Sarah quedaba sin su PIN y le salía
             demo. Ahora 888 cuenta como custom (se protege) y un 888 remoto SÍ se
             adopta (es un PIN real, no fábrica). Solo 789 es fábrica. */
          const localEsCustom = !!(local && local !== fab && local !== "456");
          const remotoEsFabrica = (p === fab);
          /* Sidecar: el PIN del cuaderno TAMBIEN abre, sin borrar el de este aparato.
             FIX (JFC 2026-09-15): antes eq.owner = p PISABA el sidecar del dueño con
             el PIN remoto; si el dueño local usaba 888 (Sarah/idiomARTE) y llegaba
             un merge con otro PIN, se le borraba el 888. Ahora SOLO se rellena el
             sidecar cuando está vacío o es un PIN de sistema (fábrica/demo): un PIN
             custom real (p.ej. 888) NO se pisa. Así "no borra el de este aparato"
             de verdad. */
          try {
            const eq = (window.OCSecure.leerPinsEquipo && window.OCSecure.leerPinsEquipo()) || {};
            const _libre = function (v, fab) { return !v || v === fab || v === "456"; };
            if (rolAbre === "dueno") { if (_libre(eq.owner, "789")) eq.owner = p; }
            else if (rolAbre === "empleado") { if (_libre(eq.emp, "260")) eq.emp = p; }
            else { if (_libre(eq.acct, "357")) eq.acct = p; }
            if (window.OCSecure.guardarPinsEquipo) window.OCSecure.guardarPinsEquipo(eq);
          } catch (_) {}
          if (localEsCustom) return;
          if (local === p) return;
          if (remotoEsFabrica) return;
          Promise.resolve(fijar(p)).then(function (ok) {
            if (ok && window.OCSecure.recordarPinQueAbre) window.OCSecure.recordarPinQueAbre(p, rolAbre);
          }).catch(function () {});
        };
        if (pr.owner && window.OCSecure.fijarOwnerPin) take(pr.owner, vis.owner, window.OCSecure.fijarOwnerPin, "dueno");
        const localEmp = (vis.empleados && vis.empleados[0]) || "";
        if (pr.emp && window.OCSecure.fijarEmpleadoPin) take(pr.emp, localEmp, window.OCSecure.fijarEmpleadoPin, "empleado");
        if (pr.acct && window.OCSecure.fijarAcctPin) take(pr.acct, vis.acct, window.OCSecure.fijarAcctPin, "contador");
      }
    } catch (_) {}
    /* Categorías (ver categoriasMeta). Gana la revisión mayor; una entrada
       nueva se agrega. Solo se reflejan en pantalla las que cambiaron. */
    // Ajustes del cuaderno (v359): hoy solo "impuesto". Gana la revisión mayor.
    if (Array.isArray(remoto.ajustes)) {
      remoto.ajustes.forEach((r) => {
        const m = _normMoneda(r);
        if (m) {
          _observarRev(m.rev);
          if (ajusteMoneda && _revDomina(m.rev, ajusteMoneda.rev) !== true) return;
          ajusteMoneda = m; actualizados++; return;
        }
        const n = _normImpuesto(r);
        if (!n) return;
        _observarRev(n.rev);
        if (ajusteImpuesto && _revDomina(n.rev, ajusteImpuesto.rev) !== true) return;
        ajusteImpuesto = n; actualizados++;
      });
    }
    if (Array.isArray(remoto.categorias)) {
      const cambiosCat = [];
      remoto.categorias.forEach((r) => {
        if (!r || !r.id || _CAT_ESTADOS.indexOf(r.estado) === -1) return;
        const id = String(r.id).trim().toLowerCase();
        if (!id) return;
        _observarRev(r.rev);
        const mia = categoriasMeta[id];
        if (mia && _revDomina(r.rev, mia.rev) !== true) return;
        categoriasMeta[id] = { id, nombre: String(r.nombre || id).slice(0, 120), estado: r.estado, rev: r.rev || null };
        cambiosCat.push(categoriasMeta[id]);
      });
      if (cambiosCat.length) { _reflejarCategoriasEnListas(cambiosCat); actualizados += cambiosCat.length; }
    }
    mov("merge-catalogo", { perchasAgregadas: agregadasU, productosAgregados: agregadosP, actualizados: actualizados, miembrosAgregados, miembrosActualizados, miembrosQuitados, clientesAgregados, desde: remoto.deviceNombre || "another device" });
    guardarEstadoLocal();
    // Ambos caminos de sync (Yjs y realtime) pasan por aquí. Una baja debe
    // cerrar sesiones abiertas aunque no haya altas ni ediciones en el lote.
    if (miembrosAgregados || miembrosActualizados || miembrosQuitados) {
      try { window.dispatchEvent(new CustomEvent("oc-equipo-sync", { detail: { miembrosAgregados, miembrosActualizados, miembrosQuitados } })); } catch (_) {}
    }
    /* HIDRATAR FOTOS TRAS SINCRONIZAR EL CATALOGO (v305). Arregla la CARRERA: el
       blob de la foto llega por el canal -fotos y el fotoHash del producto por el
       -y; si el blob llega ANTES de que el producto tenga su fotoHash, la
       hidratacion (en volcarFotosAlStore) no encuentra a quien ponersela y no se
       reintenta -> la foto no aparecia en la PC. Ahora, cada vez que el catalogo
       sincroniza (el producto ya tiene fotoHash), se intenta poner p.foto desde el
       blob ya guardado en OCFotos. */
    try { if (window.OCSync && window.OCSync.hidratarFotosProductos) window.OCSync.hidratarFotosProductos(); } catch (_) {}
    return { ok: true, agregadasU, agregadosP, actualizados, ventasAgregadas, miembrosAgregados, miembrosActualizados, miembrosQuitados, clientesAgregados, promotorasAgregadas, sucursalesAgregadas, huella: huellaCatalogo() };
  }

  /* ===================================================================
     CAMBIO DE TIENDA — multi-tienda local (JFC 2026-08-26).
     Poner una licencia = volverse ESA tienda y quedarse ahí. Cada tienda
     guarda su estado aparte (namespace por sufijo). Cambiar de tienda
     flushea la actual, apunta el marcador a la otra y recarga. Nada se
     borra: volver a una tienda anterior restaura sus datos intactos.
     El registro f123_tiendas mapea licencia -> sufijo para poder regresar
     a cualquiera con solo volver a poner su licencia (incluida la propia,
     cuyo sufijo es ""). =============================================== */
  function _normLic(c) { return String(c || "").trim().toUpperCase().replace(/\s+/g, ""); }
  function _licenciaPropia() {
    // v358 (#14): la licencia propia es SOLO la del aparato; el atajo de la
    // "licencia canónica del lord" se retiró (ver RETIRO DEL LORD arriba).
    try { const o = JSON.parse(localStorage.getItem("f123_owned") || "null"); return o && o.licenseCode ? _normLic(o.licenseCode) : ""; } catch (_) { return ""; }
  }
  function _licenciaActual() {
    // La licencia de la tienda activa: si hay sufijo "::L", es L; si no, la propia.
    return OC_STATE_SUFIJO ? OC_STATE_SUFIJO.slice(2) : _licenciaPropia();
  }
  window.OCTienda = {
    licenciaActual: _licenciaActual,
    /* ¿La tienda activa es una UNIDA (sufijo con licencia) o la propia (sufijo "")?
       Lo usa la pantalla de PIN para rotular a QUÉ tienda estás entrando sin
       tocar el camino de la tienda propia (cliente en vivo). (JFC 2026-08-26) */
    esUnida() { return !!OC_STATE_SUFIJO; },
    /* Nombre de la tienda ACTIVA (namespaceado, en memoria). "" si aún no tiene
       nombre (tienda unida recién creada que todavía no sincronizó). */
    nombreActivo() { try { return nombreNegocio || ""; } catch (_) { return ""; } },
    /* Cambia la app a la tienda de la licencia dada. Devuelve
       { ok, cambiado, mismo } sin recargar si ya estás en esa tienda. */
    cambiar(licencia, opts) {
      const norm = _normLic(licencia);
      if (!norm) return { ok: false, error: "Empty license." };
      /* A5 (2026-08-27): opción sinRecargar para que reconciliar() (claim/merge)
         pueda alinear el namespace de tienda SIN recargar — el merge add-only
         ocurre en memoria al reconectar, y recargar aquí vaciaría el estado
         local que el merge debe sumar. El resto del flujo es idéntico. */
      const sinRecargar = !!(opts && opts.sinRecargar);
      /* JFC 2026-08-28 (bug de join): la tienda de la que se sale. Si el caller
         pasó `desde` (capturado ANTES de tocar licenseCode), se usa esa; si no,
         la activa actual. Sin esto, unirse()/reconciliar() que escriben
         licenseCode ANTES de cambiar() hacían que _licenciaPropia() devolviera
         el código NUEVO y sufDest siempre cayera a "" (la propia) → el switch
         de tienda NUNCA ocurría y el aparato mergeaba datos ajenos en su
         tienda propia (contaminación cruzada). */
      const desde = (opts && opts.desde) ? _normLic(opts.desde) : _licenciaActual();
      // Registro licencia -> sufijo.
      let reg = {};
      try { reg = JSON.parse(localStorage.getItem("f123_tiendas") || "{}") || {}; } catch (_) { reg = {}; }
      /* Guest licenses must not map to the own-store suffix "". That was the
         f123_tiendas corruption (P3W1D/JENF → ""). Own license MAY be "". */
      try {
        Object.keys(reg).forEach(function (k) {
          if (reg[k] === "" && _normLic(k) !== _licenciaPropia()) delete reg[k];
        });
      } catch (_) {}
      // Asegurar que la tienda ACTUAL esté registrada (para poder volver a ella).
      const licAct = desde;
      if (licAct && !(licAct in reg)) reg[licAct] = OC_STATE_SUFIJO;
      /* SUFIJO DESTINO por NAMESPACE, no por comparación de licencias (JFC
         2026-08-26). El bug: "misma tienda" se decidía con norm===_licenciaActual(),
         que depende de f123_owned.licenseCode — un dato frágil que puede no
         reflejar el namespace real. Resultado: aceptaba la licencia pero NO
         cambiaba de tienda. Ahora:
           - si la licencia es la de la tienda en la que YA estás (`desde`),
             sufijo = el ACTIVO (mismo:true, no recarga);
           - si no, y ya está registrada, se usa su sufijo;
           - si no, una tienda nueva namespaceada "::<lic>".
         Y "misma tienda" = el sufijo DESTINO es el MISMO que el ACTIVO. Así una
         licencia distinta SIEMPRE cambia de tienda.

         PRECEDENCIA DE LA LICENCIA PROPIA (JFC 2026-08-26, hallazgo del arnés de
         dos aparatos). ANTES el registro se consultaba PRIMERO: si tu propia
         licencia tenía una entrada vieja en f123_tiendas apuntando a una tienda
         unida ("::L") —basura de un join anterior—, esa entrada GANABA y te
         mandaba a la tienda namespaceada en vez de a TU CASA. Tu tienda propia
         debe ser siempre alcanzable como propia, pase lo que pase con el registro.
         Por eso "¿es mi licencia propia?" se evalúa ANTES que el registro.
         JFC 2026-08-28 (bug de join): la comparación se hace contra `desde` (la
         tienda de la que se sale, capturada antes de tocar licenseCode), NO
         contra _licenciaPropia(). unirse()/reconciliar() escriben licenseCode
         ANTES de cambiar(); si se comparara contra _licenciaPropia() (que ya
         devuelve el código NUEVO), sufDest siempre caería a "" y el switch de
         tienda nunca ocurriría. Con `desde`, unirse a una licencia distinta
         cambia a "::<lic>" (namespace aparte, sin pisar la tienda propia). */
      /* PRECEDENCIA DE LA LICENCIA PROPIA (JFC 2026-09-15, RESTAURADA). El
         comentario de arriba dice que "¿es mi licencia propia?" debe evaluarse
         ANTES que el registro, pero el CÓDIGO lo había perdido (quedó solo
         norm===desde). Consecuencia: al entrar tu propia licencia canónica caías
         a un namespace "::<lic>" VACÍO en vez de a TU cuaderno real (legacy ""),
         y veías "entro y sale vacío". Regla dura: una licencia = un cuaderno; tu
         casa es SIEMPRE "" y NO se mueve data. reconciliar()/unirse() escriben
         ow.licenseCode=norm ANTES de llamar aquí, así que cuando norm es tu
         licencia canónica _licenciaPropia() ya la devuelve y esta rama la ancla a
         "" (mismo:true, sin switch ni movimiento de data). */
      let sufDest;
      if (norm === _licenciaPropia()) sufDest = OC_STATE_SUFIJO; // mi casa: quedarme en el cajón con data (elegido al arrancar), nunca forzar "" vacío
      else if (norm === desde) sufDest = OC_STATE_SUFIJO;        // ya estoy en esa tienda
      else if (norm in reg) sufDest = reg[norm];                 // tienda unida ya conocida
      else sufDest = "::" + norm;                                // tienda ajena nueva
      reg[norm] = sufDest;
      try { localStorage.setItem("f123_tiendas", JSON.stringify(reg)); } catch (_) {}
      if (sufDest === OC_STATE_SUFIJO) {
        return { ok: true, cambiado: false, mismo: true };
      }
      // Flush de la tienda actual bajo SUS claves antes de cambiar el marcador.
      try { guardarEstadoLocal(); } catch (_) {}
      try { localStorage.setItem("f123_tienda_activa", sufDest); } catch (_) {}
      /* FIJAR LA SALA DE LA TIENDA DESTINO (JFC 2026-08-26, NB-1). CRÍTICO:
         cada tienda sincroniza en SU PROPIA sala (= su licencia). ROOM_KEY es
         global; si no la re-apuntamos al cambiar, la tienda destino heredaría la
         sala de la tienda anterior y sincronizaría en la sala equivocada
         (contaminación cruzada entre negocios). fijarSala normaliza igual que
         activar y NO conecta (el reload de abajo reconecta a la sala correcta).
         Se hace SIEMPRE (también al volver a la tienda propia) para que ROOM_KEY
         siga siempre a la tienda activa. Fail-safe: si el módulo de sync no está,
         se deja ROOM_KEY como estaba (comportamiento previo). */
      try {
        if (window.OCSyncControl && window.OCSyncControl.fijarSala) {
          window.OCSyncControl.fijarSala(norm);
        }
      } catch (_) {}
      // Recargar: en el boot el sufijo ya será el de la tienda destino.
      if (!sinRecargar) { try { location.reload(); } catch (_) {} }
      return { ok: true, cambiado: true };
    },
    /* CLAIM / MERGE DE DISPOSITIVOS PROPIOS (JFC 2026-08-27). Deja los TRES
       campos de identidad (licenseCode, syncCode, sala de sync) en el MISMO
       código, sin tocar los datos locales (NO vacía). Arregla el "mismatch"
       (licenseCode vs syncCode vs sala) y es la base del claim: el aparato
       queda como device de esa licencia canónica. El merge de datos ocurre
       después, add-only, cuando ambos aparatos apuntan a la misma sala y
       reconectan. */
    reconciliar(licencia) {
      const norm = _normLic(licencia);
      if (!norm) return { ok: false, error: "Empty license." };
      /* JFC 2026-08-28 (bug de join): capturar la tienda de la que se sale ANTES
         de escribir licenseCode, y pasarla a cambiar() para que el destino sea
         correcto (mismo bug que unirse()). */
      const _desde = _licenciaActual();
      try {
        const ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
        ow.licenseCode = norm;
        ow.syncCode = norm;              // la cajita de compartir deja de mostrar residuo
        localStorage.setItem("f123_owned", JSON.stringify(ow));
        if (ow.instanceId) localStorage.setItem("f123_join_pending_v1", JSON.stringify({ instanceId: ow.instanceId, licenseCode: norm }));
      } catch (_) {}
      try { if (window.OCSyncControl && window.OCSyncControl.fijarSala) window.OCSyncControl.fijarSala(norm); } catch (_) {}
      /* A5 (2026-08-27, auditoría de integridad): alinear el NAMESPACE de tienda
         con la licencia canónica. Antes solo se fijaba la sala de sync; el
         f123_tienda_activa quedaba apuntando al namespace viejo → el aparato
         quedaba "partido" (identidad canónica pero tienda activa vieja) y el
         merge posterior aterrizaba en el namespace equivocado. cambiar() registra
         la tienda actual, flushea sus datos bajo sus claves, apunta
         f123_tienda_activa al namespace de la canónica y fija la sala. sinRecargar:
         el merge add-only ocurre en memoria al reconectar; recargar aquí vaciaría
         el estado local que el merge debe sumar. */
      try {
        if (window.OCTienda && window.OCTienda.cambiar) window.OCTienda.cambiar(norm, { sinRecargar: true, desde: _desde });
      } catch (_) {}
      // NO se llama a _vaciarTiendaFresca(): los datos locales se conservan para que
      // el merge posterior los sume a la tienda canónica.
      try { if (window.OCSyncControl && window.OCSyncControl.resincronizar) window.OCSyncControl.resincronizar(); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent("oc-negocio-actualizado", { detail: {} })); } catch (_) {}
      return { ok: true, licencia: norm };
    },
  };

  window.OCSync = {
    conflictosEquipo: () => conflictosEquipo.map((x) => ({ id: x.id, nombre: x.nombre, fecha: x.fecha })),
    /* FOTO DE PRODUCTO POR HASH (JFC 2026-09-16). Antes solo las PERCHAS
       sincronizaban foto (por hash). Los productos guardaban la foto INLINE
       (p.foto), que no viajaba -> la foto de "Test sync unificado" salia en el
       celu pero no en la PC. Estas dos funciones cierran el hueco reusando OCFotos:
       - hashearFotosProductos(): para cada producto con foto inline y sin fotoHash,
         calcula el hash, guarda los bytes en OCFotos y pone p.fotoHash. Asi la foto
         viaja por el canal de fotos (como las perchas) y el catalogo solo lleva el
         puntero. Corre al arrancar y cuando cambia una foto.
       - hidratarFotosProductos(): en el receptor, cuando ya bajaron los bytes,
         pone p.foto = OCFotos[fotoHash] para los productos que tienen puntero pero
         no bytes inline, para que la UI (que pinta p.foto) los muestre. */
    async hashearFotosProductos() {
      if (!window.OCFotos || !window.OCFotos.hashDeDataUrl) return 0;
      let n = 0;
      for (const p of productos) {
        try {
          if (p && p.foto && String(p.foto).indexOf("data:") === 0 && !p.fotoHash) {
            // Hash and bytes must describe the SAME snapshot. A user can replace
            // or remove the photo while either asynchronous operation is pending.
            const foto = p.foto;
            const h = await window.OCFotos.hashDeDataUrl(foto);
            if (h) {
              await window.OCFotos.guardarPorHash(h, foto);
              if (productos.includes(p) && p.foto === foto && !p.fotoHash) { p.fotoHash = h; n++; }
            }
          }
        } catch (_) {}
      }
      if (n) { try { guardarEstadoLocal(); avisarCatalogoCambiado(); } catch (_) {} }
      return n;
    },
    async hidratarFotosProductos() {
      if (!window.OCFotos || !window.OCFotos.leerPorHash) return 0;
      let n = 0;
      for (const p of productos) {
        try {
          if (p && p.fotoHash && !p.foto) {
            const hash = p.fotoHash;
            const d = await window.OCFotos.leerPorHash(hash);
            // Do not restore a removed image, overwrite a newer edit, or write
            // into a record belonging to the store before an import/shop change.
            if (d && productos.includes(p) && p.fotoHash === hash && !p.foto) { p.foto = d; n++; }
          }
        } catch (_) {}
      }
      if (n) { try { guardarEstadoLocal(); } catch (_) {} try { window.dispatchEvent(new CustomEvent("oc-fotos-actualizadas")); } catch (_) {} }
      return n;
    },
    /* borradores.js avisa cada cambio de categoría (alta, renombre, borrado,
       ocultar, mostrar). Se sella con revisión y se publica al sync. */
    /* Clave de localStorage de una lista de categorías para el cuaderno activo
       (v347). borradores.js la usa para leer/guardar en el mismo lugar. */
    claveCategorias(base) { return _catKey(base); },
    marcarCategoria(nombre, estado) {
      try {
        const nom = String(nombre || "").trim();
        if (!nom || _CAT_ESTADOS.indexOf(estado) === -1) return false;
        const id = nom.toLowerCase();
        categoriasMeta[id] = { id, nombre: nom.slice(0, 120), estado, rev: _revNueva() };
        guardarEstadoLocal();
        avisarCatalogoCambiado();
        return true;
      } catch (_) { return false; }
    },
    /* Catalogo propio para mandarselo a un companero de equipo. Solo lo que
       DEFINE el catalogo: ni ventas, ni clientes, ni stock. */
    catalogoPropio() {
      _sembrarCategoriasLegado(); // categorías de antes de v344: revisión mínima
      return {
        ubicaciones: ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activa: u.activa, sucursalId: u.sucursalId, promotoraId: u.promotoraId || null, comisionSocio: u.comisionSocio, metaMensual: u.metaMensual, minimoGarantizado: u.minimoGarantizado, contribFija: u.contribFija, escalasComision: u.escalasComision || [], esFeria: !!u.esFeria, esEvento: !!u.esEvento, lecturaPreferida: u.lecturaPreferida || "asociado", usarComisionPropia: !!u.usarComisionPropia, fotoHash: u.fotoHash || null, rev: u.rev || null, borrado: !!u.borrado, gastoMensual: Number(gastosMensuales[u.id]) || 0, gastoMensualRev: u.gastoMensualRev || null })),
        // NO PUBLICAR SEMILLA DEMO (v297, JFC 2026-09-16). Los productos de ejemplo
        // tienen id "p"+DIGITOS (p01..p66); los reales son "p"+UUID (con guiones).
        // Filtrar aqui evita que un aparato con demo re-contamine la sala (add-only
        // no borra; la unica defensa robusta es no publicarla NI adoptarla).
        productos: productos.filter((p) => p && !/^p\d+$/.test(String(p.id || ""))).map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku, barcode: p.barcode, categoria: p.categoria, precio: p.precio, precioCasa: (p.precioCasa == null ? null : p.precioCasa), costo: p.costo, ubicacionId: p.ubicacionId, umbralRojo: p.umbralRojo, umbralAmarillo: p.umbralAmarillo, perecible: p.perecible, exentoImpuesto: !!p.exentoImpuesto, fechaCaducidad: p.fechaCaducidad,
          /* STOCK EN EL SYNC NUEVO (JFC 2026-09-16, aprobado). Antes el stock NO
             viajaba (era "hecho fisico de cada percha"). Ahora es un cuaderno
             COMPARTIDO: el stock cruza con LWW por stockTs (sello de la ultima
             edicion de stock). Ver aplicarCatalogo y emitirOpStock. */
          stockActual: Math.max(0, Number(p.stockActual) || 0), stockTs: Number(p.stockTs) || 0,
          stockBase: p.stockBase != null && Number.isFinite(Number(p.stockBase)) ? Number(p.stockBase) : null,
          stockPN: p.stockPN && typeof p.stockPN === "object" ? p.stockPN : null,
          /* FOTO DE PRODUCTO POR HASH (JFC 2026-09-16). La foto NO viaja inline
             (un dataURL de ~180KB reventaria el frame del catalogo al agrupar
             varios). Viaja solo el puntero fotoHash; los bytes van por el canal de
             fotos (mismo camino que las perchas). El receptor resuelve la foto
             desde OCFotos por ese hash. Ver sembrarFotosAlRelay (productos) y la
             hidratacion en volcarFotosAlStore. */
          fotoHash: p.fotoHash || null, rev: p.rev || null, borrado: !!p.borrado, proveedor: p.proveedor || "", metodoCosteo: p.metodoCosteo || "FIFO", tipoProveedor: p.tipoProveedor || "compra", tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, comisionProveedorPct: p.comisionProveedorPct || 0, comisionistaId: p.comisionistaId || null, chip: p.chip || "", familiaId: p.familiaId || "", productoBaseId: p.productoBaseId || null, varianteAtributo: p.varianteAtributo || "", varianteValor: p.varianteValor || "", archivado: !!p.archivado })),
        /* EL EQUIPO VIAJA CON EL CATALOGO (JFC 2026-08-21).
           BUG DE RAIZ que provoco tres quejas distintas de usuarios reales:
           `usuarios` (nombre, PIN, rol, activo) era estado LOCAL de cada
           dispositivo y NUNCA se propagaba. Consecuencias medidas:
             - el PIN de admin creado en la PC no existia en el celular
               ("no me deja actualizar con el PIN de admin desde otro
               dispositivo");
             - degradar a alguien parecia no funcionar: el PATCH si cambiaba
               el rol, pero solo en el aparato donde se hacia;
             - sincronizar con el codigo del negocio no lo arreglaba, porque
               el merge solo llevaba perchas y productos.
           El PIN viaja porque ES la credencial de acceso del equipo: sin el,
           la persona no puede entrar en el segundo dispositivo, que es
           justamente lo que se rompio. Va por el mismo canal cifrado que
           todo lo demas y nunca sale de los dispositivos del negocio. */
        usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.nombre, pin: u.pin, rol: u.rol, email: u.email || null, activo: u.activo !== false, creadoEn: u.creadoEn, actualizadoEn: u.actualizadoEn || u.creadoEn || null, rev: u.rev || null, borrado: !!u.borrado })),
        /* CLIENTES (JFC 2026-08-26). Bug de Belén: "clientes default, no los reales".
           Eran estado local que nunca se propagaba. Viajan por el mismo canal
           cifrado device-to-device, merge add-only en aplicarCatalogo. */
        clientes: clientes.map((c) => ({ id: c.id, codigo: c.codigo || "", nombre: c.nombre, telefono: c.telefono || "", email: c.email || "", notas: c.notas || "", rangoEdad: c.rangoEdad || "", pais: c.pais || "", despedido: !!c.despedido, borrado: !!c.borrado, rev: c.rev || null, evaluacion: c.evaluacion || null })),
        /* COMISIONISTAS + SUCURSALES viajan con el catálogo (JFC 2026-09-10, "sync
           integral"). Add-only en aplicarCatalogo: nunca se pisa una comision. */
        promotoras: promotoras.map((p) => ({ id: p.id, nombre: p.nombre, comisionBase: p.comisionBase, comision: p.comision, telefono: p.telefono || "", cedula: p.cedula || "", banco: p.banco || "", cuenta: p.cuenta || "", direccion: p.direccion || "", notas: p.notas || "", activa: p.activa !== false, metaMensual: p.metaMensual || 0, escalasComision: Array.isArray(p.escalasComision) ? p.escalasComision : [], rev: p.rev || null, borrado: !!p.borrado })),
        sucursales: sucursales.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa !== false, rev: s.rev || null, borrado: !!s.borrado })),
        // Configuración de categorías (propias vacías y ocultas). Ver categoriasMeta.
        categorias: Object.keys(categoriasMeta).map((k) => Object.assign({}, categoriasMeta[k])),
        ajustes: [ajusteImpuesto, ajusteMoneda].filter(Boolean).map((a) => Object.assign({}, a)),
        /* VENTAS (dinero) POR EL SYNC NUEVO (JFC 2026-09-16, aprobado). Cada venta
           viaja ADD-ONLY por id (sembrarVentasAlRelay la manda como op individual,
           no en el batch, para no reventar el frame). El receptor la SUMA una sola
           vez (ver aplicarCatalogo). No duplica plata; el stock es LWW aparte. */
        ventas: ventas.map((v) => ({ id: v.id, productoId: v.productoId, ubicacionId: v.ubicacionId, cantidad: v.cantidad, precioUnit: v.precioUnit, costoUnit: v.costoUnit, fecha: v.fecha, split: v.split || null, liquidada: !!v.liquidada, clienteId: v.clienteId || null, info: v.info || null, anulada: !!v.anulada, impuesto: v.impuesto || null, rev: v.rev || null })),
        gastos: gastos.map((g) => Object.assign({}, g)),
        transferencias: transferencias.map((t) => Object.assign({}, t)),
        /* DISPOSITIVOS (apodos) POR EL SYNC NUEVO (v298). Este aparato publica SU
           propia entrada {id,apodo,rol}; el dueño de la entrada es autoritativo. Se
           mergea en aplicarCatalogo alimentando la lista de micelio. Estable (no
           cambia salvo que se renombre el aparato), así que no genera tráfico. */
        dispositivos: (function () {
          try {
            // instanceId identifica el alta/licencia, no al nodo del micelio.
            // Publicarlo como key hacía colisionar dos aparatos con la misma
            // identidad restaurada y podía mostrar el apodo del PC en el móvil.
            var _yo = (window.OCMicelio && window.OCMicelio.yo) ? window.OCMicelio.yo() : null;
            if (!_yo || !_yo.id) return [];
            var _ap = (window.OCMicelio && window.OCMicelio.miApodo) ? (window.OCMicelio.miApodo() || "") : "";
            var _rol = (window.OCAuth && window.OCAuth.rolActual) ? (window.OCAuth.rolActual() || "") : "";
            return [{ id: String(_yo.id), apodo: String(_ap).slice(0, 28), rol: _rol }];
          } catch (_) { return []; }
        })(),
        /* NOMBRE DE LA TIENDA VIAJA CON EL CATÁLOGO (JFC 2026-08-27 + 2026-08-28).
           Era estado local (nombreNegocio) que nunca se propagaba. Ahora viaja; el
           receptor lo adopta si el suyo está vacío o si el remitente es el dueño
           (mayor jerarquía) — ver aplicarCatalogo. */
        nombreNegocio: nombreNegocio || "",
        nombreNegocioTs: nombreNegocioTs || 0, // desempate secundario
        nombreNegocioRev: nombreNegocioRev || 0, // desempate PRIMARIO (monotónico, v290)
        pinsRol: (function () {
          try {
            const abre = (window.OCSecure && window.OCSecure.leerPinQueAbre) ? (window.OCSecure.leerPinQueAbre() || {}) : {};
            const vis = (window.OCSecure && window.OCSecure.leerPinsVisibles) ? (window.OCSecure.leerPinsVisibles() || {}) : {};
            return {
              owner: abre.owner || vis.owner || "",
              emp: abre.emp || ((vis.empleados && vis.empleados[0]) || ""),
              acct: abre.acct || vis.acct || ""
            };
          } catch (_) { return {}; }
        })(),
        huella: huellaCatalogo(),
      };
    },
    /* CHECKPOINT PARA LA BITACORA CIFRADA (JFC 2026-08-25). A diferencia de
       catalogoPropio(), el checkpoint SI lleva el stock absoluto: es la foto que
       deja a un dispositivo NUEVO ver la tienda —con sus cantidades reales—
       aunque no haya nadie en linea. Viaja cifrado; el relay solo guarda el
       sobre cerrado. */
    estadoParaCheckpoint() {
      return {
        nombreNegocio: nombreNegocio || "", // B3 (2026-08-28): el nombre también viaja en el checkpoint
        ubicaciones: ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activa: u.activa, sucursalId: u.sucursalId, comisionSocio: u.comisionSocio, metaMensual: u.metaMensual, minimoGarantizado: u.minimoGarantizado, contribFija: u.contribFija, esEvento: u.esEvento, esFeria: u.esFeria, lecturaPreferida: u.lecturaPreferida, escalasComision: u.escalasComision, usarComisionPropia: u.usarComisionPropia })),
        productos: productos.map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku, barcode: p.barcode, categoria: p.categoria, precio: p.precio, precioCasa: (p.precioCasa == null ? null : p.precioCasa), costo: p.costo, ubicacionId: p.ubicacionId, umbralRojo: p.umbralRojo, umbralAmarillo: p.umbralAmarillo, perecible: p.perecible, exentoImpuesto: !!p.exentoImpuesto, fechaCaducidad: p.fechaCaducidad, tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, estrella: !!p.estrella, stockActual: Math.max(0, Number(p.stockActual) || 0), familiaId: p.familiaId || "", productoBaseId: p.productoBaseId || null, varianteAtributo: p.varianteAtributo || "", varianteValor: p.varianteValor || "" })),
        usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.nombre, pin: u.pin, rol: u.rol, email: u.email || null, activo: u.activo !== false, creadoEn: u.creadoEn, actualizadoEn: u.actualizadoEn || u.creadoEn || null, rev: u.rev || null, borrado: !!u.borrado })),
        clientes: clientes.map((c) => ({ id: c.id, codigo: c.codigo || "", nombre: c.nombre, telefono: c.telefono || "", email: c.email || "", evaluacion: c.evaluacion || null })), // JFC 2026-08-26: el checkpoint también lleva clientes para el dispositivo nuevo
        huella: huellaCatalogo(),
      };
    },
    /* Restaura un checkpoint — SOLO en un dispositivo FRESCO, definido como uno
       que NUNCA registro una venta propia (ventas.length === 0). Asi es
       imposible que pise el stock real de una caja activa: si ya hubo ventas
       aqui, este dato manda y el checkpoint se ignora. En un dispositivo fresco
       AGREGA perchas y productos CON su stock, y mergea el equipo (add-only).
       Los productos que ya existan (p. ej. llegados con stock 0 por el catalogo
       en vivo) reciben su stock real del checkpoint. */
    aplicarCheckpoint(snap) {
      try {
        if (!snap || !Array.isArray(snap.productos) || !Array.isArray(snap.ubicaciones)) return { ok: false, motivo: "ilegible" };
        /* B3 (2026-08-28): el nombre de la tienda también llega por checkpoint.
           Se adopta si el local está vacío (un dispositivo nuevo no tiene nombre
           propio). El checkpoint no lleva rol del remitente, así que aquí no se
           aplica la regla "el dueño gana" — esa corre por el catálogo en vivo. */
        if (snap && typeof snap.nombreNegocio === "string" && snap.nombreNegocio.trim() && !String(nombreNegocio || "").trim()) {
          nombreNegocio = snap.nombreNegocio.trim().slice(0, 80);
          try {
            const _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
            _ow.nombreNegocio = nombreNegocio;
            localStorage.setItem("f123_owned", JSON.stringify(_ow));
          } catch (_) {}
          try { window.dispatchEvent(new CustomEvent("oc-negocio-actualizado", { detail: { nombre: nombreNegocio } })); } catch (_) {}
        }
        /* MERGE ADD-ONLY EN CUALQUIER APARATO (JFC 2026-08-26). BUG RAÍZ del
           "no sincroniza ni entre mi PC y mi cel": antes, si el aparato tenía UNA
           sola venta propia, el checkpoint ENTERO se ignoraba (return no-fresco) —
           así dos aparatos que ya tenían datos jamás se pasaban perchas/productos/
           clientes. Ahora SIEMPRE se agrega lo que falta (add-only, nunca pisa lo
           existente). Lo ÚNICO que se cuida por frescura es el STOCK: un aparato
           con ventas propias NO adopta el stock del checkpoint (podría estar viejo);
           su stock lo manda su propia caja. Add-only es seguro: nunca borra ni
           sobrescribe un ítem que ya existe aquí. */
        const fresco = ventas.length === 0;
        let agP = 0, agPr = 0, agC = 0;
        snap.ubicaciones.forEach((u) => {
          if (!u || !u.id) return;
          if (!ubicaciones.some((x) => String(x.id) === String(u.id))) {
            ubicaciones.push(Object.assign({}, u, { activa: u.activa !== false }));
            if (!(u.id in gastosMensuales)) gastosMensuales[u.id] = 0;
            agP++;
          }
        });
        snap.productos.forEach((p) => {
          if (!p || !p.id) return;
          const stk = Math.max(0, Number(p.stockActual) || 0);
          const mio = productos.find((x) => String(x.id) === String(p.id));
          if (!mio) { productos.push(Object.assign({}, p, { stockActual: fresco ? stk : 0 })); agPr++; } // producto del equipo; el stock solo si soy fresco
          else if (fresco && (Number(mio.stockActual) || 0) === 0 && stk > 0) { mio.stockActual = stk; }
        });
        /* CLIENTES del checkpoint (add-only) — antes NO se aplicaban NUNCA, ni en
           aparato fresco. Por eso los clientes reales no llegaban al segundo aparato. */
        if (Array.isArray(snap.clientes)) {
          snap.clientes.forEach((c) => {
            if (!c || !c.id || !c.nombre) return;
            if (!clientes.some((x) => String(x.id) === String(c.id))) {
              clientes.push({ id: c.id, codigo: c.codigo || "", nombre: String(c.nombre).slice(0, 80), telefono: c.telefono || "", email: c.email || "", evaluacion: (c.evaluacion && typeof c.evaluacion === "object") ? c.evaluacion : { trato: 0, confiabilidad: 0, historial: [] } });
              agC++;
            }
          });
        }
        if (Array.isArray(snap.usuarios)) {
          try { aplicarCatalogo({ ubicaciones: [], productos: [], usuarios: snap.usuarios }, null); } catch (_) {}
        }
        guardarEstadoLocal();
        mov("checkpoint-mergeado", { perchas: agP, productos: agPr, clientes: agC, fresco });
        return { ok: true, productos: agPr, perchas: agP, clientes: agC };
      } catch (_) { return { ok: false, motivo: "error" }; }
    },
    compararCatalogo,
    aplicarCatalogo,
    /* EL EQUIPO SE SINCRONIZA SOLO (JFC 2026-08-21).
       Por que ESTO si se aplica sin preguntar, cuando el catalogo NO:
       el catalogo son precios y costos —plata— y sobre plata no se adivina.
       El equipo son las CREDENCIALES DE ACCESO, y el bug que llego de
       produccion es que la gente quedaba FUERA de su propio cuaderno: el
       admin creado en la PC no podia entrar desde el celular. Pedirle a
       alguien que confirme un dialogo para poder entrar no sirve cuando el
       problema es justamente que no puede entrar.
       Es seguro porque este aplicador NUNCA borra ni degrada por su cuenta:
       suma miembros y aplica ediciones mas recientes, con el mismo criterio
       que el merge manual, y todo queda anotado en movimientos. */
    aplicarEquipoRemoto(lista) {
      if (!Array.isArray(lista) || !lista.length) return { ok: false };
      return aplicarCatalogo({ ubicaciones: [], productos: [], usuarios: lista }, null);
    },
    /* La huella de ESTE dispositivo. La usan el latido del micelio, el panel
       del equipo y el codigo TEAM- al compartirse. */
    huella: huellaCatalogo,
    // Llamado por sync-realtime.js al recibir un Op de otro dispositivo. Si
    // el resultado queda negativo, se deja ver (mov "alerta-descuadre") en
    // vez de esconderlo: eso es un sobrante real que ocurrio en el mundo
    // fisico, no un bug. Si es una venta remota, TAMBIEN crea la fila en
    // `ventas` con su split de comision — sin esto, la comision de percha
    // quedaba invisible en cualquier dispositivo que no fuera el vendedor.
    aplicarOpRemota(op) {
      if (!op || !op.opId || !op.tipo || !op.payload) return { ok: false, error: "Invalid op" };
      const vistos = _cargarOpsAplicadas();
      if (vistos.has(op.opId)) return { ok: true, repetida: true };
      /* NEUTRALIZADO (JFC 2026-09-16, v293) — EVITA DOBLE CONTEO DE PLATA/STOCK.
         El stock y las ventas ahora los aplica el SYNC NUEVO (catálogo Yjs):
         stock por LWW ABSOLUTO (stockTs, v289) y ventas ADD-ONLY por id (v292).
         Si este puente (sync viejo / opsDoc) TAMBIÉN aplicara el delta y creara la
         venta, la misma venta entraría DOS veces (aquí con uuid nuevo + por el
         catálogo con su id real) y el stock se descontaría doble -> descuadre.
         Por eso queda como NO-OP idempotente: solo marca el opId como visto.
         DORMANT, NO BORRAR: para revertir al modelo de ops, quitar este bloque.
         El código de abajo (aplicaba delta + creaba venta) queda intacto pero
         inalcanzable a propósito. */
      if (localStorage.getItem("f123_ops_delta_activo") !== "1") {
        _marcarOpAplicada(op.opId);
        return { ok: true, neutralizado: true };
      }
      const pl = op.payload;
      try {
        /* A3 (2026-08-28): respaldo por NOMBRE si el id no coincide. Dos
           dispositivos del mismo negocio pueden tener el mismo producto con ids
           distintos (creado por separado en cada uno). Antes el delta se
           descartaba en silencio ("That product does not exist") y la venta del
           celular no llegaba a la PC. Ahora, si no hay producto con ese id pero
           hay EXACTAMENTE UNO con ese nombre, se aplica ahí y se deja constancia
           en movimientos. Si hay dos con el mismo nombre, no se adivina. */
        let p = productos.find((x) => x.id === pl.productoId);
        if (!p && pl.nombre) {
          const _porNombre = productos.filter((x) => String(x.nombre || "").trim().toLowerCase() === String(pl.nombre).trim().toLowerCase());
          if (_porNombre.length === 1) {
            p = _porNombre[0];
            mov("alerta-id-producto", { producto: p.nombre, motivo: "El delta llegó con un id distinto; se aplicó por nombre (mismo producto en ambos dispositivos)." });
          }
        }
        if (!p) return { ok: false, error: "That product does not exist on this device (sync the catalog first)" };
        /* EL STOCK NO BAJA DE CERO (JFC 2026-08-21, reportado en produccion:
           "probe a sobrevender un item y quedo en -1 desde el celular").
           Antes se aplicaba el delta crudo y el negativo se dejaba ver a
           proposito, como senal de descuadre. En pantalla eso es un producto
           con -1 unidades, que no significa nada para quien lo lee y hace
           dudar de todo lo demas.
           No se pierde informacion: lo que no se pudo descontar queda en el
           movimiento "alerta-descuadre" de mas abajo, con la cantidad exacta.
           Vender mas de lo que hay solo tendra sentido cuando existan los
           pedidos por anticipado (ver APUNTE-PEDIDOS-ANTICIPADOS-2026-08-21.md);
           hasta entonces, cero es el piso. */
        const _antes = p.stockActual;
        p.stockActual = Math.max(0, p.stockActual + pl.delta);
        const _noDescontado = Math.max(0, -(_antes + pl.delta));
        if (op.tipo === "venta" && pl.delta < 0) {
          const cant = -pl.delta;
          const ubicP = ubicaciones.find((x) => x.id === p.ubicacionId);
          const montoBruto = p.precio * cant;
          const acumuladoPrevio = ubicP ? ventasMesAcumuladas(ubicP.id) : 0;
          const split = ubicP ? calcularSplitVenta(ubicP, montoBruto, acumuladoPrevio) : null;
          ventas.push({ id: uuid("v"), productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: p.precio, costoUnit: p.costo, fecha: op.fecha || new Date().toISOString(), split, liquidada: false, clienteId: null, impuesto: _impuestoDeVenta(p, p.precio, cant), origenRemoto: true });
        }
        mov(op.tipo + "-remoto", { producto: p.nombre, delta: pl.delta, dispositivo: op.deviceNombre || op.deviceId || "otro dispositivo" });
        if (_noDescontado > 0) mov("alerta-descuadre", { producto: p.nombre, stockActual: p.stockActual, faltaron: _noDescontado, motivo: "Dos dispositivos vendieron las mismas ultimas unidades casi a la vez. El stock quedo en 0: " + _noDescontado + " unidad(es) se vendieron sin existencia. Cuenta la percha." });
        _marcarOpAplicada(op.opId);
        guardarEstadoLocal();
        return { ok: true };
      } catch (err) { return { ok: false, error: String(err) }; }
    },
  };
  // === FIN PUENTE DE SYNC ======================================================

  const J = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });

  // Item 3 COMPLETO (2026-07-07): QR generado 100% local con qrcode-local.js
  // (Kazuhiko Arase, MIT, vendoreado en el repo — cero llamadas externas).
  // Si la librería no cargó, devuelve null y la UI omite el <img> sin romper.
  function qrDataUrl(payload) {
    try {
      if (!window.qrcode) return null;
      const q = window.qrcode(0, "M");
      q.addData(String(payload));
      q.make();
      return q.createDataURL(4, 8);
    } catch (_) { return null; }
  }

  // Al arrancar: si hay un estado persistido válido, reemplaza los datos
  // semilla (item 1 — persistencia local real).
  try { cargarEstadoLocal(); } catch (e) { console.error("Estado local corrupto (la app arranca con datos semilla):", e); }
  /* GUARD DEMO — NADIE QUE NO SEA DEMO VE STOCK DE EJEMPLO (JFC 2026-09-11).
     Bug real: en un navegador/PC nuevo la app arranca con la SEMILLA demo en
     memoria. Si el aparato está ACTIVADO (f123_owned con instanceId, o sea
     alguien ya aplastó 789/entró con su licencia) o entró a una tienda por
     licencia (OC_STATE_SUFIJO), pero el arranque no cargó ningún buffer real
     todavía (sin datos locales aún), esas arrays con ejemplo se quedaban y el
     "sync integral" mezclaba el catálogo REAL add-only encima -> demo + real
     revueltos (queja de JFC). Ahora: si es un aparato real y no cargó buffer,
     se vacía la semilla y la tienda arranca LIMPIA; solo se llena con lo que
     baje por sync/respaldo. El demo puro (456: sin f123_owned y sin sufijo) NO
     entra aquí y conserva su ejemplo. Solo puede vaciar la SEMILLA: los datos
     reales únicamente entran vía buffer cargado (que ya puso _cargoBufferReal)
     o vía sync (posterior a esto), así que esto jamás borra inventario real. */
  /* NO MOVER DATA (JFC 2026-09-15). Antes aquí vivía _autoRecuperarInventario(),
     que al arrancar escaneaba TODOS los namespaces del aparato y ADOPTABA el
     buffer con más productos a la tienda activa. Eso movía data entre namespaces
     y violaba la regla dura "no hay que mover nada". Se eliminó. La causa real del
     "entro y sale vacío" se ataca donde corresponde: normalizando el PUNTERO de
     tienda al arranque (arriba, junto a f123_tienda_activa) y restaurando la
     precedencia de licencia propia en cambiar() — el dueño aterriza en su cuaderno
     real ("") sin mover ni un buffer. */
  try {
    var _aparatoReal = false;
    try { _aparatoReal = !!((JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).instanceId); } catch (_) {}
    if (!_cargoBufferReal && (_aparatoReal || OC_STATE_SUFIJO)) {
      // Aparato real/unido sin NINGÚN buffer propio: solo tiene la SEMILLA de
      // ejemplo. Se vacía para que la tienda arranque limpia y se llene por
      // sync/respaldo. No se mueve ni se adopta data de otros namespaces.
      _vaciarTiendaFresca();
      console.warn("[guard-demo] aparato real sin buffer local: semilla de ejemplo vaciada, la tienda arranca limpia y se llena por sync.");
    }
  } catch (_) {}
  /* LIMPIEZA UNICA DE SEMILLA CONTAMINADA — SOLO LICENCIA JFC (2026-09-16, aprobado).
     La sala de la licencia canonica de JFC quedo con ~60 productos de SEMILLA
     (ids "p01".."pNN") mezclados con los reales. Aqui, SOLO en aparatos cuya
     licencia activa es EXACTAMENTE la de JFC (idiomARTE y cualquier otra licencia
     NO entran), se purgan del store local esos productos y sus ventas de ejemplo.
     Blindaje: (a) gated a la licencia exacta; (b) snapshot completo antes
     (f123_prelimpieza_jfc_v1, reversible); (c) SOLO ids de semilla: productos
     "^p\d+$" (los reales son "p"+UUID con guiones, no matchean) y ventas "^vs-"
     (las reales son "v"+UUID); (d) una sola vez (flag). El reseteo de la SALA para
     que el relay no re-llene se hace en sync-yjs (bump de sala gated a esta licencia). */
  try {
    // v303: gated al PREFIJO de la licencia de JFC (primeros 3 grupos), NO a la
    // cadena exacta. La PC quedaba sucia porque su licencia es una VARIANTE
    // (BF2A/B2FA, S2J24/S2324) que no coincidia exacto -> el purgado no corria.
    // El prefijo "F123-A6YK-6V1J-" cubre TODAS sus variantes y NO toca a idiomARTE
    // (F123-K7M2-...) ni a Dr Diego (F123-FK0Q-...), que pueden tener ids p\d+
    // legitimos. CADA arranque (auto-limpieza). Reales de JFC son p+UUID.
    var _PREFIJO_JFC = "F123-A6YK-6V1J-";
    var _licAct = String(_licenciaPropia() || "").trim().toUpperCase().replace(/\s+/g, "");
    if (_licAct.indexOf(_PREFIJO_JFC) === 0) {
      var _esSemillaProd = function (id) { return /^p\d+$/.test(String(id || "")); };
      if (productos.some(function (p) { return _esSemillaProd(p.id); })) {
        // Snapshot solo la primera vez (reversible), no en cada arranque.
        try { if (!localStorage.getItem("f123_prelimpieza_jfc_v1")) localStorage.setItem("f123_prelimpieza_jfc_v1", JSON.stringify({ ts: Date.now(), estado: estadoActualExportable() })); } catch (_) {}
        var _antesP = productos.length, _antesV = ventas.length;
        for (var _pi = productos.length - 1; _pi >= 0; _pi--) { if (_esSemillaProd(productos[_pi].id)) productos.splice(_pi, 1); }
        for (var _vi = ventas.length - 1; _vi >= 0; _vi--) { if (/^vs-/.test(String((ventas[_vi] && ventas[_vi].id) || ""))) ventas.splice(_vi, 1); }
        try { guardarEstadoLocal(); } catch (_) {}
        try { console.warn("[limpieza-jfc] semilla purgada: productos " + _antesP + "->" + productos.length); } catch (_) {}
      }
    }
  } catch (_) {}
  /* RESCATE DESDE INDEXEDDB (JFC 2026-08-17, portado desde amigable-123).
     Si en la sesion anterior localStorage estaba lleno, los ultimos guardados
     solo entraron en el espejo de IndexedDB. Aqui se comparan las revisiones y
     gana la MAS NUEVA: sin esto la app arrancaria con el estado viejo y el
     dueno veria desaparecer trabajo que la app le dijo que estaba guardado.
     Asincrono a proposito: la app arranca ya con lo que haya en localStorage y
     esto solo la corrige si de verdad hace falta. */
  (async () => {
    try {
      if (!window.OCEstadoIDB) return;
      const espejo = await window.OCEstadoIDB.leer();
      if (!espejo || typeof espejo._rev !== "number") return;
      if (espejo._rev <= _localRev) return;
      if (validarRespaldo(espejo)) return;
      _localRev = espejo._rev;
      aplicarRespaldo(espejo);
      try { localStorage.setItem("f123_rescate_idb", String(Date.now())); } catch (_) {}
      console.warn("[estado-idb] se recuperaron cambios que no cabian en localStorage (rev " + espejo._rev + ")");
      /* La UI ya se pinto con el estado viejo: se le avisa para que se repinte. */
      try { window.dispatchEvent(new CustomEvent("oc-estado-rescatado")); } catch (_) {}
    } catch (_) {}
  })();
  // AUTO-HEAL (paridad AMIGABLE, 2026-07-17): si el catalogo quedo VACIO por un
  // 789 disparado sin querer en un dispositivo que debia seguir en demo, se
  // repara UNA sola vez en la vida del dispositivo (guardia en localStorage,
  // nunca sessionStorage: el usuario debe poder vaciar su inventario real
  // legitimamente despues sin que esto se vuelva a disparar).
  try {
    if (!localStorage.getItem("f123_autoheal_888_v1")) {
      localStorage.setItem("f123_autoheal_888_v1", "1");
      /* BUG REAL (JFC 2026-08-19): "puse 7-8-9 y dije que prefiero la tienda
         vacia PERO SIGUEN CARGADAS LAS CAMISETAS DE METALLICA".

         Este auto-heal existe para un caso concreto y unico: alguien teclea
         789 SIN QUERER en un dispositivo de demo y se queda sin catalogo. En
         ese caso el dispositivo NO esta activado (no hay f123_owned) y
         devolverle la demo es un favor.

         Lo que hacia mal: no distinguia ese accidente de una activacion
         DELIBERADA con "empezar vacio". El dueno activaba su negocio, elegia
         tienda vacia, y al siguiente arranque este bloque veia el catalogo en
         cero, borraba f123_owned (desactivando el dispositivo del dueno) y
         recargaba con los datos semilla. Las camisetas volvian y la
         activacion se perdia.

         Ahora: si el dispositivo esta ACTIVADO (f123_owned existe) o el dueno
         marco explicitamente que vacio a proposito, no se toca nada. Un
         catalogo vacio en un negocio activado es una decision, no una averia.

         Ademas, homologado con amigable-123: (a) se exige que TODAS las
         colecciones esten vacias, no solo productos/ubicaciones — un negocio
         con ventas o clientes cargados nunca fue una demo rota; (b) antes de
         borrar nada se guarda una copia de rescate fechada, para no destruir
         un estado que resulte ser real. */
      var _activado = false;
      try {
        _activado = !!localStorage.getItem("f123_owned")
                 || !!localStorage.getItem("f123_vaciado_deliberado");
      } catch (_) {}
      var _realmenteVacio = productos.length === 0 && ubicaciones.length === 0
        && ventas.length === 0 && clientes.length === 0
        && movimientos.length === 0 && sucursales.length === 0
        && promotoras.length === 0;
      if (!_activado && _realmenteVacio) {
        try {
          var _raw = localStorage.getItem(OC_STATE_KEY);
          if (_raw) localStorage.setItem(OC_STATE_KEY + "_rescate_" + Date.now(), _raw);
          var _ptr = localStorage.getItem(OC_STATE_PTR);
          if (_ptr) {
            var _buf = localStorage.getItem(OC_STATE_KEY + "_" + _ptr);
            if (_buf) localStorage.setItem(OC_STATE_KEY + "_rescate_" + Date.now(), _buf);
          }
        } catch (_) {}
        localStorage.removeItem(OC_STATE_KEY);
        // Fase 3: el estado real vive en los buffers A/B, no en OC_STATE_KEY
        // directo (esa clave ahora es solo fallback de migracion) — limpiar
        // tambien los buffers y el puntero, o el reload de abajo recargaria
        // el mismo estado vacio en vez de volver a los datos semilla.
        try {
          localStorage.removeItem(OC_STATE_KEY + "_A");
          localStorage.removeItem(OC_STATE_KEY + "_B");
          localStorage.removeItem(OC_STATE_PTR);
        } catch (_) {}
        location.reload();
      }
    }
  } catch (_) {}

  const realFetch = window.fetch.bind(window);

  window.fetch = async function (url, opts) {
    // Microcirugia 4 (2026-07-07): si alguna libreria llama fetch(new
    // Request(...)), antes el interceptor no veia metodo ni body y la
    // llamada al backend local se perdia en silencio. Se normaliza aqui.
    if (url && typeof url === "object" && url.url) {
      const req = url;
      opts = opts || {};
      if (!opts.method && req.method) opts.method = req.method;
      if (!opts.body && req.method && req.method !== "GET" && typeof req.clone === "function") {
        try { opts.body = await req.clone().text(); } catch (_) {}
      }
      url = req.url;
    }
    // Item 1: toda mutación exitosa o fallida persiste el estado al final
    // (finally), salvo lecturas GET, rutas de sync y la exportación.
    let debePersistir = false;
    try {
      const u = new URL(url, window.location.origin);
      if (!u.pathname.startsWith("/api")) return realFetch(url, opts);
      const path = u.pathname;
      const q = u.searchParams;
      // FIX 2026-07-07: un body que no sea JSON (FormData, texto suelto)
      // reventaba el interceptor entero con un 500 generico. Se degrada a {}
      // y cada endpoint responde su error especifico.
      let body = {};
      if (opts && opts.body) { try { body = (function () { try { return JSON.parse(opts.body); } catch (_) { return {}; } })(); } catch (_) { body = {}; } }
      const method = (opts && opts.method ? opts.method : "GET").toUpperCase();
      debePersistir = ["POST", "PUT", "PATCH", "DELETE"].includes(method) && !path.startsWith("/api/sync") && path !== "/api/respaldo/exportar";
      /* PRUEBA VENCIDA = SOLO LECTURA (decisión JFC 2026-09-22; lógica en
         docs/licencia-prueba.js). Una sola compuerta para TODA escritura, en el
         único punto por el que pasan todas. Se bloquea solo con certeza (aparato
         activado, sin pago, prueba vencida, no demo, ruta que escribe negocio).
         FALLA ABIERTO: si OCPrueba no está cargado o algo lanza, NO bloquea.
         Un bug aquí nunca puede dejar en solo lectura a un cliente que pagó.
         Los datos no se tocan: solo se rechaza escribir algo NUEVO. */
      if (debePersistir) {
        let _bloquea = false;
        try { _bloquea = !!(window.OCPrueba && window.OCPrueba.bloquea && window.OCPrueba.bloquea(path)); } catch (_) { _bloquea = false; }
        if (_bloquea) {
          debePersistir = false; // nada cambió: no hay estado que persistir
          try { window.dispatchEvent(new CustomEvent("oc-prueba-vencida")); } catch (_) {}
          let _msg = "Your trial has ended: the app is read-only.";
          try { _msg = window.OCPrueba.mensajeError(); } catch (_) {}
          return J({ error: _msg, codigo: "PRUEBA_VENCIDA" }, 402);
        }
      }
      const uid = q.get("ubicacionId");

      let m;
      // Una categoría puede abarcar muchos productos. Cambiarla con PATCH por
      // ficha dejaba una operación a medias si la red fallaba entre solicitudes.
      // Validamos TODO primero y aplicamos en un único turno síncrono al store
      // local; cada ficha recibe rev para converger por el catálogo cifrado.
      if (path === "/api/categorias/cambiar" && method === "POST") {
        const vieja = String(body.vieja || "").trim();
        const nueva = String(body.nueva == null ? "" : body.nueva).trim();
        if (!vieja || (!nueva && body.borrar !== true)) return J({ error: "A category name is required." }, 400);
        if (nueva.length > 120) return J({ error: "The category name is too long." }, 400);
        if (vieja.toLowerCase() === nueva.toLowerCase()) return J({ ok: true, actualizados: 0 });
        const afectados = productos.filter((p) => p && !p.borrado && String(p.categoria || "").trim().toLowerCase() === vieja.toLowerCase());
        afectados.forEach((p) => { p.categoria = nueva; p.rev = _revNueva(); });
        if (afectados.length) {
          mov("edicion-categoria", { antes: vieja, ahora: nueva, productosAfectados: afectados.length });
          avisarCatalogoCambiado();
        }
        return J({ ok: true, actualizados: afectados.length });
      }
      // Edicion libre de la ficha (nombre, foto, precios, codigo interno).
      // El gating por rol (encargado NO edita) vive en la UI; aca solo se aplica.
      if ((m = path.match(/^\/api\/productos\/([^/]+)$/)) && opts && opts.method === "PATCH") {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        if (body.fechaCaducidad !== undefined && body.fechaCaducidad !== null && body.fechaCaducidad !== "" && !fechaValida(body.fechaCaducidad)) return J({ error: "That expiry date is not valid (use YYYY-MM-DD)." }, 400);
        const stockAntesEdicion = Number(p.stockActual) || 0;
        const CAMPOS = ["nombre", "categoria", "precio", "precioCasa", "costo", "proveedor", "foto", "barcode", "sku", "chip", "perecible", "exentoImpuesto", "fechaCaducidad", "metodoCosteo", "ubicacionId", "tipoProveedor", "tipoProducto", "servingMl", "botellaMl", "umbralRojo", "umbralAmarillo", "comisionProveedorPct", "comisionistaId", "archivado"];
        CAMPOS.forEach((k) => {
      if (body[k] === undefined) return;
      if (k === "foto") {
        if (p.foto !== body[k]) { p.foto = body[k]; p.fotoHash = null; }
        return;
      }
      /* precioCasa (JFC/Belén 2026-09-15): nullable. "" o vacío => se borra el
         precio de casa (null); si no, número >=0. Va ANTES del branch numérico
         genérico, que convertiría null/"" en 0 y dejaría un precio de casa $0
         fantasma. */
      if (k === "precioCasa") { p[k] = (body[k] === "" || body[k] == null) ? null : Math.max(0, Number(body[k]) || 0); return; }
      if (k === "precio" || k === "costo" || k === "umbralRojo" || k === "umbralAmarillo" || k === "comisionProveedorPct") { p[k] = Number(body[k]) || 0; return; }
      if (k === "servingMl" || k === "botellaMl") {
        const nuevo = Math.max(1, Number(body[k]) || (k === "servingMl" ? 50 : 750));
        /* BAR (JFC 2026-09-10, queja de Belén: "el stock de bebidas no cambia al
           editar copas/ml"). El stock de una bebida está en COPAS. Si cambia el ml
           POR COPA, la MISMA bebida física rinde otro número de copas: se reescala
           el stock para conservar el volumen (copas × mlViejo = copas' × mlNuevo).
           Antes solo se guardaba el ml y el número de copas quedaba igual (mal).
           botellaMl NO reescala: es solo la referencia copas↔botellas. */
        if (k === "servingMl" && (p.tipoProducto || "normal") === "bar") {
          const viejo = Math.max(1, Number(p.servingMl) || 50);
          if (viejo !== nuevo) p.stockActual = Math.round(Math.max(0, Number(p.stockActual) || 0) * viejo / nuevo);
        }
        p[k] = nuevo; return;
      }
      if (k === "chip") { p[k] = String(body[k] || "").trim().slice(0, 12); return; }
      if (k === "perecible" || k === "archivado" || k === "exentoImpuesto") { p[k] = !!body[k]; return; } // archivado: JFC/Belén 2026-09-08
      p[k] = body[k];
    });
        if (Number(p.stockActual) !== stockAntesEdicion) emitirOpStock("conversion-bar", { productoId: p.id, delta: Number(p.stockActual) - stockAntesEdicion });
        p.rev = _revNueva();
        mov("edicion", { producto: p.nombre, sku: p.sku, ubicacion: nombreUbic(p.ubicacionId) });
        avisarCatalogoCambiado(); // nombre/precio/percha del producto viajan al equipo (el stock no)
        return J(ficha(p));
      }
      // Borrado definitivo (dueno, doble confirmacion en la UI).
      if ((m = path.match(/^\/api\/productos\/([^/]+)$/)) && opts && opts.method === "DELETE") {
        const i = productos.findIndex((x) => x.id === m[1]); if (i === -1) return J({ error: "Product not found." }, 404);
        // BUG FIJADO 2026-07-03: una transferencia "en_transito" ya restó el
        // stock del origen esperando que el destino lo reciba. Borrar el
        // producto origen o destino en ese estado perdía esas unidades para
        // siempre, sin rastro. Bloquear hasta que se confirme o resuelva.
        const enTransito = transferencias.find((t) => (t.estado === "en_transito" || t.estado === "solicitada") && (t.productoOrigenId === m[1] || t.productoDestinoId === m[1]));
        if (enTransito) return J({ error: `"${productos[i].nombre}" tiene una transferencia en tránsito (${enTransito.cantidad} unidades). Espera a que se confirme o se resuelva antes de borrarlo.` }, 400);
        const borrado = productos[i]; borrado.borrado = true; borrado.rev = _revNueva();
        mov("baja", { producto: borrado.nombre, sku: borrado.sku, ubicacion: nombreUbic(borrado.ubicacionId) });
        return J({ ok: true });
      }
      if (path === "/api/modo") return J({ modo: "demo-estatico" });
      if (path === "/api/ubicaciones" && (!opts || opts.method !== "POST")) {
        const soloActivas = q.get("todas") !== "1";
        return J(soloActivas ? ubicaciones.filter((u) => !u.borrado && u.activa !== false) : ubicaciones.filter((u) => !u.borrado));
      }
      if (path === "/api/ubicaciones" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "The location name is required." }, 400);
        const nueva = { id: uuid("u"), nombre: body.nombre.trim(), tipo: body.tipo || "propio", activa: true, comisionSocio: Number(body.comisionSocio) || 0, metaMensual: Number(body.metaMensual) || 0, escalasComision: Array.isArray(body.escalasComision) ? body.escalasComision : [], sucursalId: body.sucursalId || null, esFeria: !!body.esFeria, lecturaPreferida: body.lecturaPreferida === "casa" ? "casa" : "asociado", minimoGarantizado: Math.max(0, Number(body.minimoGarantizado) || 0), contribFija: Math.max(0, Number(body.contribFija) || 0) };
        nueva.rev = _revNueva();
        ubicaciones.push(nueva);
        // BUG FIX (2026-07-03): las perchas creadas en runtime no existian en
        // gastosMensuales, por lo que la suma "todas" las excluia hasta que se
        // guardara algun gasto para ellas. Se inicializa en 0 al crearlas.
        gastosMensuales[nueva.id] = 0;
        mov("ubicacion-alta", { ubicacion: nueva.nombre });
        avisarCatalogoCambiado(); // la percha nueva viaja al resto del negocio
        return J(nueva);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)$/)) && opts && opts.method === "PUT") {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Location not found." }, 404);
        if (body.nombre && body.nombre.trim()) u.nombre = body.nombre.trim();
        if (body.tipo) u.tipo = body.tipo;
        if ("sucursalId" in body) u.sucursalId = body.sucursalId || null;
        if ("promotoraId" in body) u.promotoraId = body.promotoraId || null;
        /* El % del trato y la meta no se podian cambiar NUNCA desde aqui: una
           percha nacia con su comision y quedaba asi para siempre, y la unica
           salida era borrarla y rehacerla — perdiendo su historial. Sin esto
           la modalidad de artista (se lleva 85, la casa retiene 15) era
           inalcanzable. (JFC 2026-08-18) */
        if ("comisionSocio" in body) {
          const pc = Number(body.comisionSocio);
          if (!Number.isFinite(pc) || pc < 0 || pc > 100) return J({ error: "The commission must be between 0 and 100." }, 400);
          u.comisionSocio = pc;
        }
        if ("metaMensual" in body) u.metaMensual = Math.max(0, Number(body.metaMensual) || 0);
        if ("esEvento" in body) u.esEvento = !!body.esEvento;
        if ("esFeria" in body) u.esFeria = !!body.esFeria;
        /* LAS DOS FORMAS DE DECIR EL MISMO TRATO (JFC 2026-08-18). Se guarda
           SIEMPRE un solo numero canonico —lo que se lleva el asociado— y
           aparte como lo dice este negocio. Si el duenio escribe "la casa
           retiene 15", aqui se convierte a 85 y se recuerda que el prefiere
           leerlo al reves. Nadie tiene que restar de cabeza, y es imposible
           guardar un reparto que no sume 100. */
        /* LO EXPLICITO Y MAS RECIENTE MANDA (JFC 2026-08-18). Escribir un
           porcentaje EN ESTA PERCHA quiere decir "este trato, aqui", aunque la
           persona asignada tenga otro trato propio en otras perchas. Se puede
           desactivar mandando usarComisionPropia:false en la misma peticion. */
        if (("comisionSocio" in body || "pctQuedaEnCasa" in body) && !("usarComisionPropia" in body)) u.usarComisionPropia = true;
        if ("pctQuedaEnCasa" in body) {
          const pc = Number(body.pctQuedaEnCasa);
          if (!Number.isFinite(pc) || pc < 0 || pc > 100) return J({ error: "The house share must be between 0 and 100." }, 400);
          u.comisionSocio = +(100 - pc).toFixed(2);
          u.lecturaPreferida = "casa";
        }
        if ("lecturaPreferida" in body) u.lecturaPreferida = body.lecturaPreferida === "casa" ? "casa" : "asociado";
        /* Se BLOQUEA al escribir, no se corrige al leer (mismo criterio que
           amigable-123): el aporte fijo y las escalas por meta no pueden
           coexistir, porque el modelo escalonado calcula el % venta por venta
           con el acumulado del mes y restar un fijo ahi obligaria a recalcular
           cada venta ya registrada. Decirlo aqui, cuando se configura, evita
           que el duenio descubra el conflicto en la liquidacion de fin de mes. */
        if ("contribFija" in body) {
          const cf = Math.max(0, Number(body.contribFija) || 0);
          const habraEscalas = "escalasComision" in body
            ? (Array.isArray(body.escalasComision) && body.escalasComision.length > 0)
            : (Array.isArray(u.escalasComision) && u.escalasComision.length > 0);
          if (cf > 0 && habraEscalas) return J({ error: "A fixed contribution can't be combined with goal-based tiers: pick one. The tiered model recalculates the rate sale by sale, so subtracting a fixed amount would change every sale already recorded." }, 400);
          u.contribFija = cf;
        }
        if ("minimoGarantizado" in body) u.minimoGarantizado = Math.max(0, Number(body.minimoGarantizado) || 0);
        if ("usarComisionPropia" in body) u.usarComisionPropia = !!body.usarComisionPropia;
        if ("escalasComision" in body) u.escalasComision = Array.isArray(body.escalasComision) ? body.escalasComision : [];
        /* B2 (JFC 2026-09-10): puntero de la foto. La foto (bytes) se guarda por
           su hash SHA-256 en idb-fotos; aqui solo viaja el HASH en el catalogo,
           asi la asignacion "esta percha tiene esta foto" converge entre aparatos
           sin mover megas por el CRDT. Los bytes viajan aparte (a la nube del
           dueno, B3). null = quitar la foto. */
        if ("fotoHash" in body) u.fotoHash = body.fotoHash || null;
        u.rev = _revNueva();
        guardarEstadoLocal();
        avisarCatalogoCambiado(); // cambios de la percha (nombre, trato, foto) viajan al equipo
        return J(u);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)\/(activar|desactivar)$/))) {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Location not found." }, 404);
        u.activa = m[2] === "activar"; u.rev = _revNueva();
        mov(u.activa ? "ubicacion-reactivada" : "ubicacion-desactivada", { ubicacion: u.nombre });
        return J(u);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)$/)) && opts && opts.method === "DELETE") {
        const idx = ubicaciones.findIndex((x) => x.id === m[1]); if (idx < 0) return J({ error: "Shelf not found." }, 404);
        if (ubicaciones.filter((x) => !x.borrado).length <= 1) return J({ error: "At least one shelf has to remain." }, 400);
        const u = ubicaciones[idx];
        // Borrado en cascada: la percha y TODOS sus productos. La UI ya lo advirtio.
        const productosBorrados = productos.filter((p) => p.ubicacionId === u.id && !p.borrado).length;
        for (const p of productos) if (p.ubicacionId === u.id && !p.borrado) { p.borrado = true; p.rev = _revNueva(); }
        u.borrado = true; u.activa = false; u.rev = _revNueva();
        delete gastosMensuales[u.id];
        mov("ubicacion-borrada", { ubicacion: u.nombre, productosBorrados });
        return J({ ok: true, productosBorrados });
      }
      // ---- CAJA CHICA por percha — Roadmap Agosto 2026, Fase 2 ----
      // Mismo espiritu que cartera de clientes: el saldo NUNCA se guarda
      // aqui, se deriva en AMG.CajaChica reproduciendo los hechos.
      const mPerchaCaja = path.match(/^\/api\/ubicaciones\/([^/]+)\/caja-chica$/);
      if (mPerchaCaja && (!opts || !opts.method || opts.method === "GET")) {
        const u = ubicaciones.find((x) => x.id === mPerchaCaja[1]);
        if (!u) return J({ error: "Shelf not found." }, 404);
        if (!window.AMG || !window.AMG.CajaChica) return J({ saldo: 0, movimientos: [] });
        return J(await window.AMG.CajaChica.saldoDePercha(u.id));
      }
      const mPerchaCajaMov = path.match(/^\/api\/ubicaciones\/([^/]+)\/caja-chica\/(ingreso|retiro)$/);
      if (mPerchaCajaMov && opts && opts.method === "POST") {
        const u = ubicaciones.find((x) => x.id === mPerchaCajaMov[1]);
        if (!u) return J({ error: "Shelf not found." }, 404);
        const monto = Number(body.monto);
        if (!(monto > 0)) return J({ error: "The amount must be greater than zero." }, 400);
        if (!body.motivo || !String(body.motivo).trim()) return J({ error: "A reason is required." }, 400);
        if (!window.AMG || !window.AMG.CajaChica) return J({ error: "Petty cash is not available." }, 500);
        const tipo = mPerchaCajaMov[2];
        try {
          await window.AMG.CajaChica.registrarMovimiento(u.id, tipo, monto, body.motivo);
        } catch (e) {
          return J({ error: (e && e.message) || "No se pudo registrar el movimiento." }, 400);
        }
        mov(tipo === "ingreso" ? "caja-chica-ingreso" : "caja-chica-retiro", { ubicacion: u.nombre, monto, motivo: body.motivo });
        return J(await window.AMG.CajaChica.saldoDePercha(u.id));
      }

      // ---- Asociados/as (comision por traer gente) ----
      if (path === "/api/promotoras" && (!opts || opts.method !== "POST")) return J(promotoras.filter((p) => !p.borrado));
      if (path === "/api/promotoras" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "A name is required." }, 400);
        /* Datos de contacto/pago opcionales (paridad con amigable-123, JFC
           2026-08-25): antes solo se guardaba nombre + %, muy por detras de lo
           que ya se pide para clientes. Todo opcional salvo el nombre. */
        const _s = (x) => String(x || "").trim().slice(0, 160);
        /* Base % en `comisionBase` (JFC 2026-09-01): el editor de comisionista
           (portado de amigable) usa comisionBase y resolverTrato lo lee primero.
           Se acepta `comision` como alias de entrada y se guarda `comision`
           espejo para compatibilidad con datos/lectores viejos. */
        const _base = Math.max(0, Number(body.comisionBase !== undefined ? body.comisionBase : body.comision) || 0);
        const nuevaProm = { id: uuid("pr"), nombre: body.nombre.trim().slice(0, 80), comisionBase: _base, comision: _base,
          telefono: _s(body.telefono), cedula: _s(body.cedula), banco: _s(body.banco), cuenta: _s(body.cuenta),
          direccion: _s(body.direccion), notas: _s(body.notas), activa: true, creadoEn: new Date().toISOString(),
          /* JFC 2026-08-27 (portado de amigable-123): meta mensual y tramos/escalas
             propios del comisionista. Formato {hasta,comision} — el MISMO que lee
             pctDeLaVenta/resolverTrato y el editor de barra (antes {desde,pct}: los
             tramos del comisionista se perdían en silencio). */
          metaMensual: Math.max(0, Number(body.metaMensual) || 0),
          escalasComision: Array.isArray(body.escalasComision) ? body.escalasComision.map((e) => ({ hasta: Math.max(0, Number(e.hasta) || 0), comision: Math.max(0, Math.min(100, Number(e.comision) || 0)) })).filter((e) => e.hasta > 0) : [], rev: _revNueva() };
        promotoras.push(nuevaProm);
        mov("promotora-alta", { promotora: nuevaProm.nombre });
        return J(nuevaProm);
      }
      const mProm = path.match(/^\/api\/promotoras\/([^/]+)$/);
      if (mProm && opts && opts.method === "PUT") {
        const pr = promotoras.find((x) => x.id === mProm[1]);
        if (!pr || pr.borrado) return J({ error: "Associate not found." }, 404);
        if (body.nombre !== undefined) pr.nombre = String(body.nombre).trim().slice(0, 80) || pr.nombre;
        // Base % en comisionBase (con comision espejo) — acepta ambos nombres de entrada.
        if (body.comisionBase !== undefined || body.comision !== undefined) {
          const b = Math.max(0, Number(body.comisionBase !== undefined ? body.comisionBase : body.comision) || 0);
          pr.comisionBase = b; pr.comision = b;
        }
        if (body.metaMensual !== undefined) pr.metaMensual = Math.max(0, Number(body.metaMensual) || 0);
        // Escalas {hasta,comision} — el mismo formato que lee pctDeLaVenta (antes {desde,pct}).
        if (body.escalasComision !== undefined) pr.escalasComision = Array.isArray(body.escalasComision) ? body.escalasComision.map((e) => ({ hasta: Math.max(0, Number(e.hasta) || 0), comision: Math.max(0, Math.min(100, Number(e.comision) || 0)) })).filter((e) => e.hasta > 0) : [];
        ["telefono", "cedula", "banco", "cuenta", "direccion", "notas"].forEach((k) => { if (body[k] !== undefined) pr[k] = String(body[k] || "").trim().slice(0, 160); });
        pr.rev = _revNueva();
        mov("promotora-edicion", { promotora: pr.nombre });
        return J(pr);
      }
      if (mProm && opts && opts.method === "DELETE") {
        const idxP = promotoras.findIndex((x) => x.id === mProm[1]);
        if (idxP < 0) return J({ error: "Associate not found." }, 404);
        const prb = promotoras[idxP];
        if (prb.borrado) return J({ error: "Associate not found." }, 404);
        prb.borrado = true; prb.activa = false; prb.rev = _revNueva();
        // Desasignar de las perchas que lo tenian. FIX (JFC 2026-09-22): antes NO
        // se subia u.rev aqui, asi que Yjs (que mergea perchas por rev mas alto)
        // podia conservar el promotoraId VIEJO en otro aparato que ya tenia una
        // revision mayor de esa percha por otro motivo -> Commissions mostraba
        // distinto entre dispositivos tras archivar un comisionista.
        ubicaciones.forEach((u) => { if (u.promotoraId === prb.id) { u.promotoraId = null; u.rev = _revNueva(); } });
        mov("promotora-baja", { promotora: prb.nombre });
        return J({ ok: true });
      }
      // ---- Sucursales (agrupadores backend de perchas) ----
      if (path === "/api/sucursales" && (!opts || opts.method !== "POST")) return J(sucursales.filter((s) => !s.borrado));
      if (path === "/api/sucursales" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "The branch name is required." }, 400);
        const nuevaSuc = { id: uuid("suc"), nombre: body.nombre.trim(), activa: true, rev: _revNueva() };
        sucursales.push(nuevaSuc);
        mov("sucursal-alta", { sucursal: nuevaSuc.nombre });
        return J(nuevaSuc);
      }
      const mSuc = path.match(/^\/api\/sucursales\/([^/]+)$/);
      if (mSuc && opts && opts.method === "PUT") {
        const s = sucursales.find((x) => x.id === mSuc[1]); if (!s || s.borrado) return J({ error: "Branch not found." }, 404);
        if (body.nombre && body.nombre.trim()) s.nombre = body.nombre.trim();
        s.rev = _revNueva();
        return J(s);
      }
      if (mSuc && opts && opts.method === "DELETE") {
        const tienePerchas = ubicaciones.some((u) => u.sucursalId === mSuc[1]);
        if (tienePerchas) return J({ error: "Move the shelves to another branch before deleting this one." }, 400);
        const idxS = sucursales.findIndex((x) => x.id === mSuc[1]);
        if (idxS < 0) return J({ error: "Branch not found." }, 404);
        const s = sucursales[idxS];
        if (s.borrado) return J({ error: "Branch not found." }, 404);
        s.borrado = true; s.activa = false; s.rev = _revNueva();
        mov("sucursal-baja", { sucursal: s.nombre });
        return J({ ok: true });
      }

      // Desempeno por asociado/a: agrega las perchas que tiene asignadas,
      // suma comision y ventas del mes, y saca su mejor SKU (rec 04 + 09).
      if (path === "/api/promotores/desempeno") {
        const byId = {};
        ubicaciones.filter((u) => u.promotoraId).forEach((u) => {
          const pr = promotoras.find((x) => x.id === u.promotoraId); if (!pr) return;
          const g = byId[pr.id] || (byId[pr.id] = { id: pr.id, nombre: pr.nombre, ventasBrutas: 0, ventasCount: 0, comision: 0, ultima: "", porSku: {} });
          ventasActivas().filter((v) => v.ubicacionId === u.id && esDelMesActual(v.fecha) && v.split).forEach((v) => {
            g.ventasBrutas += v.split.montoBruto;
            g.comision += v.split.montoComisionSocio;
            g.ventasCount += v.cantidad;
            if (v.fecha > g.ultima) g.ultima = v.fecha;
            const prod = productos.find((x) => x.id === v.productoId);
            const sku = prod ? prod.sku : v.productoId;
            g.porSku[sku] = (g.porSku[sku] || 0) + v.cantidad;
          });
        });
        const arr = Object.values(byId).map((g) => {
          const top = Object.entries(g.porSku).sort((a, b) => b[1] - a[1])[0];
          return { id: g.id, nombre: g.nombre, ventasBrutas: +g.ventasBrutas.toFixed(2), ventasCount: g.ventasCount, comision: +g.comision.toFixed(2), diasSinVenta: g.ultima ? Math.floor((Date.now() - new Date(g.ultima).getTime()) / 86400000) : null, topSku: top ? { sku: top[0], unidades: top[1] } : null };
        }).sort((a, b) => b.ventasBrutas - a.ventasBrutas);
        return J(arr);
      }
      if (path === "/api/dashboard") {
       try {
        const ps = filtrar(uid), vh = ventasHoyDe(uid);
        const entra = vh.reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
        const sale = vh.reduce((a, v) => a + v.costoUnit * v.cantidad, 0);
        const inv = ps.reduce((a, p) => a + p.precio * p.stockActual, 0);
        const alertas = ps.map((p) => ({ p, ...estadoDe(p) })).filter((e) => e.estado === "rojo" || e.estado === "naranja").sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]).map((e) => ({ estado: e.estado, mensaje: `${e.p.nombre}: ${e.mensaje}` }));
        // El hero de HOY es tri-estado (verde/amarillo/rojo, como el manual):
        // las alertas naranjas ("revisar pronto") encienden el nivel medio.
        // BUG FIX 2026-07-07: comparaba contra "amarillo", que ya no existe
        // en alertas (ahora son rojo/naranja) — el hero saltaba de verde a rojo.
        let sem = "verde";
        if (alertas.some((a) => a.estado === "rojo")) sem = "rojo"; else if (alertas.some((a) => a.estado === "naranja")) sem = "amarillo";
        // Mejora #5 (JFC 2026-07-16): resumen semanal para el nudge de WhatsApp
        // (weekly-summary en index.html). Ultimos 7 dias, misma ubicacion filtrada.
        const hace7dias = new Date(hoyISO()).getTime() - 6 * 86400000; // Fix-8: ZONA-aware boundary, not UTC epoch
        const vSemana = ventasActivas().filter((v) => new Date(v.fecha).getTime() >= hace7dias && (!uid || uid === "todas" || v.ubicacionId === uid));
        const entraSemana = vSemana.reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
        return J({ semaforoGeneral: sem, resumenDia: { entra: +entra.toFixed(2), sale: +sale.toFixed(2), gananciaHoy: +(entra - sale).toFixed(2), inventarioValorizado: +inv.toFixed(2), ventasCount: vh.length }, resumenSemana: { entra: +entraSemana.toFixed(2), ventasCount: vSemana.length }, alertas });
       } catch (e) {
        // FIX v301: el dashboard NUNCA debe lanzar (un producto con datos
        // incompletos hacia 500 -> el hero se quedaba en "Loading"). Se responde
        // un estado seguro y usable; el detalle se ve en consola.
        try { console.error("[dashboard] fallo el calculo del dia:", e && e.message); } catch (_) {}
        return J({ semaforoGeneral: "verde", resumenDia: { entra: 0, sale: 0, gananciaHoy: 0, inventarioValorizado: 0, ventasCount: 0 }, resumenSemana: { entra: 0, ventasCount: 0 }, alertas: [] });
       }
      }

      if (path === "/api/productos" && (!opts || opts.method !== "POST")) {
        // soloArchivados=1 → devuelve los archivados (para la lista de archivados),
        // en vez de excluirlos como hace filtrar(). JFC/Belén 2026-09-08.
        // El GRID de Inventario (vista operacional) es el ÚNICO que oculta los
        // archivados. Todo lo demás (dashboard, resumen, BCG, reportes) usa
        // filtrar() y SÍ los ve — archivar no borra del historial (JFC 2026-09-08).
        const soloArch = q.get("soloArchivados") === "1";
        let fuente = soloArch
          ? productos.filter((p) => p.archivado && (!uid || uid === "todas" || p.ubicacionId === uid))
          : filtrar(uid).filter((p) => !p.archivado);
        /* GARANTIA v306: para la licencia de JFC (prefijo), NUNCA mostrar la semilla
           demo (ids "p"+digitos) en el listado, pase lo que pase con el estado local
           o la purga. Los reales son "p"+UUID. idiomARTE (K7M2)/otros NO se filtran
           (pueden tener ids p\d+ propios). Es cinturon + tirantes con la purga. */
        try { var _lpF = String((_licenciaPropia && _licenciaPropia()) || "").toUpperCase().replace(/\s+/g, ""); if (_lpF.indexOf("F123-A6YK-6V1J-") === 0) fuente = fuente.filter((p) => !/^p\d+$/.test(String(p.id || ""))); } catch (_) {}
        let lista = fuente.map((p) => { const e = estadoDe(p); return { id: p.id, nombre: p.nombre, categoria: p.categoria, sku: p.sku, stockActual: p.stockActual, estado: e.estado, nivelBloom: e.nivel, mensaje: e.mensaje, precio: p.precio, costo: p.costo || 0, ubicacionId: p.ubicacionId, ubicacionNombre: nombreUbic(p.ubicacionId), tipoProveedor: p.tipoProveedor || "compra", tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, perecible: !!p.perecible, exentoImpuesto: !!p.exentoImpuesto, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: e.dias, estrella: !!p.estrella, foto: p.foto || null, chip: p.chip || "", familiaId: p.familiaId || "", varianteAtributo: p.varianteAtributo || "", varianteValor: p.varianteValor || "", archivado: !!p.archivado }; });
        const est = q.get("estado");
        if (est) lista = lista.filter((x) => x.estado === est);
        lista.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre, "es"));
        return J(lista);
      }

      if (path === "/api/productos" && opts && opts.method === "POST") {
        if (!body.nombre || !body.barcode) return J({ error: "The name or the barcode is missing." }, 400);
        // BUG FIX (2026-07-03): sin esta guarda, umbralRojo >= umbralAmarillo hace
        // el estado "amarillo" inalcanzable: el producto salta directo de verde a rojo.
        if (Number(body.umbralRojo) >= Number(body.umbralAmarillo)) return J({ error: "The red threshold must be lower than the yellow one." }, 400);
        if (body.perecible && !body.fechaCaducidad) return J({ error: "If the product expires, enter its expiry date." }, 400);
        if (body.perecible && !fechaValida(body.fechaCaducidad)) return J({ error: "That expiry date is not valid (use YYYY-MM-DD)." }, 400);
        const ubicNueva = body.ubicacionId && body.ubicacionId !== "todas" ? ubicaciones.find((x) => x.id === body.ubicacionId) : null;
        if (ubicNueva && ubicNueva.activa === false) return J({ error: `"${ubicNueva.nombre}" está desactivada — reactívala en Avanzado antes de agregar productos ahí.` }, 400);
        // Free-tier: sin dispositivo activado (PIN 789), tope de 25 productos.
        if (!estaLicenciado() && productos.length >= 25) {
          return J({ error: `Without activation this device is limited to 25 products. Activate it (PIN 789) to start your full ${(window.OCPrueba && window.OCPrueba.PRUEBA_DIAS) || 30}-day trial.`, codigo: "LIMITE_PRODUCTOS" }, 403);
        }
        /* Variantes: guardas en la capa de datos, no solo en la pantalla. Esto
           evita dos variantes identicas por doble toque o concurrencia. Los
           productos historicos sin familia conservan su comportamiento. */
        if (body.familiaId) {
          const norm = (v) => String(v || "").trim().toLocaleLowerCase();
          const fam = String(body.familiaId || "").trim().toUpperCase().slice(0, 80);
          const atr = norm(body.varianteAtributo);
          const val = String(body.varianteValor || "").trim().slice(0, 40);
          if (!fam || !atr || !val || !body.productoBaseId) return J({ error: "Complete the variant attribute and value." }, 400);
          const baseVariante = productos.find((p) => p.id === body.productoBaseId && !p.borrado);
          if (!baseVariante) return J({ error: "The base product no longer exists." }, 409);
          if (productos.some((p) => !p.borrado && norm(p.barcode) === norm(body.barcode))) return J({ error: "That barcode or internal code is already used by another product." }, 409);
          if (productos.some((p) => !p.borrado && norm(p.sku) === norm(body.sku))) return J({ error: "That SKU is already used. Change the variant value." }, 409);
          if (productos.some((p) => !p.borrado && norm(p.familiaId) === norm(fam) && norm(p.varianteAtributo) === atr && norm(p.varianteValor) === norm(val))) return J({ error: "That variant already exists in this product family." }, 409);
          body.familiaId = fam; body.varianteValor = val; body.stockInicial = 0;
          /* El producto base entra formalmente a la misma familia. Así el
             resumen agrupa base+variantes incluso si su SKU histórico no
             tenía guion. Es metadata aditiva; no toca dinero ni stock. */
          if (!baseVariante.familiaId) { baseVariante.familiaId = fam; baseVariante.rev = _revNueva(); }
          if (body.umbralRojo == null) body.umbralRojo = baseVariante.umbralRojo;
          if (body.umbralAmarillo == null) body.umbralAmarillo = baseVariante.umbralAmarillo;
        }
        const nuevo = {
          // M5 (2026-08-14): variante interna, hasta 12 caracteres. Vacio por
          // defecto: un producto sin variante se comporta igual que siempre.
          chip: String(body.chip || "").trim().slice(0, 12),
          familiaId: String(body.familiaId || "").trim().slice(0, 80),
          productoBaseId: body.productoBaseId || null,
          varianteAtributo: String(body.varianteAtributo || "").trim().slice(0, 24),
          varianteValor: String(body.varianteValor || "").trim().slice(0, 40),
          id: body.familiaId ? idVariante(body.familiaId, body.varianteAtributo, body.varianteValor) : uuid("p"), nombre: String(body.nombre).trim(), categoria: body.categoria || "General",
          sku: body.sku || body.barcode, barcode: body.barcode, ubicacionId: body.ubicacionId || "todas",
          // BUG FIJADO 2026-07-03: sin piso en 0, un stockInicial negativo
          // corrompía la valorización de inventario desde la creación.
          precio: Math.max(0, Number(body.precio) || 0), costo: Math.max(0, Number(body.costo) || 0), stockActual: Math.max(0, Number(body.stockInicial) || 0),
          stockTs: Date.now(), // v302: todo producto nace con sello de stock para que el stock inicial cruce por LWW
          /* PRECIO DE CASA / ARTISTA (JFC/Belén 2026-09-15): segundo precio
             OPCIONAL, más bajo, para la gente de la casa (ej. cerveza $5 al
             público, $3 a artistas) SIN abrir un segundo producto que partiría
             el stock en dos. null = no hay precio de casa (comportamiento de
             siempre). "" o no-número => null. Ver precioEfectivo en /venta. */
          precioCasa: (body.precioCasa === "" || body.precioCasa == null) ? null : Math.max(0, Number(body.precioCasa) || 0),
          umbralRojo: Number(body.umbralRojo) || 5, umbralAmarillo: Number(body.umbralAmarillo) || 10, proveedor: body.proveedor || "",
          perecible: !!body.perecible, exentoImpuesto: !!body.exentoImpuesto, fechaCaducidad: body.perecible ? (body.fechaCaducidad || null) : null,
          metodoCosteo: body.metodoCosteo === "LIFO" ? "LIFO" : "FIFO",
          tipoProveedor: body.tipoProveedor === "consignacion" ? "consignacion" : "compra",
          comisionProveedorPct: Math.max(0, Number(body.comisionProveedorPct) || 0),
          /* Bar (JFC 2026-08-27): tipoProducto "bar" cuenta stock en servings;
             servingMl/botellaMl definen la conversión (default 50/750 ml). */
          tipoProducto: body.tipoProducto === "ticket" ? "ticket" : (body.tipoProducto === "bar" ? "bar" : "normal"),
          servingMl: Math.max(1, Number(body.servingMl) || 50),
          botellaMl: Math.max(1, Number(body.botellaMl) || 750),
          comisionistaId: body.comisionistaId || null, // JFC 2026-08-27: comisionista asociado al producto
          creadoEn: new Date().toISOString(),
        };
        nuevo.rev = _revNueva();
        productos.push(nuevo);
        mov("alta", { producto: nuevo.nombre, sku: nuevo.sku, ubicacion: nombreUbic(nuevo.ubicacionId) });
        avisarCatalogoCambiado(); // el producto nuevo viaja al resto del negocio (con stock 0; cada percha cuenta el suyo)
        return J(ficha(nuevo));
      }

      if ((m = path.match(/^\/api\/productos\/([^/]+)\/venta$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        const ubicP = ubicaciones.find((x) => x.id === p.ubicacionId);
        if (ubicP && ubicP.activa === false) return J({ error: `"${ubicP.nombre}" está desactivada — no admite ventas nuevas.` }, 400);
        /* B19 (JFC 2026-08-19, medido con un harness contra este endpoint).
           Antes: `Number.isInteger(body.cantidad) && body.cantidad > 0 ?
           body.cantidad : 1`. Cualquier cantidad invalida se convertia en 1
           EN SILENCIO. Pedir vender -5, o 0, o "dos" devolvia 200 y grababa
           una venta real de 1 unidad: movimiento de stock y de dinero que
           nadie pidio, sin un solo aviso.

           Es la misma enfermedad que JFC ya hizo corregir en el PUT de
           ubicacion ("clampeaba silenciosamente"): ante un dato invalido se
           rechaza y se explica, nunca se adivina.

           Se conserva el contrato viejo para el caso legitimo: si no viene
           cantidad, es una venta de 1 (asi la manda el toque de producto, la
           accion mas frecuente de la app). Solo se rechaza lo que VINO y
           esta mal. Se acepta "3" como texto porque un input HTML devuelve
           texto, pero no 0, ni negativos, ni fracciones, ni letras.

           NOTA: amigable-123 tiene exactamente el mismo defecto en su
           propio mock-backend. No se toca desde aqui (regla 1b: se injerta
           por repo, nunca se sobreescribe entre hermanas). */
        var cant;
        if (body.cantidad === undefined || body.cantidad === null || body.cantidad === "") {
          cant = 1;
        } else {
          cant = Number(body.cantidad);
          if (!Number.isFinite(cant) || !Number.isInteger(cant) || cant <= 0) {
            return J({ error: "The quantity must be a whole number greater than zero." }, 400);
          }
        }
        if (p.stockActual < cant) return J({ error: `No hay suficiente stock disponible (quedan ${p.stockActual}).` }, 400);
        // Free-tier: sin dispositivo activado (PIN 789), tope de 100 ventas/mes (global).
        if (!estaLicenciado() && ventasCountMesGlobal() >= 100) {
          return J({ error: `Without activation this device is limited to 100 sales per month. Activate it (PIN 789) to start your full ${(window.OCPrueba && window.OCPrueba.PRUEBA_DIAS) || 30}-day trial.`, codigo: "LIMITE_VENTAS" }, 403);
        }
        /* BUG CRITICO reportado en vivo por una clienta (Idiomarte, 2026-07-29),
           arreglado en amigable-123 y portado aqui: "puse que la clase es de
           $150 pero me hace la comision sobre $20". Para un producto tipo
           ticket/evento el precio REAL de cada venta es el que la persona
           escribe en "cuanto pago" — el del catalogo es solo una referencia,
           porque cada funcion, cada cupo y cada paquete valen distinto. Cobrar
           la comision sobre el precio de catalogo le quita plata real a quien
           vende. */
        const _infoPago = (body && typeof body.info === "object" && body.info) ? body.info : {};
        const _esTicket = (p.tipoProducto || "normal") === "ticket";
        const _pagado = Number(_infoPago.montoPagado);
        /* CORTESIA (JFC 2026-09-08, "hay costo pero no precio"): una venta de
           cortesía sale del stock y CONSERVA su costoUnit (el costo se contabiliza),
           pero su precioUnit es 0 — no genera ingreso ni comisión (no hay monto que
           repartir). Se marca cortesia:true en info para que reportes y la lista de
           ventas la distingan. */
        const _esCortesia = !!_infoPago.cortesia;
        /* PRECIO POR VENTA (JFC/Belén 2026-09-15). Prioridad:
           1) cortesía => 0 (sin ingreso).
           2) precioOverride: monto libre que el cajero puso en "Adjust price"
              para ESTA venta (descuento puntual, o el precio de casa que se
              llenó de un toque). Debe ser un número finito >= 0.
           3) ticket con montoPagado => ese monto.
           4) el precio de lista del producto.
           El stock baja igual (una unidad es una unidad); solo cambia el
           precioUnit registrado. No inventa un segundo producto. */
        const _override = Number(_infoPago.precioOverride);
        const precioEfectivo = _esCortesia
          ? 0
          : ((Number.isFinite(_override) && _override >= 0)
              ? _override
              : ((_esTicket && Number.isFinite(_pagado) && _pagado > 0) ? _pagado : p.precio));
        const montoBruto = precioEfectivo * cant;
        const acumuladoPrevio = ubicP ? ventasMesAcumuladas(ubicP.id) : 0;
        /* DISEÑO JFC (2026-09-22): COUNTER SALE pertenece íntegramente a la
           casa. Es una decisión por venta, no una edición de la percha: no se
           exige comisionista, no se crea split y no se desasigna a nadie del
           acuerdo permanente. Ausente conserva el contrato histórico. */
        const modoComision = body && body.modoComision === "counter" ? "counter" : "acuerdo";
        const split = modoComision === "counter"
          ? null
          : (ubicP ? calcularSplitVenta(ubicP, montoBruto, acumuladoPrevio) : null);
        p.stockActual -= cant;
        let clienteVenta = null;
        if (body.clienteId) {
          clienteVenta = clientes.find((c) => c.id === body.clienteId);
          if (!clienteVenta) return J({ error: "Customer not found." }, 404);
          if (clienteVenta.despedido) return J({ error: `"${clienteVenta.nombre}" is fired — no new sales allowed. Reactivate them from Customers if this was a mistake.` }, 400);
        }
        const ventaId = uuid("v");
        /* DATOS DEL EVENTO (portado de amigable-123, JFC 2026-08-18). Sin
           guardarlos, las ventas de una funcion o una clase quedan
           desperdigadas en la lista general y no hay forma de saber como fue
           "el concierto del sabado" sin filtrar por fecha a ojo. El tablero
           agrupa por el NOMBRE que se escribe aqui. */
        const infoBody = (body && typeof body.info === "object" && body.info) || {};
        /* SI EL PRODUCTO YA ES UN EVENTO, EL EVENTO ES EL PRODUCTO (JFC 2026-08-25).
           Un producto tipo "ticket" YA es un evento y tiene nombre: pedir (o
           elegir) el nombre del evento otra vez al vender es absurdo. Cuando se
           vende un ticket, el evento se toma del NOMBRE del propio producto,
           automaticamente, sin cajas ni selectores. Para productos normales
           sigue mandando el evento activo que venga en info (vender bebidas
           "en" un evento, por ejemplo). */
        const infoVenta = {
          nombreEvento: _esTicket
            ? String(p.nombre || "").trim().slice(0, 120)
            : String(infoBody.nombreEvento || "").trim().slice(0, 120),
          fechaEvento: String(infoBody.fechaEvento || "").trim().slice(0, 20),
          numPersonas: (infoBody.numPersonas !== undefined && infoBody.numPersonas !== "") ? Math.max(0, Number(infoBody.numPersonas) || 0) : null,
          nombrePagador: String(infoBody.nombrePagador || "").trim().slice(0, 120),
          email: String(infoBody.email || "").trim().slice(0, 120),
          whatsapp: String(infoBody.whatsapp || "").trim().slice(0, 40),
          formaPago: String(infoBody.formaPago || "").trim().slice(0, 20), // JFC 2026-08-26: forma de pago (portado de amigable)
          factura: String(infoBody.factura || "").trim().slice(0, 60), // JFC 2026-09-02: número de factura opcional
          montoPagado: (infoBody.montoPagado !== undefined && infoBody.montoPagado !== "") ? Math.max(0, Number(infoBody.montoPagado) || 0) : null,
          notas: String(infoBody.notas || "").trim().slice(0, 500), // JFC 2026-08-27: notas de la venta
          /* Bar (JFC 2026-08-27): servings vendidos y su equivalente en botellas. */
          servings: (infoBody.servings !== undefined && infoBody.servings !== "") ? Math.max(0, Number(infoBody.servings) || 0) : null,
          botellas: (infoBody.botellas !== undefined && infoBody.botellas !== "") ? Math.max(0, Number(infoBody.botellas) || 0) : null,
          cortesia: _esCortesia ? true : null, // JFC 2026-09-08: venta de cortesía (costo sí, precio 0).
        };
        const tieneInfoVenta = Object.values(infoVenta).some((v) => v !== "" && v !== null);
        ventas.push({ id: ventaId, productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: precioEfectivo, costoUnit: p.costo, fecha: new Date().toISOString(), split, modoComision, impuesto: _impuestoDeVenta(p, precioEfectivo, cant), liquidada: false, clienteId: clienteVenta ? clienteVenta.id : null, info: tieneInfoVenta ? infoVenta : null, rev: _revNueva() });
        mov("venta", { producto: p.nombre, cantidad: cant, total: +montoBruto.toFixed(2), ubicacion: nombreUbic(p.ubicacionId) });
        emitirOpStock("venta", { productoId: p.id, delta: -cant });
        return J({ producto: ficha(p), ventaId });
      }
      if ((m = path.match(/^\/api\/ventas\/([^/]+)\/anular$/))) {
        const idx = ventas.findIndex((v) => v.id === m[1] && !v.anulada);
        if (idx === -1) return J({ error: "This sale can no longer be voided (the window passed, or it was already voided)." }, 400);
        const venta = ventas[idx];
        // BUG FIJADO 2026-07-03: la UI muestra 5s de cuenta regresiva para
        // anular y luego oculta el botón, pero este endpoint aceptaba anular
        // cualquier venta pasada sin límite de tiempo (podía borrar ventas
        // ya liquidadas a un socio). Margen generoso sobre esos 5s.
        const VENTANA_ANULACION_MS = 30 * 1000;
        // FIX (code-review 2026-07-03): fecha ausente/invalida -> NaN -> "NaN >
        // 30000" es false -> anulable para siempre. Number.isFinite() falla
        // CERRADO (rechaza) en vez de abierto.
        const antiguedadMs = Date.now() - new Date(venta.fecha).getTime();
        if (!Number.isFinite(antiguedadMs) || antiguedadMs > VENTANA_ANULACION_MS) {
          return J({ error: "This sale can no longer be voided (the window passed, or it was already voided)." }, 400);
        }
        const p = productos.find((x) => x.id === venta.productoId);
        if (!p) return J({ error: "Product not found." }, 404);
        p.stockActual += venta.cantidad;
        venta.anulada = true; venta.rev = _revNueva();
        mov("anulacion", { producto: p.nombre, cantidad: venta.cantidad, ubicacion: nombreUbic(p.ubicacionId) });
        emitirOpStock("anulacion", { productoId: p.id, delta: venta.cantidad });
        return J({ producto: ficha(p) });
      }
      /* CANCELAR EX-POST (JFC 2026-09-02): "sobre todo en Sales/Sold debe haber
         cancelar ex post tambien". A diferencia de /anular (ventana de 30s para
         deshacer un toque recién hecho), esto permite cancelar una venta pasada
         cuando hubo un error. Protege la plata ya liquidada a un socio: si la
         venta ya se pagó a la casa/artista, NO se puede cancelar aquí (habría que
         corregir la liquidación). Todo queda en el log con usuario + dispositivo. */
      if ((m = path.match(/^\/api\/ventas\/([^/]+)\/cancelar$/)) && opts && opts.method === "POST") {
        // JFC 2026-09-03: el encargado TAMBIÉN puede corregir errores (cancelar).
        // La defensa contra abusos es el log (cada acción queda con usuario+rol+
        // dispositivo, tracking de tampering), no capar al encargado. Se exige
        // sesión (rol) y sigue bloqueado si la venta ya fue liquidada.
        const _rC = _rolLocal();
        if (_rC !== "dueno" && _rC !== "admin" && _rC !== "empleado") return J({ error: "Sign in to cancel a recorded sale." }, 403);
        const idx = ventas.findIndex((v) => v.id === m[1] && !v.anulada);
        if (idx === -1) return J({ error: "Sale not found (it may have already been cancelled)." }, 404);
        const venta = ventas[idx];
        if (venta.liquidada) return J({ error: "This sale was already settled to a partner. Fix the settlement in Commissions instead of cancelling." }, 400);
        const p = productos.find((x) => x.id === venta.productoId);
        if (!p) return J({ error: "Product not found." }, 404);
        const motivo = String((body && body.motivo) || "").trim().slice(0, 200);
        p.stockActual += venta.cantidad;
        venta.anulada = true; venta.rev = _revNueva();
        mov("cancelacion-ex-post", { producto: p.nombre, cantidad: venta.cantidad, ubicacion: nombreUbic(p.ubicacionId), montoRevertido: +((venta.precioUnit || 0) * venta.cantidad).toFixed(2), motivo: motivo || "(sin motivo)", ventaId: venta.id, fechaVenta: venta.fecha });
        emitirOpStock("cancelacion-ex-post", { productoId: p.id, delta: venta.cantidad });
        return J({ producto: ficha(p), ok: true });
      }
      /* EDITAR UNA VENTA (JFC 2026-09-02): la lista de Sold es editable con
         lapicitos "por si hubo errores". Se puede corregir cantidad, forma de
         pago, notas, número de factura y el cliente. Si cambia la cantidad se
         ajusta stock y se recalcula el split de comisión. Bloqueado si la venta
         ya fue liquidada (la plata ya se repartió). Todo va al log. */
      if ((m = path.match(/^\/api\/ventas\/([^/]+)$/)) && opts && opts.method === "PATCH") {
        // JFC 2026-09-03: el encargado también puede corregir errores (editar
        // cantidad/precio/pago/notas). El log registra quién+dispositivo (tampering).
        const _rE = _rolLocal();
        if (_rE !== "dueno" && _rE !== "admin" && _rE !== "empleado") return J({ error: "Sign in to edit a recorded sale." }, 403);
        const venta = ventas.find((v) => v.id === m[1] && !v.anulada);
        if (!venta) return J({ error: "Sale not found." }, 404);
        if (venta.liquidada) return J({ error: "This sale was already settled — it can no longer be edited." }, 400);
        const p = productos.find((x) => x.id === venta.productoId);
        if (!p) return J({ error: "Product not found." }, 404);
        const cambios = {};
        // Cantidad: ajusta stock (delta) y recalcula split.
        if (body.cantidad !== undefined && body.cantidad !== null && body.cantidad !== "") {
          const nueva = Math.max(1, Math.floor(Number(body.cantidad) || 1));
          const delta = nueva - venta.cantidad; // >0 = vender más (baja stock)
          if (delta > 0 && p.stockActual < delta) return J({ error: `Not enough stock to raise the quantity (only ${p.stockActual} left).` }, 400);
          if (delta !== 0) {
            p.stockActual -= delta;
            emitirOpStock("venta-editada", { productoId: p.id, delta: -delta });
            cambios.cantidad = { antes: venta.cantidad, ahora: nueva };
            venta.cantidad = nueva;
            const ubicP = ubicaciones.find((x) => x.id === venta.ubicacionId);
            if (ubicP && venta.split) {
              const montoBruto = (venta.precioUnit || 0) * nueva;
              const acumuladoPrevio = ventasMesAcumuladasExcl(ubicP.id, venta.id);
              venta.split = calcularSplitVenta(ubicP, montoBruto, acumuladoPrevio);
            }
          }
        }
        // Precio unitario: corregir un monto mal tecleado (JFC/Belén 2026-09-02:
        // "puse $150 y no 115"). Recalcula el split de comisión con el precio nuevo.
        if (body.precioUnit !== undefined && body.precioUnit !== null && body.precioUnit !== "") {
          const nuevoPrecio = Number(body.precioUnit);
          if (!Number.isFinite(nuevoPrecio) || nuevoPrecio < 0) return J({ error: "Enter a valid unit price." }, 400);
          const precioRedondo = +nuevoPrecio.toFixed(2);
          if (precioRedondo !== venta.precioUnit) {
            cambios.precioUnit = { antes: venta.precioUnit, ahora: precioRedondo };
            venta.precioUnit = precioRedondo;
            const ubicP2 = ubicaciones.find((x) => x.id === venta.ubicacionId);
            if (ubicP2 && venta.split) {
              const montoBruto2 = precioRedondo * (venta.cantidad || 1);
              venta.split = calcularSplitVenta(ubicP2, montoBruto2, ventasMesAcumuladasExcl(ubicP2.id, venta.id));
            }
          }
        }
        if (body.clienteId !== undefined) {
          if (body.clienteId) { const c = clientes.find((x) => x.id === body.clienteId); if (!c) return J({ error: "Customer not found." }, 404); venta.clienteId = c.id; }
          else venta.clienteId = null;
          cambios.clienteId = venta.clienteId;
        }
        if (body.info && typeof body.info === "object") {
          venta.info = venta.info || {};
          const iv = body.info;
          if (iv.formaPago !== undefined) venta.info.formaPago = String(iv.formaPago || "").slice(0, 20);
          if (iv.notas !== undefined) venta.info.notas = String(iv.notas || "").slice(0, 500);
          if (iv.factura !== undefined) venta.info.factura = String(iv.factura || "").slice(0, 60);
          if (iv.nombrePagador !== undefined) venta.info.nombrePagador = String(iv.nombrePagador || "").slice(0, 120);
          cambios.info = true;
        }
        mov("venta-editada", { producto: p.nombre, ventaId: venta.id, cambios });
        venta.rev = _revNueva();
        avisarCatalogoCambiado();
        return J({ producto: ficha(p), venta, ok: true });
      }
      /* EDITAR UN EVENTO (JFC 2026-09-02, micromejora #10): dueño/admin puede
         renombrar el evento y cambiar su fecha. Como el "evento" es el nombre que
         llevan las ventas (info.nombreEvento), se actualizan TODAS las ventas de
         ese evento de una sola vez. Todo al log. */
      if (path === "/api/eventos" && opts && opts.method === "PATCH") {
        const _rEv = _rolLocal();
        if (_rEv !== "dueno" && _rEv !== "admin") return J({ error: "Only the owner or an admin can edit an event." }, 403);
        const antes = String(body.nombreAnterior || "").trim();
        const nuevo = String(body.nombreNuevo || "").trim().slice(0, 120);
        const fechaNueva = body.fechaNueva !== undefined ? String(body.fechaNueva || "").trim().slice(0, 20) : null;
        if (!antes) return J({ error: "Missing the event to edit." }, 400);
        if (!nuevo) return J({ error: "Enter a name for the event." }, 400);
        let n = 0;
        ventasActivas().forEach((v) => {
          if (v.info && v.info.nombreEvento === antes) {
            v.info.nombreEvento = nuevo;
            if (fechaNueva !== null) v.info.fechaEvento = fechaNueva;
            v.rev = _revNueva();
            n++;
          }
        });
        mov("evento-editado", { antes, ahora: nuevo, fecha: fechaNueva || "", ventasAfectadas: n });
        if (n) avisarCatalogoCambiado();
        guardarEstadoLocal();
        return J({ ok: true, ventasAfectadas: n, nombre: nuevo, fecha: fechaNueva });
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/ajustar$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        const d = Number.isInteger(body.delta) ? body.delta : 0;
        // BUG FIX (2026-07-03): delta=0 es un entero valido, pasa la guarda de
        // arriba, no cambia el stock pero registra un movimiento en el log. Silencioso
        // y contaminante. Se rechaza explicitamente.
        if (d === 0) return J({ error: "The adjustment cannot be zero." }, 400);
        if (p.stockActual + d < 0) return J({ error: `That adjustment would push stock negative (currently: ${p.stockActual}).` }, 400);
        p.stockActual += d;
        mov("ajuste", { producto: p.nombre, delta: d, motivo: body.motivo || "Ajuste manual", stockResultante: p.stockActual, ubicacion: nombreUbic(p.ubicacionId) });
        emitirOpStock("ajuste", { productoId: p.id, delta: d });
        return J(ficha(p));
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/etiqueta$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        // Barcode y QR: ambos generados 100% locales (barcode128.js y
        // qrcode-local.js) — cero llamadas externas, funciona sin internet.
        const barcodeSvg = window.OCBarcode ? window.OCBarcode.code128SVG(p.barcode, { width: 300, height: 80 }) : "";
        /* El QR representa el código del producto, no una URL. La URL heredada
           apuntaba a AMIGABLE y Safari podía ofrecer abrir la app hermana al
           detectar el QR. Además, friendly no consumía ?sku, así que la promesa
           de "ver la ficha" era falsa. Un payload de código sirve en cualquier
           lector y no puede sacar al usuario de esta app. */
        const qrPayload = String(p.barcode || p.sku || "");
        return J({ producto: ficha(p), qrDataUrl: qrDataUrl(qrPayload), barcodeSvg });
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        return J(ficha(p));
      }

      if (path === "/api/escanear") {
        const c = String(body.codigo || "").trim().toLowerCase();
        if (!c) return J({ error: "Empty code." }, 400);
        const p = productos.find((x) => String(x.barcode).toLowerCase() === c || String(x.sku).toLowerCase() === c);
        if (!p) return J({ error: "No product found with that code." }, 404);
        return J(ficha(p));
      }

      if (path === "/api/actividad") return J(movimientos.slice().reverse().slice(0, 100));

      /* DIRECTORIO DE ACCESO (JFC 2026-08-28). Quién tiene cada PIN (nombre,
         correo, notas). Solo el dueño. Lo lee el dashboard para el reporte
         "quién tiene acceso". Viaja cifrado con el secreto; aquí solo se
         expone lo que el dueño ya puede ver en Advanced/Team. */
      if (path === "/api/directorio" && (!opts || opts.method === "GET")) {
        if (_rolLocal() !== "dueno") return J({ error: "Only the owner can see the access directory." }, 403);
        let dir = null;
        try { dir = (window.OCSecure && window.OCSecure.directorioNormalizado) ? window.OCSecure.directorioNormalizado() : null; } catch (_) {}
        return J({ directorio: dir });
      }

      // GASTOS (2026-08-27): registrar y listar gastos individuales.
      // GET /api/gastos — lista los gastos (más recientes primero) + totales.
      // POST /api/gastos — registra un gasto { concepto, monto, fecha, ubicacionId }.
      if (path === "/api/gastos" && (!opts || opts.method === "GET")) {
        const lista = gastos.filter((g) => !g.borrado).slice().reverse();
        const total = lista.reduce((a, g) => a + (Number(g.monto) || 0), 0);
        // JFC 2026-09-02: totales por categoría para el tablero y el resumen.
        const porCategoria = {};
        lista.forEach((g) => { const k = g.categoria || "other"; porCategoria[k] = (porCategoria[k] || 0) + (Number(g.monto) || 0); });
        Object.keys(porCategoria).forEach((k) => { porCategoria[k] = +porCategoria[k].toFixed(2); });
        return J({ gastos: lista, total, porCategoria });
      }
      if (path === "/api/gastos" && opts && opts.method === "POST") {
        const concepto = String(body.concepto || "").trim();
        const monto = Number(body.monto);
        if (!concepto) return J({ error: "Enter a description for the expense." }, 400);
        if (!Number.isFinite(monto) || monto <= 0) return J({ error: "Enter a valid amount." }, 400);
        // JFC 2026-09-02: categoría de gasto (best-practice sirve en USA y Ecuador).
        // Claves canónicas neutrales; la etiqueta visible la traduce la UI.
        const CATS_GASTO = ["rent", "utilities", "inventory", "payroll", "services", "marketing", "transport", "taxes", "maintenance", "other"];
        const categoria = CATS_GASTO.includes(String(body.categoria || "")) ? String(body.categoria) : "other";
        const g = {
          id: uuid("g"), concepto, monto: +monto.toFixed(2),
          categoria,
          factura: String(body.factura || "").trim().slice(0, 60), // JFC 2026-09-08: nº factura/invoice del proveedor (control tributario básico).
          fecha: body.fecha || new Date().toISOString(),
          ubicacionId: body.ubicacionId || "todas",
          usuarioId: (window.OCCurrentUser && window.OCCurrentUser.id) || "sistema",
          usuarioNombre: (window.OCCurrentUser && window.OCCurrentUser.nombre) || "Sistema", rev: _revNueva(),
        };
        gastos.push(g);
        mov("gasto", { concepto, monto: g.monto, categoria, ubicacionId: g.ubicacionId });
        guardarEstadoLocal();
        return J(g);
      }
      // DELETE /api/gastos/:id — anula un gasto (solo dueño/admin/contador). Deja constancia.
      const mGastoDel = path.match(/^\/api\/gastos\/([^/]+)$/);
      if (mGastoDel && opts && opts.method === "DELETE") {
        const _rDel = _rolLocal();
        if (_rDel !== "dueno" && _rDel !== "admin" && _rDel !== "contador") return J({ error: "Only the owner, an admin or the bookkeeper can delete expenses." }, 403);
        const idx = gastos.findIndex((x) => x.id === mGastoDel[1] && !x.borrado);
        if (idx < 0) return J({ error: "Expense not found." }, 404);
        const g = gastos[idx]; g.borrado = true; g.rev = _revNueva();
        mov("gasto-anulado", { concepto: g.concepto, monto: g.monto });
        guardarEstadoLocal();
        return J({ ok: true });
      }
      // PATCH /api/gastos/:id — edita concepto/monto/fecha de un gasto (JFC 2026-08-27).
      if (mGastoDel && opts && opts.method === "PATCH") {
        const _rPat = _rolLocal();
        if (_rPat !== "dueno" && _rPat !== "admin" && _rPat !== "contador") return J({ error: "Only the owner, an admin or the bookkeeper can edit expenses." }, 403);
        const g = gastos.find((x) => x.id === mGastoDel[1] && !x.borrado);
        if (!g) return J({ error: "Expense not found." }, 404);
        if (body.concepto !== undefined) {
          const c = String(body.concepto).trim();
          if (!c) return J({ error: "Enter a description for the expense." }, 400);
          g.concepto = c;
        }
        if (body.monto !== undefined) {
          const m = Number(body.monto);
          if (!Number.isFinite(m) || m <= 0) return J({ error: "Enter a valid amount." }, 400);
          g.monto = +m.toFixed(2);
        }
        if (body.fecha !== undefined) g.fecha = body.fecha;
        if (body.categoria !== undefined) {
          const CATS_GASTO = ["rent", "utilities", "inventory", "payroll", "services", "marketing", "transport", "taxes", "maintenance", "other"];
          g.categoria = CATS_GASTO.includes(String(body.categoria)) ? String(body.categoria) : (g.categoria || "other");
        }
        g.rev = _revNueva();
        mov("gasto-editado", { concepto: g.concepto, monto: g.monto, categoria: g.categoria });
        guardarEstadoLocal();
        return J(g);
      }

      // GET /api/movimientos?limite=N — últimos N movimientos (log), solo lectura.
      // Lo usa el tablero (dashboard.html) para pintar el periscopio de datos.
      if (path === "/api/movimientos" && (!opts || opts.method === "GET")) {
        const n = Math.min(Number(q.get("limite")) || 200, 500);
        return J(movimientos.slice(-n).reverse());
      }

      // Estrella: dueño marca/desmarca productos para que el encargado promueva
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/estrella$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        p.estrella = !p.estrella;
        mov("estrella", { producto: p.nombre, accion: p.estrella ? "marcado" : "desmarcado" });
        return J({ estrella: p.estrella });
      }

      if (path === "/api/respaldo/exportar") {
        return J(estadoActualExportable());
      }
      if (path === "/api/respaldo/importar") {
        try {
          // BUG FIJADO 2026-07-03 y ampliado 2026-07-05 (item 19): antes solo
          // se comprobaba que fueran arrays; ahora validarRespaldo() revisa
          // ids unicos, numeros finitos/no negativos y referencias a perchas
          // existentes antes de tocar nada. Un respaldo corrupto ya no puede
          // dejar la app inservible.
          const error = validarRespaldo(body);
          if (error) return J({ error }, 400);
          try { localStorage.setItem(OC_STATE_KEY + "_preimport", JSON.stringify(estadoActualExportable())); } catch (_) {} // red de seguridad 2026-07-17: snapshot pre-import para deshacer un archivo malo
          aplicarRespaldo(body);
          guardarEstadoLocal();
          return J({ ok: true, schemaVersion: body.schemaVersion || 1 });
        } catch (e) { return J({ error: "Could not import: " + String(e) }, 400); }
      }

      if (path === "/api/liquidaciones") return J(getLiquidaciones());
    if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)\/panorama$/))) {
      const pan = getPanoramaPercha(m[1]);
      if (!pan) return J({ error: "Shelf not found." }, 404);
      return J(pan);
    }
    if ((m = path.match(/^\/api\/ventas\/([^/]+)\/comision$/)) && opts && opts.method === "PATCH") {
      const r = corregirComisionVenta(m[1], body.comisionPct, body.quien, body.motivo);
      if (r.error) return J({ error: r.error }, r.status || 400);
      return J(r);
    }
    if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)\/comisiones-del-mes$/)) && opts && opts.method === "PATCH") {
      const r = corregirComisionesDelMes(m[1], body.comisionPct, body.quien, body.motivo, body.soloPendientes !== false);
      if (r.error) return J({ error: r.error }, r.status || 400);
      return J(r);
    }
      /* GUARD DE METODO (JFC 2026-09-22): este endpoint SELLA ventas como
         liquidadas — es una escritura de dinero y no debe poder dispararse con
         un GET. Le faltaba el `opts.method` que si tienen sus 17 vecinos, asi
         que la ruta matcheaba con cualquier verbo. Hoy el unico llamador real
         (index.html ~L7758) ya manda POST, asi que agregar el guard NO cambia
         el comportamiento de nada que funcione: solo cierra la puerta a que un
         prefetch, un proxy o una herramienta de diagnostico liquide ventas sin
         que nadie lo pidiera. Un verbo distinto cae al 404 del router (~L4490),
         igual que en todos los demas endpoints. */
      if ((m = path.match(/^\/api\/liquidaciones\/([^/]+)\/marcar-pagado$/)) && opts && opts.method === "POST") {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Location not found." }, 404);
        const pend = ventasActivas().filter((v) => v.ubicacionId === m[1] && esDelMesActual(v.fecha) && !v.liquidada);
        pend.forEach((v) => { v.liquidada = true; v.rev = _revNueva(); });
        mov("liquidacion", { ubicacion: u.nombre, ventasLiquidadas: pend.length });
        if (pend.length) avisarCatalogoCambiado();
        return J({ ok: true, ventasLiquidadas: pend.length });
      }

      if ((m = path.match(/^\/api\/productos\/([^/]+)\/hermanos$/))) {
        return J(getHermanosPercha(m[1]));
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/clonar-percha$/)) && opts && opts.method === "POST") {
        const origen = productos.find((x) => x.id === m[1]);
        if (!origen) return J({ error: "Product not found." }, 404);
        const destUbic = ubicaciones.find((u) => u.id === body.ubicacionId && u.activa !== false);
        if (!destUbic) return J({ error: "That shelf does not exist or is switched off." }, 400);
        if (productos.some((x) => x.sku === origen.sku && x.ubicacionId === destUbic.id)) return J({ error: `Este producto ya tiene una fila en "${destUbic.nombre}". Usa Transferir en vez de Agregar percha.` }, 400);
        const clon = { id: uuid("p"), nombre: origen.nombre, categoria: origen.categoria, sku: origen.sku, barcode: origen.barcode, ubicacionId: destUbic.id, precio: origen.precio, costo: origen.costo || 0, stockActual: 0, umbralRojo: origen.umbralRojo, umbralAmarillo: origen.umbralAmarillo, proveedor: origen.proveedor || "", tipoProveedor: origen.tipoProveedor || "compra", comisionProveedorPct: origen.comisionProveedorPct || 0, perecible: !!origen.perecible, exentoImpuesto: !!origen.exentoImpuesto, fechaCaducidad: origen.perecible ? (origen.fechaCaducidad || null) : null, metodoCosteo: origen.metodoCosteo || "FIFO", tipoProducto: origen.tipoProducto || "normal", servingMl: origen.servingMl || 50, botellaMl: origen.botellaMl || 750, foto: origen.foto || null, creadoEn: new Date().toISOString() };
        productos.push(clon);
        mov("alta-percha", { producto: clon.nombre, sku: clon.sku, desde: nombreUbic(origen.ubicacionId), hacia: destUbic.nombre });
        return J(ficha(clon));
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/sugerencias-transferencia$/))) {
        return J(getSugerenciasTransferencia(m[1]));
      }
      if (path === "/api/transferencias" && (!opts || opts.method !== "POST")) {
        return J(transferencias.slice().reverse());
      }
      if (path === "/api/transferencias" && opts && opts.method === "POST") {
        const origen = productos.find((x) => x.id === body.productoOrigenId);
        const destino = productos.find((x) => x.id === body.productoDestinoId);
        if (!origen || !destino) return J({ error: "Product not found." }, 404);
        /* B20 (JFC 2026-09-09, caza 33, medido contra el endpoint real): se
           aceptaba una transferencia de un producto A SI MISMO. Devolvia 200,
           y al aprobarla el stock bajaba de 20 a 18 con destino la MISMA
           percha de la que nunca salio. Esas 2 unidades quedaban en transito
           hacia donde ya estaban: invisibles en el inventario, y perdidas del
           todo si nadie confirmaba la recepcion.

           Se rechazan los dos casos sin sentido: el mismo producto, y dos
           productos que ya estan en la misma percha (mover algo dentro de una
           percha no es una transferencia). Comprobado contra los datos antes
           de escribir la segunda regla: no existe ningun par de productos con
           el mismo SKU en una misma percha, asi que no bloquea nada legitimo. */
        if (origen.id === destino.id) return J({ error: "Origin and destination are the same product." }, 400);
        if (origen.ubicacionId === destino.ubicacionId) return J({ error: "Both products are already on the same shelf — there is nothing to transfer." }, 400);
        if (origen.sku !== destino.sku) return J({ error: "The source and destination products are not the same item (different SKU)." }, 400);
        const cant = Number(body.cantidad);
        if (!Number.isInteger(cant) || cant <= 0) return J({ error: "The quantity must be a whole number greater than 0." }, 400);
        if (origen.stockActual < cant) return J({ error: `"${origen.nombre}" solo tiene ${origen.stockActual} unidades en origen.` }, 400);
        const t = { id: uuid("t"), productoOrigenId: origen.id, productoDestinoId: destino.id, sku: origen.sku, nombre: origen.nombre, desde: origen.ubicacionId, desdeNombre: nombreUbic(origen.ubicacionId), hacia: destino.ubicacionId, haciaNombre: nombreUbic(destino.ubicacionId), cantidad: cant, estado: "solicitada", fecha: new Date().toISOString(), rev: _revNueva() };
        transferencias.push(t);
        mov("transferencia-solicitada", { producto: t.nombre, cantidad: cant, desde: t.desdeNombre, hacia: t.haciaNombre });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/aprobar$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transfer not found." }, 404);
        if (t.estado !== "solicitada") return J({ error: `Esta transferencia ya está en estado "${t.estado}".` }, 400);
        const origen = productos.find((x) => x.id === t.productoOrigenId);
        if (!origen || origen.stockActual < t.cantidad) return J({ error: "There is no longer enough stock at the source to approve this transfer." }, 400);
        origen.stockActual -= t.cantidad;
        t.estado = "en_transito"; t.rev = _revNueva();
        mov("transferencia-aprobada", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
        emitirOpStock("transferencia-aprobada", { productoId: origen.id, delta: -t.cantidad });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/confirmar-recepcion$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transfer not found." }, 404);
        if (t.estado !== "en_transito") return J({ error: `Esta transferencia está "${t.estado}", no se puede confirmar recepción.` }, 400);
        const destino = productos.find((x) => x.id === t.productoDestinoId);
        if (!destino) return J({ error: "Destination product not found." }, 404);
        destino.stockActual += t.cantidad;
        t.estado = "recibida"; t.rev = _revNueva();
        mov("transferencia-recibida", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
        emitirOpStock("transferencia-recibida", { productoId: destino.id, delta: t.cantidad });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/rechazar$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transfer not found." }, 404);
        if (t.estado !== "solicitada") return J({ error: `Esta transferencia ya está en estado "${t.estado}".` }, 400);
        t.estado = "rechazada"; t.rev = _revNueva();
        avisarCatalogoCambiado();
        return J(t);
      }

      if (path === "/api/configuracion/gastos" && (!opts || opts.method !== "POST")) {
        if (!uid || uid === "todas") return J({ ubicacionId: "todas", gastosMensuales: +Object.values(gastosMensuales).reduce((a, v) => a + v, 0).toFixed(2), porUbicacion: gastosMensuales });
        return J({ ubicacionId: uid, gastosMensuales: gastosMensuales[uid] || 0 });
      }
      if (path === "/api/configuracion/gastos") {
        const { ubicacionId, gastosMensuales: g } = body; const monto = Number(g);
        // BUG FIJADO (JFC, 2026-07-01): esta excepción de "todas" es correcta
        // en Olimpo (ubicaciones DORMANT ahí, una sola tienda virtual), pero
        // se copió sin adaptar a AMIGABLE, donde ubicaciones SÍ está activo.
        // Guardar bajo "todas" aquí crearía una clave fantasma que se suma
        // aparte de los locales reales, inflando el total. AMIGABLE exige
        // una ubicación específica, como siempre debió ser.
        if (!ubicacionId || ubicacionId === "todas") return J({ error: "Pick a specific location to save its monthly expenses." }, 400);
        if (!isFinite(monto) || monto < 0) return J({ error: "The amount must be a number equal to or greater than 0." }, 400);
        gastosMensuales[ubicacionId] = +monto.toFixed(2);
        const _uGasto = ubicaciones.find((x) => x.id === ubicacionId);
        if (_uGasto) _uGasto.gastoMensualRev = _revNueva();
        avisarCatalogoCambiado();
        return J({ ubicacionId, gastosMensuales: gastosMensuales[ubicacionId] });
      }

      // Ajuste de impuesto del cuaderno (v359). Leer: cualquiera. Cambiar:
      // dueño o admin. Es una escritura normal: pasa por la compuerta de la
      // prueba vencida y se persiste/sincroniza como el resto.
      if (path === "/api/config/impuesto" && method === "GET") {
        return J(ajusteImpuesto ? Object.assign({}, ajusteImpuesto) : { id: "impuesto", activo: false, tasa: 0, nombre: "Sales tax", rev: null });
      }
      if (path === "/api/config/impuesto" && method === "PUT") {
        const _r = _rolLocal();
        if (_r !== "dueno" && _r !== "admin") return J({ error: "Only the owner or an admin can change the tax setting." }, 403);
        const n = _normImpuesto({ id: "impuesto", activo: body.activo, tasa: body.tasa, nombre: body.nombre, modo: body.modo });
        if (!n) return J({ error: "The tax rate must be between 0 and 100." }, 400);
        // v360 (Hugo/Paco/Luis #23): encendido con tasa 0 decía "guardado" y no hacía nada.
        if (n.activo && !(n.tasa > 0)) return J({ error: "Turn the tax on with a rate above 0 %.", codigo: "TASA_CERO" }, 400);
        n.rev = _revNueva();
        ajusteImpuesto = n;
        mov("config-impuesto", { activo: n.activo, tasa: n.tasa, nombre: n.nombre, modo: n.modo });
        return J(Object.assign({}, n));
      }
      if (path === "/api/config/moneda" && method === "GET") return J({ id: "moneda", codigo: window.OCMoneda.codigo() });
      if (path === "/api/config/moneda" && method === "PUT") {
        const _r2 = _rolLocal();
        if (_r2 !== "dueno" && _r2 !== "admin") return J({ error: "Only the owner or an admin can change the currency." }, 403);
        const m = _normMoneda({ id: "moneda", codigo: body.codigo });
        if (!m) return J({ error: "Use a 3-letter currency code (USD, EUR, MXN...)." }, 400);
        m.rev = _revNueva(); ajusteMoneda = m;
        mov("config-moneda", { codigo: m.codigo });
        return J(Object.assign({}, m));
      }
      if (path === "/api/reportes/pl") {
        // Precio de venta = precio neto, sin impuesto embebido (estandar USA:
        // el sales tax se calcula aparte en el checkout, no vive incluido en
        // el precio listado como el IVA ecuatoriano). Fix 2026-07-15: antes
        // esto restaba un 15% fijo de IVA-Ecuador sobre CUALQUIER venta,
        // corrompiendo el P&L en cualquier tienda fuera de Ecuador.
        const vh = ventasHoyDe(uid);
        const ing = vh.reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
        const cv = vh.reduce((a, v) => a + v.costoUnit * v.cantidad, 0);
        /* v359: si el cuaderno tiene impuesto encendido, el precio lo INCLUYE
           y aquí se separa. Apagado: precio neto, como antes. ingresosConIva e
           ivaCobrado se mantienen como alias para los lectores existentes (antes
           llegaban vacíos: la fila "VAT 15%" sin valor y Cash en $0). */
        const imp = _impuestoVigente();
        // v361: cada venta trae su impuesto congelado (ver _impuestoDeVenta).
        let netoC = 0, impC = 0, cobradoC = 0;
        vh.forEach((v) => {
          const linC = Math.round((Number(v.precioUnit) || 0) * (Number(v.cantidad) || 0) * 100);
          const im = v.impuesto && Number(v.impuesto.monto) > 0 ? Math.round(Number(v.impuesto.monto) * 100) : 0;
          if (!im) { netoC += linC; cobradoC += linC; }
          else if (v.impuesto.modo === "agregado") { netoC += linC; impC += im; cobradoC += linC + im; }
          else { netoC += linC - im; impC += im; cobradoC += linC; }
        });
        const neto = netoC / 100, impCobrado = impC / 100;
        const ub = neto - cv;
        const gm = (!uid || uid === "todas") ? Object.values(gastosMensuales).reduce((a, v) => a + v, 0) : (gastosMensuales[uid] || 0);
        const go = +(gm / diasEnMesActual()).toFixed(2);
        return J({ ingresos: +neto.toFixed(2), ingresosConIva: +(cobradoC / 100).toFixed(2), ivaCobrado: +impCobrado.toFixed(2),
          impuesto: imp ? { activo: true, tasa: imp.tasa, nombre: imp.nombre, modo: imp.modo } : { activo: impC > 0, tasa: null, nombre: "Tax", modo: null },
          costoVentas: +cv.toFixed(2), utilidadBruta: +ub.toFixed(2), gastosOperativos: go, utilidadNeta: +(ub - go).toFixed(2) });
      }
      if (path === "/api/reportes/balance") {
        const ps = filtrar(uid), vh = ventasHoyDe(uid);
        // v361: lo cobrado incluye el impuesto que se SUMÓ al cobrar (modo agregado).
        const ef = vh.reduce((a, v) => a + v.precioUnit * v.cantidad + (v.impuesto && v.impuesto.modo === "agregado" ? (Number(v.impuesto.monto) || 0) : 0), 0);
        const inv = ps.reduce((a, p) => a + p.precio * p.stockActual, 0);
        return J({ activos: { efectivoEstimado: +ef.toFixed(2), inventarioValorizado: +inv.toFixed(2), total: +(ef + inv).toFixed(2) } });
      }
      if (path === "/api/reportes/valorizado") {
        const filas = filtrar(uid).map((p) => ({ nombre: p.nombre, stockActual: p.stockActual, valorCosto: +(p.costo * p.stockActual).toFixed(2), valorVenta: +(p.precio * p.stockActual).toFixed(2), utilidadPotencial: +((p.precio - p.costo) * p.stockActual).toFixed(2) }));
        const t = filas.reduce((a, f) => ({ valorCosto: a.valorCosto + f.valorCosto, valorVenta: a.valorVenta + f.valorVenta, utilidadPotencial: a.utilidadPotencial + f.utilidadPotencial }), { valorCosto: 0, valorVenta: 0, utilidadPotencial: 0 });
        return J({ productos: filas, totales: { valorCosto: +t.valorCosto.toFixed(2), valorVenta: +t.valorVenta.toFixed(2), utilidadPotencial: +t.utilidadPotencial.toFixed(2) } });
      }

      // Unidades vendidas HOY por producto (el cierre del dia las muestra
      // como referencia: lo tecleado ahi es ADICIONAL, jamas se pre-carga
      // como cantidad — eso duplicaria ventas al aplicar).
      if (path === "/api/ventas/todas") {
      /* Solo lectura, ya enriquecida con nombres: la arma el backend para que
         el tablero no tenga que cruzar tablas por su cuenta (que es como dos
         pantallas terminan mostrando dos numeros distintos del mismo negocio).
         Portado desde amigable-123 (JFC 2026-08-18). */
      return J(ventasActivas().filter((v) => !uid || uid === "todas" || v.ubicacionId === uid).map((v) => {
        const p = productos.find((x) => x.id === v.productoId);
        const c = clientes.find((x) => x.id === v.clienteId);
        const u = ubicaciones.find((x) => x.id === v.ubicacionId);
        const pr = u && u.promotoraId ? promotoras.find((x) => x.id === u.promotoraId) : null;
        return {
          id: v.id, fecha: v.fecha,
          productoId: v.productoId,
          productoNombre: p ? p.nombre : "(deleted product)",
          sku: p ? p.sku : "", categoria: p ? p.categoria : "",
          cantidad: v.cantidad, precioUnit: v.precioUnit, costoUnit: v.costoUnit || 0,
          clienteNombre: c ? c.nombre : "",
          ubicacionId: v.ubicacionId, ubicacionNombre: nombreUbic(v.ubicacionId),
          tipoProducto: p ? (p.tipoProducto || "normal") : "normal",
          eventoNombre: (v.info && v.info.nombreEvento) || "",
          eventoFecha: (v.info && v.info.fechaEvento) || "",
          eventoPersonas: (v.info && v.info.numPersonas) || null,
          pagador: (v.info && v.info.nombrePagador) || "",
          formaPago: (v.info && v.info.formaPago) || "",
          factura: (v.info && v.info.factura) || "",
          cortesia: !!(v.info && v.info.cortesia), // JFC 2026-09-08: venta de cortesía.
          notas: (v.info && v.info.notas) || "",
          clienteId: v.clienteId || "",
          servings: (v.info && v.info.servings) || null,
          botellas: (v.info && v.info.botellas) || null,
          comisionPct: v.split ? v.split.comisionPct : null,
          comisionAsociado: v.split ? v.split.montoComisionSocio : 0,
          netoCasa: v.split ? v.split.montoNetoDueno : null,
          modoComision: v.modoComision || (v.split ? "acuerdo" : "counter"),
          comisionCorregida: !!(v.split && v.split.corregida),
          liquidada: !!v.liquidada,
          // COUNTER SALE no se atribuye a la persona permanente de la percha:
          // el nombre acompaña solo a ventas que realmente tienen reparto.
          asociadoNombre: v.split && pr ? pr.nombre : "",
        };
      }));
    }
    if (path === "/api/ventas/hoy") {
        const agregado = {};
        ventasHoyDe(uid).forEach((v) => { agregado[v.productoId] = (agregado[v.productoId] || 0) + v.cantidad; });
        return J(agregado);
      }

      // ---- CIERRE DEL DIA (JFC 2026-07-07) ----
      // Conciliacion: el dueno que no registra en vivo apunta cuantas
      // unidades salieron hoy de cada producto y esto genera las ventas de
      // una sola vez (misma logica de split/comisiones que la venta normal).
      // Se aplican los items validos y se reportan los que no calzan.
      if (path === "/api/ventas/cierre" && opts && opts.method === "POST") {
        if (!estaLicenciado()) return J({ error: "Activate this device (PIN 789) to use day close." }, 403);
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return J({ error: "There are no quantities to apply." }, 400);
        const errores = [];
        let aplicadas = 0;
        for (const it of items) {
          const p = productos.find((x) => x.id === it.productoId);
          const cant = Number(it.cantidad);
          if (!p || !Number.isInteger(cant) || cant <= 0) { errores.push("There is an invalid item in the day close."); continue; }
          if (p.stockActual < cant) { errores.push(`${p.nombre}: solo hay ${p.stockActual} en stock.`); continue; }
          const ubicP = ubicaciones.find((x) => x.id === p.ubicacionId);
          const acumulado = ubicP ? ventasMesAcumuladas(ubicP.id) : 0;
          const split = ubicP ? calcularSplitVenta(ubicP, p.precio * cant, acumulado) : null;
          p.stockActual -= cant;
          ventas.push({ id: uuid("v"), productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: p.precio, costoUnit: p.costo, fecha: new Date().toISOString(), split, liquidada: false, clienteId: null, impuesto: _impuestoDeVenta(p, p.precio, cant), rev: _revNueva() });
          emitirOpStock("cierre-dia", { productoId: p.id, delta: -cant });
          aplicadas += cant;
          mov("cierre-dia", { producto: p.nombre, cantidad: cant, ubicacion: nombreUbic(p.ubicacionId) });
        }
        return J({ ok: true, aplicadas, errores });
      }

      // ---- CLIENTES (2026-07-07) ----
      if (path === "/api/clientes" && (!opts || opts.method !== "POST")) {
        const med = medianaMontos();
        // Clientes despedidos no aparecen en el selector de Vender ni en listas operativas.
        return J(clientes.filter(c => !c.despedido && !c.borrado).map((c) => fichaCliente(c, med)));
      }
      if (path === "/api/clientes" && opts && opts.method === "POST") {
        if (!body.nombre || !String(body.nombre).trim()) return J({ error: "The customer name is required." }, 400);
        /* EMAIL DEL CLIENTE (JFC 2026-08-26): captura opcional. Validación ligera
           "guard, no puerta": si trae algo que no parece email, se guarda vacío en
           vez de rechazar el alta (no queremos frenar el registro por un typo). */
        const _emailCli = String(body.email || "").trim().slice(0, 160);
        const _emailOk = _emailCli && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(_emailCli) ? _emailCli : "";
        const nuevoCli = { id: uuid("c"), codigo: siguienteCodigoCliente(), nombre: String(body.nombre).trim(), telefono: String(body.telefono || "").trim(), email: _emailOk, rev: _revNueva() };
        clientes.push(nuevoCli);
        mov("cliente-alta", { cliente: nuevoCli.nombre, codigo: nuevoCli.codigo });
        return J(fichaCliente(nuevoCli));
      }
      if (path === "/api/clientes/importar" && opts && opts.method === "POST") {
        const entrantes = Array.isArray(body.clientes) ? body.clientes : [];
        if (!entrantes.length) return J({ error: "There are no customers to import." }, 400);
        if (entrantes.length > 5000) return J({ error: "Too many customers at once (5000 max)." }, 400);
        // Dedup por nombre (insensible a mayusculas) contra los existentes Y
        // dentro del mismo archivo — un CSV con repetidos no crea gemelos.
        const existentes = new Set(clientes.map((c) => String(c.nombre).trim().toLowerCase()));
        let agregados = 0, repetidos = 0, invalidos = 0;
        for (const e of entrantes) {
          const nombre = String((e && e.nombre) || "").trim().slice(0, 120);
          if (!nombre) { invalidos++; continue; }
          if (existentes.has(nombre.toLowerCase())) { repetidos++; continue; }
          const nuevo = { id: uuid("c"), codigo: siguienteCodigoCliente(), nombre, telefono: String((e && e.telefono) || "").trim().slice(0, 40), rev: _revNueva() };
          clientes.push(nuevo);
          existentes.add(nombre.toLowerCase());
          agregados++;
        }
        if (agregados) mov("clientes-importados", { cantidad: agregados });
        return J({ ok: true, agregados, repetidos, invalidos });
      }
      if (path === "/api/clientes/matriz") {
        const med = medianaMontos();
        const grupos = { verano: [], primavera: [], otono: [], invierno: [] };
        clientes.filter(c => !c.despedido && !c.borrado).forEach((c) => { const f = fichaCliente(c, med); grupos[f.estacion].push(f); });
        Object.keys(grupos).forEach((k) => grupos[k].sort((a, b) => b.monto - a.monto));
        return J(grupos);
      }

      // Matriz de comportamiento: agrupa por cuadrante trato×confiabilidad.
      // estrella=+/+  tolerable=-/+  ojo=+/-  bandera=-/-  neutro=cualquier 0
      if (path === "/api/clientes/comportamiento") {
        const med = medianaMontos();
        const grupos = { estrella: [], tolerable: [], ojo: [], bandera: [], neutro: [], despedidos: [] };
        clientes.filter((c) => !c.borrado).forEach((c) => {
          const f = fichaCliente(c, med);
          if (c.despedido) { grupos.despedidos.push(f); return; }
          // JFC 2026-08-06: evaluacion.trato/confiabilidad son 1-5 (no -1/0/1);
          // nivel() los normaliza igual que en amigable-123 (4-5=positivo, 1-2=negativo).
          const nivel = (v) => (v >= 4 ? 1 : (v > 0 && v <= 2) ? -1 : 0);
          const t = nivel(f.evaluacion.trato), cv = nivel(f.evaluacion.confiabilidad);
          if (t === 1 && cv === 1)  grupos.estrella.push(f);
          else if (t === -1 && cv === 1) grupos.tolerable.push(f);
          else if (t === 1 && cv === -1) grupos.ojo.push(f);
          else if (t === -1 && cv === -1) grupos.bandera.push(f);
          else grupos.neutro.push(f);
        });
        return J(grupos);
      }

      // PATCH /api/clientes/:id/evaluacion — actualiza trato y/o confiabilidad.
      // Registra en historial con atribución del usuario en sesión.
      const mCliEv = path.match(/^\/api\/clientes\/([^/]+)\/evaluacion$/);
      if (mCliEv && opts && opts.method === "PATCH") {
        const c = clientes.find((x) => x.id === mCliEv[1]);
        if (!c || c.borrado) return J({ error: "Customer not found." }, 404);
        // JFC 2026-08-06: unico sistema de calificar en TODAS las apps es el de
        // amigable-123 -- escala 1-5 (0=sin calificar), NO el tri-estado -1/0/1
        // que se habia introducido aqui por error.
        if (!c.evaluacion) c.evaluacion = { trato: 0, confiabilidad: 0, historial: [] };
        if (body.trato !== undefined) c.evaluacion.trato = Math.max(0, Math.min(5, Number(body.trato)||0));
        if (body.confiabilidad !== undefined) c.evaluacion.confiabilidad = Math.max(0, Math.min(5, Number(body.confiabilidad)||0));
        c.evaluacion.historial = c.evaluacion.historial || [];
        // horaIncidente: hora local del evento según el encargado (HH:MM), para conciliación con cámaras/audios.
        c.evaluacion.historial.push({ trato: c.evaluacion.trato, confiabilidad: c.evaluacion.confiabilidad, quien: body.quien || "Sistema", fecha: new Date().toISOString(), horaIncidente: body.horaIncidente || null });
        c.rev = _revNueva();
        mov("cliente-evaluado", { cliente: c.nombre, trato: c.evaluacion.trato, confiabilidad: c.evaluacion.confiabilidad, horaIncidente: body.horaIncidente || null });
        guardarEstadoLocal();
        return J(fichaCliente(c));
      }

      // PATCH /api/clientes/:id/contacto — edita nombre/telefono/email/notas.
      // Portado de amigable-123 (2026-08-27): el shared digital notebook debe
      // dejar editar el contacto y las notas del cliente. Solo se actualizan
      // los campos presentes en el body (nunca se pisan con "" los que no se
      // mandaron — evita el bug de "un campo se vacía por una escritura pasiva").
      const mCliContacto = path.match(/^\/api\/clientes\/([^/]+)\/contacto$/);
      if (mCliContacto && opts && opts.method === "PATCH") {
        const c = clientes.find((x) => x.id === mCliContacto[1]);
        if (!c || c.borrado) return J({ error: "Customer not found." }, 404);
        if (body.nombre !== undefined) c.nombre = String(body.nombre).trim() || c.nombre;
        if (body.telefono !== undefined) c.telefono = String(body.telefono).trim();
        if (body.email !== undefined) c.email = String(body.email).trim();
        if (body.notas !== undefined) c.notas = String(body.notas).trim();
        // JFC 2026-09-02: rango de edad y país (pulldowns en My customers).
        if (body.rangoEdad !== undefined) c.rangoEdad = String(body.rangoEdad).trim().slice(0, 12);
        if (body.pais !== undefined) c.pais = String(body.pais).trim().slice(0, 60);
        c.rev = _revNueva();
        mov("cliente-contacto", { cliente: c.nombre });
        guardarEstadoLocal();
        return J(fichaCliente(c));
      }

      // ---- CARTERA DE CLIENTES (fiado/abono) — Roadmap Agosto 2026, Fase 1 ----
      // El saldo NUNCA se guarda aqui: se deriva en AMG.Cartera reproduciendo
      // los hechos ya persistidos por hechos.js. Este endpoint solo delega.
      const mCliCartera = path.match(/^\/api\/clientes\/([^/]+)\/cartera$/);
      if (mCliCartera && (!opts || !opts.method || opts.method === "GET")) {
        const c = clientes.find((x) => x.id === mCliCartera[1]);
        if (!c || c.borrado) return J({ error: "Customer not found." }, 404);
        if (!window.AMG || !window.AMG.Cartera) return J({ saldo: 0, movimientos: [] });
        const rol = (window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual()) || "empleado";
        const info = await window.AMG.Cartera.saldoDeCliente(c.id);
        return J(window.AMG.Cartera.vistaCarteraSegunRol(info, rol));
      }
      const mCliFiar = path.match(/^\/api\/clientes\/([^/]+)\/(fiar|abonar)$/);
      if (mCliFiar && opts && opts.method === "POST") {
        const c = clientes.find((x) => x.id === mCliFiar[1]);
        if (!c) return J({ error: "Customer not found." }, 404);
        const monto = Number(body.monto);
        if (!(monto > 0)) return J({ error: "The amount must be greater than zero." }, 400);
        if (!window.AMG || !window.AMG.Cartera) return J({ error: "Customer credit is not available." }, 500);
        const tipo = mCliFiar[2] === "fiar" ? "cargo" : "abono";
        try {
          await window.AMG.Cartera.registrarMovimiento(c.id, tipo, monto, body.motivo || "");
        } catch (e) {
          return J({ error: (e && e.message) || "No se pudo registrar el movimiento." }, 400);
        }
        mov(tipo === "cargo" ? "cartera-fiado" : "cartera-abono", { cliente: c.nombre, monto });
        const info = await window.AMG.Cartera.saldoDeCliente(c.id);
        const rol = (window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual()) || "empleado";
        return J(window.AMG.Cartera.vistaCarteraSegunRol(info, rol));
      }

      // POST /api/clientes/:id/despedir — excluye al cliente de la operación activa.
      // POST /api/clientes/:id/reactivar — lo devuelve.
      const mCliAct = path.match(/^\/api\/clientes\/([^/]+)\/(despedir|reactivar)$/);
      if (mCliAct && opts && opts.method === "POST") {
        const c = clientes.find((x) => x.id === mCliAct[1]);
        if (!c) return J({ error: "Customer not found." }, 404);
        const accion = mCliAct[2];
        c.despedido = accion === "despedir";
        /* FIX (JFC 2026-09-22): faltaba el sello logico. El merge de clientes
           (aplicarCatalogo, ~L2153) SOLO aplica el registro remoto si
           _revDomina(remoto.rev, mio.rev) === true; sin subir rev aqui, despedir
           o reactivar a un cliente NO viajaba nunca al otro aparato — quedaba
           vivo en un dispositivo y despedido en el otro. El campo `despedido` ya
           viaja en el catalogo (~L2588), asi que solo faltaba la revision.
           Misma clase de bug que el de promotoras archivadas corregido en v332.
           Sus endpoints vecinos (editar contacto ~L4193, borrar ~L4249) ya lo
           hacian bien; este se habia quedado atras. */
        c.rev = _revNueva();
        mov(accion === "despedir" ? "cliente-despedido" : "cliente-reactivado", { cliente: c.nombre, quien: body.quien || "Sistema" });
        guardarEstadoLocal();
        /* La baja/alta operativa de un cliente se publica YA (rebote de 400 ms en
           pedirSeed) en vez de esperar al re-sembrado periodico de 2 s. Mismo
           patron que usa marcar-pagado (~L3885). Es idempotente: sembrar()
           compara y reescribe por id, disparar de mas nunca duplica nada. */
        avisarCatalogoCambiado();
        return J({ ok: true, despedido: c.despedido });
      }
      // DELETE /api/clientes/:id — borra el cliente por completo (solo dueño/admin).
      // JFC 2026-08-27: el borrado queda SIEMPRE en el registro de auditoría
      // (mov) con quién, a quién y cuándo — "todo esto queda en registro".
      const mCliDel = path.match(/^\/api\/clientes\/([^/]+)$/);
      if (mCliDel && opts && opts.method === "DELETE") {
        const c = clientes.find((x) => x.id === mCliDel[1]);
        if (!c) return J({ error: "Customer not found." }, 404);
        c.borrado = true; c.rev = _revNueva();
        mov("cliente-borrado", { cliente: c.nombre, codigo: c.codigo || "", quien: body.quien || "Sistema" });
        guardarEstadoLocal();
        return J({ ok: true });
      }
      if (path === "/api/inventario/bcg") return J(matrizBCG(uid));

      // === USUARIOS NOMBRADOS — multi-usuario 2026-07-07 ========================
      // El dueno crea encargados desde Avanzado -> Encargados.
      // Cada encargado tiene un PIN propio de 3 digitos distinto a los demas.
      // NO se puede verificar aqui si colisiona con el PIN del dueno/contador
      // (esos hashes viven en crypto-store, no en este mock). Se pide al dueno
      // que elija PINs que no coincidan con los suyos.

      // GET /api/usuarios — lista usuarios del equipo (id/nombre/rol/email/activo).
      // ?pins=1 (JFC 2026-09-01): incluye el PIN en claro para que el owner/admin
      // vea la lista unificada del Team y no repita PINs al crear otros. Es LOCAL
      // (este fetch lo intercepta el mock en el dispositivo) — el PIN nunca sale
      // del aparato: el relay sigue zero-knowledge. El gating por rol lo hace el
      // frontend (solo pide ?pins=1 si isDueno()/isAdmin()).
      if (path === "/api/usuarios" && (!opts || !opts.method || opts.method === "GET")) {
        const conPin = q.get("pins") === "1" && _puedeGestionarEquipo();
        return J(usuarios.filter((u) => !u.borrado).map((u) => {
          const base = { id: u.id, nombre: u.nombre, rol: u.rol, email: u.email || null, activo: u.activo, creadoEn: u.creadoEn, actualizadoEn: u.actualizadoEn || null, rev: u.rev || null };
          if (conPin) base.pin = u.pin || "";
          return base;
        }));
      }
      // POST /api/usuarios — crear miembro del equipo (encargado o admin); desde Avanzado = solo dueno.
      //
      // UN ADMIN SI CUENTA CONTRA EL TOPE DEL PLAN GRATIS (JFC, 2026-08-19).
      // Antes estaban exentos, con el argumento de que un admin es "co-
      // responsable y no personal adicional". Esa distincion no existe: un
      // admin ES personal, solo que de alto nivel. Con la exencion, el plan
      // "1 encargado" se convertia en la practica en 1 encargado + infinitos
      // admins, que es regalar el producto entero. El tope es de PERSONAS en
      // el equipo, no de un rol concreto.
      if (path === "/api/usuarios" && opts && opts.method === "POST") {
        debePersistir = false; // la ruta espera confirmación durable propia
        if (!_puedeGestionarEquipo()) return J({ error: "Only the owner or an admin can add team members." }, 403);
        const nombre = String(body.nombre || "").trim().slice(0, 60);
        const pin    = String(body.pin    || "").trim();
        const email  = String(body.email  || "").trim().slice(0, 160) || null;
        /* GUARD: SOLO EL DUEÑO PUEDE CREAR ADMINS (2026-08-26, code-review finding #1b).
           Mismo patrón que el guard de PATCH /rol (finding #1 de la corrida anterior).
           La UI ya fuerza rol="empleado" si el caller es admin (ver isDueno() en el form).
           PERO un admin podría hacer desde DevTools:
             fetch('/api/usuarios', {method:'POST', body:JSON.stringify({nombre:'x',pin:'111',rol:'admin'})})
           y crear un admin sin que el dueño lo sepa.
           Política: si el caller no es dueno y pide rol='admin', se acepta la creación
           pero se degrada a 'empleado' silenciosamente (no bloqueamos porque un admin
           SÍ tiene permiso de crear encargados; solo el rol admin queda vedado). */
        const _callerRolPost = _rolLocal();
        const rolNuevo = (body.rol === "admin" && _callerRolPost === "dueno") ? "admin" : "empleado";
        if (!nombre)                     return J({ error: "A name is required." }, 400);
        if (!/^\d{3}$/.test(pin))        return J({ error: "The PIN must be exactly 3 digits." }, 400);
        if (_pinReservado(pin))          return J({ error: "That PIN is reserved for the app (demo, activation, employee or accounting). Pick another one.", codigo: "PIN_RESERVADO" }, 400);
        const colisionIntegrado = await _pinIntegradoEnUso(pin);
        if (colisionIntegrado === null) return J({ error: "Could not verify current PINs. Nothing changed; retry.", codigo: "PIN_NO_VERIFICADO" }, 503);
        if (colisionIntegrado) return J({ error: "A built-in role already uses that PIN. Pick a different one.", codigo: "PIN_COLISION" }, 400);
        /* Limite free: 1 persona en el equipo ademas del dueno, sea encargado
           o admin. Se cuentan los dos roles y se bloquea la creacion de
           cualquiera de los dos. Esto SOLO afecta altas nuevas: a quien ya
           esta creado no se le toca ni se le desactiva nada, asi que ningun
           equipo existente se rompe con este cambio. */
        const staffActual = usuarios.filter((u) => !u.borrado && (u.rol === "empleado" || u.rol === "admin")).length;
        if (staffActual >= 1 && !estaLicenciado())
          return J({ error: `Without activation this device allows 1 team member besides you (admins count too). Activate it (PIN 789) to start your full ${(window.OCPrueba && window.OCPrueba.PRUEBA_DIAS) || 30}-day trial.`, codigo: "LIMITE_EMPLEADOS" }, 403);
        if (usuarios.some((u) => !u.borrado && u.pin === pin)) return J({ error: "Another team member already uses that PIN. Pick a different one." }, 400);
        const fotoEquipo = _fotoAntesDeEquipo();
        const _ahoraU = new Date().toISOString();
        const nuevo = { id: uuid("u"), nombre, pin, rol: rolNuevo, email, activo: true, creadoEn: _ahoraU, actualizadoEn: _ahoraU, rev: _revNueva() };
        usuarios.push(nuevo);
        // B-07 (2026-08-26): si se demotó silenciosamente, dejar rastro en el log
        // para que el dueño pueda auditar intentos de escalada de privilegios.
        if (body.rol === "admin" && rolNuevo === "empleado") {
          mov("intento-crear-admin-sin-permiso", { nombre, callerRol: _callerRolPost, rolAsignado: "empleado" }, false);
        }
        mov("usuario-alta", { id: nuevo.id, nombre, rol: rolNuevo }, false);
        if (!(await _confirmarEquipoORevertir(fotoEquipo))) return J({ error: "Team change was not saved. Free device space and retry.", codigo: "EQUIPO_NO_GUARDADO" }, 507);
        return J({ id: nuevo.id, nombre: nuevo.nombre, rol: nuevo.rol, email: nuevo.email, activo: nuevo.activo, creadoEn: nuevo.creadoEn });
      }
      // PATCH /api/usuarios/:id — editar nombre, activar/desactivar, cambiar PIN, actualizar email
      // El admin puede editar encargados pero NO a otros admins (ese control vive en la UI).
      if (/^\/api\/usuarios\/[^/]+$/.test(path) && opts && opts.method === "PATCH") {
        debePersistir = false;
        if (!_puedeGestionarEquipo()) return J({ error: "Only the owner or an admin can edit team members." }, 403);
        const uid2 = path.split("/").pop();
        const u = usuarios.find((x) => x.id === uid2 && !x.borrado);
        if (!u) return J({ error: "Team member not found." }, 404);
        const antes = { nombre: u.nombre, rol: u.rol, activo: u.activo !== false };
        const pinAntes = u.pin;
        const emailAntes = u.email || null;
        /* GUARD: ADMIN NO PUEDE EDITAR OTRO ADMIN (2026-08-26, code-review finding #2b).
           La UI ya muestra "Owner only" para filas de admin cuando el caller es admin
           (puedeEditar = isDueno() || (isAdmin() && u.rol === "empleado")).
           PERO un admin podría editar el PIN/nombre/activo de otro admin vía DevTools.
           Impacto real: un admin malicioso podría desactivar a su compañero admin, o
           cambiarle el PIN y dejarlo sin acceso — operaciones que solo el dueño debería
           poder hacer sobre alguien de su mismo nivel.
           El guard mira dos cosas: (1) quién es el objeto (u.rol) y (2) quién llama
           (_rolLocal). Si el objeto es admin y el caller NO es dueno → 403 en todos los
           campos excepto email (email es cosmético, no es credencial de acceso). */
        const _callerRolPatch = _rolLocal();
        const _editandoAdmin = u.rol === "admin";
        /* EXCEPCIÓN SELF (JFC 2026-08-26): un admin SÍ puede editar SU PROPIA ficha
           (cambiar su nombre/PIN). Lo que sigue vedado a un admin es editar a OTRO
           admin. "activo" propio también se veda (un admin no se autodesactiva por
           error dejándose fuera). El dueño puede todo. */
        let _editandoOtroAdmin = _editandoAdmin && _callerRolPatch !== "dueno";
        try { if (_editandoOtroAdmin && window.OCCurrentUser && String(window.OCCurrentUser.id) === String(u.id)) _editandoOtroAdmin = false; } catch (_) {}
        if (_editandoOtroAdmin) return J({ error: "Only the owner can edit another admin." }, 403);
        // Aun editando su propia ficha, un admin no puede AUTODESACTIVARSE (se dejaría fuera).
        if (_editandoAdmin && _callerRolPatch !== "dueno" && body.activo === false) {
          return J({ error: "You can't deactivate your own admin access. Ask the owner." }, 403);
        }
        // Validar todos los campos ANTES de tocar el registro: una solicitud
        // nombre+rol prohibido no puede mutar parcialmente y luego devolver 403.
        if (body.rol !== undefined && _callerRolPatch !== "dueno")
          return J({ error: "Only the owner can change roles." }, 403);
        if (body.rol !== undefined && body.rol !== "admin" && body.rol !== "empleado")
          return J({ error: "Invalid team role." }, 400);
        let np = null;
        if (body.pin !== undefined) {
          np = String(body.pin).trim();
          if (!/^\d{3}$/.test(np)) return J({ error: "The new PIN must be 3 digits." }, 400);
          if (_pinReservado(np)) return J({ error: "That PIN is reserved for the app (demo, activation, employee or accounting). Pick another one.", codigo: "PIN_RESERVADO" }, 400);
          const colisionIntegrado = await _pinIntegradoEnUso(np);
          if (colisionIntegrado === null) return J({ error: "Could not verify current PINs. Nothing changed; retry.", codigo: "PIN_NO_VERIFICADO" }, 503);
          if (colisionIntegrado) return J({ error: "A built-in role already uses that PIN.", codigo: "PIN_COLISION" }, 400);
          if (usuarios.some((x) => !x.borrado && x.id !== uid2 && x.pin === np)) return J({ error: "Another team member already uses that PIN." }, 400);
        }
        const fotoEquipo = _fotoAntesDeEquipo();
        if (body.nombre !== undefined) u.nombre = String(body.nombre).trim().slice(0, 60) || u.nombre;
        if (body.activo !== undefined) u.activo = !!body.activo;
        if (body.email  !== undefined) u.email  = String(body.email || "").trim().slice(0, 160) || null;
        if (np !== null) u.pin = np;
        // Promover/degradar rol (JFC 2026-07-30): admin<->encargado. Desde el
        // 2026-08-19 los dos roles cuentan igual contra el tope del plan gratis
        // (ver POST arriba), asi que promover o degradar NO cambia el cupo: es
        // la misma persona en el equipo, con otro nivel de permisos.
        /* GUARD: SOLO EL DUEÑO PUEDE CAMBIAR ROLES (2026-08-26, code-review finding #1).
           La UI ya bloquea esto: el botón promote/demote solo aparece con
           puedePromover = isDueno() en avanzado-extra.js.
           PERO sin este guard, un encargado que conozca el ID de su propio usuario
           puede hacer desde DevTools:
             fetch('/api/usuarios/ID', {method:'PATCH', body:JSON.stringify({rol:'admin'})})
           Su mock-backend local lo aceptaría, actualizadoEn se actualizaría, difundirEquipo()
           mandaría el registro, y en el dispositivo del dueño el merge timestamp gana
           porque es más nuevo → el encargado se auto-promovió sin que el dueño lo apruebe.
           Este guard es defensa en profundidad (defense-in-depth): la UI ya lo previene,
           pero el backend ES la última línea independientemente de quién llame el fetch.
           _rolLocal() viene de window.OCAuth.rolActual() — mismo que usa la UI. */
        if (body.rol !== undefined) {
          u.rol = body.rol;
        }
        /* Sello de edicion (2026-08-21): es lo que decide quien gana cuando dos
           dispositivos editaron a la misma persona. Sin esto el merge no puede
           distinguir el dato nuevo del viejo y tendria que adivinar. */
        u.actualizadoEn = new Date().toISOString();
        u.rev = _revNueva(); // sello lógico: decide el merge por causalidad, no por reloj de pared
        mov("usuario-editar", { id: uid2, antes, despues: { nombre: u.nombre, rol: u.rol, activo: u.activo !== false }, pinCambiado: np !== null && np !== pinAntes, correoCambiado: emailAntes !== (u.email || null) }, false);
        if (!(await _confirmarEquipoORevertir(fotoEquipo))) return J({ error: "Team change was not saved. Free device space and retry.", codigo: "EQUIPO_NO_GUARDADO" }, 507);
        /* v356 (JFC 2026-09-23): si la persona se editó a SÍ MISMA, su sesión
           adopta el sello nuevo. Sin esto, revalidarSesionEquipo (auth-ui) veía
           un rev distinto y cerraba la sesión de quien acababa de guardar su
           propia ficha. Se muta el MISMO objeto (auth-ui compara identidad). */
        try {
          const yo = window.OCCurrentUser;
          if (yo && String(yo.id) === String(u.id)) { yo.rev = u.rev; yo.actualizadoEn = u.actualizadoEn; yo.nombre = u.nombre; }
        } catch (_) {}
        return J({ id: u.id, nombre: u.nombre, rol: u.rol, email: u.email || null, activo: u.activo, creadoEn: u.creadoEn });
      }
      // DELETE /api/usuarios/:id — quitar por completo (distinto de desactivar:
      // desactivar conserva el registro para reactivarlo despues; borrar es
      // definitivo, para cuando alguien deja el negocio de verdad).
      //
      // TOMBSTONE (JFC 2026-08-26, Camino A). ANTES esto hacía splice: el registro
      // desaparecía SOLO de este aparato, y como el merge es add-only, el OTRO
      // aparato lo conservaba y lo re-propagaba de vuelta — el miembro borrado era
      // inmortal y no se podía sacar a nadie del equipo entre dispositivos. Ahora
      // el registro NO se elimina: se marca borrado:true con un rev nuevo. Así la
      // baja viaja (difundirEquipo manda también los tombstones) y GANA al re-add
      // rancio de un tercer aparato por el reloj lógico. Se filtra de todas las
      // lecturas (GET/verificar/conteos/UI), así que para el usuario ES una baja.
      if (/^\/api\/usuarios\/[^/]+$/.test(path) && opts && opts.method === "DELETE") {
        debePersistir = false;
        if (_rolLocal() !== "dueno") return J({ error: "Only the owner can remove team members." }, 403);
        const uid3 = path.split("/").pop();
        const u3 = usuarios.find((x) => x.id === uid3 && !x.borrado);
        if (!u3) return J({ error: "Team member not found." }, 404);
        const fotoEquipo = _fotoAntesDeEquipo();
        u3.borrado = true;
        u3.activo = false;
        u3.actualizadoEn = new Date().toISOString();
        u3.rev = _revNueva();
        mov("usuario-borrar", { id: u3.id, nombre: u3.nombre, rol: u3.rol }, false);
        if (!(await _confirmarEquipoORevertir(fotoEquipo))) return J({ error: "Team change was not saved. Free device space and retry.", codigo: "EQUIPO_NO_GUARDADO" }, 507);
        return J({ ok: true });
      }
      // POST /api/usuarios/verificar — recibe { pin }, devuelve { id, nombre, rol } o 401
      // Llamado por auth-ui.js durante el login para identificar encargados y admins nombrados.
      if (path === "/api/usuarios/verificar" && opts && opts.method === "POST") {
        const pin = String(body.pin || "").trim();
        const u = usuarios.find((x) => !x.borrado && x.activo && x.pin === pin);
        if (!u) return J({ error: "That PIN does not match any active team member." }, 401);
        return J({ id: u.id, nombre: u.nombre, rol: u.rol, actualizadoEn: u.actualizadoEn || null, rev: u.rev || null });
      }
      // =========================================================================

      // === APROPIACIÓN 789 — instancia propia (2026-07-08) =====================
      // Llamado por auth-ui.js durante la secuencia de activación con 789.
      // { vaciar:bool, instanceId:string }. Si vaciar=true, entrega el negocio
      // en blanco (sin datos-semilla de ejemplo). Persiste el estado para que
      // el arranque quede fijado como instancia propia, no como demo.
      if (path === "/api/instancia/activar" && opts && opts.method === "POST") {
        // Guard: safeParse puede devolver {} — sin instanceId el dispositivo
        // queda "activado a medias" (owned con instanceId:null). Rechazar.
        if (!body.instanceId || typeof body.instanceId !== "string") return J({ error: "instanceId required" }, { status: 400 });
        instanceId = body.instanceId;
        if (body.vaciar === true) {
          productos.length = 0; ubicaciones.length = 0; ventas.length = 0;
          movimientos.length = 0; transferencias.length = 0; clientes.length = 0;
          usuarios.length = 0; promotoras.length = 0; sucursales.length = 0;
          for (const k of Object.keys(gastosMensuales)) delete gastosMensuales[k];
          selloUltimo = ""; // cadena anti-tamper arranca limpia con el negocio nuevo
        }
        guardarEstadoLocal(); // fija el arranque: al recargar ya no reseedea el ejemplo
        return J({ ok: true, instanceId: instanceId });
      }
      // GET /api/instancia — estado de apropiación de este dispositivo
      if (path === "/api/instancia" && (!opts || !opts.method || opts.method === "GET")) {
        return J({ instanceId: instanceId, apropiada: !!instanceId, nombreNegocio: nombreNegocio });
      }
      // POST /api/instancia/nombre — el dueño edita el nombre de su negocio.
      if (path === "/api/instancia/nombre" && opts && opts.method === "POST") {
        nombreNegocio = String(body.nombre || "").trim().slice(0, 80);
        nombreNegocioTs = Date.now(); // sello secundario
        nombreNegocioRev = (Number(nombreNegocioRev) || 0) + 1; // contador monotónico (v290): este rename gana a cualquiera con rev menor
        try { const _o = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; _o.nombreNegocio = nombreNegocio; _o.nombreNegocioTs = nombreNegocioTs; _o.nombreNegocioRev = nombreNegocioRev; localStorage.setItem("f123_owned", JSON.stringify(_o)); } catch (_) {}
        guardarEstadoLocal();
        // Refresh the PIN gate immediately and publish the rename through Yjs.
        try { window.dispatchEvent(new CustomEvent("oc-negocio-actualizado", { detail: { nombre: nombreNegocio } })); } catch (_) {}
        avisarCatalogoCambiado();
        return J({ ok: true, nombreNegocio: nombreNegocio });
      }
      // GET /api/integridad — verifica la cadena anti-tamper del historial.
      // Recorre los movimientos SELLADOS (los viejos sin sello son "histórico")
      // y reporta la primera ruptura: edición (el sello propio no recalcula) o
      // borrado/reordenamiento (prevSello no enlaza con el anterior). El chequeo
      // de cola (prev === selloUltimo) detecta si recortaron el final del log.
      if (path === "/api/integridad" && (!opts || !opts.method || opts.method === "GET")) {
        let sellados = 0, historico = 0, prev = "", ruptura = null;
        for (let i = 0; i < movimientos.length; i++) {
          const m = movimientos[i];
          if (!m || !m.sello) { historico++; continue; }
          const recalculado = selloHash(movHuella(m));
          const enlazaOk = sellados === 0 ? true : (m.prevSello === prev);
          if (recalculado !== m.sello || !enlazaOk) {
            ruptura = { index: i, fecha: m.fecha, usuarioNombre: m.usuarioNombre || "?", tipo: m.tipo, motivo: recalculado !== m.sello ? "editado" : "borrado-o-reordenado" };
            break;
          }
          prev = m.sello; sellados++;
        }
        const colaOk = ruptura ? false : (sellados === 0 || prev === selloUltimo);
        return J({ ok: !ruptura && colaOk, total: movimientos.length, sellados: sellados, historico: historico, ruptura: ruptura, colaOk: colaOk });
      }
      // =========================================================================

      return J({ error: "Route not found in the demo." }, 404);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
    } finally {
      // Item 1: persistir tras cada mutacion — asi un refresh (o cerrar la
      // pestana) ya no pierde ventas ni productos nuevos.
      if (debePersistir) guardarEstadoLocal();
    }
  };
})();
