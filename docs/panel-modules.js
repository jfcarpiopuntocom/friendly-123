/* JFC master panel: non-destructive navigation over its existing modules.
 * No network, credential access, PIN handling or business data mutation. */
(function () {
  "use strict";
  function init() {
    var root = document.querySelector("#panel main");
    if (!root || document.getElementById("jfc-module-nav")) return;
    var groups = [
      {name:"Visión general",icon:"◉",tests:[/^Sonar de Canarios$/i,/^Resumen$/i]},
      {name:"Licencias y negocios",icon:"▦",tests:[/^Licencias ·/i,/^Instancias ·/i,/^Papelera ·/i]},
      {name:"Seguridad y recuperación",icon:"◇",tests:[/^Códigos maestros/i,/^⚠️ Solo para ti/i,/^Roles y aclaraciones/i]},
      {name:"Operaciones",icon:"↻",tests:[/^Control de versiones/i,/^Notas operativas/i]},
      {name:"Crecimiento",icon:"✳",tests:[/^Roadmap/i,/^Herramientas de marketing/i]},
      {name:"Técnico",icon:"⌘",tests:[/^Mapa del código/i]}
    ];
    var headings=Array.prototype.slice.call(root.querySelectorAll("h2"));
    var found=[];
    groups.forEach(function (g) {
      g.items=[];
      headings.forEach(function (h) {
        var title=String(h.textContent||"").replace(/\s+/g," ").trim();
        if (!g.tests.some(function (re) {return re.test(title);}) || found.indexOf(h)!==-1) return;
        found.push(h);
        if (!h.id) h.id="jfc-sec-"+String(found.length).padStart(2,"0");
        g.items.push({id:h.id,title:title});
      });
    });
    if (!found.length) return;
    var style=document.createElement("style");
    style.textContent=
      "#jfc-module-nav{border:1px solid #D7E1E8;border-radius:14px;background:#F8F9FB;padding:15px 17px;margin:0 0 26px;color:#0F1923}"+
      "#jfc-module-nav h2{font:800 20px/1.2 system-ui;margin:0 0 5px;color:#0F1923}"+
      "#jfc-module-nav p{font:14px/1.5 system-ui;color:#385165;margin:0 0 15px}"+
      "#jfc-module-nav .jfc-nav-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px}"+
      "#jfc-module-nav .jfc-nav-group{background:#fff;border:1px solid #CFDBE4;border-radius:10px;padding:12px}"+
      "#jfc-module-nav .jfc-nav-group strong{display:block;font:750 14px/1.3 system-ui;color:#12314A;margin:0 0 9px}"+
      "#jfc-module-nav a{display:block;color:#174C6C !important;-webkit-text-fill-color:#174C6C !important;padding:7px 4px;font:600 13px/1.35 system-ui;min-height:32px;text-decoration:underline;text-decoration-color:#B1C6D4}"+
      "#jfc-module-nav a:focus-visible{outline:3px solid #E86040;outline-offset:2px;border-radius:3px}"+
      "#jfc-module-nav a:hover{text-decoration-color:#E86040;color:#A23D23 !important;-webkit-text-fill-color:#A23D23 !important}"+
      "@media(max-width:640px){#jfc-module-nav{padding:12px}#jfc-module-nav .jfc-nav-grid{grid-template-columns:1fr 1fr;gap:7px}#jfc-module-nav .jfc-nav-group{padding:10px}#jfc-module-nav a{min-height:44px}}"+
      "@media(max-width:390px){#jfc-module-nav .jfc-nav-grid{grid-template-columns:1fr}}"+
      "#panel main h2[id^='jfc-sec-']{scroll-margin-top:22px}";
    document.head.appendChild(style);
    var nav=document.createElement("section");nav.id="jfc-module-nav";
    nav.setAttribute("aria-label","Navegación de módulos del panel JFC");
    var title=document.createElement("h2");title.textContent="Tu panel JFC, por módulos";nav.appendChild(title);
    var note=document.createElement("p");
    note.textContent="Abre cada sección existente sin salir de esta página. Las operaciones mantienen los permisos actuales del panel; aquí no se muestran PIN ni datos de los cuadernos.";
    nav.appendChild(note);
    var grid=document.createElement("div");grid.className="jfc-nav-grid";
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var box=document.createElement("div");box.className="jfc-nav-group";
      var name=document.createElement("strong");name.textContent=g.icon+"  "+g.name;box.appendChild(name);
      g.items.forEach(function (item) {
        var a=document.createElement("a");a.href="#"+item.id;a.textContent=item.title;box.appendChild(a);
      });
      grid.appendChild(box);
    });
    nav.appendChild(grid);root.insertBefore(nav,root.firstChild);
  }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);else init();
})();