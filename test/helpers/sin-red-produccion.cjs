// BLOQUEO-RED-PRODUCCION (JFC 2026-09-25). Bug real: las pruebas abrian la app en Chromium
// y la app mandaba su latido al Worker de licencias de PRODUCCION con licencias de prueba;
// en el panel privado de JFC aparecio una fila "F123-FIXTURE-LORD". Este archivo se carga
// antes de cada prueba (package.json: node --require) y hace que TODO navegador de prueba
// aborte cualquier pedido a *.workers.dev y a jfcarpio.com. Ninguna prueba necesita esos
// hosts: el backend de la app es local (mock-backend.js). No quitar.
const pw = require('playwright');
const BLOQUEO = /^https?:\/\/([^/]*\.)?(workers\.dev|jfcarpio\.com)(\/|$)/i;
// Las fuentes externas no forman parte del fixture. Una descarga tardia cambia
// la geometria entre lecturas y una conexion caida retrasa cada navegacion.
// Usar siempre el fallback local durante esta suite; no modifica la app publicada.
const FUENTES_EXTERNAS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//i;
// Dashboard tiene fallback HTML propio. Sus pruebas de dinero no requieren
// los exportadores opcionales de CDN; no esperar a Internet para esos casos.
const CDN_EXTERNOS = /^https?:\/\/(unpkg\.com|cdn\.sheetjs\.com|cdnjs\.cloudflare\.com)\//i;
// JFC 2026-10-05: WebKit used to bypass the Chromium-only isolation wrapper.
// Every engine must apply the same production block before any fixture opens a page.
for (const engine of [pw.chromium, pw.webkit, pw.firefox]) {
const lanzarOriginal = engine.launch.bind(engine);
engine.launch = async (...args) => {
  const navegador = await lanzarOriginal(...args);
  const contextoOriginal = navegador.newContext.bind(navegador);
  navegador.newContext = async (...a) => {
    const ctx = await contextoOriginal(...a);
    await ctx.route(BLOQUEO, (ruta) => ruta.abort());
    await ctx.route(FUENTES_EXTERNAS, (ruta) => ruta.abort());
    await ctx.route(CDN_EXTERNOS, (ruta) => ruta.abort());
    return ctx;
  };
  // browser.newPage() crea su propio contexto: se fuerza a pasar por el bloqueado.
  navegador.newPage = async (...a) => (await navegador.newContext(...a)).newPage();
  return navegador;
};
}
