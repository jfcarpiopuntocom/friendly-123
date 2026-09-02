let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_) { ({ chromium } = require(require("path").join(__dirname,"..","node_modules","playwright"))); }
const BASE="http://localhost:8127/index.html"; let fallos=[];
const check=(n,c,x)=>{ if(c)console.log("  ok   "+n); else {console.log("  FALLA "+n+(x?" -> "+JSON.stringify(x):""));fallos.push(n);} };
(async()=>{ const b=await chromium.launch({headless:true});
 try{ const ctx=await b.newContext(); const page=await ctx.newPage(); const errs=[]; page.on("pageerror",e=>errs.push(String(e)));
  await page.route(/googleapis|gstatic|workers\.dev|unpkg|jsdelivr|sheetjs|cloudflare/,r=>r.abort());
  await page.goto(BASE,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.OCAuth&&window.OCAuth.rolActual,null,{timeout:15000});
  await page.evaluate(async()=>{await fetch("/api/instancia/activar",{method:"POST",body:JSON.stringify({instanceId:"inst-exp",vaciar:false})});});
  await page.evaluate(()=>{try{sessionStorage.setItem("f123_sesion",JSON.stringify({rol:"dueno",demo:false}));}catch(_){}});
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.OCAuth&&window.OCAuth.rolActual,null,{timeout:15000});
  await page.waitForFunction(()=>window.OCAuth.rolActual()==="dueno",null,{timeout:15000});
  const rol=await page.evaluate(()=>window.OCAuth.rolActual());
  console.log("  rol:", rol);
  // event cancel using ANY normal product (event bookings are any sale within an event)
  const ev=await page.evaluate(async()=>{
    const ps=await(await fetch("/api/productos")).json();
    const p=ps.find(x=>x.stockActual>=2)||ps[0];
    const before=p.stockActual;
    const r=await fetch("/api/productos/"+p.id+"/venta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cantidad:2,info:{nombrePagador:"Grupo Ana"}})});
    const d=await r.json();
    const mid=(await(await fetch("/api/productos/"+p.id)).json()).stockActual;
    const c=await fetch("/api/ventas/"+d.ventaId+"/cancelar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({motivo:"cliente canceló el evento"})});
    const after=(await(await fetch("/api/productos/"+p.id)).json()).stockActual;
    const acts=await(await fetch("/api/actividad")).json();
    const cm=acts.find(m=>m.tipo==="cancelacion-ex-post");
    return {before,mid,after,cs:c.status,montoRev:cm&&cm.detalle&&cm.detalle.montoRevertido};
  });
  check("booking evento baja 2", ev.before-ev.mid===2, ev);
  check("cancelar reservación (200)", ev.cs===200, ev);
  check("cupo liberado (stock restaurado)", ev.after===ev.before, ev);
  check("log montoRevertido>0 (resta lo pagado)", Number(ev.montoRev)>0, ev);
  const cred=await page.evaluate(async()=>{
    const cs=await(await fetch("/api/clientes")).json(); if(!cs.length) return {skip:true};
    const id=cs[0].id;
    await fetch("/api/clientes/"+id+"/abonar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({monto:20,motivo:"[for:Malbec][exp:2027-01-01] anticipo"})});
    // Se lee del libro mayor (rol-independiente): el owner/admin lo ve en cartera.
    const info=await window.AMG.Cartera.saldoDeCliente(id);
    const ab=(info.movimientos||[]).find(m=>/\[exp:2027-01-01\]/.test(m.motivo||"")&&/\[for:Malbec\]/.test(m.motivo||""));
    return {saldo:info.saldo, tieneExp:!!ab};
  });
  check("crédito guarda [for:]+[exp:] en el libro mayor", cred.skip||cred.tieneExp, cred);
  check("sin errores de página", errs.length===0, errs.slice(0,3));
 } finally{ await b.close(); }
 console.log(fallos.length?"\nFALLA "+fallos.length:"\nTODO VERDE — smoke expira+evento"); process.exit(fallos.length?1:0);
})();
