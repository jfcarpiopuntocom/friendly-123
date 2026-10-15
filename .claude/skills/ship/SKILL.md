---

## DIRECTIVA MÁS RECIENTE — 14 OCT 2026: DESCONFIANZA EXPRESA, NO SUPONER NI IMPONER

> **«YO NO CONFIO EN TI, NO ASUMAS NI TE ME IMPONGAS Y ANOTA ESTO EN TODO LADO».**

- **Confianza no concedida.** No esperar que JFC crea afirmaciones de arreglo, merge, publicación, pruebas, sincronía o adopción; corroborar hechos con evidencia objetiva. Identificar «confirmado», «riesgo» y «sin comprobar».
- **Manda la instrucción explícita más reciente SOBRE EL MISMO ASUNTO.** Interpretar los ejemplos como ejemplos, no excepciones; no crear políticas, topes, cuotas, versiones, prohibiciones o decisiones de producto propias ni atribuirlas al dueño.
- **Avisar antes de actuar y avanzar en misiones autorizadas.** «Avísame» no es «detente», ni «termina» significa «entrega un documento y abandona». Si surge una decisión material no delegada, consultar antes de aplicarla.
- **No convertir al propietario en programador o tester.** Resultados reales de clientes, integridad del negocio y rollback reversible antes que números vacíos de CI o jerga. Envíos o publicaciones en su nombre requieren aprobación visual cuando aplique.
- Esta auditoría documental NO autoriza tocar runtime ni versionar la app; guardar directivas no acredita que todos los agentes conectados ya las hayan leído.

**Conservar** las órdenes anteriores como contexto histórico cuando la más reciente las sustituya. Ver [Protocolo Maestro](https://app.notion.com/p/3f81642b67f3810dbe91eab83d978550) y [Skill inter-IA](https://app.notion.com/p/3f51642b67f381999e5fe5bf3fdc6193).

name: ship
description: Publicar reparaciones autorizadas de friendly-123 con aviso, pruebas focalizadas y verificación.
---

## MÉTODOS PERMANENTES APROBADOS — 14 OCT 2026 (JFC)
Hasta revocación expresa o una alternativa mejor APROBADA por JFC, para friendly-123:
1. **Playwright reutilizable:** usar `test/helpers/playwright-reusable.cjs` en las pruebas nuevas que requieran navegador; un proceso por motor dentro del archivo de pruebas, contexto/localStorage nuevos para cada caso, datos sintéticos y bloqueo de red de producción `test/helpers/sin-red-produccion.cjs`. No mezclar cuadernos.
2. **Pruebas focalizadas antes que suite completa:** `scripts/pruebas-del-area.cjs` selecciona tests tocados, humo fijo y regresiones por diffs de dinero/licencia/demo (incluidos archivos grandes). Mantener `release-control.yml` en paralelo, nunca sustituir invariantes financieros por un simple humo.
3. **El mismo candidato validado:** `hotfix.yml` comprueba el commit, promueve su SHA a `estable` solo después de los gates, y `publicar.yml` ensambla desde esa referencia; caché npm + caché de Playwright; una sola publicación por promoción efectiva, más comprobación postdespliegue. Sin nuevas esperas artificiales.
**Alcance exacto:** NO incluye MSW ni fast-check (propuestas 3 y 4 no aprobadas), ni migración a Vitest, ni licencia para publicar sin los gates/aprobación pertinentes, tocar runtime sin encargo, borrar datos, modificar UX o inventar números. Objetivo de 10–15 min para hotfixes pequeños, nunca promesa automática de plazo. Los cambios de infraestructura no prueban que v523 esté reparada o publicada.

# ship — ejecución responsable del fast track JFC
Antes de trabajar: leer AGENTS.md, CLAUDE.md, agent-rules/OPERATING-CONTRACT.md y agent-rules/FAST-TRACK.md.
1. AVISAR a JFC ANTES de actuar. Si se necesita otro shell, avisar número, causa e impacto ANTES de crearlo/publicarlo; la misión ya aprobada continúa tras informar sin nuevas preguntas.
2. Pre-mortem → árbol de problemas → PERT breves. Definir lo que el cliente realmente debe poder hacer. Reproducir problema y proteger copia/rollback.
3. Cambio focalizado compatible; preservar negocio real, fotos, pagos, deudas, comisiones, sync y permisos. No inventar ceros ni borrar historia; no modificar otro producto por asociación.
4. Pruebas rojo-verde y dependencias directas; no inflar recuentos, no ejecutar tests lentos o verificadores prohibidos para JFC, no relajar un guard real para que pase.
5. Si tocó runtime docs/: shell/manifest/SW coherentes; usar fast track actual sin esperas de 33 minutos ni workflows repetidos. Si se precisa nuevo shell, avisar antes.
6. Comprobar publicación en URL y comportamiento específico; PR o merge no prueban adopción por el aparato de Belén.
7. Comunicar «qué puede hacer ya el cliente, enlace, limitación», sin jerga como titular ni pasar PowerShell/merge al propietario.
**Solo archivos .md fuera de docs/**: sin shell, sin publicación ni pruebas del runtime; revisar coherencia, enlaces y lectura final.
**Advertencia expresa de JFC**: «sueles MENTIR, y sueles IMPONERME cosas y que debo CUIDARME MUCHO DE Ti y que NO CONFIONEN TI». Se responde con hechos verificables.
