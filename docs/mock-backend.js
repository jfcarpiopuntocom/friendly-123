// mock-backend.js — Backend simulado dentro del navegador, para la demo
// pública en GitHub Pages (que no puede correr Node). Intercepta fetch a
// /api/* y responde con la misma lógica que server.js, usando datos de
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
    const tz = localStorage.getItem("oc_timezone");
    if (!tz) return Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; }
    catch (_) { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  })();
  function hoyISO() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  // Días reales del mes actual (28/29/30/31) — espejo de diasEnMesActual() en server.js.
  function diasEnMesActual() {
    const [anio, mes] = hoyISO().split("-").map(Number);
    return new Date(anio, mes, 0).getDate();
  }

  // Perchas (unidades operativas). sucursalId -> agrupador backend.
  const ubicaciones = [
      {
          "id": "smokeshop",
          "nombre": "Cornerstone Local Souvenirs",
          "activa": true,
          "tipo": "propio",
          "sucursalId": "suc01"
      },
      {
          "id": "bookshelf",
          "nombre": "Ink & Pages — Local Author Shelf",
          "activa": true,
          "tipo": "socio",
          "sucursalId": "suc02",
          "promotoraId": "pr01",
          "comisionSocio": 25,
          "metaMensual": 300,
          "escalasComision": [
              {
                  "hasta": 80,
                  "comision": 25
              },
              {
                  "hasta": 100,
                  "comision": 30
              },
              {
                  "hasta": 120,
                  "comision": 35
              },
              {
                  "hasta": 999,
                  "comision": 40
              }
          ]
      },
      {
          "id": "fairbooth",
          "nombre": "Weekend Vendor Fair Booth",
          "activa": true,
          "tipo": "consignacion",
          "sucursalId": "suc03",
          "promotoraId": "pr02",
          "comisionSocio": 30,
          "metaMensual": 200,
          "escalasComision": []
      }
  ];
  // Sucursales: agrupadores backend de perchas. En la UI el usuario ve PERCHAS;
  // la sucursal es el encabezado de sección en el gestor de perchas (Inventario).
  // Promotores/as: personas que traen gente (turistas, recomendados,
  // familiares) y llevan comision. Se asignan por percha (promotoraId).
  const promotoras = [
    { id: "pr01", nombre: "Jamie Ortiz", comision: 10 },
    { id: "pr02", nombre: "Casey Nguyen", comision: 8 },
  ];
  const sucursales = [
    { id: "suc01", nombre: "Downtown",                  activa: true },
    { id: "suc02", nombre: "Vendor Row",                activa: true },
    { id: "suc03", nombre: "Riverside Market",          activa: true },
  ];

  const productos = [
    {"id":"p01","nombre":"Butane Torch Lighter","categoria":"Smoke Accessories","sku":"CAM-PF-DSM","barcode":"7861000030019","ubicacionId":"smokeshop","precio":22,"costo":9,"stockActual":30,"umbralRojo":8,"umbralAmarillo":16,"proveedor":"Coastal Wholesale Co."},
    {"id":"p02","nombre":"Souvenir Shot Glass","categoria":"Gifts & Souvenirs","sku":"CAM-MET-MOP","estrella":true,"barcode":"7861000030026","ubicacionId":"smokeshop","precio":22,"costo":9,"stockActual":8,"umbralRojo":10,"umbralAmarillo":18,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p03","nombre":"Local History Zine Vol. 3","categoria":"Books","sku":"CAM-ACDC-BIB","estrella":true,"barcode":"7861000030033","ubicacionId":"bookshelf","precio":20,"costo":8.5,"stockActual":25,"umbralRojo":8,"umbralAmarillo":16,"proveedor":"Indie Press Collective"},
    {"id":"p04","nombre":"Souvenir Keychain 3-Pack","categoria":"Gifts & Souvenirs","sku":"CAM-NIR-NVM","barcode":"7861000030040","ubicacionId":"smokeshop","precio":21,"costo":9,"stockActual":15,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p05","nombre":"Graphic Tee — Skyline Print","categoria":"Apparel","sku":"CAM-IM-TRP","barcode":"7861000030057","ubicacionId":"fairbooth","precio":23,"costo":10,"stockActual":4,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Riverside Textiles"},
    {"id":"p06","nombre":"Poetry Chapbook — Late Bloom","categoria":"Books","sku":"CAM-RS-TON","barcode":"7861000030064","ubicacionId":"bookshelf","precio":20,"costo":8.5,"stockActual":18,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Indie Press Collective"},
    {"id":"p07","nombre":"Postcard Rack Set","categoria":"Gifts & Souvenirs","sku":"CAM-LZ-ICA","barcode":"7861000030071","ubicacionId":"smokeshop","precio":22,"costo":9,"stockActual":12,"umbralRojo":5,"umbralAmarillo":13,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p08","nombre":"Graphic Tee — Retro Sunset","categoria":"Apparel","sku":"CAM-RAM-PRS","barcode":"7861000030088","ubicacionId":"fairbooth","precio":19,"costo":8,"stockActual":9,"umbralRojo":5,"umbralAmarillo":11,"proveedor":"Riverside Textiles"},
    {"id":"p09","nombre":"Fridge Magnet Set","categoria":"Gifts & Souvenirs","sku":"CAM-GNR-APP","barcode":"7861000030095","ubicacionId":"smokeshop","precio":22,"costo":9,"stockActual":20,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p10","nombre":"Short Story Collection — Night Shift","categoria":"Books","sku":"CAM-QUE-CRS","barcode":"7861000030101","ubicacionId":"bookshelf","precio":21,"costo":9,"stockActual":3,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Indie Press Collective"},
    {"id":"p11","nombre":"Handmade Beaded Bracelet","categoria":"Handmade Crafts","sku":"SOU-TAZ-001","estrella":true,"barcode":"7861000030118","ubicacionId":"fairbooth","precio":8,"costo":3,"stockActual":40,"umbralRojo":10,"umbralAmarillo":20,"proveedor":"River Valley Artisans"},
    {"id":"p12","nombre":"Bookmark Set — Pressed Flowers","categoria":"Stationery & Gifts","sku":"SOU-LLA-001","barcode":"7861000030125","ubicacionId":"bookshelf","precio":3.5,"costo":1.2,"stockActual":60,"umbralRojo":15,"umbralAmarillo":30,"proveedor":"Paper & Bind Co."},
    {"id":"p13","nombre":"Incense Sticks — Sandalwood","categoria":"Smoke Accessories","sku":"ACC-PIN-001","barcode":"7861000030132","ubicacionId":"smokeshop","precio":4,"costo":1.5,"stockActual":50,"umbralRojo":12,"umbralAmarillo":25,"proveedor":"Coastal Wholesale Co."},
    {"id":"p14","nombre":"Embroidered Patch — Mountain Range","categoria":"Handmade Crafts","sku":"ACC-PAR-001","barcode":"7861000030149","ubicacionId":"fairbooth","precio":5,"costo":2,"stockActual":35,"umbralRojo":10,"umbralAmarillo":20,"proveedor":"River Valley Artisans"},
    {"id":"p15","nombre":"Snapback Cap — Logo","categoria":"Apparel","sku":"SOU-GOR-001","barcode":"7861000030156","ubicacionId":"smokeshop","precio":15,"costo":6.5,"stockActual":6,"umbralRojo":5,"umbralAmarillo":9,"proveedor":"Coastal Wholesale Co."},
    {"id":"p16","nombre":"Reading Journal — Lined","categoria":"Stationery & Gifts","sku":"ACC-PUA-006","barcode":"7861000030163","ubicacionId":"bookshelf","precio":6,"costo":2.2,"stockActual":22,"umbralRojo":8,"umbralAmarillo":16,"proveedor":"Paper & Bind Co."},
    /* Novela latinoamericana contemporánea — 8 títulos cultos, selección JFC 2026-07-03 */
    {"id":"p17","nombre":"Hand-Painted Ceramic Ornament","categoria":"Gifts & Souvenirs","sku":"LIB-ENR-NPN","barcode":"9789584293152","ubicacionId":"smokeshop","precio":22,"costo":9.5,"stockActual":3,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p18","nombre":"Novel — The Long Season","categoria":"Books","sku":"LIB-MEL-TDH","barcode":"9786071653697","ubicacionId":"bookshelf","precio":20,"costo":8.5,"stockActual":6,"umbralRojo":3,"umbralAmarillo":7,"proveedor":"Indie Press Collective"},
    {"id":"p19","nombre":"Local Scene Art Print","categoria":"Home & Decor","sku":"LIB-SCH-KEN","barcode":"9788439735564","ubicacionId":"smokeshop","precio":19,"costo":7.5,"stockActual":11,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p20","nombre":"Novel — Ash and Amber","categoria":"Books","sku":"LIB-REY-COM","barcode":"9789878358154","ubicacionId":"fairbooth","precio":21,"costo":6,"stockActual":14,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Indie Press Collective"},
    {"id":"p21","nombre":"Poetry — Salt Water Letters","categoria":"Books","sku":"LIB-TRI-MGR","barcode":"9789974723146","ubicacionId":"fairbooth","precio":18,"costo":8,"stockActual":2,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Indie Press Collective"},
    {"id":"p22","nombre":"Engraved Wood Coaster Set","categoria":"Gifts & Souvenirs","sku":"LIB-AMP-PDG","estrella":true,"barcode":"9788417125400","ubicacionId":"smokeshop","precio":18,"costo":7.5,"stockActual":9,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Gift & Souvenir Co."},
    {"id":"p23","nombre":"Novel — Low Tide","categoria":"Books","sku":"LIB-MEL-PAR","barcode":"9786071677129","ubicacionId":"bookshelf","precio":17,"costo":7,"stockActual":5,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Indie Press Collective"},
    {"id":"p24","nombre":"Souvenir Snow Globe","categoria":"Gifts & Souvenirs","sku":"LIB-CAB-CIA","estrella":true,"barcode":"9789877383652","ubicacionId":"smokeshop","precio":20,"costo":7.5,"stockActual":8,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Gift & Souvenir Co."},
    /* ---- VITRINAS SIMON: productos diseñados para exhibir los 6 estados del semáforo ---- */
    /* ROJO intensidad 1 — sin stock (inventario muerto, cero unidades) */
    {"id":"p25","nombre":"Woven Friendship Bracelet Pack","categoria":"Gifts & Souvenirs","sku":"VIN-LZ-PGR","barcode":"7861000030170","ubicacionId":"smokeshop","precio":45,"costo":28,"stockActual":0,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Gift & Souvenir Co."},
    /* ROJO intensidad 2 — quedan 1 (critico, reponer urgente) */
    {"id":"p26","nombre":"Vinyl Record — Midnight Radio","categoria":"Vinyl Records","sku":"VIN-PF-ANM","barcode":"7861000030187","ubicacionId":"bookshelf","precio":42,"costo":25,"stockActual":1,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Second Spin Records"},
    /* ROJO intensidad 3 — exactamente en el umbral rojo (limite de emergencia) */
    {"id":"p27","nombre":"Graphic Tee — Vintage Fade","categoria":"Apparel","sku":"CAM-BOW-ZIG","barcode":"7861000030194","ubicacionId":"fairbooth","precio":24,"costo":10,"stockActual":5,"umbralRojo":5,"umbralAmarillo":10,"proveedor":"Riverside Textiles"},
    /* NARANJA encendido 3 — a 1 unidad del umbral rojo (revisar hoy) */
    {"id":"p28","nombre":"Metal Poster — Neon City","categoria":"Home & Decor","sku":"ACC-POS-001","barcode":"7861000030200","ubicacionId":"smokeshop","precio":12,"costo":7,"stockActual":6,"umbralRojo":5,"umbralAmarillo":12,"proveedor":"Coastal Wholesale Co."},
    /* NARANJA encendido 1 — recién entrando a la zona de revisar */
    {"id":"p29","nombre":"Novel — Static Line","categoria":"Books","sku":"CAM-CUR-DIS","barcode":"7861000030217","ubicacionId":"bookshelf","precio":22,"costo":13,"stockActual":9,"umbralRojo":4,"umbralAmarillo":14,"proveedor":"Indie Press Collective"},
    /* NARANJA encendido 1 — tope del rango, sin apuro todavía */
    {"id":"p30","nombre":"Ceramic Mug — Hand Painted","categoria":"Handmade Crafts","sku":"SOU-TAZ-002","barcode":"7861000030224","ubicacionId":"fairbooth","precio":9,"costo":5.5,"stockActual":13,"umbralRojo":4,"umbralAmarillo":14,"proveedor":"River Valley Artisans"},
    /* VERDE — stock saludable, margen moderado (< 0.50, no es azul) */
    {"id":"p31","nombre":"Planner 2026 — Hardcover","categoria":"Stationery & Gifts","sku":"PAP-AGE-001","barcode":"7861000030231","ubicacionId":"smokeshop","precio":15,"costo":9,"stockActual":25,"umbralRojo":5,"umbralAmarillo":12,"proveedor":"Paper & Bind Co."},
    /* VERDE — margen bajo, volumen alto (artículo de bajo costo) */
    {"id":"p32","nombre":"Canvas Tote Bag — Screen Print","categoria":"Stationery & Gifts","sku":"ACC-BOL-001","barcode":"7861000030248","ubicacionId":"bookshelf","precio":8,"costo":5,"stockActual":40,"umbralRojo":10,"umbralAmarillo":20,"proveedor":"Paper & Bind Co."},
    /* VERDE — producto de volumen, margen ajustado */
    {"id":"p33","nombre":"Notebook — Kraft Cover","categoria":"Handmade Crafts","sku":"PAP-LIB-001","barcode":"7861000030255","ubicacionId":"fairbooth","precio":11,"costo":7,"stockActual":18,"umbralRojo":5,"umbralAmarillo":10,"proveedor":"River Valley Artisans"},
    /* AMARILLO (oportunidad) encendido 2 — margen 62%: hay dinero esperándote */
    {"id":"p34","nombre":"Hand-Blown Glass Ornament","categoria":"Gifts & Souvenirs","sku":"VIN-CLA-LON","barcode":"7861000030262","ubicacionId":"smokeshop","precio":48,"costo":18,"stockActual":12,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Gift & Souvenir Co."},
    /* AMARILLO (oportunidad) encendido 2 — margen 64% */
    {"id":"p35","nombre":"Vinyl Record — Signal Lost","categoria":"Vinyl Records","sku":"VIN-RAD-OKC","barcode":"7861000030279","ubicacionId":"bookshelf","precio":50,"costo":18,"stockActual":8,"umbralRojo":2,"umbralAmarillo":5,"proveedor":"Second Spin Records"},
    /* AMARILLO (oportunidad) encendido 3 — margen 72%, pieza estrella */
    {"id":"p36","nombre":"Collectible Figure — Limited Run","categoria":"Collectibles","sku":"COL-IM-EDI","estrella":true,"barcode":"7861000030286","ubicacionId":"fairbooth","precio":65,"costo":18,"stockActual":5,"umbralRojo":2,"umbralAmarillo":4,"proveedor":"Second Spin Records"},
    /* PERECIBLES — 3 grados de urgencia por vencimiento */
    /* Rojo por vencimiento: vence en 2 dias (retiralo ya aunque el stock sea bueno) */
    {"id":"p37","nombre":"Homemade Strawberry Jam 8oz","categoria":"Local Foods","sku":"ALI-CAF-001","barcode":"7861000030293","ubicacionId":"smokeshop","precio":7,"costo":3,"stockActual":15,"umbralRojo":5,"umbralAmarillo":10,"perecible":true,"fechaCaducidad":"2026-07-05","proveedor":"Grandma's Kitchen Preserves"},
    /* Amarillo por vencimiento: vence en 5 dias (vendelo primero) */
    {"id":"p38","nombre":"Chocolate Bar — Dark 70%","categoria":"Snacks & Drinks","sku":"ALI-CHO-001","barcode":"7861000030309","ubicacionId":"bookshelf","precio":4,"costo":1.8,"stockActual":20,"umbralRojo":5,"umbralAmarillo":10,"perecible":true,"fechaCaducidad":"2026-07-08","proveedor":"Coastal Wholesale Co."},
    /* Rojo extremo: ya vencio hace 3 dias (retirar inmediatamente) */
    {"id":"p39","nombre":"Trail Mix Bag","categoria":"Local Foods","sku":"ALI-GRA-001","barcode":"7861000030316","ubicacionId":"fairbooth","precio":9,"costo":4.5,"stockActual":8,"umbralRojo":3,"umbralAmarillo":6,"perecible":true,"fechaCaducidad":"2026-06-30","proveedor":"Coastal Wholesale Co."},

    /* ---- VITRINA GRADOS DE ENCENDIDO (JFC 2026-07-07): completa los niveles
       1-3 de cada color que faltaban, para que el visitante VEA la Escala
       Sinclair Bloom en acción sin tener que operar nada. ---- */
    /* VERDE encendido 1 — sano pero con poco fondo (stock < 7) */
    {"id":"p40","nombre":"Keychain — Bottle Opener","categoria":"Gifts & Souvenirs","sku":"ACC-LLA-001","barcode":"7861000030323","ubicacionId":"smokeshop","precio":12,"costo":8,"stockActual":6,"umbralRojo":2,"umbralAmarillo":4,"proveedor":"Coastal Wholesale Co."},
    /* VERDE encendido 2 — sano, fondo medio (7-14) */
    {"id":"p41","nombre":"Embroidered Patch — Wave","categoria":"Stationery & Gifts","sku":"ACC-PAR-001","barcode":"7861000030330","ubicacionId":"bookshelf","precio":14,"costo":9,"stockActual":10,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Paper & Bind Co."},
    /* AMARILLO (oportunidad) encendido 1 — margen 52%, recién cruza el umbral */
    {"id":"p42","nombre":"Local Landmark Puzzle","categoria":"Gifts & Souvenirs","sku":"VIN-SOD-CAN","barcode":"7861000030347","ubicacionId":"smokeshop","precio":40,"costo":19,"stockActual":14,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Gift & Souvenir Co."},
    /* NARANJA encendido 2 — a 3 unidades del umbral rojo */
    {"id":"p43","nombre":"Knit Beanie — Charcoal","categoria":"Apparel","sku":"ACC-GOR-002","barcode":"7861000030354","ubicacionId":"fairbooth","precio":10,"costo":6,"stockActual":7,"umbralRojo":4,"umbralAmarillo":9,"proveedor":"Riverside Textiles"},
    /* AZUL (dato) encendido 1 — margen 22%: revisa precio o costo */
    {"id":"p44","nombre":"AA Batteries 4-Pack","categoria":"Counter Basics","sku":"BAS-PIL-001","barcode":"7861000030361","ubicacionId":"smokeshop","precio":4.5,"costo":3.5,"stockActual":30,"umbralRojo":6,"umbralAmarillo":12,"proveedor":"Metro Distribution"},
    /* AZUL (dato) encendido 2 — margen 15% */
    {"id":"p45","nombre":"Kraft Gift Bag","categoria":"Stationery & Gifts","sku":"BAS-FUN-001","barcode":"7861000030378","ubicacionId":"bookshelf","precio":2,"costo":1.7,"stockActual":50,"umbralRojo":10,"umbralAmarillo":20,"proveedor":"Paper & Bind Co."},
    /* AZUL (dato) encendido 3 — margen 8%: casi trabajas gratis en este */
    {"id":"p46","nombre":"Clear Packing Tape","categoria":"Counter Basics","sku":"BAS-CIN-001","barcode":"7861000030385","ubicacionId":"fairbooth","precio":1.3,"costo":1.2,"stockActual":24,"umbralRojo":5,"umbralAmarillo":10,"proveedor":"Metro Distribution"},
    /* NEGRO encendido 1 — ~50 dias dormido (dormidoDesde: solo vitrina/carga manual) */
    {"id":"p47","nombre":"Vintage-Style Tin Sign","categoria":"Home & Decor","sku":"CD-QUE-WEM","barcode":"7861000030392","ubicacionId":"smokeshop","precio":15,"costo":9,"stockActual":12,"umbralRojo":3,"umbralAmarillo":6,"dormidoDesde":"2026-05-16","proveedor":"Riverside Gift & Souvenir Co."},
    /* NEGRO encendido 2 — ~80 dias dormido */
    {"id":"p48","nombre":"Used VHS — Director's Cut","categoria":"Collectibles","sku":"COL-VHS-WAL","barcode":"7861000030408","ubicacionId":"bookshelf","precio":25,"costo":15,"stockActual":8,"umbralRojo":2,"umbralAmarillo":4,"dormidoDesde":"2026-04-18","proveedor":"Second Spin Records"},
    /* NEGRO encendido 3 — ~180 dias dormido: capital bien dormido */
    {"id":"p49","nombre":"Oversized Tour Poster","categoria":"Collectibles","sku":"ACC-POS-WOO","barcode":"7861000030415","ubicacionId":"fairbooth","precio":18,"costo":11,"stockActual":9,"umbralRojo":2,"umbralAmarillo":4,"dormidoDesde":"2026-01-08","proveedor":"Second Spin Records"},

    /* ---- VARIEDAD DE MOSTRADOR (JFC 2026-07-07): categorías de tienda real
       (artesanía, dulces, hogar, ropa, papelería) repartidas por las 3
       perchas, para que el tablero luzca los 6 colores con encendidos
       mezclados — no solo merch rockero. ---- */
    /* VERDE n3 — el caballito de batalla: mucho stock, margen sano */
    {"id":"p50","nombre":"Woven Sun Hat","categoria":"Handmade Crafts","sku":"ART-SOM-001","barcode":"7861000030422","ubicacionId":"smokeshop","precio":30,"costo":19,"stockActual":22,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"River Valley Artisans"},
    /* VERDE n2 — estable, sin drama */
    {"id":"p51","nombre":"Beaded Charm Bracelet","categoria":"Handmade Crafts","sku":"ART-PUL-001","barcode":"7861000030439","ubicacionId":"fairbooth","precio":6,"costo":3.8,"stockActual":12,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"River Valley Artisans"},
    /* VERDE n1 — sano pero justito de fondo */
    {"id":"p52","nombre":"Wool Blend Scarf — Grey","categoria":"Apparel","sku":"ROP-BUF-001","barcode":"7861000030446","ubicacionId":"bookshelf","precio":25,"costo":16,"stockActual":6,"umbralRojo":2,"umbralAmarillo":4,"proveedor":"Riverside Textiles"},
    /* AMARILLO n3 — margen 73%: la mina de oro del mostrador */
    {"id":"p53","nombre":"Filigree Drop Earrings","categoria":"Handmade Crafts","sku":"ART-ARE-001","estrella":true,"barcode":"7861000030453","ubicacionId":"smokeshop","precio":22,"costo":6,"stockActual":15,"umbralRojo":3,"umbralAmarillo":6,"proveedor":"Riverside Jewelry Co."},
    /* AMARILLO n1 — margen 52%: buena oportunidad, sin ser la joya */
    {"id":"p54","nombre":"Local Honey 10oz","categoria":"Local Foods","sku":"ALI-MIE-001","barcode":"7861000030460","ubicacionId":"fairbooth","precio":8.5,"costo":4,"stockActual":18,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"Blue Ridge Apiary"},
    /* NARANJA n2 — quedan 6 con umbral rojo 4: reponer esta semana */
    {"id":"p55","nombre":"Embroidered Shawl","categoria":"Apparel","sku":"ROP-CHA-001","barcode":"7861000030477","ubicacionId":"bookshelf","precio":35,"costo":21,"stockActual":6,"umbralRojo":4,"umbralAmarillo":9,"proveedor":"Riverside Textiles"},
    /* NARANJA n1 por vencimiento — vence en 7 dias, sin apuro pero primero en salir */
    {"id":"p56","nombre":"Fresh Farmstead Cheese 1lb","categoria":"Local Foods","sku":"ALI-QUE-001","barcode":"7861000030484","ubicacionId":"smokeshop","precio":5.5,"costo":3.6,"stockActual":14,"umbralRojo":3,"umbralAmarillo":6,"perecible":true,"fechaCaducidad":"2026-07-14","proveedor":"Blue Ridge Creamery"},
    /* ROJO n1 — recien tocando el umbral: urgente pero encendido suave */
    {"id":"p57","nombre":"Eucalyptus Candle 3-Pack","categoria":"Handmade Crafts","sku":"HOG-VEL-001","barcode":"7861000030491","ubicacionId":"fairbooth","precio":9,"costo":5.4,"stockActual":4,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"River Valley Artisans"},
    /* AZUL n2 — margen 12%: dato contable, este casi no deja nada */
    {"id":"p58","nombre":"Bottled Water 20oz","categoria":"Counter Basics","sku":"BAS-AGU-001","barcode":"7861000030507","ubicacionId":"smokeshop","precio":0.8,"costo":0.7,"stockActual":48,"umbralRojo":12,"umbralAmarillo":24,"proveedor":"Metro Distribution"},
    /* AZUL n1 — margen 20%: revisable, no critico */
    {"id":"p59","nombre":"Mint Gum — Counter Box","categoria":"Counter Basics","sku":"BAS-CHI-001","barcode":"7861000030514","ubicacionId":"bookshelf","precio":15,"costo":12,"stockActual":20,"umbralRojo":4,"umbralAmarillo":8,"proveedor":"Metro Distribution"},
    /* NEGRO n2 — 3 meses dormido: plata parada en la vitrina */
    {"id":"p60","nombre":"Carved Wooden Chess Set","categoria":"Collectibles","sku":"HOG-AJE-001","barcode":"7861000030521","ubicacionId":"smokeshop","precio":45,"costo":27,"stockActual":5,"umbralRojo":1,"umbralAmarillo":3,"dormidoDesde":"2026-04-05","proveedor":"River Valley Artisans"},
    /* NEGRO n3 — dormido desde el año pasado: el ejemplo perfecto de capital congelado */
    {"id":"p61","nombre":"Antique Cuckoo Clock","categoria":"Collectibles","sku":"HOG-REL-001","barcode":"7861000030538","ubicacionId":"bookshelf","precio":120,"costo":75,"stockActual":2,"umbralRojo":0,"umbralAmarillo":1,"dormidoDesde":"2025-11-20","proveedor":"Heritage Imports"}
  ];

  const ventas = [];
  const movimientos = [];
  const transferencias = [];

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
    gen("p34", [3, 12, 20, 33], "c01");        // Rosa: verano (frecuente, vinilos caros) + p34 estrella BCG
    gen("p36", [8], "c01");
    gen("p01", [2, 6, 14, 19, 28, 40], "c02"); // Marco: verano (muy frecuente)
    gen("p51", [4], "c03");                     // Lucia: primavera (recien germina)
    gen("p54", [7, 15], "c04");                 // Ivan: primavera
    gen("p50", [32, 40, 52], "c05");            // Maria Belen: otoño (valia mucho, se enfria)
    gen("p22", [24, 35, 48], "c06");            // Pedro: otoño
    gen("p53", [30], "c06");                    // Pedro compraba fino: refuerza su valor
    gen("p01", [95, 105], "c07");               // Carmen: invierno (ultima compra hace 3 meses)
    // c08 Andres: nunca ha comprado -> invierno profundo
    gen("p32", [31, 34, 38, 41, 44], null, 3);  // vaca lechera BCG: vendia fuerte, se estabiliza
    gen("p32", [8], null, 2);
    gen("p42", [5], null);                      // interrogante BCG: recien empieza a moverse
  }
  // Microcirugia 1 (2026-07-07): el arranque JAMAS puede tumbar el
  // interceptor — sin el, la app abre sin backend (pantallas vacias). Si la
  // siembra falla, se arranca sin historial; el error queda en consola.
  try { sembrarVentasDemo(); } catch (e) { console.error("Seed de ventas fallo (la app arranca sin historial):", e); }
  const gastosMensuales = {"smokeshop":0,"bookshelf":0,"fairbooth":0};
  // Usuarios nombrados (empleados): hasta 49.
  // El dueno NO aparece aqui — su acceso es por PIN en crypto-store.
  // Cada entrada: { id, nombre, pin, rol:"empleado", activo, creadoEn }
  // NOTA DE SEGURIDAD: en la demo el PIN se almacena en texto porque no hay
  // servidor. En produccion (server.js) usar PBKDF2 igual que el dueno.
  const usuarios = [];
  // Apropiación 789 (2026-07-08): ID único de esta instancia. null en la demo;
  // se fija al activar con 789. Viaja en respaldos/sync para que los datos
  // queden atados a un negocio y no se confundan entre compradores.
  let instanceId = null;
  // Nombre editable del negocio (identidad de instancia, 2026-07-08). Viaja en
  // respaldos/sync. El header lo muestra; vacío = usa el título por defecto.
  let nombreNegocio = "";
  // Cadena anti-tamper (2026-07-08): sello (hash) del último movimiento.
  let selloUltimo = "";
  // Item 1 (revisión JFC 2026-07-05): el estado vivía SOLO en memoria — al
  // recargar la página se perdían ventas/productos nuevos. Ahora todo el
  // estado se persiste en localStorage tras cada mutación (ver debePersistir
  // en el interceptor de fetch) y se recarga al arrancar (cargarEstadoLocal).
  const OC_STATE_KEY = "amigable_demo_state_v4"; // v4 (2026-07-08): + evaluacion de clientes
  // Severidad Simon (menor = mas grave). Usado para quedarse con la señal
  // mas urgente entre stock y vencimiento, y para ordenar alertas.
  const ORDEN = { rojo: 0, naranja: 1, amarillo: 2, negro: 3, azul: 4, verde: 5 };

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
      movimientos: clonar(movimientos), transferencias: clonar(transferencias),
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
    if (!body || typeof body !== "object") return "El archivo no parece un respaldo válido.";
    if (!Array.isArray(body.productos) || !Array.isArray(body.ubicaciones)) return "El archivo no parece un respaldo válido.";
    if (body.productos.length > 20000 || body.ubicaciones.length > 2000) return "El respaldo es demasiado grande para este modo local.";
    const idsProd = new Set();
    for (const p of body.productos) {
      if (!p || typeof p !== "object") return "Hay un producto corrupto en el respaldo.";
      if (!esTextoCorto(String(p.id || ""), 120) || idsProd.has(String(p.id))) return "Hay IDs de producto vacíos o repetidos.";
      idsProd.add(String(p.id));
      if (!esTextoCorto(String(p.nombre || ""), 240)) return "Hay un producto sin nombre válido.";
      if (!Number.isFinite(Number(p.precio)) || !Number.isFinite(Number(p.costo)) || !Number.isFinite(Number(p.stockActual))) return "Hay valores numéricos inválidos en productos.";
      if (Number(p.precio) < 0 || Number(p.costo) < 0 || Number(p.stockActual) < 0) return "Hay precios, costos o stock negativos en productos.";
    }
    const idsUbic = new Set();
    for (const u of body.ubicaciones) {
      if (!u || typeof u !== "object") return "Hay una percha corrupta en el respaldo.";
      if (!esTextoCorto(String(u.id || ""), 120) || idsUbic.has(String(u.id))) return "Hay IDs de percha vacíos o repetidos.";
      idsUbic.add(String(u.id));
      if (!esTextoCorto(String(u.nombre || ""), 240)) return "Hay una percha sin nombre válido.";
    }
    for (const p of body.productos) {
      if (p.ubicacionId && p.ubicacionId !== "todas" && !idsUbic.has(String(p.ubicacionId))) return `El producto "${p.nombre}" apunta a una percha inexistente.`;
    }
    if (body.ventas && !Array.isArray(body.ventas)) return "La sección de ventas está corrupta.";
    if (body.movimientos && !Array.isArray(body.movimientos)) return "La sección de movimientos está corrupta.";
    if (body.transferencias && !Array.isArray(body.transferencias)) return "La sección de transferencias está corrupta.";
    if (body.clientes && !Array.isArray(body.clientes)) return "La sección de clientes está corrupta.";
    return "";
  }
  function aplicarRespaldo(body) {
    productos.length = 0; productos.push(...body.productos);
    ubicaciones.length = 0; ubicaciones.push(...body.ubicaciones);
    ventas.length = 0; ventas.push(...(Array.isArray(body.ventas) ? body.ventas : []));
    movimientos.length = 0; movimientos.push(...(Array.isArray(body.movimientos) ? body.movimientos : []));
    transferencias.length = 0; transferencias.push(...(Array.isArray(body.transferencias) ? body.transferencias : []));
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
      d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:16px;font-weight:700;">La memoria de este navegador está llena: los cambios nuevos NO se están guardando. Ve a AVANZADO y descarga un respaldo AHORA.</span>';
      (document.body || document.documentElement).appendChild(d);
    } catch (_) {}
  }
  let _localRev = 0; // contador monotónico — impide que una pestaña vieja sobreescriba estado más fresco
  function guardarEstadoLocal() {
    _localRev++;
    try { localStorage.setItem(OC_STATE_KEY, JSON.stringify(estadoActualExportable())); } catch (_) { avisoMemoriaLlena(); }
  }
  function cargarEstadoLocal() {
    try {
      const raw = localStorage.getItem(OC_STATE_KEY);
      if (!raw) return;
      const body = JSON.parse(raw);
      // Rechazar estados escritos por una pestaña más antigua (_rev más bajo) — solo en eventos onstorage
      if (typeof body._rev === "number" && body._rev < _localRev) return;
      const error = validarRespaldo(body);
      if (!error) {
        aplicarRespaldo(body);
      } else {
        // Estado guardado no pasa validación — rescatar raw ANTES de sobrescribir con datos semilla.
        // El dueño puede recuperar el archivo desde Avanzado > Exportar (busca oc_rescate_v4).
        try { localStorage.setItem("oc_rescate_v4", raw); } catch (_) {}
        // Banda roja: advertir inmediatamente, no fallar silencioso
        setTimeout(() => {
          try {
            if (document.getElementById("oc-estado-corrupto-aviso")) return;
            const d = document.createElement("div");
            d.id = "oc-estado-corrupto-aviso";
            d.setAttribute("role", "alert");
            d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10003;background:#B0183E;padding:12px 16px;text-align:center;cursor:pointer;";
            d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">⚠️ El inventario guardado no pudo cargarse (datos de ejemplo activos). Ve a AVANZADO para recuperar o importar tu respaldo.</span>';
            d.addEventListener("click", () => d.remove());
            (document.body || document.documentElement).appendChild(d);
          } catch (_) {}
        }, 800);
      }
    } catch (_) {}
  }
  // Cuando otra pestaña guarda, recargar su estado si es más nuevo (evita last-writer-wins con estado viejo)
  window.addEventListener("storage", (e) => { if (e.key === OC_STATE_KEY) cargarEstadoLocal(); });

  function nombreUbic(id) { const u = ubicaciones.find((x) => x.id === id); return u ? u.nombre : "Ubicación desconocida"; }

  // ---- Reparto de comisiones (espejo de data.js) ----
  function mesActualISO() { return hoyISO().slice(0, 7); }
  function esDelMesActual(fechaISO) { return fechaISO && fechaISO.slice(0, 7) === mesActualISO(); }
  function ventasMesAcumuladas(ubicacionId) {
    return ventas.filter((v) => v.ubicacionId === ubicacionId && esDelMesActual(v.fecha)).reduce((a, v) => a + v.precioUnit * v.cantidad, 0);
  }
  function comisionVigente(u, acumuladoConEsta) {
    const escalas = Array.isArray(u.escalasComision) ? u.escalasComision : [];
    if (!u.metaMensual || escalas.length === 0) return Number(u.comisionSocio) || 0;
    const pctMeta = (acumuladoConEsta / u.metaMensual) * 100;
    const ordenadas = [...escalas].sort((a, b) => a.hasta - b.hasta);
    const tier = ordenadas.find((e) => pctMeta <= e.hasta) || ordenadas[ordenadas.length - 1];
    return Number(tier.comision) || 0;
  }
  function calcularSplitVenta(u, montoBruto, acumuladoPrevio) {
    if (!u || u.tipo === "propio" || !u.tipo) return null;
    const comisionPct = comisionVigente(u, acumuladoPrevio + montoBruto);
    const montoComisionSocio = +(montoBruto * (comisionPct / 100)).toFixed(2);
    return { comisionPct, montoBruto: +montoBruto.toFixed(2), montoComisionSocio, montoNetoDueno: +(montoBruto - montoComisionSocio).toFixed(2) };
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
      // Dias desde la ultima venta de esta percha (rec 05: promotor/a dormida).
      const ultima = ventas.filter((v) => v.ubicacionId === u.id).reduce((mx, v) => (v.fecha > mx ? v.fecha : mx), "");
      const diasSinVenta = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 86400000) : null;
      const prom = u.promotoraId ? promotoras.find((x) => x.id === u.promotoraId) : null;
      return {
        ubicacionId: u.id, ubicacion: u.nombre, tipo: u.tipo, metaMensual: u.metaMensual || 0,
        cumplimientoMeta: u.metaMensual ? +((ventasBrutas / u.metaMensual) * 100).toFixed(1) : null,
        ventasBrutas: +ventasBrutas.toFixed(2), comisionSocio: +comisionSocio.toFixed(2), netoDueno: +netoDueno.toFixed(2),
        estado: ventasMes.length === 0 ? "sin ventas" : pendientes.length === 0 ? "pagado" : "pendiente",
        ventasPendientes: pendientes.length, detallePendientes,
        diasSinVenta, promotorNombre: prom ? prom.nombre : null,
      };
    });
  }
  // ---- Inventario compartido (espejo de data.js) ----
  function estadoSimple(p) { if (p.stockActual <= 0) return "rojo"; if (p.stockActual <= p.umbralRojo) return "rojo"; if (p.stockActual <= p.umbralAmarillo) return "amarillo"; return "verde"; }
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
    return { id: c.id, codigo: c.codigo, nombre: c.nombre, telefono: c.telefono || "",
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
  // Cada estado sale con su NIVEL de encendido 1-3 (Escala Sinclair Bloom:
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
      } else if (margen > 0 && margen < 0.25) {
        porStock = { estado: "azul", nivel: margen <= 0.10 ? 3 : margen <= 0.18 ? 2 : 1, mensaje: _t("alert.lowMargin", { pct: (margen * 100).toFixed(0) }) };
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
    return { id: p.id, nombre: p.nombre, precio: p.precio, sku: p.sku, barcode: p.barcode, proveedor: p.proveedor, stockActual: p.stockActual, estado: e.estado, nivelBloom: e.nivel, mensaje: e.mensaje, categoria: p.categoria, ubicacionId: p.ubicacionId, ubicacionNombre: nombreUbic(p.ubicacionId), perecible: !!p.perecible, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: e.dias, metodoCosteo: p.metodoCosteo || "FIFO", foto: p.foto || null };
  }
  function filtrar(uid) { return !uid || uid === "todas" ? productos : productos.filter((p) => p.ubicacionId === uid); }
  // BUG latente fijado 2026-07-07: "ventas de HOY" filtraba solo por
  // ubicacion; con historial de dias anteriores el resumen del dia mentia.
  function ventasHoyDe(uid) { const hoy = hoyISO(); return ventas.filter((v) => String(v.fecha).slice(0, 10) === hoy && (!uid || uid === "todas" || v.ubicacionId === uid)); }
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
  function mov(tipo, detalle) {
    const usr = window.OCCurrentUser;
    const m = {
      id: uuid("m"), tipo, detalle, fecha: new Date().toISOString(),
      usuarioId:     usr ? usr.id     : "sistema",
      usuarioNombre: usr ? usr.nombre : "Sistema",
    };
    m.prevSello = selloUltimo;
    m.sello = selloHash(movHuella(m));
    selloUltimo = m.sello;
    movimientos.push(m);
  }
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
      if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (_) { body = {}; } }
      const method = (opts && opts.method ? opts.method : "GET").toUpperCase();
      debePersistir = ["POST", "PUT", "PATCH", "DELETE"].includes(method) && !path.startsWith("/api/sync") && path !== "/api/respaldo/exportar";
      const uid = q.get("ubicacionId");

      let m;
      // Edicion libre de la ficha (nombre, foto, precios, codigo interno).
      // El gating por rol (empleado NO edita) vive en la UI; aca solo se aplica.
      if ((m = path.match(/^\/api\/productos\/([^/]+)$/)) && opts && opts.method === "PATCH") {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Producto no encontrado." }, 404);
        if (body.fechaCaducidad !== undefined && body.fechaCaducidad !== null && body.fechaCaducidad !== "" && !fechaValida(body.fechaCaducidad)) return J({ error: "La fecha de caducidad no es válida (usa AAAA-MM-DD)." }, 400);
        const CAMPOS = ["nombre", "categoria", "precio", "costo", "proveedor", "foto", "barcode", "sku", "perecible", "fechaCaducidad", "metodoCosteo"];
        CAMPOS.forEach((k) => { if (body[k] !== undefined) p[k] = (k === "precio" || k === "costo") ? Number(body[k]) || 0 : body[k]; });
        mov("edicion", { producto: p.nombre, sku: p.sku, ubicacion: nombreUbic(p.ubicacionId) });
        return J(ficha(p));
      }
      // Borrado definitivo (dueno, doble confirmacion en la UI).
      if ((m = path.match(/^\/api\/productos\/([^/]+)$/)) && opts && opts.method === "DELETE") {
        const i = productos.findIndex((x) => x.id === m[1]); if (i === -1) return J({ error: "Producto no encontrado." }, 404);
        // BUG FIJADO 2026-07-03: una transferencia "en_transito" ya restó el
        // stock del origen esperando que el destino lo reciba. Borrar el
        // producto origen o destino en ese estado perdía esas unidades para
        // siempre, sin rastro. Bloquear hasta que se confirme o resuelva.
        const enTransito = transferencias.find((t) => t.estado === "en_transito" && (t.productoOrigenId === m[1] || t.productoDestinoId === m[1]));
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
        if (!body.nombre || !body.nombre.trim()) return J({ error: "El nombre de la ubicación es obligatorio." }, 400);
        const nueva = { id: uuid("u"), nombre: body.nombre.trim(), tipo: body.tipo || "propio", activa: true, comisionSocio: Number(body.comisionSocio) || 0, metaMensual: Number(body.metaMensual) || 0, escalasComision: Array.isArray(body.escalasComision) ? body.escalasComision : [], sucursalId: body.sucursalId || null, esFeria: !!body.esFeria };
        ubicaciones.push(nueva);
        // BUG FIX (2026-07-03): las perchas creadas en runtime no existian en
        // gastosMensuales, por lo que la suma "todas" las excluia hasta que se
        // guardara algun gasto para ellas. Se inicializa en 0 al crearlas.
        gastosMensuales[nueva.id] = 0;
        mov("ubicacion-alta", { ubicacion: nueva.nombre });
        return J(nueva);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)$/)) && opts && opts.method === "PUT") {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Ubicación no encontrada." }, 404);
        if (body.nombre && body.nombre.trim()) u.nombre = body.nombre.trim();
        if (body.tipo) u.tipo = body.tipo;
        if ("sucursalId" in body) u.sucursalId = body.sucursalId || null;
        if ("promotoraId" in body) u.promotoraId = body.promotoraId || null;
        return J(u);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)\/(activar|desactivar)$/))) {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Ubicación no encontrada." }, 404);
        u.activa = m[2] === "activar";
        mov(u.activa ? "ubicacion-reactivada" : "ubicacion-desactivada", { ubicacion: u.nombre });
        return J(u);
      }
      if ((m = path.match(/^\/api\/ubicaciones\/([^/]+)$/)) && opts && opts.method === "DELETE") {
        const idx = ubicaciones.findIndex((x) => x.id === m[1]); if (idx < 0) return J({ error: "Percha no encontrada." }, 404);
        if (ubicaciones.length <= 1) return J({ error: "Debe quedar al menos una percha." }, 400);
        const u = ubicaciones[idx];
        // Borrado en cascada: la percha y TODOS sus productos. La UI ya lo advirtio.
        const productosBorrados = productos.filter((p) => p.ubicacionId === u.id).length;
        for (let i = productos.length - 1; i >= 0; i--) if (productos[i].ubicacionId === u.id) productos.splice(i, 1);
        ubicaciones.splice(idx, 1);
        delete gastosMensuales[u.id];
        mov("ubicacion-borrada", { ubicacion: u.nombre, productosBorrados });
        return J({ ok: true, productosBorrados });
      }
      // ---- Promotores/as (comision por traer gente) ----
      if (path === "/api/promotoras" && (!opts || opts.method !== "POST")) return J(promotoras);
      if (path === "/api/promotoras" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "El nombre es obligatorio." }, 400);
        const nuevaProm = { id: uuid("pr"), nombre: body.nombre.trim(), comision: Number(body.comision) || 0 };
        promotoras.push(nuevaProm);
        mov("promotora-alta", { promotora: nuevaProm.nombre });
        return J(nuevaProm);
      }
      const mProm = path.match(/^\/api\/promotoras\/([^/]+)$/);
      if (mProm && opts && opts.method === "DELETE") {
        const idxP = promotoras.findIndex((x) => x.id === mProm[1]);
        if (idxP < 0) return J({ error: "Promotor/a no encontrada." }, 404);
        const prb = promotoras.splice(idxP, 1)[0];
        // Desasignar de las perchas que lo tenian
        ubicaciones.forEach((u) => { if (u.promotoraId === prb.id) u.promotoraId = null; });
        mov("promotora-baja", { promotora: prb.nombre });
        return J({ ok: true });
      }
      // ---- Sucursales (agrupadores backend de perchas) ----
      if (path === "/api/sucursales" && (!opts || opts.method !== "POST")) return J(sucursales);
      if (path === "/api/sucursales" && opts && opts.method === "POST") {
        if (!body.nombre || !body.nombre.trim()) return J({ error: "El nombre de la sucursal es obligatorio." }, 400);
        const nuevaSuc = { id: uuid("suc"), nombre: body.nombre.trim(), activa: true };
        sucursales.push(nuevaSuc);
        mov("sucursal-alta", { sucursal: nuevaSuc.nombre });
        return J(nuevaSuc);
      }
      const mSuc = path.match(/^\/api\/sucursales\/([^/]+)$/);
      if (mSuc && opts && opts.method === "PUT") {
        const s = sucursales.find((x) => x.id === mSuc[1]); if (!s) return J({ error: "Sucursal no encontrada." }, 404);
        if (body.nombre && body.nombre.trim()) s.nombre = body.nombre.trim();
        return J(s);
      }
      if (mSuc && opts && opts.method === "DELETE") {
        const tienePerchas = ubicaciones.some((u) => u.sucursalId === mSuc[1]);
        if (tienePerchas) return J({ error: "Mueve las perchas a otra sucursal antes de borrar esta." }, 400);
        const idxS = sucursales.findIndex((x) => x.id === mSuc[1]);
        if (idxS < 0) return J({ error: "Sucursal no encontrada." }, 404);
        const s = sucursales.splice(idxS, 1)[0];
        mov("sucursal-baja", { sucursal: s.nombre });
        return J({ ok: true });
      }

      // Desempeno por promotor/a: agrega las perchas que tiene asignadas,
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
        return J({ semaforoGeneral: sem, resumenDia: { entra: +entra.toFixed(2), sale: +sale.toFixed(2), gananciaHoy: +(entra - sale).toFixed(2), inventarioValorizado: +inv.toFixed(2), ventasCount: vh.length }, alertas });
      }

      if (path === "/api/productos" && (!opts || opts.method !== "POST")) {
        let lista = filtrar(uid).map((p) => { const e = estadoDe(p); return { id: p.id, nombre: p.nombre, categoria: p.categoria, sku: p.sku, stockActual: p.stockActual, estado: e.estado, nivelBloom: e.nivel, mensaje: e.mensaje, precio: p.precio, perecible: !!p.perecible, fechaCaducidad: p.fechaCaducidad || null, diasParaVencer: e.dias, estrella: !!p.estrella, foto: p.foto || null }; });
        const est = q.get("estado");
        if (est) lista = lista.filter((x) => x.estado === est);
        lista.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre, "es"));
        return J(lista);
      }

      if (path === "/api/productos" && opts && opts.method === "POST") {
        if (!body.nombre || !body.barcode) return J({ error: "Falta el nombre o el código de barras." }, 400);
        // BUG FIX (2026-07-03): sin esta guarda, umbralRojo >= umbralAmarillo hace
        // el estado "amarillo" inalcanzable: el producto salta directo de verde a rojo.
        if (Number(body.umbralRojo) >= Number(body.umbralAmarillo)) return J({ error: "El umbral rojo debe ser menor que el umbral amarillo." }, 400);
        if (body.perecible && !body.fechaCaducidad) return J({ error: "Si el producto expira, indica su fecha de caducidad." }, 400);
        if (body.perecible && !fechaValida(body.fechaCaducidad)) return J({ error: "La fecha de caducidad no es válida (usa AAAA-MM-DD)." }, 400);
        const ubicNueva = body.ubicacionId && body.ubicacionId !== "todas" ? ubicaciones.find((x) => x.id === body.ubicacionId) : null;
        if (ubicNueva && ubicNueva.activa === false) return J({ error: `"${ubicNueva.nombre}" está desactivada — reactívala en Avanzado antes de agregar productos ahí.` }, 400);
        const nuevo = {
          id: uuid("p"), nombre: String(body.nombre).trim(), categoria: body.categoria || "General",
          sku: body.sku || body.barcode, barcode: body.barcode, ubicacionId: body.ubicacionId || "todas",
          // BUG FIJADO 2026-07-03: sin piso en 0, un stockInicial negativo
          // corrompía la valorización de inventario desde la creación.
          precio: Math.max(0, Number(body.precio) || 0), costo: Math.max(0, Number(body.costo) || 0), stockActual: Math.max(0, Number(body.stockInicial) || 0),
          umbralRojo: Number(body.umbralRojo) || 5, umbralAmarillo: Number(body.umbralAmarillo) || 10, proveedor: body.proveedor || "",
          perecible: !!body.perecible, fechaCaducidad: body.perecible ? (body.fechaCaducidad || null) : null,
          metodoCosteo: body.metodoCosteo === "LIFO" ? "LIFO" : "FIFO",
          creadoEn: new Date().toISOString(),
        };
        productos.push(nuevo);
        mov("alta", { producto: nuevo.nombre, sku: nuevo.sku, ubicacion: nombreUbic(nuevo.ubicacionId) });
        return J(ficha(nuevo));
      }

      if ((m = path.match(/^\/api\/productos\/([^/]+)\/venta$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Producto no encontrado." }, 404);
        const ubicP = ubicaciones.find((x) => x.id === p.ubicacionId);
        if (ubicP && ubicP.activa === false) return J({ error: `"${ubicP.nombre}" está desactivada — no admite ventas nuevas.` }, 400);
        const cant = Number.isInteger(body.cantidad) && body.cantidad > 0 ? body.cantidad : 1;
        if (p.stockActual < cant) return J({ error: `No hay suficiente stock disponible (quedan ${p.stockActual}).` }, 400);
        const montoBruto = p.precio * cant;
        const acumuladoPrevio = ubicP ? ventasMesAcumuladas(ubicP.id) : 0;
        const split = ubicP ? calcularSplitVenta(ubicP, montoBruto, acumuladoPrevio) : null;
        p.stockActual -= cant;
        let clienteVenta = null;
        if (body.clienteId) {
          clienteVenta = clientes.find((c) => c.id === body.clienteId);
          if (!clienteVenta) return J({ error: "Cliente no encontrado." }, 404);
        }
        const ventaId = uuid("v");
        ventas.push({ id: ventaId, productoId: p.id, ubicacionId: p.ubicacionId, cantidad: cant, precioUnit: p.precio, costoUnit: p.costo, fecha: new Date().toISOString(), split, liquidada: false, clienteId: clienteVenta ? clienteVenta.id : null });
        mov("venta", { producto: p.nombre, cantidad: cant, total: +(p.precio * cant).toFixed(2), ubicacion: nombreUbic(p.ubicacionId) });
        return J({ producto: ficha(p), ventaId });
      }
      if ((m = path.match(/^\/api\/ventas\/([^/]+)\/anular$/))) {
        const idx = ventas.findIndex((v) => v.id === m[1]);
        if (idx === -1) return J({ error: "Esta venta ya no se puede anular (pasó el tiempo o ya se anuló)." }, 400);
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
          return J({ error: "Esta venta ya no se puede anular (pasó el tiempo o ya se anuló)." }, 400);
        }
        const p = productos.find((x) => x.id === venta.productoId);
        if (!p) return J({ error: "Producto no encontrado." }, 404);
        p.stockActual += venta.cantidad;
        ventas.splice(idx, 1);
        mov("anulacion", { producto: p.nombre, cantidad: venta.cantidad, ubicacion: nombreUbic(p.ubicacionId) });
        return J({ producto: ficha(p) });
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/ajustar$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Producto no encontrado." }, 404);
        const d = Number.isInteger(body.delta) ? body.delta : 0;
        // BUG FIX (2026-07-03): delta=0 es un entero valido, pasa la guarda de
        // arriba, no cambia el stock pero registra un movimiento en el log. Silencioso
        // y contaminante. Se rechaza explicitamente.
        if (d === 0) return J({ error: "El ajuste debe ser distinto de cero." }, 400);
        if (p.stockActual + d < 0) return J({ error: `Ese ajuste dejaría el stock en negativo (actual: ${p.stockActual}).` }, 400);
        p.stockActual += d;
        mov("ajuste", { producto: p.nombre, delta: d, motivo: body.motivo || "Ajuste manual", stockResultante: p.stockActual, ubicacion: nombreUbic(p.ubicacionId) });
        return J(ficha(p));
      }
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/etiqueta$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Producto no encontrado." }, 404);
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
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Producto no encontrado." }, 404);
        return J(ficha(p));
      }

      if (path === "/api/escanear") {
        const c = String(body.codigo || "").trim().toLowerCase();
        if (!c) return J({ error: "Código vacío." }, 400);
        const p = productos.find((x) => String(x.barcode).toLowerCase() === c || String(x.sku).toLowerCase() === c);
        if (!p) return J({ error: "No se encontró ningún producto con ese código." }, 404);
        return J(ficha(p));
      }

      if (path === "/api/actividad") return J(movimientos.slice().reverse().slice(0, 100));

      // Estrella: dueño marca/desmarca productos para que el empleado promueva
      if ((m = path.match(/^\/api\/productos\/([^/]+)\/estrella$/))) {
        const p = productos.find((x) => x.id === m[1]); if (!p) return J({ error: "Producto no encontrado." }, 404);
        p.estrella = !p.estrella;
        mov("estrella", { producto: p.nombre, accion: p.estrella ? "marcado" : "desmarcado" });
        return J({ estrella: p.estrella });
      }

      if (path === "/api/respaldo/exportar") return J(estadoActualExportable());
      if (path === "/api/respaldo/importar") {
        try {
          // BUG FIJADO 2026-07-03 y ampliado 2026-07-05 (item 19): antes solo
          // se comprobaba que fueran arrays; ahora validarRespaldo() revisa
          // ids unicos, numeros finitos/no negativos y referencias a perchas
          // existentes antes de tocar nada. Un respaldo corrupto ya no puede
          // dejar la app inservible.
          const error = validarRespaldo(body);
          if (error) return J({ error }, 400);
          aplicarRespaldo(body);
          guardarEstadoLocal();
          return J({ ok: true, schemaVersion: body.schemaVersion || 1 });
        } catch (e) { return J({ error: "No se pudo importar: " + String(e) }, 400); }
      }

      if (path === "/api/liquidaciones") return J(getLiquidaciones());
      if ((m = path.match(/^\/api\/liquidaciones\/([^/]+)\/marcar-pagado$/))) {
        const u = ubicaciones.find((x) => x.id === m[1]); if (!u) return J({ error: "Ubicación no encontrada." }, 404);
        const pend = ventas.filter((v) => v.ubicacionId === m[1] && esDelMesActual(v.fecha) && !v.liquidada);
        pend.forEach((v) => { v.liquidada = true; });
        mov("liquidacion", { ubicacion: u.nombre, ventasLiquidadas: pend.length });
        return J({ ok: true, ventasLiquidadas: pend.length });
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
        if (!origen || !destino) return J({ error: "Producto no encontrado." }, 404);
        if (origen.sku !== destino.sku) return J({ error: "Los productos de origen y destino no son el mismo artículo (SKU distinto)." }, 400);
        const cant = Number(body.cantidad);
        if (!Number.isInteger(cant) || cant <= 0) return J({ error: "La cantidad debe ser un entero mayor a 0." }, 400);
        if (origen.stockActual < cant) return J({ error: `"${origen.nombre}" solo tiene ${origen.stockActual} unidades en origen.` }, 400);
        const t = { id: uuid("t"), productoOrigenId: origen.id, productoDestinoId: destino.id, sku: origen.sku, nombre: origen.nombre, desde: origen.ubicacionId, desdeNombre: nombreUbic(origen.ubicacionId), hacia: destino.ubicacionId, haciaNombre: nombreUbic(destino.ubicacionId), cantidad: cant, estado: "solicitada", fecha: new Date().toISOString() };
        transferencias.push(t);
        mov("transferencia-solicitada", { producto: t.nombre, cantidad: cant, desde: t.desdeNombre, hacia: t.haciaNombre });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/aprobar$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transferencia no encontrada." }, 404);
        if (t.estado !== "solicitada") return J({ error: `Esta transferencia ya está en estado "${t.estado}".` }, 400);
        const origen = productos.find((x) => x.id === t.productoOrigenId);
        if (!origen || origen.stockActual < t.cantidad) return J({ error: "Ya no hay suficiente stock en origen para aprobar esta transferencia." }, 400);
        origen.stockActual -= t.cantidad;
        t.estado = "en_transito";
        mov("transferencia-aprobada", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/confirmar-recepcion$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transferencia no encontrada." }, 404);
        if (t.estado !== "en_transito") return J({ error: `Esta transferencia está "${t.estado}", no se puede confirmar recepción.` }, 400);
        const destino = productos.find((x) => x.id === t.productoDestinoId);
        if (!destino) return J({ error: "Producto destino no encontrado." }, 404);
        destino.stockActual += t.cantidad;
        t.estado = "recibida";
        mov("transferencia-recibida", { producto: t.nombre, cantidad: t.cantidad, desde: t.desdeNombre, hacia: t.haciaNombre });
        return J(t);
      }
      if ((m = path.match(/^\/api\/transferencias\/([^/]+)\/rechazar$/))) {
        const t = transferencias.find((x) => x.id === m[1]); if (!t) return J({ error: "Transferencia no encontrada." }, 404);
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
        if (!ubicacionId || ubicacionId === "todas") return J({ error: "Elige una ubicación específica para guardar sus gastos mensuales." }, 400);
        if (!isFinite(monto) || monto < 0) return J({ error: "El monto debe ser un número igual o mayor a 0." }, 400);
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
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return J({ error: "No hay cantidades que aplicar." }, 400);
        const errores = [];
        let aplicadas = 0;
        for (const it of items) {
          const p = productos.find((x) => x.id === it.productoId);
          const cant = Number(it.cantidad);
          if (!p || !Number.isInteger(cant) || cant <= 0) { errores.push("Hay un ítem inválido en el cierre."); continue; }
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
        if (!body.nombre || !String(body.nombre).trim()) return J({ error: "El nombre del cliente es obligatorio." }, 400);
        const nuevoCli = { id: uuid("c"), codigo: siguienteCodigoCliente(), nombre: String(body.nombre).trim(), telefono: String(body.telefono || "").trim() };
        clientes.push(nuevoCli);
        mov("cliente-alta", { cliente: nuevoCli.nombre, codigo: nuevoCli.codigo });
        return J(fichaCliente(nuevoCli));
      }
      if (path === "/api/clientes/importar" && opts && opts.method === "POST") {
        const entrantes = Array.isArray(body.clientes) ? body.clientes : [];
        if (!entrantes.length) return J({ error: "No hay clientes que importar." }, 400);
        if (entrantes.length > 5000) return J({ error: "Demasiados clientes de una vez (maximo 5000)." }, 400);
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
          const t = f.evaluacion.trato, cv = f.evaluacion.confiabilidad;
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
        if (!c) return J({ error: "Cliente no encontrado." }, 404);
        if (!c.evaluacion) c.evaluacion = { trato: 0, confiabilidad: 0, historial: [] };
        if (body.trato !== undefined) c.evaluacion.trato = Math.max(-1, Math.min(1, Number(body.trato)||0));
        if (body.confiabilidad !== undefined) c.evaluacion.confiabilidad = Math.max(-1, Math.min(1, Number(body.confiabilidad)||0));
        c.evaluacion.historial = c.evaluacion.historial || [];
        // horaIncidente: hora local del evento según el empleado (HH:MM), para conciliación con cámaras/audios.
        c.evaluacion.historial.push({ trato: c.evaluacion.trato, confiabilidad: c.evaluacion.confiabilidad, quien: body.quien || "Sistema", fecha: new Date().toISOString(), horaIncidente: body.horaIncidente || null });
        mov("cliente-evaluado", { cliente: c.nombre, trato: c.evaluacion.trato, confiabilidad: c.evaluacion.confiabilidad, horaIncidente: body.horaIncidente || null });
        guardar();
        return J(fichaCliente(c));
      }

      // POST /api/clientes/:id/despedir — excluye al cliente de la operación activa.
      // POST /api/clientes/:id/reactivar — lo devuelve.
      const mCliAct = path.match(/^\/api\/clientes\/([^/]+)\/(despedir|reactivar)$/);
      if (mCliAct && opts && opts.method === "POST") {
        const c = clientes.find((x) => x.id === mCliAct[1]);
        if (!c) return J({ error: "Cliente no encontrado." }, 404);
        const accion = mCliAct[2];
        c.despedido = accion === "despedir";
        mov(accion === "despedir" ? "cliente-despedido" : "cliente-reactivado", { cliente: c.nombre, quien: body.quien || "Sistema" });
        guardar();
        return J({ ok: true, despedido: c.despedido });
      }
      if (path === "/api/inventario/bcg") return J(matrizBCG(uid));

      // === USUARIOS NOMBRADOS — multi-usuario 2026-07-07 ========================
      // El dueno crea empleados desde Avanzado -> Empleados.
      // Cada empleado tiene un PIN propio de 3 digitos distinto a los demas.
      // NO se puede verificar aqui si colisiona con el PIN del dueno/contador
      // (esos hashes viven en crypto-store, no en este mock). Se pide al dueno
      // que elija PINs que no coincidan con los suyos.

      // GET /api/usuarios — lista empleados (sin PIN, solo id/nombre/rol/activo)
      if (path === "/api/usuarios" && (!opts || !opts.method || opts.method === "GET")) {
        return J(usuarios.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo, creadoEn: u.creadoEn })));
      }
      // POST /api/usuarios — crear empleado (solo alcanzable desde Avanzado = dueno)
      if (path === "/api/usuarios" && opts && opts.method === "POST") {
        const nombre = String(body.nombre || "").trim().slice(0, 60);
        const pin    = String(body.pin    || "").trim();
        if (!nombre)                     return J({ error: "El nombre del empleado es obligatorio." }, 400);
        if (!/^\d{3}$/.test(pin))        return J({ error: "El PIN debe tener exactamente 3 digitos." }, 400);
        if (usuarios.length >= 49)       return J({ error: "Limite de 49 empleados alcanzado." }, 400);
        if (usuarios.some((u) => u.pin === pin)) return J({ error: "Ese PIN ya lo usa otro empleado. Elige uno diferente." }, 400);
        const nuevo = { id: uuid("u"), nombre, pin, rol: "empleado", activo: true, creadoEn: new Date().toISOString() };
        usuarios.push(nuevo);
        mov("usuario-alta", { nombre, rol: "empleado" });
        return J({ id: nuevo.id, nombre: nuevo.nombre, rol: nuevo.rol, activo: nuevo.activo, creadoEn: nuevo.creadoEn });
      }
      // PATCH /api/usuarios/:id — editar nombre, activar/desactivar, cambiar PIN
      if (/^\/api\/usuarios\/[^/]+$/.test(path) && opts && opts.method === "PATCH") {
        const uid2 = path.split("/").pop();
        const u = usuarios.find((x) => x.id === uid2);
        if (!u) return J({ error: "Empleado no encontrado." }, 404);
        if (body.nombre !== undefined) u.nombre = String(body.nombre).trim().slice(0, 60) || u.nombre;
        if (body.activo !== undefined) u.activo = !!body.activo;
        if (body.pin !== undefined) {
          const np = String(body.pin).trim();
          if (!/^\d{3}$/.test(np)) return J({ error: "El nuevo PIN debe tener 3 digitos." }, 400);
          if (usuarios.some((x) => x.id !== uid2 && x.pin === np)) return J({ error: "Ese PIN ya lo usa otro empleado." }, 400);
          u.pin = np;
        }
        mov("usuario-editar", { id: uid2, nombre: u.nombre });
        return J({ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo, creadoEn: u.creadoEn });
      }
      // POST /api/usuarios/verificar — recibe { pin }, devuelve { id, nombre, rol } o 401
      // Llamado por auth-ui.js durante el login para identificar empleados nombrados.
      if (path === "/api/usuarios/verificar" && opts && opts.method === "POST") {
        const pin = String(body.pin || "").trim();
        const u = usuarios.find((x) => x.activo && x.pin === pin);
        if (!u) return J({ error: "PIN no corresponde a ningun empleado activo." }, 401);
        return J({ id: u.id, nombre: u.nombre, rol: u.rol });
      }
      // =========================================================================

      // === APROPIACIÓN 789 — instancia propia (2026-07-08) =====================
      // Llamado por auth-ui.js durante la secuencia de activación con 789.
      // { vaciar:bool, instanceId:string }. Si vaciar=true, entrega el negocio
      // en blanco (sin datos-semilla de ejemplo). Persiste el estado para que
      // el arranque quede fijado como instancia propia, no como demo.
      if (path === "/api/instancia/activar" && opts && opts.method === "POST") {
        if (typeof body.instanceId === "string" && body.instanceId) instanceId = body.instanceId;
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

      return J({ error: "Ruta no encontrada en la demo." }, 404);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
    } finally {
      // Item 1: persistir tras cada mutacion — asi un refresh (o cerrar la
      // pestana) ya no pierde ventas ni productos nuevos.
      if (debePersistir) guardarEstadoLocal();
    }
  };
})();
