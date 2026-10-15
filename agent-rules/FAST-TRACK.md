# FAST TRACK VIGENTE — friendly-123 (14/oct/2026)
**Regla:** avisar antes de actuar y antes de cualquier shell nuevo; dentro del encargo aprobado, avanzar sin volver a pedir permiso. Este documento NO autoriza un producto diferente.

## MÉTODOS PERMANENTES APROBADOS — 14 OCT 2026 (JFC)
Hasta revocación expresa o una alternativa mejor APROBADA por JFC, para friendly-123:
1. **Playwright reutilizable:** usar `test/helpers/playwright-reusable.cjs` en las pruebas nuevas que requieran navegador; un proceso por motor dentro del archivo de pruebas, contexto/localStorage nuevos para cada caso, datos sintéticos y bloqueo de red de producción `test/helpers/sin-red-produccion.cjs`. No mezclar cuadernos.
2. **Pruebas focalizadas antes que suite completa:** `scripts/pruebas-del-area.cjs` selecciona tests tocados, humo fijo y regresiones por diffs de dinero/licencia/demo (incluidos archivos grandes). Mantener `release-control.yml` en paralelo, nunca sustituir invariantes financieros por un simple humo.
3. **El mismo candidato validado:** `hotfix.yml` comprueba el commit, promueve su SHA a `estable` solo después de los gates, y `publicar.yml` ensambla desde esa referencia; caché npm + caché de Playwright; una sola publicación por promoción efectiva, más comprobación postdespliegue. Sin nuevas esperas artificiales.
**Alcance exacto:** NO incluye MSW ni fast-check (propuestas 3 y 4 no aprobadas), ni migración a Vitest, ni licencia para publicar sin los gates/aprobación pertinentes, tocar runtime sin encargo, borrar datos, modificar UX o inventar números. Objetivo de 10–15 min para hotfixes pequeños, nunca promesa automática de plazo. Los cambios de infraestructura no prueban que v523 esté reparada o publicada.

## Clasificación que evita cambios innecesarios
- **Solo Markdown fuera de docs/**: editar, revisar consistencia/enlaces y comprobar lo guardado. **No crear shell, actualizar SW, despliegue ni pruebas del runtime.**
- **Cambio en docs/** (aplicación, dashboard): versión de shell única, manifest coherente con bytes publicados, prueba focalizada y publicación por mecanismo actual.
- **Dinero, stock, fotos, sync o permisos:** pruebas de idempotencia, compatibilidad, concurrencia, recuperación y conservación de historia, además de comprobación focalizada. Datos reales fuera de pruebas.
- **Cambio irreversible, proveedor, precio, mensaje público, datos reales o alcance nuevo:** aprobación expresa específica.

## Ruta sin esperas artificiales
1. Aviso de qué se hará. Pre-mortem → árbol de problemas → PERT breves.
2. Definir aceptación vista por el cliente. Leer fuente del fallo, estado actual y versiones; comprobar respaldos y rollback.
3. Corregir causa raíz con cambio mínimo y preservación de contratos. Test rojo-verde y dependencias directas; no inflar cifras de pruebas.
4. Avisar el número de shell **ANTES** de crearlo o publicarlo, especialmente si difiere del anunciado a clientes.
5. Si cambia docs/, coherencia de CACHE, shell, releaseName, cacheGeneration, manifest SHA-256 y diferencias CRLF/LF; verificación de manifest. No ejecutar el verificador prohibido por JFC.
6. El flujo vigente es `.github/workflows/hotfix.yml`: cambios a docs/ en master, identidad y tests del área, promoción a estable y publicar. La suite completa `release-control.yml` funciona en paralelo y **no es puerta de 33 minutos**. No reactivar `promover.yml`, canario obligatorio ni espera histórica. Evitar repeticiones de Actions y saturar Cloudflare.
7. Si una prueba falla, leer línea/causa; reparar y repetir la comprobación pertinente, sin mentir ni relajar guardas. Si surge shell adicional, avisar antes de hacerlo.
8. Confirmar origen vivo https://friendly123.com/app/version.json y https://friendly123.com/app/ . Publicación observada NO prueba que el aparato de Belén haya adoptado la actualización.

## No cambiar
Sin purga, sin ocultar fotos ni stock por snapshots legados, sin duplicar fiado ni pagos, sin ceros ficticios, sin demo en cuadernos reales, sin pérdida de permisos, sin mover Cloudflare o el sitio de JFC de su origen.
Respetar arquitectura `ARCHITECTURE-HEXAGONAL.md`, producto EN/ES, caja completa y legibilidad.
La licencia/clave de un cliente no se registra en repo, test, Notion ni telemetría.

## Entrega en castellano comprensible
«Ya puede [hacer X] en [enlace]», solo si efectivamente se verificó; o «el cambio está preparado, falta publicación» si no. Añadir limitación concreta y enlace técnico secundario. No delegar el trabajo técnico en JFC.
