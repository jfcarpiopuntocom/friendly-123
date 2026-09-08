# NOTA — Auditoría del sistema de versión + blindaje fail-open (JFC 2026-09-08)

## Contexto
Tras el incidente de versiones (aparatos sirviendo shells distintos, nombres de
tienda cruzados), JFC pidió auditar todo el sistema de control de versión y dar
hasta 6 mejoras, TODAS orientadas a *garantizar que todos reciban la versión
nueva* — jamás dejar a nadie afuera (fail-open).

## Veredicto
El sistema es sólido: service worker network-first para el shell, precache
resiliente por archivo, skipWaiting+clients.claim, updateViaCache:"none",
broadcast a pestañas. El defecto grave era **fail-closed** donde debía ser
**fail-open**: la verificación de integridad SRI en `install` BORRABA cualquier
archivo cuyo hash no cuadrara con `version-manifest.json`. Con un manifest
desincronizado, borraba el archivo BUENO → media app / app rota sin conexión.
Ese fue el corazón del incidente.

## 6 mejoras (fail-open)
1. **Verificación de integridad fail-open.** [IMPLEMENTADA v1.7.110] Nunca borrar:
   re-pedir el archivo a la red y reemplazar solo si la copia fresca cuadra; si la
   red falla o tampoco cuadra, conservar la copia servida. `docs/sw.js`.
2. **Guard de manifest en la compuerta.** [IMPLEMENTADA v1.7.110] `check-sw.sh`
   ahora recomputa el SHA-256 REAL de cada archivo del shell y lo compara con el
   manifest; un push con manifest desincronizado falla la compuerta. Antes solo
   comparaba el string de versión y el incidente se coló.
3. **Sin mezcla de versiones intra-sesión.** [PENDIENTE] skipWaiting+clients.claim
   puede dejar una página vieja pidiendo módulos nuevos (mezcla). Cerrar con
   recarga atómica coordinada: un cliente es o todo viejo o todo nuevo.
4. **Insignia de versión visible + botón Purge a mano.** [PENDIENTE, Purge ya está]
   Pintar el shell activo en el pie del candado (`id="oc-gate-build"`).
5. **Piso de versión que fuerza actualizar, nunca bloquea.** [PENDIENTE] Usar
   `version.json.requerida`/shell mínimo para recargar (no bloquear) a un aparato
   por debajo del piso. Jamás un mensaje de "bloqueado/límite".
6. **Radar de versión por aparato en Inspector™.** [PENDIENTE] Reportar el shell
   activo de cada aparato al radar (solo huella, REGLA 8) para VER quién quedó
   atascado sin esperar una queja.

## Verificación de lo implementado (1 y 2)
- `node --check docs/sw.js` OK.
- `check-sw.sh` verde, incluye "hashes reales del shell cuadran con manifest".
- `test-todo.sh` VERDE.

## Regla dura que sale de esto
Cualquier cambio a un archivo del SHELL exige, antes de pushear: subir el CACHE
(sw.js) + shell (version.json) al mismo número y `node scripts/gen-manifest.js`.
La compuerta ahora lo obliga (mejora #2). Y aunque se olvide, el SW ya no deja a
nadie afuera (mejora #1).
