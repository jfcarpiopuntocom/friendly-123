# Plan — 8 microbugs reales + 7 mecanismos de autocuración (2026-08-20)

**Para:** JFC · **Alcance:** AMIGABLE, friendly-123, Consultorio-123

Investigación hecha con `grep`/`comm`/conteos, sin leer archivos completos
(`index.html` pasa de 1 MB en las 3 apps). Cada hallazgo tiene el comando que
lo prueba, así que se puede reverificar en 5 segundos.

**Nota honesta:** JFC pidió 11 microbugs. Encontré 8 con evidencia dura y me
detuve ahí — rellenar hasta 11 con "posibles" (ej. conté addEventListener
vs removeEventListener y no cuadraban, pero no pude confirmar que fuera un
leak real sin leer más código) habría sido ruido, no señal. Prefiero 8 reales
a 11 con relleno.

---

## Los 8 microbugs, ordenados por riesgo

### 1. [GRAVE] Consultorio-123: la activación guarda la licencia en la clave EQUIVOCADA
`docs/auth-ui.js` escribe `"f123_owned"` (8 veces) — la clave de
**friendly-123**. Los otros 6 archivos que dependen de esa licencia
(`avanzado-extra.js`, `backup-scheduler.js`, `crypto-store.js`,
`identity-context.js`, `mock-backend.js`, `reconciliacion.js`) leen
`"c123_owned"`, que nunca se escribe. Es el MISMO bug que dejó a friendly-123
sin sync real por meses (`syncCode` vs `licenseCode`), pero en la clave
completa del dueño: rescate de licencia, WhatsApp guardado, scheduler de
respaldo y reconciliación están todos leyendo un hueco.
**Comprobar:** `grep -c '"f123_owned"' docs/auth-ui.js` → hoy da 8, debe dar 0.

### 2. [GRAVE] AMIGABLE: clientes reales no pueden reactivar un segundo dispositivo
La validación de "ya tengo licencia" en `auth-ui.js` usa el regex viejo de 3
grupos sin checksum: `/^AMG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/`. El código
que la propia app genera (`generarCodigoAMG()`) tiene 4 grupos y un símbolo de
checksum Crockford (`*~$=U`) en el último. Cualquier cliente con una licencia
real actual que intente activar un segundo teléfono se topa con el mensaje de
"formato inválido" y — si sigue igual — se le crea una licencia NUEVA sin que
lo pida.
**Comprobar:** `grep -n 'test(_licExistente)' docs/auth-ui.js` en AMIGABLE.

### 3. AMIGABLE: el campo de teléfono obligatorio se ve sin estilo
El CSS del modal de activación tiene reglas para `input[type=email]` e
`input[type=text]`, pero no para `input[type=tel]` — y el teléfono (agregado
hoy como obligatorio en las 3 apps) es justamente `type="tel"`.
**Comprobar:** `grep -c 'input\[type=tel\]' docs/auth-ui.js` en AMIGABLE → da 0.

### 4. friendly-123 (producción, usuarios reales) no tiene cortacircuitos de heartbeat
AMIGABLE y Consultorio-123 tienen el circuit breaker (`_cbFallo`, `_cbExito`,
`_cbBloqueado`) protegiendo el heartbeat de licencia. **friendly-123 — la app
que ya tiene usuarios reales — no tiene ninguno.** Si el nodo de licencias se
cae, cada intento de heartbeat en friendly-123 espera el timeout completo sin
pausa, exactamente el problema que el breaker se creó para resolver hoy en
las otras dos.
**Comprobar:** `grep -c '_cbFallo\|_cbBloqueado' docs/auth-ui.js` en
friendly-123 → da 0; en AMIGABLE/Consultorio da 7-10.

### 5. Las 3 apps: el precache del Service Worker puede servir un shell viejo
`sw.js` hace `cache.add(u)` en el instalador, sin `{cache:"reload"}`. Eso
respeta la caché HTTP normal del navegador: si un archivo del shell no
cambió su URL pero el navegador tiene una copia vieja en caché HTTP, el SW
la precachea igual aunque el número de `CACHE` haya subido. Invisible en
localhost (ahí no corre SW); solo aparece en un teléfono con la app ya
instalada.
**Comprobar:** `grep -n 'cache\.add(' docs/sw.js` en cualquiera de las 3 →
sin `{cache:"reload"}`.

### 6. friendly-123: 68 claves de traducción existen SOLO en español
`docs/i18n.js` tiene 68 claves presentes en el bloque `es:` que no existen en
`en:`. friendly-123 es English-first (`lang` por defecto = `en`). Si
cualquiera de esas 68 claves se invoca con la app en inglés, `window.t()` no
tiene ni el valor en inglés ni un fallback — el usuario vería el NOMBRE CRUDO
de la clave en pantalla (ej. `sync.panel.somethingSomething`) en vez de texto.
Es el espejo exacto del bug que arreglamos hoy en Consultorio-123 (ahí sobraba
inglés; acá sobra español).
**Comprobar:** contar claves de `es:` ausentes de `en:` en
`docs/i18n.js` de friendly-123 → 68.

### 7. `identity-context.js`: el comentario de cabecera dice "amigable_owned" en las 3 apps
El bloque de documentación al inicio del archivo (copiado tal cual entre las
tres apps) dice `localStorage["amigable_owned"]` incluso en friendly-123 y
Consultorio-123, donde la clave real es otra. No rompe nada en tiempo de
ejecución, pero es la clase de comentario que induce al próximo cambio a
tocar la clave equivocada — es justamente el patrón que causó el bug #1 de
esta lista.
**Comprobar:** `sed -n '8p' docs/identity-context.js` en las 3 → dice
"amigable_owned" en las 3, aunque solo AMIGABLE tiene esa clave.

### 8. Las 3 apps: IDs de formulario duplicados en `index.html`
`id="np-nombre"`, `id="np-precio"`, `id="np-stock"`, etc. (formulario de
producto) aparecen DOS VECES en el HTML de las 3 apps — una vez en el
formulario de "nuevo producto" y otra en el de "editar producto". AMIGABLE y
friendly-123 además duplican `id="oc-com-*"` (comisiones). Con IDs
duplicados, `document.getElementById()` siempre devuelve el PRIMER nodo: si
algún handler del formulario de editar usa `getElementById` en vez de
`querySelector` con scope, puede estar leyendo o escribiendo el campo del
formulario de CREAR sin que nadie lo note.
**Comprobar:** `grep -oE 'id="np-nombre"' docs/index.html | wc -l` en
cualquiera de las 3 → da 2, debe dar 1 (con distinto id) o el código debe
usar scope, no ID global.

---

## Los 7 mecanismos de autocuración/resiliencia propuestos

Mismo criterio que los 5 de hoy (Web Locks, cortacircuitos, huella de
catálogo, reparador de estado, autodiagnóstico de versión): **sin
dependencias externas**, vainilla JS, ninguno cambia el comportamiento normal
si nunca falla nada.

### R1 — Portar A3 (cortacircuitos) y A2 (reparador de estado) a friendly-123 y a las 2 que les falta
No es nueva tecnología, es cerrar la brecha del bug #4: friendly-123 (en
producción) no tiene cortacircuitos, y AMIGABLE + Consultorio-123 no tienen
reparador de estado (A2). **Va primero** porque es lo que más protege dato
real ahora mismo, con código ya escrito y probado en otra app hermana.
**Comprobación:** mismo grep de A2/A3 en las 3 → conteo > 0 en las 3.

### R2 — Outbox persistente en IndexedDB para operaciones offline
Hoy la cola de sincronización manual vive en `localStorage` (cupo ~5-10MB,
compartido con todo lo demás). Si el dispositivo tiene el storage casi lleno
(común en celulares viejos), una venta registrada offline puede fallar en
silencio al no caber en la cola. Mover la cola a IndexedDB (cupo
órdenes de magnitud mayor, ya se usa para `OCArchivo`) con reintento
exponencial (1s, 2s, 4s... tope 5min) antes de darla por perdida.
**Comprobación:** simular `localStorage` lleno (llenarlo con basura hasta que
`setItem` tire `QuotaExceededError`), registrar una venta offline, confirmar
que sigue en la cola tras recargar.

### R3 — Bulkhead: cada panel de "Avanzado" aislado en su propio try/catch con placeholder de error
Hoy solo el panel antifraude tiene esto ("wall defensiva", comentario propio
en el código). Generalizar el patrón a los ~10 paneles restantes de Avanzado
(sync, respaldo, transferencias, etc.): si uno falla al montar, muestra un
cuadro rojo con "Este panel no cargó" en su lugar, y el resto de Avanzado
sigue funcionando. Un bug en un panel nuevo nunca vuelve a tumbar toda la
pantalla de Avanzado.
**Comprobación:** forzar un error deliberado (`throw`) dentro de un panel
elegido al azar, confirmar que los demás paneles siguen visibles y
funcionales.

### R4 — Kill-switch remoto por feature, vía `version.json`
`version.json` ya tiene `"requerida"` para forzar actualización. Agregar un
campo `"apagar": ["syncPorQR", "transferencias"]` — una lista de features que
el SW/la app consultan al arrancar y, si aparecen ahí, se desactivan con un
aviso ("temporalmente desactivado") en vez de intentar correr. Permite
apagar una feature rota en producción sin republicar toda la app ni esperar a
que el usuario actualice el shell completo (dado que `version.json` nunca se
cachea, per bug #5 arriba — se lee siempre fresco).
**Comprobación:** poner `"apagar":["syncPorQR"]` en `version.json`, recargar
sin reinstalar nada, confirmar que el botón de QR Sync aparece deshabilitado
con el aviso, y que el resto de Avanzado sigue intacto.

### R5 — Verificación de integridad de assets cacheados (complemento de A4)
A4 ya compara qué `shell` está sirviendo el Service Worker contra
`version.json`. Le falta el siguiente nivel: verificar que los ARCHIVOS
individuales cacheados no estén truncados/corruptos (caso real: una
desconexión a mitad de un `cache.add()` puede dejar un archivo parcial en
CacheStorage). Guardar un tamaño esperado por archivo en `version.json` y
comparar contra `Content-Length` de la respuesta cacheada; si no coincide,
forzar un re-fetch de ese archivo puntual con `{cache:"reload"}` (mismo fix
que resuelve el bug #5).
**Comprobación:** truncar a mano una entrada de CacheStorage vía DevTools,
recargar, confirmar que el archivo se vuelve a pedir con `cache:reload` y
queda íntegro.

### R6 — Idempotencia en escrituras HTTP (ventas, abonos, ajustes)
El dedup por `op.id` ya existe para el sync entre dispositivos, pero NO para
el POST directo del propio dispositivo a su backend local (`/api/ventas`,
`/api/clientes/:id/fiar`, etc.). Un reintento de red tras un timeout (el
usuario reintenta a mano, o el navegador reintenta solo) puede duplicar una
venta o un abono. Agregar un `Idempotency-Key` (UUID generado en el cliente
antes del POST) que el backend recuerde por N minutos y descarte silenciosamente
si se repite.
**Comprobación:** enviar el mismo POST de venta dos veces seguidas con el
mismo `Idempotency-Key` (`curl` x2), confirmar que solo se creó una venta.

### R7 — Huella extendida a saldos/abonos con ventana de tolerancia (solo Consultorio-123)
La huella de catálogo (hecha hoy) excluye a propósito saldos y stock porque
son "hechos físicos" que difieren un instante entre dispositivos sin que eso
sea un problema real. Pero en Consultorio-123 un abono mal registrado (monto
distinto en dos dispositivos para el MISMO id de abono) es plata real de un
paciente, y hoy nada lo detecta hasta que alguien lo nota a ojo. Agregar una
segunda huella, solo de `{id, monto}` de abonos de los últimos 30 días, que
se compara igual que la de catálogo — si hay un choque de montos para el
mismo id, se muestra (nunca se aplica solo) para que una persona decida.
**Comprobación:** crear el mismo abono con dos montos distintos en dos
"dispositivos" simulados (dos pestañas con distinto localStorage vía
aislamiento.js), confirmar que el panel de sync lo señala como conflicto.

---

## Qué NO entra

- **Librerías externas** (cockatiel, cualquier CDN) — el manifiesto de las 3
  apps es cero dependencias; todo lo de arriba es vainilla JS, igual que los
  5 mecanismos de hoy.
- **Los 68 keys faltantes de i18n en friendly-123 (bug #6) no se traducen en
  este plan** — es trabajo de traducción real (68 strings), no un fix
  quirúrgico; se documenta como bug pero la traducción en sí es una tarea
  aparte que vale delegar en bloque una vez aprobada.
- **R2 (outbox en IndexedDB) no reemplaza el mecanismo de copiar/pegar ni el
  de QR** — esos siguen existiendo tal cual; R2 es un tercer canal para el
  caso "automático, con servidor", no un reemplazo de los manuales.
- **No se toca el schema de PocketBase/Fly.io** — todo lo de arriba vive en
  el cliente o en el `wrangler.toml`/`version.json` que ya existen.

---

## Orden recomendado de ejecución

1. Bugs #1 y #2 (pierden acceso/licencia real) — mismo día.
2. R1 (cerrar brecha de A2/A3 entre apps) — mismo día, es copiar código ya
   probado.
3. Bug #4 y #6 — friendly-123 producción primero.
4. Bugs #3, #5, #7, #8 — bajo riesgo, alto volumen; un solo PR por app.
5. R4 (kill-switch) — antes de R2/R3/R5/R6/R7, porque es la red de seguridad
   que hace más barato experimentar con el resto.
6. R2, R3, R5, R6, R7 — en cualquier orden, ninguno depende de otro.
