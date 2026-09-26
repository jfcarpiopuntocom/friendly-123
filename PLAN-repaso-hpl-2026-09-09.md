# PLAN — Repaso Hugo/Paco/Luis a las 3 apps (2026-09-09)

Pase adversario a friendly-123, amigable-123 y consultorio-123 tras el trabajo
del día. Ya se investigó (smoke con Playwright + greps). Esto es **plan**, no
ejecución: se aprueba y luego se hace, en orden de riesgo.

## Lo que ya se verificó OK — NO tocar ni re-investigar

- Barrido adversario de las 9 vistas de amigable: **0 pageerrors**.
- Validaciones de Gastos: vacío / negativo / texto raro con comillas·emoji·`<b>`
  → mensajes correctos, sin XSS (escHtml maneja).
- Fix `touch-action` global (anti doble-tap-zoom iOS): aplicado en las 3, **0
  botones sin proteger** (friendly 120 / amigable 31 / consultorio 19).
- Marcador "¿Cómo funciona?" consistente (9×"▸" en amigable).
- Cortesía se guarda (`cortesia:true`, precioEfectivo 0) y cuenta hacia el límite.
- friendly renderiza el badge del candado limpio: `v1.0 · shell-v235`.

## Fuera de alcance (recortes explícitos)

- No se reescribe el subsistema de sync ni el worker de Cloudflare.
- No se toca la lógica de comisiones/split más allá de la decisión del P2.
- No se agrega restore de checkpoint en consultorio (sigue congelado por riesgo).
- No se cambia el idioma ni la nomenclatura ya decidida.

---

## P1 — [ALTO · amigable + consultorio] Recarga de versión: pasar de inmediata a DIFERIDA

**Síntoma:** al primer arranque, amigable (`location.reload()` ×5) y consultorio
(×3) recargan de golpe → el candado parpadea/queda en blanco a media recarga
(verificado en Chromium: 2 recargas, elementos del gate ausentes mientras
recarga). friendly ya lo hace bien: **difiere** la recarga (`reload_al_entrar`
en sessionStorage + `_recargarSeguroVersion`), invisible, al próximo login — sin
interrumpir el tecleo del PIN.

**Fix magistral (portar el patrón de friendly, sin inventar nada):**
1. En `docs/index.html` de amigable y consultorio, reemplazar cada
   `location.reload()` del control de versión (el forzado y el piso) por marcar
   `sessionStorage.setItem("<amg|c123>_reload_al_entrar","1")` y **no** recargar
   en caliente. Conservar la huella `version|shell` y la guarda anti-loop.
2. En `docs/auth-ui.js`, en la función que entra a la app tras un PIN válido
   (`entrar(...)`), al inicio: si la marca está puesta, `location.reload()` una
   sola vez (invisible, ya se pasó el candado). Igual que friendly.
3. NO tocar el `skipWaiting`/`clients.claim` del SW ni la verificación SRI.

**Archivos SHELL → checklist obligatorio:** subir CACHE en `sw.js` + shell en
`version.json` al mismo entero → `node scripts/gen-manifest.js` → `bash
check-sw.sh` (todo OK). amigable `sw.js` es minificado: editar por ancla única +
`node --check`.

**Verificación:**
- `grep -c "location.reload()" docs/index.html` → debe BAJAR (idealmente los del
  botón manual "Purge & reload" se quedan; los del control de versión, fuera).
- Playwright: cargar el candado en fresco, esperar 3s, leer `#oc-gate-build`
  (amigable) / `#oc-gate-beta` (consultorio) → **texto presente, no NULL**, y
  contar navegaciones de frame → **1, no 2**.
- Entrar con PIN demo → la recarga diferida ocurre al pasar a la app, sin
  parpadeo del candado.

## P2 — [MEDIO · amigable] Gastos: definir qué es "Ventas del mes/Neto" con consignación

**Síntoma:** `resumenMes.ventas` suma `precioUnit*cantidad` (venta BRUTA). En
tiendas con consignación (hay `v.split` en 18 puntos del backend) la casa solo
retiene su %; el Neto (ventas − gastos) con bruto **sobreestima** el ingreso real.

**Decisión recomendada:** el Neto debe comparar gastos contra lo que **la casa
efectivamente retiene**, no el bruto. Usar la misma fuente que ya usa el resto
del dashboard para el ingreso de la casa (el `split.montoBruto`/porción de la
casa), no `precioUnit*cantidad`. Documentar la fórmula en un comentario y en el
"¿Cómo funciona?".
- Alternativa si JFC lo prefiere: mostrar DOS líneas — "Ventas (bruto)" y "Neto
  de la casa" — para no esconder ninguno. (Recomiendo esta si el dueño vende
  propio Y en consignación mezclado.)

**Verificación:** montar un caso demo con 1 venta propia + 1 en consignación,
comprobar que el Neto = (retención real) − gastos, no (bruto) − gastos.

## P3 — [BAJO · las 3] Política de legibilidad vs `--ink-soft`

**Síntoma:** CLAUDE.md dice "nunca gris", pero el texto secundario (fechas,
subtítulos, labels) usa `var(--ink-soft)` en TODA la app — no es de hoy, es
convención. Arreglar solo Gastos dejaría el resto incoherente.

**Decisión recomendada:** formalizar la excepción. `--ink-soft` es "tinta suave
LEGIBLE" (marrón oscuro, no gris de baja opacidad), permitido para texto
secundario. Actualizar la regla de legibilidad en los 3 CLAUDE.md para decir eso
explícito, y verificar de paso el contraste del token contra el fondo.
- Si al medir el contraste `--ink-soft` no pasa WCAG AA (4.5:1) sobre el papel,
  subirlo un punto globalmente (una línea en `:root`), NO por vista.

**Verificación:** calcular ratio de contraste de `--ink-soft` sobre `--paper`
(script node con las fórmulas WCAG) → dejar constancia del número; si <4.5,
ajustar el token y re-medir.

## P4 — [BAJO · amigable] Gastos: atribución del usuario real

**Síntoma:** en demo el gasto se atribuye a "Sistema" (OCCurrentUser null). Hay
que confirmar que un encargado/dueño real logueado con PIN nombrado SÍ queda
atribuido con su nombre.

**Verificación (sin fix si ya funciona):** revisar que `window.OCCurrentUser` se
setee en `auth-ui.entrar()` para PIN nombrado; en Playwright entrar con un
usuario nombrado, registrar un gasto y confirmar que la fila dice su nombre, no
"Sistema". Si no se setea, el fix es una línea al entrar.

---

## Orden de ejecución y versiones

1. **P1 en friendly primero NO aplica** (friendly ya está bien) — P1 es amigable
   + consultorio. Empezar por **amigable** (más tráfico), luego consultorio.
2. P2 (amigable) — necesita decisión de JFC entre "neto de la casa" vs "dos líneas".
3. P3 — un solo commit por app tocando CLAUDE.md (+ token si hace falta).
4. P4 — verificación; fix de 1 línea solo si falla.

Cada cambio a un archivo del SHELL sube el entero del shell y pasa `check-sw.sh`.
Un PR por app, squash-merge cuando esté verde y verificado en navegador.
