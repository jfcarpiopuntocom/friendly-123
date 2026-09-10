# PLAN — Terminar el sync + Fotos que se sincronizan (2026-09-10)

Estado de partida: el sync nuevo (Plan C / Yjs, Fase 2) YA mergea perchas,
productos, usuarios y clientes entre los dos aparatos de JFC (probado en vivo).
Falta cerrar detalles y sumar las fotos. Shell actual: v242.

Rama: `claude/app-inconsistency-devices-browsers-mjl7vj`. Cada paso que toca un
archivo del SHELL sube el entero del shell + `gen-manifest` + `check-sw.sh`.

---

## PARTE A — Cerrar el sync (esta sesión, va PRIMERO por tocar datos en vivo)

### A1. El nombre del negocio no mergea  [riesgo: bajo, molesto]
**Causa real:** el puente Fase 2 llama `aplicarCatalogo(remoto, null)`. Con
`rol=null`, `aplicarCatalogo` adopta el nombre del negocio solo si el local está
VACÍO (`!nombreNegocio.trim() || rolRemoto==="dueno"`). Como ambos aparatos ya
tienen nombre, nunca gana ninguno.
**Arreglo:** en `sync-yjs.js`, el mapa `_meta` guarda además `nombreEsDueno`
(true si QUIEN escribió el nombre es el dueño). Al aplicar, se pasa
`rolRemoto = _meta.get("nombreEsDueno") ? "dueno" : null`. Así el nombre puesto
por el dueño gana en todos los aparatos, igual que la regla de jerarquía que ya
existe. El rol propio se lee de `window.OCAuth.rolActual()`.
**Comprobación (headless, 2 Y.Doc):** doc A (dueño) fija nombre "Tienda X"; doc B
tiene "Otra". Tras converger y aplicar, `OCSync` de B reporta `nombreNegocio ===
"Tienda X"`. Script imprime `OK-nombre` o falla.

### A2. El aviso post-merge va DENTRO de "Today's alerts", no flotando  [riesgo: bajo]
Hoy el aviso de sync sale como banner suelto encima del hero
("Loading your business..."). JFC lo quiere como un ítem del panel
**Today's alerts** (`<ul id="listaAlertas">`).
**Arreglo:** una sola función `agregarAlertaSync(texto, color)` que inserta un
`<li class="...">` en `#listaAlertas` (reusando las clases semáforo existentes).
Se dispara al mergear por sync (evento `oc-catalogo-autoaplicado` y el puente
Fase 2 cuando `aplicarCatalogo` suma algo). Se elimina cualquier banner
`position:fixed`/prepend sobre el hero para este aviso. Texto tipo:
"Sync: +N shelves, +M products merged from another device."
**Comprobación:** disparar `oc-catalogo-autoaplicado` y verificar en el DOM que
`#listaAlertas` gana un `<li>` y que NO existe ningún elemento `position:fixed`
nuevo sobre `#heroSemaforo`. Script imprime el conteo de `<li>`.

### A3. "Loading your business..." se queda colgado tras el merge  [riesgo: medio]
El hero muestra `hoy.loading` hasta que `cargarHoy()` re-renderiza (línea
index.html ~4028). Tras un merge por sync no se re-renderiza la vista Hoy, así
que se queda en "Loading...".
**Arreglo:** al mergear por sync, si la vista activa es Hoy, volver a llamar
`cargarHoy()` (con debounce 400 ms). Enganchado al mismo evento de A2.
**Comprobación:** tras disparar el merge con la vista Hoy activa, el
`#heroTitulo` deja de decir "Loading your business..." y pasa al título real
(`hoy.titulo.*`). Script compara el texto antes/después.

---

## PARTE B — Fotos que se sincronizan (la feature grande)

Principio: el inventario ya viaja por el CRDT; las fotos NO se meten en el CRDT
(lo inflarían). El CRDT lleva el **puntero** (`fotoHash`), los **bytes** van a
almacenamiento aparte. Todo direccionado por contenido (hash SHA-256): la misma
foto se guarda una vez y nunca hay conflicto de merge.

### B0. Dejar de achicar las fotos de más  [riesgo: bajo, ganancia inmediata]
Hoy: perchas se guardan a **640px JPEG 0.8** (`vista-perchas.js:138`,
`idb-fotos.js`). JFC tiene razón: sobra espacio, no vale perder calidad.
**Arreglo:** subir a **1600px, calidad 0.9** (JPEG por compatibilidad iOS; WebP
opcional con fallback). Una foto de cámara queda en ~250-500 KB en vez de ~80 KB:
sigue siendo minúscula frente a los 15 GB del Drive del dueño, y se ve nítida.
**Comprobación:** cargar una imagen de prueba grande, medir el `dataURL`
resultante: lado mayor === 1600 y peso < 700 KB. Script imprime ambos.

### B1. Guardar las fotos por su hash (content-addressed)  [riesgo: medio]
Extender `idb-fotos.js` (`window.OCFotos`) para guardar/leer por `fotoHash`
además de por id. Cada producto/percha guarda en su registro
`{ fotoHash, fotoW, fotoH, fotoBytes }`. El hash es SHA-256 del binario.
Dedup automático: dos productos con la misma foto = un blob.
**Comprobación:** guardar la misma imagen dos veces devuelve el MISMO hash y en
IndexedDB hay UN solo blob. Script imprime `dedup-OK`.

### B2. El puntero viaja por el CRDT (ya está el mecanismo)  [riesgo: bajo]
Como `fotoHash` es un campo más del producto, `catalogoPropio()` ya lo lleva y el
puente Fase 2 lo sincroniza. Al converger, el otro aparato ve el `fotoHash` y, si
no tiene ese blob, lo pide (B3). Degradado elegante: nombre y precio al instante,
la imagen se rellena cuando llega.
**Comprobación:** en 2 pestañas (BroadcastChannel), asignar foto en A; B recibe
el `fotoHash` en su store. Script imprime `puntero-converge-OK`.

### B3. Plan A durable = "Conectar Google" de un click  [riesgo: medio-alto]
Cero configuración (regla dura de JFC): el dueño toca **un botón**, aprueba con
su Gmail (OAuth), y las fotos + un respaldo del inventario quedan en **SU propio
Google Drive** (15 GB gratis). Nuestro único fierro: un Worker que hace de
intermediario del login (guarda el secreto OAuth, refresca el token). Nunca
leemos ni guardamos su contenido. Nuestro costo ~cero por más tiendas que haya.
- Subir cada foto como archivo nombrado por su hash a una carpeta `friendly-123`
  del Drive del dueño.
- Protocolo **"tengo/quiero"**: un aparato pide al Drive los hashes que le
  faltan; descarga barata y reanudable.
- Privacidad (elección de JFC): la foto va **plana en SU nube** (es suya, la
  puede ver desde su Drive). Cifrada solo cuando cruza nuestro relay.
**Comprobación:** login de prueba, subir 1 foto, borrarla local, forzar
"quiero", y que vuelva a bajar idéntica (mismo hash). Script imprime
`ida-vuelta-OK`. (El OAuth real lo prueba JFC; el flujo interno se prueba con un
token de prueba.)

### B4. (Explicado en simple) Fotos directas entre aparatos sin nube  [FUERA de este plan, fase aparte]
Qué es: si tus dos aparatos están juntos SIN internet de nube, igual se pasan las
fotos directo entre ellos (tecnología WebRTC, aparato-a-aparato). Es el "piso del
piso": aunque no haya ninguna nube, las fotos igual llegan.
Por qué NO ahora: es la parte más compleja y el 95% del valor ya lo da B3 (con
nube). El mínimo que sí garantizamos desde B2/B3: el puntero SIEMPRE viaja; el
blob llega en cuanto haya una nube disponible.

### B5. (Explicado en simple) Limpieza de fotos huérfanas  [baja prioridad, al final]
Qué es: cuando borras un producto, su foto puede quedar guardada sin que nadie la
use ("huérfana"). Con el tiempo se acumulan y ocupan espacio de gusto. Una
limpieza suave (un "recolector de basura") borra las fotos que ya no apunta
ningún producto y que llevan tiempo sin usarse. Nunca borra una foto que todavía
esté en uso.
Por qué al final: no rompe nada, solo ahorra espacio; puede esperar.

---

## LO QUE NO ENTRA (recortes explícitos)
- **WebRTC aparato-a-aparato para fotos (B4):** fase aparte, después de B3.
- **Varias fotos por producto:** por ahora una foto por producto/percha.
- **Cifrado en reposo de las fotos:** se eligió plano en la nube del propio
  dueño (es suya); cifrado solo en tránsito por nuestro relay.
- **Nubes de terceros con llaves manuales (R2, Supabase pegando keys):**
  descartado por la regla de cero-config. Solo "Conectar Google" de un click.
- **Portar a amigable/consultorio:** solo tras probado en friendly.

## ORDEN DE EJECUCIÓN
A1 → A2 → A3  (esta sesión, cierra el sync que ya está en vivo)
B0            (ganancia inmediata de calidad, trivial)
B1 → B2 → B3  (fotos al Drive del dueño, el grueso)
B5            (limpieza, al final)   ·   B4 queda para una fase futura
