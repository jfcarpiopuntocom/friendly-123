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
