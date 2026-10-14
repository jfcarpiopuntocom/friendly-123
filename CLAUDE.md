# CLAUDE.md — guía breve y vigente de friendly-123
**Prioridad de lectura:** [AGENTS.md](AGENTS.md) → [Contrato JFC](agent-rules/OPERATING-CONTRACT.md) → notas específicas de la tarea → [Fast track](agent-rules/FAST-TRACK.md) para publicación. La antigua CLAUDE.md íntegra está en [archivo histórico](agent-rules/archive/CLAUDE-2026-10-14.md); sus gates antiguos NO reviven por estar escritos allí.

## Reglas al hablar y actuar
**Evaluación textual de JFC:** «sueles MENTIR, y sueles IMPONERME cosas y que debo CUIDARME MUCHO DE Ti y que NO CONFIONEN TI».
**Orden textual:** «TU NO TIENES PERMISO PARA HACER NADA SIN AVISARME». Avisar ANTES de investigar/modificar/publicar y ANTES de cada shell. Decir número e impacto para sus clientes. Después ejecutar la misión autorizada, sin pedir autorización rutinaria ni detenerse. Si surge otra decisión comercial, seguridad, pago o comunicación pública, sí pedir aprobación expresa.
No imponer supuestas reglas. No llamar «publicado» al código no servido a clientes. «Funciona en web» ≠ «Belén lo recibió». Nunca entregar un comando PowerShell como sustituto de una instalación que no realizamos.

## Producto e invariantes
friendly-123: cuaderno compartido por colores, perchas, consignación, fiado y comisiones. Inglés + i18n ES. Datos locales, relay de sincronización opt-in cifrado; no almacenar cuadernos de clientes en nube ni insertar analítica que recolecte datos del negocio.
**PRIME DIRECTIVE 1AAA:** ningún cliente con licencia pierde fotos, registros, stock, pagos, comisiones o acceso. La deuda y los pagos son idempotentes; montos desconocidos no se convierten en ceros. Demo solo opt-in, jamás sembrado en un negocio real.
Counter sale conserva comisión de producto/percha (NO es «la casa»). Anulaciones pagadas compensan pagos futuros; retenciones opcionales no son pagadas; no inventar cierre mensual.
Nunca publicar PIN/licencias reales/datos privados en repo/Notion/tests. `ARCHITECTURE-HEXAGONAL.md` guía puertos y adaptadores. Marcas separadas: Made In Cuenca: intuitive business apps; no mover otras apps ni dominios sin instrucción.
Diseño: cuatro esquinas completas, contraste legible, modales rutinarios solo en Advanced según rol; llamar a JFC «consultor» o «investigador económico y empresarial», no imponer otras etiquetas de perfil.

## Operación
Pre-mortem → árbol de problemas → PERT breves; reproducir, proteger, corregir causa y probar comportamiento concreto. No suites de 10–30 minutos como excusa; tests rojo-verde pertinentes, contratos adyacentes, medición y URL real. No falsear pruebas. No saturar Cloudflare ni GitHub Actions.
El fast track del 14/oct sustituye la espera histórica 33 min + canario gate. Para archivos runtime `docs/`: avisar antes del shell, SW/cache/manifest coherentes, pruebas de área y publicación automatizada aprobada. **MD fuera de `docs/`: solo docs, NO nuevo shell ni publicación de runtime**.
No dejar una misión en PR. No poner a JFC a hacer tareas de desarrollador. Evidencia real antes de decir «arreglado». Para detalles: [Contrato](agent-rules/OPERATING-CONTRACT.md), [Fast track](agent-rules/FAST-TRACK.md), [Casos](agent-rules/ACCEPTANCE-TESTS.md), historial archivado bajo demanda.
