# BLOQUE P — Cargador + Hostinger, por fases con canario (JFC 2026-09-24)

Leer antes: CLAUDE.md y PLAN-BLOQUES-2026-09-24.md. El documento guia
`.cowork/CLAUDE OUTPUTS/PROMPT-2-MIGRACION-SEMIPUBLICA-2026-09-22.md` esta en
la PC de JFC, no en el repo: estas fases se derivaron de la linea P del plan y
de las reglas del repo. Si ese documento dice otra cosa, manda el documento.

## Idea en una frase
La puerta sigue siendo github.io (ahi estan los datos de cada aparato: el
almacen es por ORIGEN). El codigo puede venir de un dominio que controla JFC
(Hostinger). Lo que no esta en el repo publico no se puede clonar.

## Fase A — cableado y canario (HECHA, shell v384, este PR)
- `docs/cargador.js`: pide una lista de scripts, en orden, al origen remoto si
  hay uno; si falla o tarda mas de 8 s, pide el mismo archivo a github.io.
  Falla abierta: nadie se queda afuera.
- Origen remoto: `localStorage f123_origen_codigo` (canario, un aparato) o
  `<meta name="oc-origen-codigo">` (todos). Hoy el meta va VACIO: nada cambia
  para nadie.
- Lista canario (los 4 ultimos scripts, se cuidan solos con readyState):
  edutips, workshop-brand, inspector, inspector-ui. Si algo sale mal solo se
  pierde eso, nunca ventas ni inventario.
- Advanced (panel de sync): linea "Code: github.io · 4 scripts" y, para
  dueno/admin, cajita para pegar la URL y botones "Try this origin on this
  device" / "Back to github.io". Efecto al recargar.
- `docs/.htaccess`: CORS para que github.io pueda pedir los .js a Hostinger.
  GitHub Pages lo ignora.
- Guarda G6 en `check-sw.sh`: la lista del cargador tiene que estar en el
  SHELL y no puede estar tambien como `<script src>`; avisa si el meta trae
  URL.
- `test/cargador.test.js` (7 pruebas, feature nueva, no bug).

## Fase B — Cloudflare Pages sirve el repo (SOLO JFC). Hostinger descartado
## el 2026-09-24: jfcarpio.com es solo el dominio, no hay hosting.
1. https://dash.cloudflare.com > Workers & Pages > Create > Pages >
   Connect to Git > friendly-123.
2. Build command: vacio. Build output directory: `docs`. Deploy.
3. URL resultante: `https://friendly-123-XXXX.pages.dev/` (opcional: Custom
   domain `code.jfcarpio.com`, con el DNS de Hostinger apuntando a Pages).
   El origen del cargador es esa URL con `/` final: los archivos cuelgan de la
   raiz, SIN `/docs/`.
4. CORS: `docs/_headers` (Pages lo lee; el .htaccess queda por si algun dia
   hay Apache). Comprobar:
   `curl -sI https://<pages>/edutips.js | grep -i access-control`.

## (Historico) Fase B con Hostinger — ya no aplica
1. hPanel > Sitios web > (dominio) > Avanzado > GIT.
2. Repositorio: `https://github.com/jfcarpiopuntocom/friendly-123`, rama
   `master`, carpeta de destino p. ej. `public_html/friendly-123`.
   El repo hoy es publico: no hace falta deploy key. (Cuando el repo sea
   privado, Hostinger muestra una deploy key que JFC pega en GitHub > Settings
   > Deploy keys. Claude nunca teclea claves.)
3. Activar el webhook automatico que ofrece hPanel (despliega en cada push).
4. Comprobar en el navegador de la PC:
   `https://<dominio>/friendly-123/docs/version.json` responde y dice
   `f123-shell-v384` (o el vigente).
   `curl -sI https://<dominio>/friendly-123/docs/edutips.js | grep -i access-control`
   tiene que mostrar `Access-Control-Allow-Origin: https://jfcarpiopuntocom.github.io`.
   Si no aparece, el `.htaccess` no se esta leyendo (LiteSpeed/Apache lo lee
   por carpeta; revisar que llego con el deploy).

## Fase C — canario en UN aparato de JFC (SOLO JFC)
1. En la app (github.io) > Advanced > panel de sync > pegar
   `https://<dominio>/friendly-123/docs/` > "Try this origin on this device".
2. Recargar. La linea tiene que decir:
   `Code: remote https://… · 4 scripts · same shell (f123-shell-vNNN)`.
   - "N fell back to github.io" = CORS o archivo faltante en Hostinger: nada
     se rompio (cayo a github.io), pero la fase no esta lista.
   - "shell differs" = Hostinger va atras: esperar el webhook o desplegar a mano.
3. Dejarlo dias con uso real. Criterio de salida: 0 fell back y same shell.
   Si algo raro: "Back to github.io" y recargar. Nunca borra datos.

## Fase D — ampliar la lista (Claude, un PR por paso)
- Sumar al cargador los scripts del pie de index.html que ya se cuidan solos
  (los que usan readyState). Cada paso: shell nuevo, check-sw G6, canario
  otra vez. Sumar el host de Hostinger a HOSTS_PERMITIDOS del SW y decidir la
  estrategia de cache (hoy el SW deja pasar ese host sin cachear).
- El bloque grande (el inline de index.html) se extrae a un archivo y entra al
  cargador el ultimo. Ahi si el orden importa: todo lo que va detras tambien
  tiene que ir por el cargador.

## Fase E — meta para todos y repo privado (SOLO con orden expresa de JFC)
- Poner la URL en `<meta name="oc-origen-codigo">` (G6 avisa). Todos cargan
  remoto; github.io sigue de fallback mientras los archivos existan ahi.
- Mover el codigo cargado a un repo privado desplegado en Hostinger; en el
  repo publico quedan la puerta (index.html), el SW, cargador.js y los
  archivos que sigan siendo fallback. `gen-manifest.js` se corre desde el
  checkout que tiene los archivos reales.
- TRAMPA: cuando un archivo ya no este en github.io, el fallback local de ese
  archivo deja de existir. Eso solo se hace cuando la fase C lleva semanas en
  0 fell back.

## Lo que NO prueba este PR
- Nada vivo: desde el contenedor no se llega a github.io ni a Hostinger. La
  URL viva y la fase B se comprueban desde la PC de JFC.
- No corri Hugo/Paco/Luis (la skill no esta en el contenedor).
