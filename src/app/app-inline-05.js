
(function(){
  try{
    var q=new URLSearchParams(window.location.search);
    var j=(q.get("join")||"").trim();
    if(!j) return;
    // Guard: solo codigos de esta app. Uno de la app hermana no abre sala aqui.
    if(!/^(TEAM|F123)-/i.test(j)) return;   // TEAM- es lo que lleva el QR desde 2026-08-19
    sessionStorage.setItem("f123_join_pendiente", j);
    // Sacar el codigo de la barra de direcciones (no debe quedar en historial).
    try{ q.delete("join");
      var rest=q.toString();
      history.replaceState(null,"",window.location.pathname+(rest?"?"+rest:"")+window.location.hash);
    }catch(_){}
  }catch(_){}
})();
