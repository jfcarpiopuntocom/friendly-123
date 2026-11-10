# H3 · Foto por hash sin biblioteca en memoria — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans; TDD RED→GREEN por tarea, una causa por PR.

**Goal:** Reducir picos de heap durante la siembra Yjs de fotografías sin perder ningún byte, referencia huérfana, copia legacy ni reintento.

**Architecture:** Mantener la API de exportación forense `leerTodosPorHash()` intacta. En la ruta de `sembrarFotosAlRelay()`, enumerar únicamente claves mediante `hashesGuardados()` y leer **una foto cada vez** con `leerPorHash()`, conservando las mismas operaciones Yjs deterministas, el mismo guard por capa y la misma publicación durable. Cuando IDB existe, enumerar igualmente los hashes en localStorage; cuando un hash falta en IDB, leer el valor legacy sin sobrescribirlo.

**Tech Stack:** JS sin dependencias nuevas, IndexedDB, localStorage, Yjs, node:test, GitHub Actions. Basar el PR en master v706 `82b7b67f`. No publicar una versión hasta resolver/rebasar la PR #661 v707 y sellar el shell.

**Spec:** War Room <https://app.notion.com/p/4141642b67f3814d8dc4e0e96c78a0c2>; evidencia H2 [PR #659](https://github.com/jfcarpiopuntocom/friendly-123/pull/659), CI #42754842970. La medición sintética de 24 fotos (3,28 MiB) terminó en heap 3,62 MiB con lectura secuencial versus 6,90 MiB cuando se retienen todas juntas. Esto NO equivale a RAM Safari real.

## Global Constraints
- Preservar ventas, stock, dinero, PIN, variantes, historia, Yjs, ambos relés; no borrar ni limpiar storage.
- Nunca eliminar fotos huérfanas, ni dar por entregado un blob que no se encoló. No establecer cupos ni descartar hechos. No auto-merge.
- No cambiar la estructura de hash/dataURL, los Yjs clientID deterministas ni las capas del relé.
- Evitar carga masiva de bytes en memoria. Sin alterar `leerTodosPorHash()` porque recuperaciones/exportación necesitan evidencia completa.
- Cualquier cambio que requiera shell nuevo permanecerá DRAFT hasta manifest, generación de caché y gates verdes en el mismo SHA, además de hardware real.

## Review Focus
1. LocalStorage legacy con IDB operativo: hash huérfano debe enumerarse y leerse.
2. IDB fallida, Yjs con bytes: debe republicar sin perderlos.
3. Mismo blob en ambas capas relé: nueva capa debe recibir op durable; misma capa no debe duplicar.
4. Cambio de foto durante siembra: nunca sobrescribir el puntero nuevo, ni liberar/destruir bytes antes de encolarlos.
5. Ráfagas con fotos grandes y reconexión: todas deben pasar; no saltar claves ni ocultar un fallo bajo un cero.

---

### Task 1: Contrato de inventario de hashes recuperable

**Files:**
- Modify: `docs/idb-fotos.js` (`leerPorHash`, `hashesGuardados`)
- Test: `test/h3-photo-hash-legacy.test.cjs`

**Interfaces:**
- Consumes: `OCFotos.hashesGuardados() → Promise<string[]>`, `OCFotos.leerPorHash(hash) → Promise<string|null>`.
- Produces: mismas firmas; unión de claves IDB y legacy, preferencia de bytes IDB, fallback copy-only.

- [ ] Escribir test RED que inserta un blob en IndexedDB y otro solo en localStorage en el mismo origen: enumeración debe devolver ambos hashes; leerPorHash debe recuperar ambos.
- [ ] Ejecutar en CI: RED debe indicar hash legacy omitido o lectura null.
- [ ] Cambiar únicamente enumeración y fallback en funciones existentes.
- [ ] Ejecutar test GREEN. Verificar que la ruta forense de exportación no se modificó.

### Task 2: Siembra secuencial de bytes por hash, sin leer biblioteca completa

**Files:**
- Modify: `docs/sync-yjs.js` función `sembrarFotosAlRelay`.
- Test: `test/h3-photo-seed-serial.test.cjs`.
- Update fixture contracts: `test/yjs-photo-seed-stable.test.js`, `test/v670-cross-layer-photo-seed.test.cjs` (solo si sus stubs de éxito eran incompletos).

**Interfaces:**
- Consumes: `hashesGuardados()` enumeración de hashes y `leerPorHash(hash)` lectura única.
- Produces: mismas Yjs updates y los mismos flags `_fotosSembradas[hash][capaFoto]`.

- [ ] Escribir test RED: `leerTodosPorHash()` debe fallar si se llama; enumerar tres hashes (referenciada, huérfana, legacy); demostrar que se lee cada blob y que `maxConcurrentReads===1`, que todos quedan en Yjs sin omisiones.
- [ ] Ejecutar RED en CI y comprobar que falla por bulk API/camino actual, no por sintaxis.
- [ ] Sustituir extracción de todos los bytes por enumeración de hashes y bucle secuencial; conservar digest estable y envío del update.
- [ ] Ejecutar GREEN, `v670-cross-layer-photo-seed`, `yjs-photo-seed-stable`, `photo-prime-directive-g04`; revisar regresiones.

### Task 3: Gate de integridad, RAM y release

**Files:**
- Create: `.github/workflows/h3-photo-seed-contract.yml`.
- Test: tests anteriores, las suites de fotos y Sync3.
- No cambio de runtime adicional salvo corrección RED→GREEN.

- [ ] Ejecutar gates de P0 fotos, cuota, historia, A→B Yjs, venta y contabilidad.
- [ ] Comparar heap con CI #42754842970 usando la misma carga, registrando que no es hardware físico.
- [ ] Documentar evidencia en PR y Notion, no declarar reparación de foto Bourgeois sin hardware.
- [ ] Condicionar eventual integración a rebase ordenado con v707, shell hash exacto y prueba física de iPhone PWA→PC.

## Decision log
- Ruling: el límite de 3 PRs por agente en el reporte de Fable es propuesta no ratificada; para no colisionar con #659/#660/#661, este trabajo usa rama separada y PR DRAFT, sin publicar.
- Ruling: no reemplazar `leerTodosPorHash()` globalmente; el consumo masivo sólo se modifica en siembra. Evita degradar respaldos/reparación forense.
- Ruling: no forzar el despliegue de v707 ni v708 sin aceptación física de ventas y fotos.
