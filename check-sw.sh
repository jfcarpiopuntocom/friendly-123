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
# El campo "shell" de version.json tiene que ir SIEMPRE junto al CACHE de sw.js:
# el autodiagnostico de version (salud-app.js) compara esos dos valores, y si se
# desincronizan avisaria a TODOS los usuarios de una version vieja que no existe.
sw_ver=$(grep -oE 'f123-shell-v[0-9]+' docs/sw.js | head -1)
vj_ver=$(grep -oE 'f123-shell-v[0-9]+' docs/version.json | head -1)
if [ "$sw_ver" != "$vj_ver" ]; then
  echo "DESINCRONIZADO: sw.js dice $sw_ver y version.json dice $vj_ver"
  echo "  Los dos tienen que decir lo mismo (ver A4 en salud-app.js)."
  falta=1
fi

# MANIFEST DE VERSION (JFC 2026-08-28, sistema de integridad de version):
# version-manifest.json tiene que existir, estar al dia con version.json, y
# regenerarse con node scripts/gen-manifest.js antes de cada push. Si el
# manifest esta viejo, el SW y salud-app.js verificarian hashes equivocados.
if [ ! -f docs/version-manifest.json ]; then
  echo "FALTA docs/version-manifest.json — corre: node scripts/gen-manifest.js"
  falta=1
else
  man_ver=$(grep -oE '"shell":\s*"f123-shell-v[0-9]+"' docs/version-manifest.json | grep -oE 'f123-shell-v[0-9]+' | head -1)
  if [ "$man_ver" != "$vj_ver" ]; then
    echo "MANIFEST DESACTUALIZADO: version-manifest.json dice $man_ver y version.json dice $vj_ver"
    echo "  Corre: node scripts/gen-manifest.js"
    falta=1
  fi
fi

# G2 (JFC 2026-08-20, plan de guards): claves de localStorage/IndexedDB con
# el prefijo de OTRA app hermana coladas por copy-paste sin adaptar -- la
# clase de bug real que causo el hoyo de hechos.js/telemetry.js/etc. Corre el
# mismo grep que se usa a mano en cada auditoria, como gate automatico.
ajenas=$(grep -rnE '=\s*"(amigable|c123|amg)_[a-z_]+"' docs/*.js 2>/dev/null | grep -vE '_[0-9]{4}-[0-9]{2}-[0-9]{2}_' | grep -vi "VIEJA" | sort -u)
if [ -n "$ajenas" ]; then
  echo "CLAVES DE OTRA APP (G2): esta app es f123_*, pero aparecen literales ajenos:"
  echo "$ajenas" | sed 's/^/  /'
  falta=1
fi

# G4 (JFC 2026-08-20, plan de guards): todo boton data-vista del <nav> tiene
# que tener su id="vista-<mismo nombre>" correspondiente -- asi no vuelve a
# pasar lo de data-vista="vista-perchas" (doble prefijo, bug historico) ni
# una seccion viva sin ruta de nav (bug C1/C2 de hoy).
nav_vistas=$(grep -oE 'data-vista="[a-zA-Z0-9_-]+"' docs/index.html | grep -oE '"[a-zA-Z0-9_-]+"' | tr -d '"' | sort -u)
secciones=$(grep -oE '<section id="vista-[a-zA-Z0-9_-]+"' docs/index.html | grep -oE 'vista-[a-zA-Z0-9_-]+' | sed 's/^vista-//' | sort -u)
huerfanos_nav=$(comm -23 <(echo "$nav_vistas") <(echo "$secciones"))
huerfanas_seccion=$(comm -13 <(echo "$nav_vistas") <(echo "$secciones"))
if [ -n "$huerfanos_nav" ]; then
  echo "NAV SIN SECCION (G4): data-vista sin id=\"vista-*\" correspondiente:"
  echo "$huerfanos_nav" | sed 's/^/  /'
  falta=1
fi
if [ -n "$huerfanas_seccion" ]; then
  echo "AVISO (G4): seccion(es) vista-* sin boton de nav que la alcance (puede ser a proposito, ej. tabs internos) — revisar a mano:"
  echo "$huerfanas_seccion" | sed 's/^/  /'
fi

if [ "$falta" = "0" ]; then
  echo "OK — todos los scripts de index.html estan en el SHELL del service worker."
  echo "OK — sw.js y version.json coinciden en $sw_ver."
  echo "OK — sin claves de otra app hermana (G2)."
  echo "OK — todo data-vista del nav tiene su seccion (G4)."
  grep -oE 'f123-shell-v[0-9]+' docs/sw.js | head -1 | sed 's/^/CACHE actual: /'
  echo "Recuerda: si cambiaste el shell, el CACHE tiene que subir de numero o el"
  echo "telefono del cliente se queda con la version vieja para siempre."
fi
exit $falta
