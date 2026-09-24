#!/usr/bin/env bash
# mi-parte-2026-09-24.sh — la parte de JFC en UNA pasada (Git Bash en Windows o cualquier bash).
# Uso:  bash scripts/mi-parte-2026-09-24.sh
# No teclea claves: lo que necesite login (Cloudflare, GitHub) te abre el navegador.
set -u
cd "$(dirname "$0")/.."
URL=https://jfcarpiopuntocom.github.io/friendly-123
WORKER=https://friendly123-licencias.jfcarpio.workers.dev

echo "== 1) Traer master ya mergeado"
git fetch origin master && git checkout master && git pull --ff-only origin master

echo "== 2) Verificar la URL viva (shell publicado)"
curl -s "$URL/version.json" | grep -o '"shell": *"[^"]*"' || echo "  (Pages tarda 1-3 min tras el merge; repite este paso)"
echo "  esperado: f123-shell-v386"

echo "== 3) Desplegar el Worker de licencias (lotes + pagos)"
echo "  Si pide login, wrangler abre el navegador de Cloudflare."
( cd cloudflare-worker && npm exec --no -- wrangler deploy ) || echo "  FALLO el deploy: revisa el login de Cloudflare (npm exec -- wrangler login)"

echo "== 4) Comprobar que el Worker nuevo esta vivo (sin clave debe decir 401, no 404)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER/lotes")
echo "  GET /lotes sin clave -> HTTP $code  (401 = desplegado; 404 = Worker viejo)"

echo "== 5) Archivar POSCuenca"
if command -v gh >/dev/null 2>&1; then
  gh repo archive jfcarpiopuntocom/POSCuenca -y && echo "  archivado" || echo "  gh fallo: usa el link de abajo"
else
  echo "  sin gh: abre https://github.com/jfcarpiopuntocom/POSCuenca/settings  > Danger Zone > Archive this repository"
fi

echo "== 6) Hostinger (fase B, un solo paso manual)"
echo "  hPanel > Sitios web > tu dominio > Avanzado > GIT > conectar"
echo "  repo: https://github.com/jfcarpiopuntocom/friendly-123  rama: master  carpeta: public_html/friendly-123"
echo "  Luego pega aqui tu dominio y corre:"
echo "    bash scripts/mi-parte-2026-09-24.sh hostinger https://TU-DOMINIO"

if [ "${1:-}" = "hostinger" ] && [ -n "${2:-}" ]; then
  D="${2%/}/friendly-123/docs"
  echo "== 7) Verificar Hostinger en $D"
  curl -s "$D/version.json" | grep -o '"shell": *"[^"]*"' || echo "  version.json no responde: el deploy GIT no llego"
  curl -sI "$D/edutips.js" | grep -i "access-control-allow-origin" || echo "  FALTA la cabecera CORS: el .htaccess no se esta leyendo"
  echo "  Si las dos lineas salen bien: en la app > Advanced > panel de sync > pega $D/ > Try this origin on this device > recarga."
fi

echo "== 8) SEO, dos links para validar (desde el navegador)"
echo "  https://validator.schema.org/#url=$URL/"
echo "  https://pagespeed.web.dev/analysis?url=$URL/save.html"
echo "Listo."
