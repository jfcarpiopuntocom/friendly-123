# Apuntes pendientes — friendly-123 (2026-08-27)

Bitácora de lo hecho en esta tanda y de lo que queda pendiente del transcript
original (prompt `codellm-prompt-ac1lwC`, cuyas 10 imágenes se decodificaron a
`C:\00 Projects\sandbox\_backups\img_1.jpg`…`img_10.jpg` pero son miniaturas de
~100 px y no se pudieron leer en esta sesión).

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
