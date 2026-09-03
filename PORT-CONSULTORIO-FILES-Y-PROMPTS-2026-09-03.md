# Consultorio-123 — port por archivos (para hacer en otras sesiones de Claude)

**Basado en el plan que YA existe:** `PLAN-PORT-CONSULTORIO-2026-09-03.md` (menú,
modelo, límites) y `PLAN-MAESTRO-PERT-PORTS-2026-09-03.md` (ruta crítica). Sube
también uno de esos a la sesión si quiere el porqué completo. El de amigable
(`PLAN-PORT-AMIGABLE-2026-09-03.md`) tiene su propia lista análoga — pídemela y la
armo igual.

**Cómo usar:** en cada tarea, subes a una sesión nueva **el archivo BASE de
friendly** que se indica, pegas el **PROMPT** de esa tarea, y la sesión produce
el archivo de consultorio. Hazlo **en el orden de las fases** (infra primero).

**Supuesto de arranque:** consultorio-123 parte de una **copia del `docs/` de
friendly-123** (así ya abre y sincroniza). El trabajo es (A) renombrar/namespacear
la infra y (B) reescribir la capa de negocio. Nada de perchas, comisiones, ferias.

**Regla dura para TODAS las tareas (pégala siempre):**
> No romper datos ni identidad de nadie (Prime Directive 1A + REGLA 8c: fusionar,
> nunca perder trabajo real). Cambios aditivos y mínimos. Español natural (sin
> "vive en"), sin emojis en UI. Paleta semáforo #00C87A/#FFC700/#F97316/#E8365D/
> #0A0A0F, sin azul. Sin nube: relay zero-knowledge, no agregar servidor que
> guarde estado. Verificar `node --check` y, si toca UI, revisar visualmente antes
> de entregar. Unidad = el PACIENTE. PIN = 4 dígitos (por diseño, no "corregir").

**Decisión pendiente (fíjala una vez y úsala en todas las tareas):**
- Prefijo de namespace: **`c123_`** (reemplaza `f123_`) — confírmalo o cámbialo.
- Prefijo de licencia: **`CST-`** (reemplaza `F123-`).
- Prefijo de shell del service worker: **`c123-shell-v`** (reemplaza `f123-shell-v`).

---

## FASE A — Infra (renombrar/namespacear; NO reescribir lógica)

### A1 · `docs/sw.js`  ← base: `docs/sw.js`
PROMPT: "Este es el service worker de friendly-123. Cámbialo para consultorio-123:
reemplaza el nombre de caché `f123-shell-vNN` por `c123-shell-v1`, quita de la
lista SHELL los archivos que consultorio NO usa (`percha-reposicion.js`,
`vista-perchas.js`, `borradores.js`) y agrega los nuevos de negocio cuando existan
(`pacientes.js`, etc., los iremos sumando). No toques la lógica de precache/SRI.
Entrega el archivo completo y la lista de archivos que quitaste/agregaste."

### A2 · `docs/version.json` + `scripts/gen-manifest.js`  ← base: mismos
PROMPT: "Ajusta `version.json` a consultorio-123: `version` 1.0.0, `shell`
`c123-shell-v1`, `releaseName` y `changelog` propios. `gen-manifest.js` no cambia
salvo que apunte a otro directorio; verifícalo. Entrega ambos."

### A3 · claves de localStorage `f123_` → `c123_`  ← base: TODO `docs/*.js`
PROMPT: "En consultorio-123 el namespace de localStorage debe ser `c123_` en vez
de `f123_`. Dame un `grep` de todas las claves `f123_` en el repo y el patrón de
reemplazo seguro (solo el prefijo de la clave, nunca strings de UI ni comentarios
de fecha). IMPORTANTE (REGLA 8c): si eso deja huérfanos datos ya guardados con
`f123_`, propone una MIGRACIÓN aditiva que lea la clave vieja si la nueva no
existe, para no perder trabajo de nadie. No ejecutes: dame el plan y el diff."

### A4 · `docs/auth-ui.js`  ← base: `docs/auth-ui.js`
PROMPT: "Candado/PIN de friendly. Adáptalo a consultorio: PIN de **4 dígitos**
(consultorio usa 4 por diseño), textos en español de consultorio (rol
`contador/a` visible además de dueño/encargado), y el nombre que se pide al
activar es el del **consultorio**, no 'tienda'. Mantén la lógica de roles y de
`estaLicenciado()` fail-open intacta (Prime Directive 1A). Entrega el archivo y
la lista de textos cambiados."

### A5 · `docs/i18n.js`  ← base: `docs/i18n.js`
PROMPT: "Sistema i18n de friendly (EN+ES). Consultorio es **solo español**: deja
el bloque ES como idioma único (puedes conservar EN como fallback técnico) y
cambia el vocabulario a: paciente, tratamiento, presupuesto, abono, saldo, cuota,
cuenta por cobrar, recibo, factura. Quita claves de percha/comisión/feria. No
borres una clave que siga usándose en el HTML: primero dame la lista de claves
huérfanas vs faltantes."

### A6 · Inspector (radar) — **sin cambios de lógica**  ← base: `docs/inspector.js`, `docs/inspector-ui.js`, `docs/micelio-vivo.js`, `docs/micelio-ui.js`
PROMPT: "Estos archivos son el radar de instancias / integridad (Inspector™) y el
micelio. Pórtalos TAL CUAL a consultorio (solo cambia `f123_`→`c123_` si aparece).
Inspector verifica INVENTARIO — aquí 'inventario' = la lista de pacientes/
tratamientos (ítems), nunca cifras ni datos personales (REGLA 7). Confirma que el
snapshot solo tome campos no-financieros y entrega los 4 archivos."

---

## FASE B — Motor de negocio (`mock-backend.js`) — el corazón

### B1 · `docs/mock-backend.js` (colecciones)  ← base: `docs/mock-backend.js`
PROMPT: "Este mock-backend intercepta `/api/*` y guarda en localStorage con doble
buffer A/B. CONSERVA el motor (doble buffer, dedup `_opsAplicadas`, tombstones,
sync ops, `estaLicenciado()` fail-open, `mov()` con tracking usuario+rol+
dispositivo). REESCRIBE solo las colecciones de negocio para consultorio:
  - `productos/perchas` → `pacientes` (ficha: nombre, cédula/RUC, teléfono, email,
    notas) y `tratamientos` (procedimientos con costo estimado, estado
    propuesto/aceptado/en curso/terminado, depósito inicial, saldo).
  - `ventas` → `pagos` (abonos sobre el saldo de un tratamiento; recibo; factura
    sí/no con RUC/cédula).
  - Nuevas rutas: `/api/pacientes`, `/api/tratamientos`, `/api/pagos`,
    `/api/cuentas-por-cobrar` (saldos por paciente con aging 0-30/31-60/60+),
    `/api/recibos`.
  - ELIMINA: comisiones/asociados, ferias/eventos, reposición, matriz BCG.
Cada mutación pasa por `mov()` (tracking). NO toques el sistema de sync ni el
gating de licencia. Entrega el archivo y un mapa viejo→nuevo de rutas."

### B2 · `docs/plan-pagos.js` + `docs/plan-pagos-ui.js`  ← base: mismos
PROMPT: "Estos son los planes de pago / cuotas de friendly. Re-ánclalos a
consultorio: un plan de pagos pertenece a un **tratamiento de un paciente** (no a
un ítem de inventario). Conserva la lógica de cuotas/instalments; cambia solo el
sujeto (tratamiento/paciente) y los textos. Entrega ambos."

### B3 · `docs/cartera.js` + `docs/hechos.js`  ← base: mismos
PROMPT: "Cartera/abonos append-only de friendly (crédito ligado a ítem+expiración).
Re-ánclalo a consultorio: el saldo/abono pertenece al **tratamiento/paciente**.
Conserva el ledger append-only (no borrar hechos). Entrega ambos y el formato del
`motivo` re-anclado (p.ej. `[trat:<id>][pac:<id>]`)."

---

## FASE C — UI (`index.html`) y dashboard

### C1 · `docs/index.html` (menú y secciones)  ← base: `docs/index.html`
PROMPT: "UI de friendly (grande, >1MB — NO la leas entera; trabaja por secciones).
Reescribe el MENÚ y sus secciones para consultorio, según este mapa:
  1. Pacientes (búsqueda viva reusando `lista-dinamica.js`; ficha con datos
     personales protegidos para rol soporte/maintenance — REGLA 7).
  2. Presupuestos / Tratamientos (reemplaza Inventario).
  3. Cobros (reemplaza Sold): abonos/cuotas, recibo, factura sí/no + RUC/cédula,
     corregir un cobro con tracking.
  4. Cuentas por cobrar (saldos por paciente con aging).
  5. Dashboard financiero (enlaza `dashboard.html`).
  6. Mi panel (lord/soporte): Inspector + integridad, sin ver cifras ni datos
     personales (REGLA 7).
  7. Avanzado/Equipo: PIN 4 dígitos, roles dueño/encargado/contador, unirse,
     respaldo, sync.
QUITA de la UI: perchas, variantes, comisiones/asociados, ferias/eventos,
reposición, matriz BCG. Charset `<meta charset=UTF-8>` DEBE ser el primer hijo de
`<head>` (bug conocido de mojibake). Entrega por secciones (diffs), no el archivo
entero de golpe."

### C2 · `docs/dashboard.html`  ← base: `docs/dashboard.html`
PROMPT: "Dashboard de dueños (se manda por WhatsApp, logo embebido en base64).
Adáptalo a consultorio: usa el logo de consultorio (embébelo en base64, no
referencia externa), y muestra métricas financieras del consultorio (ingresos del
período, total por cobrar, cobrado vs pendiente, tratamientos activos) en vez de
inventario/ventas de tienda. Sin cifras de más; visualización simple. Entrega el
archivo."

---

## Archivos que NO se portan (bórralos de la copia o ignóralos)
`percha-reposicion.js`, `vista-perchas.js`, `borradores.js` (categorías de
producto), y toda lógica de comisiones/asociados, ferias/eventos y reposición.

## Orden recomendado (ruta corta)
A1 → A2 → A3 → A4 → A5 → A6 → B1 → B2 → B3 → C1 → C2.
Tras cada fase: `node --check` de lo tocado + abrir la app localmente y revisar.
Commit y push por archivo/fase (nunca un commit gigante al final).
