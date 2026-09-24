/* Foto de ejemplo para la seccion Commissions del dashboard (Bloque 6b). */
const mes = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); })();
const prev = (() => { const d = new Date(); const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); const m = d.getMonth() === 0 ? 12 : d.getMonth(); return y + "-" + String(m).padStart(2, "0"); })();
const venta = (o) => Object.assign({ id: "v" + Math.random().toString(36).slice(2), fecha: mes + "-10T12:00:00.000Z", mes, cantidad: 1, precioUnit: 50, modoComision: "acuerdo", ubicacionTipo: "socio", liquidada: false }, o);
module.exports = {
  mes, prev,
  datos: {
    resumen: { nombreNegocio: "Fixture Gallery" },
    productos: [], clientes: [], movimientos: [], promotoras: [], gastos: [], transferencias: [], gastosMensuales: {},
    ventas: [
      venta({ productoId: "p1", productoNombre: "Mountain print", sku: "PRN-1", ubicacionId: "u1", ubicacionNombre: "Artist consignment", comisionPct: 85, comisionAsociado: 42.5, netoCasa: 7.5, asociadoNombre: "Ana" }),
      venta({ productoId: "p1", productoNombre: "Mountain print", sku: "PRN-1", ubicacionId: "u1", ubicacionNombre: "Artist consignment", comisionPct: 85, comisionAsociado: 42.5, netoCasa: 7.5, asociadoNombre: "Ana", liquidada: true }),
      venta({ productoId: "p2", productoNombre: "Tote bag", sku: "TOTE", ubicacionId: "u2", ubicacionNombre: "Weekend fair", precioUnit: 20, comisionPct: 10, comisionAsociado: 2, netoCasa: 18, asociadoNombre: "Luis", asistenteNombre: "Hugo", reparto: [{ rol: "vendedor", monto: 1.34 }, { rol: "asistente", pct: 33, monto: 0.66 }] }),
      venta({ productoId: "p3", productoNombre: "Coffee", sku: "CAF", ubicacionId: "u2", ubicacionNombre: "Weekend fair", precioUnit: 3, comisionPct: null, comisionAsociado: 0, modoComision: "counter" }),
      venta({ productoId: "p1", productoNombre: "Mountain print", sku: "PRN-1", ubicacionId: "u1", ubicacionNombre: "Artist consignment", comisionPct: 85, comisionAsociado: 42.5, netoCasa: 7.5, asociadoNombre: "Ana", mes: prev, fecha: prev + "-05T12:00:00.000Z" }),
    ],
    liquidaciones: [
      { ubicacionId: "u1", ubicacion: "Artist consignment", asociadoNombre: "Ana", pctEfectivo: 85, metaMensual: 800, cumplimientoMeta: 12.5, tieneEscalas: true, estado: "pendiente", ventasPendientes: 1, detallePendientes: [{ producto: "Mountain print", cantidad: 1, comisionSocio: 42.5 }], ajustes: [{ id: "aj1", fecha: mes + "-11T10:00:00.000Z", quien: "Paco", motivo: "broken frame", montoComisionSocio: -42.5, liquidada: false }], repartoPersonas: [], ventasCorregidas: 0 },
      { ubicacionId: "u2", ubicacion: "Weekend fair", asociadoNombre: "Luis", pctEfectivo: 10, estado: "pendiente", ventasPendientes: 1, detallePendientes: [{ producto: "Tote bag", cantidad: 1, comisionSocio: 2 }], ajustes: [], repartoPersonas: [{ promotoraId: "a", nombre: "Luis", monto: 1.34 }, { promotoraId: "b", nombre: "Hugo", monto: 0.66 }], ventasCorregidas: 0 },
    ],
  },
};
