#!/usr/bin/env bash
# check-sw.sh — cada <script src> de index.html tiene que estar en el SHELL del
# service worker, y el CACHE tiene que haber cambiado si el shell cambio.
#
# POR QUE EXISTE (amigable-123, df1e0c9, 2026-08-16): agregar un <script> a
# index.html y no agregarlo a sw.js deja la app rota SOLO en dispositivos que
# YA la tienen instalada — o sea, los de los clientes. En localhost no hay
# service worker, asi que el bug es invisible mientras se desarrolla. El SW
# sirve el shell viejo cacheado y el navegador termina con una MEZCLA de
# version vieja y nueva: Avanzado se ve roto sin un solo error en su codigo.
#
# Correr antes de cada push que toque index.html o agregue un script.
set -u
cd "$(dirname "$0")"
falta=0
for s in $(grep -oE '<script[^>]+src="\./[^"]+"' docs/index.html | grep -oE '"\./[^"]+"' | tr -d '"'); do
  if ! grep -q "\"$s\"" docs/sw.js; then echo "FALTA en sw.js: $s"; falta=1; fi
done
if [ "$falta" = "0" ]; then
  echo "OK — todos los scripts de index.html estan en el SHELL del service worker."
  grep -oE 'f123-shell-v[0-9]+' docs/sw.js | head -1 | sed 's/^/CACHE actual: /'
  echo "Recuerda: si cambiaste el shell, el CACHE tiene que subir de numero o el"
  echo "telefono del cliente se queda con la version vieja para siempre."
fi
exit $falta
