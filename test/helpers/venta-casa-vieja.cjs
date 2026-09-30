// Desde el shell v429 (JFC 2026-09-30, "counter no es la casa") ya no se puede CREAR una venta de
// la casa en una percha con trato: COUNTER SALE se comisiona. Pero los cuadernos reales traen
// ventas viejas guardadas como "counter" (split null) y la app las sigue mostrando y corrigiendo.
// Este helper fabrica ese dato viejo por la puerta honesta: respaldo exportado -> venta dejada
// como la guardaba el shell <= v428 -> respaldo importado. Sin atajos en el codigo de la app.
async function marcarCasaVieja(w, ventaIds) {
  const ids = [].concat(ventaIds).map(String);
  const r = await w.request('/api/respaldo/exportar');
  let n = 0;
  r.ventas.forEach((v) => { if (ids.includes(String(v.id))) { v.split = null; v.modoComision = 'counter'; v.promotoraId = null; delete v.canalVenta; n++; } });
  if (n !== ids.length) throw new Error('venta-casa-vieja: no encontre ' + ids.join(','));
  const res = await w.request('/api/respaldo/importar', 'POST', r);
  if (res && res.error) throw new Error('venta-casa-vieja: ' + res.error);
}
module.exports = { marcarCasaVieja };
