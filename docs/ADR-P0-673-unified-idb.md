# ADR P0 #673 — Consolidación IDB sin pérdida de operaciones (10-nov-2026)

**Estado de decisión: aprobada la opción 1 (una sola base). Estado de implementación: etapa de preparación, NO-GO.**
Esta ADR no autoriza merge, deploy, migración de clientes ni bypass del guard 403.

## Decisión vinculante
La única fuente de verdad local de negocios será la base IndexedDB existente
`f123_estado` (y su namespace por licencia). Stores de versión 2:
`estado`, `outbox`, `dedup`, `trace_outcome`, `trace_intent`.
Se prohíben commits compensatorios a `f123_estado` y `f123_outbox` como
sustituto de una transacción. No crear tercera base.

## Hecho forense que modifica el plan original
- `docs/estado-idb.js` usa `f123_estado/estado` con un snapshot entero (ventas,
  movimientos, stock y dinero). El guard CAS escribe ahí.
- `docs/sync-outbox.js` usa **otra base** `f123_outbox/cola`, pero NO tiene una
  fila por `opId`: guarda UN blob cifrado, fila `id=f123_sync_pending`.
- `docs/avanzado-extra.js` cifra un ARRAY `cola` de operaciones con campo
  histórico `id`; algunas otras rutas manejan `opId`. No reinterpretar
  silenciosamente dos identidades distintas ni asumir que la cifra revela el
  número de ops. Se descifra únicamente con la clave vigente, sin persistir
  payloads en texto claro.
- `mock-backend.js` crea `ventaId = uuid("v")` DENTRO del handler; el `opId`
  del clic CONFIRM aún no existe como identidad compartida. Una nueva store
  `dedup` vacía no arregla esa desconexión.
- Versionar `f123_estado` implica revisar pestañas antiguas: al abrir
  v2, una pestaña con código v1 podría volver a abrir con versión explícita 1,
  recibir `VersionError` y perder la capacidad de escribir. Probar mixed-shell
  y fail-closed/reacreditación antes de cutover.

## Etapas (la etapa 1 NO es una migración completa)
1. **STAGED (implementado en rama DRAFT):** apertura normal de `estado`
   sin version explícita (v1 existente no se eleva por leer/vender).
   El upgrade v1→v2 se solicita **solo durante staging explícito**,
   crea stores idempotentemente y preserva `estado/actual`. La petición
   puede quedar bloqueada por pestañas antiguas; no ejecutar staging en
   licencias reales ni llamar a la API automáticamente. Helper
   `OCEstadoIDB.importarOutboxPreparado` inserta en UNA transacción
   `outbox` filas `{opId,blob}` ya cifradas, con PK opId, ACK
   `tx.oncomplete` + lectura por opId y comparación de blob; una colisión
   aborta todo el lote. No borra datos.
   `OCOutbox.prepararMigracionAlEstado()` descifra el blob legado solo en
   memoria, valida TODAS las identidades, vuelve a cifrar por op, compara
   contenido al releer, detecta cambios concurrentes del blob origen. Si
   `id` y `opId` difieren, **bloquea** la migración: el mapeo no está
   probado. Nunca borra legacy ni conmuta escritores. Todavía no es
   autoridad única ni idempotencia de venta.
2. **RED conductual pendiente:** old-tab / new-tab, Safari/WK strict hint
   no soportado, clave no disponible, blob corrupto, operación sin
   identificador, duplicado con payload distinto, cuota, crash entre
   import y verificación, blob cambiado durante staging, reintento y rollback.
   Deben fallar cerrados sin borrar el origen. Confirmar modo de importación
   por licencia y cifrado correcto; no extraer PIN/licencia/PII a logs.
3. **CUTOVER pendiente:** bloquear y verificar escritores legados ANTES de
   transferir autoridad, revalidar lectura completa de cola bajo misma
   licencia y sesión, comparar identidades de cada op y comprobar transacción
   de destino. Cambiar todos los llamadores a outbox nuevo; tratar pestañas
   viejas como incompatibles para escritura sin destruir pendientes.
   Solo con prueba de cobertura íntegra y rollback seguro considerar
   retirar la copia antigua. Esta ADR no autoriza el borrado.
4. **VENTA ATÓMICA pendiente:** generar un solo `opId` en CONFIRM y
   mantenerlo con el contexto inmutable de la intención para reintentos.
   En una transacción sobre UNA DB y múltiples stores, verificar autoridad,
   leer estado y dedup; aplicar exactamente una vez venta + movimiento físico
   + asiento monetario al snapshot de negocio, insertar `dedup[opId]`,
   `outbox[opId]`, `trace_outcome[opId]`. Intent en escritura separada y
   previa para conservar rechazo/abort. Tras `oncomplete`, nueva lectura de
   `dedup[opId]` y efecto; UI no muestra éxito antes.
   `durability:"strict"` con fallback solo si la API rechaza el hint;
   la lectura confirma estado lógico, NO fsync garantizado en Safari.
   Commit desconocido -> consultar primero el mismo `opId`, no nuevo cobro.
5. **GO gates pendientes:** WebKit/Chromium browser tests (doble CONFIRM,
   retry after abort y crash after commit), logout verdadero 403, reclamo
   pendiente bloquea, misma licencia/rol/lease al reanudar sin 403 espurio;
   shell/manifiestos regenerados por scripts de release y SHA servido
   confirmado; iPhone PWA físico licencia de prueba con dos A→B→A.
   Panel/importación JSON solo recoge evidencia, nunca crea GO por sí solo.

## Razones para descartar alternativas
- 2 bases + compensación: no da commit atómico, permite venta sin outbox.
- 3.ª base P0 en paralelo: segunda fuente de verdad de stock/dinero.
- Migrar «conteo de filas» del outbox legado: su DB contiene un solo blob.
- Borrar `f123_outbox` tras copiar: puede perder escrituras de pestañas antiguas.
- Tomar `opsMap.get` o `put().onsuccess` como ACK: no verifican el efecto
  persistido por operación.
- Enviar hash de licencia a panel/traza: no hace falta; usar booleanos.

## Recibos y veredicto
PR [#673](https://github.com/jfcarpiopuntocom/friendly-123/pull/673)
DRAFT/NO-GO, incremental sobre
[#672](https://github.com/jfcarpiopuntocom/friendly-123/pull/672).
Análisis y fallos conservados en
[Notion relevo P0](https://app.notion.com/p/4141642b67f381eba48ef16d3ffda0e6).
La instrumentación no ha ejecutado una corrida física en iPhone; no modificar
licencias, datos, producción ni release hasta aceptación.
