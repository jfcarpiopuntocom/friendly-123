
(function(){
  var _EOD_ES = function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}};
  var TX = function(){ return _EOD_ES() ? {
    title:"Resumen diario", loading:"Cargando resumen de hoy...",
    revenue:"Ingresos de hoy", sales:"Ventas", profit:"Ganancia estimada", inv:"Inventario valorizado",
    week:"Ingresos de la semana", backup:"Descargar respaldo", close:"Cerrar",
    fabLabel:"Resumen diario", noHint:"No hay sesion — solo el dueno o admin ven este boton.",
    backupOk:"Respaldo descargado.", backupFail:"No se pudo descargar el respaldo: ",
    fetchFail:"No se pudo cargar el resumen: "
  } : {
    title:"Daily Summary", loading:"Loading today's summary...",
    revenue:"Revenue today", sales:"Sales", profit:"Estimated profit", inv:"Inventory value",
    week:"Revenue this week", backup:"Download backup", close:"Close",
    fabLabel:"Daily Summary", noHint:"No session — only owner or admin see this button.",
    backupOk:"Backup downloaded.", backupFail:"Could not download backup: ",
    fetchFail:"Could not load summary: "
  };};
  function money(v){
    if(v===null||v===undefined||v==="") return "—"; // v506: desconocido no es $0 (cierre del dia)
    try {
      var loc=(window.OCI18n&&window.OCI18n.locale())||"en-US";
      return new Intl.NumberFormat(loc,{style:"currency",currency:"USD"}).format(v||0);
    } catch(_) { return "$"+Number(v||0).toFixed(2); }
  }
  function visible(){
    var b=document.body;
    /* B10 (JFC 2026-08-19): auth-ui hace rol = esDemo ? "dueno" : nuevoRol, asi
       que un visitante de la DEMO tambien lleva la clase rol-dueno. El boton
       aparecia en la demo y le ofrecia "descargar respaldo" de un negocio que
       no es suyo. Se excluye rol-demo explicitamente.
       B11: al cerrar sesion las clases se quitan, pero el sondeo tarda hasta
       3 s en enterarse y el boton quedaba flotando encima del teclado del PIN.
       Se comprueba tambien que el candado no este visible. */
    if (b.classList.contains("rol-demo")) return false;
    try {
      var gate=document.getElementById("oc-gate")||document.querySelector("#gate");
      if (gate && gate.style.display!=="none" && gate.offsetParent!==null) return false;
    } catch (_) {}
    return b.classList.contains("rol-dueno")||b.classList.contains("rol-admin");
  }
  function actualizarFAB(){
    var f=document.getElementById("fab-eod"); if(!f) return;
    var puede=visible();
    f.textContent=TX().fabLabel;
    /* Ancho: el FAB flota. Angosto: se apaga y manda el boton en linea de SOLD
       (la media query de arriba lo refuerza aunque este display quede en block). */
    var ancho = !(window.matchMedia && window.matchMedia("(max-width:899px)").matches);
    f.style.display=(puede && ancho)?"block":"none";
    var w=document.getElementById("eod-inline-wrap");
    if(w){ w.classList.toggle("puede", puede); var ib=document.getElementById("eod-inline"); if(ib) ib.textContent=TX().fabLabel; }
  }
  function abrir(){
    var m=document.getElementById("eod-modal"),
        body=document.getElementById("eod-body"),
        t=TX();
    document.getElementById("eod-t").textContent=t.title;
    document.getElementById("eod-backup").textContent=t.backup;
    document.getElementById("eod-close").textContent=t.close;
    document.getElementById("eod-msg").textContent="";
    body.innerHTML='<p style="color:#6b7280;">'+t.loading+'</p>';
    m.classList.add("visible");
    fetch("/api/dashboard").then(function(r){
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    }).then(function(d){
      var rd=(d&&d.resumenDia)||{}, rw=(d&&d.resumenSemana)||{};
      body.innerHTML=
        '<div class="k"><span>'+t.revenue+'</span><span class="v">'+money(rd.entra)+'</span></div>'+
        '<div class="k"><span>'+t.sales+'</span><span class="v">'+(rd.ventasCount||0)+'</span></div>'+
        '<div class="k"><span>'+t.profit+'</span><span class="v">'+money(rd.gananciaHoy)+'</span></div>'+
        '<div class="k"><span>'+t.inv+'</span><span class="v">'+money(rd.inventarioValorizado)+'</span></div>'+
        '<div class="k"><span>'+t.week+'</span><span class="v">'+money(rw.entra)+'</span></div>';
    }).catch(function(err){
      body.innerHTML='<p style="color:#B91C1C;">'+t.fetchFail+(err&&err.message||"")+'</p>';
    });
  }
  function cerrar(){ document.getElementById("eod-modal").classList.remove("visible"); }
  async function bajarRespaldo(){
    var t=TX(), msg=document.getElementById("eod-msg");
    msg.textContent="…";
    try {
      var r=await fetch("/api/respaldo/exportar");
      if(!r.ok) throw new Error("HTTP "+r.status);
      var datos=await r.json();
      var blob=new Blob([JSON.stringify(datos,null,2)],{type:"application/json"});
      var url=URL.createObjectURL(blob), a=document.createElement("a");
      var d=new Date(); var stamp=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      a.href=url; a.download="friendly-123-backup-"+stamp+".json"; a.click();
      setTimeout(function(){URL.revokeObjectURL(url);},1500);
      msg.textContent=t.backupOk; msg.style.color="#00A968";
    } catch(err){
      msg.textContent=t.backupFail+(err&&err.message||""); msg.style.color="#B91C1C";
    }
  }
  document.addEventListener("DOMContentLoaded", function(){
    actualizarFAB();
    var f=document.getElementById("fab-eod"); if(f) f.addEventListener("click", abrir);
    var fi=document.getElementById("eod-inline"); if(fi) fi.addEventListener("click", abrir);
    /* Girar el telefono cambia cual de los dos manda. */
    try{ window.addEventListener("resize", actualizarFAB); window.addEventListener("orientationchange", actualizarFAB); }catch(_){}
    var x=document.getElementById("eod-close"); if(x) x.addEventListener("click", cerrar);
    var b=document.getElementById("eod-backup"); if(b) b.addEventListener("click", bajarRespaldo);
    var m=document.getElementById("eod-modal");
    if(m) m.addEventListener("click", function(e){ if(e.target===m) cerrar(); });
  });
  // Cuando auth-ui cambia el rol (login/logout), se dispara el resize del body classList.
  // No hay evento nativo, pero cerrarSesion/entrar ya llaman a codigo local. Como
  // fallback: polling ligero cada 3s (solo mira classList, no hace IO).
  setInterval(actualizarFAB, 3000);
  window.addEventListener("oc-lang-change", actualizarFAB);
})();
