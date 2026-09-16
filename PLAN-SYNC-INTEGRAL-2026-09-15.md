# Plan — Cerrar el sync integral + cazar mis microerrores
Fecha: 2026-09-15 · friendly-123 · Autor: Claude (para JFC)

## Principio rector (JFC, dicho hoy, IN STONE)
- **UNA licencia = UN cuaderno (una "sala"). Nada de namespaces por
  aparato/por-join.** El concepto de "sala" separada es VESTIGIO del sync viejo
  fracasado. La data de un negocio vive en UN solo store, identificado por la
  licencia; todos los aparatos/PIN de esa licencia leen y escriben el MISMO
  store y convergen por CRDT.
- **NO se mueve data.** La data siempre está bajo el store de la licencia. No hay
  "cambiar de tienda a un namespace vacío" ni "recuperar moviendo de un namespace
  a otro". Si algo obliga a mover, es un bug de diseño, no una feature.
- **NO más botones.** Todo pasa solo con estar/entrar en la licencia.
- Los aparatos son respaldo unos de otros (vía el sync CRDT). Aparte, respaldo
  durable del cliente (PocketBase/OAuth) en ubicación distinta — futuro, no ahora.
- **Observatorio:** la lista dinámica de licencias del panel privado JFC. Criterio
  de ÉXITO: bajo una licencia NUNCA hay nombres de negocio distintos entre
  aparatos/PIN. Un nombre por licencia.

## Causa raíz (auditada, barata)
El backend usa `OC_STATE_SUFIJO` (= `f123_tienda_activa`) para namespacear el
store por licencia/join: buffers `f123_estado_v4<sufijo>_A/_B`. Entrar una
licencia hace `cambiar()` a OTRO namespace (vacío en ese aparato) → el inventario
del dueño queda "huérfano" bajo el namespace viejo → "entro y sale vacío / My
store or shelf(s)". El nombre sí persiste en `f123_owned` (global) → sale en el
PIN pero no adentro. Eso NO es que el sync no envíe: el envío/recepción CRDT del
nombre y catálogo está CORRECTO (verificado: sync-yjs.js `sembrar()`/`aplicar()`).
El vestigio de namespaces es lo que fragmenta.

## Mis microerrores de esta sesión (v266→v280) — a revertir/corregir
1. **v280 auto-recuperar MUEVE data en el arranque** (`_autoRecuperarInventario`
   en mock-backend.js ~2325). Viola "no mover nada". → **REVERTIR.**
2. **v278 Join→reconciliar** hace `cambiar()` de namespace (mueve/duplica). Parte
   del vestigio de salas. → **REVERTIR** (la unificación real no necesita mover).
3. **guard-demo `_vaciarTiendaFresca` al arrancar** (0a4a04a, 2026-09-11; lo
   MANTUVE en v266). VACÍA el store en aparato real sin buffer del namespace
   activo → contribuye directo al "entro y sale vacío". → **NEUTRALIZAR** en el
   marco "una licencia = un store" (no debe vaciar lo que es del dueño).
4. **sync-yjs ON por defecto (v267)** corriendo EN PARALELO al sync viejo. Dos
   motores a la vez = fuente de rarezas. → **Decidir UN solo motor** (ver plan).
5. **Color de iconos del riel cambiado a azul** (v268/friendly). JFC: los iconos
   podían ser grises, no tocar. → **NO volver a tocar** (queda como está; solo se
   documenta que fue churn innecesario).
6. **Churn del toggle "Device sync"** (añadido v267 → removido v274) y del panel
   Export/Import (soon→real→mover→renombrar, v270-274). Ya neto-resuelto; se
   audita que no quedó nada duplicado.
7. **Botón "Recover my inventory"** que agregué y quité en el mismo turno. Ya
   removido; se verifica que no quedó rastro.
8. **churn masivo en avanzado-extra.js (~541 líneas)** — riesgo de daño colateral
   a vecinos. → **Auditar** que compartir/desactivar/unirse y el riel siguen OK.

## Qué se HACE, en orden (riesgo primero)
### Fase 0 — Revertir lo rogue que mueve/añade (rápido, seguro)
- Quitar `_autoRecuperarInventario` (v280) y su llamada. mock-backend vuelve al
  guard tal cual, sin mover data.
- Quitar el branch Join→reconciliar (v278): el Join vuelve a `unirse()` simple.
- Verif: `grep -c _autoRecuperarInventario docs/mock-backend.js` → 0; node --check OK.

### Fase 1 — Una licencia = un store (el fix de fondo, SIN mover data)
- El store deja de namespacearse por `OC_STATE_SUFIJO`. Se usa UNA sola clave de
  store por aparato, y la licencia es el identificador lógico del cuaderno
  compartido (la sala del relay ya se deriva de la licencia; el STORE local debe
  dejar de fragmentarse). Entrar/activar una licencia NO crea un store vacío
  nuevo: adopta la licencia sobre el store que el aparato ya tiene.
- Resultado: entrar la licencia NO vacía ni esconde el inventario; el CRDT suma
  lo de los demás aparatos add-only.
- Esto es reversión al modelo simple, no reinvención. Verif: en 2 aparatos con la
  misma licencia, ambos muestran el mismo inventario y el MISMO nombre; el panel
  muestra un solo nombre por licencia.

### Fase 2 — Un solo motor de sync
- Decidir: el CRDT (Yjs) queda como ÚNICO motor (es el que cruza fotos y converge
  solo), y el sync viejo (sync-realtime checkpoints) se retira o se deja de
  arrancar. Correr ambos es lo que enturbia. (JFC ya pidió retirar el viejo.)
- Verif: la línea "Sync:" muestra connected + conteos iguales en 2 aparatos.

### Fase 3 — Confirmar 888 y semilla (ya hechos, solo verificar)
- 888 de Sarah abre como dueño (v275, verificado en código: identificarPin revisa
  el sidecar). Semilla genérica sin datos de clientes (v279). Mantener.

## Qué NO entra
- NO PocketBase/backup durable ahora (futuro).
- NO tocar color de iconos.
- NO botones nuevos.
- NO homologar a amigable/consultorio hasta que friendly quede sólido.
- NO Loyverse todavía.

## Riesgo y resguardo
Fase 1 toca almacenamiento de un cliente vivo. Antes de tocar: el propio esquema
A/B de buffers ya es doble respaldo; además los aparatos son respaldo entre sí.
Se hace en friendly (lab) primero, se verifica con 2 aparatos reales (JFC/Belén)
leyendo la línea "Sync:" y el panel, y recién ahí se homologa.
