# Checklist de prevención — leer antes de tocar manual-maestro.html / index.html / manifest.json

> Origen: 5 fallas cometidas el 2026-07-21 en la misma sesión de trabajo sobre
> el manual maestro y la app. Este archivo existe para que no se repitan.
> Si en algún momento se rompe algo de esta misma clase, AGREGAR una entrada
> nueva aquí, no solo arreglar el síntoma.

## 1. Cambios de layout (flex/grid) en header o nav
Antes de commitear cualquier reestructuración de header/nav:
- [ ] Todo contenedor con texto variable tiene `min-width:0`
- [ ] Nada lleva `flex-shrink:0` salvo iconos de tamaño fijo conocido
- [ ] Todo texto largo (taglines, nombres editables) usa `white-space:normal` + `max-width`, nunca `nowrap` por defecto
- [ ] Se probó mentalmente (o en preview real) en el ancho más angosto soportado (320–375px)

## 2. Tareas de "homologar X a Y" (nombres de secciones, labels, slogans)
- [ ] Grep del término VIEJO en AMBOS lados (app `index.html` Y manual `manual-maestro.html`) en la misma pasada, antes de tocar cualquiera de los dos
- [ ] Nunca asumir que un lado ya está bien porque "es obvio" — se verifica con grep, no de memoria

## 3. Imágenes para og:image / twitter:image (previews de WhatsApp/Telegram/iMessage)
- [ ] Calcular el aspect ratio real de la imagen (Python/PIL) antes de escribir la meta tag
- [ ] Debe estar entre 1.91:1 y 1:1 — si la única imagen disponible no cumple, generar un crop dedicado (1200×630 o cuadrado), no reusar un logo horizontal ancho tal cual
- [ ] Declarar explícitamente si no se pudo verificar visualmente (ej. por caché del lado de WhatsApp) — nunca decir "arreglado" sin esa verificación

## 4. Copy visible al cliente (manual, landing, descripciones)
- [ ] Antes de cada commit que toque texto visible, grep del DIFF (no del archivo completo) contra frases prohibidas: `antes de`, `(antes "`, `se decidió`, `se llamaba`, `presented as`, `designed to`, `the reader`, `positioned`, `builds trust`, `framed`
- [ ] Ninguna nota de decisión interna, changelog o rationale de diseño va en texto que ve el cliente final

## 5. Merges grandes a main/master
- [ ] Antes de cualquier merge/fast-forward a la rama de deploy, correr `git diff --stat` contra destino
- [ ] Listar explícitamente al usuario cualquier archivo que NO sea parte de la tarea actual, ANTES de pushear (no después)
- [ ] Si hay dudas de scope, decirlo — nunca arrastrar en silencio trabajo pendiente no relacionado
