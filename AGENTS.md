# AGENTS.md — para Codex (y cualquier agente) en friendly-123

Lee COMPLETO `CLAUDE.md` antes de planificar: son las reglas de JFC y valen igual para ti.
Luego la bitacora compartida en Notion: "Bitacora Claude + Codex — apps Made In Cuenca"
(Claude y Codex dejan ahi una entrada fechada al terminar cada paso).

Reglas que ya costaron caro (2026-09-29):
1. **No fusionar a master si el commit de master muestra el check `Workers Builds: website`.**
   El Worker de jfcarpio.com quedo conectado a este repo y cada merge publico la app encima
   de la pagina de JFC. Ver `CLAUDE.md` (INCIDENTE 2026-09-29).
2. **Nada queda como blob suelto.** Subir archivos por la API de GitHub sin rama ni PR = trabajo
   perdido si te quedas sin uso. Primero rama, luego commits, luego PR en borrador.
3. **v448 GOLDEN está congelada como familia de release (JFC 2026-10-04).** NO inventar v449/v450 para hotfixes.
   `docs/version.json.shell` sigue `f123-shell-v448`; cada hotfix de archivos del shell sube SOLO
   `cacheGeneration: goldenN` y `CACHE_GENERACION = "-goldenN"` en `docs/sw.js`, con manifest SHA regenerado.
   Nueva familia/version solo por orden expresa de JFC.
4. Nunca licencias completas, PIN, claves ni datos de clientes en el repo (es PUBLICO), ni en Notion.
5. **COUNTER NO ES LA CASA** (JFC 2026-09-30, v429): una venta de mostrador se comisiona con el trato
   de la pieza o de la percha. No reintroducir "counter = venta de la casa sin comision". Ver `CLAUDE.md` regla 7.
6. **NO MENTIR (JFC 2026-10-01):** ninguna UI afirma "hecho/guardado/enviado/publicado" sin que haya pasado y se haya comprobado. Ver `CLAUDE.md`.

7. **Arquitectura hexagonal = restricción ejecutable (JFC 2026-10-04).** Leer `ARCHITECTURE-HEXAGONAL.md`.
   En el dominio de fotos: `docs/core/*` -> `docs/application/*` -> adapters/browser. Dependencias siempre hacia
   adentro. Core/application no importan DOM, fetch, IndexedDB, localStorage ni Yjs; todo exterior entra por puertos.
   `test/architecture-hexagonal.test.js` debe seguir verde. No volver a meter política de recuperación en la UI.
