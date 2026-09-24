# PLAN DE BLOQUES — handoff para cualquier modelo (JFC 2026-09-24)

Leer ANTES: CLAUDE.md (y DECISIONES-JFC.md si existe en tu checkout: hoy NO está
en el repo, está en la PC de JFC). Regla: un bloque a la vez; cada bloque =
respaldo SHA-256 -> test rojo -> fix -> verde -> check-sw -> commit+push -> URL
viva verificada. Al terminar cada bloque, marcar [x] AQUÍ y escribir 1 línea de
estado.

## Prioridades dichas por JFC (2026-09-24, en el chat, mandan sobre el orden de abajo)
1. **Commissions**: motor (Bloque 3), clawback + split (Bloque 4), la sección de
   Commissions en la app como sección MAGNÍFICA y debidamente enchufada, y
   Commissions en dashboard.html (Bloque 6).
2. **Pasar YA parte de la app a Hostinger** (Bloque P), después de Commissions.
3. Licencias/datos de clientes de licencias en el repo público: a JFC no le
   molesta que sigan ahí SIEMPRE que estén seguros o cifrados; lo que no puede
   pasar es que NOSOTROS perdamos el acceso. No borrar accesos "por seguridad".

## Estado al escribir (Opus 5.5, ampliado por Fable 5.1)
- friendly-123 live: f123-shell-v377 (Commissions caso Belén arreglado).
- website repo (C:\00 Projects\000 JFCarpio.com Website): cambios LOCALES SIN
  COMMIT en friendly123/index.html: el clip se quitó de photo-story y FALTA
  insertarlo en el hero (Bloque 1). No hacer push hasta terminarlo.
- Clip listo: friendly123/clips/clip1-split.html (Open Peeps CC0).
- Desde el contenedor de la nube NO se ve la PC de JFC ni github.io (proxy lo
  bloquea): el Bloque 1 y la "URL viva" solo se pueden cerrar desde la PC.

## Bloques
- [ ] 1. Clip 1 en el HERO de la landing (donde están el sombrero y las bolsas),
  como tarjeta superpuesta abajo del arte (NO reemplazar el arte). iframe
  loading=lazy, 1:1, max 420px; figcaption bilingüe (clave clipSplit ya en
  copy.es). Verificar móvil 375px y escritorio; publicar website (backup a
  backups/YYYY-MM-DD_HH-mm-ss antes de push). **Solo desde la PC de JFC.**
- [ ] 2. SEO con herramientas GRATIS (no pausar): Lighthouse CLI (npm i
  lighthouse local, nunca npx), PageSpeed Insights API sin key, validar JSON-LD
  (schema.org validator), revisar hreflang/alt/headings. Aplicar fixes con Jev
  como juez. Reportar puntajes antes/después.
  Medido 2026-09-24 (Lighthouse local, sirviendo docs/): SEO 100/100/100 en
  index, save, visualize. Pendiente: robots.txt, sitemap, canonical, JSON-LD;
  contraste blanco sobre verde #00c87a (2.2:1) y naranja #f97316 (2.8:1) en
  save/visualize y en li.naranja de la app: falla la regla de legibilidad.
- [x] 3. Commissions: base = margen (aprobado). ESTADO 2026-09-24 (Fable 5.1): hecho en shell v378, test/commissions-margen.test.js 6/6 rojo->verde, suite 240/240, check-sw 5/5. Falta solo verificar la URL viva desde la PC (el contenedor no llega a github.io). Campo baseComision
  "bruto"|"margen" en percha (y persona si define); default bruto; repartir()
  usa (precio-costo) si margen y costo>0, si no bruto y lo dice; guardar en
  split baseComision + montoBaseComision; corregirComisionVenta usa
  montoBaseComision si existe. Aditivo, sin schemaVersion. Sync: baseComision
  en catalogoPropio y estadoParaCheckpoint. UI: select en editor de comisión
  de percha. Tests de dinero + invariante comisión+neto=bruto.
- [x] 4. Commissions: clawback + split (aprobado). ESTADO 2026-09-24 (Fable 5.1): hecho en shell v379. test/commissions-clawback-split.test.js 6/6 rojo->verde, suite 246/246, check-sw OK. JFC retiro a Codex (2026-09-24), asi que no hubo coordinacion con CONTINUAR.md. Persona-testing Hugo/Paco/Luis NO corrido (la skill no esta en el contenedor): falta esa pasada y la URL viva desde la PC. Devolución de venta YA
  liquidada = registro NUEVO negativo en el próximo ciclo abierto (append-only,
  quién/cuándo/motivo); nunca editar lo pagado. Split por venta entre 2
  personas (vendedor+asistente), suma exacta al centavo; COUNTER SALE intacto.
  Persona-testing (Hugo/Paco/Luis) antes de publicar. Coordinar con Codex
  (CONTINUAR.md) antes de tocar mock-backend.
- [~] 5. DESIGN.md único (BORRADOR 2026-09-24, Fable 5.1: tokens inventariados de los 5 html; falta que JFC elija el look A/B/C de la seccion 0 para cerrarlo) (refs: github.com/VoltAgent/awesome-claude-design,
  github.com/nutlope/hallmark): tokens de color/tipo/espaciado/esquinas/estados
  de TODAS las htmls; reglas duras (sin gris bajo, sin opacidad en texto, 4
  esquinas, min 12-13px, azul permitido).
- [ ] 6. dashboard.html (dueños/admin): reorganización mayor con DESIGN.md;
  Commissions = feature estrella (por producto/SKU y por percha, meses,
  pendiente, pagar, recibo, tramos, ranking al fondo). Solo datos del propio
  dueño (no periscopio, no cross-tenant).
- [ ] 7. Hallmark aplicado a landing y save.html (conversión; promesa 24 h ya puesta).
- [ ] P. Protección anti-clon (JFC eligió: cargador + Hostinger, SISTEMÁTICO,
  sin riesgo). Seguir .cowork/CLAUDE OUTPUTS/PROMPT-2-MIGRACION-SEMIPUBLICA-
  2026-09-22.md por fases con canario. TRAMPA: los datos viven por ORIGEN
  (github.io); la URL de github.io debe seguir siendo la puerta. Hostinger "1
  clic": hPanel > Avanzado > GIT (conectar repo + webhook); para repo privado
  Hostinger da una deploy key que JFC pega en GitHub (único paso manual).
  Claude nunca teclea claves.

## Escala (JFC 2026-09-24: 1.000-10.000 usuarios por gremios/asociaciones, licencias bulk)
- Todo estatico (GitHub Pages hoy, Hostinger despues) + relay en Cloudflare Worker: costo marginal por usuario ~0; el dato vive en cada aparato.
- Licencia bulk = lote de codigos F123- emitido por asociacion desde el panel privado, con prefijo/etiqueta del gremio para contar y renovar en bloque. No se guarda nada de sus clientes en nuestro lado.
- Cualquier feature nueva se disena sin servidor con estado (regla vigente del relay).

## Presupuesto
- Semana al 88% (reset 2026-09-29 07:00 UTC). Extra usage apagado: solo JFC lo activa.
- Si el uso pasa 95%: parar al cerrar el bloque en curso, actualizar este archivo y avisar.
