# Herramientas que Claude TIENE en la nube (JFC 2026-09-30)

Orden de JFC: "instala mas cosas siempre y apunta que las tienes". El contenedor es efimero:
las instala solo `.claude/hooks/session-start.sh` al abrir cada sesion (solo en la nube).
El estado de la ultima corrida queda en `~/.jfc-tools-estado.txt` (OK / FALLO por paso).
Si una herramienta falta, instalarla sin preguntar y ANOTARLA AQUI en el mismo commit.

| Para que | Herramienta | Como llega |
|---|---|---|
| Ver y convertir PowerPoint, Word, Excel a PDF | LibreOffice Impress, Writer, Calc | apt |
| PDF a imagen (revisar diapositivas) | poppler-utils (`pdftoppm`) y PyMuPDF | apt y pip |
| Video: recortar, convertir, capturar fotogramas (clips de la landing) | ffmpeg y ffprobe | apt |
| Fuentes fieles a Calibri y Cambria | fonts-crosextra-carlito y caladea | apt |
| Crear PowerPoint | pptxgenjs, react, react-icons, sharp | npm en `~/.jfc-tools` (NODE_PATH) |
| Validar workflows de GitHub Actions antes de fusionar | actionlint (paquete pip `actionlint-py`, baja el binario) | pip |
| Leer/editar Office desde Python | python-pptx, python-docx, openpyxl, markitdown, lxml, defusedxml, pillow | pip |
| Pruebas de navegador de la app | Playwright (repo) con Chromium enlazado a `/opt/pw-browsers/chromium` | npm + enlace |

## Trampas conocidas
- `npm ci` puede tardar mas de 2 min: correrlo en segundo plano.
- Playwright nuevo pide `chromium_headless_shell-<build>` que no viene: el hook lo enlaza. No correr `playwright install` (sin red).
- La nube no ve `github.io` (el proxy lo niega): verificar despliegues por la API de Actions y la rama `estable`.
- Nada de esto se instala dentro del repo publico salvo `node_modules` (ignorado por git).
- 2026-10-01: `rsync` (apt, en el hook): lo piden los scaffolds de las skills de video. Render en la nube: sin GPU,
  usar `--soft-gl` (SwiftShader) en kinetic-reel. En la laptop de JFC (AMD integrada) va por GPU.
- 2026-10-01: `laya` (pip, en el hook). RETIRADA 2026-10-07: la reemplaza gutsy.
- 2026-10-07: `gutsy` (clon en ~/gutsy, llama-cpp-python CPU, modelo Q4 529 MB desde huggingface.co), en el hook, segundo plano.
