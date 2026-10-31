// UNA LICENCIA = UNA SALA tambien en el sync VIEJO (sync-realtime.js), JFC 2026-09-26.
// Bug: el rescate automatico de licencia (v407, auth-ui.js) pone licenseCode y recarga,
// pero no tocaba f123_sync_room. Yjs ya sigue a la licencia (v295); el sync viejo no:
// quedaba APAGADO o en la sala del codigo VIEJO. Ese sync lleva ops de stock, el PIN
// para entrar desde otro aparato, fotos y checkpoints, y el punto de estado del header
// lee SU estado: el aparato decia "Offline" y no se entendia con los demas.
// Pruebas 1-2 rojas en v413. La 3 cuida que "Deactivate sync" siga mandando.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const engine = process.env.F123_BROWSER === 'webkit' ? webkit : chromium;
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const URL = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
// Codigo ficticio armado en tiempo de ejecucion (el repo es publico: nunca una licencia escrita).
// Sin I/L/O: la app las normaliza a 1/0 (Crockford), igual que con una licencia real.
const LIC = ['F123', 'PRUEBA', 'SAPA', 'NUEVA'].join('-');
const VIEJO = ['F123', 'PRUEBA', 'SAPA', 'ANTES'].join('-');

async function salaTrasCargar(inicial) {
  const web = await engine.launch({ headless: true });
  try {
    const ctx = await web.newContext();
    await ctx.addInitScript((ini) => {
      if (sessionStorage.getItem('__ini')) return; // solo la primera carga
      sessionStorage.setItem('__ini', '1');
      for (const [k, v] of Object.entries(ini)) localStorage.setItem(k, v);
    }, inicial);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    return await page.evaluate(() => JSON.parse(localStorage.getItem('f123_sync_room') || 'null'));
  } finally { await web.close(); }
}
const owned = (lic) => JSON.stringify({ instanceId: 'inst-prueba', licenseCode: lic, syncCode: lic });

test('1. rescued device (license, no room): the old sync joins the license room', async () => {
  const sala = await salaTrasCargar({ f123_owned: owned(LIC) });
  assert.equal(sala && sala.codigo, LIC);
});

test('2. room left on an old code: it moves to the license room', async () => {
  const sala = await salaTrasCargar({ f123_owned: owned(LIC), f123_sync_room: JSON.stringify({ codigo: VIEJO }) });
  assert.equal(sala && sala.codigo, LIC);
});

test('3. owner turned sync off on purpose: it stays off', async () => {
  const web = await engine.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(() => {
      window.OCSyncControl.desactivar();
      return localStorage.getItem('f123_sync_room');
    });
    assert.equal(r, null);
    await page.evaluate((o) => localStorage.setItem('f123_owned', o), owned(LIC));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => localStorage.getItem('f123_sync_room')), null, 'no silent re-enable');
    // Volver a prender borra la marca (activar() puede rechazar este codigo ficticio por
    // su simbolo de verificacion; la marca se borra igual) y al recargar vuelve a su sala.
    await page.evaluate((lic) => { window.OCSyncControl.activar(lic); }, LIC);
    assert.equal(await page.evaluate(() => localStorage.getItem('f123_sync_apagado_v1')), null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => JSON.parse(localStorage.getItem('f123_sync_room') || 'null'));
    assert.equal(back && back.codigo, LIC, 'turning it back on works');
  } finally { await web.close(); }
});


test('4. joined active shop wins over an obsolete owned license and legacy room',async()=>{
  const selected = await salaTrasCargar({
    f123_owned: owned(VIEJO),
    f123_tienda_activa: '::'+LIC,
    f123_notebook_unificado_v2:'1',
    f123_sync_room:JSON.stringify({codigo:VIEJO})
  });
  assert.equal(selected && selected.codigo,LIC,'legacy transport follows active joined notebook');
});

test('5. unknown active identity cannot emit stock into an obsolete room',async()=>{
  const web=await engine.launch({headless:true});
  try{
    const ctx=await web.newContext();
    await ctx.addInitScript((ini)=>{
      localStorage.setItem('f123_owned',ini.owned);
      localStorage.setItem('f123_sync_room',JSON.stringify({codigo:ini.legacy}));
    },{owned:owned(VIEJO),legacy:VIEJO});
    const page=await ctx.newPage();
    await page.goto(URL,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.OCSyncControl,{timeout:10000});
    const result=await page.evaluate(()=>{
      if(!window.OCTienda)return {error:'notebook API missing'};
      window.OCTienda.licenciaActual=()=>{throw Error('synthetic active notebook unavailable')};
      const before=localStorage.getItem('f123_sync_cola');
      const emitted=window.OCSyncEmit('synthetic_adjustment',{delta:1});
      const after=localStorage.getItem('f123_sync_cola');
      return {emitted,before,after};
    });
    assert.equal(result.error,undefined);
    assert.equal(result.emitted,false,'must not emit into old store');
    assert.equal(result.after,result.before,'failed gate must not create a remote op');
  }finally{await web.close()}
});
