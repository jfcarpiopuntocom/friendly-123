# MDD-2026-10-31 · friendly-123 · Arquitectura APROBADA JFC

**Autor:** JFC · **Fecha:** 31 octubre 2026 · **Estado de decisión:** APROBADO · **Estado de ejecución:** EN CURSO · **Producción:** NO CERTIFICADA

**Documento maestro extenso, análisis completo (cinco alternativas, causas de nueve días, Cornell, ADR, runbook y criterios):**
https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac

## Orden vinculante

**3 URGENTE + 1 y 5 EN PARALELO → 2 DESPUÉS → 4 SOLO DISCUSIÓN.**

1. **#3 autoridad administrativa JFC**: panel privado con lápices editables y vista móvil, la misma licencia y revisión de PIN Owner en todos los dispositivos. Fase 1 primero: censar credenciales **actuales de clientes existentes sin modificarlas**. Fase 2 después: propuesta JFC con revisión CAS y doble activación explícita, previa comprobación de registros de TODOS los aparatos en servidor. Revisión autorizada prevalece frente a PIN local antiguo, sin crear negocio nuevo ni demo. No guardar PIN en texto, Notion, repo ni telemetría; HMAC solo con pepper servidor. PR #504 laboratorio.
2. **#1 libro de hechos inmutable EN PARALELO**: físico OPEN/RECEIVE/FULFILL/RETURN/LOSS/ADJUST/COUNT derivado por causa, ORDER/preventa y pagos separados. EventId+hash canónico, idempotencia, conserva conflictos y recuentos sin proveniencia. Aprovechar PR #441 (solo shadow) y no importar al runtime o crear un segundo motor sin transición aprobada, probada, reversible.
3. **#5 forense y pruebas EN PARALELO**: respaldar por separado PC, Safari, otro navegador de iPhone y PWA; identidad de negocio y dispositivo, evento, época, cursores, outbox, revisión PIN y checksums. Diffs por ID/casualidad, no fijar cantidades. Fixtures RED→GREEN con 2/3 réplicas, caída de guardado, duplicados, latencia, compras, preventas, ventas, pagos, fotos, PIN, reinicio y retransmisión. No consultar negocio de cliente sin respaldo y autorización contextual.
4. **#2 buzón duradero cifrado DESPUÉS**: sobres cifrados append-only y cursores/ACK distintos (durabilidad servidor vs aplicación réplica), conservación y backfill. P2P solo acelerador. Costear y probar cuotas antes de elegir infra; no reactivar el relay archivado de Cloudflare ni relecturas masivas de Supabase.
5. **#4 backend autoritativo de negocio — SOLAMENTE DISCUSIÓN**: estudiar Replicache/PowerSync o alternativa, con riesgos de custodia, migración y costos. **No implementar** sin otra aprobación.

## Evidencias del problema y errores de método

- Dos réplicas sintéticas 7/7, después ajuste real simulado de -1 → 6/7 por épocas físicas no reconciliadas. Notion incidente: https://app.notion.com/p/40a1642b67f3818cb931ca1d86d4f185
- PWA y dos browsers en el mismo móvil pueden tener almacenes distintos. Diferentes URLs de ingreso deben identificar el MISMO negocio por licencia, sin crear cuadernos alternativos.
- PR #505 arregló rendezvous P2P; PR #507 probó RED→GREEN ACK prematuro, sin acreditar inventario real. Suite integral v635 tuvo 12 fallos y 1 cancelación. No usar test focal para declarar STABLE.
- PR #502 reparaba automáticamente cantidades observadas y PR #503 desactivó esa vía. Nunca asignar stock a 7 por código ni sumar PN de recuentos no comparables.
- Auditoría v629 expuso posible snapshot durable antes de contador PN actualizado y reversiones de PIN local al recuperar.
- Falta backfill duradero: Cloudflare relay archive-only, Supabase egress excedido. Señalización de presencia no basta para aparatos offline.
- Producción con clientes reales: sin purgas, sin cambios de PIN antes del censo, sin doble fuente de negocio, sin saturar servicios.

## Criterios de aceptación independientes de la cantidad concreta

- Un mismo negocio/licencia/cuaderno para PC, Safari, otro browser iPhone y PWA; instancia distinta por almacenamiento.
- El panel JFC registra TODOS los dispositivos existentes y sus grupos de credenciales **sin exponer valores**; solo JFC autenticado puede preparar y activar la revisión nueva, registrando auditoría; un censo incompleto impide al SERVIDOR activar aunque UI se equivoque.
- Cada evento válido se guarda primero en local durable, con ID estable y causalidad, y reaparece exactamente una vez en todas las réplicas luego de reconexión. Ventas sin entrega, abonos, compromisos y movimientos físicos siguen separados. Un conflicto histórico se declara y conserva, sin inventar resolución.
- Después de cierre/reapertura, ventas, fotos, PIN y el inventario derivado siguen coincidiendo; no hay falso «Sync completed» con solo un ACK de otro dispositivo.
- Test suite integral sobre SHA de la nueva shell y verificación de bytes realmente publicados, compatibilidad con clientes antiguos, rollback sin borrar cuadernos.
- Se **permite subir el número de shell** con reparaciones verificadas; JFC NO pidió congelamiento absoluto.

## Contexto y prohibiciones

JFC reporta nueve días consumidos intentando conseguir convergencia. Las cinco causas analizadas: demasiadas proyecciones de verdad, P2P frágil, falta de almacenamiento histórico recuperable, separación identidad navegador/negocio y proceso que confundió CI parcial con garantía física. La solución aprobada combina la alternativa #3 con #1 y #5 ya, luego #2; #4 futura. No hacer «otro caballo» ni cambiar arbitrariamente a Dexie, R2, dos motores o secuenciador DO obligatorio.

**Contacto de fuente y cambios:** Notion War Room https://app.notion.com/p/3ec1642b67f38189acb5e931d489a8f3 ; laboratorio stock PR #441, panel PIN PR #504, transporte PR #507.

## Estado de implementación tras esta decisión

- Panel #3: se está corrigiendo un defecto de autoridad **servidor** de la candidata #504: hasta ahora la UI verificaba cantidad de aparatos, pero el Durable Object solo exigía >= 1 informe. Se ha añadido cotejo exacto de IDs registrados desde la fuente de licencias y comprobación visual del panel; el trabajo permanece aislado en el PR #504, sin despliegue ni cambios en clientes. **No desplegado; PIN de clientes intactos.**
- #1 y #5: arrancar en laboratorio shadow y pruebas, sin modificar datos en producción. PR #441 ya existe y no debe pisarse su reserva sin validación.
- #2 por diseñar después de #3/#1/#5; #4 pendiente discusión.

No secretos en este ADR. Prohibido convertir esta aprobación arquitectónica en autorización de activar cambios de PIN de clientes con censo parcial.


## v636 · transporte por cuaderno activo y ACK durable real · 31/oct

- Producción previa conservada: `estable` v635 mientras se prueba candidato. PR #513 fusionado en master SHA `f3846f5d0adbe872fb4409f5d8dd22f5cddc1e16`, shell v636 / golden183.
- Fallo real reproducido en Mac WebKit: en tres réplicas, A conservaba dos movimientos con ACK cruzados de B y C aun cuando ambos almacenamientos habían confirmado. Evidencia CI #41203747317; ninguna confirmación de salida podía inventarse.
- Solución integrada: `peer-sync.js` reintenta únicamente tramas cifradas para peers WebRTC que todavía deben ACK, con un temporizador por socket y máximo tres intentos por ciclo (presupuesto 8). Las operaciones siguen en outbox hasta recibo durable. `sync-realtime.js` ata el transporte a `OCTienda.licenciaActual()`, preserva proveniencia de operaciones, evita mezclar licencias y no transforma cantidades en 7.
- Pruebas reales tres réplicas: WebKit macOS #41204004308 PASS sin omitir el caso; unidad/Chromium + manifest de 121 archivos SHA256 #41204000989 PASS. PR #513 conserva `docs/peer-sync.js` SHA256 `ba9bbdbc8c688529cf38be4ddbe192cbe0b38572b5a7c1ef577f6690e36efb1d`.
- Hotfix inicial #41204150703 hizo fallar una transferencia Chromium bajo contención de 146 pruebas simultáneas (timeout 12s); eso bloqueó correctamente la publicación. PR #514 ajustó **solo QA**, para elegir la totalidad de cambios entre `estable` y master y ejecutar los tres navegadores aislados, seguidos del resto de las pruebas, sin saltarse aserciones.
- Prohibido declarar convergencia PC–Safari–PWA hasta cotejar respaldos y opIDs auténticos; el navegador PC aún mostraba Offline — saved locally, James Bond 3 y Hielo del Chimborazo 4. No hay PIN real modificado ni ajustes automáticos.

## v637 candidata aislada · failed-save publication gate · 31/oct

- PR #516: `docs/mock-backend.js` impide publicar una edición posterior mientras su guardado está pendiente si el guardado anterior ya falló. No cambia movimientos, PIN, época ni stock inicial.
- `test/p0-failed-save-publication-gate.test.cjs`: falla A/B+IDB, segundo guardado pendiente, bloqueo hasta ACK y recuperación posterior.
- Sellado automatizado [run 41206190869](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41206190869) SUCCESS sobre candidata v637, hash, linecount y cuatro grupos de pruebas focales. La versión continúa SOLO en rama; exigir suite integral y evidencia física antes de publicar. Este documento no proclama reconciliación del caso real.
