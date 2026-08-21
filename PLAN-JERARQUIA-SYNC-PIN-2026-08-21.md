# PLAN — jerarquía admin, PIN entre dispositivos, sync TEAM, QR, stock negativo
**Fecha:** 2026-08-21 · **Fuente:** quejas de usuarios reales (app en producción, idiomARTE/Sarah)
**Estado:** pendiente de ejecución. NO se toca código sin snapshot previo (Regla 1).

---

## Diagnóstico (investigado, no asumido)

**Casi todos los reportes "urgentes" son UN solo problema de raíz:** los
miembros del equipo (`usuarios`: nombre, PIN, rol, activo) son estado LOCAL
por dispositivo en `docs/mock-backend.js`. El sync de equipo (código TEAM-)
mergea el CATÁLOGO (commit 74b218e) pero **nunca propaga `usuarios`**. Por eso:

- El PIN de admin creado en un dispositivo no existe en otro → "no me deja
  actualizar con el PIN de admin desde otro dispositivo".
- "Hacer sync con el código TEAM no lo arregla" → correcto, porque el merge
  no incluye usuarios.
- El demote "no sirve" visto desde otro dispositivo → el PATCH de rol sí
  funciona (verificado en `mock-backend.js:2531-2537`), pero solo cambia el
  estado del dispositivo donde se hace. Los demás nunca se enteran.

Lo demás es independiente:

- **Admin capado:** decenas de gates `rolActual() === "dueno"` en
  `docs/index.html` (alta de producto `:3230`, crear percha `:3716`, acciones
  rápidas `:4169`, etc.) excluyen al admin. Quedó como empleado con otro badge.
- **Stock -1:** la venta local SÍ valida stock (`mock-backend.js:2011`). El
  negativo entra por `aplicarOpRemota` (`mock-backend.js:1616`), que aplica el
  delta remoto sin piso — por diseño dejaba ver el descuadre. JFC decidió:
  no puede quedar en negativo mientras no existan pedidos anticipados.
- **QR de sync** (`avanzado-extra.js:2176-2290`): genera QRs de cambios que
  nadie puede escanear desde la app. Confuso. JFC decidió eliminarlo.
- **Gamification** (`docs/novedades.js`): el aviso experimental sigue visible
  en la UI del encargado; en amigable-123 se corrigió hace semanas.
- **Popup de geotagging:** el anuncio en el flujo estorba; el CONSENTIMIENTO
  legal de `geo-ping.js` se queda, lo que se mueve a Ayuda es el anuncio.

---

## Orden de ejecución (por riesgo y por lo que desbloquea)

### P1 — Sync de usuarios por el código TEAM (raíz de lo ultra urgente)
**Archivos:** `docs/mock-backend.js` (huella/compararCatalogo/aplicarCatalogo),
`docs/hechos.js` si aplica, panel de sync en `docs/avanzado-extra.js`.

1. Incluir `usuarios` en el paquete que viaja con el merge de catálogo:
   id, nombre, pin, rol, activo, email, creadoEn.
2. Merge SIN borrar (misma filosofía del catálogo 74b218e): por id; en
   conflicto gana el registro con edición más reciente (agregar
   `actualizadoEn` al PATCH de usuarios); nunca eliminar un usuario que el
   otro lado no tenga — se agrega.
3. Incluir usuarios en la huella (`huellaCatalogo`) para que el panel detecte
   "hay cambios de equipo pendientes".
4. El demote/promote/cambio de PIN quedan arreglados de rebote: ahora viajan.

**Verificación:** dos perfiles de navegador con la misma licencia. En A crear
admin PIN 555 → sync → en B entrar con 555 y que entre como admin. En A
demote → sync → en B reabrir y que entre como staff. En consola:
`fetch('/api/usuarios')` en B devuelve el mismo array que en A.

### P2 — Jerarquía real del admin + jerarquía visible
**Archivos:** `docs/index.html`, `docs/auth-ui.js`, `docs/avanzado-extra.js`.

1. Helper central `window.OCPuedeGestionar()` = rol dueno **o** admin, en
   `auth-ui.js` junto a `rolActual`.
2. Cambiar los gates de `=== "dueno"` a `OCPuedeGestionar()` para: crear/editar
   productos, crear/editar perchas, variantes, reposición, acciones rápidas,
   transferencias, clientes, eventos, reportes.
3. **Se queda solo-dueño (nivel dueño, NO tocar):** licencia y activación,
   email de recuperación, promote/demote, borrar miembros del equipo,
   apagar features, borrar el negocio, comisiones/porcentajes de tratos.
4. Jerarquía VISIBLE en la lista del equipo (`avanzado-extra.js` tabla team):
   fila del dueño incluida arriba con badge "Owner", y una línea fija bajo el
   título: "Owner > Admin > Staff — quien está más arriba tiene la última
   palabra sobre los apuntes compartidos" (texto final en inglés vía `t()`).

**Verificación:** entrar como admin → crear un producto y una percha (antes
imposible). Entrar como staff → seguir SIN ver esos botones.
`grep -c 'OCPuedeGestionar' docs/index.html` > 8.

### P3 — Demote: comprobar de punta a punta
Tras P1+P2, probar el ciclo completo en el MISMO dispositivo también: demote
→ la tabla refresca → logout/login con ese PIN → entra como staff. Si algo
sigue fallando ahí, es la sesión cacheada (`OCCurrentUser` en
`auth-ui.js:587`): revalidar rol contra `/api/usuarios/verificar` al entrar.

### P4 — UX del código TEAM (dejar de confundir)
**Archivo:** `docs/avanzado-extra.js` (panel Team Sync, ~línea 500).
1. Reordenar: primero SIEMPRE mostrar "Your team code: TEAM-…" con botón de
   copiar/compartir; el campo para PEGAR un código va después, plegado bajo
   "Joining from another device?". Nunca pedir antes de ofrecer.
2. Texto claro: el código de equipo va atado a la licencia; misma licencia =
   mismo equipo, el sync es automático (latido + merge). El botón de sync
   manual queda como "force sync now".

**Verificación:** captura del panel: el código propio visible arriba sin
teclear nada.

### P5 — Eliminar el sync por QR (dormant, no borrar)
**Archivo:** `docs/avanzado-extra.js:2053-2290`, `qrcode-local.js` queda.
Ocultar los dos botones QR y su flujo con bandera
`var SYNC_QR_VISIBLE = false;` + comentario DORMANT fechado (regla de
CLAUDE.md global). "Copy changes / paste" se queda como respaldo manual.
La mención en `:328` ("via Advanced → QR Sync") se reescribe a "Copy changes".

**Verificación:** panel de sync sin botones QR; `grep -n "SYNC_QR_VISIBLE"`.

### P6 — Stock nunca negativo (hasta que existan pedidos anticipados)
**Archivo:** `docs/mock-backend.js:1616` (`aplicarOpRemota`).
Piso en 0: si el delta remoto dejaría negativo, se aplica hasta 0 y el
faltante queda en la alerta `alerta-descuadre` (que ya existe) con la
cantidad no descontada. No se pierde información, no se muestra -1.

**Verificación:** en consola, simular op remota con delta que exceda el
stock → `stockActual === 0` y movimiento `alerta-descuadre` presente.

### P7 — Gamification fuera de la UI del encargado
**Archivo:** `docs/novedades.js`. Ver cómo quedó en amigable-123
(`git log --oneline -- docs/novedades.js` allá) y portar ESE fix, no
inventar uno (regla: baseline más reciente entre hermanas).

**Verificación:** login como staff → panel What's New sin bloque
"Gamification — experimental".

### P8 — Anuncio de geotagging → Ayuda
El popup/anuncio del geotagging sale del flujo y se vuelve una entrada en
`docs/help-ui.js`. El aviso de CONSENTIMIENTO de `geo-ping.js` NO se toca
(es legal, se muestra solo al activar la función).

**Verificación:** flujo normal sin popup de geo; entrada visible en Help.

### P9 — Apunte pedidos anticipados + recordatorio
- Escribir `APUNTE-PEDIDOS-ANTICIPADOS-2026-08-21.md`: pedidos por
  anticipado con o sin abono como única vía legítima de sobreventa
  (idea de JFC, discutir martes 2026-08-25).
- Recordatorio programado martes 2026-08-25 02:00 para JFC y Claude.

### P10 — Microbug del entorno
`.claude/snapshot.sh` usa rutas `/home/user/_snapshots` que no existen en
Windows: la rama de respaldo sí se crea, el tar y los sha256 NO. Arreglar
con ruta portable (`$HOME` o detectar msys).

---

## Qué NO entra (recortes explícitos)

- **Pedidos anticipados / preventa:** solo el apunte. Se diseña el martes.
- **Scanner de QR dentro de la app:** no se construye; el QR se retira.
- **Ports a amigable-123 / consultorio-123:** los mismos males pueden existir
  allá; se planifica APARTE después de verificar friendly (no cross-port por
  iniciativa propia).
- **Geotagging como feature:** no se amplía ni se recorta, solo se mueve el
  anuncio.
- **Renombrar el rol interno `"empleado"`:** prohibido, rompería accesos.

## Reglas de ejecución
Snapshot antes de empezar; commit+push por cada P que quede verde; merge al
final del ciclo verificado (Regla 2d); bitácora con los prompts de JFC.
