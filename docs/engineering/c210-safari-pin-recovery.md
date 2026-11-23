# C210 · Recuperación independiente de Safari/PWA ante shell antiguo (22-nov-2026)

## Síntomas físicos
Safari mostraba las casillas y el teclado del PIN en una sola columna; la pantalla identificó un shell instalado v0.8.90 mientras `version.json` anunciaba v0.8.91. Una actualización CSS v0.8.92 quedó inaccesible mientras el controlador antiguo conservara el shell.

## Causas verificadas
- `docs/sw.js`: los assets listados en `SHELL` se atienden cache-first cuando la ruta no tiene query. El manifiesto de versión se consulta por red, pero su disponibilidad no actualiza los bytes JS/CSS existentes.
- Los recursos esenciales del SW se precargan y verifican antes de activar otro controlador; en Safari el lote es serial por límite de memoria. Un error de instalación conserva legítimamente el controlador anterior.
- `docs/ui2.css` pre-C209: reglas generales de tarjetas invadían el teclado PIN y destruían su grid/flex.

## C210
- `docs/repair.html` es una página autónoma, intencionalmente excluida del precache, servida network-first por el SW antiguo. Comprueba primero el servidor, luego elimina exclusivamente registros y cachés friendly-123; conserva localStorage, sessionStorage, IndexedDB y cuaderno.
- El botón `#oc-purge-btn` navega a ese entrypoint, donde `?from=pin` inicia la reparación directamente sin pedir segundo clic; una única navegación regresa a un `index` fresco mediante `?_purge`.
- La nueva shell es `v0.8.93 / f123-shell-v893 / golden429`; C209 y contrato de C181 conservados.
- Test dinámico de Node VM: otros SW de mismo origen sobreviven, cachés limitadas, doble clic, offline fail-open y un solo retorno. Se retienen pruebas PIN WebKit/Chromium y recarga única. Los bundles y SHA del manifiesto se generan únicamente tras las pruebas del workflow C210.

## Criterio de cierre
Que el workflow final del HEAD pase, fusión autorizada, `estable` se promueva y `repair.html` esté disponible en Pages; la verificación física en el iPhone corresponde solo a observación real posterior. Un commit o una PR no certifica esa verificación.

## Segunda verificación
Safari puede devolver `false` si otra pestaña ya eliminó un registro o un caché; se trata como estado final válido, con test C210 específico. La salida desde el PIN usa `location.replace` para evitar volver por historial al shell antiguo. El bundle publicado de `auth-ui.min.js` y su SHA de manifiesto fueron sellados de nuevo en el HEAD anterior por la compuerta C210. La promoción de `estable` sigue sujeta a los controles requeridos del HEAD.
