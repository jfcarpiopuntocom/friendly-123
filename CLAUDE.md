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

## REGLA 2b — NO PARAR

JFC deja trabajo corriendo de noche. No detenerse a pedir permiso a mitad de
una tarea aprobada. Se para sólo si hay una contradicción real que puede
destruir datos; en ese caso se muestra y se sigue con todo lo demás.

Pushear siempre. Nunca dejar commits sin subir.

## REGLA 3 — BITÁCORA

Registrar los prompts de JFC en `PROMPTS-Y-BITACORA.md`: textuales, fechados, y
qué se hizo con cada uno. Sirve para retroceder cuando él quiera.

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
