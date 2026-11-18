#!/usr/bin/env node
// Gate D · QA store history reader (JFC 2026-11-18). Same cold-join as scripts/canario-union-fria.cjs,
// stopped BEFORE any PIN: no Owner session. Non-GET HTTP to Firebase is aborted in the browser.
// Writes the QA store's Yjs state (catalog "-y" and ops "-ops") ONLY to $OUT_DIR on the runner.
// Logs counts, booleans and (only when pending) Yjs client ids. Never license, PIN, room or content.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = 'https://jfcarpiopuntocom.github.io/friendly-123/';
const LICENCIA = process.env.F123_CANARIO_LICENCIA, OUT = process.env.OUT_DIR;
if (!LICENCIA || !OUT) { console.error('CONFIG: falta licencia u OUT_DIR'); process.exit(2); }
const seguro = e => ['Error', 'TimeoutError', 'TargetClosedError', 'TypeError'].includes(e && e.name) ? e.name : 'Error';

const estado = p => p.evaluate(lic => {
  try {
    const o = JSON.parse(localStorage.getItem('f123_owned') || '{}');
    const y = window.OCYjs, code = String(lic).trim().toUpperCase();
    const st = d => d && d.store ? { structs: [...d.store.clients.values()].reduce((n, a) => n + a.length, 0),
      pend: !!(d.store.pendingStructs || d.store.pendingDs) } : null;
    return { unido: String(o.licenseCode || '').toUpperCase() === code && !!(y && y.roomId),
      cat: st(y && y.doc), ops: st(y && y.opsDoc),
      recuperando: !!(y && ((y.canal && y.canal.recuperando) || (y.opsCanal && y.opsCanal.recuperando))),
      idb: !!(y && y.idb && y.idb.synced === true) };
  } catch (_) { return { error: true }; }
}, LICENCIA).catch(() => ({ error: true }));

(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  const bloqueadas = {};
  await p.route(/firebaseio\.com/, r => { const m = r.request().method();
    if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return r.continue();
    bloqueadas[m] = (bloqueadas[m] || 0) + 1; return r.abort(); });
  p.setDefaultTimeout(30000);
  let fallo = '';
  try {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.locator('#oc-gate button[data-d]').first().waitFor({ state: 'visible' });
    for (const c of '789') { await p.locator('#oc-gate button[data-d="' + c + '"]').first().click(); await p.waitForTimeout(150); }
    await p.click('#oc-act-unirme');
    await p.fill('#oc-ue-codigo', LICENCIA);
    await p.click('#oc-ue-confirmar');
    let e = null; const t0 = Date.now();
    while (Date.now() - t0 < 20000) { await p.waitForTimeout(2000); e = await estado(p); if (e.unido) break; }
    if (!e || !e.unido) throw Object.assign(new Error('x'), { name: 'Error', etapa: 'UNION' });
    // Stop on verified recovery, 150 s without struct progress, or 300 s budget (canary's CI budget).
    let avance = Date.now(), prev = -1; const t1 = Date.now();
    for (;;) {
      await p.waitForTimeout(2000); e = await estado(p);
      const n = (e.cat ? e.cat.structs : 0) + (e.ops ? e.ops.structs : 0);
      if (n > prev) { prev = n; avance = Date.now(); }
      if (e.cat && e.ops && !e.recuperando && e.idb && !e.cat.pend && !e.ops.pend) break;
      if (Date.now() - avance > 150000 || Date.now() - t1 > 300000) { fallo = 'recuperacion incompleta'; break; }
    }
    console.log('LECTOR_ESTADO:', JSON.stringify({ recuperando: e.recuperando, idb: e.idb, cat: e.cat, ops: e.ops, segundos: Math.round((Date.now() - t1) / 1000) }));
    const out = await p.evaluate(() => {
      const Y = window.Y, y = window.OCYjs, b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      const one = d => {
        const m = d.store.pendingStructs && d.store.pendingStructs.missing;
        return { bytes: b64(Y.encodeStateAsUpdate(d)), clientes: d.store.clients.size,
          pendientesClientes: m ? [...m.keys()] : [], pendingDs: !!d.store.pendingDs };
      };
      return { cat: one(y.doc), ops: one(y.opsDoc) };
    });
    fs.mkdirSync(OUT, { recursive: true });
    for (const ch of ['cat', 'ops']) {
      fs.writeFileSync(path.join(OUT, ch + '.bin'), Buffer.from(out[ch].bytes, 'base64'));
      console.log('LECTOR_' + ch.toUpperCase() + ':', JSON.stringify({ bytes: Buffer.from(out[ch].bytes, 'base64').length,
        clientesYjs: out[ch].clientes, padresPendientesClientes: out[ch].pendientesClientes, pendingDs: out[ch].pendingDs }));
    }
  } catch (err) { fallo = 'EXCEPCION ' + (err.etapa || seguro(err)); }
  console.log('LECTOR_FIREBASE_ESCRITURAS_BLOQUEADAS:', JSON.stringify(bloqueadas));
  await b.close();
  if (fallo) { console.log('LECTOR_AVISO: ' + fallo); if (fs.existsSync(OUT)) fs.writeFileSync(path.join(OUT, 'incompleto'), fallo); }
  if (!fs.existsSync(path.join(OUT, 'cat.bin'))) process.exit(1);
})().catch(e => { console.error('FALLA LECTOR: ' + seguro(e)); process.exit(1); });
