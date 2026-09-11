# PLAN — 13 microerrores + microfixes (friendly), Comisiones, dashboard world-class (2026-09-11)

Revisión pedida por JFC: hasta 13 microerrores + 13 microfixes; foco en Comisiones
(Belén: "algo no está enchufado a lo correcto en la app O en el dashboard") y que
sea EDITABLE en dashboard.html; contraste del dashboard (nada de texto oscuro sobre
fondo oscuro), mejor manejo de tabs/vistas, y reportes exportables VISUALES con el
nombre del negocio + watermark diluido del slogan friendly-123 (los CSV no).

Base (world best practices, buscado): WCAG AA = 4.5:1 texto normal, 3:1 texto
grande/UI; en oscuro usar off-white (#E0E0E0–#F0F0F0), secundario ~#9AA3AE; probar
TODOS los estados (hover/focus/disabled) en el tema oscuro. Fuentes:
[DubBot dark-mode a11y](https://dubbot.com/dubblog/2023/dark-mode-a11y.html),
[BOIA](https://www.boia.org/blog/offering-a-dark-mode-doesnt-satisfy-wcag-color-contrast-requirements),
[ColorContrast dark guide](https://www.colorcontrast.org/blog/dark-mode-contrast-accessibility-guide/).

## COMISIONES (prioridad alta)
1. **[verificar+enchufar] el "not plugged" de Belén:** `filasComisiones` (dashboard)
   y `cargarComisiones` (app) leen `datos.liquidaciones`. Riesgo: un producto con
   `comisionistaId` cuya venta no genera liquidación asociada sale como
   "(no associate assigned)". FIX: auditar la cadena venta→producto.comisionistaId→
   liquidación en mock-backend; pedir a Belén el caso exacto (percha/persona) para
   reproducir y enchufar.
2. **[feature] Comisiones editable en el dashboard:** hoy es solo lectura. FIX:
   lapicito por fila con deep-link a la app (`abrirEditorComision`/
   `abrirEditorComisionista` YA existen); agregar `#editar=comision:<perchaId>` y
   `#editar=comisionista:<id>` a `procesarDeepLinkEditar` (reusar el patrón #6, sin
   editar dinero en el visor).
3. **[imprecisión] "queda en casa" cuando faltan datos:** `netoDueno` null cae a
   `ventasBrutas - comisionSocio`; si `comisionSocio` viene mal, miente. FIX: "—" si
   la liquidación está incompleta, no un 0 engañoso.

## DASHBOARD — contraste y control
4. **[contraste] texto oscuro sobre secciones oscuras:** #5A6B7A, #2C3E50, #0F1923,
   #5d4a1e como `color:` en zonas de fondo oscuro (periscopio/log). FIX: rutar por
   tokens (`--body-c`/`--ink`) o subir a off-white (#E6E8EB / #9AA3AE), auditar cada
   uno contra 4.5:1.
5. **[contraste] estados:** hover/focus/disabled de botones/tabs en el tema del
   dashboard, no solo el reposo.
6. **[UX tabs/vistas] el selector se llenó** (7 tabs): apretado, sin overflow claro.
   FIX: scroll horizontal + agrupación (Operación / Dinero / Equipo), tab activa
   marcada, recordar la última vista.
7. **[bug export] columnas de acción en CSV/Excel:** `download:false` en TODAS las
   columnas no-dato (ya en Sales; revisar el resto).

## REPORTES EXPORTABLES VISUALES (PDF), NO CSV
8. **[enchufe] nombre del negocio:** confirmar que `reporte()` mete `neg-nombre`
   real en el encabezado (no "Tu negocio"/placeholder).
9. **[branding] watermark del slogan friendly-123:** el LOGO base64 ya está embebido;
   ponerlo como marca de agua DILUIDA al fondo de los PDFs.
   `doc.setGState(new doc.GState({opacity:0.06}))` + `addImage` centrado, detrás del
   contenido; SOLO en los 3 reportes visuales (mensual, inventario valorado,
   clientes), NUNCA en CSV/Excel/JSON.
10. **[consistencia] pie de página** con fecha + "Made in Cuenca · friendly-123"
    discreto (atribución orgullosa, no intrusiva).

## MICROERRORES PENDIENTES (aprobados en repasadas previas)
11. **#8 homónimos:** "See purchases" empareja por nombre si falta `clienteId`. FIX:
    preferir SIEMPRE `clienteId`.
12. **#6 venta liquidada:** el deep-link la resalta pero no abre editor ni dice por
    qué. FIX: aviso "Esta venta está liquidada; reabre el período para corregirla".
13. **Agrupado (E/J/#3/#6):** el chip "Synchronized" refleja solo el sync viejo;
    el aviso de merge no expira; un PIN de empleado no-admin suma "éxito" al lockout
    del dashboard; la rama `#editar=producto` usa un selector que quizá no cuadra.
    FIX: chip que mire `OCYjs._diag().ws`; expirar el aviso (ts + 2 min); no contar
    éxito si al final no entra; ajustar el selector al atributo real de Inventario.

## ORDEN (riesgo/valor)
Comisiones (1→3, incluye editable) → contraste dashboard (4,5) → reportes (8,9,10)
→ tabs (6) → microbugs 7,11,12,13.

## LO QUE NO ENTRA
- CSV/Excel con watermark (solo los visuales).
- Editar dinero directo en el visor (deep-link a la app).
- Rediseño visual grande; esto es contraste + branding + enchufes.
