// Verificador de cuadre (JFC 2026-09-24, corrida Hugo/Paco/Luis sobre Commissions
// y Sold). Lee las MISMAS rutas que pintan las pantallas y exige que el mismo
// dinero y el mismo stock digan lo mismo en todas. Devuelve la lista de
// descuadres (vacia = cuadra). No corrige nada: solo mide.
const c2 = (n) => Math.round((Number(n) || 0) * 100);
const hoyLocal = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fechaLocal = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function cuadre(w, { stockEsperado } = {}) {
  const fallas = [];
  const mal = (regla, detalle) => fallas.push(regla + ': ' + detalle);
  const ventas = await w.request('/api/ventas/todas');
  const productos = await w.request('/api/productos');
  const liq = await w.request('/api/liquidaciones');
  const dash = await w.request('/api/dashboard');
  const pl = await w.request('/api/reportes/pl');
  const val = await w.request('/api/reportes/valorizado');

  // R1. Cada venta: comision + neto de la casa = bruto, al centavo.
  for (const v of ventas) {
    const bruto = c2(v.precioUnit * v.cantidad);
    if (v.netoCasa !== null && v.netoCasa !== undefined && c2(v.comisionAsociado) + c2(v.netoCasa) !== bruto)
      mal('R1 comision+neto=bruto', `${v.id} ${v.productoNombre}: ${v.comisionAsociado} + ${v.netoCasa} != ${bruto / 100}`);
    if (v.modoComision === 'counter' && c2(v.comisionAsociado) !== 0) mal('R1b counter sin comision', `${v.id} comision ${v.comisionAsociado}`);
    if (v.cortesia && c2(v.precioUnit) !== 0) mal('R1c cortesia sin ingreso', `${v.id} precio ${v.precioUnit}`);
    if (v.cortesia && c2(v.comisionAsociado) !== 0) mal('R1d cortesia sin comision', `${v.id} comision ${v.comisionAsociado}`);
    if (c2(v.comisionAsociado) < 0 || v.cantidad <= 0 || v.precioUnit < 0) mal('R1e signos', `${v.id} cant ${v.cantidad} precio ${v.precioUnit} com ${v.comisionAsociado}`);
  }

  // R2. Hoy: la suma de las ventas del dia = Today (entra/sale/cuenta) = P&L.
  const deHoy = ventas.filter((v) => fechaLocal(v.fecha) === hoyLocal());
  // Devoluciones de ventas pagadas: restan el dia del ajuste (misma regla que Commissions).
  const idsDev = liq.flatMap((l) => (l.ajustes || []).filter((a) => a.tipo === 'devolucion' && fechaLocal(a.fecha) === hoyLocal()).map((a) => a.ventaId));
  const devHoy = ventas.filter((v) => idsDev.includes(v.id));
  const ingresoHoy = deHoy.reduce((a, v) => a + c2(v.precioUnit * v.cantidad), 0) - devHoy.reduce((a, v) => a + c2(v.precioUnit * v.cantidad), 0);
  const costoHoy = deHoy.reduce((a, v) => a + c2((v.costoUnit || 0) * v.cantidad), 0) - devHoy.reduce((a, v) => a + c2((v.costoUnit || 0) * v.cantidad), 0);
  if (ingresoHoy !== c2(dash.resumenDia.entra)) mal('R2 Today entra', `ventas ${ingresoHoy / 100} vs Today ${dash.resumenDia.entra}`);
  if (costoHoy !== c2(dash.resumenDia.sale)) mal('R2 Today sale (costo)', `ventas ${costoHoy / 100} vs Today ${dash.resumenDia.sale}`);
  if (ingresoHoy !== c2(pl.ingresos)) mal('R2 P&L ingresos', `ventas ${ingresoHoy / 100} vs P&L ${pl.ingresos}`);
  if (costoHoy !== c2(pl.costoVentas)) mal('R2 P&L costo', `ventas ${costoHoy / 100} vs P&L ${pl.costoVentas}`);
  if (deHoy.length !== dash.resumenDia.ventasCount) mal('R2 Today cuenta', `ventas ${deHoy.length} vs Today ${dash.resumenDia.ventasCount}`);

  // R3. Commissions: por percha, comision + neto = bruto; y el bruto y la
  // comision salen de las MISMAS ventas del mes que lista Sold (mas ajustes).
  for (const l of liq) {
    if (c2(l.comisionSocio) + c2(l.netoDueno) !== c2(l.ventasBrutas))
      mal('R3 percha comision+neto=bruto', `${l.ubicacion}: ${l.comisionSocio} + ${l.netoDueno} != ${l.ventasBrutas}`);
    // COUNTER SALE es de la casa: Commissions la deja fuera del bruto a proposito.
    const delMes = ventas.filter((v) => v.ubicacionId === l.ubicacionId && v.mes === l.mes && v.modoComision !== 'counter');
    const aj = (l.ajustes || []);
    const brutoV = delMes.reduce((a, v) => a + c2(v.precioUnit * v.cantidad), 0) + aj.reduce((a, x) => {
      // La ruta no expone el bruto del ajuste: una devolucion resta el bruto de su venta.
      if (x.montoBruto !== undefined) return a + c2(x.montoBruto);
      const vo = ventas.find((v) => v.id === x.ventaId);
      return a - (vo ? c2(vo.precioUnit * vo.cantidad) : 0);
    }, 0);
    const comV = delMes.reduce((a, v) => a + c2(v.comisionAsociado), 0) + aj.reduce((a, x) => a + c2(x.montoComisionSocio), 0);
    if (brutoV !== c2(l.ventasBrutas)) mal('R3b bruto percha = ventas Sold', `${l.ubicacion}: Sold ${brutoV / 100} vs Commissions ${l.ventasBrutas}`);
    if (comV !== c2(l.comisionSocio)) mal('R3c comision percha = ventas Sold', `${l.ubicacion}: Sold ${comV / 100} vs Commissions ${l.comisionSocio}`);
  }

  // R4. Inventario: valorizado = suma stock x costo/precio; Today usa el mismo numero.
  const activos = productos;
  const vC = activos.reduce((a, p) => a + c2((p.costo || 0) * p.stockActual), 0);
  const vV = activos.reduce((a, p) => a + c2((p.precio || 0) * p.stockActual), 0);
  if (vC !== c2(val.totales.valorCosto)) mal('R4 valorizado costo', `productos ${vC / 100} vs reporte ${val.totales.valorCosto}`);
  if (vV !== c2(val.totales.valorVenta)) mal('R4 valorizado venta', `productos ${vV / 100} vs reporte ${val.totales.valorVenta}`);
  for (const p of activos) if (p.stockActual < 0 || !Number.isInteger(p.stockActual)) mal('R4b stock entero >= 0', `${p.nombre}: ${p.stockActual}`);

  // R5. Stock esperado segun las operaciones que el test SI hizo.
  if (stockEsperado) for (const [id, n] of Object.entries(stockEsperado)) {
    const p = productos.find((x) => x.id === id);
    if (p && p.stockActual !== n) mal('R5 stock = operaciones', `${p.nombre}: esperado ${n}, real ${p.stockActual}`);
  }
  return fallas;
}
module.exports = { cuadre, c2 };
