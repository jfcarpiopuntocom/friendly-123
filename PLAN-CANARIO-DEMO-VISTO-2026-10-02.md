# PLAN — Canario "demo visto por dueño" + vientito entre canarios (2026-10-02)

> Ejecutable por cualquier modelo (Sol 5.6, Codex, Claude). Leer `CLAUDE.md` antes.
> Principio de JFC (2026-10-02): **todo debe tener un canario.** Si una pantalla
> puede mostrar algo equivocado sin lanzar un error, eso necesita un canario propio.

## 0. Por qué existe este plan (el incidente)

2026-10-01, Belen (cliente real), dashboard.html: el teléfono de la tienda no contestó por
la sala, el tablero pintó lo guardado en ESE navegador (la DEMO) y Belen entró con su PIN
888 a un negocio de ejemplo. Ningún canario sonó: no hubo error de JS, la pantalla
"funcionaba" con los datos equivocados. v440 (PR #286) cerró la puerta: `leerEstadoLocal()`
de dashboard.html devuelve `null` si no hay `f123_owned` ni `f123_tienda_activa`.
Este plan agrega el AVISO para cualquier camino que se nos escape, hoy o mañana.

## 1. Qué es "demo visto por dueño" (definición exacta, sin interpretar)

Suena el canario `demo-visto` cuando se cumplen A y B en la misma sesión:

- **A. Entró alguien con rol dueño o admin** (app: `entrar("dueno"|"admin")` en `auth-ui.js`;
  tablero: `autorizado = true` en dashboard.html).
- **B. Lo que se pinta es la demo**, por al menos una de estas señales:
  1. aparato sin cuaderno propio: `!localStorage.f123_owned && !localStorage.f123_tienda_activa`
     (misma regla que `_esAparatoDemo` en `mock-backend.js` línea ~192);
  2. ventas semilla: alguna venta con id `/^vs-/` **y** el aparato no está activado
     (OJO: tiendas reales conservan perchas semilla vieja — ver `PERCHAS_SEMILLA_VIEJA` en
     index.html; por eso la señal 2 sola NO basta, va con la 1);
  3. tablero: `pintarDesdeLocal()` pinta y la sala no confirmó el PIN (`modoLocal === true`)
     **y** se cumple la señal 1.

Entrar con el PIN demo 456 (`entrar("demo")`) es legítimo: **NO** suena.

## 2. Pasos, en orden de riesgo

### Paso 1 — Nodo nuevo `tablero` en el Sonar (Worker + app + panel) — lo que desbloquea todo
Hoy dashboard.html carga `salud-app.js` pero el nodo sale "arranque" (no hay `nav button.activo`).
- `cloudflare-worker/worker.js`: agregar `"tablero"` a `NODOS_APP` (lista que usa `sanearNodos`,
  línea ~826). Sin esto el Worker descarta el nodo en silencio.
- `docs/salud-app.js`: agregar `"tablero"` a `NODOS` (línea 412) y en `nodoActual()` devolver
  `"tablero"` si `location.pathname` termina en `dashboard.html`.
- `docs/panel.html`: agregar `["tablero", "Dashboard", "barra"]` a `SONAR_CANARIOS` (línea ~926).
- Compatibilidad: un Worker viejo ignora el nodo (no rompe). Una app vieja no lo manda. OK.
- **Desplegar el Worker:** lo hace `desplegar-licencias.yml` al fusionar (verificar en Actions).
- **Comprobación:** `node --check` de los 3 archivos; test nuevo
  `test/canario-demo-visto.test.js` que importa `sanearNodos` (o lo copia por regex como
  otros tests del repo) y prueba que `{tablero: 2}` sobrevive y `{inventado: 2}` no.

### Paso 2 — El canario `demo-visto` en la app y en el tablero
- `docs/salud-app.js`: exportar `OCSalud.demoVisto(origen)` que hace
  `fallo(origen === "tablero" ? "tablero" : "arranque", "demo-visto")`, **una vez por sesión**
  (bandera en memoria). Usa el canal de fallos ya existente: pinta rojo el nodo en el mapa y
  llega a Sentry/PostHog vía `OCCanarios.fallo`. **No** suma a `errores` (no frena promover.yml:
  "avisa, no frena", regla del 2026-10-01).
- `docs/auth-ui.js`, dentro de `entrar(rol)` después de entrar con éxito: si
  `rol === "dueno" || rol === "admin"` y la señal B.1 (o B.2 con B.1) se cumple ->
  `window.OCSalud && OCSalud.demoVisto("app")`. Envolver en try/catch.
- `docs/dashboard.html`: (a) cargar `<script src="./canarios.js"></script>` ANTES de
  `salud-app.js` (línea ~488) para que llegue a Sentry/PostHog también desde el tablero;
  (b) en `pintarDesdeLocal()` y tras `autorizado = true`: si se cumple B.3 -> `OCSalud.demoVisto("tablero")`.
- **Lista blanca:** el payload es SOLO `{nodo, codigo:"demo-visto", shell, canal}`. Jamás PIN,
  licencia, nombre de negocio ni conteos de productos.
- **Comprobación rojo-verde** (skill `write-tests`): en el test, simular localStorage sin
  `f123_owned` + `entrar("dueno")` -> `OCCanarios.ultimos()` contiene `demo-visto`.
  Con `f123_owned` -> no lo contiene. Con `entrar("demo")` -> no lo contiene.
  Probar que el test FALLA en el respaldo (sin el cambio) y pasa con él.
  Además, Playwright sobre `dashboard.html` servido en localhost (en localhost canarios.js no
  envía: solo llena `ultimos()`, ideal para la prueba).

### Paso 3 — Vientito visual entre canarios (panel.html)
Qué es: cuando un canario pasa de sano a rojo (sus `reportes` suben respecto del último
sondeo), una **ráfaga de viento** cruza el mapa del Sonar: 3-4 trazos SVG curvos que viajan
de izquierda a derecha en ~1,2 s, y los demás canarios se inclinan hacia el que cayó, como
si el aire los empujara a mirarlo. El rojo ya late (eso existe desde v434); el viento solo
dice "acaba de pasar algo, mira aquí".
- Dónde: `docs/panel.html`, junto a "CANARIOS ANIMADOS" (línea ~304) y el render del sonar.
  Guardar los conteos previos en una variable (`SONAR_PREVIO`), comparar en cada sondeo.
- CSS: `@keyframes oc-viento` (translateX + opacity) y `.inclinar` (rotate de 8-12 grados hacia
  el caído, transform-origin en las patas). Solo `transform`/`opacity` (GPU, sin reflujo).
- Accesibilidad: con `prefers-reduced-motion: reduce` no hay ráfaga; se anuncia texto en un
  `aria-live="polite"`: "New alert: Dashboard (demo seen by owner)".
- Legibilidad (regla dura): trazos con tinta real (#0F1923 o el rojo #B0183E), nunca gris.
- No se dispara al cargar el panel por primera vez (solo con cambios entre sondeos).
- **Comprobación:** Playwright abre panel.html con `fetch` de `/canario/estado` interceptado:
  1.º sondeo `{nodos:{}}`, 2.º `{nodos:{tablero:1}}` -> existe `.oc-viento` en el DOM en ≤2 s
  y el canario `tablero` tiene la clase de caído; con `reducedMotion: "reduce"` no existe
  `.oc-viento` y sí el texto aria-live. Captura de pantalla para JFC.

### Paso 4 — Barrido "todo debe tener un canario" (solo inventario, sin código)
Listar en este mismo .md (sección 5) cada pantalla que puede mostrar datos equivocados sin
lanzar error, con su canario propuesto. Arranque mínimo comprobado hoy: tablero con demo
(este plan), Summary by product vacío por cambio de mes (v439), PIN/header sin nombre (caso
iPhone v318 en CLAUDE.md). Pasar la lista por Laya (`laya-evaluate.py`, tipo `choice`,
criterios: riesgo de dinero, cliente real afectado, facilidad de detectar) para rankearla.
Esto NO se implementa en este plan: se le presenta a JFC.

## 3. Checklist de release (obligatorio, CLAUDE.md)
1. Respaldo + `SHA256-LINES.txt` en `backups/<fecha_hora>_canario-demo-visto/`
   (bytes, líneas y SHA-256 de cada archivo tocado).
2. `const CACHE` en `docs/sw.js` y `"shell"` en `docs/version.json` al siguiente entero libre
   (mirar origin/master: hoy va en v440; NO reutilizar un número de Codex).
3. `node scripts/gen-manifest.js` y `bash check-sw.sh` sin FAIL.
4. `npm test` completo en verde (hoy 487/487).
5. Antes de fusionar: `curl -s https://api.github.com/repos/jfcarpiopuntocom/friendly-123/commits/master/check-runs`
   — si aparece `Workers Builds: website`, NO fusionar.
6. Comparar SHA-256 y líneas de cada archivo: disco = rama = master tras la fusión.
7. Tras fusionar: `publicar` en verde; verificar `/next/` vivo; decirle a JFC la hora de
   llegada a clientes (33 min).
8. Entrada fechada en la bitácora de Notion "Bitacora Claude + Codex — apps Made In Cuenca".

## 4. Qué NO entra
- No se toca `promover.yml` ni el umbral que frena la promoción: `demo-visto` avisa, no frena.
- No se cambia la lógica de PIN, la de demo (456) ni `_esAparatoDemo`.
- No se borra ni se "repara" la demo guardada en ningún aparato (solo se avisa).
- No se agregan proveedores nuevos de telemetría (solo Sentry/PostHog vía canarios.js).
- No se implementan los canarios del barrido del Paso 4.
- No se rediseña el Sonar: el viento se suma a lo que existe.

## 5. Inventario "todo debe tener un canario" (lo llena el Paso 4)
| Pantalla | Puede mentir así | Canario propuesto | Rank Laya |
|---|---|---|---|
| dashboard.html | pinta la demo como negocio | `demo-visto` (este plan) | — |
| Commissions > Summary by product | mes nuevo vacío parece "se borró" | `mes-vacio-con-anterior` | pendiente |
| PIN / header | nombre viejo o vacío | `nombre-negocio-vacio` | pendiente |

## 6. Estado
- [ ] Paso 1  - [ ] Paso 2  - [ ] Paso 3  - [ ] Paso 4  - [ ] Release
