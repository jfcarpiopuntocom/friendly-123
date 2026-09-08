# NOTA — Botón "Purge & Reload" al pie del candado (JFC 2026-09-08)

## Qué se cambió
Se añadió un botón **failsafe de versión** al PIE de la pantalla del PIN
(el candado `#oc-gate`), en `docs/auth-ui.js`. Etiqueta:
"Stuck on an old version? Purge & reload".

## Por qué
En septiembre 2026, distintos dispositivos/browsers quedaron sirviendo un
`index.html` VIEJO desde el service worker / CacheStorage (mezcla de
versiones: cada quien veía una app —y hasta un nombre de tienda— distinto).
Este botón es la salida de emergencia que CUALQUIER usuario puede pulsar
para desatascarse. Va al pie del candado porque es la única pantalla que
todos ven en común antes de entrar. Queda como failsafe permanente.

## Qué hace (y qué NO — crítico)
- Desregistra TODOS los service workers del dominio.
- Borra TODO CacheStorage (los shells viejos `f123-shell-vNN`).
- `location.reload(true)` → baja el index nuevo desde el origen.
- **NO toca localStorage ni sessionStorage.** Borrar esos destruiría
  inventario, PINs, licencia y nombre de tienda del cliente
  (PRIME DIRECTIVE 1A + REGLA 8c). El problema de "versión vieja" es 100%
  de caché/SW; los datos no son la causa y no se tocan.

> El borrador original que trajo JFC hacía `localStorage.clear()`. Se
> descartó ESA parte a propósito: habría borrado los datos de todo cliente
> que pulsara el botón. Si una sesión futura agrega aquí un
> `localStorage.clear()`, está rompiendo a un cliente vivo. NO lo hagas.

## Detalles de UI
- Feedback en un log inline bajo el botón (no popup/banner nuevo → respeta
  la regla de no meter popups a la UI del cliente vivo) + `console.log`.
- Color naranja del semáforo (`--sim-naranja`/#F97316), texto blanco,
  borde #0A0A0F. Alta legibilidad (sin gris/opaco), per preferencia de JFC.

## Cómo se verificó
- `node --check docs/auth-ui.js` → OK.
- `.claude/test-todo.sh` → TODO VERDE (9/9 arneses + guards).

## Pendiente (raíz, para otra sesión)
El botón es un failsafe, NO la cura de raíz. La causa raíz es la estrategia
de caché del service worker sirviendo shells viejos. Ya existe el sistema de
"compatibilidad de versión + recarga coordinada" (ver bloque JFC 2026-08-28
en `docs/index.html`), pero no bastó. Revisar por qué el SW no se actualiza
solo en algunos browsers antes de dar el caso por cerrado.

---

## ADENDA (2026-09-08, mismo día): release del shell v222 — CRÍTICO

El commit del botón cambió `auth-ui.js` pero NO regeneró `version-manifest.json`.
El SW verifica cada archivo del shell contra ese manifest (SRI-style) y descarta
como "copia corrupta" cualquiera cuyo SHA-256 no cuadre. Resultado: el auth-ui.js
nuevo (con el botón) habría sido descartado en los aparatos → el botón nunca
cargaba. Lo detectó JFC pegando el console de un aparato:
`[SW] hash no cuadra, descartando copia corrupta: ./auth-ui.js`.

Arreglo (release correcto, checklist de check-sw.sh):
- `docs/sw.js`: CACHE `f123-shell-v221` → `f123-shell-v222`.
- `docs/version.json`: shell → `f123-shell-v222`, version → `1.7.109`.
- `node scripts/gen-manifest.js` → regenera hashes (auth-ui.js ya cuadra).
- Verificado: hash auth-ui.js real == manifest; `check-sw.sh` verde;
  `test-todo.sh` VERDE 9/9.

LECCIÓN para futuras sesiones: cualquier cambio a un archivo del SHELL exige,
ANTES de pushear: subir el CACHE en sw.js + el shell en version.json (mismo
número) y correr `node scripts/gen-manifest.js`. Si no, el sistema de integridad
descarta tu propio cambio y el aparato del cliente se queda en la versión vieja.
