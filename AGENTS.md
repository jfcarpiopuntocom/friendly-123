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

8. **DEMO OPCIONAL, NEGOCIO VACÍO VÁLIDO (JFC 2026-10-08).** El demo v456 es un PLUS eventual para ventas,
   separado del negocio real; nunca es información por defecto. Un negocio sin registros propios permanece vacío.
   Lord y clientes reciben la misma separación. No sembrar ejemplos al activar, entrar, sincronizar, recuperar o actualizar.
   No imponer datos ajenos ni avisos que responsabilicen al usuario de apagar perchas de ejemplo. Eliminar el aviso no
   reemplaza corregir el origen y la recirculación. Identificar restos por huellas históricas exactas, conservar datos reales
   y respaldos. La autorización no permite purgar almacenamiento ni destruir historia real. Las pruebas que exigían
   rótulos de demo dentro del negocio quedan sustituidas por esta decisión expresa; conservar las demás capacidades.

9. **PROOFSHOT PARA UI (JFC 2026-10-08).** No usar TinyFish. Usar la skill
   C:/Users/JFC/.codex/skills/proofshot/SKILL.md y su JFC.md. Arrancar, probar mediante proofshot exec y cerrar.
   Leer snapshots y capturas antes de juzgar una pantalla; capturar antes y después. Conservar video, resumen y logs
   privados. No publicar artefactos/PR salvo pedido expreso. Sin log de servidor no afirmar cero errores de servidor.
   La evidencia visual complementa las pruebas de datos; no acredita publicación ni sincronización real entre aparatos.

10. Guía de trabajo de JFC del 2026-10-08 adaptada en
    C:/00 Projects/Codex-Friendly-20260917/JFC-WORKFLOW-20261008.md. Usar evidencia y entregables reales,
    reutilizar herramientas comprobadas y respetar las autorizaciones y restricciones vigentes.
