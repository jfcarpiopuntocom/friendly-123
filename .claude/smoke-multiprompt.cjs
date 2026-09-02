const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_) { ({ chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"))); }
const BASE = "http://localhost:8127/index.html";
let fallos = [];
function check(n, c, x){ if(c) console.log("  ok   "+n); else { console.log("  FALLA "+n+(x?" -> "+JSON.stringify(x):"")); fallos.push(n);} }
(async () => {
  const b = await chromium.launch({ headless: true });
  try {
    const ctx = await b.newContext(); const page = await ctx.newPage();
    const errs = []; page.on("pageerror", e => errs.push(String(e)));
    await page.route(/googleapis|gstatic|workers\.dev|unpkg|jsdelivr|sheetjs|cloudflare/, r => r.abort());
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCAuth && window.OCAuth.rolActual, null, { timeout: 15000 });
    await page.evaluate(async () => { await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-smoke", vaciar: false }) }); });
    await page.evaluate(() => { try { sessionStorage.setItem("f123_sesion", JSON.stringify({ rol: "dueno", demo: false })); } catch (_) {} });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCAuth && window.OCAuth.rolActual, null, { timeout: 15000 });
    await page.waitForFunction(() => window.OCAuth.rolActual() === "dueno", null, { timeout: 15000 });

    // pick a normal product with stock
    const prod = await page.evaluate(async () => {
      const ps = await (await fetch("/api/productos")).json();
      return ps.find(p => (p.tipoProducto||"normal")==="normal" && p.stockActual >= 5) || ps[0];
    });
    check("hay producto normal con stock", prod && prod.stockActual >= 5, prod && {id:prod.id,stock:prod.stockActual});

    // counter-sale quantity 3 + invoice
    const venta = await page.evaluate(async (pid) => {
      const before = (await (await fetch("/api/productos/"+pid)).json()).stockActual;
      const r = await fetch("/api/productos/"+pid+"/venta", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ cantidad: 3, info: { factura:"F-001", formaPago:"cash" } }) });
      const d = await r.json();
      const after = (await (await fetch("/api/productos/"+pid)).json()).stockActual;
      return { status:r.status, ventaId:d.ventaId, before, after };
    }, prod.id);
    check("venta mostrador cantidad 3 (200)", venta.status===200, venta);
    check("stock bajó 3", venta.before - venta.after === 3, venta);

    // find that sale in /ventas/todas and confirm factura/formaPago
    const enTodas = await page.evaluate(async (vid) => {
      const rows = await (await fetch("/api/ventas/todas")).json();
      return rows.find(v => v.id === vid) || null;
    }, venta.ventaId);
    check("venta en /ventas/todas con factura+pago+cant3", enTodas && enTodas.factura==="F-001" && enTodas.formaPago==="cash" && enTodas.cantidad===3, enTodas);

    // edit the sale: quantity 2, notes
    const edit = await page.evaluate(async (vid) => {
      const r = await fetch("/api/ventas/"+vid, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ cantidad: 2, info:{ notas:"corregido" } }) });
      return { status:r.status, body: await r.json() };
    }, venta.ventaId);
    check("PATCH venta cantidad 2 (200)", edit.status===200, edit.body && edit.body.error);

    // stock should have returned +1 (3->2)
    const stockTrasEdit = await page.evaluate(async (pid) => (await (await fetch("/api/productos/"+pid)).json()).stockActual, prod.id);
    check("stock devolvió 1 tras editar a 2", stockTrasEdit === venta.after + 1, { stockTrasEdit, ventaAfter: venta.after });

    // cancel ex-post
    const cancel = await page.evaluate(async (vid) => {
      const r = await fetch("/api/ventas/"+vid+"/cancelar", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ motivo:"error de prueba" }) });
      return { status:r.status, body: await r.json() };
    }, venta.ventaId);
    check("cancelar ex-post (200)", cancel.status===200, cancel.body && cancel.body.error);

    // stock fully restored to original before
    const stockFinal = await page.evaluate(async (pid) => (await (await fetch("/api/productos/"+pid)).json()).stockActual, prod.id);
    check("stock restaurado al original", stockFinal === venta.before, { stockFinal, original: venta.before });

    // gasto with categoria
    const g = await page.evaluate(async () => {
      const r = await fetch("/api/gastos", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ concepto:"Luz", monto: 40, categoria:"utilities" }) });
      const d = await r.json();
      const get = await (await fetch("/api/gastos")).json();
      return { cat: d.categoria, porCat: get.porCategoria };
    });
    check("gasto guarda categoria utilities", g.cat === "utilities", g);
    check("GET gastos devuelve porCategoria", g.porCat && typeof g.porCat.utilities === "number", g.porCat);

    // cliente rangoEdad + pais
    const cli = await page.evaluate(async () => {
      const cs = await (await fetch("/api/clientes")).json();
      if (!cs.length) return { skip: true };
      const id = cs[0].id;
      await fetch("/api/clientes/"+id+"/contacto", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ rangoEdad:"25-34", pais:"Ecuador" }) });
      const c2 = (await (await fetch("/api/clientes")).json()).find(x=>x.id===id);
      return { edad: c2.rangoEdad, pais: c2.pais };
    });
    check("cliente guarda rangoEdad+pais", cli.skip || (cli.edad==="25-34" && cli.pais==="Ecuador"), cli);

    // mov log carries dispositivo + rol
    const mov = await page.evaluate(async () => {
      const ms = await (await fetch("/api/actividad")).json();
      const m = ms.find(x => x.dispositivoApodo !== undefined || x.usuarioRol !== undefined) || ms[0];
      return { hasDisp: "dispositivoApodo" in (m||{}), hasRol: "usuarioRol" in (m||{}), tipos: ms.slice(0,6).map(x=>x.tipo) };
    });
    check("movimientos llevan dispositivoApodo+usuarioRol", mov.hasDisp && mov.hasRol, mov);
    check("log tiene cancelacion-ex-post y venta-editada", mov.tipos.includes("cancelacion-ex-post"), mov.tipos);

    check("sin errores de página", errs.length === 0, errs.slice(0,3));
  } finally { await b.close(); }
  console.log(fallos.length ? "\nFALLdefeat "+fallos.length : "\nTODO VERDE — smoke multiprompt");
  process.exit(fallos.length ? 1 : 0);
})();
