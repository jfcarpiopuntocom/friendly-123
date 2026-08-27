# Apuntes pendientes — friendly-123 (2026-08-27)

Bitácora de lo hecho en esta tanda y de lo que queda pendiente del transcript
original (prompt `codellm-prompt-ac1lwC`, cuyas 10 imágenes se decodificaron a
`C:\00 Projects\sandbox\_backups\img_1.jpg`...`img_10.jpg` pero son miniaturas de
~100 px y no se pudieron leer en esta sesión).

## Tanda v130 (2026-08-27, segunda tanda del día)

- **Esquema de PINs** (friendly-123 y AMIGABLE): `456` demo · `789` activador ·
  `888` dueño inicial libre (ya NO abre demo) · `260` empleado · `357` contable.
  Reservados pasan a `{456,789,260,357}` en `mock-backend.js` y `avanzado-extra.js`;
  se quitó la rama `888→demo` de `auth-ui.js`; copy del gate, `checklist.html`,
  `save.html`/`ahorra.html`, `manual-maestro.html`, `tutorial-ui.js` y
  `AMG-AUDITORIA-MANUAL.md` actualizados. **Consultorio-123 NO se tocó**: usa PINs
  de 4 dígitos (8888/7895/2605/3570) — migrarlo a 3 dígitos es un cambio grande
  (crypto-store, dispositivos activados, manual). PENDIENTE de decisión.
- **Compradores por ítem/evento** (`index.html`): el botón negro "Show customers"
  y el 👁 de la ficha abren un modal unificado `abrirCompradores()` con filtro por
  producto/evento y botón de imprimir. El 👁 reemplaza a la antigua vista de
  mostrador fullscreen (se eliminó el overlay `oc-customer-overlay` y su script).
- **Dashboard** (`dashboard.html`): encabezado "Control Board"→"Dashboard";
  columna "Compró" en la tabla de Clientes (derivada de `datos.ventas`); aviso de
  demo (PIN 456, aislada) antes de la cajita de pegado.
- **Gastos por rol** (`index.html`): dueño/admin/contador ven ingresos+gastos+neto;
  el encargado/clerk ve SOLO gastos. Botón ✏️ de edición inline por gasto
  (PATCH `/api/gastos/:id`), visible solo para dueño/admin/contador.
- **Bar por servings** (`index.html` + `mock-backend.js`): tipo de producto "Bar"
  (pulldown en el alta), campos `servingMl` (default 50) y `botellaMl` (default 750);
  la ficha muestra "≈ N servings per bottle"; el panel de venta de un bar pide
  servings y muestra el equivalente en botellas en vivo; `cantidad`=servings y se
  registra `info.servings`/`info.botellas`. Stock de bar se cuenta en servings.
- **Shell v130**: `sw.js` CACHE y `version.json` subidos a `f123-shell-v130`.
- **Tests**: node --check ✅, check-sw ✅, roster ✅, harnesses join-identity/claim-
  merge/watchdog/failsafe/team-sync ✅ (team-sync actualizado a PINs libres 111/222
  porque 456/260 ahora son reservados). guards.sh sigue con 1 rojo preexistente
  (`c123_`, documentado en NOTA-fix-C1C2-relay, no causado por esta tanda).

## Hecho y empujado en esta tanda

- **A1** — dedup unificado del doble motor de sync (lazy `op.id` vs relay
  `op.opId`): `reproducir()` en `avanzado-extra.js` consulta y escribe el
  ledger `f123_sync_ops_aplicadas`. Test `.claude/test-a1-dedup.cjs` ✅
- **Bloque 1a (Clientes)** — campo `notas` en `fichaCliente()`, endpoint
  `PATCH /api/clientes/:id/contacto`, chip "han comprado"/"sin compras",
  contacto (tel/email), línea de notas y panel colapsable "✎ Editar
  contacto/notas" con guardado. Test `.claude/test-bloque1a-clientes.cjs` ✅
- **Bloque 1b (Comisiones)** — `exportarComisionesCSV()` + botón "⬇ Export CSV".
- **Bloque 1c (Gastos)** — array `gastos` con persistencia, endpoints
  `GET/POST /api/gastos` y `DELETE /api/gastos/:id`, botón de nav "Expenses",
  sección `#vista-gastos` con formulario y tarjetas de resumen. Test
  `.claude/test-bloque1c-gastos.cjs` ✅
- **Bloque 1d (Perchas)** — `ventasDelMes(ubicacionId)` y `Promise.all` en
  `cargar()` para que las perchas propias reflejen la venta real del mes. Test
  `.claude/test-bloque1d-perchas.cjs` ✅
- **Bloque 1e (Vendido)** — selector de cliente movido ARRIBA del grid (barra
  con `#ventaCliente`, `#btnNuevoCliente`, `#btnShowCustomers`); se eliminó el
  selector duplicado que quedaba dentro del panel "Scan or search by code".
  Botón negro "Show customers" abre un modal con los clientes que SÍ han
  comprado (agregados desde `/api/ventas/todas`), ordenados por compra más
  reciente, con nombre/código/teléfono/compras/total/última compra; tocar
  "Select" lo elige en el selector y cierra. Claves i18n nuevas en `i18n.js`.
- **Bloque 1f (Avanzado)** — edición de PIN del dueño mejorada: los tres inputs
  ahora son `type="password"` (enmascarados) y se añadió un campo de
  confirmación del PIN del dueño (`#oc-c-owner2`) que debe coincidir antes de
  guardar (evita que un error de tecleo deje al dueño fuera de su negocio).
  Claves i18n `auth.act.confirmOwner` y `auth.act.pinMismatch`.
- **Bloque 2 (dashboard.html)** — el login ahora funciona con solo el PIN
  cuando el negocio está en ESTE dispositivo (existe estado local): se salta la
  validación del código de licencia en ese caso (GUARD 4). El código de licencia
  solo se exige cuando hay que conectar con el equipo (sin estado local).

## Pendiente / por revisar

- **Transcript original**: el archivo `prompt-1.txt` ya no existe en
  `C:\Users\JFC\.abacusai\tmp\codellm-prompt-ac1lwC\`. Las 10 imágenes del
  prompt están en `C:\00 Projects\sandbox\_backups\img_1.jpg`…`img_10.jpg`
  pero son miniaturas ilegibles. Si hay ítems del transcript que no se
  cubrieron aquí, hay que recuperar el prompt original para listarlos.
- **Verificación visual de las imágenes**: revisar las 10 imágenes a resolución
  completa (si se consiguen) para confirmar que los bloques 1e/1f/2 coinciden
  con lo que pedía Belén, sobre todo el modal "Show customers" y el panel de
  PIN de Avanzado.
- **Harness de bloque 1e/1f/2**: los tests enfocados de esta tanda (1e, 1f, 2)
  se verificaron en vivo en el navegador; conviene añadir un harness de
  regresión si se quiere cubrir el modal de clientes y el login del dashboard.
- **Bump de shell**: al tocar archivos de `docs/` cargados por el SW hay que
  subir `sw.js` (CACHE) y `version.json` (campo `shell`) a la vez. Pendiente
  para el commit de esta tanda (v129).

## Reglas de la casa (recordatorio)

- Backups paranoid readonly antes de tocar nada.
- Harness de verificación antes de cada commit.
- Bump de versión de shell al cambiar archivos de cliente.
- Todo va al repo REAL `C:\00 Projects\friendly-123`, no al sandbox.
