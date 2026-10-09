#!/bin/bash
# session-start.sh — deja lista la caja de herramientas de la NUBE (JFC 2026-09-30).
#
# POR QUE EXISTE: el contenedor de la nube es efimero y nace sin varias herramientas. El
# 2026-09-30 faltaban LibreOffice Impress, pdftoppm, pptxgenjs y el navegador que pide la
# version nueva de Playwright: la suite de pruebas no arrancaba y no se podia renderizar un
# PowerPoint. JFC ordeno: "instala mas cosas siempre y apunta que las tienes". Este script
# lo hace solo, en cada sesion, y la lista viva esta en .claude/HERRAMIENTAS-NUBE.md.
#
# REGLAS DE ESTE SCRIPT (no romper):
# - Solo corre en la nube (CLAUDE_CODE_REMOTE=true). En la laptop no toca nada.
# - Idempotente: si ya esta, no reinstala. Barato en sesiones siguientes (el contenedor se cachea).
# - NUNCA falla la sesion: cada paso va aislado; un fallo se anota y se sigue.
# - Nada de esto manda datos afuera; solo baja paquetes publicos.
# - Nada se instala DENTRO del repo (salvo node_modules, que ya esta en .gitignore).
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
HERR="$HOME/.jfc-tools"
LOG="$HOME/.jfc-tools-estado.txt"
mkdir -p "$HERR"
: > "$LOG"

anota() { echo "$1" | tee -a "$LOG"; }
paso() { # paso "nombre" comando...
  local n="$1"; shift
  if "$@" >/dev/null 2>&1; then anota "OK    $n"; else anota "FALLO $n"; fi
}

# ---------- 1. Paquetes del sistema (solo los que falten) ----------
APT_PAQ="libreoffice-impress libreoffice-writer libreoffice-calc poppler-utils fonts-crosextra-carlito fonts-crosextra-caladea ffmpeg rsync"
FALTAN=""
for p in $APT_PAQ; do dpkg -s "$p" >/dev/null 2>&1 || FALTAN="$FALTAN $p"; done
if [ -n "$FALTAN" ]; then
  # Las listas del contenedor vienen viejas (404 en los .deb): update primero.
  # El PPA de ondrej responde 403 por el proxy; es inofensivo.
  apt-get update -q >/dev/null 2>&1 || true
  paso "apt:$FALTAN" apt-get install -y -q $FALTAN
else
  anota "OK    apt: ya estaba todo ($APT_PAQ)"
fi

# ---------- 2. Python: oficina, PDF y lectura de documentos ----------
PIP_PAQ="defusedxml lxml pymupdf python-pptx openpyxl python-docx pillow markitdown[pptx] actionlint-py"
paso "pip: $PIP_PAQ" pip install -q --disable-pip-version-check $PIP_PAQ

# gutsy (JFC 2026-10-07: reemplaza a Laya; sin torch). Clon en ~/gutsy, rueda CPU de llama-cpp-python
# (>=0.3.35, entiende qwen35) y modelo Q4 de 529 MB desde huggingface.co. Segundo plano: log en $HERR/gutsy-install.log.
if [ -f "$HOME/gutsy/gutsy-inference/models/gutsy-0.8b-v04-q4_k_m.gguf" ] && command -v gutsy-inference >/dev/null; then
  anota "OK    gutsy (ya estaba)"
else
  nohup bash -c 'set -e; [ -d "$HOME/gutsy" ] || git clone -q https://github.com/kouhxp/gutsy "$HOME/gutsy"
    cd "$HOME/gutsy/gutsy-inference"
    pip install -q --disable-pip-version-check "llama-cpp-python>=0.3.35" --only-binary=:all: --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
    pip install -q --disable-pip-version-check -e . huggingface_hub
    hf download kouhxp/gutsy gutsy-0.8b-v04-q4_k_m.gguf gutsy-0.8b-v04-q4_k_m.calibration.json --local-dir models
    printf %s "{\"default\":\"gutsy-0.8b-v04-q4\",\"models\":{\"gutsy-0.8b-v04-q4\":{\"gguf\":\"models/gutsy-0.8b-v04-q4_k_m.gguf\",\"calibration\":\"models/gutsy-0.8b-v04-q4_k_m.calibration.json\",\"n_ctx\":8192,\"reject_slot\":true,\"cache_tol\":0.02}},\"n_threads\":null,\"n_gpu_layers\":0,\"cache_entries\":4,\"cache_mb\":512}" > models.json' >"$HERR/gutsy-install.log" 2>&1 &
  anota "EN CURSO gutsy (segundo plano, ver $HERR/gutsy-install.log)"
fi

# ---------- 3. Node: generacion de PowerPoint fuera del repo ----------
# Aislado en ~/.jfc-tools para no ensuciar el repo publico. NODE_PATH se exporta abajo.
if [ ! -d "$HERR/node_modules/pptxgenjs" ] || [ ! -d "$HERR/node_modules/sharp" ]; then
  # package.json escrito a mano: "npm init -y" toma el nombre de la carpeta (".jfc-tools" empieza
  # con punto) y la primera instalacion en limpio fallaba en silencio (2026-09-30). Sin --silent
  # para que el error, si hay, quede en el log.
  [ -f "$HERR/package.json" ] || echo '{"name":"jfc-tools","version":"1.0.0","private":true}' > "$HERR/package.json"
  if ( cd "$HERR" && npm install --no-audit --no-fund pptxgenjs react react-dom react-icons sharp ) >"$HERR/npm-install.log" 2>&1; then
    anota "OK    npm: pptxgenjs react react-dom react-icons sharp (en $HERR)"
  else
    anota "FALLO npm: pptxgenjs react react-dom react-icons sharp (ver $HERR/npm-install.log)"
  fi
else
  anota "OK    npm: pptxgenjs y demas ya estaban en $HERR"
fi
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export NODE_PATH=\"$HERR/node_modules\${NODE_PATH:+:\$NODE_PATH}\"" >> "$CLAUDE_ENV_FILE"
fi

# ---------- 4. Repo: dependencias y navegador de pruebas ----------
if [ -f "$REPO/package.json" ]; then
  if [ ! -d "$REPO/node_modules/playwright" ]; then
    paso "repo: npm install" bash -c "cd '$REPO' && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent --no-audit --no-fund"
  else
    anota "OK    repo: node_modules ya estaba"
  fi
  # Playwright nuevo pide, segun el modo, DOS rutas con numero de build propio que el contenedor no
  # trae: el chrome completo (chromium-<build>/chrome-linux64/chrome) y el headless shell
  # (chromium_headless_shell-<build>/chrome-headless-shell-linux64/chrome-headless-shell). Las pruebas
  # corren en headless: enlazar SOLO la primera dejo la suite colgada (2026-09-30). Ambas se enlazan
  # al Chromium ya instalado (NO ejecutar "playwright install": no hay red).
  CHROMIUM="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium"
  ESPERADO="$(cd "$REPO" && node -e "try{console.log(require('playwright').chromium.executablePath())}catch(e){}" 2>/dev/null)"
  if [ -n "$ESPERADO" ] && [ -e "$CHROMIUM" ]; then
    RAIZ="$(dirname "$(dirname "$(dirname "$ESPERADO")")")"      # /opt/pw-browsers
    BUILD="$(basename "$(dirname "$(dirname "$ESPERADO")")")"    # chromium-1234
    HS="$RAIZ/${BUILD/chromium-/chromium_headless_shell-}/chrome-headless-shell-linux64/chrome-headless-shell"
    for destino in "$ESPERADO" "$HS"; do
      if [ ! -e "$destino" ]; then
        mkdir -p "$(dirname "$destino")" && ln -sf "$CHROMIUM" "$destino" \
          && touch "$(dirname "$(dirname "$destino")")/INSTALLATION_COMPLETE" 2>/dev/null
      fi
    done
    if [ -e "$ESPERADO" ] && [ -e "$HS" ]; then anota "OK    playwright: chrome y headless-shell enlazados a $CHROMIUM"
    else anota "FALLO playwright: no se pudieron enlazar las rutas esperadas"; fi
  else
    anota "FALLO playwright: sin ruta esperada o sin Chromium en $CHROMIUM"
  fi
fi

anota "-- estado guardado en $LOG; lista viva en .claude/HERRAMIENTAS-NUBE.md"
exit 0
