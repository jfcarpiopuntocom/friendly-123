# CLAUDE.md — léeme entero antes de planificar o tocar código

Este archivo se carga solo en cada sesión. Es la memoria persistente de este
repo: lo crítico está aquí para no re-derivarlo (ni re-preguntarlo) cada vez.
Si un dato cambia, se actualiza aquí en el mismo commit.

---

## QUÉ ES friendly-123

- **Es el repo de TESTEO — recibe los avances PRIMERO.** Suele ir ADELANTE de
  amigable en varios sistemas. **Nunca asumir que friendly va atrás.**
- Idioma **inglés**, con `i18n.js` (EN + ES). amigable y consultorio NO tienen
  i18n (español hardcodeado) — no portar strings a ciegas entre apps.
- Unidad básica: la percha. Licencia `F123-`. PIN de 3 dígitos.
- App hermana de **amigable-123** (producción, español) y **consultorio-123**
  (4 dígitos por diseño, foco contable, sin perchas).

## PRIME DIRECTIVE — NO NUBE, NO FILTRAR DATOS DE CLIENTES

Todo vive en el dispositivo. Lo ÚNICO que sale del aparato es el heartbeat de
licencia (instanceId, licenseCode y datos que el dueño ingresó). **Jamás**
productos, ventas, clientes, inventario. No meter servicios de nube de terceros
(memoria, analítica, etc.) que manden datos afuera.

---

## POLÍTICA DE VERSIÓN (JFC 2026-09-09) — NO MOVER SIN ORDEN EXPRESA

- La **versión pública queda FIJA en `v1.0`** (`version` y `releaseName` en
  `version.json`). En el PIN se muestra **`v1.0 · shell-vNNN`**.
- **De aquí en adelante SOLO sube el ENTERO del shell** (`f123-shell-vNN`), que
  es el control de cambios real. No volver a mover `version` salvo un salto
  mayor deliberado que JFC pida.
- El badge del candado (`pintarBuildGate` en `auth-ui.js`) lee `version.json`;
  se dice **`shell-`**, nunca "build".

## CHECKLIST DE RELEASE — obligatorio en CADA cambio a un archivo del SHELL

Un archivo del SHELL es cualquiera listado en `const SHELL=[...]` de `docs/sw.js`
(index.html, auth-ui.js, mock-backend.js, etc.). Si tocas uno:

1. Sube el `const CACHE = "f123-shell-vNN"` en `docs/sw.js` al siguiente entero.
2. Sube `"shell": "f123-shell-vNN"` en `docs/version.json` al MISMO número.
3. `node scripts/gen-manifest.js` (regenera los SHA-256 del shell).
4. `bash check-sw.sh` — tiene que salir TODO OK (hashes reales cuadran,
   sw.js↔version.json coinciden, G4 nav/sección). Si falla, no se pushea.
5. Recién ahí commit + push.

Saltarse esto deja a los aparatos ya instalados con una MEZCLA de shell viejo y
nuevo (fue el bug del "Avanzado roto" / "la app corre distinto en cada aparato").

## SISTEMA DE INTEGRIDAD DE VERSIÓN (ya montado, no romper)

- `version-manifest.json`: SHA-256 por archivo del shell.
- SW: verificación SRI **fail-open** — si un hash no cuadra NUNCA borra el
  archivo; lo re-pide y conserva el servido si falla. No dejar a nadie afuera.
- `check-sw.sh`: recomputa el hash real y falla si el manifest está viejo.
- Recarga de versión: huella `version|shell`; el `_recargarSeguroVersion`
  DIFIERE la recarga al próximo login (no interrumpe el tecleo del PIN).

---

## CÓMO INVESTIGAR SIN QUEMAR TOKENS

`docs/index.html` y `docs/mock-backend.js` son enormes. **Nunca leerlos enteros.**

```bash
git log --since="7 days ago" --pretty=format:"%h %ad %s" --date=short
git show --stat <sha>
grep -n "MARCADOR" docs/index.html          # ubicar, no volcar
```

En archivos minificados (sw.js de amigable, mock-backend de amigable): editar con
scripts que verifiquen que el ancla es ÚNICA antes de reemplazar, y `node --check`
después. Nunca `sed` a ciegas en minificado.

---

## GIT — YO CIERRO EL CICLO, NADA QUEDA A MEDIAS

- Antes de ramificar: `git fetch origin master` y `git checkout -B <rama>
  origin/master` (base fresca, evita conflictos por ref vieja).
- Pushes frecuentes; cada paso verde se pushea. Nada se queda solo en el disco
  del contenedor (es efímero).
- JFC no necesita saber qué es un PR/rama/merge y no se le pregunta por eso. El
  ciclo (respaldo → commit → push → PR → mergear cuando esté verde y comprobado)
  es responsabilidad mía. Se merge cuando está verde, no antes; pero no espera su
  permiso, espera la comprobación.
- Rama por defecto: **master**.

---

## NOMENCLATURA (aplicada en las tres apps)

- **fiado** = deuda del cliente (debt). **abono** = crédito a favor (credit).
  Se quitó el confuso "on credit". El abono puede ser **"sin determinar"** (no
  atado a un producto) o por ítem.
- **Cortesía**: hay costo pero no precio (ingreso 0). **SÍ cuenta** hacia las
  100 ventas gratis del mes (espíritu Robin Hood).
- Form de comisionista: el origen "libre" se muestra como **"Promoter"**;
  pulldown Y cajita en la misma línea; botón **"Save agent"/"Guardar
  comisionista"**. (Esto reemplaza el viejo "nunca promotor/a" en apps donde ya
  se pidió el cambio — gana la instrucción más reciente de JFC.)
- Archivar un producto/evento **NO** lo saca del dashboard ni del histórico.

---

## ESTILO AL ESCRIBIR PARA JFC

- Español natural, 80% para el lego (claro, directo), 20% académico. **No usar
  "vive en"** (calco del inglés que JFC detesta).
- **Legibilidad premiada SIEMPRE**: nunca texto gris/opaco/sombreado ni muy
  pequeño en la UI. Tinta de verdad.
- Sin emojis en la UI. Comentarios en el código que expliquen POR QUÉ, con fecha
  y el bug real.
- No parar a mitad de una tarea aprobada para pedir permiso otra vez. No dejar
  commits sin pushear. No hacerle pedir la misma cosa tres veces.
