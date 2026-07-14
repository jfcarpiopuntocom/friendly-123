// seed-data.js — Datos de ejemplo: tienda de artesanías y licores (Cuenca, Ecuador).
// Fuente única de verdad para la demo. db.js y public/mock-backend.js lo importan
// para no desincronizarse. Precios en USD (moneda de Ecuador).

// Campos agregados 2026-07-01 (tronco 16):
//   activa: bool — una ubicación desactivada conserva TODO su historial
//     (ventas, movimientos) pero deja de aparecer en el selector operativo y
//     no puede recibir ventas nuevas. Es un "archivar", no un borrar.
//   tipo: "propio" | "socio" | "franquicia" | "consignacion".
// Campos agregados 2026-07-01 (brotes 1 y 3 — revenue sharing dinámico):
//   comisionSocio: % base del socio (0-100) si NO hay escalas configuradas.
//   metaMensual: meta de ventas en USD del mes para esta ubicación.
//   escalasComision: [{hasta:<% de meta cumplida>, comision:<%>}, ...] —
//     ordenadas ascendente por "hasta". Cada venta se factura con la
//     comisión de la escala vigente SEGÚN el % de meta acumulado ese mes
//     HASTA e INCLUYENDO esa venta — así el socio ve subir su comisión en
//     tiempo real conforme se acerca/supera la meta, no solo al cierre.
const ubicaciones = [
  { id: "centro", nombre: "Local Centro Histórico", activa: true, tipo: "propio" },
  {
    id: "mercado", nombre: "Stand Mercado 10 de Agosto", activa: true, tipo: "socio",
    comisionSocio: 25, metaMensual: 300,
    escalasComision: [
      { hasta: 80, comision: 25 },
      { hasta: 100, comision: 30 },
      { hasta: 120, comision: 35 },
      { hasta: 999, comision: 40 },
    ],
  },
  { id: "feria", nombre: "Feria Artesanal El Otorongo", activa: true, tipo: "consignacion", comisionSocio: 30, metaMensual: 200, escalasComision: [] },
];

const productos = [
  // ---------- Licores ----------
  { id: "p01", nombre: "Zhumir Seco 750ml", categoria: "Licores", sku: "ZHU-SEC-750", barcode: "7861000010019", ubicacionId: "centro", precio: 8.5, costo: 5.9, stockActual: 42, umbralRojo: 10, umbralAmarillo: 20, proveedor: "Distribuidora Azuay" },
  { id: "p02", nombre: "Canelazo Artesanal 750ml", categoria: "Licores", sku: "CAN-ART-750", barcode: "7861000010026", ubicacionId: "centro", precio: 12.0, costo: 6.5, stockActual: 8, umbralRojo: 10, umbralAmarillo: 18, proveedor: "Licores del Tomebamba" },
  { id: "p03", nombre: "Aguardiente Puntas Cuenca 1L", categoria: "Licores", sku: "AGU-PUN-1L", barcode: "7861000010033", ubicacionId: "mercado", precio: 6.0, costo: 3.2, stockActual: 30, umbralRojo: 12, umbralAmarillo: 24, proveedor: "Licores del Tomebamba" },
  { id: "p04", nombre: "Ron San Miguel Añejo 750ml", categoria: "Licores", sku: "RON-SM-750", barcode: "7861000010040", ubicacionId: "centro", precio: 14.5, costo: 9.8, stockActual: 16, umbralRojo: 6, umbralAmarillo: 12, proveedor: "Distribuidora Azuay" },
  { id: "p05", nombre: "Vino Hervido Caliente 500ml", categoria: "Licores", sku: "VIN-HER-500", barcode: "7861000010057", ubicacionId: "feria", precio: 5.5, costo: 2.8, stockActual: 3, umbralRojo: 8, umbralAmarillo: 16, proveedor: "Licores del Tomebamba", perecible: true, fechaCaducidad: "2026-07-05", metodoCosteo: "FIFO", lotes: [] },
  { id: "p06", nombre: "Draque de Mora Artesanal 750ml", categoria: "Licores", sku: "DRA-MOR-750", barcode: "7861000010064", ubicacionId: "mercado", precio: 11.0, costo: 6.0, stockActual: 22, umbralRojo: 8, umbralAmarillo: 16, proveedor: "Licores del Tomebamba", perecible: true, fechaCaducidad: "2026-08-20", metodoCosteo: "FIFO", lotes: [] },

  // ---------- Artesanías ----------
  { id: "p07", nombre: "Sombrero de Paja Toquilla Fino", categoria: "Artesanías", sku: "SOM-PAJ-001", barcode: "7861000020017", ubicacionId: "centro", precio: 45.0, costo: 22.0, stockActual: 14, umbralRojo: 4, umbralAmarillo: 8, proveedor: "Tejedoras de Sígsig" },
  { id: "p08", nombre: "Macana de Ikat Gualaceo", categoria: "Artesanías", sku: "MAC-IKA-001", barcode: "7861000020024", ubicacionId: "feria", precio: 38.0, costo: 18.0, stockActual: 9, umbralRojo: 4, umbralAmarillo: 8, proveedor: "Taller Gualaceo" },
  { id: "p09", nombre: "Aretes de Filigrana de Plata", categoria: "Joyería", sku: "JOY-FIL-001", barcode: "7861000020031", ubicacionId: "centro", precio: 32.0, costo: 14.0, stockActual: 18, umbralRojo: 5, umbralAmarillo: 10, proveedor: "Orfebres Chordeleg" },
  { id: "p10", nombre: "Figura Tallada en Tagua", categoria: "Artesanías", sku: "TAG-FIG-001", barcode: "7861000020048", ubicacionId: "mercado", precio: 9.5, costo: 4.0, stockActual: 4, umbralRojo: 6, umbralAmarillo: 12, proveedor: "Taller El Vergel" },
  { id: "p11", nombre: "Jarrón de Cerámica Pintado", categoria: "Cerámica", sku: "CER-JAR-001", barcode: "7861000020055", ubicacionId: "feria", precio: 18.0, costo: 8.5, stockActual: 12, umbralRojo: 4, umbralAmarillo: 9, proveedor: "Cerámica San Marcos" },
  { id: "p12", nombre: "Olla de Barro Esmaltada", categoria: "Cerámica", sku: "CER-OLL-001", barcode: "7861000020062", ubicacionId: "mercado", precio: 15.0, costo: 7.0, stockActual: 20, umbralRojo: 6, umbralAmarillo: 12, proveedor: "Cerámica San Marcos" },
  { id: "p13", nombre: "Poncho de Lana Cañari", categoria: "Textiles", sku: "TEX-PON-001", barcode: "7861000020079", ubicacionId: "centro", precio: 55.0, costo: 28.0, stockActual: 6, umbralRojo: 3, umbralAmarillo: 6, proveedor: "Tejedoras de Sígsig" },
  { id: "p14", nombre: "Vela Aromática Artesanal", categoria: "Artesanías", sku: "VEL-ARO-001", barcode: "7861000020086", ubicacionId: "feria", precio: 6.5, costo: 2.5, stockActual: 35, umbralRojo: 10, umbralAmarillo: 20, proveedor: "Taller El Vergel" },
  { id: "p15", nombre: "Mermelada Artesanal de Mora 250g", categoria: "Gourmet", sku: "GOU-MER-250", barcode: "7861000020093", ubicacionId: "mercado", precio: 4.0, costo: 1.6, stockActual: 28, umbralRojo: 10, umbralAmarillo: 18, proveedor: "Productos del Valle", perecible: true, fechaCaducidad: "2026-10-01", metodoCosteo: "FIFO", lotes: [] },
  // Mismo artículo (mismo SKU) también en Centro, con stock bajo a propósito
  // — demuestra "inventario compartido inteligente" (brote 2): Centro está
  // en rojo pero hay 35 unidades sanas en Feria, a un banner de distancia.
  { id: "p16", nombre: "Vela Aromática Artesanal", categoria: "Artesanías", sku: "VEL-ARO-001", barcode: "7861000020086", ubicacionId: "centro", precio: 6.5, costo: 2.5, stockActual: 2, umbralRojo: 10, umbralAmarillo: 20, proveedor: "Taller El Vergel" },
];

const configuracion = { gastosMensuales: { centro: 0, mercado: 0, feria: 0 } };

// Promotores/embajadores (JFC, 2026-07-01): personas independientes de la
// ubicación (no son "el socio del local", son alguien que trae clientela y
// gana comisión por venta atendida). Un promotor puede trabajar en varios
// locales/perchas a la vez — por eso ubicacionesIds es un arreglo, no un
// solo id. La comisión del promotor se calcula SOBRE LA MISMA venta que ya
// tiene su split dueño/socio — ver calcularSplitVenta() en data.js — y sale
// del lado del dueño (montoNetoDueno se reduce), nunca del socio del local.
const promotores = [
  { id: "prom-ana", nombre: "Ana Quezada", comisionPct: 8, activo: true, ubicacionesIds: ["centro", "feria"] },
  { id: "prom-luis", nombre: "Luis Delgado", comisionPct: 10, activo: true, ubicacionesIds: ["mercado"] },
];

module.exports = { ubicaciones, productos, configuracion, promotores };
