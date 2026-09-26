// sw.js — capa PWA mínima para AMIGABLE-123 (item 4, revisión JFC 2026-07-05).
// Cachea el shell estático (HTML/JS/CSS propios) para que la app ABRA sin
// conexión. A propósito NUNCA cachea ni intercepta:
//   - /api/*        → los datos deben ir siempre a la red (o al mock local),
//                     nunca servirse desde una caché vieja (stock/precios).
//   - version.json  → el chequeo de versión (Fase 2) necesita SIEMPRE la
//                     versión fresca del servidor; cachearlo mataría el aviso.
// Item 2 (fuentes offline): también cachea las fuentes de Google
// (fonts.googleapis.com / fonts.gstatic.com) tras la primera visita, así la
// tipografía sobrevive sin conexión. Los font stacks del CSS ya traen
// fallbacks del sistema por si nunca llegaron a cachearse.
/* SUBIR ESTE NUMERO cada vez que cambie cualquier archivo del SHELL. Si no se
   sube, el telefono que ya tiene la app instalada se queda con la version vieja
   PARA SIEMPRE. Hay un chequeo: bash check-sw.sh.
   El historial de que trajo cada version esta en git, no aqui: la lista de
   comentarios pegados a esta linea crecio hasta ser ilegible. */
/* FORTALECIDO 2026-08-25 — "sigue viendo la version vieja hasta en incognito"
   tenia DOS causas distintas y las dos quedan cubiertas (una del todo, la
   otra parcialmente, ver abajo):
   (A) El shell cacheado por este SW no se habia invalidado (numero de CACHE
       sin subir) -> se sube el numero cada vez que se toca algo real.
   (B) El propio archivo sw.js puede quedar servido desde la cache HTTP del
       navegador (GitHub Pages manda max-age=600), y entonces el navegador
       NUNCA llega a comparar bytes con este sw.js nuevo, sin importar cuanto
       se suba el numero de CACHE aqui adentro. ESO NO SE ARREGLA DESDE ESTE
       ARCHIVO: hace falta registrar el SW con { updateViaCache: "none" } en
       el register() (revisar index.html u otro archivo de arranque). Mientras
       tanto este archivo avisa a las pestañas abiertas apenas toma control
       (broadcastActualizacion, abajo) para que el aviso salga lo antes
       posible una vez que el navegador SI agarra el sw.js nuevo.
   Ademas, install/activate/fetch quedan blindados con try/catch: ningun
   error interno deja un evento sin resolver, y el fetch nunca devuelve
   undefined a respondWith (bug real de la v87: el fallback sin cache y sin
   navegacion devolvia undefined, y eso el navegador lo mostraba como "network
   error" en vez de una respuesta controlada).
   2026-08-25 (comisionistas): el shell cambio (index/i18n/mock-backend) y el
   numero ya estaba en v88 por el hardening de arriba — se mantiene v88, cubre
   ambos cambios del mismo dia. */
const CACHE = "f123-shell-v405"; // v405 (JFC 2026-09-25, revision Linus bloque 1): candado entre pestanas para toda escritura (Web Locks) + sello de escritura: dos pestanas ya no pierden ventas; listener storage acepta la clave con prefijo (H1 2026-08-05). ANTERIOR v404: v404 (JFC 2026-09-25): el canario anota la SECCION donde falla (nodos del Sonar); panel con mapa SVG de la app y canarios por parte. ANTERIOR v403: v403 (JFC 2026-09-25): plan canarios F3+F5: salud en el latido (OCSalud, solo numeros), cuadre Sold vs Commissions en el aparato lord, latido de salud cada 3 min en /next/, aparato lord pasa solo a /next/ (salida ?estable=1), franja del canario en Advanced, SW con canal /previo/, Sonar de Canarios en panel.html. ANTERIOR v402: v402 (JFC 2026-09-25): plan canarios F0+F1: el cargador solo usa un origen remoto en el MISMO shell; cache por canal (-next bajo /next/), cada canal borra solo las suyas. ANTERIOR v401: v401 (JFC 2026-09-25): F5 conserva seccion, desplegables abiertos, pestana de Commissions y scroll (sessionStorage f123_ui_pos, solo si la sesion ya existia); la pestana by rack ya no salta a by product al repintar; lineas Sync/Code y caja del origen de Advanced solo en el aparato lord de JFC (o con canario puesto), la medicion sigue. ANTERIOR v400: v400 (JFC 2026-09-25): terminos US (Walk-in customer, House sale, Sales associate, Consignor; research + Jev); la venta ya no reasigna la percha antes de vender (paso que podia trabar la venta y cambiaba el asociado fijo). ANTERIOR v399: v399 (JFC 2026-09-25): la persona elegida en la venta genera comision tambien en perchas propias; ranking y Sold atribuyen a quien vendio; Commissions y Sold se repintan con ventas de otro aparato; "Counter sale" en cursiva; sin topes del viejo plan gratis; save.html sin "Community tier". ANTERIOR v398: v398 (2026-09-25): og:image absoluta + twitter card. ANTERIOR v397: v397 (JFC 2026-09-24, Opus 5.5): NADA FUERA DE VISTA: cuadre del mes arriba en Commissions (/api/comisiones/cuadre: con comision + COUNTER de la casa + perchas propias = Sold; devoluciones; aporte fijo descontado; por pagar con devoluciones), tarjeta con COUNTER SALES y total real, balance a costo propio (consignacion aparte), etiquetas "por venta". ANTERIOR v396: v396 (JFC 2026-09-24, Opus 5.5): CUADRE Hugo/Paco/Luis en Sold y Commissions: B1 venta rechazada ya no baja stock; B2 edicion rechazada no deja cambios a medias; B3 editar venta usa el % sellado; B4 no se anula lo ya pagado; B5 pagar no sella COUNTER SALES; B6 devolucion pagada resta del ingreso del dia. Sold: "No customer", chip COUNTER SALE y comision por fila. ANTERIOR v395: v395 (JFC 2026-09-24, Opus 5.5): ACCESO DE ARTISTA (benchmark #6): PIN propio en la ficha del comisionista, compuerta deny-by-default en mock-backend, vista artista.js (solo agrega piezas a SU percha y ve/imprime las suyas); fix: la foto del alta de producto se guardaba en null. ANTERIOR v394: v394 (JFC 2026-09-25, Opus 5.5): REBAJA POR ANTIGUEDAD (benchmark #3) y LEALTAD (benchmark #5). Rebaja: campo rebajaEdad por percha (apagada por defecto, max 3 pasos, pct 1-90), rebajaDe() la aplica al vender; la lista no cambia; override y cortesia mandan; comision sobre lo cobrado; aviso previo en Today (avisosRebaja, aparte del semaforo). FIX de sync hallado: creadoEn del producto NO viajaba (cada aparato calculaba otra antiguedad); ahora viaja y converge a la fecha mas antigua. Lealtad: ajusteLealtad global (viaja como impuesto/moneda), compras derivadas de las ventas del cliente, sugerencia con boton en el panel de venta, caja en Advanced. test/rebaja-lealtad.test.js rojo-verde. + pista de 12 px a 13 px. // v393 (JFC 2026-09-25, Opus 5.5): ESTADO DE CUENTA DEL COMISIONISTA, paso 2 y 3 (benchmark #1). Boton "Send statement" en la tarjeta de percha de Commissions (solo dueno/admin): arma el mes visto SOLO de esa persona, el dueno elige 7 o 30 dias en cada envio, cifra con estado-cifrado.js y abre WhatsApp con el enlace a estado.html (datos en el fragmento #, sin servidor). estado-cifrado.js y estado.html entran al SHELL. ventas/todas expone medioPagoComision (solo lectura). FIX de contraste: "Mark as paid" pasa a verde oscuro (blanco sobre #0FA46A daba 3.3:1). Manual: seccion de aviso, medio de pago y estado de cuenta. // v392 (JFC 2026-09-24, Opus 5.5): (1) FIX heredado de v379: los ajustes de devolucion se mezclaban por "gana el rev mas alto" y una copia rancia podia volver a pendiente un ajuste ya descontado (descuento doble). Ahora liquidada es monotona y el medio de pago del lado que pago se conserva (rojo-verde en test/commissions-carreras-sync.test.js). (2) FIX mio de v391: la linea del recibo de WhatsApp iba en ingles dentro de un recibo en espanol; ahora "Pagado con: ...". (3) Medio de pago visible: "paid · cash" en la tarjeta de Commissions y en la tabla de comisiones de dashboard.html. // v391 (JFC 2026-09-24, Opus 5.5): MEDIO DE PAGO AL LIQUIDAR (benchmark #4). "Mark as paid" pregunta como se pago (efectivo / transferencia / credito en tienda / otro; cancelar no sella nada). marcar-pagado acepta medioPago opcional y lo sella SOLO en lo que ese pago liquida (ventas medioPagoComision, ajustes, bitacora); sin el campo, igual que antes. Viaja por sync (catalogoPropio + ventas nuevas) y el merge conserva el del lado que pago. Recibo de WhatsApp con "Paid by". test/medio-pago-comision.test.js rojo-verde. // v390 (JFC 2026-09-24, Opus 5.5): AVISO AL COMISIONISTA por WhatsApp (benchmark: Ricochet/ConsignCloud avisan al consignador). Tras una venta con comision, en el aparato que la hizo, tarjeta en linea "Tell Ana their piece sold?" con enlace wa.me al telefono del comisionista y el mensaje listo (producto, percha, total, su comision). Nunca envia solo, no aparece en COUNTER SALE ni sin telefono, se retira a los 20 s. Solo lectura (ventas/todas, promotoras, ubicaciones). // v389 (JFC 2026-09-24, Opus 5.5): CONTRASTE DE TEXTO. Tintas solo para texto --rojo-ink #B8123C (6.4:1) y --rust-ink #A84300 (5.9:1): reemplazan al rojo/naranja de marca SOLO en color: y -webkit-text-fill-color: (index.html, avanzado-extra.js, welcome-ui.js, backup-scheduler.js); fondos, bordes y semaforo sin cambio. Montos de Commissions y Gastos, "Show archived", "At risk" (RFM) y aviso de respaldo a tinta. Auditoria 375 px: bajo contraste de texto sobre claro = 0; quedan botones blancos sobre naranja de marca (texto grande en negrita, 3.2:1 >= 3:1). // v388 (JFC 2026-09-24, Opus 5.5): LEGIBILIDAD medida en Chromium. Movil: .tarjeta .etiqueta (Hoy) y .caja .detalle (Inventario, 76 lineas) y th de reportes 11->13 px. Contraste: boton .ir del escaner y "abrir feria" a --rust-deep (5:1), precio de etiquetas en --rust-deep, aviso de Avanzado en #2F6F86. Textos chicos 80->1; bajo contraste en Etiquetas 47->9. // v387 (JFC 2026-09-24): (1) CARRERAS DE DINERO entre aparatos, cazadas por test/commissions-carreras-sync.test.js: el merge de ventas ya no deja que un rev mas alto DESPAGUE una venta liquidada ni pierda una devolucion/anulacion hecha en otro aparato; liquidada/devuelta/anulada son monotonas, el split pagado se congela, y una venta pagada que vuelve sin clawback genera el ajuste negativo con id determinista (aj-dev-<ventaId>) en los dos aparatos. (2) "Promoter" pasa a "Commissionist/Artist/Promoter" en app y dashboard (la app la usan negocios muy distintos). // v386 (JFC 2026-09-24, Bloque 2): LEGIBILIDAD + SEO. La alerta naranja de Today (li.naranja) llevaba texto blanco sobre el naranja SIMON (2.8:1, fallaba la regla); ahora tinta oscura #7C2D12 sobre #FDD9BE con el mismo borde. index.html suma canonical y JSON-LD (SoftwareApplication, precio 399 USD). robots.txt y sitemap.xml nuevos (fuera del SHELL). save/visualize: chips y boton principal en verde/naranja tinta (no son shell). // v385 (JFC 2026-09-24, pasada Hugo/Paco/Luis de Commissions): FIX de dinero en mock-backend. PATCH /api/ventas/:id/comision cambiaba el % de una venta YA PAGADA y reescribia la comision sellada (13.33 -> 30.00), contra la regla del Bloque 4 (lo pagado jamas se edita). Ahora responde 409 para ventas liquidadas o devueltas; la UI corrige por /comisiones-del-mes (solo pendientes), asi que ningun flujo real cambia. + test/commissions-hugo-paco-luis.test.js (11 casos por el camino real, dos aparatos). // v384 (JFC 2026-09-24, Bloque P fase A): CARGADOR DE CODIGO anti-clon. cargador.js entra al SHELL; los 4 ultimos scripts de index.html (edutips, workshop-brand, inspector, inspector-ui) ya los pide el cargador en orden desde un origen remoto (Hostinger) si hay uno, y desde github.io si no o si falla (falla abierta). Hoy el meta oc-origen-codigo va VACIO: nadie carga remoto; un aparato puede ser canario con localStorage f123_origen_codigo desde Advanced. docs/.htaccess trae el CORS para Hostinger (Pages lo ignora). // v383 (JFC 2026-09-24, Bloque 6b): DASHBOARD con Commissions como ESTRELLA, justo debajo de los KPIs: barra unica (mes + meses sin pagar en rojo + vista producto/percha), cuatro ventanas de estado, tarjetas con fila de stats, meta/tramos, devoluciones y reparto por persona (mes en curso), recibo imprimible SIN logo nuestro, y "Pay in the app" / "Adjust the deal" por deep-link (el tablero no escribe dinero). Ranking plegado al fondo. Solo la foto del propio dueno. // v382 (JFC 2026-09-24): SHELVES. (1) FIX de paleta: vista-perchas.js usaba un semaforo inexacto (#1DB954/#FFB300/#E53935/#2196F3); ahora los hex EXACTOS de SIMON. (2) Percha sin foto: fondo BLANCO con la inicial en tinta (antes un bloque pintado del color del semaforo que lucia roto). (3) Emoji de camara -> icono SVG. (4) La UI se aparta: intro dentro de "How does it work?", orden + Add shelf en UNA barra, pastillas de orden como teclas del case. // v381 (JFC 2026-09-24, Bloque 6a-2): Commissions en disposicion de ficha (RPG): las mismas cuatro cifras, mismas palabras y mismo orden, en UNA fila de stats por tarjeta (producto y percha) en vez de cuatro renglones; totales del mes 4 en fila; textos explicativos plegables bajo "How does it work?"; los meses sin pagar son teclas rojas en la misma fila del selector (sin linea propia); en telefono las acciones comparten fila; "Still to pay" en rust-deep (5:1) por legibilidad. Intuitivo para quien ya la conocia: nada cambia de lugar ni de nombre. // v380 (JFC 2026-09-24, Bloque 6a): Commissions con la UI apartada: UNA barra de control (mes + vista + acciones; aviso de meses sin pagar como linea dentro de la barra), intro y "como funciona" en una linea. Armonia case<->interior: clase .tecla (la misma tecla metalica del header/nav) para los controles de adentro; totales como ventanas de estado (rotulo mono mayusculas + cifra tabular). Deep-link #editar=comisiones:<ubicacionId> desde el dashboard resalta la tarjeta de la percha (data-liq-ubic). Nada del case ni del candado cambia. // v379 (JFC 2026-09-24, Bloque 4): CLAWBACK + SPLIT. Devolver una venta YA PAGADA (boton Return en Sold, dueno/admin/encargado) no edita ni anula lo pagado: agrega un ajuste NEGATIVO fechado hoy (coleccion ajustesComision, append-only, quien/motivo) que se descuenta del proximo pago de esa percha; Commissions lo muestra y marcar-pagado lo sella. Venta repartida entre dos personas: asistente opcional por venta con % de la comision (suma exacta al centavo, la casa no cambia); COUNTER SALE lo ignora. Viaja por sync (add-only) y respaldo. // v378 (JFC 2026-09-24, Bloque 3): Commissions sobre el MARGEN. baseComision "bruto"|"margen" en percha (manda) o persona; null hereda. repartir() aplica el % sobre (bruto - costo) solo si hay costo; sin costo cae a bruto y lo dice (avisoBase). Cada split guarda baseComision + montoBaseComision; corregir % respeta esa base. Viaja en catalogoPropio y estadoParaCheckpoint. Invariante comision+neto=bruto intacta. Editor de percha: select "El % se aplica sobre". // v377 (JFC/Belen 2026-09-24): Commissions en tienda real: perchas sin ventas del mes plegadas (no tarjetas en $0 que parecian relleno); perchas de la semilla VIEJA del demo (bookshelf "Ink & Pages", fairbooth, smokeshop) rotuladas "Sample from the demo", nunca borradas; "by product" vacio explica las ventas en perchas propias. // v376 (JFC 2026-09-24): barra de Inventory bilingue: "Agrupar por familia" y chips "variantes · u." ya no salen en espanol fijo en la UI inglesa; "Sort by:" y columnas de orden se traducen (tambien al cambiar idioma). // v375 (JFC 2026-09-24): EMBUDO en el demo: ganchos-demo.js pone una tarjeta en linea (nunca modal) en Today, Inventory y Commissions con "Start my 30-day full trial" (7-8-9 en el candado) y "See the one-time price" (save.html); copy elegido con Jev. + refresco del demo: un visitante con la semilla vieja recibe la nueva una vez (triple guarda: aparato no activado, ventas semilla vs-, version). // v374 (JFC 2026-09-24): el DEMO trae fotos reales en los 38 productos (CC0 StockSnap/Openverse, 480px WebP, 761 KB en total, fuera del precache; se cachean al verse). Solo semilla intacta recibe foto. // v373 (JFC 2026-09-24, REGLA DURA): avisos rutinarios (recordatorio/confirmacion de respaldo, oferta de resumen semanal) ya no saltan al login: solo al entrar a Advanced, dueno/admin, una vez por sesion y solo con Advanced en pantalla. // v372 (JFC 2026-09-24): el DEMO muestra Commissions de verdad: ventas de 3 meses con reparto calculado por el motor real, mes pasado con saldo pendiente, tramos 85/88/90 de la artista demo y una COUNTER SALE. // v371 (JFC 2026-09-24): Commissions con PERIODO: elegir mes, ver y pagar meses anteriores (antes lo no pagado se volvia invisible al cambiar de mes); aviso rojo de meses con saldo; corregir %/simular solo en el mes en curso. // v370 (JFC 2026-09-24): Commissions abre por producto/SKU y alterna en vivo a percha/evento sin recalcular ni perder datos. // v369 (JFC 2026-09-23): ranking y matriz RFM de Commissions al fondo de todo, debajo del alta de comisionistas. // v368 (JFC 2026-09-23): badges de estado ya no bajan a 11px en movil (minimo 13px). // v367 (JFC 2026-09-23): bloque de comisionistas en la misma escala 13/14/16 (titulos 15->16, Save agent y nombres dejan de heredar 13.33px). // v366 (JFC 2026-09-23): Commissions ordenada y pareja: totales del mes + resumen por producto arriba, perchas al fondo, alta de comisionistas al final; escala tipografica 13/14/16 (sin 12px), sin medallas emoji, sin gris #8A8A8A. // v365 (JFC 2026-09-23): Commissions abre con resumen POR PRODUCTO (desde cada venta, no solo perchas que hoy comparten comision; incluye COUNTER SALE de esas perchas); tarjetas por percha al fondo; CSV y WhatsApp diario por producto; Sold agrega resumen por producto de todas las ventas. // v346 (Belen, JFC 2026-09-22): boton de 1 toque "Pago pendiente" en Clientes (solo dueno/admin): muestra solo quienes deben (saldo < 0). ListaDinamica gana opcion filtros generica y opcional (otras listas intactas) + alPintar, que repinta los saldos tras buscar/ordenar/filtrar. // // v345 (JFC 2026-09-22, Codex #8 y #11): panel de venta completo en ES/EN (18 textos) sin cambiar valores guardados (los option de pago tienen value explicito) ni borrar inputs (cada texto en su span); mensajes de guardar anunciados a lectores de pantalla (aria-live). // // v344 (JFC 2026-09-22, hallazgo #2 de Codex): la configuracion de categorias (propias vacias y ocultas) viaja entre aparatos y en el respaldo. Revision por categoria + lapida: un renombre no resucita el nombre viejo. Las de antes se siembran con revision minima para no ganarle nunca a un borrado real. Guarda contra replica rezagada en sync-yjs (probada: sin ella un aparato NUEVO recibia la borrada). Aditivo: una categoria sin registro jamas se quita. // // v343 (JFC 2026-09-22): cuatro textos que ve el visitante prometian que activar con 789 era gratis (candado del PIN, landing x2, checklist). Con la decision de JFC eso quedo falso: ahora dicen prueba completa de 30 dias. Solo se cambio la palabra falsa; el resto de su redaccion queda igual. // // v342 (JFC 2026-09-22): friendly = DEMO (456) + PRUEBA COMPLETA de 30 dias al activar (789), sin topes; al vencer sin licencia pagada, SOLO LECTURA (ve y exporta todo, no registra nada nuevo) + invitacion a comprar por WhatsApp y correo en un modal y en Ayuda. Datos nunca se borran. Compuerta unica en mock-backend que FALLA ABIERTA (un error nunca bloquea a quien pago). Worker: pagar un aparato paga la licencia entera, de forma monotona. // // v341 (JFC 2026-09-22): lote de Codex terminado por Claude. (1) RECUPERACION MAESTRA: se retira la llave universal que viajaba en el JS publico; la recuperacion usa un permiso temporal (5 min) para UN aparato, emitido desde el panel privado con la credencial que ya existe (no hay secreto nuevo). Sin conexion y sin codigo propio falla cerrado; con codigo propio sigue offline. (2) 10 arreglos de integridad de UI: precio invalido en venta, categorias, ubicaciones, renombrar negocio, cliente sincronizado durante una venta, correo en alta rapida, detalles de venta traducibles sin perder notas. // // v340 (JFC 2026-09-22): auditoria bilingue tras v338; reconstruir selector de ubicaciones usa el idioma vigente y no vuelve a ingles; se agregan claves visibles faltantes para Email y radar de version. Pruebas cubren botones reales, nombre recibido por sync e idioma local independiente. // v339 (JFC 2026-09-22): COUNTER SALE es una venta pura de la casa: no exige associate/comisionista, no genera split ni modifica el acuerdo permanente de la percha. El modo se guarda por venta; elegir una persona conserva el flujo comisionado. // v338 (JFC 2026-09-22): "aprieto el boton de idiomas y el header vuelve a My store or shelf(s)". El span del nombre llevaba data-i18n FIJO y applyStatic reescribe todo [data-i18n] al cambiar idioma: pisaba un DATO DEL USUARIO, incluso el nombre recien llegado por sync desde otro aparato. Ahora un solo dueno por elemento: con nombre real el span no lleva data-i18n; sin nombre si, y el placeholder se traduce. Mismo arreglo para heroTitulo (su data-i18n sigue la clave vigente del estado del dia) y el subtitulo de carga que estaba en ingles duro. // v337 (JFC 2026-09-22): FIX DE COSTO en mi propia v335. El ping de reloj corria cada 60s en LOS TRES canales (catalogo/fotos/ops); el relay usa WebSocket Hibernation y cada mensaje lo despierta: 3 despertares/min/aparato en reposo, para siempre. Ahora: un ping al conectar, solo en catalogo, y luego solo por actividad. Costo en reposo: cero. + Beautiful Code (principio 4): el SLA de 2000 ms pasa a constante SLA_MS (vivia anonimo en un ternario) y el tamano de pagina del DO deja de estar duplicado. // v336 (JFC 2026-09-22): (1) Labels abre con "Scan a label" ARRIBA de la lista de impresion: una etiqueta se imprime una vez y se escanea muchas, asi que la accion frecuente va bajo el pulgar y empuja a escanear en vez de teclear (teclear es de donde salen las ventas cargadas al producto equivocado). Reusa el boton del nav, no duplica navegacion. (2) test/respaldo-whatsapp.test.js: viaje completo del Export/Import por WhatsApp, incluido que un archivo corrupto se RECHAZA sin tocar el negocio (importar reemplaza TODO) y que queda snapshot para deshacer. // v335 (JFC 2026-09-22): MEDIR el SLA de 2s en vez de afirmarlo. No existia UNA sola medicion de latencia en el codigo: solo "connected/NOT connected". Nuevo sync-latencia.js: ancla los relojes al del relay con intercambio estilo NTP (los relojes de dos aparatos NO estan sincronizados, una resta ingenua de Date.now() daria numeros falsos o negativos), mide acciona->visible y reporta p50/p95 CON su margen de error (rtt/2). Viaja por frames de control k:"ts"/k:"lat" FUERA del camino de datos de Yjs, asi que no puede corromper ni retrasar un cambio real; un relay o cliente viejo los ignora. // v334 (JFC 2026-09-22): PERDIDA SILENCIOSA DE FOTOS EN EL RESPALDO. El export de WhatsApp armaba fotosPerchas leyendo localStorage, que es el almacen VIEJO: desde v244 las fotos viven en IndexedDB por hash (idb-fotos.js) y en localStorage solo quedan borrados de limpieza. El respaldo salia SIN NINGUNA foto y decia "Copy downloaded" igual. Ahora el paquete agrega fotosIDB con el almacen real, el import lo restaura, y los mensajes dicen cuantas fotos y cuanto pesa. schemaVersion se queda en 2 a proposito para no hacer que una app vieja rechace el archivo. // v333 (JFC 2026-09-22): endurecimiento de sync, dos fixes aditivos. (1) despedir/reactivar un cliente no subia c.rev, asi que el merge (aplicarCatalogo) lo descartaba y el cliente quedaba vivo en un aparato y despedido en el otro; ahora sube rev y avisa al sync para converger en ~400ms en vez de esperar el re-sembrado de 2s. (2) /api/liquidaciones/:id/marcar-pagado no validaba el verbo HTTP pese a sellar ventas como liquidadas (escritura de dinero); ahora exige POST como sus 17 vecinos, el unico llamador real ya mandaba POST. + test/sync-hardening.test.js con 4 regresiones verificadas rojo-verde. // v332 (JFC 2026-09-22): dos causas reales de Commissions divergente entre aparatos. (1) al archivar un comisionista, las perchas desasignadas no subian su rev -> Yjs podia conservar el promotoraId viejo en otro aparato. (2) el PUT que asigna comisionista a la percha ANTES de vender tragaba cualquier fallo (catch vacio) y la venta seguia igual, pudiendo calcular el split con el acuerdo viejo; ahora bloquea la venta con aviso claro si esa asignacion no se confirma. 75/75 tests. // v331 (JFC 2026-09-22): borde del candado del PIN vuelve a AZUL (var(--brass) #5294AC) como en AMIGABLE; v314 lo habia dejado en naranja (var(--rust) #E86040) al clonar el PIN. // v330 (JFC 2026-09-22): boton "Purge & reload" del candado fortificado para telefonos viejos -- timeout por paso (no se cuelga si SW/CacheStorage nunca resuelve en motores antiguos), la recarga SIEMPRE se intenta aunque un paso falle, y la recarga final usa cache-busting por query string (location.replace con ?_purge=timestamp) en vez de reload(true), que ya no fuerza bypass del disco-cache HTTP en navegadores modernos. No toca localStorage/sessionStorage. // v280 (JFC 2026-09-15): AUTO-RECUPERAR inventario SIN BOTÓN. Si al entrar a la licencia el aparato queda sobre un namespace de tienda VACÍO pero tiene su inventario guardado bajo otra tienda del MISMO aparato, al arrancar lo adopta solo a la tienda de la licencia (no borra, la otra conserva copia). Arregla el "entro y sale vacío / My store or shelf(s)". // v279 (JFC 2026-09-15): GENERICIZAR la semilla demo — fuera "Galería idiomARTE", "María Auquilla", "Carlos Mendoza" (nombres que parecían datos reales de la clienta). Ahora "Sample Gallery" / "Consignment Artist (sample)" / "Event Partner (sample)". El demo NO lleva datos de ningún cliente. // v278 (JFC 2026-09-15): "Join this notebook" ahora RECONCILIA (conserva la data) si el aparato ya es DUEÑO ACTIVADO, en vez de unirse a un store vacío/semilla y huerfanar el inventario. Deshace el daño de haber quitado el botón Claim anoche: un dueño unifica sus propios aparatos sin perder datos. // v277 (JFC 2026-09-15): al RENOMBRAR el negocio se manda heartbeat con el nombre nuevo -> llega al panel privado de licencias al instante (antes solo en el próximo login; por eso "Unificada 15 de sept" no aparecía). // v276 (JFC 2026-09-15): línea de ESTADO DE SYNC en el panel (connected/NOT + conteos de products/shelves/photos) para VER en cada aparato si están en la misma sala y por qué dos devices muestran distinto. Diagnóstico honesto de una línea (no el panel viejo que aturdía). // v275 (JFC 2026-09-15): DEVOLVER EL 888 a idiomARTE/Sarah. Causa: el merge del sync (take()) trataba 888 como PIN de fábrica y ADEMÁS pisaba el sidecar del dueño con el PIN remoto -> se le borraba el 888 y salía demo. Fix: 888 = PIN custom válido (solo 789 es fábrica); el sidecar del dueño ya no se pisa si tiene un PIN real; y re-restauración v2 del 888 en los aparatos que corrieron la migración vieja. // v274 (JFC 2026-09-15): SIMPLIFICAR panel de sync — se quita el DUPLICADO "Turn off sync" (era lo mismo que Deactivate); los botones de WhatsApp pasan ARRIBA en verde donde estaba "Share with my team" (que se quita, redundante), con etiquetas literales "Export via WhatsApp" / "Import from WhatsApp"; se elimina la sección "Move a copy" de abajo (ocupaba espacio de más). // v273 (JFC 2026-09-15): MENU PRINCIPAL — fix del "se inicia caido" (--riel-top se medía con offsetTop y sumaba banners de arriba -> mucho espacio antes de los botones; ahora mide solo el alto del header + clamp + re-mide al asentar el layout). Advanced: todos los items del riel con icono (fix del observer que agregaba secciones sin icono + lookup normalizado NFC), rótulos largos CABEN en 320px (wrap + reset de white-space). // v272 (JFC 2026-09-15): Forma B ahora es par CASADO Export+Import por WhatsApp — el Export envuelve {schemaVersion,datos,fotos} (SIN claves/PIN, no deben viajar por WhatsApp) e IMPORTABLE; el Import (cajita de archivo + boton) confirma y restaura via /respaldo/importar. FIX: antes el Export bajaba el JSON crudo, que NO era importable. // v271 (JFC 2026-09-15): Export Forma B REAL por WhatsApp — el boton "Download & share on WhatsApp" descarga el respaldo (/respaldo/exportar) como archivo y abre WhatsApp con un mensaje listo (soberano, no toca servidor nuestro); el duenio adjunta el archivo. Reemplaza el placeholder (soon). // v270 (JFC 2026-09-15): Export — Forma B. Botón "Export a copy (soon)" (placeholder deshabilitado) en el panel de sync, junto al toggle de Device sync. Además: se quita el emoji ⬇️ del botón "Export backup" existente (regla sin-emojis), ahora ⤓. // v269 (JFC 2026-09-15): poda del panel de sync en Advanced — se BORRARON los botones muertos (Resync, Merge inventory, Rotate license, Claim & merge), el "reenganche" (auto-ayuda naranja con emojis) y el bloque "Sync diagnostics" (Fix split identity / Copy). Quedan solo Activate / Share (WhatsApp) / Join notebook / Deactivate. El toggle deja de decir "experimental/off": ahora "Device sync", honesto (on por defecto, se puede apagar). // v268 (JFC 2026-09-15): iconos del riel de Advanced — TODOS los items con icono monocromo que SIGNIFICA lo que es (➊ First Steps, ⇄ sync, ⧉ equipo, ≡ bitácora, ⊘ antifraude, ◉ en vivo, ◈ acceso, Σ contable, ⤓ backup, ▤ reporte, ◫ comparar perchas, ⌖ ubicación, ◷ zona horaria, ⊟ gastos). Sin emojis (glifos de texto, no se pintan a color en iOS). // v267 (JFC/Belén 2026-09-15): sync nuevo (Yjs) ENCENDIDO por defecto — es el único motor que cruza los BYTES de las fotos device-to-device (sala "-fotos"); ahora las fotos sincronizan sin tocar el toggle. En paralelo al sync viejo, room-gated (cero costo para el que trabaja solo), escotilla "0" en Avanzado. // v266 (JFC/Belén 2026-09-15): Descuento / precio de casa — un producto lleva un 2º precio OPCIONAL para la gente de la casa (cerveza $5 público / $3 artistas) sin partir el stock; en la venta "Adjust price / discount" cobra otro precio en esa venta (botón que llena el precio de casa de un toque); precioCasa converge entre aparatos; + guard-demo (aparato real no arranca con la semilla de ejemplo). // v265 (JFC 2026-09-11): Team — TODOS los miembros con lapicitos por-campo (nombre+email); fila del dueño deja de ser estática (edita nombre del negocio + correo de recuperación protegido); sello de reglas dueño-manda. // v264 (JFC 2026-09-11): Comisiones dashboard - el % de la casa se enchufa a pctQuedaEnCasa (que la app ya calcula) en vez de un 100-pct ingenuo que mentia con aporte fijo/minimo garantizado. // v263 (JFC 2026-09-11): tabs del dashboard scrollean en horizontal (7 vistas ya no se aprietan/envuelven); CSS aditivo, mismo look. // v262 (JFC 2026-09-11): #2 Comisiones EDITABLE desde el dashboard - lapicito por percha que abre el editor de comision de la app (deep-link #editar=comisionpercha:<ubicacionId>). Aditivo: el lapiz solo aparece si hay id, si no, no rompe nada. // v261 (JFC 2026-09-11): contraste del dashboard - audit real de contraste (WCAG AA 4.5:1); el gold del summary "My log" pasaba de 3.09 a 5.11 (#B8860B->#8A6400). La caja demo era falso positivo (tan claro, no marron); el naranja de marca #E86040 se respeta. // v260 (JFC 2026-09-11): microfixes de mis propios errores - #8 "See purchases" empareja por clienteId (no mezcla homonimos); J el aviso de merge EXPIRA (~3 min, ya no se re-pinta hasta recargar); #12 el deep-link avisa si la venta esta liquidada (bloqueada) en vez de solo resaltarla. // v259 (JFC 2026-09-10): robustez world-class del sync nuevo - acepta mensajes del relay como ArrayBuffer O Blob (algunos navegadores/proxies entregan Blob aunque se pida arraybuffer); antes rechazaba lo que no fuera ArrayBuffer. // v258 (JFC 2026-09-10): microfixes de la repasada - [F] Restock sugiere cuanto pedir aunque la percha no tenga umbral amarillo (antes salia en blanco); [A] piso duro del tamano de foto (una imagen rarisima SIEMPRE cabe en el frame del relay). // v257 (JFC 2026-09-10): #3 los PIN de admin abren el dashboard (la app publica f123_admins_pins y el gate del tablero la lee); #8 la ficha del cliente despliega "See purchases" con el detalle claro (fecha, producto, monto, chip fiado/pagado/cortesia + cuanto debe en fiado). // v256 (JFC 2026-09-10): #6 dashboard editor v1 - lapicito por venta que abre la app en su editor probado via deep-link #editar=venta:<id> (corregir precio/cantidad ex-post para cuadrar la ganancia real, como pide Belen). El dashboard no edita dinero: reusa el editor de la app (solo dueno/admin). // v255 (JFC 2026-09-10): #7 stock de BEBIDAS se reescala al cambiar el ml por copa (antes editabas copas/ml y el stock no cambiaba - queja de Belen). Conserva el volumen fisico. // v254 (JFC 2026-09-10): [A] cap de foto <180KB (superaban el frame de 256KB del relay -> se cortaba el socket, no cruzaban fotos y reconectaba en bucle = limite diario del worker); [B] backoff exponencial+jitter en reconexiones del sync nuevo; [#4] RESTAURAR el PIN 888 de dueños reales (idiomARTE) que una migracion 888->789 borro en silencio. // v253 (JFC 2026-09-10): FIX del bug "no sincronizan fotos ni el nombre" — el sync nuevo no tenia handshake de catch-up (solo mandaba estado en onopen), asi que lo puesto antes de que el otro aparato entrara nunca llegaba. Ahora handshake state-vector (SV->diff->SV) en los 3 canales; + aplicar nombre-solo; + reintento de ops si el handler lanza.; // v252 (JFC 2026-09-10): se retira el enlace "campo de pruebas" (workshop) del candado — ya no se quiere que la gente acceda al workshop. // v251 (JFC 2026-09-10): enchufe final al dashboard del dueno — el snapshot ahora envia promotoras y movimientos; dos vistas nuevas (Restock = punto de reorden, Promoters = comisionistas que ya sincronizan). // v250 (JFC 2026-09-10): dashboard con control de cambios EN COLORES — cada dispositivo un color estable, franja+punto por movimiento, tipo tenido por categoria (venta/borrado/edicion). // v249 (JFC 2026-09-10): sync integral TOTAL — las ventas/ops tambien viajan por el sync nuevo como eventos append-only y se aplican una sola vez (idempotente por opId, se saltan los propios por deviceId: cero doble plata). En paralelo al sync viejo (respaldo), detras del flag. // v248 (JFC 2026-09-10): sync integral — comisionistas (promotoras) y sucursales tambien sincronizan add-only (nunca se pisa una comision). Ventas/dinero siguen por el sync de ops. // v247 (JFC 2026-09-10): fotos B3 — los BYTES de las fotos cruzan device-to-device por un doc/relay Yjs separado ("-fotos"); la percha muestra su foto aunque haya llegado de otro aparato. // v246 (JFC 2026-09-10): el toggle "New sync (experimental)" se movio al pie del panel Shared notebook (subseccion de equipo/sync), donde JFC lo espera. // v245 (JFC 2026-09-10): fotos B2 — el puntero fotoHash viaja en el catalogo y converge add-only entre aparatos (los bytes iran a la nube del dueno en B3). // v244 (JFC 2026-09-10): fotos B0 (subir calidad, lado mayor 1600px/0.9, ya no 640px borroso) + B1 (almacen de fotos por hash SHA-256 en idb-fotos, dedup, base del sync de fotos). // v243 (JFC 2026-09-10): cierre del sync — nombre del negocio mergea (dueño gana, A1); aviso de merge dentro de Today's alerts en vez de banner suelto (A2); re-pinta Hoy tras merge para soltar "Loading..." (A3). // v242 (JFC 2026-09-09): fix mojibake en 4 iconos del riel de Advanced (First Steps ◎, Accounting ▤, Backup ◉, Reporte contable ▦) doble-codificados. // v241 (JFC 2026-09-10): regenerar version-manifest.json (quedo viejo tras Fase 2 — hashes no cuadraban; fail-open, nadie afuera). // v240 (JFC 2026-09-09): sync Fase 2 — Plan C (Yjs) YA lee/escribe el store real con merge add-only (OCSync.aplicarCatalogo); toggle "New sync (experimental)" en Avanzado. // v239 (JFC 2026-09-10): sync Fase 1 (todas las colecciones por Yjs) + promesa "no tocamos TU nube" en Ayuda. // v238 (JFC 2026-09-10): Plan C del sync (Yjs/CRDT) detrás de flag OC_YJS_FASE0 — sync-yjs.js + vendor/yjs-bundle.min.js al SHELL, apagado por defecto. // v236 (JFC 2026-09-09): caza 33 — repintado tras activar (las camisetas que no se iban), dashboard.html al SHELL, venta y transferencia rechazan datos invalidos en vez de adivinarlos. // v233 (JFC 2026-09-09): version publica fija en v1.0 (se declara en el PIN); de aqui solo sube el entero del shell. // v222 (JFC 2026-09-08): botón Purge & Reload al pie del candado — sube shell para que los aparatos re-precacheen el auth-ui.js nuevo y su hash cuadre con version-manifest.json. // v192: 12 micromejoras (lapicito único + naranja de precaución, paleta del dinero, fechas locale, actividad→registro, crédito↔ítem, chip filtra gastos, undo cancelación 5s, editar/cancelar venta solo dueño/admin, crédito por expirar, editar evento/comprador, editar expiración de crédito)
const SHELL = [
  "./",
  "./index.html",
  "./logo.png",
  "./aislamiento.js",
  "./404.html",
  "./manual.html",
  "./manual-logo.png",
  "./barcode128.js",
  "./qrcode-local.js",
  "./favicon.png",
  "./pocketbase-client.js",
  "./estado-idb.js", "./mock-backend.js", "./red-segura.js",
  "./device-identity.js",
  "./storage-durabilidad.js",
  "./sync-realtime.js",
  "./sync-watchdog.js",
  "./sync-yjs.js",
  "./sync-latencia.js",
  "./licencia-prueba.js",
  "./vendor/yjs-bundle.min.js",
  "./lista-dinamica.js",
  "./vendor/ufuzzy.min.js",
  "./vendor/minisearch.min.js",
  "./i18n.js",
  "./crypto-store.js",
  "./email-recovery.js",
  "./auth-ui.js",
  "./backup-scheduler.js",
  "./avanzado-extra.js",
  "./artista.js", // benchmark #6 (v395)
  "./soporte-visual.js",
  "./geo-ping.js",
  "./novedades.js",
  "./help-ui.js",
  "./idb-fotos.js",
  "./idb-archivo.js",
  /* B16 (JFC 2026-08-19): el shell cacheaba tablero.html pero NO
     dashboard.html. Desde que tablero.html es solo un redirect a
     dashboard.html, un dispositivo sin conexion seguia el redirect y se
     quedaba en blanco: el destino no estaba en cache. Se cachean los dos —
     tablero.html pesa unos cientos de bytes ahora y hay enlaces viejos
     (WhatsApp, redes) que todavia apuntan ahi. */
  "./simon-config.js", "./percha-reposicion.js", "./micelio-vivo.js", "./micelio-ui.js", "./tablero.html", "./dashboard.html", "./tablero-avanzado.js", "./borradores.js", "./vista-perchas.js",
  "./welcome-ui.js",
  "./ganchos-demo.js",
  "./tutorial-ui.js",
  "./event-bus.js", "./logger.js", "./telemetry.js", "./identity-context.js", "./feature-gate.js", "./audit-store.js", "./sync-queue.js", "./sync-outbox.js", "./ui-actions.js", "./salud-app.js", "./hechos.js", "./reconciliacion.js", "./cartera.js", "./plan-pagos.js", "./plan-pagos-ui.js", "./caja-chica.js", "./respaldo-empleado.js", "./estado-cifrado.js", "./estado.html", "./cargador.js", "./edutips.js", "./workshop-brand.js", "./inspector.js", "./inspector-ui.js", "./manifest.json",
  "./version-manifest.json",
];

// Solo se cachean respuestas de estos orígenes — el propio y las fuentes.
const HOSTS_PERMITIDOS = [self.location.origin, "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

/* DOS CANALES (JFC 2026-09-25, plan canarios F1). El mismo sw.js corre en
   /friendly-123/ (estable, clientes) y en /friendly-123/next/ (canario, aparatos
   lord). Mismo origen = misma CacheStorage: sin esto, al activarse uno borraria
   la cache del otro (el filtro de abajo borra todo "f123-shell-*" ajeno).
   - La cache del canario lleva sufijo "-next"; cada canal borra SOLO las suyas.
   - "que-shell" y el aviso de actualizacion siguen usando CACHE sin sufijo:
     la comparacion con version.json no cambia.
   Para volver a un solo canal: CANAL = "" (todo queda como antes). */
/* 2026-09-25 (F3): tercer canal /previo/ (estable anterior, rewind de emergencia). */
const _mCanal = self.registration ? /\/(next|previo)\/$/.exec(self.registration.scope || "") : null;
const CANAL = _mCanal ? "-" + _mCanal[1] : "";
const CACHE_LOCAL = CACHE + CANAL;
function esDeMiCanal(nombre) {
  if (!nombre.startsWith("f123-shell-")) return false;
  const m = /-(next|previo)$/.exec(nombre);
  return CANAL ? !!(m && "-" + m[1] === CANAL) : !m;
}

// Aviso push a todas las pestañas abiertas (controladas o no) de que este SW
// tomo control con un CACHE nuevo. Complementa al "que-shell" (que es la
// pagina preguntando activamente) — este se dispara solo, sin que nadie
// pregunte, apenas termina "activate".
function broadcastActualizacion() {
  try {
    self.clients.matchAll({ includeUncontrolled: true }).then((lista) => {
      lista.forEach((cliente) => {
        try { cliente.postMessage({ tipo: "shell-actualizado", shell: CACHE }); } catch (_) {}
      });
    }).catch(() => {});
  } catch (_) {}
}

self.addEventListener("install", (evento) => {
  // PRECACHE RESILIENTE (JFC 2026-07-22) — NO volver a cache.addAll(SHELL).
  // addAll es ATÓMICO: si UN archivo del SHELL falla (renombrado, 404, o un
  // timeout de red en el móvil durante la instalación), TODO el precache se
  // aborta y el dispositivo queda SIN shell offline. (El .catch de antes solo
  // evitaba que install rechazara, pero igual no cacheaba NADA.) Con cache.add
  // por archivo + allSettled, un archivo malo solo se pierde a sí mismo y el
  // resto queda cacheado: la app sigue abriendo offline en teléfonos/tablets.
  try {
    evento.waitUntil(
      caches.open(CACHE_LOCAL).then((cache) => Promise.allSettled(
        SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })).catch((e) => { try { console.warn("[SW] no se pudo precachear", u, e && e.message); } catch (_) {} }))
      )).then(() => {
        /* VERIFICACIÓN SRI-STYLE (JFC 2026-08-28, sistema de integridad de
           versión). Tras precachear, se lee version-manifest.json (ya en la
           cache) y se borra de la cache cualquier archivo del shell cuyo
           SHA-256 no cuadre con el manifest. Así una copia corrupta o a medias
           nunca se sirve: la próxima carga la re-pide a la red. Silencioso y
           por archivo (no aborta el precache). */
        try {
          caches.open(CACHE_LOCAL).then((cache) => cache.match("./version-manifest.json").then((res) => {
            if (!res) return;
            res.json().then((man) => {
              if (!man || !man.files) return;
              const promesas = Object.keys(man.files).map((rel) => {
                const esperado = man.files[rel];
                if (typeof esperado !== "string" || esperado.indexOf("sha256-") !== 0) return Promise.resolve();
                return cache.match(rel).then((r) => {
                  if (!r) return;
                  return r.text().then((txt) => {
                    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)).then((buf) => {
                      const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
                      if (("sha256-" + hex) === esperado) return; // cuadra: nada que hacer.
                      /* FAIL-OPEN (JFC 2026-09-08, mejora #1 de la auditoría de versión).
                         ANTES esto hacía cache.delete(rel): si version-manifest.json
                         estaba desincronizado, BORRABA el archivo BUENO y actual, y el
                         aparato quedaba con media app o roto sin conexión. Fue el corazón
                         del incidente de versiones. AHORA no se borra jamás: se re-pide el
                         archivo a la red y se reemplaza SOLO si la copia fresca cuadra con
                         el manifest; si la red falla, o si la copia fresca TAMPOCO cuadra
                         (síntoma de manifest desincronizado, no de archivo corrupto), se
                         CONSERVA la copia que ya estaba servida. La app nunca se queda sin
                         el archivo: peor caso, versión vieja pero funcional. */
                      return fetch(new Request(rel, { cache: "reload" })).then((fresca) => {
                        if (!fresca || !fresca.ok) return; // sin red útil: conservar lo que hay.
                        return fresca.clone().text().then((ftxt) =>
                          crypto.subtle.digest("SHA-256", new TextEncoder().encode(ftxt)).then((fbuf) => {
                            const fhex = Array.from(new Uint8Array(fbuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
                            if (("sha256-" + fhex) === esperado) {
                              return cache.put(rel, fresca); // copia fresca cuadra: reemplazar.
                            }
                            try { console.warn("[SW] manifest posiblemente desincronizado en", rel, "— se conserva la copia servida (fail-open, no se borra)"); } catch (_) {}
                          })
                        );
                      }).catch(() => { /* sin red: conservar la copia que ya está. */ });
                    });
                  });
                });
              });
              Promise.allSettled(promesas).catch(() => {});
            }).catch(() => {});
          })).catch(() => {});
        } catch (_) {}
      }).catch((e) => { try { console.warn("[SW] precache incompleto:", e && e.message); } catch (_) {} })
    );
  } catch (e) {
    // Blindaje 2026-08-25: si algo revienta ANTES de poder extender el
    // evento (p.ej. caches.open no disponible), igual dejamos que install
    // termine sin precache en vez de quedar colgado o rechazado a medias.
    try { console.warn("[SW] install fallo por completo, sigue sin precache:", e && e.message); } catch (_) {}
  }
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  try {
    evento.waitUntil(
      caches.keys()
        .then((nombres) => Promise.all(nombres.filter((n) => esDeMiCanal(n) && n !== CACHE_LOCAL).map((n) => caches.delete(n))))
        .then(() => broadcastActualizacion())
        .catch((e) => { try { console.warn("[SW] activate con errores:", e && e.message); } catch (_) {} })
    );
  } catch (e) {
    try { console.warn("[SW] activate fallo por completo:", e && e.message); } catch (_) {}
  }
  self.clients.claim();
});

self.addEventListener("fetch", (evento) => {
  try {
    const url = new URL(evento.request.url);
    // Nunca /api/*: siempre red (datos en vivo, nunca caché vieja).
    if (url.pathname.startsWith("/api/")) return;
    // Nunca version.json: el aviso de update (Fase 2) exige versión fresca.
    if (url.pathname.endsWith("/version.json") || url.pathname.endsWith("version.json")) return;
    if (evento.request.method !== "GET") return;
    if (!HOSTS_PERMITIDOS.includes(url.origin)) return;

    // Estrategia (corregida 2026-07-07, JFC reporto Ayuda vieja tras deploy):
    //   - Mismo origen (shell de la app): NETWORK-FIRST — con conexion siempre
    //     se sirve lo ultimo publicado en Pages y se refresca la copia; la
    //     cache solo responde cuando NO hay red. Asi un deploy se ve en la
    //     primera recarga, no en la segunda.
    //   - Fuentes de Google: CACHE-FIRST — son inmutables por URL versionada,
    //     no hay razon para pedirlas de nuevo. Llegan como respuestas "opaque"
    //     (ok=false), por eso se aceptan tambien.
    const esMismoOrigen = url.origin === self.location.origin;
    const guardar = (res) => {
      if (res && (res.ok || res.type === "opaque")) {
        const copia = res.clone();
        caches.open(CACHE_LOCAL).then((cache) => cache.put(evento.request, copia)).catch(() => {});
      }
      return res;
    };

    // Blindaje 2026-08-25: respuesta de ultimo recurso. En la v87, si no
    // habia nada en cache y la request no era de navegacion, el fallback
    // devolvia `undefined` a respondWith() -> el navegador lo mostraba como
    // "network error" en vez de manejarlo. Ahora SIEMPRE hay una Response
    // real, aunque sea un 503.
    const respuestaOffline = () => new Response("Sin conexion y sin copia en cache.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

    if (esMismoOrigen) {
      // cache:"no-cache" fuerza revalidacion con el servidor (GitHub Pages manda
      // max-age=600; sin esto, el navegador puede responder con su cache HTTP
      // hasta 10 min y el deploy "no sale" aunque el SW pida red).
      evento.respondWith(
        fetch(evento.request, { cache: "no-cache" }).then(guardar).catch(() =>
          // FIX 2026-07-07: sin red, una URL con query (?desde=whatsapp) no
          // coincidia con el cache y la app no abria. Toda navegacion cae al
          // index cacheado como ultima red de seguridad.
          caches.match(evento.request).then((c) => {
            if (c) return c;
            if (evento.request.mode === "navigate") {
              return caches.match("./index.html").then((idx) => idx || respuestaOffline());
            }
            return respuestaOffline();
          })
        ).catch(() => respuestaOffline())
      );
    } else {
      evento.respondWith(
        caches.match(evento.request)
          .then((cacheada) => cacheada || fetch(evento.request).then(guardar))
          .catch(() => respuestaOffline())
      );
    }
  } catch (e) {
    // Blindaje 2026-08-25: si algo revienta antes de llegar a respondWith,
    // no interceptamos nada — se deja pasar a la red normal del navegador
    // en vez de romper la request.
    try { console.warn("[SW] fetch handler fallo, dejando pasar a la red:", e && e.message); } catch (_) {}
    return;
  }
});

/* A4 — AUTODIAGNOSTICO DE VERSION (JFC 2026-08-19).
   El service worker es el unico que sabe DE VERDAD que shell esta sirviendo.
   La pagina se lo pregunta y lo compara con el shell que declara version.json
   (que nunca se cachea, ver el fetch de arriba). Si no coinciden, el
   dispositivo quedo con media version vieja —el bug que rompio Avanzado en el
   iPhone de JFC— y se le ofrece recargar en vez de dejarlo roto en silencio.
   2026-08-25: se agrega "skip-waiting" para que la pagina pueda forzar la
   activacion inmediata de un SW nuevo (patron estandar de un boton
   "Actualizar ahora" en el aviso de version). */
self.addEventListener("message", (ev) => {
  try {
    if (!ev.data) return;
    if (ev.data.tipo === "que-shell" && ev.source && ev.source.postMessage) {
      ev.source.postMessage({ tipo: "shell-actual", shell: CACHE });
      return;
    }
    if (ev.data.tipo === "skip-waiting" || ev.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  } catch (_) {}
});
