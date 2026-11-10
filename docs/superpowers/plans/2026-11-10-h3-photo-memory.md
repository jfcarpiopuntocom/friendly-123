# H3 — fotos por hash con memoria acotada (plan técnico)

Fecha: 2026-11-10. Estado: DRAFT, NO-GO producción.

## Objetivo
Evitar materializar todo el mapa hash->dataURL en RAM mientras se siembran fotografías por Sync3. Preservar absolutamente todos los hashes, bytes, fotos huérfanas de legacy localStorage, las que solo viven en Yjs y los reenvíos entre relés.

## Fundamento comprobado
PR #659 comparó 24 fotos sintéticas (3,28 MiB). La lectura masiva dejó ~6,90 MiB de heap V8; el recorrido uno por uno, verificando 24/24, dejó ~3,62 MiB, aunque consumió 32,4 ms frente a 15,7 ms. Esto no es RSS ni una prueba física del iPhone.
En el código v706, idb-fotos.js hashesGuardados() y leerPorHash() omitían datos heredados de localStorage si IndexedDB abría. sync-yjs.js usaba leerTodosPorHash() y acumulaba los bytes de todas las fotos. Una sustitución ingenua podía perder huérfanos; la corrección debe tocar ambos módulos.

## Alternativas consideradas
A: enumerar hashes y obtener cada blob secuencialmente (seleccionada, basada en prueba y objetivos existentes); B: lotes pequeños, más rápidos pero simultáneamente retienen varias fotos; C: lectura masiva, más simple pero duplica memoria temporalmente. No hay aprobación de alterar topes de actividad Sync3.

## Interfaces
OCFotos.hashesGuardados(): Promise<string[]>: lista completa IDB+localStorage sin bytes y sin borrar evidencias.
OCFotos.leerPorHash(hash): Promise<dataURL|null>: prioriza IDB; si falta o falla, rescata bytes legacy.
API.sembrarFotos(): arma hashes de catálogo, orphan, Yjs-only, envía mismos updates deterministas por relay; no carga todos los dataURL en la ruta moderna.

## Tarea 1: lector legacy
- [x] Escribir tres pruebas RED en test/p0-h3-photo-legacy-fallback.test.cjs.
- [x] Reproducir RED en la rama de master v706.
- [x] Implementar lectura de hash y fallback legacy en docs/idb-fotos.js.
- [x] Reparar el arnés VM que había omitido incluir las funciones auxiliares nuevas.
- [x] Ver GREEN 3/3 en CI dedicada, sin borrar contenido.

## Tarea 2: siembra uno a uno
- [x] Crear prueba RED de catálogo, huérfanos y Yjs-only, que exige cero lecturas masivas y una lectura por hash en vuelo.
- [x] Reproducir RED con la siembra v706.
- [x] Modificar exclusivamente el bloque de siembra en docs/sync-yjs.js.
- [x] Obtener GREEN 1/1 y conservar v670 3/3 en CI.
- [ ] Perfilar escenarios con llamadas concurrentes, cambio de relay durante el barrido y fotos numerosas.

## Tarea 3: release y aceptación
- [ ] Verificar shell v722 / golden262 con SHA256 de idb-fotos.js, mock-backend.js, tab-session.js, sync-yjs.js y manifiesto exacto en el SHA final.
- [ ] Pasar p0-hotfix-gate, shell manifest, v670, fotos G07, ventas, dinero, PIN, stock, Sync3 y regresión completa del SHA final.
- [ ] Revisar externamente si hay revisor; no presentar autoverificación como independiente.
- [ ] Conciliar la PR #661 v707 antes de integrar H3. Las dos parten de master v706; no publicar H3 sin incorporar antes el fix de fotoHash.
- [ ] Aceptación física en el mismo SHA: Safari/PWA -> PC -> Safari/PWA, foto Bourgeois 009-BOURGEOIS, stock James Bond, Sync pending, cierres y ventas, sin reescribir datos.

## Prohibiciones y premortem
No borrar IDB, no capar ops o fotos, no detener Sync3, no cambiar dinero/ventas/PIN, no crear punteros falsos ni atribuir recuperación de la foto de Belén sin prueba en dispositivos reales. El documento de Fable contiene propuestas no autorizadas de optimismo UI, backups automáticos y cupos de sync; no implementarlas aquí.
Posibles fallos: objeto legacy omitido con IDB moderno; capa relé cambiada mientras await sigue pendiente; dos barridos concurrentes que duplican cargas; una foto PWA recuperable solo desde Yjs; materialización de fotos dentro del propio Y.Doc. Cada uno requiere diagnóstico y pruebas, no un límite destructivo.

Fuentes: https://github.com/jfcarpiopuntocom/friendly-123/pull/659 ; https://github.com/jfcarpiopuntocom/friendly-123/pull/662 ; https://app.notion.com/p/4141642b67f3814d8dc4e0e96c78a0c2.
