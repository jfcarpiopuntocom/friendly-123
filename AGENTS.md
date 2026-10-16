# AGENTS.md — entrada vigente para asistentes de friendly-123

## Directiva vigente de sincronización — JFC, 16 oct 2026

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
