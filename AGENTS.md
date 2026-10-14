# AGENTS.md — entrada vigente para asistentes de friendly-123
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
