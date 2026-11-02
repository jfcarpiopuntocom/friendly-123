#!/usr/bin/env node
// Daily live check: a brand-new device joins a full synthetic store with nobody else open and must see its real
// quantity. Reports only: it is not called by hotfix.yml, so it never blocks a release.
// It reuses one synthetic license, so a failure of this script can never touch a customer. Each run adds one device row
// under that license. Usage: F123_CANARIO_LICENCIA=<synthetic> node scripts/canario-union-fria.cjs [baseUrl]
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'https://jfcarpiopuntocom.github.io/friendly-123/').replace(/\/?$/, '/');
const LICENCIA = process.env.F123_CANARIO_LICENCIA, PRODUCTO = 'Taza QA', ESPERADO = 9;
if (!LICENCIA) { console.log('Sin F123_CANARIO_LICENCIA: no se corre.'); process.exit(0); }
const teclear = async (p, code) => { for (const c of code) { await p.locator(`#oc-gate button[data-d="${c}"]`).first().click(); await p.waitForTimeout(150); } };
const rol = p => p.evaluate(() => { try { return OCAuth.rolActual(); } catch (_) { return null; } }).catch(() => null);
const stock = p => p.evaluate(async n => { try { const x = await (await fetch('/api/productos')).json(); const f = (Array.isArray(x) ? x : (x.productos || [])).find(q => q.nombre === n); return f ? f.stockActual : null; } catch (_) { return null; } }, PRODUCTO).catch(() => null);
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errores = [];
  p.on('pageerror', e => errores.push(e.message.slice(0, 160)));
  p.setDefaultTimeout(30000);
  let fallo = '';
  try {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.locator('#oc-gate button[data-d]').first().waitFor({ state: 'visible' });
    await teclear(p, '789');
    await p.click('#oc-act-unirme');
    await p.fill('#oc-ue-codigo', LICENCIA);
    await p.click('#oc-ue-confirmar');
    const t0 = Date.now();
    let dentro = false, v = null;
    while (Date.now() - t0 < 120000) { // shortcut: the 789 here is this synthetic store's real PIN; a store with its own PIN needs another secret.
      await p.waitForTimeout(5000);
      if (!dentro) {
        if (await rol(p) === 'dueno') dentro = true;
        else if (await p.locator('#oc-gate button[data-d]').first().isVisible().catch(() => false)) await teclear(p, '789').catch(() => {});
        continue;
      }
      v = await stock(p);
      if (v === ESPERADO) break;
    }
    if (!dentro) fallo = 'no pudo entrar a la tienda tras unirse';
    else if (v !== ESPERADO) fallo = `${PRODUCTO} muestra ${v}, esperado ${ESPERADO}`;
    else console.log(`OK aparato nuevo ve ${PRODUCTO}=${v} en ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) { fallo = e.message.split('\n')[0]; }
  if (errores.length) console.log('Errores JS:', errores.slice(0, 3).join(' | '));
  await b.close();
  if (fallo) { console.log('FALLA ' + fallo); process.exit(1); }
})();
