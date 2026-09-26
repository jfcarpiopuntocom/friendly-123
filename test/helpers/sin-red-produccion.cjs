// BLOQUEO-RED-PRODUCCION (JFC 2026-09-25). Bug real: las pruebas abrian la app en Chromium
// y la app mandaba su latido al Worker de licencias de PRODUCCION con licencias de prueba;
// en el panel privado de JFC aparecio una fila "F123-FIXTURE-LORD". Este archivo se carga
// antes de cada prueba (package.json: node --require) y hace que TODO navegador de prueba
// aborte cualquier pedido a *.workers.dev y a jfcarpio.com. Ninguna prueba necesita esos
// hosts: el backend de la app es local (mock-backend.js). No quitar.
const pw = require('playwright');
const BLOQUEO = /^https?:\/\/([^/]*\.)?(workers\.dev|jfcarpio\.com)(\/|$)/i;
const lanzarOriginal = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...args) => {
  const navegador = await lanzarOriginal(...args);
  const contextoOriginal = navegador.newContext.bind(navegador);
  navegador.newContext = async (...a) => {
    const ctx = await contextoOriginal(...a);
    await ctx.route(BLOQUEO, (ruta) => ruta.abort());
    return ctx;
  };
  // browser.newPage() crea su propio contexto: se fuerza a pasar por el bloqueado.
  navegador.newPage = async (...a) => (await navegador.newContext(...a)).newPage();
  return navegador;
};
