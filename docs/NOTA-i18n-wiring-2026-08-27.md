# Nota de trabajo — i18n wiring de strings hardcodeadas (2026-08-27)

## Qué se cambió
Se reemplazaron strings hardcodeadas en inglés de la UI por claves i18n
(`window.t("clave")`), con su traducción en `DICT.en` y `DICT.es`. Se agregaron
**42 claves nuevas** (en+es balanceado, 581=581).

## Archivos tocados
- `docs/i18n.js` — 42 claves nuevas (en+es).
- `docs/geo-ping.js` — toggle y cuerpo de consentimiento del panel de
  ubicaciones; además se les dio id para que se re-pinten al cambiar de idioma.
- `docs/avanzado-extra.js` — sección "Access & recovery" (título, intro de
  correo, intro de PINs, etiquetas de roles Dueño/Empleado/Contabilidad,
  placeholder "3 dígitos", botón "Guardar nuevos PINs"); headers "Your team
  right now" y "Location comparison".
- `docs/novedades.js` — "Shift alerts", cuerpo, "No pending alerts", "Push
  these today", y las 7 etiquetas de insignias.
- `docs/backup-scheduler.js` — todo el panel de respaldo automático (título,
  cuerpo, frecuencia, etiquetas de frecuencia, enviar a correo/WhatsApp,
  guardar/respaldar ahora, nota honesta, alcance). Se agregó helper `_bkT` y
  `_freqLabel` para traducir las etiquetas cortas de frecuencia.
- `docs/sw.js` + `docs/version.json` — shell bump a `f123-shell-v120`.

## Por qué
El usuario pidió que la app sea totalmente traducible (los usuarios de habla
hispana vean español). Antes varias secciones mostraban inglés fijo.

## Cómo se verificó
- `node --check` en todos los .js modificados: OK.
- Claves en+es balanceadas (581=581) y las 42 nuevas referenciadas.
- Compuerta completa `test-todo.sh`: **TODO VERDE (7/7)**.

## Qué quedó pendiente
- Hay más strings hardcodeadas en otros módulos (p.ej. `percha-reposicion.js`,
  `backup-scheduler.js` en su parte de recordatorios/nag, `index.html` en
  algunas vistas). Este pase cubrió las más visibles; el resto puede seguir en
  otro pase.
- El módulo `backup-scheduler.js` era deliberadamente i18n-agnostic; ahora usa
  `window.t` con fallback a inglés si no hay diccionario.

## Respaldo
- Rama git: `backup/20260827-105647-antes-i18n-wiring`
- Copia: `C:\00 Projects\sandbox\_backups\friendly-123-20260827-105647-antes-i18n-wiring` (con CHECKSUMS.sha256)
