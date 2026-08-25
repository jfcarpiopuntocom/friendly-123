#!/usr/bin/env bash
# deploy.sh — despliega el relay de sync en TU cuenta de Cloudflare (macOS/Linux
# o Git Bash en Windows). Equivalente a deploy.ps1.
#
#   bash deploy.sh
#
# La primera vez abre el navegador para iniciar sesion en Cloudflare.
set -e
cd "$(dirname "$0")"

echo "== friendly123-sync-relay: sesion en Cloudflare (si hace falta) =="
if ! npx --yes wrangler@latest whoami >/dev/null 2>&1; then
  npx --yes wrangler@latest login
fi

echo "== Desplegando el relay =="
npx --yes wrangler@latest deploy

echo ""
echo "Listo. Prueba: https://friendly123-sync-relay.<tu-subdominio>.workers.dev/health"
echo "Debe responder: friendly123-sync-relay ok"
