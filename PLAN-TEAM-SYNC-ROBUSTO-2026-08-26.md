# PLAN — Team/PIN sync robusto (Camino A: terminar bien lo nuestro)

Fecha: 2026-08-26. Aprobado por JFC (eligió "A) Terminar bien lo nuestro" sobre
adoptar Yjs). Rama: `claude/hybrid-proxy-tunnel-sync-ymq8d6`.

## Diagnóstico (con el código en la mano, no de memoria)

El "team system" ya tiene relay zero-knowledge + cifrado E2E + reloj de Lamport +
version vectors + op-log (sync-realtime.js). Lo que falla es el MERGE del roster
en `mock-backend.js` (`aplicarCatalogo`, rama `usuarios`):

1. **No se puede quitar a nadie entre aparatos.** DELETE borra local y re-difunde
   el roster SIN esa persona, pero el otro aparato la conserva (merge add-only,
   nunca borra) y la re-propaga de vuelta. El miembro borrado es inmortal. El
   comentario del código lo admite: "la baja no borra por la red".
2. **El LWW usa reloj de PARED** (`actualizadoEn`, `Date.parse`). Dos aparatos con
   relojes desfasados se pisan al promover/degradar/cambiar PIN. La decisión de
   quién gana no debe depender de qué reloj está mejor puesto.

El PIN es el "carrier" de la sub-identidad (identifica al miembro y su rol). El
roster ES el carrier; el problema es que no converge.

## Diseño — LWW-Element-Set con reloj lógico + tombstones

Cada usuario es un registro LWW versionado por un reloj LÓGICO (no de pared):
- `rev = { c: <contador Lamport>, d: <deviceId> }`. El contador viene del Lamport
  que YA tenemos (`OCSyncControl.revTick()` → `siguienteLamport()`), globalmente
  monótono y ya sincronizado por los version vectors. `d` desempata.
- **Borrar = tombstone**: el registro no se elimina, se marca `borrado:true` con
  un `rev` nuevo. Se filtra de GET/verificar/conteos/UI. Así la baja PROPAGA:
  el tombstone gana al re-add rancio de un tercer aparato.
- **Merge**: comparar remoto vs local por `rev` (contador, luego deviceId). Si el
  remoto domina, adopta TODOS los campos incluido `borrado`. Si local no existe,
  adopta el remoto tal cual (incluido tombstone). Si NINGUNO tiene `rev` (dato
  viejo pre-upgrade), cae al reloj de pared `actualizadoEn` como antes.

### Propiedad de compatibilidad / seguridad
- `rev` se agrega SOLO cuando hay una escritura después del upgrade. Dos aparatos
  sin actualizar se comportan byte-idéntico a hoy (fallback a `actualizadoEn`).
- Roster de una tienda es diminuto (<10 personas): los tombstones no se purgan,
  el costo es despreciable.

## Pasos (cada uno verificado y pusheado)

1. `sync-realtime.js`: exponer `revTick()` y `deviceIdActual()` en `OCSyncControl`.
2. `mock-backend.js`: helpers `_revNueva()` y `_revDomina(remoto, local)`.
3. Escrituras (`POST`/`PATCH /api/usuarios`): sellar `rev`. `DELETE` → tombstone.
4. Lecturas (`GET`/`verificar`/conteo del tope free/UI): filtrar `!u.borrado`.
5. Serialización (`catalogoPropio` + checkpoint, map de `usuarios`): incluir
   `rev` y `borrado`.
6. Merge (`aplicarCatalogo` rama `usuarios`): LWW por `rev` + adoptar tombstones.
7. `compararCatalogo` (preview de diferencias): reflejar tombstones sin romper.
8. Bump SW v111→v112 + version.json. Verificar: `node --check`, `check-sw.sh`,
   `guards.sh`. Commit, push, PR, merge cuando verde.

## Qué NO entra
- NO se adopta Yjs (Camino B descartado por JFC).
- NO se agrega servidor que guarde estado (rompería sin-nube).
- NO se toca stock (sigue siendo hecho físico por percha, nunca se copia).
- NO se cambia el string interno "empleado" (rompería PINs ya activados).

## Verificación de que converge (comprobable, no "probar la app")
- Se agrega un test de mesa en `guards.sh`/script aparte: dos rosters con el
  mismo id, uno tombstone con `rev.c` mayor → el merge deja el tombstone
  (miembro fuera). Promover con `rev` mayor gana aunque su `actualizadoEn` sea
  menor (reloj desfasado). Ambos casos deben dar el resultado esperado.
