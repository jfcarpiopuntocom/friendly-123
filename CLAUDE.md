# CLAUDE.md — léeme entero antes de planificar o tocar código

Este archivo se carga solo en cada sesión. Los demás `.md` no. Por eso lo
crítico está aquí y no repartido en apuntes que nadie abre.

---

## REGLA 0 — LEER LOS APUNTES ANTES DE PLANIFICAR

**Obligatorio, antes de proponer cualquier plan o port:**

```bash
ls *.md _private/*.md 2>/dev/null          # qué apuntes hay
cat PORT-NOTES-*.md LAS-TRES-APPS-*.md DIRECCION-PRODUCTO-*.md
```

Esto NO es opcional y no se salta por ahorrar tokens. El 2026-08-18 se propuso
un plan de port que habría borrado trabajo de friendly-123 porque no se leyó
`PORT-NOTES-2026-07-21.md`, donde ya estaba escrito que friendly-123 recibe los
avances primero. Un plan hecho sin leer los apuntes es un plan que destruye
trabajo.

Si un apunte contradice lo que dice este archivo, **gana el apunte más reciente
y hay que actualizar este archivo en el mismo commit.**

---

## REGLA 1 — FOTO ANTES DE TOCAR NADA

```bash
bash .claude/snapshot.sh "antes-de-lo-que-sea"
```

Rama de respaldo fechada + tar fuera del repo (incluye lo NO rastreado, que es
justo lo que no sobrevive a un clon nuevo) + sha256 de todo .js/.html/.json/.md.
Se corre ANTES de empezar, no después. Sin excusa y sin preguntar.

## REGLA 1b — NUNCA SE PIERDE TRABAJO DE JFC

- **Jamás sobrescribir un archivo completo entre apps hermanas.** Se injerta
  cambio por cambio. Las tres apps divergieron hace rato: `cp` de una a otra
  borra trabajo.
- Antes de cualquier port: rama de respaldo fechada en el repo destino.
- Ante la duda de si algo es trabajo propio de esa app: **preguntar, no decidir.**

---

## REGLA 2 — TRABAJO LOCAL, PUSHES FRECUENTÍSIMOS

El trabajo es local. Se commitea y se pushea seguido — no un commit gigante al
final. Cada paso que queda verde se pushea. Nada se queda sólo en el disco de
un contenedor que se recicla.

## REGLA 2b — NO PARAR (texto de JFC, 2026-08-18)

> "no tengo permitido ser estupido, y debo ser util, no alucinar, no asumir, no
> parar y arruinarle su dia a JFC, no dejar sin pushear idiotamente, no dejar de
> poner el plan de trabajo siempre en el chat antes de hacer para que JFC retome
> en otra sesion o PC o incluso cuenta de Claude"

Desglosado, porque cada parte tiene su forma de fallar:

- **No parar.** En modo auto, con el plan aprobado, se sigue hasta terminar. NO
  se corta a mitad para resumir avances ni para pedir permiso otra vez. JFC deja
  esto corriendo justo para no estar pendiente de la PC.
- **El plan SIEMPRE en el chat antes de hacer.** No sólo en un `.md`. Tiene que
  poder retomar desde otra sesión, otra PC u otra cuenta de Claude leyendo el
  chat.
- **Nunca dejar sin pushear.** Cada paso que queda verde se pushea.
- **No asumir, no alucinar.** Si un dato se puede medir, se mide. Lo que no se
  comprobó se dice que no se comprobó.

JFC deja trabajo corriendo de noche. No detenerse a pedir permiso a mitad de
una tarea aprobada. Se para sólo si hay una contradicción real que puede
destruir datos; en ese caso se muestra y se sigue con todo lo demás.

Pushear siempre. Nunca dejar commits sin subir.

## REGLA 2d — YO CIERRO EL CICLO. NADA QUEDA A MEDIAS

> "no entiendo por qué he tenido que pedirte unas 80 veces que no hagas esto
> 'los 3 PR siguen en borrador esperando tu decisión' (...) yo no si quiera sé
> lo que es un PR ni debo necesitar saber" — JFC, 2026-08-18

**Nunca** dejar trabajo terminado esperando una decisión suya sobre mecánica de
git. JFC no tiene que saber qué es un PR, una rama o un merge, y no se le
pregunta. El ciclo completo es responsabilidad mía:

1. Respaldo local abundante (`snapshot.sh`: rama fechada + tar + sha256).
2. Commit y push.
3. Sacar el PR de borrador y **mergearlo** a la rama principal.
4. Verificar que quedó mergeado y que no rompió nada.

Se merge cuando está **verde y comprobado**, no antes: mergear código sin
verificar sería lo contrario de profesional. Pero el merge no espera su permiso,
espera la comprobación. Si algo no se puede mergear, se dice POR QUÉ en una
línea y se arregla — no se deja en el limbo.

## REGLA 2e — TERMINAR LA MISIÓN, NO FRENAR EN LO YA PEDIDO (JFC, 2026-08-25)

> "ya te he pedido 80 veces que dejes de detenerte en cambio en las cosas que YO
> MISMO ya pedí o aprobé. Acostúmbrate a terminar tus misiones."

Si JFC ya lo pidió o lo aprobó (incluye elegir una opción en una pregunta), **se
hace completo hasta terminar** — no se vuelve a preguntar "¿lo hago?", no se
para a mitad a pedir permiso, no se deja a medias esperando su decisión. Preguntar
es SOLO para una duda real que él no haya resuelto y que pueda destruir datos o
cambiar el modelo del producto. Lo que él NO pidió, no se implementa por
iniciativa propia (no auto-aprobarse features); lo que SÍ pidió, se termina.

## REGLA 3 — BITÁCORA

Registrar los prompts de JFC en `PROMPTS-Y-BITACORA.md`: textuales, fechados, y
qué se hizo con cada uno. Sirve para retroceder cuando él quiera.

---

## MODELO MULTI-TIENDA (2026-08-26 — cambio de modelo aprobado por JFC)

Poner una licencia = **VOLVERSE esa tienda** (switch), NO fusionar (merge). Antes
`unirse()` hacía merge y sobrescribía `f123_owned` — la app seguía mostrando la
tienda local con otro nombre y los PINs del equipo no entraban. Ahora:

- Cada licencia = una tienda aislada en localStorage. El estado se namespacea con
  un sufijo `::<licencia>` en los buffers A/B (`claveBuffer`/puntero en
  `mock-backend.js`). La tienda propia usa sufijo `""` (claves legacy → cero
  migración). **Propiedad de seguridad: sin `f123_tienda_activa`, todo es
  byte-idéntico a antes.**
- `window.OCTienda.cambiar(lic)`: flush de la tienda actual → marcador
  `f123_tienda_activa` → `location.reload()`. Registro `f123_tiendas` mapea
  licencia→sufijo para volver a cualquiera (la propia = `""`).
- `unirse()` (sync-realtime.js) llama `OCTienda.cambiar()`. El sync aterriza en
  el namespace de la tienda activa automáticamente.

**LÍMITE SIN NUBE:** el relay es zero-knowledge; no guarda el estado de ninguna
tienda. Los PINs/datos de otra tienda solo llegan si el aparato de esa tienda
está ENCENDIDO empujando su catálogo. Unirse con el otro aparato apagado = tienda
vacía (seed) hasta que sincronice. NO agregar un servidor que guarde estado —
rompería la regla sin-nube.

---

## LAS TRES APPS — qué es cada una

| | **amigable-123** | **friendly-123** | **consultorio-123** |
|---|---|---|---|
| Rol | producción, español | **repo de TESTEO — recibe los avances PRIMERO** | focus groups / market research |
| Idioma | español | inglés (`i18n.js`) | español |
| Unidad básica | la percha | la percha | el paciente |
| Licencia | `AMG-` | `F123-` | propio |
| PIN | 3 dígitos | 3 dígitos | **4 dígitos, POR DISEÑO** — no "corregir" |

**friendly-123 es el repo donde se prueban cosas avanzadas.** Suele ir ADELANTE
de amigable en algunos sistemas. Verificado el 2026-08-18: va adelante en
`crypto-store.js` (+13 KB), `mock-backend.js` (orden de sacrificio de espacio),
`avanzado-extra.js` (respaldo autoverificado), `reconciliacion.js`, y todo el
sistema `i18n.js`. **Nunca asumir que friendly va atrás.**

**consultorio-123 va a ser una app DISTINTA.** No es amigable para médicos. Su
centro es lo contable y financiero: abonos, pagos, cuentas por cobrar de
pacientes, control y visualización financiera fácil. NO portarle perchas,
variantes, comisiones a asociados, eventos ni reposición de stock — un
consultorio no tiene nada de eso. Ante la duda: **no portar todavía.**

---

## VOCABULARIO (decidido 2026-08-17, aplicado en las tres)

- **encargado/a**, nunca "empleado" — no queremos que parezca control de personal.
- **asociado/a**, nunca "promotor/a". Cuando la casa retiene %: **casa anfitriona**.
- **Bar y licores son una sola cosa.** No existe el rubro "Licores".
- El rol interno sigue siendo el string `"empleado"` en PINs, endpoints y estado
  guardado. Sólo cambió el texto visible. Renombrarlo dejaría sin acceso a todo
  dispositivo ya activado.

## COMISIONES — las dos modalidades

Misma cuenta leída al revés: la vendedora se lleva 10% y la casa retiene el
resto; el artista se lleva 85% y **le deja 15% a la casa anfitriona**. **La
misma persona puede tener las dos a la vez** en perchas distintas — por eso el %
no se guarda por persona, se suma la plata real de cada trato.

---

## CÓMO INVESTIGAR SIN QUEMAR TOKENS

`index.html` pasa de 1 MB. **Nunca leerlo entero.** Se usa:

```bash
git log --since="7 days ago" --pretty=format:"%h %ad %s" --date=short
git show --stat <sha>
comm -23 <(ls a/docs|sort) <(ls b/docs|sort)   # qué archivos faltan
grep -rl "MARCADOR" docs/                       # si un sistema está o no
stat -c%s a/docs/x.js b/docs/x.js               # quién va adelante
```

Leer código sólo cuando el plan dependa de un detalle que nada de esto contesta.

---

## ESTILO AL ESCRIBIR PARA JFC

- Español natural. **No usar "vive en"** (calco del inglés, JFC lo detesta).
- Sin emojis en la UI.
- Comentarios en el código que expliquen POR QUÉ, con la fecha y el bug real.

---

## NO DEJAR NADA COLGADO ESPERANDO PERMISO (JFC, 2026-08-26)

Prohibido cerrar un turno con "quedo listo para X apenas me confirmes / dime si
arranco". Si es trabajo que él ya pidió o aprobó, **se hace hasta terminar** y se
pushea; no se le devuelve la decisión. Preguntar es solo para una duda real que
pueda destruir datos o cambiar el modelo del producto (REGLA 2e). Él tiene
apuntes, prompts, .md y regaños de sobra: usarlos, no re-preguntar.

## SKILLS EXTERNAS APROBADAS (JFC, 2026-08-26) — pero de uso RACIONADO

JFC aprobó traer dos skills de `anthropics/skills`, PERO **queman tokens**, así
que la regla es: **sugerir su uso cada vez y esperar su OK**, o usarlas con
mucha mesura. Nunca dispararlas de oficio.

- **`verificar-ui`** (basada en `webapp-testing`, Playwright/Chromium ya
  preinstalado): abre la app y saca screenshots de las pantallas críticas
  (candado de PIN, tarjetas de Inventory, flujo "Join my team") ANTES de pushear,
  para no entregar UI rota. Es la defensa contra editar a ciegas. **Costosa en
  tokens → pedir OK antes de correrla.**
- **`reglas-friendly`** (via `skill-creator`): invariantes que toda sesión debe
  respetar — paleta EXACTA del semáforo (#00C87A/#FFC700/#F97316/#E8365D/#0A0A0F,
  base de la UX, solo sin azul); **prohibido** meter popups/banners nuevos a la UI
  del cliente en vivo; checklist de release (snapshot → guards → check-sw → bump
  de shell **Y** version → push); no sobrescribir entre apps hermanas.

Los archivos de estas skills viven en `.claude/commands/`. Crearlos no cuesta;
CORRERLOS (sobre todo verificar-ui) sí → avisar y esperar aprobación.
