// pocketbase-client.js — Adaptador AMIGABLE ↔ PocketBase (JFC 2026-07-03)
//
// Solo se activa cuando el dueño ha guardado su URL de PocketBase en Avanzado.
// Si OC_PB_URL no está en localStorage, este archivo termina aquí y
// mock-backend.js toma el control (modo demo de GitHub Pages).
//
// Diseño deliberado: cada cliente tiene su propio PocketBase en Fly.io.
// El frontend NO necesita auth token porque las reglas de las colecciones
// están abiertas — la seguridad de acceso la da el PIN de AMIGABLE.
// Un cliente con datos sensibles puede agregar reglas de auth en la admin UI
// de PocketBase sin tocar este archivo.
(function () {
  const PB_URL = (localStorage.getItem("OC_PB_URL") || "").replace(/\/$/, "");
  if (!PB_URL) return; // modo demo: mock-backend.js maneja todo

  window.OC_DEMO = false;
  window.OC_PB_CONNECTED = true;

  // -------------------------------------------------------------------------
  // REST helper: llama directamente a PocketBase (saltando el interceptor).
  // -------------------------------------------------------------------------
  const _fetch = window.fetch.bind(window);

  async function pbList(col, params) {
    const u = new URL(`${PB_URL}/api/collections/${col}/records`);
    u.searchParams.set("perPage", "500");
    if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await _fetch(u.toString());
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    return d.items || [];
  }

  async function pbGet(col, id) {
    const r = await _fetch(`${PB_URL}/api/collections/${col}/records/${id}`);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function pbCreate(col, body) {
    const r = await _fetch(`${PB_URL}/api/collections/${col}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function pbUpdate(col, id, body) {
    const r = await _fetch(`${PB_URL}/api/collections/${col}/records/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function pbDelete(col, id) {
    const r = await _fetch(`${PB_URL}/api/collections/${col}/records/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
  }

  // -------------------------------------------------------------------------
  // Logica de negocio (espejo de mock-backend.js / server.js)
  // -------------------------------------------------------------------------
  const ZONA = "America/Guayaquil";

  function hoyISO() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }
  function mesActualISO() { return hoyISO().slice(0, 7); }
  function diasParaVencer(fecha) {
    if (!fecha) return null;
    return Math.round((new Date(fecha + "T00:00:00") - new Date(hoyISO() + "T00:00:00")) / 86400000);
  }

  const ORDEN = { rojo: 0, amarillo: 1, azul: 2, verde: 3 };

  function estadoDe(p) {
    const margen = p.precio > 0 ? (p.precio - p.costo) / p.precio : 0;
    const dias = p.perecible ? diasParaVencer(p.fechaCaducidad) : null;
    let porStock;
    if (p.stockActual <= 0)
      porStock = { estado: "rojo", mensaje: "Sin stock — repon cuanto antes" };
    else if (p.stockActual <= p.umbralRojo)
      porStock = { estado: "rojo", mensaje: `Quedan ${p.stockActual} — reponer urgente` };
    else if (p.stockActual <= p.umbralAmarillo)
      porStock = { estado: "amarillo", mensaje: `Quedan ${p.stockActual} — revisar pronto` };
    else if (margen >= 0.5)
      porStock = { estado: "azul", mensaje: "Buen margen — impulsa este producto" };
    else
      porStock = { estado: "verde", mensaje: "Stock saludable" };

    if (dias == null) return { ...porStock, dias };

    let porVenc = null;
    if (dias < 0)
      porVenc = { estado: "rojo", mensaje: `Vencio hace ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"} — retiralo` };
    else if (dias <= 3)
      porVenc = { estado: "rojo", mensaje: `Vence en ${dias} dia${dias === 1 ? "" : "s"} — vendelo ya` };
    else if (dias <= 7)
      porVenc = { estado: "amarillo", mensaje: `Vence en ${dias} dias — vendelo primero` };

    if (!porVenc) return { ...porStock, dias };
    const masGrave = ORDEN[porVenc.estado] <= ORDEN[porStock.estado] ? porVenc : porStock;
    return { ...masGrave, dias };
  }

  function ficha(p, ubicaciones) {
    const e = estadoDe(p);
    const u = (ubicaciones || []).find(x => x.id === p.ubicacionId);
    return {
      id: p.id, nombre: p.nombre, precio: p.precio, sku: p.sku, barcode: p.barcode,
      proveedor: p.proveedor, stockActual: p.stockActual, estado: e.estado, mensaje: e.mensaje,
      categoria: p.categoria, ubicacionId: p.ubicacionId, ubicacionNombre: u ? u.nombre : "",
      perecible: !!p.perecible, fechaCaducidad: p.fechaCaducidad || null,
      diasParaVencer: e.dias, metodoCosteo: p.metodoCosteo || "FIFO",
      foto: p.foto ? `${PB_URL}/api/files/productos/${p.id}/${p.foto}` : null,
      estrella: !!p.estrella,
    };
  }

  function comisionVigente(u, acumuladoConEsta) {
    const escalas = Array.isArray(u.escalasComision) ? u.escalasComision : [];
    if (!u.metaMensual || escalas.length === 0) return Number(u.comisionSocio) || 0;
    const pctMeta = (acumuladoConEsta / u.metaMensual) * 100;
    const ordenadas = [...escalas].sort((a, b) => a.hasta - b.hasta);
    const tier = ordenadas.find(e => pctMeta <= e.hasta) || ordenadas[ordenadas.length - 1];
    return Number(tier.comision) || 0;
  }

  function calcularSplitVenta(u, montoBruto, acumuladoPrevio) {
    if (!u || u.tipo === "propio" || !u.tipo) return null;
    const comisionPct = comisionVigente(u, acumuladoPrevio + montoBruto);
    const montoComisionSocio = +(montoBruto * (comisionPct / 100)).toFixed(2);
    return {
      comisionPct,
      montoBruto: +montoBruto.toFixed(2),
      montoComisionSocio,
      montoNetoDueno: +(montoBruto - montoComisionSocio).toFixed(2),
    };
  }

  function buildSKU(nombre, categoria) {
    const cat = (categoria || "GEN").substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
    const nom = (nombre || "PRD").substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
    return `${cat}-${nom}-${String(Date.now()).slice(-4)}`;
  }

  // Respuesta JSON simulando la interfaz Response del navegador
  function J(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  function Err(msg, status) { return J({ error: msg }, status || 400); }

  // Deserializar campo json que PocketBase puede devolver como string o ya parseado
  function parseSplit(v) {
    if (!v) return null;
    if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }

  // -------------------------------------------------------------------------
  // Interceptor de fetch: mapea /api/* a PocketBase
  // -------------------------------------------------------------------------
  window.fetch = async function (url, opts) {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (!u.startsWith("/api/")) return _fetch(url, opts);

    const method = opts && opts.method ? opts.method.toUpperCase() : "GET";
    const body   = opts && opts.body ? JSON.parse(opts.body) : {};
    const parts  = u.replace(/\?.*/, "").split("/").filter(Boolean).slice(1); // quita "api"
    const qs     = new URLSearchParams(u.includes("?") ? u.split("?")[1] : "");
    const [col, id, accion] = parts;

    try {

      // -----------------------------------------------------------------------
      // DASHBOARD
      // -----------------------------------------------------------------------
      if (col === "dashboard") {
        const ubicacionId = qs.get("ubicacionId");
        const [productos, ventas, ubicaciones, gastos] = await Promise.all([
          pbList("productos"), pbList("ventas"), pbList("ubicaciones"), pbList("gastos"),
        ]);
        const hoy = hoyISO();
        const mes = mesActualISO();
        const filtP = !ubicacionId || ubicacionId === "todas"
          ? productos
          : productos.filter(p => p.ubicacionId === ubicacionId);
        const filtV = ventas.filter(v =>
          !v.anulada && v.fecha && v.fecha.slice(0, 10) === hoy &&
          (!ubicacionId || ubicacionId === "todas" || v.ubicacionId === ubicacionId)
        );
        const entra = filtV.reduce((s, v) => s + (v.precioUnit || 0) * (v.cantidad || 1), 0);
        const sale  = filtV.reduce((s, v) => s + (v.costo  || 0) * (v.cantidad || 1), 0);
        const inventarioValorizado = filtP.reduce((s, p) => s + (p.costo || 0) * (p.stockActual || 0), 0);
        const ticketProm = filtV.length > 0 ? entra / filtV.length : 0;
        const alertas = [];
        filtP.forEach(p => {
          const e = estadoDe(p);
          if (e.estado === "rojo" || e.estado === "amarillo")
            alertas.push({ estado: e.estado, mensaje: `${p.nombre}: ${e.mensaje}` });
        });
        alertas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]);
        const semaforoGeneral = alertas.some(a => a.estado === "rojo") ? "rojo"
          : alertas.some(a => a.estado === "amarillo") ? "amarillo" : "verde";
        const dias = new Date(hoy.slice(0, 4), hoy.slice(5, 7), 0).getDate();
        const gastosUbic = gastos.filter(g =>
          g.mes === mes &&
          (!ubicacionId || ubicacionId === "todas" || g.ubicacionId === ubicacionId)
        );
        const gastoTotalMes = gastosUbic.reduce((s, g) => s + (g.monto || 0), 0);
        return J({
          semaforoGeneral,
          resumenDia: {
            entra: +entra.toFixed(2), sale: +sale.toFixed(2),
            gananciaHoy: +(entra - sale).toFixed(2),
            inventarioValorizado: +inventarioValorizado.toFixed(2),
            ventasCount: filtV.length, ticketProm: +ticketProm.toFixed(2),
            gastoDiario: +(gastoTotalMes / dias).toFixed(2),
          },
          alertas,
        });
      }

      // -----------------------------------------------------------------------
      // PRODUCTOS
      // -----------------------------------------------------------------------
      if (col === "productos" && !id) {
        if (method === "GET") {
          const ubicacionId = qs.get("ubicacionId");
          const estadoF     = qs.get("estado");
          const [prods, ubicaciones] = await Promise.all([pbList("productos"), pbList("ubicaciones")]);
          let filtrados = !ubicacionId || ubicacionId === "todas"
            ? prods : prods.filter(p => p.ubicacionId === ubicacionId);
          let fichas = filtrados.map(p => ficha(p, ubicaciones));
          if (estadoF) fichas = fichas.filter(f => f.estado === estadoF);
          fichas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre));
          return J(fichas);
        }
        if (method === "POST") {
          if (!body.nombre)   return Err("El nombre es obligatorio.");
          if (!body.barcode)  return Err("El codigo es obligatorio.");
          const sku = buildSKU(body.nombre, body.categoria);
          const rec = await pbCreate("productos", {
            nombre: body.nombre, categoria: body.categoria || "", sku,
            barcode: body.barcode,
            ubicacionId: body.ubicacionId && body.ubicacionId !== "todas" ? body.ubicacionId : "",
            precio: Number(body.precio) || 0, costo: Number(body.costo) || 0,
            stockActual: Number(body.stockInicial) || 0,
            umbralRojo: 5, umbralAmarillo: 10,
            proveedor: body.proveedor || "", estrella: false,
            perecible: !!body.perecible, fechaCaducidad: body.fechaCaducidad || null,
            metodoCosteo: body.metodoCosteo || "FIFO",
          });
          await pbCreate("movimientos", {
            tipo: "alta", productoId: rec.id,
            detalle: { producto: rec.nombre }, fecha: new Date().toISOString(),
          });
          const ubicaciones = await pbList("ubicaciones");
          return J(ficha(rec, ubicaciones));
        }
      }

      if (col === "productos" && id && !accion) {
        if (method === "GET") {
          const [rec, ubicaciones] = await Promise.all([pbGet("productos", id), pbList("ubicaciones")]);
          return J(ficha(rec, ubicaciones));
        }
        if (method === "PATCH") {
          const campos = {};
          ["nombre","precio","proveedor","categoria","barcode","foto"].forEach(k => {
            if (body[k] !== undefined) campos[k] = k === "precio" ? Number(body[k]) : body[k];
          });
          const rec = await pbUpdate("productos", id, campos);
          const ubicaciones = await pbList("ubicaciones");
          return J(ficha(rec, ubicaciones));
        }
        if (method === "DELETE") {
          await pbDelete("productos", id);
          return J({ ok: true });
        }
      }

      // Ajustar stock manualmente
      if (col === "productos" && accion === "ajustar") {
        const rec = await pbGet("productos", id);
        const delta = Number(body.delta);
        const nuevoStock = Math.max(0, (rec.stockActual || 0) + delta);
        const updated = await pbUpdate("productos", id, { stockActual: nuevoStock });
        await pbCreate("movimientos", {
          tipo: "ajuste", productoId: id,
          detalle: { producto: rec.nombre, delta, motivo: body.motivo || "" },
          fecha: new Date().toISOString(),
        });
        const ubicaciones = await pbList("ubicaciones");
        return J(ficha(updated, ubicaciones));
      }

      // Venta unitaria
      if (col === "productos" && accion === "venta") {
        const [rec, ubicaciones] = await Promise.all([pbGet("productos", id), pbList("ubicaciones")]);
        if ((rec.stockActual || 0) < 1) return Err("Sin stock disponible.");
        const u = ubicaciones.find(x => x.id === rec.ubicacionId);
        const mes = mesActualISO();
        const ventasMes = await pbList("ventas");
        const acumulado = ventasMes
          .filter(v => v.ubicacionId === rec.ubicacionId && !v.anulada && v.fecha && v.fecha.slice(0, 7) === mes)
          .reduce((s, v) => s + (v.precioUnit || 0) * (v.cantidad || 1), 0);
        const split = calcularSplitVenta(u, rec.precio, acumulado);
        const venta = await pbCreate("ventas", {
          productoId: id, ubicacionId: rec.ubicacionId, cantidad: 1,
          precioUnit: rec.precio, costo: rec.costo || 0,
          fecha: new Date().toISOString(), anulada: false, liquidada: false, split,
        });
        const updated = await pbUpdate("productos", id, { stockActual: (rec.stockActual || 0) - 1 });
        await pbCreate("movimientos", {
          tipo: "venta", productoId: id,
          detalle: { producto: rec.nombre, cantidad: 1, total: rec.precio },
          fecha: new Date().toISOString(),
        });
        return J({ producto: ficha(updated, ubicaciones), ventaId: venta.id });
      }

      // Toggle estrella
      if (col === "productos" && accion === "estrella") {
        const rec = await pbGet("productos", id);
        const updated = await pbUpdate("productos", id, { estrella: !rec.estrella });
        await pbCreate("movimientos", {
          tipo: "estrella", productoId: id,
          detalle: { producto: rec.nombre, accion: updated.estrella ? "marcado" : "quitado" },
          fecha: new Date().toISOString(),
        });
        const ubicaciones = await pbList("ubicaciones");
        return J(ficha(updated, ubicaciones));
      }

      // Sugerencias de transferencia
      if (col === "productos" && accion === "sugerencias-transferencia") {
        const [rec, todos, ubicaciones] = await Promise.all([
          pbGet("productos", id), pbList("productos"), pbList("ubicaciones"),
        ]);
        const e = estadoDe(rec);
        if (e.estado === "verde") return J([]);
        const activasIds = new Set(ubicaciones.filter(u => u.activa !== false).map(u => u.id));
        const sug = todos
          .filter(x =>
            x.sku === rec.sku && x.id !== rec.id && activasIds.has(x.ubicacionId) &&
            estadoDe(x).estado !== "rojo" && x.stockActual > x.umbralAmarillo
          )
          .map(x => {
            const desde = ubicaciones.find(u => u.id === x.ubicacionId);
            const hacia = ubicaciones.find(u => u.id === rec.ubicacionId);
            const cantidad = Math.min(
              Math.floor(x.stockActual / 2),
              x.stockActual - x.umbralAmarillo
            );
            return {
              productoDestinoId: rec.id, productoOrigenId: x.id,
              sku: rec.sku, nombre: rec.nombre,
              desde: x.ubicacionId, desdeNombre: desde ? desde.nombre : "",
              hacia: rec.ubicacionId, haciaNombre: hacia ? hacia.nombre : "",
              stockOrigen: x.stockActual, cantidadSugerida: cantidad,
            };
          })
          .filter(s => s.cantidadSugerida > 0);
        return J(sug);
      }

      // -----------------------------------------------------------------------
      // VENTAS — anular
      // -----------------------------------------------------------------------
      if (col === "ventas" && accion === "anular") {
        const venta = await pbGet("ventas", id);
        if (venta.anulada) return Err("Esta venta ya fue anulada.");
        const [prod, ubicaciones] = await Promise.all([
          pbGet("productos", venta.productoId), pbList("ubicaciones"),
        ]);
        await pbUpdate("ventas", id, { anulada: true });
        const updated = await pbUpdate("productos", venta.productoId, {
          stockActual: (prod.stockActual || 0) + (venta.cantidad || 1),
        });
        await pbCreate("movimientos", {
          tipo: "anulacion", productoId: venta.productoId,
          detalle: { producto: prod.nombre, cantidad: venta.cantidad || 1 },
          fecha: new Date().toISOString(),
        });
        return J({ producto: ficha(updated, ubicaciones) });
      }

      // -----------------------------------------------------------------------
      // ACTIVIDAD (log de movimientos)
      // -----------------------------------------------------------------------
      if (col === "actividad" && method === "GET") {
        const movs = await pbList("movimientos", { sort: "-fecha" });
        return J(movs.slice(0, 50).map(m => ({
          id: m.id, tipo: m.tipo, fecha: m.fecha,
          detalle: typeof m.detalle === "string" ? JSON.parse(m.detalle) : (m.detalle || {}),
        })));
      }

      // -----------------------------------------------------------------------
      // ESCANEAR (barcode o sku)
      // -----------------------------------------------------------------------
      if (col === "escanear" && method === "POST") {
        const codigo = (body.codigo || "").trim();
        if (!codigo) return Err("Codigo vacio.");
        const todos = await pbList("productos");
        const prod = todos.find(p => p.barcode === codigo || p.sku === codigo);
        if (!prod) return Err(`Producto "${codigo}" no encontrado.`, 404);
        const ubicaciones = await pbList("ubicaciones");
        return J(ficha(prod, ubicaciones));
      }

      // -----------------------------------------------------------------------
      // ETIQUETAS
      // -----------------------------------------------------------------------
      if (col === "etiquetas" && id && method === "GET") {
        const [prod, ubicaciones] = await Promise.all([pbGet("productos", id), pbList("ubicaciones")]);
        return J(ficha(prod, ubicaciones));
      }

      // -----------------------------------------------------------------------
      // UBICACIONES (perchas)
      // -----------------------------------------------------------------------
      if (col === "ubicaciones" && !id) {
        if (method === "GET") {
          const todas = qs.get("todas") === "1";
          let lista = await pbList("ubicaciones");
          if (!todas) lista = lista.filter(u => u.activa !== false);
          return J(lista);
        }
        if (method === "POST") {
          if (!body.nombre) return Err("El nombre es obligatorio.");
          const rec = await pbCreate("ubicaciones", {
            nombre: body.nombre, tipo: body.tipo || "propio", activa: true,
            comisionSocio: Number(body.comisionSocio) || 0,
            metaMensual: Number(body.metaMensual) || 0,
            sucursalId: body.sucursalId || null,
            escalasComision: body.escalasComision || [],
            esFeria: !!body.esFeria,
          });
          return J(rec);
        }
      }

      if (col === "ubicaciones" && id && !accion) {
        if (method === "PUT")    { return J(await pbUpdate("ubicaciones", id, body)); }
        if (method === "DELETE") {
          const prods = await pbList("productos");
          if (prods.some(p => p.ubicacionId === id))
            return Err("Esta percha tiene productos asignados. Muevelos primero.", 400);
          await pbDelete("ubicaciones", id);
          return J({ ok: true });
        }
      }

      if (col === "ubicaciones" && accion === "desactivar") {
        return J(await pbUpdate("ubicaciones", id, { activa: false }));
      }
      if (col === "ubicaciones" && accion === "activar") {
        return J(await pbUpdate("ubicaciones", id, { activa: true }));
      }

      // -----------------------------------------------------------------------
      // SUCURSALES
      // -----------------------------------------------------------------------
      if (col === "sucursales" && !id) {
        if (method === "GET")  return J(await pbList("sucursales"));
        if (method === "POST") {
          if (!body.nombre) return Err("El nombre es obligatorio.");
          return J(await pbCreate("sucursales", { nombre: body.nombre, activa: true }));
        }
      }
      if (col === "sucursales" && id) {
        if (method === "PUT")    return J(await pbUpdate("sucursales", id, { nombre: body.nombre }));
        if (method === "DELETE") {
          const ubicaciones = await pbList("ubicaciones");
          if (ubicaciones.some(u => u.sucursalId === id))
            return Err("Esta sucursal tiene perchas asignadas.", 400);
          await pbDelete("sucursales", id);
          return J({ ok: true });
        }
      }

      // -----------------------------------------------------------------------
      // PROMOTORAS
      // -----------------------------------------------------------------------
      if (col === "promotoras" && !id) {
        if (method === "GET")  return J(await pbList("promotoras"));
        if (method === "POST") {
          if (!body.nombre) return Err("El nombre es obligatorio.");
          return J(await pbCreate("promotoras", {
            nombre: body.nombre, comision: Number(body.comision) || 0,
          }));
        }
      }
      if (col === "promotoras" && id) {
        if (method === "PUT")
          return J(await pbUpdate("promotoras", id, { nombre: body.nombre, comision: Number(body.comision) || 0 }));
        if (method === "DELETE") { await pbDelete("promotoras", id); return J({ ok: true }); }
      }

      // -----------------------------------------------------------------------
      // COMISIONES / LIQUIDACIONES
      // -----------------------------------------------------------------------
      if (col === "comisiones" && method === "GET") {
        const [ubicaciones, ventas, promotoras] = await Promise.all([
          pbList("ubicaciones"), pbList("ventas"), pbList("promotoras"),
        ]);
        const mes = mesActualISO();
        const liq = ubicaciones
          .filter(u => u.tipo && u.tipo !== "propio")
          .map(u => {
            const ventasMes = ventas.filter(v =>
              v.ubicacionId === u.id && !v.anulada && v.fecha && v.fecha.slice(0, 7) === mes
            );
            const ventasBrutas  = ventasMes.reduce((s, v) => s + (parseSplit(v.split)?.montoBruto || 0), 0);
            const comisionSocio = ventasMes.reduce((s, v) => s + (parseSplit(v.split)?.montoComisionSocio || 0), 0);
            const netoDueno     = ventasMes.reduce((s, v) => s + (parseSplit(v.split)?.montoNetoDueno || 0), 0);
            const pendientes    = ventasMes.filter(v => !v.liquidada);
            const ultima = ventas
              .filter(v => v.ubicacionId === u.id && !v.anulada)
              .reduce((mx, v) => v.fecha > mx ? v.fecha : mx, "");
            const diasSinVenta = ultima ? Math.floor((Date.now() - new Date(ultima)) / 86400000) : null;
            const prom = u.promotoraId ? promotoras.find(x => x.id === u.promotoraId) : null;
            return {
              ubicacionId: u.id, ubicacion: u.nombre, tipo: u.tipo,
              metaMensual: u.metaMensual || 0,
              cumplimientoMeta: u.metaMensual ? +((ventasBrutas / u.metaMensual) * 100).toFixed(1) : null,
              ventasBrutas: +ventasBrutas.toFixed(2),
              comisionSocio: +comisionSocio.toFixed(2),
              netoDueno: +netoDueno.toFixed(2),
              estado: ventasMes.length === 0 ? "sin ventas"
                : pendientes.length === 0 ? "pagado" : "pendiente",
              ventasPendientes: pendientes.length,
              diasSinVenta,
              promotorNombre: prom ? prom.nombre : null,
            };
          });
        return J(liq);
      }

      // -----------------------------------------------------------------------
      // TRANSFERENCIAS
      // -----------------------------------------------------------------------
      if (col === "transferencias" && method === "POST") {
        const [origen, destino, ubicaciones] = await Promise.all([
          pbGet("productos", body.productoOrigenId),
          pbGet("productos", body.productoDestinoId),
          pbList("ubicaciones"),
        ]);
        const cant = Number(body.cantidad);
        if (!cant || cant < 1) return Err("Cantidad invalida.");
        if (origen.stockActual < cant) return Err("Stock insuficiente en origen.");
        await Promise.all([
          pbUpdate("productos", origen.id, { stockActual: origen.stockActual - cant }),
          pbUpdate("productos", destino.id, { stockActual: (destino.stockActual || 0) + cant }),
          pbCreate("transferencias", {
            productoOrigenId: origen.id, productoDestinoId: destino.id,
            cantidad: cant, estado: "aprobada",
          }),
        ]);
        return J({ ok: true });
      }

      // -----------------------------------------------------------------------
      // AVANZADO — gastos del mes
      // -----------------------------------------------------------------------
      if (col === "avanzado" && id === "gastos") {
        const mes = mesActualISO();
        if (method === "GET") {
          const lista = await pbList("gastos", { filter: `mes='${mes}'` });
          const mapa = {};
          lista.forEach(g => { mapa[g.ubicacionId] = (mapa[g.ubicacionId] || 0) + (g.monto || 0); });
          return J(mapa);
        }
        if (method === "POST") {
          await pbCreate("gastos", {
            ubicacionId: body.ubicacionId || "",
            concepto: body.concepto || "Sin concepto",
            monto: Number(body.monto) || 0, mes,
          });
          return J({ ok: true });
        }
      }

      // -----------------------------------------------------------------------
      // AVANZADO — contabilidad resumida
      // -----------------------------------------------------------------------
      if (col === "avanzado" && id === "contabilidad") {
        const [productos, ventas, gastos] = await Promise.all([
          pbList("productos"), pbList("ventas"), pbList("gastos"),
        ]);
        const mes = mesActualISO();
        const ventasMes  = ventas.filter(v => !v.anulada && v.fecha && v.fecha.slice(0, 7) === mes);
        const ingresos   = ventasMes.reduce((s, v) => s + (v.precioUnit || 0) * (v.cantidad || 1), 0);
        const costoVenta = ventasMes.reduce((s, v) => s + (v.costo || 0) * (v.cantidad || 1), 0);
        const gastosTotal = gastos.filter(g => g.mes === mes).reduce((s, g) => s + (g.monto || 0), 0);
        const inventario  = productos.reduce((s, p) => s + (p.costo || 0) * (p.stockActual || 0), 0);
        return J({
          mes, ingresos: +ingresos.toFixed(2), costoVenta: +costoVenta.toFixed(2),
          utilidadBruta: +(ingresos - costoVenta).toFixed(2),
          gastos: +gastosTotal.toFixed(2),
          utilidadNeta: +(ingresos - costoVenta - gastosTotal).toFixed(2),
          inventario: +inventario.toFixed(2),
        });
      }

      // Ruta no reconocida: pasa al fetch nativo (ej: version.json)
      return _fetch(url, opts);

    } catch (err) {
      console.error("[PocketBase] Error en", u, err);
      return Err("Error de conexion con PocketBase: " + err.message, 503);
    }
  };

  console.info("[AMIGABLE] Conectado a PocketBase:", PB_URL);
})();
