# Plan — Cerrar el sync (QA final): 9 microerrores con archivo y acción exacta
Fecha: 2026-09-17 · friendly-123 · Para ejecutar en cuentas Claude gratis

Contexto: el sync ya funciona en lo grueso (una licencia = una sala derivada de
`f123_owned.licenseCode`; catálogo, nombre, equipo/PIN, comisiones, clientes,
sucursales, ventas/dinero, fotos y apodos van por Yjs; demo filtrado por id
`^p\d+$`). Quedan bugs concretos. Observatorio para verificar: KV de licencias en
producción — `wrangler kv key list --namespace-id f1599c69c4174cc2b38dd125c18ee3df
--remote` y `kv key get inst:<id> --remote` (OJO: SIEMPRE `--remote`). Éxito = bajo
la licencia canónica `F123-A6YK-(privada)` un solo `nombreNegocio`, y stock/
foto cruzan en segundos entre los 2 aparatos.

Cómo verificar barato sin quemar tokens:
- Sondear una sala del relay en la consola del navegador (patrón usado en la
  sesión): derivar `roomId = SHA-256("amigable-sala:"+LICENCIA).hex.slice(0,40)`,
  clave = PBKDF2(LICENCIA, salt `amigable-sync-v1`, 100k), conectar a
  `wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/<roomId>-y|-fotos|-ops`,
  mandar `{k:"pull",lam:0}`, aplicar los frames tag 0 a un `Y.Doc`.

---

## A. Dinero/stock (lo que descuadra)

### 1) STOCK no cruza en segundos a la PC
- Archivo: `docs/sync-yjs.js` (`sembrar()`, el batch `COLECCIONES_BATCH.forEach`
  que hace `API.mapas[col].set` "solo si cambió") y `docs/mock-backend.js`
  (`aplicarCatalogo`, rama de producto EXISTENTE con el LWW por `stockTs`, ~L1850;
  `emitirOpStock` que sella `stockTs` y dispara `oc-catalogo-cambiado`, ~L1560;
  `catalogoPropio` que publica `stockActual`+`stockTs`, ~L2362).
- Qué hacer: (a) confirmar que un cambio de stock en el celular escribe el producto
  al `Y.Map` (log en `sembrar`), (b) sondear la sala `-y` y ver que el producto
  trae `stockActual` y `stockTs` nuevos, (c) confirmar que en la PC
  `aplicarCatalogo` entra a la rama existente y `_tsR > _tsL` (loguear ambos). Si el
  `stockTs` no viaja o el LWW no dispara, ahí está el bug. Sospecha: la PC tiene el
  producto con `stockTs` mayor o igual por un guardado viejo → nunca adopta.
- Verificación: subir stock a 3 en un aparato → en el otro aparece 3 en <5 s; en la
  sala `-y` el producto muestra `stockActual:3`.

### 2) FOTO no cruza en segundos (solo al reconectar)
- Archivo: `docs/sync-yjs.js` (`sembrarFotosAlRelay` solo se dispara en `onopen`
  vía `seedFn`, ~L327/L454; `sembrar()` llama `hashearFotosProductos().then(
  publicarFotosLocales)`, ~L581).
- Qué hacer: hacer que al AGREGAR una foto (evento `oc-catalogo-cambiado` /
  `oc-fotos-cambiadas`) se dispare también el sembrado de esa foto, no solo al
  reconectar. Revisar el orden async: `hashearFotosProductos` debe terminar ANTES
  de `publicarFotosLocales` (ya está encadenado, confirmar que el `fotoHash` quedó
  puesto antes de publicar).
- Verificación: poner foto a un producto → en el otro aparato aparece en <10 s; la
  sala `-fotos` (mapa `blobs`) tiene el hash.

### 3) `/dashboard` lanza excepción (hero se atascaba en "Loading")
- Archivo: `docs/mock-backend.js`, handler `if (path === "/api/dashboard")` (buscar
  el cálculo de "payment plan / pago no llegó / fiado"). En v300 se tapó el SÍNTOMA
  en `docs/index.html` `cargarHoy` (catch pone título por defecto), pero el cálculo
  sigue lanzando y el dashboard no carga bien.
- Qué hacer: envolver el cálculo del plan de pagos/fiado en try/catch y guardar
  contra datos incompletos (cliente null, monto NaN, venta sin `clienteId`). Es el
  bug "1 payment has not arrived" que ya se había arreglado hace ~2 semanas y
  revirtió: revisar git log de ese arreglo para no re-introducir.
- Verificación: `/dashboard` responde 200 con datos; el hero muestra el semáforo,
  no "Loading" ni el catch.

## B. Identidad de licencia (raíz del desmadre)

### 4) El código genera VARIANTES con errata de la licencia
- Archivo: `docs/sync-realtime.js` (`reconciliar`/`unirse`/`activar`, ~L1147-1300 y
  la parte que escribe `f123_owned.licenseCode`/`syncCode`) y
  `docs/mock-backend.js` (`OCTienda.reconciliar`, ~L2144). El observatorio mostró
  variantes `BF2A↔B2FA` y `S2J24↔S2324` de la MISMA licencia.
- Qué hacer: hallar dónde se re-escribe `licenseCode` a partir de un valor que se
  pudo teclear/derivar mal, y NO aceptar variantes: al activar/unir, validar contra
  el formato + checksum y, si el aparato ya tenía una licencia canónica, no
  permitir que una casi-igual la reemplace. Quitar el parche one-time
  `f123_fix_lic_v2` (mock-backend ~L227) cuando ya no queden aparatos en variantes.
- Verificación: activar con un dígito cambiado NO crea una segunda licencia en el
  panel; el KV muestra una sola bajo el email.

### 5) Retirar de verdad el sync viejo (o confirmarlo inerte)
- Archivo: `docs/sync-realtime.js` (sigue conectando y latiendo) y
  `docs/mock-backend.js` `aplicarOpRemota` (~L2504, neutralizado por flag
  `f123_ops_delta_activo` en v293).
- Qué hacer: confirmar que `aplicarOpRemota` no aplica nada (ya no-op) y decidir si
  se corta la conexión de `sync-realtime` para no gastar el relay. El micelio
  (apodos) ya va por Yjs (v298); el latido viejo es redundante.
- Verificación: la sala base (roomId SIN sufijo) deja de recibir `__latido__`/
  `__checkpoint__`; el dinero/stock sigue cruzando (por Yjs).

## C. Limpieza y salas

### 6) Sala contaminada: el demo persiste en el relay (inerte pero ahí)
- Archivo: `docs/sync-yjs.js` (sufijo hardcodeado `::limpio-2026-09-16` en
  `arrancar`, ~L288) y `docs/mock-backend.js` (filtro `^p\d+$` en `catalogoPropio`
  ~L2362 y `aplicarCatalogo` ~L1865; auto-purga cada arranque ~L2712).
- Qué hacer: el sufijo `::limpio` es vestigial y hardcodea la licencia de JFC.
  Opción limpia: agregar al relay (`cloudflare-sync-relay/worker.js`) un control
  `{k:"reset"}` que borre `ops`+`ckpt` de una sala, resetear la sala de la licencia
  UNA vez, y quitar el sufijo `::limpio` para volver a `sala = licencia` pura.
- Verificación: la sala de la licencia (sin sufijo) queda con solo los productos
  reales; `arrancar` ya no usa sufijo.

### 7) `catalogoPropio` filtra demo pero NO filtra ubicaciones/clientes/ventas demo
- Archivo: `docs/mock-backend.js` `catalogoPropio` (~L2313 ubicaciones, ~L2346
  clientes, ~L2411 ventas). Solo se filtró `productos` (`^p\d+$`).
- Qué hacer: si el demo también trae ubicaciones (ids "galeria","consigna","bar"…)
  o clientes/ventas de ejemplo que reaparecen, filtrarlos igual por su patrón de id
  de semilla, con el mismo cuidado (no tocar ids reales `u+UUID`, `v+UUID`).
- Verificación: perchas/clientes en la sala = solo los reales.

## D. Robustez del sync nuevo (microerrores)

### 8) `sembrarVentasAlRelay` / `sembrarFotosAlRelay`: guard de sesión sin límite
- Archivo: `docs/sync-yjs.js` (`_ventasSembradas`, `_fotosSembradas` son objetos que
  crecen sin poda, ~L437/L485).
- Qué hacer: no es crítico, pero en sesiones larguísimas crecen. Podar o usar un
  `Set` con tope. Además, revisar que `pull` no re-baje TODO el historial cada
  reconexión (hoy `{k:"pull",lam:0}` siempre desde 0): idealmente guardar el `lam`
  más alto aplicado por sala y pedir desde ahí (con checkpoint que compacte).
- Verificación: en una sala con N ventas, la 2ª conexión no re-descarga N.

### 9) Nombre del negocio: el heartbeat al panel va desfasado del `_meta` del sync
- Archivo: `docs/index.html` (rename dispara heartbeat, ~L3890-3900;
  `aplicarCatalogo` adopta el nombre y actualiza `f123_owned` pero NO re-heartbeatea
  ~mock-backend L2046) y el panel lee el heartbeat, no el `_meta`.
- Qué hacer: cuando `aplicarCatalogo` adopta un nombre nuevo de dueño, disparar un
  heartbeat (como en el rename) para que el panel refleje el nombre convergido sin
  esperar al próximo login. Así el panel muestra un solo nombre por licencia
  enseguida.
- Verificación: tras converger, el KV (`inst:*`) muestra el mismo `nombreNegocio`
  en todos los aparatos de la licencia.

---

## Qué NO entra
- No re-arquitecturar lo que ya converge (catálogo/nombre/equipo).
- No tocar datos ni salas de idiomARTE (licencia `K7M2…`) ni de otros clientes.
- No homologar a amigable/consultorio hasta que friendly quede probado con 2
  aparatos reales.

## Orden sugerido
3 (dashboard, rompe la UI) → 1 y 2 (stock/foto, lo que el dueño prueba) → 9 (nombre
en el panel) → 4 y 5 (raíz de variantes + retirar sync viejo) → 6 y 7 (limpieza de
sala) → 8 (robustez). Cada uno: editar, `node --check`, subir `CACHE` en
`docs/sw.js` + `docs/version.json`, `node scripts/gen-manifest.js`, `bash
check-sw.sh` (debe salir OK), commit, push.
