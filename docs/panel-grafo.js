/* PANEL LORD: canarios WebGL + diagnostico por pantalla + grafos al fondo (Claude, JFC 2026-10-08).
   Decisiones de JFC 2026-10-07/08:
   - El Sonar de Canarios SE QUEDA (Push/Rewind/Detener intactos, no se tocan aqui).
   - Canarios PROPIOS en WebGL, estilo de los efectos de jfcarpio.com, sin licencias de terceros.
     Esto reemplaza su regla anterior (2026-10-02, "NO dibujar pajaros propios"). Los sprites que entrego JFC
     (img/canario.png, img/canario-caido.png) NO se borran: siguen siendo el respaldo si no hay WebGL.
   - Ambos grafos (toda la app y todo lo que toca dinero) van al FONDO del panel. La version lord SI muestra
     riesgos (dinero central sin test que lo nombre) y duplicados; se calculan aqui, en el navegador, a partir
     del mismo data.json publico de friendly123.com/graph-view/. Ninguna lista de riesgos se publica.
   - "Mejorar el backend del Sonar con el grafo": tocar un canario muestra que modulos y funciones de dinero
     viven en esa pantalla y cuantas tienen test. La app NO cambia su forma de reportar (eso tocaria a clientes).
   Si algo aqui falla, el panel sigue igual que antes: todo va en try/catch y los sprites quedan visibles. */
(function (global) {
  "use strict";
  var DATA_URLS = ["/graph-view/data.json", "https://friendly123.com/graph-view/data.json"];
  /* id del canario (salud-app.js NODOS) -> pantalla del grafo. arranque/version/codigo son de toda la app. */
  var PANTALLA = { hoy: "vista-hoy", escanear: "vista-escanear", inventario: "vista-inventario", perchas: "vista-perchas", clientes: "vista-clientes",
    comisiones: "vista-comisiones", dinero: "vista-comisiones", gastos: "vista-gastos", etiquetas: "vista-etiquetas", avanzado: "vista-avanzado", tablero: "dashboard" };
  var DATA = null, cargando = null;
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cargar() {
    if (cargando) return cargando;
    cargando = (async function () {
      for (var i = 0; i < DATA_URLS.length; i++) {
        try { var r = await fetch(DATA_URLS[i], { cache: "no-cache" }); if (r.ok) { DATA = await r.json(); prepararLord(DATA); return DATA; } } catch (_) {}
      }
      return null;
    })();
    return cargando;
  }
  /* Riesgo (solo lord): funcion de dinero central (money 3) sin ningun test que la nombre. Duplicado: mismo
     nombre de funcion de dinero en dos archivos distintos (dos fuentes de verdad). */
  function prepararLord(d) {
    var fns = d.money.nodes.filter(function (n) { return n.kind === "fn"; });
    var porNombre = {};
    fns.forEach(function (n) { (porNombre[n.name] = porNombre[n.name] || {})[n.file] = 1; });
    fns.forEach(function (n) { n.risk = n.money === 3 && !(n.testFiles && n.testFiles.length); n.dup = Object.keys(porNombre[n.name]).length > 1 && n.money >= 2; });
    d.riesgos = fns.filter(function (n) { return n.risk; });
    d.dups = Object.keys(porNombre).filter(function (k) { return Object.keys(porNombre[k]).length > 1 && fns.some(function (n) { return n.name === k && n.money >= 2; }); });
  }

  /* ================= 1. CANARIOS WEBGL ================= */
  var FS = [
    "precision mediump float;uniform vec2 uR;uniform float uT;uniform vec4 uC[16];uniform float uS;uniform int uN;",
    "float sdE(vec2 p,vec2 r){float k=length(p/r);return (k-1.)*min(r.x,r.y);}",
    "mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}",
    // Canario: cuerpo, cabeza con copete, pico, cola, ala que aletea. Unidades: 1 = ~22 px del mapa.
    "vec4 canario(vec2 q,float t,float caido,float fase){",
    "  if(caido>.5){q.y=-q.y;q.x+=.05*sin(t*40.+fase);}",
    "  else{q.y-=.08*abs(sin(t*2.2+fase));}",
    "  float body=sdE(q-vec2(0.,0.),vec2(.62,.48));",
    "  float head=length(q-vec2(.5,.42))-.3;",
    "  float crest=sdE(rot(.5)*(q-vec2(.42,.78)),vec2(.07,.16));",
    "  vec2 k=q-vec2(.82,.40);float beak=max(abs(k.y)-.09*(1.-k.x/.24),max(-k.x,k.x-.24));",
    "  vec2 tq=q-vec2(-.72,.02);float tail=max(abs(tq.y+tq.x*.5)-.11,abs(tq.x)-.26);",
    "  float flap=caido>.5?.2:sin(t*9.+fase)*.55;",
    "  float wing=sdE(rot(flap)*(q-vec2(-.08,.08))-vec2(-.12,0.),vec2(.38,.17));",
    "  float eye=length(q-vec2(.58,.48))-.065;",
    "  float d=min(min(min(body,head),min(tail,crest)),beak);",
    "  vec3 cuerpo=caido>.5?vec3(1.,.23,.36):vec3(1.,.82,.25);",
    "  vec3 ala=caido>.5?vec3(.75,.1,.22):vec3(.95,.6,.12);",
    "  vec3 c=cuerpo;float a=smoothstep(.02,-.02,d);",
    "  c=mix(c,ala,smoothstep(.02,-.02,wing));a=max(a,smoothstep(.02,-.02,wing));",
    "  c=mix(c,vec3(1.,.55,.2),smoothstep(.02,-.02,beak));",
    "  c=mix(c,vec3(.02,.05,.11),smoothstep(.015,-.015,eye));",
    "  c+=vec3(1.)*smoothstep(.02,-.02,length(q-vec2(.6,.51))-.02);",
    "  float glow=exp(-max(d,0.)*7.)*(caido>.5?.55+.45*sin(t*7.):.35);",
    "  vec3 halo=caido>.5?vec3(1.,.23,.36):vec3(.16,.93,.67);",
    "  if(caido>.5){float r=length(q);float ring=exp(-abs(fract(r*.9-t*1.4)-.5)*14.)*exp(-r*.6);glow+=ring*.8;}",
    "  return vec4(c*a+halo*glow*(1.-a),max(a,glow*.85));",
    "}",
    "void main(){vec2 px=vec2(gl_FragCoord.x,uR.y-gl_FragCoord.y)/uS;vec4 o=vec4(0.);",
    "  for(int i=0;i<16;i++){if(i>=uN)break;vec4 c=uC[i];vec2 q=(px-c.xy)/22.;q.y=-q.y;",
    "    if(abs(q.x)>3.5||abs(q.y)>3.5)continue;vec4 b=canario(q,uT,c.z,c.w);o=b+o*(1.-b.a);}",
    "  gl_FragColor=vec4(o.rgb,o.a);}"
  ].join("\n");
  var gl = null, cv = null, prog = null, loc = {}, raf = 0, t0 = performance.now(), activo = false;
  var rm = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function iniciarGL(mapa) {
    cv = document.createElement("canvas"); cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none";
    gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return false;
    var sh = function (t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 v;void main(){gl_Position=vec4(v,0.,1.);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, "v"); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ["uR", "uT", "uC", "uS", "uN"].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }
  /* Se llama despues de cada sonarDibujarMapa(): relee posiciones y estado de cada canario del SVG. */
  function canarios() {
    try {
      var mapa = document.getElementById("sonar-mapa"); var svg = mapa && mapa.querySelector("svg");
      if (!svg) return;
      if (!gl) { if (!iniciarGL(mapa)) return; }
      mapa.style.position = "relative";
      if (cv.parentNode !== mapa) mapa.appendChild(cv);
      mapa.classList.add("fx-canarios"); // CSS: oculta los sprites SOLO cuando WebGL ya funciona
      var nodos = Array.prototype.slice.call(svg.querySelectorAll("[data-canario]")).slice(0, 16);
      var arr = new Float32Array(64);
      nodos.forEach(function (n, i) { arr[i * 4] = Number(n.dataset.x) || 0; arr[i * 4 + 1] = Number(n.dataset.y) || 0; arr[i * 4 + 2] = n.classList.contains("caido") ? 1 : 0; arr[i * 4 + 3] = i * 1.7; });
      canarios._arr = arr; canarios._n = nodos.length;
      if (!activo) { activo = true; raf = requestAnimationFrame(cuadro); }
      if (rm) cuadro(performance.now());
    } catch (e) { apagar(e); }
  }
  function cuadro(now) {
    try {
      var mapa = document.getElementById("sonar-mapa"); if (!mapa || !cv) return;
      var w = mapa.clientWidth, h = Math.round(w * 470 / 760), dpr = Math.min(global.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + "px"; }
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.uR, cv.width, cv.height); gl.uniform1f(loc.uT, rm ? 1.3 : (now - t0) / 1000);
      gl.uniform1f(loc.uS, cv.width / 760); gl.uniform1i(loc.uN, canarios._n || 0); gl.uniform4fv(loc.uC, canarios._arr || new Float32Array(64));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } catch (e) { apagar(e); return; }
    if (!rm && !document.hidden) raf = requestAnimationFrame(cuadro); else if (!rm) setTimeout(function () { raf = requestAnimationFrame(cuadro); }, 1000);
  }
  function apagar(e) {
    try { console.warn("[panel-grafo] canarios WebGL apagados:", e && e.message); } catch (_) {}
    cancelAnimationFrame(raf); activo = false;
    var mapa = document.getElementById("sonar-mapa"); if (mapa) mapa.classList.remove("fx-canarios");
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }

  /* ================= 2. DIAGNOSTICO POR PANTALLA (tocar un canario) ================= */
  document.addEventListener("click", function (ev) {
    var g = ev.target && ev.target.closest && ev.target.closest("#sonar-mapa [data-canario]");
    if (!g) return;
    diagnostico(g.getAttribute("data-canario"), g.classList.contains("caido"));
  });
  async function diagnostico(id, caido) {
    var box = document.getElementById("sonar-diagnostico"); if (!box) return;
    box.hidden = false; box.innerHTML = '<p class="pg-p">Cargando el mapa del código…</p>';
    var d = await cargar();
    if (!d) { box.innerHTML = '<p class="pg-p">No pude leer friendly123.com/graph-view/data.json. El Sonar sigue funcionando igual.</p>'; return; }
    var scr = PANTALLA[id];
    var mods = scr ? d.app.links.filter(function (l) { return l.kind === "screen" && l.source === scr; }).map(function (l) { return l.target; }) : [];
    var fns = scr ? d.money.nodes.filter(function (n) { return n.kind === "fn" && n.screens && n.screens.indexOf(scr) >= 0; }) : [];
    var sinTest = fns.filter(function (n) { return n.risk; });
    var h = '<div class="pg-h">' + esc(id.toUpperCase()) + (caido ? ' · <span class="pg-rojo">con reportes</span>' : "") + "</div>";
    if (!scr) h += '<p class="pg-p">Este canario cuida toda la app (arranque, versión o código), no una pantalla: revisa los canales de arriba.</p>';
    else {
      h += '<p class="pg-p"><b>' + mods.length + "</b> módulos tocan esta pantalla: " + esc(mods.map(function (m) { return m.replace("docs/", ""); }).join(", ") || "ninguno detectado") + "</p>";
      h += '<p class="pg-p"><b>' + fns.length + "</b> funciones de dinero viven aquí; <b class=\"" + (sinTest.length ? "pg-rojo" : "pg-verde") + '">' + sinTest.length + "</b> sin test que las nombre.</p>";
      if (sinTest.length) h += '<p class="pg-p">Mirar primero: ' + sinTest.slice(0, 12).map(function (n) { return esc(n.name) + " (" + esc(n.file.replace("docs/", "")) + ":" + n.line + ")"; }).join(", ") + "</p>";
    }
    h += '<p class="pg-p">Mapa generado del commit ' + esc(d.commit) + ". Abajo, en «Mapa del código», está el grafo completo.</p>";
    box.innerHTML = h;
  }

  /* ================= 3. GRAFOS LORD AL FONDO ================= */
  var COL = { screen: "#F2B33D", core: "#2EE58A", backend: "#3DE0F5", ui: "#8CBFFF", dashboard: "#FF9A3D", sync: "#FFB070", js: "#C9DDFF", app: "#2EE58A", test: "#FFFFFF" };
  var NOM = { screen: "Pantallas", core: "Núcleo de dinero", backend: "Motor de datos", ui: "Código de pantallas", dashboard: "Dashboard", sync: "Guardado y sync", js: "Otros módulos", test: "Tests" };
  async function grafos() {
    var sec = document.getElementById("mapa-codigo"); if (!sec) return;
    var d = await cargar();
    var est = document.getElementById("mc-estado");
    if (!d) { est.textContent = "No pude leer los datos del grafo (friendly123.com/graph-view/data.json)."; return; }
    est.textContent = d.stats.functions + " funciones leídas · " + d.stats.moneyFunctions + " de dinero · " + d.riesgos.length + " de dinero central sin test que las nombre · " + d.dups.length + " duplicadas · commit " + d.commit;
    document.getElementById("mc-riesgos").innerHTML = d.riesgos.length ? d.riesgos.map(function (n) { return "<li>" + esc(n.name) + " <span>" + esc(n.file.replace("docs/", "")) + ":" + n.line + "</span></li>"; }).join("") : "<li>Ninguna. Todas las funciones de dinero central tienen al menos un test que las nombra.</li>";
    document.getElementById("mc-dups").innerHTML = d.dups.length ? d.dups.map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("") : "<li>Ninguna.</li>";
    if (typeof global.ForceGraph3D !== "function") { est.textContent += " · (sin la librería 3D: solo listas)"; return; }
    pintar("mc-app", d.app, function (n) { return n.kind === "screen" ? 16 : Math.max(1.5, Math.sqrt(n.fns || 1) * 1.4); });
    pintar("mc-money", d.money, function (n) { return n.kind === "screen" ? 14 : n.kind === "test" ? 1.2 : n.risk ? 5 : n.money === 3 ? 4 : 2; });
  }
  function pintar(id, data, tam) {
    var el = document.getElementById(id); if (!el) return;
    var deg = {}; data.links.forEach(function (l) { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
    try {
      var g = global.ForceGraph3D({ controlType: "orbit" })(el).backgroundColor("#060E1D").showNavInfo(false)
        .graphData({ nodes: data.nodes.map(function (n) { return Object.assign({}, n); }), links: data.links.map(function (l) { return Object.assign({}, l); }) })
        .nodeVal(tam).nodeColor(function (n) { return n.risk ? "#FF3B5C" : n.dup ? "#FFB070" : (COL[n.layer] || "#FFFFFF"); })
        .nodeLabel(function (n) { return '<div style="font:600 14px Segoe UI,Arial;color:#FFFFFF;background:#060E1D;padding:6px 9px;border:1px solid #2A4672;border-radius:4px">' + esc(n.name) + (n.file ? "<br>" + esc(n.file.replace("docs/", "")) + ":" + (n.line || "") : "") + (n.risk ? "<br>SIN TEST QUE LA NOMBRE" : "") + "</div>"; })
        .linkColor(function (l) { return l.kind === "screen" ? "#F2B33D" : l.kind === "covers" ? "#FFFFFF" : "#6F93C9"; }).linkOpacity(.4)
        .cooldownTicks(120).onEngineStop(function () { if (!g._fit) { g._fit = 1; g.zoomToFit(700, 20, function (n) { return deg[n.id] > 0; }); } });
      var fit = function () { g.width(el.clientWidth).height(el.clientHeight); }; fit(); global.addEventListener("resize", fit);
      setTimeout(function () { if (!g._fit) { g._fit = 1; g.zoomToFit(700, 20, function (n) { return deg[n.id] > 0; }); } }, 4000);
    } catch (e) { el.innerHTML = '<p class="pg-p">Este aparato no puede dibujar 3D.</p>'; }
  }
  global.PanelGrafo = { canarios: canarios, grafos: grafos, cargar: cargar, _prepararLord: prepararLord };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", grafos); else grafos();
})(typeof window !== "undefined" ? window : globalThis);
