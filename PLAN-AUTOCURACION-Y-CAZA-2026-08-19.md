# Plan — sistemas autocurativos + los 22 bugs de la caza

**Fecha:** 2026-08-19 · **Repo:** friendly-123 · **Estado:** propuesto, sin ejecutar.

**Contexto que manda sobre todo lo demas:** friendly-123 esta EN PRODUCCION con
usuarios reales (idiomARTE / Sarah). Cada paso de aqui es aditivo y reversible,
y ninguno cambia datos ya guardados.

---

## Parte 1 — Sistemas autocurativos

### Lo que se busco y que se encontro

Cinco fuentes revisadas. **Recomendacion: no instalar ninguna.** El manifiesto
de la app es local-first, sin nube y sin dependencias, y `index.html` ya pasa de
1 MB. Lo que sirve de estas librerias es el PATRON, y cada uno se implementa en
30-60 lineas propias. Se citan porque el patron esta probado ahi, no para
meterlas al bundle.

| Fuente | Que resuelve | Como se aplica aqui |
|---|---|---|
| [Web Locks API](https://w3c.github.io/web-locks/) (nativa, W3C) | Mutex real entre pestanas del mismo origen, via IPC del navegador | El bug conocido de "dos pestanas se pisan" se arregla con `navigator.locks.request()` en vez del guard casero actual. Es API nativa: cero peso |
| [cockatiel](https://github.com/connor4312/cockatiel) | Retry con backoff, circuit breaker, timeout, fallback | El heartbeat y el relay de sync reintentan sin freno cuando el wifi se cae. Copiar el patron de breaker: tras N fallos, abrir el circuito y dejar de intentar |
| [localForage](https://github.com/localforage/localforage) | Envuelve IndexedDB/localStorage con fallback automatico entre motores | Ya existe `estado-idb.js` con el "orden de sacrificio". El patron de degradar de motor en motor sin romper es el mismo: solo falta cerrar los huecos |
| [Valibot](https://jsonic.io/guides/json-valibot) | Validacion de forma en runtime, modular, menos de 1 kB | Un validador propio de unas 40 lineas para el estado al cargarlo: si un campo esta corrupto, se REPARA al default en vez de tumbar la app |
| [Workbox — service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates) | Shell cacheado en mal estado tras un deploy | Es el bug que ya nos mordio hoy (v65 a v69). Adoptar network-first para el shell y un boton de recarga cuando hay version nueva |

### Los 4 sistemas autocurativos a construir

| # | Sistema | Que se cura solo | Archivo |
|---|---|---|---|
| A1 | **Candado entre pestanas** con Web Locks, con el guard actual de respaldo | Dos pestanas escribiendo a la vez | `aislamiento.js` |
| A2 | **Reparador de estado al cargar**: valida forma y repara campos corruptos al default, dejando rastro en el log | Un estado corrupto tumba la app entera | `estado-idb.js` |
| A3 | **Circuit breaker** para heartbeat y relay: tras 5 fallos seguidos, deja de intentar 5 min | Wifi caido llenando el panel de fallas y gastando bateria | `auth-ui.js`, `sync-realtime.js` |
| A4 | **Autodiagnostico de version**: si el shell cacheado no coincide con `version.json`, se ofrece recarga | Quedar con media version vieja tras un deploy | `sw.js`, `salud-app.js` |

El **rescate de licencias** ya construido hoy (`RESCATE-LICENCIAS.md`) es el
molde de los cuatro: se cura en silencio, se avisa al dueno, solo rellena
huecos, nunca pisa lo que ya existe.

---

## Parte 2 — Los 22 bugs, por riesgo

### Bloque 1 — dejan a alguien sin acceso o rompen la evidencia (VAN PRIMERO)

| # | Bug | Donde | Por que duele |
|---|---|---|---|
| 1 | Lee `amigable_owned`, pero friendly guarda en `f123_owned` | `hechos.js:84` | El instanceId nunca se encuentra: **toda la cadena de auditoria firma con un id anonimo `loc-`**. El sello antifraude pierde el autor |
| 2 | Flujo de recuperacion de PIN, entero en espanol | `crypto-store.js` 416-523 | Una duena estadounidense que olvido su PIN no entiende como recuperarlo. Es literalmente quedarse fuera |
| 3 | Errores de licencia/sala en espanol | `sync-realtime.js` 452-653 | Incluye el mensaje de "codigo invalido" al unirse a un equipo |
| 4 | Rotar la sala ahora desincroniza la licencia | `avanzado-extra.js` (boton "Change the code") | Riesgo que **introdujimos hoy** al hacer `licenseCode = syncCode`. Rotar la sala dejaria la licencia apuntando a un valor muerto |

### Bloque 2 — plata y atribucion mal contadas

| # | Bug | Donde |
|---|---|---|
| 5 | Panel antifraude usa fecha **UTC** para "hoy": despues de las 19:00 en Guayaquil dice "sin actividad hoy" | `avanzado-extra.js:1057` |
| 6 | El mismo filtro compara `m.fecha.slice(0,10)` (ISO UTC) contra esa fecha: **doble** error de zona | `avanzado-extra.js:1058` |
| 7 | "Ayer" tambien en UTC | `novedades.js:63` |
| 8 | El campo `producto` del Worker etiqueta **todo** como friendly-123 (`body.producto === "amigable"` nunca coincide) | `cloudflare-worker/worker.js` |

`hoyLocal()` con zona horaria **ya existe** en `mock-backend.js:29`. Los tres
primeros son olvidos de usarla, no un problema de diseno.

### Bloque 3 — marca y confianza

| # | Bug | Donde |
|---|---|---|
| 9 | El respaldo que el cliente guarda se llama `respaldo-amigable-AAAA-MM-DD.json` | `avanzado-extra.js:1480, 1973` |
| 10 | El reporte contable se llama `reporte-contable-amigable-...csv` | `avanzado-extra.js:1388` |

### Bloque 4 — el resto del espanol en la UI inglesa

| # | Archivo | Cuantos |
|---|---|---|
| 11 | `tablero-avanzado.js` (el tablero entero) | 13 |
| 12 | `percha-reposicion.js` (panel de reposicion) | 4 |
| 13 | `micelio-ui.js` residuales | 8 |
| 14 | `micelio-vivo.js` residuales | 6 |
| 15 | `mock-backend.js` residuales | 6 |
| 16 | `aislamiento.js` residuales | 5 |

### Bloque 5 — estructura

| # | Bug | Donde |
|---|---|---|
| 17 | **13 ids duplicados** `np-*` (formulario de producto dos veces) | `index.html:3726` y `3977` |
| 18 | `oc-doble-usar` duplicado: dos copias del guard de doble pestana | `index.html:2767` y `5263` |
| 19 | Lee ids de dispositivo de la app hermana (`amigable_device_id`) | `device-identity.js:21` |
| 20 | Mismo fallback cross-app | `geo-ping.js:88` |
| 21 | Clave `amigable_sync_ops_aplicadas` | `mock-backend.js:1282` |
| 22 | Bases IndexedDB con nombre compartido entre las 3 apps (`amg_hechos_db`, `amg_audit_db`, `amg_geo_db`) | `hechos.js`, `audit-store.js`, `geo-ping.js` |

---

## Orden de ejecucion

1. **Bloque 1** (bugs 1-4). Lo que deja gente sin acceso.
2. **Bloque 2** (5-8). Plata y atribucion.
3. **A1 + A3** (candado de pestanas, circuit breaker). Los dos autocurativos que
   tapan fallas que ya se han visto en vivo.
4. **Bloque 3** (9-10) y **Bloque 4** (11-16). Marca e idioma.
5. **A2 + A4** (reparador de estado, autodiagnostico de version).
6. **Bloque 5** (17-22). Estructura, lo menos urgente.

Cada bloque va en su propio commit, con su bump de service worker, y se mergea
solo cuando esta verde.

---

## Como se comprueba cada bloque

| Bloque | Comprobacion, con el numero que tiene que dar |
|---|---|
| 1 | `grep -c "amigable_owned" docs/hechos.js` da **0**. En el navegador: activar y ver que un hecho nuevo trae el instanceId real, no un `loc-`. El flujo de PIN olvidado, entero en ingles |
| 2 | Poner el reloj a las 21:00 de Guayaquil y ver que el panel antifraude sigue mostrando los movimientos del dia. El grep de `toISOString().slice(0, 10)` en `avanzado-extra.js` y `novedades.js` solo debe quedar en los nombres de archivo |
| 3 | Dos pestanas abiertas escribiendo a la vez: cero perdidas. Cortar el wifi: el panel de fallas **no** se llena y el breaker deja de intentar a los 5 fallos |
| 4 | `bash check-sw.sh` OK. Descargar un respaldo y que el archivo diga `respaldo-friendly-`. Correr el scanner de espanol: **0** en los 6 archivos del bloque 4 |
| 5 | Cargar un estado corrupto a proposito y ver que la app abre igual, con el campo reparado y la nota en el log |
| 6 | El listado de ids duplicados de `index.html` queda **vacio** |

---

## Lo que NO entra

- **No se instala ninguna libreria.** Ni cockatiel, ni localForage, ni Valibot.
  El manifiesto es local-first sin dependencias y el bundle ya pesa. Se copian
  los patrones en codigo propio.
- **No se toca el relay de sync** (`amigable-sync-relay`) ni el salt
  `amigable-sala:`. Cambiarlos sacaria de la sala a todo equipo ya sincronizado
  en produccion. Se documenta y se deja.
- **No se separa licencia de sala** todavia. Hoy valen lo mismo y ya estan en
  campos distintos; separarlas de verdad es un cambio grande sobre gente que ya
  esta usando la app. Se hace cuando el bug 4 lo exija.
- **No se cambia el estado de la licencia de Sarah.** Es decision comercial de
  JFC, no tecnica.
- **No se portan estos arreglos a amigable-123 ni a consultorio-123** en esta
  tanda. Se anotan y se portan aparte, con su propio respaldo.
- **No se toca el tope del plan gratis** mas alla de lo ya corregido hoy.
