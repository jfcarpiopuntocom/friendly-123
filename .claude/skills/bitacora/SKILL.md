---
name: bitacora
description: Archiva textualmente los prompts de JFC y mantiene la continuidad entre sesiones de un proyecto. Usar al cerrar una tanda de trabajo, al notar que la sesion se alarga, cuando JFC pide "guarda mis prompts" o "haz apuntes", y al RETOMAR un proyecto para saber donde quedo todo. Tambien al detectar que se repite una correccion o una preferencia.
---

# Bitácora

Dos trabajos que suelen confundirse y no son lo mismo:

**Archivo de prompts** — lo que JFC pidió, *textual*, sin resumir. Es su
material de referencia, no mío. Un prompt resumido pierde justo lo que lo hacía
útil: el matiz, el énfasis, la frase exacta que explicaba el porqué.

**Continuidad** — dónde quedó el trabajo y qué hay que saber para retomarlo sin
volver a preguntar.

## Cuándo se dispara

- JFC dice "guarda mis prompts", "haz apuntes", "documenta"
- Al cerrar una tanda grande (varios commits, un chunk terminado)
- Cada ~72 h de trabajo en un proyecto, aunque nadie lo pida
- **Al retomar un proyecto**: leer antes de tocar nada
- Al notar una corrección repetida o una preferencia fuerte

## 1. Archivo de prompts

Ruta: `<proyecto>/_private/prompts/YYYY-MM-DD_prompts-jfc.md`
Un archivo por ventana de ~72 h. Si ya existe el del día, **anexar**, no crear otro.

```markdown
# Prompts de JFC — <proyecto> — <fecha>

## <hora> — <etiqueta corta del tema>

> (el prompt textual, completo, en blockquote)

**Qué salió de esto:** <una línea: commits, archivos, decisión tomada>
```

Reglas:

- **Textual.** No corregir ortografía, no reordenar, no "limpiar". Si JFC
  escribió en mayúsculas o repitió algo tres veces, eso *es* información sobre
  cuánto le importa.
- Un prompt largo va entero. Cortarlo por comodidad rompe el propósito del archivo.
- `_private/` para que no salga en el repo público.
- La línea "Qué salió de esto" se escribe *después* de hacer el trabajo, no antes.

## 2. Continuidad

Al cerrar una tanda, actualizar `<proyecto>/_private/ESTADO.md`:

```markdown
# Estado — <proyecto>
_Última actualización: <fecha>_

## Dónde quedó
<2-4 líneas: qué se terminó, qué quedó a medias y en qué archivo>

## Lo siguiente
<lista corta, con el porqué de cada una — sin el porqué no se puede repriorizar>

## Bloqueado
<qué está esperando algo, y esperando qué exactamente>

## Trampas conocidas
<lo que hizo perder tiempo y volvería a hacerlo: anclas frágiles, orden de
carga, herramientas que corrompen datos>
```

Va en `_private/`, no en el README: el README es para quien usa el proyecto,
esto es para quien lo continúa.

## 3. Memoria

Cuando algo trascienda la sesión, escribirlo también en
`~/.claude/projects/<slug>/memory/` con su línea en `MEMORY.md`.

Lo que merece memoria:

- Una corrección que JFC ya hizo **dos veces** — la segunda vez es la señal
- Una decisión con su razón (la decisión sin la razón se revierte sola después)
- Una trampa técnica que costó tiempo real
- Una preferencia expresada con fuerza

Lo que **no** merece memoria: lo que el repo ya cuenta (estructura, historia de
git, arreglos pasados visibles en el código). Duplicarlo ahí solo crea dos
fuentes que se contradicen con el tiempo.

Antes de escribir, revisar si ya hay un archivo que cubre el tema: **actualizar
ese**, no crear un duplicado. Dos memorias sobre lo mismo terminan
discrepando, y entonces ninguna sirve.

## 4. Al retomar

Orden de lectura, de lo más específico a lo más general:

1. `_private/ESTADO.md` — dónde quedó
2. `MEMORY.md` del proyecto — qué no se debe repetir
3. `git log --oneline -15` — qué pasó de verdad
4. `_private/prompts/` del último archivo — con qué palabras lo pidió

Recién entonces empezar. Y si `ESTADO.md` contradice al código, **gana el
código**: el archivo describe lo que era cierto cuando se escribió.

## Delegación

Redactar estos archivos es trabajo mecánico y largo: delegarlo a OmniRoute
(`bash "C:/Users/JFC/.omniroute/delegar.sh" "<prompt>"`) y revisarlo antes de
escribirlo en disco.

Excepción: **los prompts textuales nunca se delegan**. Son copia literal, no hay
nada que redactar, y pasarlos por un modelo solo abre la puerta a que vuelvan
"mejorados" — que es exactamente lo que arruinaría el archivo.
