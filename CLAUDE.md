# CLAUDE.md — guía breve y vigente de friendly-123

## DIRECTIVA MÁS RECIENTE — 14 OCT 2026: DESCONFIANZA EXPRESA, NO SUPONER NI IMPONER

> **«YO NO CONFIO EN TI, NO ASUMAS NI TE ME IMPONGAS Y ANOTA ESTO EN TODO LADO».**

- **Confianza no concedida.** No esperar que JFC crea afirmaciones de arreglo, merge, publicación, pruebas, sincronía o adopción; corroborar hechos con evidencia objetiva. Identificar «confirmado», «riesgo» y «sin comprobar».
- **Manda la instrucción explícita más reciente SOBRE EL MISMO ASUNTO.** Interpretar los ejemplos como ejemplos, no excepciones; no crear políticas, topes, cuotas, versiones, prohibiciones o decisiones de producto propias ni atribuirlas al dueño.
- **Avisar antes de actuar y avanzar en misiones autorizadas.** «Avísame» no es «detente», ni «termina» significa «entrega un documento y abandona». Si surge una decisión material no delegada, consultar antes de aplicarla.
- **No convertir al propietario en programador o tester.** Resultados reales de clientes, integridad del negocio y rollback reversible antes que números vacíos de CI o jerga. Envíos o publicaciones en su nombre requieren aprobación visual cuando aplique.
- Esta auditoría documental NO autoriza tocar runtime ni versionar la app; guardar directivas no acredita que todos los agentes conectados ya las hayan leído.

**Conservar** las órdenes anteriores como contexto histórico cuando la más reciente las sustituya. Ver [Protocolo Maestro](https://app.notion.com/p/3f81642b67f3810dbe91eab83d978550) y [Skill inter-IA](https://app.notion.com/p/3f51642b67f381999e5fe5bf3fdc6193).

## MÉTODOS PERMANENTES APROBADOS — 14 OCT 2026 (JFC)
Hasta revocación expresa o una alternativa mejor APROBADA por JFC, para friendly-123:
1. **Playwright reutilizable:** usar `test/helpers/playwright-reusable.cjs` en las pruebas nuevas que requieran navegador; un proceso por motor dentro del archivo de pruebas, contexto/localStorage nuevos para cada caso, datos sintéticos y bloqueo de red de producción `test/helpers/sin-red-produccion.cjs`. No mezclar cuadernos.
2. **Pruebas focalizadas antes que suite completa:** `scripts/pruebas-del-area.cjs` selecciona tests tocados, humo fijo y regresiones por diffs de dinero/licencia/demo (incluidos archivos grandes). Mantener `release-control.yml` en paralelo, nunca sustituir invariantes financieros por un simple humo.
3. **El mismo candidato validado:** `hotfix.yml` comprueba el commit, promueve su SHA a `estable` solo después de los gates, y `publicar.yml` ensambla desde esa referencia; caché npm + caché de Playwright; una sola publicación por promoción efectiva, más comprobación postdespliegue. Sin nuevas esperas artificiales.
**Alcance exacto:** NO incluye MSW ni fast-check (propuestas 3 y 4 no aprobadas), ni migración a Vitest, ni licencia para publicar sin los gates/aprobación pertinentes, tocar runtime sin encargo, borrar datos, modificar UX o inventar números. Objetivo de 10–15 min para hotfixes pequeños, nunca promesa automática de plazo. Los cambios de infraestructura no prueban que v523 esté reparada o publicada.

**Prioridad de lectura:** [AGENTS.md](AGENTS.md) → [Contrato JFC](agent-rules/OPERATING-CONTRACT.md) → notas específicas de la tarea → [Fast track](agent-rules/FAST-TRACK.md) para publicación. La antigua CLAUDE.md íntegra está en [archivo histórico](agent-rules/archive/CLAUDE-2026-10-14.md); sus gates antiguos NO reviven por estar escritos allí.

## Reglas al hablar y actuar
**Evaluación textual de JFC:** «sueles MENTIR, y sueles IMPONERME cosas y que debo CUIDARME MUCHO DE Ti y que NO CONFIONEN TI».
**Orden textual:** «TU NO TIENES PERMISO PARA HACER NADA SIN AVISARME». Avisar ANTES de investigar/modificar/publicar y ANTES de cada shell. Decir número e impacto para sus clientes. Después ejecutar la misión autorizada, sin pedir autorización rutinaria ni detenerse. Si surge otra decisión comercial, seguridad, pago o comunicación pública, sí pedir aprobación expresa.
No imponer supuestas reglas. No llamar «publicado» al código no servido a clientes. «Funciona en web» ≠ «Belén lo recibió». Nunca entregar un comando PowerShell como sustituto de una instalación que no realizamos.

## Órdenes vigentes de JFC del 14 oct 2026 (NO son gates antiguos)
- **Cloudflare: no saturar** (textual: «estoy harto de saturar cloudflare… que no nos sature las cuentas el uso de los clientes en ninguna de mis apps»). Topes fijados por `test/cloudflare-presupuesto-v514.test.js`: tablero → version.json máx. cada 10 min de fondo; foto completa por el relay máx. cada 60 s; reintentos de ops sin confirmar 30 s duplicando hasta 10 min. Nunca polling bajo 60 s sin orden de JFC.
- **Sync instantáneo** (textual: «tan reactive como entre las subsecciones… INSTANTÁNEO»; «40ms o menos»). Esperas de publicar/aplicar en 0 ms (v517), fijadas por `test/sync-instantaneo-v516.test.js`. Medido: 8 ms por conexión directa; ~110 ms por Cloudflare desde Ecuador (piso físico).
- **Sentry al abrir cada sesión:** `search_issues` org jfcarpiocom, proyecto friendly-123, `is:unresolved` últimas 24 h; un error de cliente se arregla antes de que lo encuentre Belén.
- Prompts textuales: `_private/prompts/2026-10-14_prompts-jfc.md` (privado, con SHA256SUMS).

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
