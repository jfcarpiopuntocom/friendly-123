# friendly-123 · v631 / golden177 · owner PIN recovery evidence

**2026-10-30.** Runtime candidato e identidad v631 se integraron en `master` por el [PR #487](https://github.com/jfcarpiopuntocom/friendly-123/pull/487) (`b13561a05204ae64bf139f398f76c5b7ede377f0`).

## Verificaciones independientes

- [Suite focal 12/12](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41072497200): rotaciones, PIN retirados, reinicios, misma licencia, protección ante rotación concurrente y roles Staff/Accounting.
- [Browser WebKit 1/1](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41073016285): editor Owner real y sala recuperada.
- [Identidad y hashes](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41072879481): 31 capacidades protegidas, 120 rutas en el manifest, `check-sw.sh` OK.
- SHA-256 exacto: `crypto-store.js = 59c4fcb8a336c31578c7cfba65e6f9644cbed2eb94cf3c2d64723e03c5b8d5b2`; `sync-yjs.js = 0b9aa38879ee9d47fa5e7174f0840f864c41526a1a125fb022ea2d737aee692a`.
- Conteos `wc -l`: 1097 líneas de `crypto-store.js`, 2695 de `sync-yjs.js`, 120 de la prueba nueva.
- [Primer intento de hotfix](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41073214765) bloqueado por `stable-review-integrity.test.js`: esperaba siete llamadas al drain, pero `docs/mock-backend.js` tiene ocho desde v630. Ambos SHAs comparados: mismo blob `26da7ebcd42d894fb1e7eb82bc71fe158d6bb768`. La octava ruta es `/api/productos/:id/ajustar`. Se corrige solamente la expectativa antigua de 7 a 8, manteniendo la aserción exacta.

## Límites y operación

No se han modificado ni sustituido inventarios reales, fotos, recibos o PINs de clientes. La igualdad física PC–celular sigue pendiente de comparar dos exportaciones independientes por producto/época/testigo PN/movimiento. La regresión integral histórica ya estaba roja en v630 (2222 PASS / 45 FAIL / 7 canceladas / 4 omitidas). El gate focal y la publicación deben comprobarse sobre el SHA exacto promocionado; este documento no certifica por sí mismo el despliegue ni la paridad real.
