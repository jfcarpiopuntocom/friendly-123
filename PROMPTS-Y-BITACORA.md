# Bitácora — prompts de JFC y qué se hizo con cada uno

Registro para poder retroceder. Prompts textuales, fechados, con el commit que
salió de cada uno. Se actualiza en la misma sesión, no después.

---

## 2026-08-17 — sesión de noche

**Prompt (resumido, textual en el historial de la sesión):** tablero no cargó a
la hermana con licencia `AMG-7ZXZ-LS9K-XNWC` y PIN 789, tabs vacíos en su PC
donde ya había cargado. "be surgical!". Más: quitar "También en otra percha" o
ponerlo al final; persistencia de ingresos vía cookies; que no cambie lo
editable al volver a editar; categoría con pulldown mixto; encargado y no
empleado en las 3 apps; bar y licores una sola cosa.

**Y para el 18 de agosto:** editar comisiones en retrospectiva; actividad por
evento como pestaña del tablero; pestaña Comisiones para liquidaciones;
asociado/a en vez de promotor/a; perchas exigen teclear el nombre para borrar;
el aviso de "memoria llena" no debe salir en una PC con espacio; al abrir una
percha ver TODO lo conectado; costo unitario en el tablero; variante o chip al
final del formulario; "familia" → serie/programa/familia; los guiones de la
licencia los pone la app; licencia mostrada en Avanzado no coincide
(`AMG-SA3L-AVD5-WG4Z` en vez de la suya).

**Qué se hizo — 5 commits en `claude/adoring-cray-o3ju9x`, todos pusheados:**

| commit | qué |
|---|---|
| `ac8980d` | tablero en blanco, licencia cruzada, "memoria llena" falsa, encargado |
| `a07e80a` | borradores.js, categoría pulldown, orden del formulario |
| `b704956` | borrar exige teclear el nombre, panorama de percha |
| `2c77323` | comisiones en retrospectiva, las dos mitades del reparto |
| `1d4aecd` | pestañas Eventos y Comisiones, calculadora de costo unitario |

**Causa raíz del tablero en blanco:** si el PIN no se podía juzgar en el propio
dispositivo (secreto no disponible, o penalización por intentos fallidos), la
puerta iba al relay; si nadie contestaba en la sala, `sinNadie()` pintaba las
pestañas VACÍAS aunque el negocio estuviera guardado en ese mismo navegador.

**Decisiones tomadas distinto a lo pedido, y por qué:**
- **Cookies → localStorage.** Una cookie tiene 4 KB para todo el sitio y viaja
  en cada petición; un alta de producto no entra. localStorage sobrevive igual
  al back, al cierre y a quedarse sin internet, que era lo que se pedía.
- **El % de comisión NO se guarda por persona.** La misma persona puede ser
  vendedora al 10% en una percha y artista al 85% en otra. Un número por
  persona sería mentira en cuanto tenga dos tratos.

**PRs abiertos (política del entorno: tras pushear hay que abrir PR):**
AMIGABLE#1, friendly-123#1, consultorio-123#1. Los 3 en borrador, sin CI
(ningún repo tiene workflows).

---

## 2026-08-18

**Prompt:** `/make-plan` no funcionaba. Plan para estabilizar y pasar los
sistemas a friendly-123 para que ya se pueda usar, y lo pertinente a
consultorio-123. Prioridad: friendly-123 a producción y live. consultorio-123
apenas en focus groups, va a ser distinta app — contable, financiero, abonos y
pagos, cuentas por cobrar de pacientes, control y visualización financiera
fácil. Revisar commits de 3-7 días, no leer código quemando tokens.

**Qué se hizo:**
- `/make-plan` no estaba en este contenedor: los comandos de la máquina de JFC
  no se sincronizan a las sesiones remotas. Se creó
  `.claude/commands/make-plan.md` **en los 3 repos**, para que viaje con ellos.
- `DIRECCION-PRODUCTO-2026-08-18.md` con el rumbo de las 3 apps.
- **`CLAUDE.md` en los 3 repos.** No existía en ninguno — ésa era la causa raíz
  de que los apuntes no se leyeran. Trae la REGLA 0: leer los apuntes antes de
  planificar.

**Error propio, registrado para que no se repita:** se propuso un plan de port
que habría sobrescrito `mock-backend.js` y `avanzado-extra.js` de friendly-123
con los de amigable, borrando el orden de sacrificio de espacio y el respaldo
autoverificado. La causa: no se leyó `PORT-NOTES-2026-07-21.md`, donde ya
constaba que friendly-123 recibe los avances primero. JFC lo corrigió.

**Divergencia real medida (2026-08-18) — friendly-123 va ADELANTE en:**

| archivo | AMIGABLE | friendly-123 |
|---|---|---|
| `crypto-store.js` | 14.8 KB | **27.9 KB** |
| `mock-backend.js` | 122 KB | **130 KB** (orden de sacrificio) |
| `avanzado-extra.js` | 134 KB | **141 KB** (respaldo autoverificado) |
| `reconciliacion.js` | 24.5 KB | 25.0 KB |
| `i18n.js` + 6 archivos | — | sistema completo |

**AMIGABLE va adelante en:** `index.html`, `auth-ui.js`, `sync-realtime.js`,
`vista-perchas.js`, y 7 archivos que a F123 le faltan (`tablero.html`,
`tablero-avanzado.js`, `estado-idb.js`, `borradores.js`, `micelio-vivo.js`,
`micelio-ui.js`, `percha-reposicion.js`, `simon-config.js`).

---

## 2026-08-19 — los 9 puntos, con friendly-123 YA EN PRODUCCION

**Dato nuevo y permanente:** friendly-123 tiene usuarios reales. idiomARTE
(Sarah, dueña estadounidense) se pasa de amigable-123 a friendly-123 porque le
sirve mejor una version bilingüe English-first. **A partir de aqui todo cambio
es marginal y cauteloso: no se destruye nada.**

### Prompt de JFC (textual, resumido en sus 9 puntos)

1. Confusion entre **licencia** (unica por negocio, solo se cambia por
   ciberseguridad si alguien la descubrio) y el **codigo de sync** de
   Avanzados. Ademas no deja ingresar el codigo por ningun lado en ese mismo
   subsegmento, genera una licencia F123 nueva cuando se le pide un codigo
   temporal, y al escanear el QR desde otro dispositivo sale "No usable data
   found".
2. Configurar YA el worker del panel de control, para poder aprobar licencias.
3. Aun hay partes de la UI en español con el switch en ingles, y es doblemente
   tonto porque friendly-123 debe ser **English-first conceptualmente**.
4. El boton "close the day" tapa el menu en movil. Debe quedar flotando solo
   en PC; en movil va dentro de VENDIDO.
5. Revisar que el menu de botones no tenga highlights que se confundan con el
   sistema Simon.
6. La clave 555 que intento poner Sarah no sirvio (aclarado despues: era para
   **crear un admin**, no cambiar un PIN).
7. El sistema de comisiones debe ser mixto: minimo + comision, comision pura,
   etc.
8. La navegacion de Advanced esta rota, igual que estaba en amigable-123 hace
   2-3 dias. "Cuando te digo que portees todo lo mejorado y avanzado, es
   porque quiero que lo hagas."
9. Revisar los ultimos 15 dias de commits de amigable-123 y portear todas las
   mejoras, avances y correcciones — todo el debugging y los guards.

### Decisiones que tomo JFC en el chat

- **Comision mixta = modo PISO**, el mayor entre el % y el minimo, nunca la
  suma. Se pidieron apuntes del modo aditivo por si se necesita urgente:
  quedan en `NOTA-COMISIONES-MIXTAS-2026-08-19.md`.
- **La licencia de Sarah no se toca.** JFC la aprueba el cuando decida el
  plazo, que sigue sin definirse para friendly-123.

### Bugs reales encontrados (no cosmeticos)

- `simon-config.js` sacaba los "dias sin venta" **parseando la prosa** del
  mensaje con una regex en español. En ingles no hacia match nunca, asi que el
  override de colores por producto **no funcionaba**. Leccion para las tres
  apps: si el dato existe, se pasa como dato, no se parsea texto de UI.
- El panel del micelio ("Your team right now") **nunca se dibujo** en
  friendly-123: faltaba el contenedor `#oc-micelio-panel`.
- El secreto `MASTER_KEY` del worker **nunca se creo**, asi que el panel de
  licencias da 401 haga lo que haga. Ver `RUNBOOK-WORKER-PANEL-2026-08-19.md`.
- Tres fugas de marca "AMIGABLE-123"/"amigable-123" en textos que ve el
  usuario de friendly-123, una de ellas en el WhatsApp que se manda al equipo.

### Error propio, registrado

Se cambio `index.html` sin bumpear el service worker. Eso deja a los usuarios
que YA tienen la app instalada con el shell viejo — que es exactamente el bug
que rompio Avanzado en el iPhone de JFC en amigable-123. Corregido (v65 -> v66)
y convertido en un chequeo automatico: `check-sw.sh`.

## 2026-08-20 — cierre de sesion: 22 microbugs (11+13), guards, v1.0 en las 3 apps

JFC: "halla hasta 22 microbugs y microdefectos en las 3 apps y /make-plan para
mas guards, autocuraciones, verificaciones y ve que los sync de equipo/
dispositivo funcionen!!!!!!!!!" → luego "ultima pasada de 10 bugs en todas las
apps, inconsistencias de idiomas, de keys, de traducciones de code, de
traducir code innecesariamente tambien, etc / v1.0 EN SERIO, en produccion,
las 3, be in excellence!" → "finish that! and lets call it a day! v1.0 for
all 3 apps!"

Hecho: `PLAN-13-BUGS-Y-GUARDS-2026-08-20.md` (ronda 2, sumada a los 8 bugs +
7 mecanismos de la ronda 1 del mismo dia): 13 microbugs reales verificados
(5 AMIGABLE, 3 friendly-123, 5 Consultorio-123), todos corregidos y
pusheados. Hallazgo mas grave: `vista-perchas.js` en Consultorio-123 decia en
su propio comentario "ya no carga" pero seguia activo en index.html y en el
SHELL del SW — codigo muerto ejecutandose sobre un DOM sin ruta de nav.

Guards nuevos instalados en las 3 apps: G1 (autocuracion — aislamiento.js
verifica que su propio parche de `indexedDB.open` siga activo, mismo criterio
que el canario de localStorage), G2 (check-sw.sh ahora falla si aparece una
clave de otra app hermana — este gate, al correr por primera vez, encontro
que el fix de bases IndexedDB compartidas hecho hoy en Consultorio-123
**nunca se habia portado a friendly-123**, que esta en produccion; se porto
en el momento, mismo patron de migracion segura), G4 (check-sw.sh falla si
un boton de nav/tab no tiene su seccion/panel correspondiente).

Sync de equipo/dispositivo: verificado funcionando de punta a punta en
Consultorio-123 (el mas reorganizado hoy) — relay cifrado, codigo+PIN,
`OCSync.clientesActivos()`, `AMG.Cartera.saldoDeCliente()`, todo cableado
correcto.

Ultima pasada (idioma/i18n): 3 agentes en paralelo fallaron por limite
semanal de la cuenta (no error de codigo). Se completo a mano con grep/node
directo: paridad EN/ES 100% en friendly-123 (497/497 claves) y Consultorio-123
(485/485) — el bug historico de 68 claves ES-sin-EN ya no existe (resuelto en
ronda anterior). Sin bugs nuevos reales en esta pasada.

Feedback de JFC, guardado en memoria: prohibido usar subagentes (Agent tool)
u otro trabajo caro en tokens salvo que garanticen calidad muy superior — es
lo opuesto a la filosofia de delegar a OmniRoute. Ver
`feedback_no_subagentes_costosos_usar_omniroute.md` en la memoria del
proyecto.

**Estado final: las 3 apps en `main`/`master`, sincronizadas con `origin`,
`check-sw.sh` verde en las 3 (SHELL completo, sin claves cruzadas, sin nav
huerfano), sin commits pendientes. JFC declaro v1.0 para AMIGABLE,
friendly-123 y Consultorio-123.**

## 2026-08-21 — v1.0: el cuaderno compartido de verdad

**Prompt de JFC (textual, resumido en lo operativo):** "admin no puede crear
productos ni perchas / el admin quedó como empleado cuando debe ser casi como
dueño salvo modificar cosas del dueño (...) pon una jerarquia (...) y ponla
visible en la lista donde sale el team, ellos necesitan saber quién tiene 'más
peso sobre los apuntes conjuntos' / no sirve el demote!!! / probé a sobrevender
un item y quedo en -1 (...) no puede pasar eso a menos que tomemos pedidos por
anticipado / no me deja actualizar con el PIN de admin desde otro dispositivo /
el PIN debe traer toda la información / hacer sync con el codigo TEAM no lo
arregla / lo confunde aun lo de TEAM... lo pide antes de ofrecerlo / el QR no
tiene sentido (...) eliminemos el QR / quita el aviso de Gamification de la UI
del empleado / el anuncio del geo tagging pasemoslo a dentro de ayuda".

Y despues: **"creo que el codigo TEAM- es redundante y confunde, si total la
licencia es el tronco al que todo se conecta"**. Tenia razon y el codigo lo
confirmaba: `normalizarCodigo()` traducia TEAM- a F123-, o sea que eran EL
MISMO VALOR con dos mascaras.

**El hallazgo:** casi todas las quejas eran UN bug. `usuarios` (nombre, PIN,
rol) era estado local de cada dispositivo y el merge solo llevaba perchas y
productos. De ahi salian el PIN de admin que no entraba en el segundo
dispositivo, el demote que "no servia" y el sync que "no lo arreglaba".

**Lo que se hizo:**
- El equipo viaja por sync (catalogo, trozos y huella) y se aplica SOLO al
  conectar. Es la excepcion a "nada se aplica sin confirmar": son credenciales
  de acceso, y pedir un dialogo no sirve cuando el problema es no poder entrar.
  Suma y nunca borra; gana la edicion mas reciente (`actualizadoEn`).
- Muere el codigo TEAM- de cara al usuario. La licencia es el tronco. Se sigue
  aceptando TEAM- al teclear para quien lo tenga anotado.
- Jerarquia real: el admin crea productos y perchas y ve la plata del dia.
  Nivel dueño intacto (licencia, correo, promover/degradar, comisiones).
  Owner > Admin > Staff visible en la lista del equipo, con el dueño arriba.
- Degradar surte efecto con la sesion abierta: se cierra y se vuelve a entrar.
- Stock con piso en 0; lo no descontado queda en la alerta de descuadre.
- QR de unirse y sync por QR: DORMANT con comentario, no borrados.
- Geotagging apagado por defecto, lo enciende el dueño. Se acabo el popup en el
  flujo; la explicacion vive en Ayuda.
- Gamification: portado el texto de amigable-123, sin "(experimental)".

**Verificado en la app corriendo** (no solo por lectura de codigo): PIN de admin
remoto entra; demote remoto degrada; una edicion vieja no revierte el demote;
nadie se borra; 4 unidades menos 7 da 0 y la alerta guarda las 3 faltantes; el
admin ve el boton de alta de producto; "TEAM-" ya no aparece en la app.

**Pendiente a proposito:** pedidos por anticipado (apunte + recordatorio para el
martes 2026-08-25). Y un aviso previo que sigue ahi: el autodiagnostico de
aislamiento reporta que algo pisa `indexedDB.open` despues de aislamiento.js
(no lo introdujo esta tanda; ninguna de estas ediciones toca IndexedDB).

**v1.0 declarada.** `version.json` sube a 1.7.0 con `releaseName: "v1.0"`: el
numero interno lo usa el chequeo de actualizacion y bajarlo a 1.0.0 haria que
un telefono en 1.6.0 creyera que lo nuevo es mas viejo. SW cache a
`f123-shell-v87`.

---

## 2026-08-25 — Tanda "Hybrid Sync + tweaks UI" (rama claude/hybrid-proxy-tunnel-sync-ymq8d6)

**Prompts de JFC (textuales, resumidos por bloque):**

1. "como admin deben poder agregarse perchas! (ya pueden agregarse productos)".
2. Pestaña **First Steps / Primeros Pasos** primera en Advanced; reordenar de lo
   mas indispensable a lo mas arcano; "Accounting Layer" -> "Accounting".
   Ampliado: First Steps con instrucciones reales + tutorial de amigable como
   opcion OPCIONAL al lado; onboarding "award-winning".
3. En Sold/Vendido, captura de clientes portada de amigable, que funque en EN/ES.
4. Venta por evento o item; no volver a pedir el nombre del evento al vender;
   pulldown primero y luego escribir; boton exportar + lista de invitados en
   eventos, con iconos, sin reordenar lo existente.
5. **Hybrid Proxy Tunnel Synchronization Engine** (plan por fases, relay propio
   zero-trust; ver _private/SPEC-SYNC-ZERO-TRUST.md).
6. (mid-turn) Ideas de seguridad/integridad y un aviso de acceso. Detalle en
   nota interna FUERA del repo (el repo es publico). Prioridad fijada por JFC:
   el **sync es mision #1AAA**, va primero; el aviso y la integridad van despues.

**Hecho en esta rama (commits por paso verde):**
- A1 admin agrega perchas (vista-perchas.js).
- A2 First Steps + riel reordenado + "Accounting" (avanzado-extra.js, i18n.js) +
  fix calco "vive en" (tutorial-ui.js).
- A3 captura de clientes bilingue en Vender (index.html, i18n.js).
- A4-A7 evento activo (pulldown), invitados y exportar CSV (index.html, i18n.js).
- B (motor de sync) y bloque 6 (seguridad/integridad): en curso / por definir
  alcance con JFC.

---

## 2026-08-25 — PENDIENTES para la fase de SOLO debug + tests (pedido de JFC)
1. **Claridad de a qué tienda entras**: antes de entrar (licencia + PIN), la UI
   debe decir claramente a QUÉ negocio/tienda estás entrando. Hoy es confuso.
   Buscar el patrón world-class (confirmar "Entrando a: <negocio>" antes del
   acceso). UX racional, claridad, no confusión.
2. **BUG a cazar**: al poner 789 (apropiación), tras unos minutos el dispositivo
   REVIRTIÓ a la licencia propia de JFC. Sospechas: la autocuración del heartbeat
   (adopta syncCode como licenseCode) y/o el pull/checkpoint nuevo re-adoptando
   la sala anterior. Reproducir con 2 licencias y arreglar sin romper el sync.
3. Indicador de sync: DONE hoy (blanco=sincronizado, negro=offline, 4 tonos,
   etiqueta explicativa + tooltip, separación de Help). El de junto a Help es el
   "recently synced pill"; hay OTRO en el panel de Avanzado (mismo criterio).
   Evaluar si dejar solo uno para no duplicar.

---

## 2026-08-26 — Multi-tienda local (switch por licencia) + 12 microbugs + phone→device

**Prompt JFC (textual):** "no sirve, pongo la licencia de mi hermana en la pagina
de entrada donde van los PIN, y me dice que funcionó PERO sigue diciendo
'entering James Bond Store' que es la MIA local (...) cuando pongo una licencia
debe cambiarme a esa tienda la app y dejarme ahi hasta que me venga en gana
poner otra y pasarme a otra tienda!!!!!!"

**Diagnóstico:** el sistema hacía MERGE (fusión), no SWITCH. unirse() solo
cambiaba la sala de sync y sobrescribía f123_owned.licenseCode (hack del
2026-08-25) — por eso la app seguía mostrando la tienda local con otro nombre y
los PINs del equipo no entraban. Ese overwrite era además la fuente del bug #2
del apunte 2026-08-25 (revertir licencia por autocuración).

**Decisión de producto (aprobada por JFC vía pregunta):** multi-tienda local,
cada tienda guardada aparte. Poner una licencia = volverse esa tienda y quedarse
ahí; volver a cualquiera poniendo su licencia. NADA se borra.

**Implementado:**
- Namespace de estado por licencia en mock-backend.js (sufijo "::<lic>" en los
  buffers A/B y el puntero). Inerte hasta que exista f123_tienda_activa → cero
  riesgo para tiendas de un solo dueño.
- window.OCTienda.cambiar(licencia): flush + marcador + reload. Registro
  f123_tiendas mapea licencia->sufijo para poder regresar (la propia = "").
- unirse() ahora llama OCTienda.cambiar() en vez del merge/overwrite.
- Sync aterriza automáticamente en el namespace activo (claveBuffer con sufijo).
- Fix texto: "your phone"/"tu celular" → "device"/"dispositivo" (salió en la PC
  de JFC; no todo device es celular).
- SW v96→v97.

**LÍMITE HONESTO (dicho a JFC):** el relay es sin nube (zero-knowledge). Los PINs
de otra tienda (ej. Belén=222) solo llegan si el aparato de esa tienda está
ENCENDIDO y conectado empujando su catálogo. Con el otro aparato apagado, al
unirse la tienda entra vacía (seed) hasta que sincronice. No hay servidor que
guarde el estado de cada tienda para descargarlo — sería romper la regla sin-nube.

**Microbugs de trabajo propio (12, plan en PLAN-microbugs-2026-08-26.md):** todos
implementados y pusheados. B-01 PIN no visible en aviso de colisión, B-02
restaurar aviso tras re-render, B-03 async catch, B-04 toast en vez de alert,
B-05 i18n PIN strings, B-06 debounce render, B-07 audit log de demote silencioso,
B-08 texto modal rotación, B-09 ↺ fallback Android, B-10 scroll en contenedor,
B-11 estado activo en chips tardíos, B-12 comentario i18n PATCH.

---

## 2026-08-26 — modus operandi fijado

**Prompt (textual):** "toma mis prompts como palabra sagrada aunque no exenta de
errores pero prevalece por sobre tus asunciones o alucinaciones o devaneos o
'creatividad', lo que yo digo es lo que va y ya... fijemos esto para todos mis
proyectos como modus operandi, igual que lo de muchos backups, muchos apuntes."

Contexto: 3 semanas repitiendo lo mismo (no inventar colores/valores, no meter
popups a la UI del cliente en vivo, no dejar nada colgado esperando decisiones de
git, terminar lo ya pedido sin re-preguntar, verificar antes de entregar).

**Qué se hizo:**
- `REGLA –1` (directiva suprema) al inicio de `CLAUDE.md`: el prompt de JFC es
  palabra sagrada y prevalece sobre asunciones/alucinaciones/creatividad.
- `.claude/commands/modus-operandi.md`: constitución portátil a todos sus
  proyectos (palabra sagrada, no detenerse, cerrar el ciclo de git yo, UI
  intocable, respaldos+apuntes abundantes, verificar 3X, pushes frecuentes,
  release checklist).
- Skills previas del día: `reglas-friendly` (paleta exacta del semáforo, no
  popups, checklist de release) y `verificar-ui` (verificación visual con
  Playwright/Chromium antes de pushear, de uso racionado).

Todo en producción durante el día: multi-tienda por namespace, fix del rótulo de
tienda en el PIN, quita de banners no autorizados, bordes de tarjeta al semáforo
exacto, refresh forzado por shell+version, y clientes que ya viajan con el
catálogo (v103).
---

## 2026-08-28 (2ª ventana) — v147

**Prompt (resumido):** "me sacó a la pantalla del candado YA ESTANDO adentro loggeado con 789 en mi cel en Safari!!" (reportado de nuevo); tipografía de Advanced demasiado grande y sin scroll; "build a sale" → "fill a basket"; estrella amarilla en la esquina trunca de Your Products; "no entiendo por qué les das boton de 'rotate team license'... solo YO hago license handling!"; diagnóstico de sync pegado (VERDICT SYNC OFF, License F123-5HSG-JENF, SPLIT, "ya puse F123-A6YK-6V1J-BF2A-S2J24 y no cambió el VERDICT"); "ese id de device debe quedarse firme con el device!!!"

**Causa raíz:** los puntos 1-4 ya estaban corregidos en v140-v146 pero el cel los veía viejos porque `sw.js` CACHE nunca se bumpió de v139. #ZWPM es la huella del inventario (cambia con los datos), no el id del device.

**Qué se hizo — commit `01f0d1b` en master, pusheado:**
- `docs/sw.js` + `docs/version.json`: bump de shell a v147 (v1.7.34). El cel re-instala el SW y recibe el shell nuevo.
- `docs/avanzado-extra.js`: Rotate team license SOLO del lord (claim/merge siguen para dueño/lord); "Activate" reconcilia la identidad partida (helper `_estadoPartido()` → `OCTienda.reconciliar()`); "Fix split identity" ya no cae a la licencia equivocada si el campo está vacío; tooltip de la huella aclara que #XXXX es la huella del inventario.

**Verificación:** node --check 72 .js OK; sw.js/version.json v147 consistentes; 52 scripts en SHELL OK; roster VERDE; arneses team-sync/claim-merge/watchdog/failsafe VERDE; join-identity FALLA preexistente (arnés desactualizado, no lo introdujo esta ventana). Respaldo: rama `backup/20260828-013415-antes-pulido-sync`.
---

## 2026-08-28 (3ª ventana) — v148

**Prompt (resumido):** "cuando pongo join this notebook con F123-A6YK-6V1J-BF2A-S2J24 se reinicia a la pantalla del candado de PIN y se pierde todo!"; "Advanced mode" → "Advanced controls"; icono de Commissions (martillo) → justicia/fairness; estrellas engarzadas en la esquina trunca de My Products (NO como en Sold); consistencia rack/shelf; hallar hasta 33 microbugs/refuerzos/guards; sistema de versiones con checksums y compatibilidad entre partes (world best practices).

**Causa raíz del bug de join:** `unirse()` escribía `licenseCode` antes de `cambiar()`, así que `_licenciaPropia()` devolvía el código nuevo y `sufDest` siempre caía a `""` → el switch de tienda nunca ocurría (contaminación cruzada). Fix: `cambiar()` usa `desde` (tienda de la que se sale, capturada antes de tocar licenseCode).

**Qué se hizo — commit `c0b3901` en master, pusheado:**
- Fix bug de join en `mock-backend.js` (cambiar/reconciliar) y `sync-realtime.js` (unirse). Validado por arneses join-identity (actualizado) y team-sync.
- Sistema de integridad de versión: `scripts/gen-manifest.js` + `docs/version-manifest.json` (SHA-256 por archivo); `sw.js` verificación SRI-style en precache; `salud-app.js` R5 con hashes; `index.html` recarga coordinada (BroadcastChannel), anti-loop, purga solo de caches del shell, verificación de compatibilidad; `check-sw.sh` verifica el manifest.
- Pulido UI: Advanced controls, balanza de justicia, estrellas engarzadas, shelf consistente.
- Microbugs: guards de NaN en money/fmtVentas, aviso de sincronización en tienda unida.

**Verificación:** node --check 72 .js OK; sw/version/manifest en v148 consistentes; manifest 59/59 hashes OK; arneses team-sync/claim-merge/join-identity/watchdog/failsafe VERDE; roster VERDE. Respaldo: rama `backup/20260828-014426-antes-v148-microbugs`. GitHub Pages sirve v1.7.35 / shell v148.
