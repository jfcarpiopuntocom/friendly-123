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

  /* JFC 2026-10-08: recognize historical canonical seeds as well as today's seed.
     Sources: 846bd48e858b, 4f0350938649, db221c24ee41.
     Full multi-field fingerprints only; a reused id or name alone is never sufficient. */
  var HISTORICAL = {"productos":[["p01","Camiseta Pink Floyd - The Dark Side","CAM-PF-DSM","7861000030019"],["p02","Camiseta Metallica - Master of Puppets","CAM-MET-MOP","7861000030026"],["p03","Camiseta AC/DC - Back in Black","CAM-ACDC-BIB","7861000030033"],["p04","Camiseta Nirvana - Nevermind","CAM-NIR-NVM","7861000030040"],["p05","Camiseta Iron Maiden - The Trooper","CAM-IM-TRP","7861000030057"],["p06","Camiseta The Rolling Stones - Lengua","CAM-RS-TON","7861000030064"],["p07","Camiseta Led Zeppelin - Icarus","CAM-LZ-ICA","7861000030071"],["p08","Camiseta Ramones - Presidential Seal","CAM-RAM-PRS","7861000030088"],["p09","Camiseta Guns N' Roses - Appetite","CAM-GNR-APP","7861000030095"],["p10","Camiseta Queen - Crest","CAM-QUE-CRS","7861000030101"],["p11","Taza Ceramica Rock Cuenca","SOU-TAZ-001","7861000030118"],["p12","Llavero Guitarra Metalico","SOU-LLA-001","7861000030125"],["p13","Pin Esmaltado de Banda","ACC-PIN-001","7861000030132"],["p14","Parche Bordado Rock","ACC-PAR-001","7861000030149"],["p15","Gorra Snapback Rock","SOU-GOR-001","7861000030156"],["p16","Puas de Guitarra Pack x6","ACC-PUA-006","7861000030163"],["p17","Nuestra parte de noche — Mariana Enriquez","LIB-ENR-NPN","9789584293152"],["p18","Temporada de huracanes — Fernanda Melchor","LIB-MEL-TDH","9786071653697"],["p19","Kentukis — Samanta Schweblin","LIB-SCH-KEN","9788439735564"],["p20","Cometierra — Dolores Reyes","LIB-REY-COM","9789878358154"],["p21","Mugre rosa — Fernanda Trías","LIB-TRI-MGR","9789974723146"],["p22","Pelea de gallos — María Fernanda Ampuero","LIB-AMP-PDG","9788417125400"],["p23","Paradais — Fernanda Melchor","LIB-MEL-PAR","9786071677129"],["p24","Las aventuras de la China Iron — Cabezón Cámara","LIB-CAB-CIA","9789877383652"],["p25","Vinilo Led Zeppelin - Physical Graffiti","VIN-LZ-PGR","7861000030170"],["p26","Vinilo Pink Floyd - Animals","VIN-PF-ANM","7861000030187"],["p27","Camiseta David Bowie - Ziggy Stardust","CAM-BOW-ZIG","7861000030194"],["p28","Poster Metalico AC/DC High Voltage","ACC-POS-001","7861000030200"],["p29","Camiseta The Cure - Disintegration","CAM-CUR-DIS","7861000030217"],["p30","Taza Batman Rock Ceramica","SOU-TAZ-002","7861000030224"],["p31","Agenda Rock 2026 Tapa Dura","PAP-AGE-001","7861000030231"],["p32","Bolsa de Tela Rock Estampada","ACC-BOL-001","7861000030248"],["p33","Libreta Tapa Dura Rock 80 hojas","PAP-LIB-001","7861000030255"],["p34","Vinilo The Clash - London Calling","VIN-CLA-LON","7861000030262"],["p35","Vinilo Radiohead - OK Computer","VIN-RAD-OKC","7861000030279"],["p36","Figura Coleccionable Iron Maiden Eddie","COL-IM-EDI","7861000030286"],["p37","Cafe Molido Artesanal Cuenca 250g","ALI-CAF-001","7861000030293"],["p38","Chocolate 70pct Cacao x10 unidades","ALI-CHO-001","7861000030309"],["p39","Granola Organica Sierra 500g","ALI-GRA-001","7861000030316"],["p40","Llavero Puas de Guitarra","ACC-LLA-001","7861000030323"],["p41","Parche Bordado Nirvana","ACC-PAR-001","7861000030330"],["p42","Vinilo Soda Stereo - Cancion Animal","VIN-SOD-CAN","7861000030347"],["p43","Gorro Beanie Negro Rock","ACC-GOR-002","7861000030354"],["p44","Pilas AA x4 (mostrador)","BAS-PIL-001","7861000030361"],["p45","Funda de Regalo Kraft","BAS-FUN-001","7861000030378"],["p46","Cinta Adhesiva Transparente","BAS-CIN-001","7861000030385"],["p47","CD Bootleg Queen en Wembley","CD-QUE-WEM","7861000030392"],["p48","VHS Coleccion The Wall (pelicula)","COL-VHS-WAL","7861000030408"],["p49","Poster Gigante Woodstock 94","ACC-POS-WOO","7861000030415"],["p50","Sombrero de Paja Toquilla","ART-SOM-001","7861000030422"],["p51","Pulsera de Mullos Andina","ART-PUL-001","7861000030439"],["p52","Bufanda de Alpaca Gris","ROP-BUF-001","7861000030446"],["p53","Aretes de Filigrana Chordeleg","ART-ARE-001","7861000030453"],["p54","Miel de Abeja del Cajas 300g","ALI-MIE-001","7861000030460"],["p55","Chal Bordado Gualaceo","ROP-CHA-001","7861000030477"],["p56","Queso Fresco de Hacienda 500g","ALI-QUE-001","7861000030484"],["p57","Velas Aromaticas de Eucalipto x3","HOG-VEL-001","7861000030491"],["p58","Agua sin Gas 600ml","BAS-AGU-001","7861000030507"],["p59","Chicles Menta (caja mostrador)","BAS-CHI-001","7861000030514"],["p60","Ajedrez Tallado en Madera","HOG-AJE-001","7861000030521"],["p61","Reloj de Pared Cucu Aleman","HOG-REL-001","7861000030538"],["p01","Óleo original — Tejados de Cuenca","ART-OIL-001","7862000010011"],["p02","Acuarela original — Río Tomebamba","ART-WAT-002","7862000010028"],["p03","Lámina — Serie Andes I","ART-PRN-003","7862000010035"],["p04","Lámina — Puertas coloniales","ART-PRN-004","7862000010042"],["p05","Consignación — Tejedora (óleo)","CON-OIL-005","7862000010059"],["p06","Consignación — Mañana de mercado","CON-OIL-006","7862000010066"],["p07","Consignación — Lámina Laguna del Cajas","CON-PRN-007","7862000010073"],["p08","Brújula de latón antigua","ANT-BRS-008","7862000010080"],["p09","Máquina de escribir vintage","ANT-TYP-009","7862000010097"],["p10","Reloj de pared antiguo","ANT-CLK-010","7862000010103"],["p11","Manchego curado 200g","CHE-MAN-011","7862000010110"],["p12","Rueda de Brie","CHE-BRI-012","7862000010127"],["p13","Queso azul 150g","CHE-BLU-013","7862000010134"],["p14","Tabla de quesos y embutidos","CHE-BRD-014","7862000010141"],["p15","Queso fresco local 250g","CHE-FRE-015","7862000010158"],["p16","Malbec Reserva (botella)","WIN-MAL-016","7862000010165"],["p17","Cabernet Sauvignon (botella)","WIN-CAB-017","7862000010172"],["p18","Sauvignon Blanc (botella)","WIN-SAU-018","7862000010189"],["p19","Espumante Brut (botella)","WIN-BRU-019","7862000010196"],["p20","Copa de vino de la casa","BAR-HRE-020","7862000010202"],["p21","Rosé (botella)","WIN-ROS-021","7862000010219"],["p22","Espresso","BAR-ESP-022","7862000010226"],["p23","Cappuccino","BAR-CAP-023","7862000010233"],["p24","Cerveza artesanal (pinta)","BAR-BEE-024","7862000010240"],["p25","Spritz aperitivo","BAR-SPR-025","7862000010257"],["p26","Agua con gas","BAR-WAT-026","7862000010264"],["p27","Plato de tapas","KIT-TAP-027","7862000010271"],["p28","Sándwich tostado","KIT-SAN-028","7862000010288"],["p29","Empanadas (2u)","KIT-EMP-029","7862000010295"],["p30","Bowl de aceitunas y frutos secos","KIT-OLV-030","7862000010301"],["p31","Antología de poesía","LIB-POE-031","7862000010318"],["p32","Historia del arte local (libro)","LIB-ART-032","7862000010325"],["p33","Cata de vinos y quesos (entrada)","EVT-CAT-033","7862000010332"],["p34","Noche de jazz en vivo (entrada)","EVT-JAZ-034","7862000010349"],["p35","Taller de acuarela (cupo)","EVT-ACU-035","7862000010356"],["p36","Noche de tango (entrada)","EVT-TAN-036","7862000010363"],["p37","Exposición fotográfica (entrada)","EVT-FOT-037","7862000010370"],["p38","Recital de poesía (entrada)","EVT-POE-038","7862000010387"],["p01","Butane Torch Lighter","CAM-PF-DSM","7861000030019"],["p02","Souvenir Shot Glass","CAM-MET-MOP","7861000030026"],["p03","Local History Zine Vol. 3","CAM-ACDC-BIB","7861000030033"],["p04","Souvenir Keychain 3-Pack","CAM-NIR-NVM","7861000030040"],["p05","Graphic Tee — Skyline Print","CAM-IM-TRP","7861000030057"],["p06","Poetry Chapbook — Late Bloom","CAM-RS-TON","7861000030064"],["p07","Postcard Rack Set","CAM-LZ-ICA","7861000030071"],["p08","Graphic Tee — Retro Sunset","CAM-RAM-PRS","7861000030088"],["p09","Fridge Magnet Set","CAM-GNR-APP","7861000030095"],["p10","Short Story Collection — Night Shift","CAM-QUE-CRS","7861000030101"],["p11","Handmade Beaded Bracelet","SOU-TAZ-001","7861000030118"],["p12","Bookmark Set — Pressed Flowers","SOU-LLA-001","7861000030125"],["p13","Incense Sticks — Sandalwood","ACC-PIN-001","7861000030132"],["p14","Embroidered Patch — Mountain Range","ACC-PAR-001","7861000030149"],["p15","Snapback Cap — Logo","SOU-GOR-001","7861000030156"],["p16","Reading Journal — Lined","ACC-PUA-006","7861000030163"],["p17","Hand-Painted Ceramic Ornament","LIB-ENR-NPN","9789584293152"],["p18","Novel — The Long Season","LIB-MEL-TDH","9786071653697"],["p19","Local Scene Art Print","LIB-SCH-KEN","9788439735564"],["p20","Novel — Ash and Amber","LIB-REY-COM","9789878358154"],["p21","Poetry — Salt Water Letters","LIB-TRI-MGR","9789974723146"],["p22","Engraved Wood Coaster Set","LIB-AMP-PDG","9788417125400"],["p23","Novel — Low Tide","LIB-MEL-PAR","9786071677129"],["p24","Souvenir Snow Globe","LIB-CAB-CIA","9789877383652"],["p25","Woven Friendship Bracelet Pack","VIN-LZ-PGR","7861000030170"],["p26","Vinyl Record — Midnight Radio","VIN-PF-ANM","7861000030187"],["p27","Graphic Tee — Vintage Fade","CAM-BOW-ZIG","7861000030194"],["p28","Metal Poster — Neon City","ACC-POS-001","7861000030200"],["p29","Novel — Static Line","CAM-CUR-DIS","7861000030217"],["p30","Ceramic Mug — Hand Painted","SOU-TAZ-002","7861000030224"],["p31","Planner 2026 — Hardcover","PAP-AGE-001","7861000030231"],["p32","Canvas Tote Bag — Screen Print","ACC-BOL-001","7861000030248"],["p33","Notebook — Kraft Cover","PAP-LIB-001","7861000030255"],["p34","Hand-Blown Glass Ornament","VIN-CLA-LON","7861000030262"],["p35","Vinyl Record — Signal Lost","VIN-RAD-OKC","7861000030279"],["p36","Collectible Figure — Limited Run","COL-IM-EDI","7861000030286"],["p37","Homemade Strawberry Jam 8oz","ALI-CAF-001","7861000030293"],["p38","Chocolate Bar — Dark 70%","ALI-CHO-001","7861000030309"],["p39","Trail Mix Bag","ALI-GRA-001","7861000030316"],["p40","Keychain — Bottle Opener","ACC-LLA-001","7861000030323"],["p41","Embroidered Patch — Wave","ACC-PAR-001","7861000030330"],["p42","Local Landmark Puzzle","VIN-SOD-CAN","7861000030347"],["p43","Knit Beanie — Charcoal","ACC-GOR-002","7861000030354"],["p44","AA Batteries 4-Pack","BAS-PIL-001","7861000030361"],["p45","Kraft Gift Bag","BAS-FUN-001","7861000030378"],["p46","Clear Packing Tape","BAS-CIN-001","7861000030385"],["p47","Vintage-Style Tin Sign","CD-QUE-WEM","7861000030392"],["p48","Used VHS — Director's Cut","COL-VHS-WAL","7861000030408"],["p49","Oversized Tour Poster","ACC-POS-WOO","7861000030415"],["p50","Woven Sun Hat","ART-SOM-001","7861000030422"],["p51","Beaded Charm Bracelet","ART-PUL-001","7861000030439"],["p52","Wool Blend Scarf — Grey","ROP-BUF-001","7861000030446"],["p53","Filigree Drop Earrings","ART-ARE-001","7861000030453"],["p54","Local Honey 10oz","ALI-MIE-001","7861000030460"],["p55","Embroidered Shawl","ROP-CHA-001","7861000030477"],["p56","Fresh Farmstead Cheese 1lb","ALI-QUE-001","7861000030484"],["p57","Eucalyptus Candle 3-Pack","HOG-VEL-001","7861000030491"],["p58","Bottled Water 20oz","BAS-AGU-001","7861000030507"],["p59","Mint Gum — Counter Box","BAS-CHI-001","7861000030514"],["p60","Carved Wooden Chess Set","HOG-AJE-001","7861000030521"],["p61","Antique Cuckoo Clock","HOG-REL-001","7861000030538"]],"clientes":[["c01","C-1001","Rosa Quinde","0991111001"],["c02","C-1002","Marco Sarmiento","0991111002"],["c03","C-1003","Lucia Chuqui","0991111003"],["c04","C-1004","Ivan Coronel","0991111004"],["c05","C-1005","Maria Belen Torres","0991111005"],["c06","C-1006","Pedro Guaman","0991111006"],["c07","C-1007","Carmen Ulloa","0991111007"],["c08","C-1008","Andres Vintimilla","0991111008"],["c01","C-1001","Ashley Rivera","3055550101"],["c02","C-1002","Marcus Bennett","3055550102"],["c03","C-1003","Lucy Tran","3055550103"],["c04","C-1004","Evan Cross","3055550104"],["c05","C-1005","Maribel Santos","3055550105"],["c06","C-1006","Pete Gorman","3055550106"],["c07","C-1007","Carmen Ulloa","3055550107"],["c08","C-1008","Andre Vinson","3055550108"]],"ubicaciones":[["centro","Local Centro Histórico","propio","suc01",""],["mercado","Stand Mercado 10 de Agosto","socio","suc02","pr01"],["feria","Feria Artesanal El Otorongo","consignacion","suc03","pr02"],["galeria","Galería idiomARTE","propio","suc01",""],["consigna","Consignación de artistas","consignacion","suc01","pr01"],["bar","Bar & Café","propio","suc02",""],["eventos","Eventos culturales","socio","suc03","pr02"],["smokeshop","Cornerstone Local Souvenirs","propio","suc01",""],["bookshelf","Ink & Pages","socio","suc02","pr01"],["fairbooth","Weekend Vendor Fair Booth","consignacion","suc03","pr02"]],"promotoras":[["pr01","Maria Auquilla",10],["pr02","Carlos Once",8],["pr01","María Auquilla",85],["pr02","Carlos Mendoza",10],["pr01","Jamie Ortiz",10],["pr02","Casey Nguyen",8]],"sucursales":[["suc01","Centro Histórico"],["suc02","Mercado 10 de Agosto"],["suc03","El Otorongo"],["suc01","Galería"],["suc02","Bar & Café"],["suc03","Eventos"],["suc01","Downtown"],["suc02","Vendor Row"],["suc03","Riverside Market"]]};
  function historico(tipo, row) { return HISTORICAL[tipo].some(function (d) {
    return d.length === row.length && d.every(function (v, i) { return v === row[i]; });
  }); }
  function mapa(filas) { var m = {}; filas.forEach(function (f) { m[String(f[0])] = f; }); return m; }
  var MP = mapa(PRODUCTOS), MC = mapa(CLIENTES), MU = mapa(UBICACIONES), MR = mapa(PROMOTORAS), MS = mapa(SUCURSALES);
  function s(x) { return String(x == null ? "" : x); }
  function esProducto(p) { var d = p && p.id != null ? MP[s(p.id)] : null; return (!!d && s(p.nombre) === d[1] && s(p.sku) === d[2] && s(p.barcode) === d[3]) || (!!p && historico("productos", [s(p.id), s(p.nombre), s(p.sku), s(p.barcode)])); }
  function esCliente(c) { var d = c && c.id != null ? MC[s(c.id)] : null; return (!!d && s(c.codigo) === d[1] && s(c.nombre) === d[2] && s(c.telefono) === d[3]) || (!!c && historico("clientes", [s(c.id), s(c.codigo), s(c.nombre), s(c.telefono)])); }
  function esUbicacion(u) { var d = u && u.id != null ? MU[s(u.id)] : null; return (!!d && s(u.nombre) === d[1] && s(u.tipo) === d[2] && s(u.sucursalId) === d[3] && s(u.promotoraId) === d[4]) || (!!u && historico("ubicaciones", [s(u.id), s(u.nombre), s(u.tipo), s(u.sucursalId), s(u.promotoraId)])); }
  function esPromotora(p) {
    var d = p && p.id != null ? MR[s(p.id)] : null;
    return (!!d && s(p.nombre) === d[1] && (Number(p.comisionBase != null ? p.comisionBase : p.comision) || 0) === d[2]) || (!!p && historico("promotoras", [s(p.id), s(p.nombre), Number(p.comisionBase != null ? p.comisionBase : p.comision) || 0]));
  }
  function esSucursal(x) { var d = x && x.id != null ? MS[s(x.id)] : null; return (!!d && s(x.nombre) === d[1]) || (!!x && historico("sucursales", [s(x.id), s(x.nombre)])); }
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
    return !!(s(o.instanceId).trim() || s(o.licenseCode).trim() || s(o.syncCode).trim() || sufijo);
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
