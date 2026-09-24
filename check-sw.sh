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

# VERIFICACION DE HASHES REALES (JFC 2026-09-08, mejora #2 de la auditoria de
# version). ANTES este script solo comparaba el STRING de version entre sw.js,
# version.json y el manifest -- por eso un cambio a un archivo del shell SIN
# regenerar version-manifest.json pasaba la compuerta y el service worker luego
# lo rechazaba en los aparatos (el incidente del 2026-09-08 con auth-ui.js). Ahora
# se recomputa el SHA-256 REAL de cada archivo del manifest y se compara: si uno
# no cuadra, la compuerta FALLA y pide regenerar. Deploy con manifest viejo =
# imposible.
if [ -f docs/version-manifest.json ]; then
  desfasados=$(node -e '
    const fs=require("fs"), crypto=require("crypto"), path=require("path");
    const man=JSON.parse(fs.readFileSync("docs/version-manifest.json","utf8"));
    const files=(man&&man.files)||{}; let bad=[];
    for(const rel of Object.keys(files)){
      const esp=files[rel];
      if(typeof esp!=="string"||esp.indexOf("sha256-")!==0) continue;
      const p=path.join("docs", rel.replace(/^\.\//,""));
      if(!fs.existsSync(p)){ bad.push(rel+" (falta el archivo)"); continue; }
      let bytes=fs.readFileSync(p);
      // Pages sirve LF desde Git aunque el checkout Windows use CRLF.
      if([".html",".js",".json"].includes(path.extname(p).toLowerCase()))
        bytes=Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
      const real="sha256-"+crypto.createHash("sha256").update(bytes).digest("hex");
      if(real!==esp) bad.push(rel);
    }
    if(bad.length) console.log(bad.join("\n"));
  ' 2>/dev/null)
  if [ -n "$desfasados" ]; then
    echo "MANIFEST DESINCRONIZADO (hashes reales): estos archivos del shell no cuadran"
    echo "con version-manifest.json. Corre: node scripts/gen-manifest.js"
    echo "$desfasados" | sed 's/^/  /'
    falta=1
  fi
fi

# G5 — NINGUNA LICENCIA COMPLETA EN EL REPO (JFC 2026-09-22). El repo es PUBLICO:
# una licencia F123 completa = acceso a ese cuaderno. Pasó con la licencia
# principal de JFC y con la de idiomARTE; nunca más. Solo se permiten las de
# ejemplo/ficticias (XXXX, AAAA..DDDD, TEST, SYNT). En el código, comparar por
# huella (hash), como sync-yjs.js; la licencia principal vive en el secret
# LORD_LICENSE del Worker.
lic_expuestas=$(git grep -n -E "F123-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{5}" -- . ':!backups' 2>/dev/null   | grep -v -E "F123-(XXXX|AAAA|BBBB|CCCC|DDDD|TEST|SYNT)-" )
if [ -n "$lic_expuestas" ]; then
  echo "LICENCIA COMPLETA EN EL REPO PUBLICO (G5). Quitala antes de pushear:"
  echo "$lic_expuestas" | sed -E 's/(F123-[A-Z0-9]{4})-[A-Z0-9-]+/-****/g' | cut -c1-160 | sed 's/^/  /'
  falta=1
fi

# G6 — LISTA DEL CARGADOR (Bloque P, JFC 2026-09-24). Los scripts que pide
# cargador.js ya no son <script src> en index.html, asi que el chequeo de
# arriba no los ve. Tienen que seguir en el SHELL de sw.js (son el fallback
# local y el precache) y NO pueden aparecer ademas como <script src> (doble
# carga). La lista va en UN renglon marcado /* OC-CARGADOR-LISTA */.
lista_cargador=$(grep -E 'OC-CARGADOR-LISTA' docs/index.html | grep -oE '"\./[^"]+"' | tr -d '"')
if [ -z "$lista_cargador" ]; then
  echo "FALTA la lista del cargador (G6): no hay renglon OC-CARGADOR-LISTA en index.html"
  falta=1
fi
for s in $lista_cargador; do
  if ! grep -q "\"$s\"" docs/sw.js; then echo "FALTA en sw.js (G6, lista del cargador): $s"; falta=1; fi
  if grep -qE "<script[^>]+src=\"$s\"" docs/index.html; then echo "DOBLE CARGA (G6): $s esta en la lista del cargador Y como <script src>"; falta=1; fi
done
if ! grep -q '"./cargador.js"' docs/sw.js; then echo "FALTA en sw.js (G6): ./cargador.js"; falta=1; fi
if grep -qE '<meta name="oc-origen-codigo" content="[^"]+"' docs/index.html; then
  echo "AVISO (G6): el meta oc-origen-codigo tiene una URL: TODOS los aparatos cargaran remoto. Solo con orden expresa de JFC."
fi

if [ "$falta" = "0" ]; then
  echo "OK — todos los scripts de index.html estan en el SHELL del service worker."
  echo "OK — lista del cargador en el SHELL y sin doble carga (G6)."
  echo "OK — sw.js y version.json coinciden en $sw_ver."
  echo "OK — hashes reales del shell cuadran con version-manifest.json."
  echo "OK — sin claves de otra app hermana (G2)."
  echo "OK — todo data-vista del nav tiene su seccion (G4)."
  echo "OK — ninguna licencia completa en el repo publico (G5)."
  grep -oE 'f123-shell-v[0-9]+' docs/sw.js | head -1 | sed 's/^/CACHE actual: /'
  echo "Recuerda: si cambiaste el shell, el CACHE tiene que subir de numero o el"
  echo "telefono del cliente se queda con la version vieja para siempre."
fi
exit $falta
