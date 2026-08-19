#!/usr/bin/env bash
# guards.sh — comprobaciones que impiden que vuelvan los bugs ya pagados.
#
# JFC, caza Hugo/Paco/Luis 2026-08-18. Cada uno de estos guards existe porque el
# bug YA PASO al menos una vez. No son buenas practicas genéricas: son cicatrices.
#
# Uso:  bash .claude/guards.sh            (en la raiz de cualquiera de los 3 repos)
# Sale 0 si todo bien, 1 si algo fallo. Imprime QUE fallo y DONDE.
set -u
FIX=""; [ "${1:-}" = "--fix" ] && FIX=1
RAIZ="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$RAIZ" || exit 1
FALLOS=0
ok(){ printf "  ok   %s\n" "$1"; }
mal(){ printf "  MAL  %s\n" "$1"; FALLOS=$((FALLOS+1)); }

echo "== guards de $(basename "$RAIZ") =="

# C1: JAMAS sobrescribir un archivo completo entre apps hermanas. Si un .js del
# repo actual es byte-identico al de una hermana, o casi (mismo sha256 en los
# primeros 5 KB), es sospechoso: el port se hizo copiando en vez de injertando y
# se perdio el trabajo propio del repo destino. Regla de CLAUDE.md, ahora
# verificada.
HERMANAS="/home/user/AMIGABLE /home/user/friendly-123 /home/user/consultorio-123"
SOSPECHOSOS=""
for f in docs/*.js; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  # index.html y tablero.html son enormes: no aplica; solo modulos
  case "$b" in aislamiento.js|hechos.js|reconciliacion.js) continue ;; # divergen por diseno
  esac
  # Utilidades genericas marcadas como COMPARTIDO en la primera linea: esta
  # bien que sean identicas, no son un port en curso.
  head -n 1 "$f" | grep -q "COMPARTIDO" && continue
  mia=$(head -c 5120 "$f" | sha256sum | cut -c1-16)
      for h in $HERMANAS; do
        [ "$h" = "$RAIZ" ] && continue
        [ -f "$h/docs/$b" ] || continue
        suya=$(head -c 5120 "$h/docs/$b" | sha256sum | cut -c1-16)
        [ "$mia" = "$suya" ] && SOSPECHOSOS="$SOSPECHOSOS $b(=$(basename "$h"))"
      done
done
if [ -z "$SOSPECHOSOS" ]; then ok "port: ningun modulo es copia byte-identica de una hermana"
else mal "port: modulos identicos a una hermana ->$SOSPECHOSOS"; fi


# ---------------------------------------------------------------- GUARD 16
# FECHAS. Comparar un ISO crudo contra el dia/mes LOCAL solo funciona en UTC+0.
# En Ecuador (UTC-5) mandaba las ventas de despues de las 19:00 al dia siguiente
# y las de fin de mes a la liquidacion del mes siguiente. Ya paso el 2026-08-06
# y volvio por otro camino a friendly-123 y consultorio-123.
if [ -f docs/mock-backend.js ]; then
  if grep -q "function fechaLocalDe" docs/mock-backend.js; then
    ok "fechas: existe fechaLocalDe()"
  else
    mal "fechas: FALTA fechaLocalDe() — las comparaciones estan en UTC crudo"
  fi
  # ninguna comparacion puede rebanar una fecha cruda
  CRUDAS=$(grep -n "v\.fecha)\.slice(0\|\.fecha\.slice(0\|fechaISO\.slice(0" docs/mock-backend.js \
           | grep -v "fechaLocalDe" | grep -v "^\s*//" || true)
  if [ -z "$CRUDAS" ]; then ok "fechas: ninguna comparacion sobre ISO crudo"
  else mal "fechas: comparacion sobre ISO crudo -> $(echo "$CRUDAS" | head -3 | tr '\n' ' ')"; fi
fi

# ---------------------------------------------------------------- GUARD 17
# SERVICE WORKER COMPLETO. Ya paso: "el service worker no conocia 8 scripts que
# la app ya cargaba", asi que los dispositivos instalados servian version vieja.
if [ -f docs/sw.js ] && [ -f docs/index.html ]; then
  FALTAN=""
  # G3: aceptar mayusculas y subdirectorios (ej. vendor/x.js) — antes se colaban.
  for js in $(grep -oE 'src="\./[A-Za-z0-9./_-]+\.js"' docs/index.html | sed 's/src="\.\///; s/"//' | sort -u); do
    grep -q "\"\./$js\"" docs/sw.js || FALTAN="$FALTAN $js"
  done
  if [ -z "$FALTAN" ]; then ok "sw: conoce todos los scripts de index.html"
  elif [ -n "$FIX" ]; then
    # M5: auto-registro. Cada vez que agrego un script nuevo tengo que acordarme
    # de dos sitios (index.html y sw.js). El guard ya lo detecta; con --fix ya
    # tampoco hay que pegarlo a mano.
    for j in $FALTAN; do
      python3 -c "
import io,re
p='docs/sw.js'; s=io.open(p,encoding='utf-8').read()
if '\"./manifest.json\"' in s: s=s.replace('\"./manifest.json\"','\"./$j\", \"./manifest.json\"',1)
else: s=re.sub(r'(SHELL\s*=\s*\[)', r'\\1\"./$j\", ', s, count=1)
m=re.search(r'CACHE\s*=\s*\"([a-z0-9-]+?)(\d+)\"', s)
if m: s=s.replace(m.group(0), 'CACHE = \"'+m.group(1)+str(int(m.group(2))+1)+'\"',1)
io.open(p,'w',encoding='utf-8').write(s)"
    done
    ok "sw: --fix registro los que faltaban ($FALTAN)"
  else mal "sw: NO precachea ->$FALTAN (corre '''bash .claude/guards.sh --fix''' para arreglar)"; fi
fi

# ---------------------------------------------------------------- GUARD 18
# PARIDAD DE CLAVES. Ninguna app puede escribir con el prefijo de una hermana:
# es la causa de la contaminacion cruzada que ya costo dos incidentes de licencia.
if [ -f docs/aislamiento.js ]; then
  NS=$(grep -o 'var NS = "[a-z0-9]*"' docs/aislamiento.js | head -1 | sed 's/.*"\(.*\)"/\1/')
  AJENOS=""
  case "$NS" in
    amig) OTROS="f123 c123";; f123) OTROS="amig c123";; c123) OTROS="amig f123";; *) OTROS="";;
  esac
  for o in $OTROS; do
    N=$(grep -ro "\"${o}_[a-z0-9_]*\"" docs/*.js 2>/dev/null | wc -l)
    if [ "$N" -gt 0 ]; then
      # No es rojo si la migracion YA rescata ese prefijo: la clave queda dentro
      # del namespace propio igual, y renombrarla dejaria huerfanos los datos
      # que el usuario ya tiene guardados. Es deuda de nombres, no de datos.
      # Excepciones marcadas a proposito en el codigo con NO-RENOMBRAR: nombres
      # de base de IndexedDB (renombrarlos deja los registros vivos pero
      # invisibles) y prefijos heredados que hay que seguir leyendo durante la
      # transicion. Se cuentan aparte, no son deuda.
      MARCADAS=$(grep -rc "NO renombrar\|NO-RENOMBRAR\|heredado" docs/*.js 2>/dev/null | awk -F: '{t+=$2} END{print t+0}')
      if grep -q "PREFIJOS_LEGADO.*\"${o}_\"" docs/aislamiento.js; then
        printf "  nota %s\n" "claves: ${N} referencia(s) a ${o}_ que la migracion rescata o que estan marcadas como intencionales (nombres de base IndexedDB y lectura de lo heredado)"
      else
        AJENOS="$AJENOS ${o}_(${N})"
      fi
    fi
  done
  if [ -z "$AJENOS" ]; then ok "claves: ninguna con prefijo ajeno sin rescatar (NS=$NS)"
  else mal "claves: prefijo ajeno SIN rescate en la migracion ->$AJENOS"; fi
fi

# ---------------------------------------------------------------- GUARD 15
# INVARIANTES DE DINERO. Que el reparto sume el bruto y que los porcentajes
# sumen 100, comprobado contra el backend real y no a ojo.
if [ -f docs/mock-backend.js ] && command -v node >/dev/null; then
  node "$RAIZ/.claude/guard-dinero.mjs" "$RAIZ" 2>/dev/null && ok "dinero: reparto e invariantes cuadran" \
    || mal "dinero: los invariantes NO cuadran (corre .claude/guard-dinero.mjs para el detalle)"
  # Los 8 casos de negocio reales del motor de tratos: las dos lecturas, aporte
  # fijo, minimo garantizado, escalas, y la misma persona con dos tratos.
  # consultorio-123 no tiene comisiones a proposito —un consultorio no le paga
  # comision a un artista— asi que ahi no aplica y no es rojo.
  if grep -q "function resolverTrato" docs/mock-backend.js; then
    node "$RAIZ/.claude/guard-tratos.mjs" "$RAIZ" >/dev/null 2>&1 && ok "tratos: las 8 formas de repartir dan lo esperado" \
      || mal "tratos: algun caso de reparto no da lo esperado (corre .claude/guard-tratos.mjs)"
  else
    printf "  nota %s\n" "tratos: esta app no reparte comisiones (a proposito), no aplica"
  fi
fi


# C2: marca de "lei los apuntes". Cuando escribo un plan (PLAN-*.md) tengo que
# tocar TODOS los PORT-NOTES-*.md, LAS-TRES-APPS-*.md y DIRECCION-PRODUCTO-*.md
# antes; sin esto se me olvida y el plan sale mal (como paso hoy con el motor
# de tratos). El guard mira: si hay un PLAN-*.md editado en los ultimos 60 min
# pero NINGUN apunte se leyo (touch) en ese mismo rato, es sospechoso.
if ls PLAN-*.md 2>/dev/null | head -1 >/dev/null; then
  PLAN_RECIENTE=$(find PLAN-*.md -mmin -60 2>/dev/null | head -1)
  if [ -n "$PLAN_RECIENTE" ]; then
    APUNTES_LEIDOS=$(find PORT-NOTES-*.md LAS-TRES-APPS-*.md DIRECCION-PRODUCTO-*.md -amin -60 2>/dev/null | wc -l)
    if [ "$APUNTES_LEIDOS" -eq 0 ]; then
      printf "  nota %s\n" "planes: hay PLAN reciente pero ningun apunte se leyo — releelos antes de ejecutar"
    else
      ok "planes: $APUNTES_LEIDOS apunte(s) leidos junto al PLAN reciente"
    fi
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "TODO VERDE"; else echo "$FALLOS GUARD(S) EN ROJO"; fi
exit $([ "$FALLOS" -eq 0 ] && echo 0 || echo 1)
