> HISTÓRICO: JFC ya no usa Codex (2026-09-26). Se conserva solo como resumen de cambios.

# Para Codex — qué cambió en friendly-123 desde el 25-09 (hasta shell v410)

Léelo antes de tocar nada. Reglas completas en `CLAUDE.md` (secciones CANARIOS, MARCA,
LICENCIAS). Aquí va solo lo nuevo.

## 1. master YA NO llega directo a clientes (tres canales, desde v403)
- `/friendly-123/`        = rama `estable` → clientes reales.
- `/friendly-123/next/`   = rama `master`  → canario (aparatos con la licencia lord de JFC).
- `/friendly-123/previo/` = rama `previo`  → estable anterior (vuelta atrás).
- Publica GitHub Actions: `publicar.yml`, `promover.yml` (espera 33 min mirando el Sonar;
  si no hay rojo ni "Detener", mueve previo ← estable ← master), `sonar.yml` (órdenes de
  JFC cada 5 min: PUSH, REWIND, Detener/Reanudar).
- Mismo origen = mismo cuaderno para las tres versiones: todo cambio de datos debe ser
  compatible en las dos direcciones (una app vieja lee lo nuevo y viceversa).
- Tras tu merge: verificar la URL viva de `/next/`, no la raíz.

## 2. Sonar de Canarios (Worker de licencias)
- Rutas nuevas: `/canario/estado` y órdenes push/rewind; salud por lista permitida,
  rojos solo de aparatos lord; heartbeat con tope de 12 KB.
- En el panel privado de JFC: radar del Sonar arriba; lápiz junto a cada licencia para
  ponerla o cambiarla.
- Las pruebas bloquean todo navegador de test hacia los Workers de producción (una
  licencia de prueba llegó al panel). No quitar ese bloqueo.

## 3. Origen anti-copia
- `https://friendly-123.jfcarpio.workers.dev/` = Worker "friendly-123" conectado al repo;
  se despliega solo en cada merge a master.
- "Workers Builds: friendly-123" ARREGLADO el 26-09 (PR #215): las ramas fallaban porque Cloudflare
  corre `npx wrangler versions upload` sin flags y no habia config en la raiz ("Missing entry-point").
  Ahora `wrangler.jsonc` en la raiz (name friendly-123, assets ./docs). Ramas y master en verde.
  No cambiar el "name" de ese archivo.
- Respaldo manual: Worker "f123-code" (`bash scripts/deploy-f123-code.sh`). No borrar.

## 4. Revisión Linus (v405–v410), todo en producción
- v405: dos pestañas abiertas ya no pierden ventas.
- v406: permisos por rol aplicados también en el backend, no solo en la UI.
- v407: rescate automático de licencia; anular venta de empleado vuelve al
  comportamiento anterior (provisional).
- v408: aire en la UI (filas de una línea, búsqueda compacta, formulario de cliente
  plegado, ayudas repetidas solo en PC).
- v409: el aviso semanal de WhatsApp ya no tapa la barra de navegación del teléfono.
- v410: legibilidad en modo oscuro del teléfono en todas las secciones.

## 5. Otros cambios que te pueden morder
- v400: términos de EE. UU.; una venta ya no reasigna la percha antes de vender.
- v399: un comisionista elegido en una venta cobra comisión en cualquier percha.
- v401: recargar conserva sección, listas abiertas, pestaña Comisiones y scroll; el
  diagnóstico de Advanced solo en el aparato lord.
- Marca de la línea: "Made In Cuenca: intuitive business apps", exacto, solo en el pie.
  JFC es el dueño (lord), nunca "soporte".
- `npm test` ignora `backups/`.

## 6. Nube (26-09, modo híbrido)
- Claude trabaja friendly-123 también desde la nube. Cloudflare (wrangler), jfcarpio.com
  y la clave de Jev quedan SOLO en la laptop de JFC.
- `scripts/jueces.mjs` versionado; su salida `out-jueces/` no va al repo.
- Detalle: `MUDANZA-A-LA-NUBE-2026-09-26.md`.
