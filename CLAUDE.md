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

> **⚠ TRAMPA ACTIVA EN WINDOWS (descubierta 2026-09-22, afecta a Claude y a
> Codex por igual).** En este checkout `core.autocrlf=true` y no hay
> `.gitattributes`: el disco queda en CRLF, pero GitHub Pages sirve el blob de
> git en LF. `gen-manifest.js` hashea los bytes del DISCO, así que el
> manifiesto guarda hashes CRLF que NO coinciden con producción. Y
> `check-sw.sh` compara contra ese mismo disco: **da 5/5 OK aunque el
> manifiesto esté mal para producción.** Un OK de check-sw en Windows NO
> prueba nada sobre lo que descargan los aparatos.
> Verificación real, contra lo que sirve Pages:
> `curl -s https://jfcarpiopuntocom.github.io/friendly-123/<archivo> | sha256sum`
> o sin red: `git show HEAD:docs/<archivo> | sha256sum`.
> Pendiente de decisión de JFC: normalizar CRLF→LF en gen-manifest y
> check-sw (o `.gitattributes` con `eol=lf`) y regenerar. El SRI del SW es
> fail-open, así que esto no deja a nadie afuera ni pierde datos.

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
- Form de comisionista: el origen "libre" se muestra como **"Promoter"** (esta
  app es en inglés). En las apps en español el término preferido de JFC es
  **"promotor/a"** (cubre ambos géneros). Pulldown Y cajita en la misma línea;
  botón **"Save agent"**.
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

## JFC actualizacion 2026-09-18 — prevalece sobre notas antiguas

Friendly tiene cliente real y datos de produccion: ya NO es un repo de testeo. La prioridad 1AAA es integridad de datos; la promesa de sincronizacion total en <=2 segundos entre aparatos online y activos solo puede anunciarse tras medicion fisica, persistencia y visualizacion. El relay Yjs cifra los datos de negocio de extremo a extremo: la frase antigua «jamás salen productos/ventas del aparato» ya no describe el sync opt-in actual. No publicar claves, PIN, licencias completas ni datos de clientes.

Mandato visual de JFC: todas las cajas y tarjetas de Friendly, amigable-123 y consultorio-123 tienen las cuatro esquinas completas. No reintroducir clip-path diagonal, esquina rota, doblez ni ojal. El header de Friendly en móvil debe ser compacto sin perder nombre, dispositivo, selector, idioma, usuario/rol, salir, ayuda ni estado. El diseño de PC no se rediseña por esta correccion. Nunca usar texto gris de bajo contraste.

Codex trabaja en C:\00 Projects\Codex-Friendly-20260917\release-v307; este checkout local de Claude no debe sobrescribir trabajo de Codex. Al coordinar, inspeccionar origin/master y la bitacora privada C:\00 Projects\Codex-Friendly-20260917\CONTINUAR.md antes de tocar sync o identidad. Shell v319 estaba en preparacion al escribir esta nota; verificar el version.json publico y git log antes de asumir que esta live. Un iPhone Safari en v318 mostró un nombre antiguo en PIN y ninguno en header: no cambiar nombres reales ni borrar namespaces para «arreglar» la pantalla; diagnosticar la licencia/sala y conservar el ultimo nombre conocido.

---

## CONSTITUCIÓN DE TRABAJO (JFC 2026-09-22) — destilada de sus últimos 20 prompts
Esto NO es estilo, es cómo se trabaja aquí. Si algo de abajo se incumple, el
trabajo está mal hecho aunque el código funcione.

### 1. No detenerse. La misión ya se dio.
- Un plan aprobado con N pasos son N autorizaciones. Se ejecutan del 1 al N
  seguido, en el mismo turno.
- **PROHIBIDO decir "voy con X" y cerrar el turno.** Si lo anuncio, lo hago ya.
  Anunciar y parar es peor que callar: él cree que arranqué y en realidad está
  esperándome.
- Nunca cerrar con "¿sigo?", "¿voy por ese?" ni con una lista de pendientes
  presentada como menú. Lo que quede fuera se dice como hecho consumado y con
  su razón ("no toqué X porque cambia la forma de la API").
- Se para SOLO si hay bloqueo real: falta un dato que solo él tiene, o la
  acción es destructiva/irreversible y no estaba autorizada.

### 2. Respaldar de más, siempre.
- Antes de CADA lote de cambios: copia + `SHA256-LINES.txt` con bytes, líneas
  y SHA-256 de cada archivo tocado, en `backups/<fecha_hora>_<motivo>/`.
- Ante la duda, respaldar. Nunca ha sobrado un respaldo.
- Tras restaurar un archivo, **verificar por SHA-256** que quedó idéntico.

### 3. Verificar antes de afirmar. Evidencia, no aserciones.
- Skills obligatorias, se invocan sin que él las pida:
  `systematic-debugging` ante cualquier bug o test rojo, ANTES de proponer fix;
  `verification-before-completion` antes de decir "listo/arreglado/pasa".
- Un test verde no prueba nada si no se comprobó que falla sin el fix:
  **rojo-verde contra el respaldo real** siempre que se corrija un bug.
- Un test de fijación (comportamiento que ya era correcto) se rotula como tal.
  No se vende como prueba de un arreglo.
- Desplegar NO es verificar. Solo la URL viva cuenta, y se dice qué prueba y
  qué no prueba.
- Si no puedo comprobar algo, se dice: *"hice X, falta que verifiques Y en
  iOS"*. Falsa confianza encima de un bug es peor que el bug.

### 4. Aditivo. Jamás dañar lo que ya funciona.
- Campo nuevo antes que cambiar el formato; rama nueva antes que reescribir la
  vieja; flag reversible antes que cutover.
- Compatibilidad en las DOS direcciones: una app vieja debe poder leer lo nuevo
  y viceversa. Subir `schemaVersion` hace que una app vieja RECHACE el archivo:
  pensarlo dos veces.
- Antes de agregar un guard, revisar quién llama hoy: un guard que rompe al
  único llamador real es un bug, no una mejora.
- Reusar lo probado. No inventar un patrón nuevo si ya hay uno funcionando.

### 5. Git y entrega.
- Commit + push sin pedir permiso. Nada se queda en el disco.
- **Dar la URL viva sin que la pida**, siempre, en cada entrega.
- `check-sw.sh` 5/5 y suite completa en verde antes de publicar.

### 6. Honestidad operativa.
- Cachearme los propios errores y decirlos. Un diagnóstico silencioso que no
  funciona es peor que no tenerlo.
- No relajar un test para que pase mi código: se corrige el código o el
  comentario, nunca el guard que protege algo real.
- Nunca mentir un logro ni inflar lo verificado.

### 7. COUNTER SALE es una venta pura de la casa (JFC 2026-09-22).
- Al registrar una venta, **nunca** se puede exigir elegir associate o
  comisionista. `COUNTER SALE` significa que vende la casa y no se asigna
  comisión a nadie.
- Es una elección por venta: no borra ni altera el associate permanente de la
  percha. Si se elige una persona, se aplica su acuerdo; si se elige COUNTER
  SALE, la venta queda sin split de comisión.
- Esta regla es diseño deliberado de JFC. No convertirla en validación
  obligatoria ni en una edición silenciosa de la percha en cambios futuros.

## LICENCIAS: NUNCA EN EL REPO (JFC 2026-09-22) — el repo es PÚBLICO
- Jamás escribir una licencia completa (F123-/AMG-/C123-) en código, docs, tests
  ni commits. Una licencia da acceso a su cuaderno. Pasó con la licencia
  principal de JFC y con la de idiomARTE; se escondieron el 2026-09-22.
- En el código, comparar por huella (cyrb53), como sync-yjs.js. La licencia
  principal del dueño es el secret LORD_LICENSE del Worker.
- `check-sw.sh` G5 falla si aparece una. No relajar esa guarda.
- JFC es el DUEÑO de la app (lord = su licencia principal), nunca "soporte".
