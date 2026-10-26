# AGENTS.md — entrada vigente para asistentes de friendly-123

## HARDRULE · VISIBILITY FIRST / NEVER GUESS IMPACT (23 Oct 2026)

Before modifying a supported S1 or E1–E6: map the **specific source-to-screen path on the exact SHA**: UI action → identity/role/tab guard → durable storage and ledger/stock/photo → Yjs transport + shipped bundle → relay RPC → merge on the second device → restart. List dependent consumers, failure and rollback paths, source evidence and every UNKNOWN. A graph or static search is a navigation aid, **not proof**. Require minimal RED reproduction, smallest safe diff, GREEN targeted result, separate reviewer, and final release gate on frozen SHA. A stale graph after a commit must be rechecked. Start by reading the current [restricted internal traceability and owner decision](https://app.notion.com/p/4021642b67f381f09d96f65192326f9f), if access is authorized; **never mirror customer feedback or identifying evidence into this public Git repository**.

**Public repository hygiene gate:** before release verify the published docs/ surface, master-only maintenance files, authentication of any administrative page, Git history exposure, and required branch protection. Do not place incident transcripts, screenshots of customers, private-repository copies, secrets, or agent scratch files into public commits. Deleting a file from HEAD does NOT remove Git history. Do not change repo visibility, history, or Pages deployment without explicit migration/safety review. This is a safety process, not approval to refactor the app or change its branding.

## START HERE — SPEC BASELINE / SCOPE FREEZE (JFC, 22 Oct 2026)

**MUST READ EACH SESSION, BEFORE PLANNING OR EDITING:** [canonical governance Skill](https://app.notion.com/p/4021642b67f381179e2ff62b1c2f7cc8) → [owner-approved product STABLE baseline](https://app.notion.com/p/4011642b67f38177b1c9cc5b00dcf734) → [Notion Buzón y reservas](https://app.notion.com/p/387956ba9ecf43f9b014dd538110a25a) → current PR/HEAD → [OPERATING-CONTRACT](agent-rules/OPERATING-CONTRACT.md), [FAST-TRACK](agent-rules/FAST-TRACK.md), [ACCEPTANCE-TESTS](agent-rules/ACCEPTANCE-TESTS.md). If Notion inaccessible, record BLOCKED CONTEXT, do not invent specs. Never assume another agent read a linked note.

**JFC FINAL SCOPE:** friendly-123 specifications/features/UI/architecture frozen; only a reproduced E1–E6 defect or owner-approved S1 may be hotfixed. Ideas from an AI, Grok, CodeRabbit, audit or old PR are NOT approval. Classify IDEA / BUG / SPEC CHANGE; only JFC approves scope change. Any S2/S3 or new idea → parking lot after STABLE. One agent implements, another reviews; WIP ≤2, do not edit reserved files. Never modify clients' data. Use precise red test → smallest fix → focused verification → independent review → one final integrated gate; no test counts as reassurance. **Stop when accepted; never keep redesigning.**

**Current owner decisions supersede older paragraphs below:** official public app is https://jfcarpiopuntocom.github.io/friendly-123/ (not friendly123.com/app); synchronization target **2–3 seconds on active connected devices**, NOT historic 150ms / 500ms. Target is NOT yet a guarantee. Devices mutually hold their own encrypted data; supplier is not client data cloud. No TinyFish. Do not edit runtime/produce a shell for documentation-only changes.

## Contexto histórico de sincronización — 16 oct 2026 (objetivo de 150 ms sustituido el 22 oct)

Cloudflare queda para **licencias**, no para transacciones ni sync entre
cuadernos. Esto sustituye las notas anteriores que permitían relay/fallback de
negocio en Cloudflare. El máximo solicitado es 150 ms; ni p95 de 2 s ni una
sonda de control acreditan ese objetivo. [Contrato de corte y evidencia](supabase-relay/CUTOVER.md)
distingue código preparado, migración conservando historia, adopción y medición
real. Esta actualización no autoriza despliegue ni activación de salas.

## AUDITORÍA DE LA ÚLTIMA JORNADA Y PRIORIDAD DE EXPERIENCIA (14 OCT 2026)
- [Notion: auditoría verificable de 45 hallazgos — 38 comprobados / 7 riesgos](https://app.notion.com/p/3f91642b67f381c39a9efdadb132d079)
- [GitHub: informe íntegro y fuentes](https://github.com/jfcarpiopuntocom/buscaclientes/blob/verify/shell-028-release-readiness/docs/AUDITORIA-24H-20261014-ERRORES-Y-CORRECCIONES.md)
- No confundir «documentado» con «arreglado». La instrucción expresa y más reciente prevalece sobre ejemplos, planes y nuestras preferencias. No confiar en pruebas no reproducibles ni en PR/merge como garantía de clientes. Esta sección NO autoriza cambios de runtime ni despliegues por sí sola.


## DIRECTIVA MÁS RECIENTE — 14 OCT 2026: DESCONFIANZA EXPRESA, NO SUPONER NI IMPONER

> **«YO NO CONFIO EN TI, NO ASUMAS NI TE ME IMPONGAS Y ANOTA ESTO EN TODO LADO».**

- **Confianza no concedida.** No esperar que JFC crea afirmaciones de arreglo, merge, publicación, pruebas, sincronía o adopción; corroborar hechos con evidencia objetiva. Identificar «confirmado», «riesgo» y «sin comprobar».
- **Manda la instrucción explícita más reciente SOBRE EL MISMO ASUNTO.** Interpretar los ejemplos como ejemplos, no excepciones; no crear políticas, topes, cuotas, versiones, prohibiciones o decisiones de producto propias ni atribuirlas al dueño.
- **Avisar antes de actuar y avanzar en misiones autorizadas.** «Avísame» no es «detente», ni «termina» significa «entrega un documento y abandona». Si surge una decisión material no delegada, consultar antes de aplicarla.
- **No convertir al propietario en programador o tester.** Resultados reales de clientes, integridad del negocio y rollback reversible antes que números vacíos de CI o jerga. Envíos o publicaciones en su nombre requieren aprobación visual cuando aplique.
- Esta auditoría documental NO autoriza tocar runtime ni versionar la app; guardar directivas no acredita que todos los agentes conectados ya las hayan leído.

**Conservar** las órdenes anteriores como contexto histórico cuando la más reciente las sustituya. Ver [Protocolo Maestro](https://app.notion.com/p/3f81642b67f3810dbe91eab83d978550) y [Skill inter-IA](https://app.notion.com/p/3f51642b67f381999e5fe5bf3fdc6193).

Leer [Contrato operativo](agent-rules/OPERATING-CONTRACT.md); si hay despliegue [Fast track](agent-rules/FAST-TRACK.md); antes de cerrar [Escenarios](agent-rules/ACCEPTANCE-TESTS.md). Historial NO vigente por defecto: `agent-rules/archive/`.

## Mandato de JFC
**Advertencia textual:** «sueles MENTIR, y sueles IMPONERME cosas y que debo CUIDARME MUCHO DE Ti y que NO CONFIONEN TI». JFC exige pruebas y no imposiciones: no pedir que confíe en afirmaciones no verificadas.
**Orden literal:** «TU NO TIENES PERMISO PARA HACER NADA SIN AVISARME». Avisar ANTES de actuar, especialmente de **cada nuevo shell**, para que JFC prepare a los clientes. Una misión ya aprobada se sigue ejecutando tras aviso; «avísame» no significa «prohibido hacer la versión» ni «espera permiso en cada paso». Las decisiones nuevas ajenas al encargo requieren autorización.

## Invariantes no negociables
- Clientes reales: jamás borrar historial, fotos, stock, deuda, comisiones, ventas o pagos; proteger idempotencia, doble aparato, sync y compatibilidad. Cero ficticio es engañoso. Demo aislado del negocio real.
- Nunca copiar licencias/PIN/secretos/clientes reales en el repo PUBLICO, logs, tests, capturas o Notion. Datos del negocio en el dispositivo y sync opt-in cifrado.
- No confundir friendly-123 con amigable-123, consultorio-123, BuscaClientes ni jfcarpio.com. Evitar publicar la app sobre el website; revisar checks de Workers Builds: website antes de alterar ese flujo.
- Arquitectura: [ARCHITECTURE-HEXAGONAL.md](ARCHITECTURE-HEXAGONAL.md); core puro, adapters para infraestructura. Respeto a funcionalidades aprobadas y `release/capabilities.json`.
- Brand/UX: **Made In Cuenca: intuitive business apps** solo donde esté aprobado; cuatro esquinas completas, textos legibles, rol correcto; Counter sale se comisiona según trato de producto/percha.
- No enviar ni publicar mensajes de JFC sin texto íntegro y destinatarios aprobados visualmente.
- PRE-MORTEM → árbol de problemas → PERT proporcionales; prueba de aceptación para cliente y cambio mínimo reversible. No hacer que JFC sea el desarrollador o niñera. No «voy a hacerlo» y parar.
- **Solo MD fuera de docs/** = ninguna nueva versión ni despliegue de la app. **Runtime docs/** = fast track actual, test focalizado; no gate de 33 minutos ni suite completa bloqueante.
- Comunicar en español de negocio: «qué corregí / disponible o no / enlace / qué no comprobé». Merge, SHA y PR se citan solo al final; no usar recuentos de tests para tranquilizar.
- No generar workflows/consultas Cloudflare redundantes ni relajar tests para lograr verde. Distinguir preparado, integrado, publicado y adoptado en aparato real.


## JFC · identidad pública real · 26 octubre 2026

JFC retira expresamente la obligación de conservar versión comercial 1.0. La versión pública pasa a llamarse `shell vXYZ`, con el número real del shell publicado; version.json.version y releaseName deben reflejarlo. El identificador técnico `f123-shell-vXYZ` y la generación de caché siguen coherentes. El candado identifica el SW controlador y distingue actualización pendiente; un nombre visible no prueba adopción del aparato. Esta orden sustituye reglas anteriores incompatibles sobre 1.0.
