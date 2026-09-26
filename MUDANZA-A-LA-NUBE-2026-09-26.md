# MUDANZA A LA NUBE (JFC 2026-09-26) — léeme entero antes de tocar nada

JFC trabaja ahora desde la app de Claude en su iPhone (5G), sin depender de la laptop
ni del wifi de la casa. Esta sesión corre en la nube, sobre Linux, con este repo.
Leer en este orden: `CLAUDE.md` → `DECISIONES-JFC.md` → este archivo → las últimas
secciones de `NOTAS-PARA-OPUS-5.5-2026-09-24.md`.

## Qué NO existe en la nube (y qué hacer en su lugar)
- **OmniRoute** (`localhost:20128`): no existe. El trabajo pesado se hace aquí mismo; decirle
  a JFC en una línea cuando algo se habría delegado.
- **Jev** (skill `jev-jfc`) y la compactación con Jev: solo si el entorno de la nube tiene la
  variable `AI_GATEWAY_API_KEY`. Si no está, decide Claude y se compacta de forma normal.
- **wrangler con sesión de Cloudflare**: vive en la laptop. Desde aquí NO se despliega el
  Worker de licencias, ni f123-code, ni jfcarpio.com. El Worker `friendly-123` (origen
  anti-copia) SÍ se despliega solo con cada merge a master (build de Cloudflare conectado al repo).
- **Memoria de la laptop** (`~/.claude/.../memory`, CLAUDE.md global, carpeta `.cowork`) y la
  bitácora privada de Codex (`CONTINUAR.md`): no están. Las reglas que importan están abajo,
  en `CLAUDE.md` y en `DECISIONES-JFC.md`.
- **Otros repos** (amigable-123, consultorio-123, website de jfcarpio.com): no están en esta
  sesión. Lo de jfcarpio.com necesita la laptop o una sesión propia en la nube sobre ese repo.
- **Ventaja**: aquí no existe la trampa CRLF de Windows. `gen-manifest.js` hashea LF, igual que
  Pages. Aun así, verificar siempre contra la URL viva.

## Reglas globales de JFC que en la laptop venían del CLAUDE.md global
- Texto: nunca gris, opaco ni chico. Mínimo 12px en etiquetas y 16px en el cuerpo. Nada de
  `opacity` ni `rgba()` en texto. Terciario no más oscuro que #999. Contraste real ≥ 4.5.
  Hoy hay una prueba que lo exige en cada sección: `test/linus-movil-oscuro.test.js`.
- iOS/WhatsApp en modo oscuro: `color` y `-webkit-text-fill-color` con `!important`, bloque
  `@media (prefers-color-scheme: dark)`. Si no se puede comprobar en el iPhone, decir
  "hice X, falta que verifiques Y en iOS". Nunca decir "arreglado" sin evidencia.
- Mobile-first, targets de 44px, `prefers-reduced-motion`, contenido visible sin JS.
- Español de Ecuador, claro, sin voseo ni registro argentino, sin "vive en", sin relleno ni
  sycophancy. Sin rayas (—) como conector. No mentir logros.
- Preguntas con opciones (AskUserQuestion) cuando la respuesta de JFC cambia el trabajo.
  Tiers, acceso y features son DECISIÓN DE JFC: no diseñar por él.
- Respaldo antes de cada lote: `backups/<fecha_hora>_<motivo>/` con `SHA256-LINES.txt`.
  Rojo-verde contra el respaldo en cada bug. Las pruebas de fijación se rotulan como tales.
- Commit + push + PR + merge sin pedir permiso cuando está verde. Dar SIEMPRE la URL viva.
- Nunca una licencia completa (F123-/AMG-/C123-) en el repo, que es público. Guarda G5.
- Comentarios copiosos en el código (por qué, fecha, bug real); nada de estrategia en textos
  que ve el usuario.

## Estado al mudarse (2026-09-26 ~03:00 Ecuador)
- master = shell **v410**. `/next/` (canario) = v410. Raíz (clientes) = v410, promovida
  por `promover.yml`. Verificar con:
  `curl -s https://jfcarpiopuntocom.github.io/friendly-123/version.json` y `/next/version.json`.
- Revisión Linus CERRADA, 5 de 5 bloques (detalle en NOTAS, sección 2026-09-26 02:15).
- Pruebas inestables conocidas (timeouts de Chromium de 30 s con toda la suite cargada; pasan
  aisladas): `canarios-app` "salud", `ui-integrity-v341` v359. No son regresión.
- `scripts/jueces.mjs`: jueces externos del Sonar (axe-core, capturas, "aire", Lighthouse).
  Se versiona en la mudanza. Su salida `out-jueces/` NO va al repo (se regenera).

## PRIORIDAD 1 — el build del Worker `friendly-123` falla en cada PR
El check "Workers Builds: friendly-123" sale en rojo desde el PR #201 como mínimo. Ese Worker
es el ORIGEN anti-copia (`https://friendly-123.jfcarpio.workers.dev/`) y se despliega solo en
cada merge a master. Si el build falla, el origen se queda con un shell viejo. Los clientes no
dependen de él (la fase C es solo en un aparato de JFC y el cargador cae a github.io si el
shell difiere), pero Advanced diría "shell differs". Pasos:
1. `curl -s https://friendly-123.jfcarpio.workers.dev/version.json`: ¿qué shell sirve?
2. Buscar la configuración del build en el repo (`wrangler.toml`/`wrangler.jsonc`, carpeta
   del Worker) y reproducir el build con `npx wrangler deploy --dry-run` en Linux.
3. Arreglar en el repo; el log exacto está en el panel de Cloudflare (solo JFC lo ve). Si hace
   falta el log, pedirle a JFC que copie el error (1 paso, desde el iPhone).
Ojo: en la sesión anterior se le dijo a JFC que ese check "no publica esta app". Fue un error:
sí publica el origen anti-copia. Ya se le corrigió.

## PENDIENTE para declarar v1.0 (en este orden)
1. Prioridad 1 de arriba.
2. JFC prueba v410 en su iPhone en modo oscuro (legibilidad, header compacto, aviso de
   WhatsApp encima de la barra en Advanced).
3. Lapicito para editar los incidentes que llevan a la lista negra + botón directo de lista
   negra en Clientes. Punto de partida: `docs/index.html` ~3475 (hora del incidente) y ~8669
   (`horaIncidente` en la calificación). Antes de construir: AskUserQuestion con qué se
   puede editar (fecha, hora, nota, quién) y quién puede hacerlo (roles).
4. Los 2 clips del hero de la landing (DECISIONES "Clips de la landing": HTML5/JS, 3 a 7 s,
   una usuaria y un usuario, UNO A LA VEZ para medir tokens). La landing vive en el repo del
   website, no aquí: confirmar con JFC dónde se trabaja.
5. Documento corto para Codex con lo que cambió desde el 25-09 (canales, Sonar, rutas del
   Worker, revisión Linus v405-v410). Codex publica en master, y master es el canario.
6. Tag `v1.0` en git, notas de versión cortas EN y ES, una línea en DECISIONES y en NOTAS.
   La versión pública ya dice v1.0: declarar es sellarla, no subir el número.

## Pendientes que NO se pueden hacer desde la nube (quedan para la laptop)
- jfcarpio.com: archivos internos expuestos (/CLAUDE.md, /wrangler.toml, etc.) y 5 URLs SEO
  con error 1101. Necesita `.assetsignore` y un deploy limpio con wrangler (NOTAS, "URGENTE 1 y 2").
- Deploy del Worker de licencias y de f123-code (`scripts/deploy-f123-code.sh`).
