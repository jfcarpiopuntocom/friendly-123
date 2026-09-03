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
    { "id": "galeria",  "nombre": "Galería idiomARTE",        "activa": true, "tipo": "propio",        "sucursalId": "suc01" },
    { "id": "consigna", "nombre": "Consignación de artistas", "activa": true, "tipo": "consignacion",  "sucursalId": "suc01", "promotoraId": "pr01", "comisionSocio": 85, "metaMensual": 800, "lecturaPreferida": "asociado", "escalasComision": [ {"hasta":80,"comision":85}, {"hasta":120,"comision":88}, {"hasta":999,"comision":90} ] },
    { "id": "bar",      "nombre": "Bar & Café",               "activa": true, "tipo": "propio",        "sucursalId": "suc02" },
    { "id": "eventos",  "nombre": "Eventos culturales",       "activa": true, "tipo": "socio",         "sucursalId": "suc03", "promotoraId": "pr02", "comisionSocio": 10, "metaMensual": 500, "escalasComision": [] }
  ];
  // Sucursales: agrupadores backend de perchas (encabezados de sección en Inventario).
  // Asociados/as: artistas en consignación (modalidad artista 85/15) y quien trae público.
  const promotoras = [
    { id: "pr01", nombre: "María Auquilla",  comisionBase: 85, comision: 85 },
    { id: "pr02", nombre: "Carlos Mendoza",  comisionBase: 10, comision: 10 },
  ];
  const sucursales = [
    { id: "suc01", nombre: "Galería",    activa: true },
    { id: "suc02", nombre: "Bar & Café", activa: true },
    { id: "suc03", nombre: "Eventos",    activa: true },
  ];

  const productos = [
    {"id":"p01","nombre":"Óleo original — Tejados de Cuenca","categoria":"Paintings","sku":"ART-OIL-001","barcode":"7862000010011","ubicacionId":"galeria","precio":420,"costo":180,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Taller propio"},
    {"id":"p02","nombre":"Acuarela original — Río Tomebamba","categoria":"Paintings","sku":"ART-WAT-002","estrella":true,"barcode":"7862000010028","ubicacionId":"galeria","precio":260,"costo":110,"stockActual":2,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Taller propio"},
    {"id":"p03","nombre":"Lámina — Serie Andes I","categoria":"Art & prints","sku":"ART-PRN-003","barcode":"7862000010035","ubicacionId":"galeria","precio":45,"costo":16,"stockActual":24,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Imprenta Fine Art"},
    {"id":"p04","nombre":"Lámina — Puertas coloniales","categoria":"Art & prints","sku":"ART-PRN-004","barcode":"7862000010042","ubicacionId":"galeria","precio":38,"costo":14,"stockActual":30,"umbralRojo":8,"umbralAmarillo":15,"proveedor":"Imprenta Fine Art"},
    {"id":"p05","nombre":"Consignación — Tejedora (óleo)","categoria":"Paintings","sku":"CON-OIL-005","barcode":"7862000010059","ubicacionId":"consigna","precio":520,"costo":0,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"María Auquilla"},
    {"id":"p06","nombre":"Consignación — Mañana de mercado","categoria":"Paintings","sku":"CON-OIL-006","estrella":true,"barcode":"7862000010066","ubicacionId":"consigna","precio":380,"costo":0,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"María Auquilla"},
    {"id":"p07","nombre":"Consignación — Lámina Laguna del Cajas","categoria":"Art & prints","sku":"CON-PRN-007","barcode":"7862000010073","ubicacionId":"consigna","precio":60,"costo":0,"stockActual":12,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"María Auquilla"},
    {"id":"p08","nombre":"Brújula de latón antigua","categoria":"Antiques","sku":"ANT-BRS-008","barcode":"7862000010080","ubicacionId":"galeria","precio":145,"costo":70,"stockActual":3,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Anticuario del Centro"},
    {"id":"p09","nombre":"Máquina de escribir vintage","categoria":"Antiques","sku":"ANT-TYP-009","estrella":true,"barcode":"7862000010097","ubicacionId":"galeria","precio":320,"costo":160,"stockActual":1,"umbralRojo":1,"umbralAmarillo":2,"proveedor":"Anticuario del Centro"},
    {"id":"p10","nombre":"Reloj de pared antiguo","categoria":"Antiques","sku":"ANT-CLK-010","barcode":"7862000010103","ubicacionId":"galeria","precio":180,"costo":90,"stockActual":2,"umbralRojo":1,"umbralAmarillo":2,"dormidoDesde":"2026-06-10","proveedor":"Anticuario del Centro"},
    {"id":"p11","nombre":"Manchego curado 200g","categoria":"Cheese & deli","sku":"CHE-MAN-011","barcode":"7862000010110","ubicacionId":"bar","precio":14,"costo":7,"stockActual":18,"umbralRojo":5,"umbralAmarillo":10,"perecible":true,"fechaCaducidad":"2026-09-24","proveedor":"Quesos del Austro"},
    {"id":"p12","nombre":"Rueda de Brie","categoria":"Cheese & deli","sku":"CHE-BRI-012","barcode":"7862000010127","ubicacionId":"bar","precio":12,"costo":6,"stockActual":12,"umbralRojo":4,"umbralAmarillo":8,"perecible":true,"fechaCaducidad":"2026-09-18","proveedor":"Quesos del Austro"},
    {"id":"p13","nombre":"Queso azul 150g","categoria":"Cheese & deli","sku":"CHE-BLU-013","estrella":true,"barcode":"7862000010134","ubicacionId":"bar","precio":16,"costo":8.5,"stockActual":10,"umbralRojo":3,"umbralAmarillo":6,"perecible":true,"fechaCaducidad":"2026-09-16","proveedor":"Quesos del Austro"},
    {"id":"p14","nombre":"Tabla de quesos y embutidos","categoria":"Cheese & deli","sku":"CHE-BRD-014","barcode":"7862000010141","ubicacionId":"bar","precio":18,"costo":8,"stockActual":20,"umbralRojo":5,"umbralAmarillo":10,"perecible":true,"fechaCaducidad":"2026-09-14","proveedor":"Cocina propia"},
    {"id":"p15","nombre":"Queso fresco local 250g","categoria":"Cheese & deli","sku":"CHE-FRE-015","barcode":"7862000010158","ubicacionId":"bar","precio":6,"costo":3,"stockActual":24,"umbralRojo":6,"umbralAmarillo":12,"perecible":true,"fechaCaducidad":"2026-09-12","proveedor":"Hacienda El Valle"},
    {"id":"p16","nombre":"Malbec Reserva (botella)","categoria":"Wine","sku":"WIN-MAL-016","estrella":true,"barcode":"7862000010165","ubicacionId":"bar","precio":28,"costo":14,"stockActual":48,"umbralRojo":12,"umbralAmarillo":24,"proveedor":"Distribuidora de Vinos Andes"},
    {"id":"p17","nombre":"Cabernet Sauvignon (botella)","categoria":"Wine","sku":"WIN-CAB-017","barcode":"7862000010172","ubicacionId":"bar","precio":24,"costo":12,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"proveedor":"Distribuidora de Vinos Andes"},
    {"id":"p18","nombre":"Sauvignon Blanc (botella)","categoria":"Wine","sku":"WIN-SAU-018","barcode":"7862000010189","ubicacionId":"bar","precio":22,"costo":11,"stockActual":40,"umbralRojo":10,"umbralAmarillo":20,"proveedor":"Distribuidora de Vinos Andes"},
    {"id":"p19","nombre":"Espumante Brut (botella)","categoria":"Wine","sku":"WIN-BRU-019","barcode":"7862000010196","ubicacionId":"bar","precio":32,"costo":17,"stockActual":30,"umbralRojo":8,"umbralAmarillo":16,"proveedor":"Distribuidora de Vinos Andes"},
    {"id":"p20","nombre":"Copa de vino de la casa","categoria":"Bar","sku":"BAR-HRE-020","barcode":"7862000010202","ubicacionId":"bar","precio":6,"costo":2.2,"stockActual":90,"umbralRojo":20,"umbralAmarillo":40,"proveedor":"Distribuidora de Vinos Andes"},
    {"id":"p21","nombre":"Rosé (botella)","categoria":"Wine","sku":"WIN-ROS-021","barcode":"7862000010219","ubicacionId":"bar","precio":19,"costo":9,"stockActual":36,"umbralRojo":9,"umbralAmarillo":18,"proveedor":"Distribuidora de Vinos Andes"},
    {"id":"p22","nombre":"Espresso","categoria":"Bar","sku":"BAR-ESP-022","barcode":"7862000010226","ubicacionId":"bar","precio":2.5,"costo":0.6,"stockActual":200,"umbralRojo":40,"umbralAmarillo":80,"proveedor":"Café del Austro"},
    {"id":"p23","nombre":"Cappuccino","categoria":"Bar","sku":"BAR-CAP-023","estrella":true,"barcode":"7862000010233","ubicacionId":"bar","precio":3.5,"costo":0.9,"stockActual":200,"umbralRojo":40,"umbralAmarillo":80,"proveedor":"Café del Austro"},
    {"id":"p24","nombre":"Cerveza artesanal (pinta)","categoria":"Bar","sku":"BAR-BEE-024","barcode":"7862000010240","ubicacionId":"bar","precio":6,"costo":2.5,"stockActual":80,"umbralRojo":20,"umbralAmarillo":40,"proveedor":"Cervecería Local"},
    {"id":"p25","nombre":"Spritz aperitivo","categoria":"Bar","sku":"BAR-SPR-025","barcode":"7862000010257","ubicacionId":"bar","precio":8,"costo":3,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"proveedor":"Bar propio"},
    {"id":"p26","nombre":"Agua con gas","categoria":"Bar","sku":"BAR-WAT-026","barcode":"7862000010264","ubicacionId":"bar","precio":2.5,"costo":0.8,"stockActual":120,"umbralRojo":24,"umbralAmarillo":48,"proveedor":"Distribuidora Cuenca"},
    {"id":"p27","nombre":"Plato de tapas","categoria":"Kitchen","sku":"KIT-TAP-027","estrella":true,"barcode":"7862000010271","ubicacionId":"bar","precio":9,"costo":3.5,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"perecible":true,"fechaCaducidad":"2026-09-05","proveedor":"Cocina propia"},
    {"id":"p28","nombre":"Sándwich tostado","categoria":"Kitchen","sku":"KIT-SAN-028","barcode":"7862000010288","ubicacionId":"bar","precio":7,"costo":2.8,"stockActual":50,"umbralRojo":12,"umbralAmarillo":24,"perecible":true,"fechaCaducidad":"2026-09-04","proveedor":"Cocina propia"},
    {"id":"p29","nombre":"Empanadas (2u)","categoria":"Kitchen","sku":"KIT-EMP-029","barcode":"7862000010295","ubicacionId":"bar","precio":5,"costo":1.8,"stockActual":70,"umbralRojo":18,"umbralAmarillo":36,"perecible":true,"fechaCaducidad":"2026-09-03","proveedor":"Cocina propia"},
    {"id":"p30","nombre":"Bowl de aceitunas y frutos secos","categoria":"Kitchen","sku":"KIT-OLV-030","barcode":"7862000010301","ubicacionId":"bar","precio":4.5,"costo":1.5,"stockActual":80,"umbralRojo":20,"umbralAmarillo":40,"proveedor":"Cocina propia"},
    {"id":"p31","nombre":"Antología de poesía","categoria":"Books","sku":"LIB-POE-031","barcode":"7862000010318","ubicacionId":"galeria","precio":18,"costo":8,"stockActual":20,"umbralRojo":5,"umbralAmarillo":10,"proveedor":"Editorial Independiente"},
    {"id":"p32","nombre":"Historia del arte local (libro)","categoria":"Books","sku":"LIB-ART-032","estrella":true,"barcode":"7862000010325","ubicacionId":"galeria","precio":24,"costo":11,"stockActual":15,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"Editorial Independiente"},
    {"id":"p33","nombre":"Cata de vinos y quesos (entrada)","categoria":"Tickets & events","sku":"EVT-CAT-033","estrella":true,"barcode":"7862000010332","ubicacionId":"eventos","precio":22,"costo":6,"stockActual":40,"umbralRojo":8,"umbralAmarillo":20,"proveedor":"Evento propio"},
    {"id":"p34","nombre":"Noche de jazz en vivo (entrada)","categoria":"Tickets & events","sku":"EVT-JAZ-034","barcode":"7862000010349","ubicacionId":"eventos","precio":18,"costo":5,"stockActual":60,"umbralRojo":12,"umbralAmarillo":30,"proveedor":"Evento propio"},
    {"id":"p35","nombre":"Taller de acuarela (cupo)","categoria":"Tickets & events","sku":"EVT-ACU-035","barcode":"7862000010356","ubicacionId":"eventos","precio":25,"costo":9,"stockActual":20,"umbralRojo":4,"umbralAmarillo":10,"proveedor":"Evento propio"},
    {"id":"p36","nombre":"Noche de tango (entrada)","categoria":"Tickets & events","sku":"EVT-TAN-036","barcode":"7862000010363","ubicacionId":"eventos","precio":15,"costo":4,"stockActual":50,"umbralRojo":10,"umbralAmarillo":25,"proveedor":"Evento propio"},
    {"id":"p37","nombre":"Exposición fotográfica (entrada)","categoria":"Tickets & events","sku":"EVT-FOT-037","barcode":"7862000010370","ubicacionId":"eventos","precio":8,"costo":2,"stockActual":80,"umbralRojo":16,"umbralAmarillo":40,"proveedor":"Evento propio"},
    {"id":"p38","nombre":"Recital de poesía (entrada)","categoria":"Tickets & events","sku":"EVT-POE-038","barcode":"7862000010387","ubicacionId":"eventos","precio":12,"costo":3,"stockActual":40,"umbralRojo":8,"umbralAmarillo":20,"dormidoDesde":"2026-07-01","proveedor":"Evento propio"}
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
    } catch (_) {}
    return !!instanceId;
  }
  // Nombre editable del negocio (identidad de instancia, 2026-07-08). Viaja en
  // respaldos/sync. El header lo muestra; vacío = usa el título por defecto.
  let nombreNegocio = "";
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
      configuracion: { gastosMensuales: clonar(gastosMensuales) },
      usuarios: clonar(usuarios),
      instanceId: instanceId,
      nombreNegocio: nombreNegocio,
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
  const OC_STATE_SUFIJO = _sufijoTiendaActiva();
  const OC_STATE_PTR = OC_STATE_KEY + OC_STATE_SUFIJO + "_ptr";
  function claveBuffer(letra) { return OC_STATE_KEY + OC_STATE_SUFIJO + "_" + letra; }
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
  function guardarEstadoLocal() {
    _localRev++;
    const completo = estadoActualExportable();
    const activo = localStorage.getItem(OC_STATE_PTR) || "B"; // sin puntero previo: A es el primer destino
    const destino = activo === "A" ? "B" : "A";
    const _idb = _espejarEnIDB(completo);
    try {
      localStorage.setItem(claveBuffer(destino), JSON.stringify(completo));
      localStorage.setItem(OC_STATE_PTR, destino); // flip atomico, al final
      ocultarAvisoRecorte();
      return;
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
        return;
      }
    } catch (_) {}
    // No cupo completo (ni liberando fotos): recortar el log a los ultimos 300 y archivar el resto.
    const viejos = completo.movimientos.slice(0, -300);
    const recortado = { ...completo, movimientos: completo.movimientos.slice(-300) };
    try {
      localStorage.setItem(claveBuffer(destino), JSON.stringify(recortado));
      localStorage.setItem(OC_STATE_PTR, destino);
      if (window.OCArchivo) window.OCArchivo.archivarLote(viejos).catch(() => {}); // fire-and-forget, idempotente, aislado del nucleo
      avisoArchivado(viejos.length);
      return;
    } catch (_) {
      /* NO MENTIR (JFC 2026-08-17). Que localStorage se llene no quiere decir
         que el dispositivo este lleno: localStorage tiene un techo fijo de
         ~5 MB por origen, aunque al disco le sobren 900 GB. Si el espejo de
         IndexedDB —que si escala con el disco— acepto el estado, los cambios
         SI se guardaron y el cartel rojo seria falso. Solo se avisa cuando de
         verdad no entro en ningun lado. */
      _idb.then((ok) => {
        if (ok) { ocultarAvisoRecorte(); avisoEspacioJusto(); }
        else avisoMemoriaLlena();
      }).catch(() => avisoMemoriaLlena());
    }
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
            d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">El inventario guardado no pudo cargarse (datos de ejemplo activos). Ve a AVANZADO para recuperar o importar tu respaldo.</span>';
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
            d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">El inventario guardado no pudo cargarse (datos de ejemplo activos). Ve a AVANZADO para recuperar o importar tu respaldo.</span>';
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
  function ventasCountMesGlobal() { return ventas.filter((v) => esDelMesActual(v.fecha)).length; }
  function ventasMesAcumuladas(ubicacionId) {
    return ventas.filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha)).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
  }
  /* BUG FIX (JFC/Belén 2026-09-03): al EDITAR una venta, el split se recalculaba
     con ventasMesAcumuladas(), que ya incluye a la propia venta editada (vive en
     el array) → el umbral de escala se contaba a sí mismo y la comisión salía mal.
     Este acumulado EXCLUYE la venta en curso, que es lo correcto para el "previo". */
  function ventasMesAcumuladasExcl(ubicacionId, ventaId) {
    return ventas.filter((v) => v.id !== ventaId && v.ubicacionId === ubicacionId && esDelMesActual(v.fecha)).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
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
      const ventasMes = ventas.filter((v) => v.ubicacionId === u.id && esDelMesActual(v.fecha) && v.split);
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
      const ultima = ventas.filter((v) => v.ubicacionId === u.id).reduce((mx, v) => (v.fecha > mx ? v.fecha : mx), "");
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
    const v = ventas.find((x) => x.id === ventaId);
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

    mov("comision-corregida", { ventaId: v.id, ubicacion: nombreUbic(v.ubicacionId), pctAntes: antes.comisionPct, pctAhora: pct, diferencia: +(comision - antes.montoComisionSocio).toFixed(2), motivo: String(motivo || "").slice(0, 200) });
    guardarEstadoLocal();
    return { ok: true, venta: { id: v.id, fecha: v.fecha, split: v.split } };
  }

  /* Corregir de golpe TODAS las del mes en una percha. Cuando el % se configuro
     mal, casi nunca esta mal una venta: estan mal las treinta del mes. */
  function corregirComisionesDelMes(ubicacionId, pctNuevo, quien, motivo, soloPendientes) {
    const objetivo = ventas.filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha) && v.split && (!soloPendientes || !v.liquidada));
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

    const vMes = ventas.filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha));
    const vTodas = ventas.filter((v) => v.ubicacionId === ubicacionId);
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
      for (const v of ventas) { if (!map[v.productoId] || v.fecha > map[v.productoId]) map[v.productoId] = v.fecha; }
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
    const vc = ventas.filter((v) => v.clienteId === c.id);
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
    const rev = (p, d1, d2) => ventas.filter((v) => { if (v.productoId !== p.id) return false; const d = (ahora - new Date(v.fecha).getTime()) / 86400000; return d >= d1 && d < d2; }).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
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
    return { id: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo || 0, sku: p.sku, barcode: p.barcode, proveedor: p.proveedor, stockActual: p.stockActual, estado: e.estado, nivelBloom: e.nivel, mensaje: e.mensaje, dormidoDesde: p.dormidoDesde || null, categoria: p.categoria, ubicacionId: p.ubicacionId, ubicacionNombre: nombreUbic(p.ubicacionId), perecible: !!p.perecible, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: e.dias, metodoCosteo: p.metodoCosteo || "FIFO", umbralRojo: p.umbralRojo || 0, umbralAmarillo: p.umbralAmarillo || 0, tipoProveedor: p.tipoProveedor || "compra", tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, comisionProveedorPct: p.comisionProveedorPct || 0, comisionistaId: p.comisionistaId || null, chip: p.chip || "", otrasPerchas: getHermanosPercha(p.id), stockComprometido: transferencias.filter((t) => t.productoOrigenId === p.id && t.estado === "solicitada").reduce((a, t) => a + t.cantidad, 0), foto: p.foto || null };
  }
  function filtrar(uid) { return !uid || uid === "todas" ? productos : productos.filter((p) => p.ubicacionId === uid); }
  // BUG latente fijado 2026-07-07: "ventas de HOY" filtraba solo por
  // ubicacion; con historial de dias anteriores el resumen del dia mentia.
  function ventasHoyDe(uid) { const hoy = hoyISO(); return ventas.filter((v) => fechaLocalDe(v.fecha) === hoy && (!uid || uid === "todas" || v.ubicacionId === uid)); }
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

  function mov(tipo, detalle) {
    const usr = window.OCCurrentUser;
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
      usuarioId:     usr ? usr.id     : "sistema",
      usuarioNombre: usr ? usr.nombre : "Sistema",
      usuarioRol:    usr ? (usr.rol || "") : "",
      dispositivoApodo: dispApodo,
      dispositivoId:    dispId,
    };
    m.prevSello = selloUltimo;
    m.sello = selloHash(movHuella(m));
    selloUltimo = m.sello;
    movimientos.push(m);
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

  /* RELOJ LÓGICO DEL ROSTER (JFC 2026-08-26, Camino A "terminar bien lo nuestro").
     Cada edición del equipo se sella con rev = { c: contador Lamport, d: deviceId }.
     El contador viene del MISMO Lamport que ya sincroniza sync-realtime (version
     vectors), así el orden es causal y global, no del reloj de pared del aparato
     (dos celulares con la hora mal puesta se pisaban al promover/degradar/PIN).
     Si sync-realtime no está cargado (tablero, pruebas), cae a un contador local
     monótono + un deviceId estable: nunca lanza y nunca deja sin sellar. */
  let _revLocalFallback = 0;
  function _revNueva() {
    let c = 0, d = "";
    try {
      if (window.OCSyncControl && typeof window.OCSyncControl.revTick === "function") {
        c = Number(window.OCSyncControl.revTick()) || 0;
        d = String(window.OCSyncControl.deviceIdActual() || "");
      }
    } catch (_) {}
    if (!c) { c = (++_revLocalFallback); }
    if (!d) { try { d = String(localStorage.getItem("f123_device_id") || ""); } catch (_) {} }
    return { c: c, d: d };
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

  function aplicarCatalogo(remoto, rolRemoto) {
    const dif = compararCatalogo(remoto, rolRemoto);
    if (!dif) return { ok: false, error: "The catalog received is not readable." };
    const mandaElOtro = dif.ganaElOtro;
    let agregadasU = 0, agregadosP = 0, actualizados = 0;

    remoto.ubicaciones.forEach((u) => {
      if (!u || !u.id) return;
      const mia = ubicaciones.find((x) => String(x.id) === String(u.id));
      if (!mia) {
        ubicaciones.push(Object.assign({}, u, { activa: u.activa !== false }));
        agregadasU++;
      } else if (mandaElOtro && String(mia.nombre || "") !== String(u.nombre || "") && esTextoCorto(String(u.nombre || ""), 240)) {
        mia.nombre = u.nombre; actualizados++;
      }
    });
    remoto.productos.forEach((p) => {
      if (!p || !p.id) return;
      const mio = productos.find((x) => String(x.id) === String(p.id));
      if (!mio) {
        /* El producto llega con stock 0 A PROPOSITO. El stock es un hecho
           fisico de CADA percha: copiar el del otro dispositivo inventaria
           unidades que no estan aqui. Entra el articulo; las unidades las
           cuenta quien las tiene delante. */
        productos.push(Object.assign({}, p, { stockActual: 0 }));
        agregadosP++;
      } else if (mandaElOtro) {
        if (esTextoCorto(String(p.nombre || ""), 240) && String(mio.nombre) !== String(p.nombre)) { mio.nombre = p.nombre; actualizados++; }
        if (Number.isFinite(Number(p.precio)) && Number(p.precio) >= 0 && Number(mio.precio) !== Number(p.precio)) { mio.precio = Number(p.precio); actualizados++; }
      }
    });

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
            try { window.dispatchEvent(new CustomEvent("oc-pin-colision", { detail: { nombre: u.nombre, pin: u.pin, id: u.id } })); } catch (_) {}
            return;
          }
          usuarios.push({ id: u.id, nombre: String(u.nombre).slice(0, 60), pin: u.pin, rol: rolU,
                          email: u.email || null, activo: u.activo !== false, borrado: false,
                          creadoEn: u.creadoEn || new Date().toISOString(),
                          actualizadoEn: u.actualizadoEn || null, rev: u.rev || null });
          miembrosAgregados++;
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
        if (!esTomb && usuarios.some((x) => x.id !== mio.id && !x.borrado && x.pin === u.pin)) return;
        const estabaVivo = !mio.borrado;
        mio.nombre = String(u.nombre || mio.nombre).slice(0, 60);
        if (u.pin) mio.pin = u.pin;
        mio.rol = rolU;
        mio.borrado = esTomb;
        mio.activo = esTomb ? false : (u.activo !== false);
        if (u.email !== undefined) mio.email = u.email || null;
        mio.actualizadoEn = u.actualizadoEn || mio.actualizadoEn;
        mio.rev = u.rev || mio.rev;
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
        if (!c || !c.id || !c.nombre) return;
        if (clientes.some((x) => String(x.id) === String(c.id))) return; // ya está: no se pisa
        clientes.push({
          id: c.id,
          codigo: c.codigo || "",
          nombre: String(c.nombre).slice(0, 80),
          telefono: c.telefono || "",
          email: c.email || "",
          evaluacion: (c.evaluacion && typeof c.evaluacion === "object") ? c.evaluacion : { trato: 0, confiabilidad: 0, historial: [] },
        });
        clientesAgregados++;
      });
    }

    /* NOMBRE DE LA TIENDA (JFC 2026-08-27 + 2026-08-28). Al unirse a un equipo,
       el aparato adopta el nombre del negocio. Regla de jerarquía (JFC 2026-08-28:
       "la jerarquía le pertenece al PIN, el nombre sale del PIN de mayor jerarquía"):
       se adopta si el local está vacío O si el remitente es el DUEÑO (mayor
       jerarquía). Así el nombre que puso el dueño se propaga a todos y pisa los
       nombres locales de los demás dispositivos. Se persiste en f123_owned y se
       avisa a la UI. */
    if (remoto && typeof remoto.nombreNegocio === "string" && remoto.nombreNegocio.trim() &&
        (!String(nombreNegocio || "").trim() || rolRemoto === "dueno")) {
      nombreNegocio = remoto.nombreNegocio.trim().slice(0, 80);
      try {
        const _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
        _ow.nombreNegocio = nombreNegocio;
        localStorage.setItem("f123_owned", JSON.stringify(_ow));
      } catch (_) {}
      try { window.dispatchEvent(new CustomEvent("oc-negocio-actualizado", { detail: { nombre: nombreNegocio } })); } catch (_) {}
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
          const localEsCustom = !!(local && local !== fab && local !== "888" && local !== "456");
          const remotoEsFabrica = (p === fab || p === "888");
          /* Sidecar: el PIN del cuaderno TAMBIEN abre, sin borrar el de este aparato. */
          try {
            const eq = (window.OCSecure.leerPinsEquipo && window.OCSecure.leerPinsEquipo()) || {};
            if (rolAbre === "dueno") eq.owner = p;
            else if (rolAbre === "empleado") eq.emp = p;
            else eq.acct = p;
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
    mov("merge-catalogo", { perchasAgregadas: agregadasU, productosAgregados: agregadosP, actualizados: actualizados, miembrosAgregados, miembrosActualizados, miembrosQuitados, clientesAgregados, desde: remoto.deviceNombre || "another device" });
    guardarEstadoLocal();
    return { ok: true, agregadasU, agregadosP, actualizados, miembrosAgregados, miembrosActualizados, miembrosQuitados, clientesAgregados, huella: huellaCatalogo() };
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
    try {
      if (localStorage.getItem("f123_lord") === "1") {
        const can = localStorage.getItem("f123_lord_licencia_canonica");
        if (can) return _normLic(can);
      }
    } catch (_) {}
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
      let sufDest = (norm === desde) ? OC_STATE_SUFIJO : ((norm in reg) ? reg[norm] : ("::" + norm));
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
    /* Catalogo propio para mandarselo a un companero de equipo. Solo lo que
       DEFINE el catalogo: ni ventas, ni clientes, ni stock. */
    catalogoPropio() {
      return {
        ubicaciones: ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activa: u.activa, sucursalId: u.sucursalId, comisionSocio: u.comisionSocio, metaMensual: u.metaMensual, minimoGarantizado: u.minimoGarantizado, contribFija: u.contribFija })),
        productos: productos.map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku, barcode: p.barcode, categoria: p.categoria, precio: p.precio, costo: p.costo, ubicacionId: p.ubicacionId, umbralRojo: p.umbralRojo, umbralAmarillo: p.umbralAmarillo, perecible: p.perecible, fechaCaducidad: p.fechaCaducidad })),
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
        clientes: clientes.map((c) => ({ id: c.id, codigo: c.codigo || "", nombre: c.nombre, telefono: c.telefono || "", email: c.email || "", evaluacion: c.evaluacion || null })),
        /* NOMBRE DE LA TIENDA VIAJA CON EL CATÁLOGO (JFC 2026-08-27 + 2026-08-28).
           Era estado local (nombreNegocio) que nunca se propagaba. Ahora viaja; el
           receptor lo adopta si el suyo está vacío o si el remitente es el dueño
           (mayor jerarquía) — ver aplicarCatalogo. */
        nombreNegocio: nombreNegocio || "",
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
        productos: productos.map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku, barcode: p.barcode, categoria: p.categoria, precio: p.precio, costo: p.costo, ubicacionId: p.ubicacionId, umbralRojo: p.umbralRojo, umbralAmarillo: p.umbralAmarillo, perecible: p.perecible, fechaCaducidad: p.fechaCaducidad, tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, estrella: !!p.estrella, stockActual: Math.max(0, Number(p.stockActual) || 0) })),
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
      const r = aplicarCatalogo({ ubicaciones: [], productos: [], usuarios: lista }, null);
      if (r.ok && (r.miembrosAgregados || r.miembrosActualizados)) {
        try { window.dispatchEvent(new CustomEvent("oc-equipo-sync", { detail: r })); } catch (_) {}
      }
      return r;
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
          ventas.push({ id: uuid("v"), productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: p.precio, costoUnit: p.costo, fecha: op.fecha || new Date().toISOString(), split, liquidada: false, clienteId: null, origenRemoto: true });
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
      if (productos.length === 0 && ubicaciones.length === 0) {
        localStorage.removeItem("f123_owned");
        localStorage.removeItem(OC_STATE_KEY);
        // Fase 3: el estado real vive en los buffers A/B, no en OC_STATE_KEY
        // directo (esa clave ahora es solo fallback de migracion) — limpiar
        // tambien los buffers y el puntero, o el reload de abajo recargaria
        // el mismo estado vacio en vez de volver a los datos semilla.
        try { localStorage.removeItem(OC_STATE_KEY + "_A"); localStorage.removeItem(OC_STATE_KEY + "_B"); localStorage.removeItem(OC_STATE_KEY + "_ptr"); } catch (_) {}
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
      const uid = q.get("ubicacionId");

      let m;
      // Edicion libre de la ficha (nombre, foto, precios, codigo interno).
      // El gating por rol (encargado NO edita) vive en la UI; aca solo se aplica.
      if ((m = path.match(/^\/api\/productos\/([^/]+)$/)) && opts && opts.method === "PATCH") {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        if (body.fechaCaducidad !== undefined && body.fechaCaducidad !== null && body.fechaCaducidad !== "" && !fechaValida(body.fechaCaducidad)) return J({ error: "That expiry date is not valid (use YYYY-MM-DD)." }, 400);
        const CAMPOS = ["nombre", "categoria", "precio", "costo", "proveedor", "foto", "barcode", "sku", "chip", "perecible", "fechaCaducidad", "metodoCosteo", "ubicacionId", "tipoProveedor", "tipoProducto", "servingMl", "botellaMl", "umbralRojo", "umbralAmarillo", "comisionProveedorPct", "comisionistaId"];
        CAMPOS.forEach((k) => {
      if (body[k] === undefined) return;
      if (k === "precio" || k === "costo" || k === "umbralRojo" || k === "umbralAmarillo" || k === "comisionProveedorPct") { p[k] = Number(body[k]) || 0; return; }
      if (k === "servingMl" || k === "botellaMl") { p[k] = Math.max(1, Number(body[k]) || (k === "servingMl" ? 50 : 750)); return; }
      if (k === "chip") { p[k] = String(body[k] || "").trim().slice(0, 12); return; }
      if (k === "perecible") { p[k] = !!body[k]; return; }
      p[k] = body[k];
    });
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
        const borrado = productos.splice(i, 1)[0];
        mov("baja", { producto: borrado.nombre, sku: borrado.sku, ubicacion: nombreUbic(borrado.ubicacionId) });
        return J({ ok: true });
      }
      if (path === "/api/modo") return J({ modo: "demo-estatico" });
      if (path === "/api/ubicaciones" && (!opts || opts.method !== "POST")) {
        const soloActivas = q.get("todas") !== "1";
        return J(soloActivas ? ubicaciones.filter((u) => u.activa !== false) : ubicaciones);
      }
      if (path === "/api/ubicaciones" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "The location name is required." }, 400);
        const nueva = { id: uuid("u"), nombre: body.nombre.trim(), tipo: body.tipo || "propio", activa: true, comisionSocio: Number(body.comisionSocio) || 0, metaMensual: Number(body.metaMensual) || 0, escalasComision: Array.isArray(body.escalasComision) ? body.escalasComision : [], sucursalId: body.sucursalId || null, esFeria: !!body.esFeria, lecturaPreferida: body.lecturaPreferida === "casa" ? "casa" : "asociado", minimoGarantizado: Math.max(0, Number(body.minimoGarantizado) || 0), contribFija: Math.max(0, Number(body.contribFija) || 0) };
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
        guardarEstadoLocal();
        avisarCatalogoCambiado(); // cambios de la percha (nombre, trato) viajan al equipo
        return J(u);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)\/(activar|desactivar)$/))) {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Location not found." }, 404);
        u.activa = m[2] === "activar";
        mov(u.activa ? "ubicacion-reactivada" : "ubicacion-desactivada", { ubicacion: u.nombre });
        return J(u);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)$/)) && opts && opts.method === "DELETE") {
        const idx = ubicaciones.findIndex((x) => x.id === m[1]); if (idx < 0) return J({ error: "Shelf not found." }, 404);
        if (ubicaciones.length <= 1) return J({ error: "At least one shelf has to remain." }, 400);
        const u = ubicaciones[idx];
        // Borrado en cascada: la percha y TODOS sus productos. La UI ya lo advirtio.
        const productosBorrados = productos.filter((p) => p.ubicacionId === u.id).length;
        for (let i = productos.length - 1; i >= 0; i--) if (productos[i].ubicacionId === u.id) productos.splice(i, 1);
        ubicaciones.splice(idx, 1);
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
      if (path === "/api/promotoras" && (!opts || opts.method !== "POST")) return J(promotoras);
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
          escalasComision: Array.isArray(body.escalasComision) ? body.escalasComision.map((e) => ({ hasta: Math.max(0, Number(e.hasta) || 0), comision: Math.max(0, Math.min(100, Number(e.comision) || 0)) })).filter((e) => e.hasta > 0) : [] };
        promotoras.push(nuevaProm);
        mov("promotora-alta", { promotora: nuevaProm.nombre });
        return J(nuevaProm);
      }
      const mProm = path.match(/^\/api\/promotoras\/([^/]+)$/);
      if (mProm && opts && opts.method === "PUT") {
        const pr = promotoras.find((x) => x.id === mProm[1]);
        if (!pr) return J({ error: "Associate not found." }, 404);
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
        mov("promotora-edicion", { promotora: pr.nombre });
        return J(pr);
      }
      if (mProm && opts && opts.method === "DELETE") {
        const idxP = promotoras.findIndex((x) => x.id === mProm[1]);
        if (idxP < 0) return J({ error: "Associate not found." }, 404);
        const prb = promotoras.splice(idxP, 1)[0];
        // Desasignar de las perchas que lo tenian
        ubicaciones.forEach((u) => { if (u.promotoraId === prb.id) u.promotoraId = null; });
        mov("promotora-baja", { promotora: prb.nombre });
        return J({ ok: true });
      }
      // ---- Sucursales (agrupadores backend de perchas) ----
      if (path === "/api/sucursales" && (!opts || opts.method !== "POST")) return J(sucursales);
      if (path === "/api/sucursales" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "The branch name is required." }, 400);
        const nuevaSuc = { id: uuid("suc"), nombre: body.nombre.trim(), activa: true };
        sucursales.push(nuevaSuc);
        mov("sucursal-alta", { sucursal: nuevaSuc.nombre });
        return J(nuevaSuc);
      }
      const mSuc = path.match(/^\/api\/sucursales\/([^/]+)$/);
      if (mSuc && opts && opts.method === "PUT") {
        const s = sucursales.find((x) => x.id === mSuc[1]); if (!s) return J({ error: "Branch not found." }, 404);
        if (body.nombre && body.nombre.trim()) s.nombre = body.nombre.trim();
        return J(s);
      }
      if (mSuc && opts && opts.method === "DELETE") {
        const tienePerchas = ubicaciones.some((u) => u.sucursalId === mSuc[1]);
        if (tienePerchas) return J({ error: "Move the shelves to another branch before deleting this one." }, 400);
        const idxS = sucursales.findIndex((x) => x.id === mSuc[1]);
        if (idxS < 0) return J({ error: "Branch not found." }, 404);
        const s = sucursales.splice(idxS, 1)[0];
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
          ventas.filter((v) => v.ubicacionId === u.id && esDelMesActual(v.fecha) && v.split).forEach((v) => {
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
        const vSemana = ventas.filter((v) => new Date(v.fecha).getTime() >= hace7dias && (!uid || uid === "todas" || v.ubicacionId === uid));
        const entraSemana = vSemana.reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
        return J({ semaforoGeneral: sem, resumenDia: { entra: +entra.toFixed(2), sale: +sale.toFixed(2), gananciaHoy: +(entra - sale).toFixed(2), inventarioValorizado: +inv.toFixed(2), ventasCount: vh.length }, resumenSemana: { entra: +entraSemana.toFixed(2), ventasCount: vSemana.length }, alertas });
      }

      if (path === "/api/productos" && (!opts || opts.method !== "POST")) {
        let lista = filtrar(uid).map((p) => { const e = estadoDe(p); return { id: p.id, nombre: p.nombre, categoria: p.categoria, sku: p.sku, stockActual: p.stockActual, estado: e.estado, nivelBloom: e.nivel, mensaje: e.mensaje, precio: p.precio, costo: p.costo || 0, ubicacionId: p.ubicacionId, ubicacionNombre: nombreUbic(p.ubicacionId), tipoProveedor: p.tipoProveedor || "compra", tipoProducto: p.tipoProducto || "normal", servingMl: p.servingMl || 50, botellaMl: p.botellaMl || 750, perecible: !!p.perecible, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: e.dias, estrella: !!p.estrella, foto: p.foto || null, chip: p.chip || "" }; });
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
          return J({ error: "You've reached the 25-product limit on the free plan. Activate this device (PIN 789) to unlock unlimited products.", codigo: "LIMITE_PRODUCTOS" }, 403);
        }
        const nuevo = {
          // M5 (2026-08-14): variante interna, hasta 12 caracteres. Vacio por
          // defecto: un producto sin variante se comporta igual que siempre.
          chip: String(body.chip || "").trim().slice(0, 12),
          id: uuid("p"), nombre: String(body.nombre).trim(), categoria: body.categoria || "General",
          sku: body.sku || body.barcode, barcode: body.barcode, ubicacionId: body.ubicacionId || "todas",
          // BUG FIJADO 2026-07-03: sin piso en 0, un stockInicial negativo
          // corrompía la valorización de inventario desde la creación.
          precio: Math.max(0, Number(body.precio) || 0), costo: Math.max(0, Number(body.costo) || 0), stockActual: Math.max(0, Number(body.stockInicial) || 0),
          umbralRojo: Number(body.umbralRojo) || 5, umbralAmarillo: Number(body.umbralAmarillo) || 10, proveedor: body.proveedor || "",
          perecible: !!body.perecible, fechaCaducidad: body.perecible ? (body.fechaCaducidad || null) : null,
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
        productos.push(nuevo);
        mov("alta", { producto: nuevo.nombre, sku: nuevo.sku, ubicacion: nombreUbic(nuevo.ubicacionId) });
        avisarCatalogoCambiado(); // el producto nuevo viaja al resto del negocio (con stock 0; cada percha cuenta el suyo)
        return J(ficha(nuevo));
      }

      if ((m = path.match(/^\/api\/productos\/([^/]+)\/venta$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Product not found." }, 404);
        const ubicP = ubicaciones.find((x) => x.id === p.ubicacionId);
        if (ubicP && ubicP.activa === false) return J({ error: `"${ubicP.nombre}" está desactivada — no admite ventas nuevas.` }, 400);
        const cant = Number.isInteger(body.cantidad) && body.cantidad > 0 ? body.cantidad : 1;
        if (p.stockActual < cant) return J({ error: `No hay suficiente stock disponible (quedan ${p.stockActual}).` }, 400);
        // Free-tier: sin dispositivo activado (PIN 789), tope de 100 ventas/mes (global).
        if (!estaLicenciado() && ventasCountMesGlobal() >= 100) {
          return J({ error: "You've reached the 100-sales/month limit on the free plan. Activate this device (PIN 789) to unlock unlimited sales.", codigo: "LIMITE_VENTAS" }, 403);
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
        const precioEfectivo = (_esTicket && Number.isFinite(_pagado) && _pagado > 0) ? _pagado : p.precio;
        const montoBruto = precioEfectivo * cant;
        const acumuladoPrevio = ubicP ? ventasMesAcumuladas(ubicP.id) : 0;
        const split = ubicP ? calcularSplitVenta(ubicP, montoBruto, acumuladoPrevio) : null;
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
        };
        const tieneInfoVenta = Object.values(infoVenta).some((v) => v !== "" && v !== null);
        ventas.push({ id: ventaId, productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: precioEfectivo, costoUnit: p.costo, fecha: new Date().toISOString(), split, liquidada: false, clienteId: clienteVenta ? clienteVenta.id : null, info: tieneInfoVenta ? infoVenta : null });
        mov("venta", { producto: p.nombre, cantidad: cant, total: +montoBruto.toFixed(2), ubicacion: nombreUbic(p.ubicacionId) });
        emitirOpStock("venta", { productoId: p.id, delta: -cant });
        return J({ producto: ficha(p), ventaId });
      }
      if ((m = path.match(/^\/api\/ventas\/([^/]+)\/anular$/))) {
        const idx = ventas.findIndex((v) => v.id === m[1]);
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
        ventas.splice(idx, 1);
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
        const idx = ventas.findIndex((v) => v.id === m[1]);
        if (idx === -1) return J({ error: "Sale not found (it may have already been cancelled)." }, 404);
        const venta = ventas[idx];
        if (venta.liquidada) return J({ error: "This sale was already settled to a partner. Fix the settlement in Commissions instead of cancelling." }, 400);
        const p = productos.find((x) => x.id === venta.productoId);
        if (!p) return J({ error: "Product not found." }, 404);
        const motivo = String((body && body.motivo) || "").trim().slice(0, 200);
        p.stockActual += venta.cantidad;
        ventas.splice(idx, 1);
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
        const venta = ventas.find((v) => v.id === m[1]);
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
        ventas.forEach((v) => {
          if (v.info && v.info.nombreEvento === antes) {
            v.info.nombreEvento = nuevo;
            if (fechaNueva !== null) v.info.fechaEvento = fechaNueva;
            n++;
          }
        });
        mov("evento-editado", { antes, ahora: nuevo, fecha: fechaNueva || "", ventasAfectadas: n });
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
        // FIX 2026-07-07: el QR antes codificaba JSON crudo ({id,sku,barcode}).
        // Un telefono del cliente escaneaba eso y veia texto JSON -- no una pagina.
        // Ahora codifica la URL publica con ?sku=XXX: el cliente escanea y abre
        // la demo de la app con ese SKU como contexto. Funciona en cualquier camara.
        const qrPayload = `https://jfcarpiopuntocom.github.io/AMIGABLE/?sku=${encodeURIComponent(p.sku)}`;
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
        const lista = gastos.slice().reverse();
        const total = gastos.reduce((a, g) => a + (Number(g.monto) || 0), 0);
        // JFC 2026-09-02: totales por categoría para el tablero y el resumen.
        const porCategoria = {};
        gastos.forEach((g) => { const k = g.categoria || "other"; porCategoria[k] = (porCategoria[k] || 0) + (Number(g.monto) || 0); });
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
          fecha: body.fecha || new Date().toISOString(),
          ubicacionId: body.ubicacionId || "todas",
          usuarioId: (window.OCCurrentUser && window.OCCurrentUser.id) || "sistema",
          usuarioNombre: (window.OCCurrentUser && window.OCCurrentUser.nombre) || "Sistema",
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
        const idx = gastos.findIndex((x) => x.id === mGastoDel[1]);
        if (idx < 0) return J({ error: "Expense not found." }, 404);
        const [g] = gastos.splice(idx, 1);
        mov("gasto-anulado", { concepto: g.concepto, monto: g.monto });
        guardarEstadoLocal();
        return J({ ok: true });
      }
      // PATCH /api/gastos/:id — edita concepto/monto/fecha de un gasto (JFC 2026-08-27).
      if (mGastoDel && opts && opts.method === "PATCH") {
        const _rPat = _rolLocal();
        if (_rPat !== "dueno" && _rPat !== "admin" && _rPat !== "contador") return J({ error: "Only the owner, an admin or the bookkeeper can edit expenses." }, 403);
        const g = gastos.find((x) => x.id === mGastoDel[1]);
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
      if ((m = path.match(/^\/api\/liquidaciones\/([^/]+)\/marcar-pagado$/))) {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Location not found." }, 404);
        const pend = ventas.filter((v) => v.ubicacionId === m[1] && esDelMesActual(v.fecha) && !v.liquidada);
        pend.forEach((v) => { v.liquidada = true; });
        mov("liquidacion", { ubicacion: u.nombre, ventasLiquidadas: pend.length });
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
        const clon = { id: uuid("p"), nombre: origen.nombre, categoria: origen.categoria, sku: origen.sku, barcode: origen.barcode, ubicacionId: destUbic.id, precio: origen.precio, costo: origen.costo || 0, stockActual: 0, umbralRojo: origen.umbralRojo, umbralAmarillo: origen.umbralAmarillo, proveedor: origen.proveedor || "", tipoProveedor: origen.tipoProveedor || "compra", comisionProveedorPct: origen.comisionProveedorPct || 0, perecible: !!origen.perecible, fechaCaducidad: origen.perecible ? (origen.fechaCaducidad || null) : null, metodoCosteo: origen.metodoCosteo || "FIFO", tipoProducto: origen.tipoProducto || "normal", servingMl: origen.servingMl || 50, botellaMl: origen.botellaMl || 750, foto: origen.foto || null, creadoEn: new Date().toISOString() };
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
        if (origen.sku !== destino.sku) return J({ error: "The source and destination products are not the same item (different SKU)." }, 400);
        const cant = Number(body.cantidad);
        if (!Number.isInteger(cant) || cant <= 0) return J({ error: "The quantity must be a whole number greater than 0." }, 400);
        if (origen.stockActual < cant) return J({ error: `"${origen.nombre}" solo tiene ${origen.stockActual} unidades en origen.` }, 400);
        const t = { id: uuid("t"), productoOrigenId: origen.id, productoDestinoId: destino.id, sku: origen.sku, nombre: origen.nombre, desde: origen.ubicacionId, desdeNombre: nombreUbic(origen.ubicacionId), hacia: destino.ubicacionId, haciaNombre: nombreUbic(destino.ubicacionId), cantidad: cant, estado: "solicitada", fecha: new Date().toISOString() };
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
        t.estado = "en_transito";
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
        t.estado = "recibida";
        mov("transferencia-recibida", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
        emitirOpStock("transferencia-recibida", { productoId: destino.id, delta: t.cantidad });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/rechazar$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transfer not found." }, 404);
        if (t.estado !== "solicitada") return J({ error: `Esta transferencia ya está en estado "${t.estado}".` }, 400);
        t.estado = "rechazada";
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
        return J({ ubicacionId, gastosMensuales: gastosMensuales[ubicacionId] });
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
        const ub = ing - cv;
        const gm = (!uid || uid === "todas") ? Object.values(gastosMensuales).reduce((a, v) => a + v, 0) : (gastosMensuales[uid] || 0);
        const go = +(gm / diasEnMesActual()).toFixed(2);
        return J({ ingresos: +ing.toFixed(2), costoVentas: +cv.toFixed(2), utilidadBruta: +ub.toFixed(2), gastosOperativos: go, utilidadNeta: +(ub - go).toFixed(2) });
      }
      if (path === "/api/reportes/balance") {
        const ps = filtrar(uid), vh = ventasHoyDe(uid);
        const ef = vh.reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
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
      return J(ventas.filter((v) => !uid || uid === "todas" || v.ubicacionId === uid).map((v) => {
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
          notas: (v.info && v.info.notas) || "",
          clienteId: v.clienteId || "",
          servings: (v.info && v.info.servings) || null,
          botellas: (v.info && v.info.botellas) || null,
          comisionPct: v.split ? v.split.comisionPct : null,
          comisionAsociado: v.split ? v.split.montoComisionSocio : 0,
          netoCasa: v.split ? v.split.montoNetoDueno : null,
          comisionCorregida: !!(v.split && v.split.corregida),
          liquidada: !!v.liquidada,
          asociadoNombre: pr ? pr.nombre : "",
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
          ventas.push({ id: uuid("v"), productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: p.precio, costoUnit: p.costo, fecha: new Date().toISOString(), split, liquidada: false, clienteId: null });
          aplicadas += cant;
          mov("cierre-dia", { producto: p.nombre, cantidad: cant, ubicacion: nombreUbic(p.ubicacionId) });
        }
        return J({ ok: true, aplicadas, errores });
      }

      // ---- CLIENTES (2026-07-07) ----
      if (path === "/api/clientes" && (!opts || opts.method !== "POST")) {
        const med = medianaMontos();
        // Clientes despedidos no aparecen en el selector de Vender ni en listas operativas.
        return J(clientes.filter(c => !c.despedido).map((c) => fichaCliente(c, med)));
      }
      if (path === "/api/clientes" && opts && opts.method === "POST") {
        if (!body.nombre || !String(body.nombre).trim()) return J({ error: "The customer name is required." }, 400);
        /* EMAIL DEL CLIENTE (JFC 2026-08-26): captura opcional. Validación ligera
           "guard, no puerta": si trae algo que no parece email, se guarda vacío en
           vez de rechazar el alta (no queremos frenar el registro por un typo). */
        const _emailCli = String(body.email || "").trim().slice(0, 160);
        const _emailOk = _emailCli && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(_emailCli) ? _emailCli : "";
        const nuevoCli = { id: uuid("c"), codigo: siguienteCodigoCliente(), nombre: String(body.nombre).trim(), telefono: String(body.telefono || "").trim(), email: _emailOk };
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
          const nuevo = { id: uuid("c"), codigo: siguienteCodigoCliente(), nombre, telefono: String((e && e.telefono) || "").trim().slice(0, 40) };
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
        clientes.filter(c => !c.despedido).forEach((c) => { const f = fichaCliente(c, med); grupos[f.estacion].push(f); });
        Object.keys(grupos).forEach((k) => grupos[k].sort((a, b) => b.monto - a.monto));
        return J(grupos);
      }

      // Matriz de comportamiento: agrupa por cuadrante trato×confiabilidad.
      // estrella=+/+  tolerable=-/+  ojo=+/-  bandera=-/-  neutro=cualquier 0
      if (path === "/api/clientes/comportamiento") {
        const med = medianaMontos();
        const grupos = { estrella: [], tolerable: [], ojo: [], bandera: [], neutro: [], despedidos: [] };
        clientes.forEach((c) => {
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
        if (!c) return J({ error: "Customer not found." }, 404);
        // JFC 2026-08-06: unico sistema de calificar en TODAS las apps es el de
        // amigable-123 -- escala 1-5 (0=sin calificar), NO el tri-estado -1/0/1
        // que se habia introducido aqui por error.
        if (!c.evaluacion) c.evaluacion = { trato: 0, confiabilidad: 0, historial: [] };
        if (body.trato !== undefined) c.evaluacion.trato = Math.max(0, Math.min(5, Number(body.trato)||0));
        if (body.confiabilidad !== undefined) c.evaluacion.confiabilidad = Math.max(0, Math.min(5, Number(body.confiabilidad)||0));
        c.evaluacion.historial = c.evaluacion.historial || [];
        // horaIncidente: hora local del evento según el encargado (HH:MM), para conciliación con cámaras/audios.
        c.evaluacion.historial.push({ trato: c.evaluacion.trato, confiabilidad: c.evaluacion.confiabilidad, quien: body.quien || "Sistema", fecha: new Date().toISOString(), horaIncidente: body.horaIncidente || null });
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
        if (!c) return J({ error: "Customer not found." }, 404);
        if (body.nombre !== undefined) c.nombre = String(body.nombre).trim() || c.nombre;
        if (body.telefono !== undefined) c.telefono = String(body.telefono).trim();
        if (body.email !== undefined) c.email = String(body.email).trim();
        if (body.notas !== undefined) c.notas = String(body.notas).trim();
        // JFC 2026-09-02: rango de edad y país (pulldowns en My customers).
        if (body.rangoEdad !== undefined) c.rangoEdad = String(body.rangoEdad).trim().slice(0, 12);
        if (body.pais !== undefined) c.pais = String(body.pais).trim().slice(0, 60);
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
        if (!c) return J({ error: "Customer not found." }, 404);
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
        mov(accion === "despedir" ? "cliente-despedido" : "cliente-reactivado", { cliente: c.nombre, quien: body.quien || "Sistema" });
        guardarEstadoLocal();
        return J({ ok: true, despedido: c.despedido });
      }
      // DELETE /api/clientes/:id — borra el cliente por completo (solo dueño/admin).
      // JFC 2026-08-27: el borrado queda SIEMPRE en el registro de auditoría
      // (mov) con quién, a quién y cuándo — "todo esto queda en registro".
      const mCliDel = path.match(/^\/api\/clientes\/([^/]+)$/);
      if (mCliDel && opts && opts.method === "DELETE") {
        const c = clientes.find((x) => x.id === mCliDel[1]);
        if (!c) return J({ error: "Customer not found." }, 404);
        const idx = clientes.indexOf(c);
        clientes.splice(idx, 1);
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
        const conPin = q.get("pins") === "1";
        return J(usuarios.filter((u) => !u.borrado).map((u) => {
          const base = { id: u.id, nombre: u.nombre, rol: u.rol, email: u.email || null, activo: u.activo, creadoEn: u.creadoEn };
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
        /* Limite free: 1 persona en el equipo ademas del dueno, sea encargado
           o admin. Se cuentan los dos roles y se bloquea la creacion de
           cualquiera de los dos. Esto SOLO afecta altas nuevas: a quien ya
           esta creado no se le toca ni se le desactiva nada, asi que ningun
           equipo existente se rompe con este cambio. */
        const staffActual = usuarios.filter((u) => !u.borrado && (u.rol === "empleado" || u.rol === "admin")).length;
        if (staffActual >= 1 && !estaLicenciado())
          return J({ error: "The free plan includes 1 team member besides you, and that counts admins too. Activate this device (PIN 789) for an unlimited team.", codigo: "LIMITE_EMPLEADOS" }, 403);
        if (usuarios.some((u) => !u.borrado && u.pin === pin)) return J({ error: "Another team member already uses that PIN. Pick a different one." }, 400);
        const _ahoraU = new Date().toISOString();
        const nuevo = { id: uuid("u"), nombre, pin, rol: rolNuevo, email, activo: true, creadoEn: _ahoraU, actualizadoEn: _ahoraU, rev: _revNueva() };
        usuarios.push(nuevo);
        // B-07 (2026-08-26): si se demotó silenciosamente, dejar rastro en el log
        // para que el dueño pueda auditar intentos de escalada de privilegios.
        if (body.rol === "admin" && rolNuevo === "empleado") {
          mov("intento-crear-admin-sin-permiso", { nombre, callerRol: _callerRolPost, rolAsignado: "empleado" });
        }
        mov("usuario-alta", { nombre, rol: rolNuevo });
        avisarEquipoCambiado(); // empuja el equipo al resto del negocio (sync en vivo)
        return J({ id: nuevo.id, nombre: nuevo.nombre, rol: nuevo.rol, email: nuevo.email, activo: nuevo.activo, creadoEn: nuevo.creadoEn });
      }
      // PATCH /api/usuarios/:id — editar nombre, activar/desactivar, cambiar PIN, actualizar email
      // El admin puede editar encargados pero NO a otros admins (ese control vive en la UI).
      if (/^\/api\/usuarios\/[^/]+$/.test(path) && opts && opts.method === "PATCH") {
        const uid2 = path.split("/").pop();
        const u = usuarios.find((x) => x.id === uid2 && !x.borrado);
        if (!u) return J({ error: "Team member not found." }, 404);
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
        if (_editandoOtroAdmin &&
            (body.nombre !== undefined || body.pin !== undefined || body.activo !== undefined)) {
          return J({ error: "Only the owner can edit another admin's name, PIN or active status." }, 403);
        }
        // Aun editando su propia ficha, un admin no puede AUTODESACTIVARSE (se dejaría fuera).
        if (_editandoAdmin && _callerRolPatch !== "dueno" && body.activo === false) {
          return J({ error: "You can't deactivate your own admin access. Ask the owner." }, 403);
        }
        if (body.nombre !== undefined) u.nombre = String(body.nombre).trim().slice(0, 60) || u.nombre;
        if (body.activo !== undefined) u.activo = !!body.activo;
        if (body.email  !== undefined) u.email  = String(body.email || "").trim().slice(0, 160) || null;
        if (body.pin !== undefined) {
          const np = String(body.pin).trim();
          if (!/^\d{3}$/.test(np)) return J({ error: "The new PIN must be 3 digits." }, 400);
          if (_pinReservado(np)) return J({ error: "That PIN is reserved for the app (demo, activation, employee or accounting). Pick another one.", codigo: "PIN_RESERVADO" }, 400);
          if (usuarios.some((x) => !x.borrado && x.id !== uid2 && x.pin === np)) return J({ error: "Another team member already uses that PIN." }, 400);
          u.pin = np;
        }
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
          const callerRol = _rolLocal();
          if (callerRol !== "dueno") return J({ error: "Only the owner can change roles." }, 403);
          if (body.rol === "admin" || body.rol === "empleado") u.rol = body.rol;
        }
        /* Sello de edicion (2026-08-21): es lo que decide quien gana cuando dos
           dispositivos editaron a la misma persona. Sin esto el merge no puede
           distinguir el dato nuevo del viejo y tendria que adivinar. */
        u.actualizadoEn = new Date().toISOString();
        u.rev = _revNueva(); // sello lógico: decide el merge por causalidad, no por reloj de pared
        mov("usuario-editar", { id: uid2, nombre: u.nombre, rol: u.rol });
        avisarEquipoCambiado(); // rol/PIN/nombre nuevos viajan al resto del negocio
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
        const uid3 = path.split("/").pop();
        const u3 = usuarios.find((x) => x.id === uid3 && !x.borrado);
        if (!u3) return J({ error: "Team member not found." }, 404);
        u3.borrado = true;
        u3.activo = false;
        u3.actualizadoEn = new Date().toISOString();
        u3.rev = _revNueva();
        mov("usuario-borrar", { nombre: u3.nombre, rol: u3.rol });
        avisarEquipoCambiado(); // la baja (tombstone) viaja al resto del equipo y propaga
        return J({ ok: true });
      }
      // POST /api/usuarios/verificar — recibe { pin }, devuelve { id, nombre, rol } o 401
      // Llamado por auth-ui.js durante el login para identificar encargados y admins nombrados.
      if (path === "/api/usuarios/verificar" && opts && opts.method === "POST") {
        const pin = String(body.pin || "").trim();
        const u = usuarios.find((x) => !x.borrado && x.activo && x.pin === pin);
        if (!u) return J({ error: "That PIN does not match any active team member." }, 401);
        return J({ id: u.id, nombre: u.nombre, rol: u.rol });
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
        guardarEstadoLocal();
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
