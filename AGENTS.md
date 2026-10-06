# AGENTS.md — para Codex (y cualquier agente) en friendly-123

Lee COMPLETO `CLAUDE.md` antes de planificar: son las reglas de JFC y valen igual para ti.
Luego la bitacora compartida en Notion: "Bitacora Claude + Codex — apps Made In Cuenca"
(Claude y Codex dejan ahi una entrada fechada al terminar cada paso).

Reglas que ya costaron caro (2026-09-29):
1. **No fusionar a master si el commit de master muestra el check `Workers Builds: website`.**
   El Worker de jfcarpio.com quedo conectado a este repo y cada merge publico la app encima
   de la pagina de JFC. Ver `CLAUDE.md` (INCIDENTE 2026-09-29).
2. **Trabajo recuperable, sin ramas temporales publicas (JFC).** Usar checkout/worktree local,
   respaldos independientes y commits; publicar el lote verificado mediante push normal a master.
   Un push no equivale a deploy. No sobrescribir el trabajo de otro agente.
3. **JFC 2026-10-05 levanta el congelamiento v448.** v449 y siguientes estan autorizados.
   No reutilizar shells ya publicados. Cambios de runtime requieren un entero creciente en sw.js/version.json,
   generacion coherente y manifest SHA regenerado. No cambiar schema ni version comercial por esta autorizacion.
   `release/capabilities.json` registra capacidades aprobadas y sus pruebas: un fix no autoriza perderlas.
   La promocion automatica exige `release-control` verde del commit exacto dentro de la ventana de 33 min desde push.
   PUSH explicito de JFC es emergencia, sin bloqueo QA/testigo; REWIND no depende de Pages ni QA.
   Estable/previo se publican aunque master falle; /next conserva su candidato anterior. Memoria no equivale a evidencia.
   Un cambio de contrato registra changeApproval con approvedBy "JFC", date, reason y previousContract.
   No quitar pruebas protegidas para obtener verde. CLAUDE.md lo mantiene Claude; Codex usa AGENTS.md y Notion.
4. Nunca licencias completas, PIN, claves ni datos de clientes en el repo (es PUBLICO), ni en Notion.
5. **COUNTER NO ES LA CASA** (JFC 2026-09-30, v429): una venta de mostrador se comisiona con el trato
   de la pieza o de la percha. No reintroducir "counter = venta de la casa sin comision". Ver `CLAUDE.md` regla 7.
6. **NO MENTIR (JFC 2026-10-01):** ninguna UI afirma "hecho/guardado/enviado/publicado" sin que haya pasado y se haya comprobado. Ver `CLAUDE.md`.

7. **Arquitectura hexagonal = restricción ejecutable (JFC 2026-10-04).** Leer `ARCHITECTURE-HEXAGONAL.md`.
   En el dominio de fotos: `docs/core/*` -> `docs/application/*` -> adapters/browser. Dependencias siempre hacia
   adentro. Core/application no importan DOM, fetch, IndexedDB, localStorage ni Yjs; todo exterior entra por puertos.
   `test/architecture-hexagonal.test.js` debe seguir verde. No volver a meter política de recuperación en la UI.
