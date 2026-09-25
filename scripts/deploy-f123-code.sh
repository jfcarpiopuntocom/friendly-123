#!/usr/bin/env bash
# deploy-f123-code.sh — publica docs/ de origin/master en el Worker "f123-code"
# (origen de codigo del cargador anti-copia, Bloque P fase B). JFC 2026-09-25.
#
# POR QUE ESTE SCRIPT EXISTE (bug real 2026-09-25): en este checkout de Windows
# core.autocrlf=true. Un worktree o un "git archive" normal sale en CRLF, y
# Cloudflare servia edutips.js con 264 CRLF mientras github.io lo sirve en LF:
# bytes distintos a los del version-manifest.json. Aqui se exporta el BLOB de
# git con autocrlf=false (LF, identico a github.io) y se verifica ANTES y
# DESPUES de desplegar. Si algo no cuadra, sale con error y no se da por hecho.
#
# Que NO hace: no toca el repo, no crea ni borra Workers, no cambia la meta
# oc-origen-codigo (fase E, solo con orden expresa de JFC).
# Uso (desde la raiz del repo):  bash scripts/deploy-f123-code.sh
set -euo pipefail

WRANGLER="C:/00 Projects/Codex-Friendly-20260917/commissions-product-first-v370/node_modules/wrangler/bin/wrangler.js"
ORIGEN="https://f123-code.jfcarpio.workers.dev"
PUERTA="https://jfcarpiopuntocom.github.io/friendly-123"
# Los archivos de la lista del cargador + los que dan la version. Al sumar
# scripts al cargador (fase D), sumarlos aqui tambien.
CONTROL="edutips.js workshop-brand.js inspector.js inspector-ui.js cargador.js version.json version-manifest.json"

git fetch -q origin master
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -c core.autocrlf=false archive origin/master docs | tar -x -C "$TMP"

# 1) Antes de subir: ni un solo CRLF en archivos de texto.
python - "$TMP/docs" <<'PY'
import os, sys
malos = []
for r, _, fs in os.walk(sys.argv[1]):
    for x in fs:
        if x.endswith(('.js', '.html', '.json', '.css', '.txt', '.xml', '.webmanifest')) or x == '_headers':
            if b'\r\n' in open(os.path.join(r, x), 'rb').read():
                malos.append(x)
if malos:
    sys.exit('CRLF en: ' + ', '.join(malos))
print('export LF ok')
PY

(cd "$TMP" && node "$WRANGLER" deploy --assets=./docs --name f123-code --compatibility-date 2025-09-27)

# 2) Despues: lo que sirve Cloudflare == lo que sirve github.io, byte a byte.
#    (github.io puede tardar ~1 min en publicar un push reciente: si falla
#    justo despues de un merge, esperar y volver a correr.)
fallos=0
for f in $CONTROL; do
  a=$(curl -s "$PUERTA/$f?z=$RANDOM" | sha256sum | cut -d' ' -f1)
  b=$(curl -s "$ORIGEN/$f?z=$RANDOM" | sha256sum | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then echo "IGUAL    $f"; else echo "DISTINTO $f"; fallos=$((fallos+1)); fi
done
# CORS: sin esta cabecera el cargador cae a github.io en todos los aparatos.
curl -sI -H "Origin: https://jfcarpiopuntocom.github.io" "$ORIGEN/edutips.js" \
  | grep -qi "access-control-allow-origin: https://jfcarpiopuntocom.github.io" \
  && echo "CORS ok" || { echo "CORS FALTA"; fallos=$((fallos+1)); }
[ "$fallos" -eq 0 ] && echo "f123-code OK: $ORIGEN" || { echo "f123-code con $fallos fallos"; exit 1; }
