#!/usr/bin/env node
// Cold-join canary for a PRE-EXISTING SYNTHETIC license. No customer or inventory writes.
// At most ONE post-join PIN attempt. PIN retries can lock out a real device.
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'https://jfcarpiopuntocom.github.io/friendly-123/').replace(/\/?$/, '/');
const LICENCIA = process.env.F123_CANARIO_LICENCIA;
const PIN = process.env.F123_CANARIO_PIN || '789';
const PRODUCTO = 'Taza QA', ESPERADO = 9;
if (!LICENCIA) { console.error('CANARIO_CONFIG: falta F123_CANARIO_LICENCIA; prueba NO ejecutada.'); process.exit(2); }
if (!/^\d{3}$/.test(PIN)) { console.error('CANARIO_CONFIG: F123_CANARIO_PIN debe tener tres dígitos.'); process.exit(2); }

async function teclear(p, code) {
  for (const c of code) {
    await p.locator('#oc-gate button[data-d="' + c + '"]').first().click();
    await p.waitForTimeout(150);
  }
}
const rol = p => p.evaluate(() => {
  try { return window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual(); } catch (_) { return null; }
}).catch(() => null);
const stock = p => p.evaluate(async n => {
  try {
    const r = await fetch('/api/productos');
    if (!r.ok) return null;
    const x = await r.json();
    const f = (Array.isArray(x) ? x : (x.productos || [])).find(q => q.nombre === n);
    return f ? f.stockActual : null;
  } catch (_) { return null; }
}, PRODUCTO).catch(() => null);

// Only safe booleans and role are printed: never license, PIN, room ID or encrypted data.
const diagnostico = (p, licencia) => p.evaluate((lic) => {
  try {
    const o = JSON.parse(localStorage.getItem('f123_owned') || '{}');
    const s = JSON.parse(localStorage.getItem('f123_sync_room') || '{}');
    const y = window.OCYjs;
    const code = String(lic || '').trim().toUpperCase();
    return {
      licenciaAdoptada: String(o.licenseCode || '').toUpperCase() === code,
      syncCodeIgual: String(o.syncCode || '').toUpperCase() === code,
      salaCorrecta: String(s.codigo || '').toUpperCase() === code,
      tieneDispositivo: !!o.instanceId,
      tieneRoomYjs: !!(y && y.roomId),
      catalogoRecuperando: !!(y && y.canal && y.canal.recuperando),
      operacionesRecuperando: !!(y && y.opsCanal && y.opsCanal.recuperando),
      fotosRecuperando: !!(y && y.fotosCanal && y.fotosCanal.recuperando),
      socketCatalogo: y && y.canal && y.canal.ws ? y.canal.ws.readyState : null,
      socketFotos: y && y.fotosCanal && y.fotosCanal.ws ? y.fotosCanal.ws.readyState : null,
      socketOperaciones: y && y.opsCanal && y.opsCanal.ws ? y.opsCanal.ws.readyState : null,
      hidratacionLocalPendiente: !!(y && y._diag && y._diag().recuperacionLocalPendiente),
      cantidadProductos: y && y.mapas && y.mapas.productos ? y.mapas.productos.size : 0,
      cantidadFotos: y && y.fotosMap ? y.fotosMap.size : 0,
      tieneMetadatosPin: !!(y && y.meta && y.meta.get && (y.meta.get('pinsRol') || {}).owner),
      tienePinOwnerNoFactory: !!(y && y.meta && y.meta.get && (y.meta.get('pinsRol') || {}).owner && (y.meta.get('pinsRol') || {}).owner !== '789'),
      rol: window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual() || null
    };
  } catch (_) { return { lecturaDiagnosticoFallida: true }; }
}, licencia).catch(() => ({ lecturaDiagnosticoFallida: true }));

(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errores = [];
  p.on('pageerror', e => errores.push((e.name || 'Error').slice(0, 32)));
  p.setDefaultTimeout(30000);
  let fallo = '', ultima = null;
  const t0 = Date.now();
  try {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.locator('#oc-gate button[data-d]').first().waitFor({ state: 'visible' });
    // Factory 789 is used here only to show "new business or join" on a blank device.
    await teclear(p, '789');
    await p.click('#oc-act-unirme');
    await p.fill('#oc-ue-codigo', LICENCIA);
    await p.click('#oc-ue-confirmar');
    console.log('CANARIO_ETAPA: unión solicitada');
    // A join switches notebook (and often reloads the document): prove identity, not just dialog closure.
    const limiteJoin = Date.now() + 20000;
    while (Date.now() < limiteJoin) {
      await p.waitForTimeout(2000);
      ultima = await diagnostico(p, LICENCIA);
      if (ultima && ultima.licenciaAdoptada && ultima.syncCodeIgual &&
          ultima.salaCorrecta && ultima.tieneDispositivo) break;
    }
    if (!ultima || !ultima.licenciaAdoptada || !ultima.syncCodeIgual ||
        !ultima.salaCorrecta || !ultima.tieneDispositivo) {
      fallo = 'UNION: licencia, sala o identidad de dispositivo no se adoptaron';
    } else {
      console.log('CANARIO_ETAPA: licencia y sala correctas');
      await p.waitForTimeout(5000);
      ultima = await diagnostico(p, LICENCIA);
      // Existing-store 789 must never be tested against a half-recovered
      // catalog: the true Owner PIN belongs to the encrypted store metadata.
      // Wait for *evidence*, not a blind 5-second timer; no PIN retries.
      const limiteRecuperacion = Date.now() + 20000;
      while (ultima && ultima.catalogoRecuperando && Date.now() < limiteRecuperacion) {
        await p.waitForTimeout(2000);
        ultima = await diagnostico(p, LICENCIA);
      }
      if (!ultima || ultima.catalogoRecuperando) {
        fallo = 'RECUPERACION: catalogo cifrado de la tienda no terminó';
      } else if (PIN === '789' && ultima.tienePinOwnerNoFactory) {
        fallo = 'ACCESO: F123_CANARIO_PIN requiere PIN Owner sintético actualizado';
      } else if (await rol(p) !== 'dueno') {
        if (await p.locator('#oc-gate button[data-d]').first().isVisible().catch(() => false)) {
          await teclear(p, PIN); // ONE attempt, never repeated while waiting for Yjs.
          console.log('CANARIO_ETAPA: un único PIN introducido');
        } else {
          console.log('CANARIO_ETAPA: compuerta de PIN no disponible');
        }
      }
      const limiteLogin = fallo ? Date.now() : Date.now() + 30000;
      while (Date.now() < limiteLogin && await rol(p) !== 'dueno') await p.waitForTimeout(2000);
      if (fallo || await rol(p) !== 'dueno') {
        fallo = fallo || 'ACCESO: la tienda sintética no aceptó el PIN configurado';
      } else {
        console.log('CANARIO_ETAPA: Owner autenticado');
        let v = null;
        const limiteDatos = Date.now() + 60000;
        while (Date.now() < limiteDatos) {
          v = await stock(p);
          if (v === ESPERADO) break;
          await p.waitForTimeout(3000);
        }
        if (v !== ESPERADO) {
          fallo = 'DATOS: ' + PRODUCTO + ' leído ' + (v === null ? 'ausente' : v) +
            ', esperado ' + ESPERADO;
        } else {
          console.log('OK unión fría: ' + PRODUCTO + '=' + ESPERADO + ' en ' +
            Math.round((Date.now() - t0) / 1000) + ' s');
        }
      }
    }
  } catch (e) {
    // Exception messages sometimes contain URLs and tokens: do not print them.
    fallo = 'EXCEPCION: ' + ((e && e.name) || 'Error') + ' durante la unión';
  }
  ultima = await diagnostico(p, LICENCIA);
  console.log('CANARIO_DIAGNOSTICO:', JSON.stringify(ultima));
  if (errores.length) console.log('CANARIO_JS_ERRORES:', errores.slice(0, 3).join(', '));
  await b.close();
  if (fallo) { console.error('FALLA ' + fallo); process.exit(1); }
})().catch(e => { console.error('FALLA CANARIO: ' + ((e && e.name) || 'Error')); process.exit(1); });
