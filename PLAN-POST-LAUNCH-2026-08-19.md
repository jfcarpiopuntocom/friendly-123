# Plan post-launch — friendly-123, 2026-08-19

Estas 10 microrrecomendaciones se aprobaron pero NO se implementan hoy: no
bloquean el lanzamiento y su bombeo requiere una vuelta con cabeza fría.
Cada una tiene su archivo, el cambio concreto, la prueba mínima para
saber si quedó bien, y el orden sugerido.

Cadena de prioridades (JFC): **estable → híbrida → innovadora → robusta**.

---

## 2. `<div id="oc-splash">` sin `alt` (ESTABLE)

**Archivo:** `docs/index.html` línea 1228 aprox.

**Cambio:** al `<img>` interno del splash agregarle
`alt="friendly-123"` y `role="img"`. Sin cambios de layout ni de tamaño.

**Prueba:** Lighthouse accesibilidad debe subir; el lector de pantalla
(NVDA/VoiceOver) dice "friendly-123 image" al entrar.

**Riesgo:** cero. Es una prop nueva.

---

## 5. Renombrar la flag `f123_sw_nuke_v1` al bumpear versión (ESTABLE)

**Archivo:** `docs/index.html` bloque `<script>` del SW nuke.

**Cambio:** al detectar la próxima corrupción de SW, cambiar `v1` → `v2`.
Documentar el patrón: cada vez que sospechamos que hay dispositivos
atrapados con un SW viejo, se sube el sufijo y se dispara una vez más.

**Prueba:** en un dispositivo con la flag `v1` en localStorage, verificar
que al desplegar `v2` corre el nuke otra vez y limpia caches.

**Riesgo:** bajo — solo dispara una vez por versión, no en loop.

---

## 6. `og:image` de landings — dimensiones y aspect ratio (ESTABLE)

**Archivos:** `docs/save.html`, `docs/visualize.html`, `docs/dashboard.html`.

**Cambio:** verificar `logo.png` (medir con `identify` o abrir en un
visor). Si es cuadrado, agregar `og:image:width`, `og:image:height` y
opcionalmente un `og:image:secondary` de 1200×630 para las previews
grandes de WhatsApp/Facebook/LinkedIn.

**Prueba:** [OpenGraph.xyz](https://www.opengraph.xyz/) contra la URL de
producción. La preview debe mostrar imagen grande, no icono chico.

**Riesgo:** cero — meta tags nuevos, ignorados por los que no los
entienden.

---

## 7. Enlace mutuo entre landings (ESTABLE)

**Archivos:** `docs/dashboard.html` (header nav), `docs/save.html`,
`docs/visualize.html`.

**Cambio:** el header de dashboard.html ya tiene links a index/save.
Verificar que save y visualize también linkeen a dashboard. Añadir un
breadcrumb ligero en dashboard: "← Back to landing".

**Prueba:** flujo manual — desde cada landing puedo llegar a las otras
tres en un clic.

**Riesgo:** cero.

---

## 10. `data-i18n-attr` — documentar y limpiar uso doble (HÍBRIDA)

**Archivo:** `docs/i18n.js` (comentario), `docs/panel.html` (uso mal).

**Cambio:** al inicio de `applyStatic()` en i18n.js, dejar un ejemplo
copiable en el comentario:

```html
<input data-i18n-attr="placeholder:auth.pin.placeholder,aria-label:auth.pin.aria">
```

Después revisar los 3-4 sitios que usan la sintaxis larga y compactar.

**Prueba:** greppear `data-i18n-attr=` en todo `docs/`, todos deben
seguir la misma convención.

**Riesgo:** bajo — solo cambia forma, no comportamiento.

---

## 13. Teléfono/WhatsApp de soporte por región (HÍBRIDA)

**Archivos:** `docs/save.html`, `docs/visualize.html`,
`docs/checklist.html`, `docs/index.html` (donde aparezca).

**Cambio:** en la sección de "Real support / soporte real", agregar un
`<select>` mínimo o dos filas — una `+593` (Ecuador), una `+1` (US) con
un WhatsApp Business separado. Copy: "Latin America / US".

**Prueba:** desde un móvil clickar cada botón; abre WhatsApp con el
número correcto y el mensaje pre-llenado en el idioma correcto.

**Riesgo:** bajo — nuevos números tienen que existir de verdad primero
(JFC configura el WhatsApp Business US).

---

## 14. Semáforo — quinto estado "TRANQUILO" azul suave (INNOVADORA)

**Archivo:** `docs/mock-backend.js` `path === "/api/dashboard"` (línea
1657–1675) y donde se pinte el semáforo en `docs/index.html` /
`docs/dashboard.html`.

**Cambio:** hoy `semaforoGeneral` es "verde"|"amarillo"|"rojo". Añadir
"azul" cuando `verde` es cierto Y `alertas.length === 0` Y no hay ninguna
categoría amarilla acumulada. Copia: "TRANQUILO — you can close the
laptop" / "you can go home".

**Prueba:** con datos limpios, el hero muestra el chip azul y no rojo/
verde. En un stress test con muchas alertas, no aparece azul.

**Riesgo:** medio — hay muchos lugares donde se lee `semaforoGeneral`.
Revisar cada uno y decidir su comportamiento con "azul". Añadir caso
default seguro (azul → verde en los sitios que no lo entienden todavía).

---

## 17. `data-i18n-tooltip` helper (INNOVADORA)

**Archivo:** `docs/i18n.js` `applyStatic()`.

**Cambio:** añadir un cuarto scanner después de `[data-i18n-attr]`:

```js
scope.querySelectorAll("[data-i18n-tooltip]").forEach((el) => {
  const v = t(el.getAttribute("data-i18n-tooltip"));
  el.setAttribute("title", v);
  el.setAttribute("aria-label", v);
});
```

**Prueba:** poner `data-i18n-tooltip="rec.saveHint"` en un botón; al
hover muestra el texto en EN o ES según idioma activo.

**Riesgo:** cero — nueva convención opt-in.

---

## 18. Onboarding con datos reales — importar 5 productos (INNOVADORA)

**Archivos:** `docs/auth-ui.js` (al terminar el registro),
`docs/mock-backend.js` (endpoint `/api/productos` batch POST) o
nueva función `importarPocos(csvText)`.

**Cambio:** después del `entrar("dueno")` inicial, un modal opcional:
"Import your 5 favorite products (CSV: nombre, precio, costo)".
Un `<input type="file" accept=".csv">` que parsea las primeras 5 filas
y hace un batch POST. Skippeable.

**Prueba:** con un CSV de prueba, los 5 productos aparecen en el
tablero en segundos. Sin CSV, la app sigue funcionando con datos demo.

**Riesgo:** medio — hay que validar el CSV (números negativos,
comillas, encoding). Diseñar el flujo con "puedo saltar esto" siempre
visible.

---

## 22. `pintarPulsar()` — límite del DOM scan (ROBUSTA)

**Archivo:** `docs/micelio-ui.js` línea 138–150 (el `querySelectorAll("body > *").forEach(...)`).

**Cambio:** cuando se reactive el pulsar sobre tu panel maestro para
vigilar clientes, ese loop mide TODOS los elementos hijos directos del
body. Un panel maestro con dashboards + varios overlays puede tener
docenas o cientos. Filtrar por `[data-fixed-bar]` explícito
o limitar a los primeros 50 con `.slice(0, 50)`.

Además: guardar el resultado en una var y sólo re-medir en `resize`,
`orientationchange` y cuando aparezca/desaparezca una barra fija (via
`MutationObserver` con opciones limitadas).

**Prueba:** con un DOM de 500+ elementos hijos de body, la CPU no debe
saltar. Perf > 60fps al scroll.

**Riesgo:** bajo — solo aplica cuando se reactive el pulsar. Si se
queda en false, este código no corre.

---

## Orden sugerido para retomar

Semana 1 (después del launch, con el usuario ya usando la app):
- **2, 5, 6, 7** (estables — 20 minutos cada una).
- **10, 13** (híbridas — 30-60 min cada una, 13 depende de que JFC
  configure el WhatsApp US).

Semana 2 (con feedback real):
- **17, 22** (innovadora y robusta pequeñas — 30 min cada una).

Semana 3 (con presupuesto):
- **14** (quinto estado del semáforo — 2-3 horas por la propagación).
- **18** (onboarding con CSV — 3-4 horas incluyendo validación).

Total: ~1-2 semanas de trabajo esparcido, ningún ítem individual pasa
de 4 horas.
