#!/usr/bin/env node
// Cold-join canary for a PRE-EXISTING SYNTHETIC license. No customer or inventory writes.
// At most ONE post-join PIN attempt. PIN retries can lock out a real device.
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'https://jfcarpiopuntocom.github.io/friendly-123/').replace(/\/?$/, '/');
const LICENCIA = process.env.F123_CANARIO_LICENCIA;
const PIN = process.env.F123_CANARIO_PIN || '789';
const SOLO_OBSERVAR = process.env.F123_CANARIO_SOLO_OBSERVAR === '1'; // QA-only: no Owner PIN, never changes normal acceptance
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

// Passive, QA-only observer: never sends relay frames or logs raw cursors,
// client IDs, credentials, ciphertext or room. Browser memory only.
const observarPull = p => p.evaluate(() => {
  try {
    const ws = window.OCYjs && window.OCYjs.canal && window.OCYjs.canal.ws;
    if (!ws || typeof ws.addEventListener !== 'function') return false;
    const old = window.__f123CanarioPull;
    if (old && old.socket === ws) return true;
    const data = old && old.data || {
      paginas: 0, frames: 0, mas: 0, avances: 0, iguales: 0,
      retrocesos: 0, heads: 0, ultimaMas: null, reconexiones: 0
    };
    if (old) data.reconexiones = Math.min(9999, data.reconexiones + 1);
    // Keep the raw cursor only in a closure, never in state or logs.
    let ultimoCursor = null;
    const incrementar = (valor, delta = 1) => Math.min(9999, valor + delta);
    ws.addEventListener('message', ev => {
      if (window.__f123CanarioPull?.socket !== ws ||
          typeof ev.data !== 'string' || ev.data.length > 1024) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.k === 'head-result') {
        data.heads = incrementar(data.heads);
        return;
      }
      if (m.k !== 'pull-page' || !Number.isSafeInteger(m.seq) || m.seq < 0 ||
          !Number.isSafeInteger(m.n) || m.n < 0) return;
      data.paginas = incrementar(data.paginas);
      data.frames = incrementar(data.frames, m.n);
      if (m.more === true) data.mas = incrementar(data.mas);
      data.ultimaMas = m.more === true;
      if (ultimoCursor !== null) {
        if (m.seq > ultimoCursor) data.avances = incrementar(data.avances);
        else if (m.seq === ultimoCursor) data.iguales = incrementar(data.iguales);
        else data.retrocesos = incrementar(data.retrocesos);
      }
      ultimoCursor = m.seq;
    });
    window.__f123CanarioPull = { socket: ws, data };
    return true;
  } catch (_) { return false; }
});

// One bounded read-only metadata lookup for the *active synthetic Firebase room*.
// Never expose URL, room capability, server revision, sequence or encrypted bytes.
// A failed/unknown response is UNKNOWN, never falsely classified as no checkpoint.
const consultarCheckpoint = p => p.evaluate(async () => {
  const desconocido = { consultado: false, checkpointExiste: null, hayOperaciones: null, corte: 'desconocido' };
  let timer = null;
  try {
    const y = window.OCYjs;
    const ws = y && y.canal && y.canal.ws;
    const relay = window.F123FirebaseRelay;
    // relay-selector wraps native sockets in an EventTarget WITHOUT a url.
    // Rebuild exactly the canonical catalog locator IN THIS BROWSER ONLY.
    // Never return or log roomId / locator; they are room capabilities.
    const room = y && y.roomId;
    if (!ws || ws.relayLayer !== 'f123_relay_cupo_fb_v1' ||
        typeof room !== 'string' || !/^[a-f0-9]{40}$/.test(room) ||
        !relay || typeof relay.leerHead !== 'function') return desconocido;
    const locator = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + room + '-y';
    const head = await Promise.race([
      relay.leerHead(locator),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })
    ]);
    if (!head || !Number.isSafeInteger(head.rev) || head.rev < 0 ||
        !Number.isSafeInteger(head.seq) || head.seq < 0) return desconocido;
    const salida = { consultado: true, checkpointExiste: head.rev > 0,
      hayOperaciones: head.seq > 0, corte: head.rev === 0 ? 'sin-checkpoint' : 'desconocido' };
    if (head.rev === 0) return salida;
    // Firebase k/<rev>/s is metadata only: never GET k/<rev> (ciphertext).
    // The private room locator and exact server timestamps stay in browser memory.
    let metaTimer = null;
    try {
      const url = 'https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/' +
        room + '-y/k/' + head.rev + '/s.json';
      const cpSeq = await Promise.race([
        fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        new Promise(resolve => { metaTimer = setTimeout(() => resolve(null), 3000); })
      ]);
      if (!Number.isSafeInteger(cpSeq) || cpSeq < 0) return salida;
      if (cpSeq === 0) salida.corte = 'cursor-cero';
      else if (head.seq <= cpSeq) salida.corte = 'head-no-supera-checkpoint';
      else {
        const diferencia = head.seq - cpSeq;
        salida.corte = diferencia < 60000 ? 'menos-1min' :
          diferencia < 3600000 ? '1min-1h' :
          diferencia < 86400000 ? '1h-1d' : '1d-o-mas';
      }
    } catch (_) { /* Metadata errors remain unknown, never false-fresh. */ }
    finally { if (metaTimer !== null) clearTimeout(metaTimer); }
    return salida;
  } catch (_) { return desconocido; }
  finally { if (timer !== null) clearTimeout(timer); }
});

// Only safe booleans and role are printed: never license, PIN, room ID or encrypted data.
// Synthetic-room metadata ONLY. Firebase shallow=true returns operation keys,
// not ciphertext. No keys, license, room capability or query URL leave this browser.
const contarOperaciones = p => p.evaluate(async () => {
  const desconocido = { consultado: false, operaciones: null };
  let timer = null;
  try {
    const y = window.OCYjs, room = y && y.roomId;
    const ws = y && y.canal && y.canal.ws;
    if (!ws || ws.relayLayer !== 'f123_relay_cupo_fb_v1' ||
        typeof room !== 'string' || !/^[a-f0-9]{40}$/.test(room)) return desconocido;
    const url = 'https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/' +
      room + '-y/o.json?shallow=true';
    const request = fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' })
      .then(async r => {
        if (!r || !r.ok) return desconocido;
        // Avoid parsing massive metadata responses in the QA browser.
        const size = Number(r.headers && r.headers.get && r.headers.get('content-length') || 0);
        if (size > 3 * 1024 * 1024) return desconocido;
        const raw = await r.text();
        if (raw.length > 3 * 1024 * 1024) return desconocido;
        const obj = JSON.parse(raw);
        if (obj === null) return { consultado: true, operaciones: 0 };
        if (!obj || Array.isArray(obj) || typeof obj !== 'object') return desconocido;
        const ids = Object.keys(obj);
        if (!ids.every(key => obj[key] === true)) return desconocido;
        return { consultado: true, operaciones: ids.length };
      }).catch(() => desconocido);
    return await Promise.race([
      request,
      new Promise(resolve => { timer = setTimeout(() => resolve(desconocido), 8000); })
    ]);
  } catch (_) { return desconocido; }
  finally { if (timer !== null) clearTimeout(timer); }
}).catch(() => ({ consultado: false, operaciones: null }));

const diagnostico = (p, licencia) => p.evaluate((lic) => {
  try {
    const o = JSON.parse(localStorage.getItem('f123_owned') || '{}');
    const s = JSON.parse(localStorage.getItem('f123_sync_room') || '{}');
    const y = window.OCYjs;
    const code = String(lic || '').trim().toUpperCase();
    // Unknown must remain null: never misreport an uninitialized counter as zero.
    const count = v => Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 9999) : null;
    const clients = y && y.doc && y.doc.store && y.doc.store.clients;
    const observador = window.__f123CanarioPull;
    const pull = observador && y && y.canal && observador.socket === y.canal.ws
      ? observador.data : null;
    return {
      licenciaAdoptada: String(o.licenseCode || '').toUpperCase() === code,
      syncCodeIgual: String(o.syncCode || '').toUpperCase() === code,
      salaCorrecta: String(s.codigo || '').toUpperCase() === code,
      tieneDispositivo: !!o.instanceId,
      tieneRoomYjs: !!(y && y.roomId),
      tieneCanalCatalogo: !!(y && y.canal),
      catalogoRecuperando: !!(y && y.canal && y.canal.recuperando),
      operacionesRecuperando: !!(y && y.opsCanal && y.opsCanal.recuperando),
      fotosRecuperando: !!(y && y.fotosCanal && y.fotosCanal.recuperando),
      socketCatalogo: y && y.canal && y.canal.ws ? y.canal.ws.readyState : null,
      socketFotos: y && y.fotosCanal && y.fotosCanal.ws ? y.fotosCanal.ws.readyState : null,
      socketOperaciones: y && y.opsCanal && y.opsCanal.ws ? y.opsCanal.ws.readyState : null,
      hidratacionLocalPendiente: !!(y && y._diag && y._diag().recuperacionLocalPendiente),
      // Mirror the existing catalog hydration contract without serializing a huge Y.Doc.
      catalogoIdbSincronizado: !!(y && y.idb && y.idb.synced === true),
      catalogoSinPendientesCausales: !!(y && y.doc && y.doc.store &&
        !y.doc.store.pendingStructs && !y.doc.store.pendingDs),
      // Bounded, read-only causal evidence. Never print Yjs client IDs or room identifiers.
      catalogoPendientesStructs: !!(y && y.doc && y.doc.store && y.doc.store.pendingStructs),
      catalogoPendientesDs: !!(y && y.doc && y.doc.store && y.doc.store.pendingDs),
      catalogoPadresFaltantes: (() => {
        const missing = y && y.doc && y.doc.store && y.doc.store.pendingStructs &&
          y.doc.store.pendingStructs.missing;
        return missing && typeof missing.size === 'number' ? Math.min(9999, missing.size) : 0;
      })(),
      catalogoClientesAplicados: count(clients && clients.size),
      catalogoEstructurasAplicadas: (() => {
        if (!clients || typeof clients.forEach !== 'function') return null;
        let total = 0;
        clients.forEach(structs => { if (Array.isArray(structs)) total += structs.length; });
        return count(total);
      })(),
      catalogoPendientesOutbox: count(y && y.canal && y.canal.pendientesRelay),
      catalogoHuerfanos: count(y && y.canal && y.canal.huerfanosHeredados),
      observadorPull: !!pull,
      pullPaginas: count(pull && pull.paginas),
      pullFrames: count(pull && pull.frames),
      pullMas: count(pull && pull.mas),
      pullAvances: count(pull && pull.avances),
      pullIguales: count(pull && pull.iguales),
      pullRetrocesos: count(pull && pull.retrocesos),
      pullHeads: count(pull && pull.heads),
      pullUltimaMas: pull ? pull.ultimaMas : null,
      pullReconexiones: count(pull && pull.reconexiones),
      catalogoTransporte: (() => {
        const ws = y && y.canal && y.canal.ws, layer = ws && ws.relayLayer;
        return layer === 'f123_relay_cupo_v1' ? 'supabase' :
          layer === 'f123_relay_cupo_fb_v1' ? 'firebase' :
          layer === 'peer' || (ws && ws.peerOnly === true) ? 'peer' : 'unknown';
      })(),
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
      await observarPull(p); // attach to the synthetic catalog socket only
      await p.waitForTimeout(5000);
      ultima = await diagnostico(p, LICENCIA);
      console.log('CANARIO_CAUSAL_INICIO:', JSON.stringify({
        catalogoPendientesStructs: ultima && ultima.catalogoPendientesStructs,
        catalogoPendientesDs: ultima && ultima.catalogoPendientesDs,
        catalogoPadresFaltantes: ultima && ultima.catalogoPadresFaltantes,
        catalogoTransporte: ultima && ultima.catalogoTransporte,
        cantidadProductos: ultima && ultima.cantidadProductos,
        catalogoRecuperando: ultima && ultima.catalogoRecuperando
      }));
      // Existing-store 789 must never be tested against a half-recovered
      // catalog: the true Owner PIN belongs to the encrypted store metadata.
      // Wait for *evidence*, not a blind 5-second timer; no PIN retries.
      const recuperacionVerificada = d => !!(d && !d.lecturaDiagnosticoFallida &&
        d.tieneRoomYjs === true && d.tieneCanalCatalogo === true &&
        d.catalogoRecuperando === false && d.hidratacionLocalPendiente === false &&
        d.catalogoIdbSincronizado === true && d.catalogoSinPendientesCausales === true &&
        d.tieneMetadatosPin === true);
      const limiteRecuperacion = Date.now() + (SOLO_OBSERVAR ? 90000 : 20000);
      let siguientePulsoCausal = Date.now() + 4000;
      while (!recuperacionVerificada(ultima) && Date.now() < limiteRecuperacion) {
        await p.waitForTimeout(2000);
        await observarPull(p); // a reconnect may replace the socket
        ultima = await diagnostico(p, LICENCIA);
        if (Date.now() >= siguientePulsoCausal) {
          siguientePulsoCausal = Date.now() + 4000;
          // Read-only, bounded trajectory: counts and booleans only. Never
          // print encrypted payloads, Yjs client IDs, room, license or PIN.
          const d = ultima || {};
          const n = v => Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 9999) : 0;
          const socket = v => [0, 1, 2, 3].includes(v) ? v : null;
          console.log('CANARIO_CAUSAL_PULSO:', JSON.stringify({
            segundos: Math.max(0, Math.floor((Date.now() - t0) / 1000)),
            catalogoRecuperando: d.catalogoRecuperando === true,
            pendientesStructs: d.catalogoPendientesStructs === true,
            pendientesDs: d.catalogoPendientesDs === true,
            padresFaltantes: n(d.catalogoPadresFaltantes),
            clientesYjsAplicados: Number.isSafeInteger(d.catalogoClientesAplicados) ? n(d.catalogoClientesAplicados) : null,
            estructurasYjsAplicadas: Number.isSafeInteger(d.catalogoEstructurasAplicadas) ? n(d.catalogoEstructurasAplicadas) : null,
            outboxCatalogo: Number.isSafeInteger(d.catalogoPendientesOutbox) ? n(d.catalogoPendientesOutbox) : null,
            huerfanosCatalogo: Number.isSafeInteger(d.catalogoHuerfanos) ? n(d.catalogoHuerfanos) : null,
            observadorPull: d.observadorPull === true,
            pullPaginas: Number.isSafeInteger(d.pullPaginas) ? n(d.pullPaginas) : null,
            pullFrames: Number.isSafeInteger(d.pullFrames) ? n(d.pullFrames) : null,
            pullMas: Number.isSafeInteger(d.pullMas) ? n(d.pullMas) : null,
            pullAvances: Number.isSafeInteger(d.pullAvances) ? n(d.pullAvances) : null,
            pullIguales: Number.isSafeInteger(d.pullIguales) ? n(d.pullIguales) : null,
            pullRetrocesos: Number.isSafeInteger(d.pullRetrocesos) ? n(d.pullRetrocesos) : null,
            pullHeads: Number.isSafeInteger(d.pullHeads) ? n(d.pullHeads) : null,
            pullUltimaMas: d.pullUltimaMas === true ? true : d.pullUltimaMas === false ? false : null,
            pullReconexiones: Number.isSafeInteger(d.pullReconexiones) ? n(d.pullReconexiones) : null,
            transporte: ['firebase', 'supabase', 'peer', 'unknown'].includes(d.catalogoTransporte)
              ? d.catalogoTransporte : 'unknown',
            socketCatalogo: socket(d.socketCatalogo),
            socketFotos: socket(d.socketFotos),
            socketOperaciones: socket(d.socketOperaciones),
            productos: n(d.cantidadProductos),
            fotos: n(d.cantidadFotos),
            metadatosOwner: d.tieneMetadatosPin === true
          }));
        }
      }
      if (SOLO_OBSERVAR) {
        // This is NOT an Owner-authentication or physical Sync3 acceptance gate.
        // Observe the existing synthetic room, with NO post-join Owner PIN attempts.
        console.log('CANARIO_OBSERVACION_SOLO:', JSON.stringify({
          segundos: Math.max(0, Math.floor((Date.now() - t0) / 1000)),
          recuperado: recuperacionVerificada(ultima),
          catalogoRecuperando: ultima && ultima.catalogoRecuperando === true,
          padresFaltantes: Number.isSafeInteger(ultima && ultima.catalogoPadresFaltantes)
            ? Math.min(9999, ultima.catalogoPadresFaltantes) : null,
          paginas: Number.isSafeInteger(ultima && ultima.pullPaginas)
            ? Math.min(9999, ultima.pullPaginas) : null,
          metadatosOwner: ultima && ultima.tieneMetadatosPin === true
        }));
        if (!recuperacionVerificada(ultima)) {
          fallo = 'RECUPERACION: catalogo cifrado de la tienda no terminó';
        }
      } else {
      if (!recuperacionVerificada(ultima)) {
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
    }
  } catch (e) {
    // Exception messages sometimes contain URLs and tokens: do not print them.
    fallo = 'EXCEPCION: ' + ((e && e.name) || 'Error') + ' durante la unión';
  }
  ultima = await diagnostico(p, LICENCIA);
  // Diagnostic-only GET after the recovery gate; cannot turn an incomplete
  // Yjs history into GREEN or cause an extra Owner PIN attempt.
  if (SOLO_OBSERVAR) console.log('CANARIO_OPERACIONES_SHALLOW:', JSON.stringify(await contarOperaciones(p)));
  console.log('CANARIO_CHECKPOINT:', JSON.stringify(await consultarCheckpoint(p)));
  console.log('CANARIO_DIAGNOSTICO:', JSON.stringify(ultima));
  if (errores.length) console.log('CANARIO_JS_ERRORES:', errores.slice(0, 3).join(', '));
  await b.close();
  if (fallo) { console.error('FALLA ' + fallo); process.exit(1); }
})().catch(e => { console.error('FALLA CANARIO: ' + ((e && e.name) || 'Error')); process.exit(1); });
