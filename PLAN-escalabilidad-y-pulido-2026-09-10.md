# PLAN — Escalabilidad del relay + pulido general (2026-09-10)

Dos frentes: (1) que el Worker de Cloudflare NO se rompa a 30/300/3000 dueños
(llegó a su límite diario con ~1 usuario real: hay que arreglarlo), y (2) pulir
imperfecciones UX/UI ligeras. Foco friendly; portar a amigable lo que aplique.

## HALLAZGO RAÍZ (conecta el límite del worker Y "no sincronizan fotos")
El relay (`cloudflare-sync-relay/worker.js`) tiene `MAX_FRAME_BYTES = 256 KB` y
CIERRA el socket si un frame lo excede (`close(1009,"frame too big")`). La subida
de calidad de fotos a 1600px/0.9 (B0) genera dataURLs de 300-600 KB → el frame de
Yjs con esa foto supera 256 KB → el relay mata el socket de fotos → el cliente
reconecta cada 4s SIN backoff → tormenta de conexiones (upgrades WebSocket) →
límite diario del Worker (free tier = 100k requests/día; cada upgrade cuenta).
Además el sync nuevo abre 3 WebSockets por aparato (catálogo/fotos/ops) + el viejo
1 = 4 conexiones y 4 Durable Objects por negocio, cada uno vivo 24/7 mientras el
WS esté abierto (el worker usa `accept()`, sin hibernación).

---

## CRÍTICO — hacer YA (cliente, sin deploy; frena el sangrado)

### A. Cap del tamaño de foto BAJO el límite de frame  [riesgo: bajo]
Al capturar, redimensionar en bucle hasta que el dataURL quede < ~180 KB (así el
frame cifrado < 256 KB): empezar 1400px/0.82 y bajar calidad/lado si excede.
Mantiene fotos nítidas Y que crucen el relay. Arregla el sync de fotos y quita
los cierres por "frame too big".
**Verificación:** cargar una foto de cámara grande; medir `dataURL.length` del
guardado < 190_000; el frame no dispara close 1009 (probar en 2 pestañas).

### B. Backoff exponencial + jitter en las reconexiones del sync nuevo  [bajo]
`crearCanal` reconecta fijo cada 4s. Cambiar a backoff (1s, 2s, 4s… tope 30s) con
jitter, como el sync viejo. Sin frames gigantes (A), esto ya casi no dispara, pero
blinda contra cualquier flap.
**Verificación:** forzar close repetido; los reintentos espacian y topan en ~30s
(medir timestamps en consola).

### C. Multiplexar los 3 WebSockets del sync nuevo en 1  [medio]
Hoy: 3 salas/DO por negocio (`-y`, `-fotos`, `-ops`). Meter los 3 docs en UNA
conexión/sala con un byte de "doc-id" en el marco (ya hay framing de tags). El
relay solo rebota bytes, no le importa. Baja de 3 a 1 conexión/DO del sync nuevo
por aparato (a 3000 dueños: miles de DO menos).
**Verificación:** `OCYjs._diag().ws` reporta 1 canal; los 3 docs convergen igual
(test headless de convergencia por doc).

---

## ALTA — escala real del worker (necesita deploy a Cloudflare, con JFC)

### D. WebSocket Hibernation en el Durable Object  [medio; toca infra]
El worker usa `servidor.accept()` (no hibernación): cada sala mantiene el DO vivo
y facturando duración mientras haya un WS abierto. Cambiar a la Hibernation API
(`state.acceptWebSocket()` + `webSocketMessage/Close` handlers) deja dormir el DO
entre mensajes → costo de duración cae a casi cero en salas inactivas. Es EL
cambio que hace barato a 3000 dueños. Requiere `wrangler deploy` (cuenta de JFC).
**Verificación:** tras deploy, `wrangler tail` no muestra duración continua en
salas ociosas; el health sigue OK.

---

## PULIDO UX/UI LIGERO (tras lo crítico; verificar cada uno en vivo)

### E. Chip "Synchronized" del header no refleja el sync nuevo  [bajo]
Verificar si dice "Synchronized" aunque el relay esté caído o el sync nuevo no
converja. Debe reflejar estado real (verde solo si hay canal abierto).

### F. Restock: "Order +N" cuando `umbralAmarillo` no está seteado  [bajo]
Si la percha no tiene umbral amarillo, `faltan = max(0, 0 - stock) = 0` → no
sugiere nada útil. Fallback: sugerir al menos `umbralRojo*2 - stock` o un mínimo.

### G. Aviso "[aislamiento] SIN AISLAMIENTO DE IndexedDB" (amigable, pre-existente)  [medio]
Algo pisa `window.indexedDB.open` tras aislamiento.js. Revisar que las DB del sync
nuevo (`amig-yjs-*`) y `amg_fotos` NO se pisen entre las 3 apps (comparten origen
en Pages). Confirmar el prefijo por-app en TODAS las aperturas.

### H. Toggle del sync nuevo: feedback al prender  [bajo]
Al activar, recarga sin decir "conectando…/listo". Un microestado ("Sincronizando
con tus otros dispositivos…") cerraría el lazo UX que la UI promete.

### I. Fotos: mostrar en el dashboard/inventario, no solo en Perchas  [bajo]
El puntero fotoHash ya viaja; el dashboard podría mostrar miniatura donde haya.

### J. "Today's alerts" aviso de sync: que se pueda descartar  [bajo]
El `<li>` de merge se re-pinta siempre; un cerrar (x) o autodescarte tras N horas.

### K. Números que cerrar: KPIs del dashboard vs Hoy  [verificar]
Confirmar que "Ganancia de hoy" del dashboard y el hero de Hoy dan el MISMO número
(mismo cálculo, distinta pantalla — riesgo clásico de dos verdades).

---

## LO QUE NO ENTRA
- Reescribir el sync viejo o retirarlo (sigue de respaldo hasta probar el nuevo).
- Migrar el transporte del dashboard al CRDT (degrada, ver memoria).
- Google Drive / nube durable (fase B3-nube, aparte).
- Rediseños visuales grandes; esto es pulido, no reforma.

## ORDEN
A → B → C (crítico cliente, YA) · D (deploy con JFC) · E–K (pulido, por tanda).

