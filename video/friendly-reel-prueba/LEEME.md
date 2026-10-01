# Reel de prueba con el logo de friendly-123 (2026-10-01)

Version 2 (2026-10-01): colores y tipografias de friendly, solo datos verdaderos (sin QR ni cifras sin fuente), jazz swing sintetizado. Hecho con la skill **kinetic-reel** (MIT, github.com/tuzhechen2005/opus-video-skills). Texto: la frase
del PIN de friendly ("Stop guessing. Start seeing."). Logo: `docs/logo.png`. `prueba-sheet.jpg` = dos
cuadros renderizados en la nube (sin GPU, por eso la fuente condensada no cargo: la nube bloquea Google Fonts).

## En la laptop (Vivobook, Ryzen 7000, GPU AMD integrada)
Requisitos: Node 22, ffmpeg (`winget install Gyan.FFmpeg`), Google Chrome.
```powershell
cd friendly-123\video\friendly-reel-prueba
npm install
npm run sheet                       # out\check\sheet.jpg: revisar cuadros clave
node render.mjs --frames --workers=4
node render.mjs --encode --out=out\friendly-reel.mp4 --fps=30
```
En Windows `render.mjs` usa la GPU sola (`--use-angle=d3d11`). Si Chrome no esta en la ruta normal:
`--chrome="C:\Program Files\Google\Chrome\Application\chrome.exe"`.

## Pendiente
- El logo tapa la ultima letra de GUESSING en el segundo 4: mover el circulo (`cx` en `sTitle`, reel/reel.js).
- Musica: `node music/score.mjs` genera la pista; ver `.claude/skills/kinetic-reel/SKILL.md` paso 4.
