const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(`${name}: statement, contact list and four month breakdowns work in EN/ES`, async () => {
    const web = await engine.launch({ headless: true });
    try {
      const page = await web.newPage({ viewport: { width:390, height:844 } });
      await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href);
      await page.waitForFunction(() => window.OCAuth && window.OCEstado && typeof cargarComisiones === 'function');
      await page.evaluate(async () => {
        window.OCAuth.rolActual = () => 'dueno';
        const req = async (u,m='GET',b) => (await fetch(u,{method:m,body:b ? JSON.stringify(b) : undefined})).json();
        const person = await req('/api/promotoras','POST',{nombre:'Candy Synthetic',comisionBase:40,telefono:'+593 999 123 456'});
        const rack = await req('/api/ubicaciones','POST',{nombre:'Synthetic studio',tipo:'socio'});
        await req('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
        const p = await req('/api/productos','POST',{nombre:'Synthetic cup',barcode:'BROWSER-STATEMENT',precio:100,costo:20,stockInicial:5,ubicacionId:rack.id});
        await req('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
        await req('/api/payouts','POST',{ubicacionId:rack.id,payeeId:person.id,mes:new Date().toISOString().slice(0,7),medioPago:'transferencia',amountCents:1500,opId:'external-browser-partial'});
        window.__statementFixture = {person,rack};
        document.getElementById('oc-gate').style.display = 'none';
        document.getElementById('vista-comisiones').hidden = false;
        document.querySelectorAll('.vista').forEach(v => v.classList.toggle('activa',v.id === 'vista-comisiones'));
        await cargarComisiones(); await renderGestionPromotoras();
      });
      for (const lang of ['en','es']) {
        await page.evaluate(async lang => { OCI18n.setLang(lang); await cargarComisiones(); await renderGestionPromotoras(); },lang);
        const totals = page.locator('[data-comm-total]');
        assert.equal(await totals.count(),4);
        assert.match(await totals.first().innerText(),lang === 'es' ? /Ventas con comisión/i : /Sales with commission/i);
        for (let n=0;n<4;n++) {
          const amount = await totals.nth(n).locator('.cifra').innerText();
          await totals.nth(n).click();
          await page.locator('[data-ui="commissions.month-sheet"]').waitFor();
          assert.ok((await page.locator('[data-ui="commissions.month-sheet"]').innerText()).includes(amount));
          assert.ok(await page.locator('[data-comm-month-row]').count() > 0);
          if (n === 0) {
            await page.locator('[data-month-product]').filter({hasText:'Synthetic cup'}).click();
            await page.locator('[data-ui="commissions.product-sheet"]').waitFor();
            assert.match(await page.locator('[data-ui="commissions.product-sheet"]').innerText(),/Synthetic cup/);
            await page.evaluate(() => cerrarFichaProducto());
            continue;
          }
          if (n === 3) {
            const period = await page.evaluate(() => _ocComMonthDetail.mes);
            await page.evaluate(() => { window.__realPay = marcarComisionPagada; marcarComisionPagada = (...args) => window.__paymentRoute = args; _ocMesComisiones = '2000-01'; });
            await page.locator('[data-comm-month-row]').filter({hasText:'Candy Synthetic'}).locator('[data-month-pay]').click();
            const route = await page.evaluate(() => { marcarComisionPagada = window.__realPay; _ocMesComisiones = _ocComMonthDetail.mes; return window.__paymentRoute; });
            assert.equal(route[2],25); assert.equal(route[4].mes,period,'payment keeps the opened breakdown month');
            continue;
          }
          await page.locator('[data-comm-month-close]').first().click();
        }
        const contact = page.locator('.comm-agent-row').filter({hasText:'Candy Synthetic'});
        assert.equal(await contact.locator('a').getAttribute('href'),'tel:+593999123456');
        const style = await contact.locator('[data-abrir-promotora]').evaluate(b => ({transform:getComputedStyle(b).textTransform,shadow:getComputedStyle(b).boxShadow}));
        assert.equal(style.transform,'none'); assert.equal(style.shadow,'none');
        await contact.locator('[data-abrir-promotora]').click();
        assert.match(await page.locator('#oc-comision-caja').innerText(),/Candy Synthetic/);
        await page.evaluate(() => cerrarEditorComision());
        if (lang === 'es' && process.env.F123_MONEY_SCREENSHOTS) {
          fs.mkdirSync(process.env.F123_MONEY_SCREENSHOTS,{recursive:true});
          await contact.scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(process.env.F123_MONEY_SCREENSHOTS,name+'-people-mobile.png')});
          await totals.last().click();
          await page.screenshot({path:path.join(process.env.F123_MONEY_SCREENSHOTS,name+'-due-mobile.png')});
          await page.locator('[data-comm-month-close]').first().click();
        }
      }
      const fragment = await page.evaluate(async () => {
        const original = OCEstado.cifrar; let fragment;
        OCEstado.cifrar = async data => fragment = await original(data);
        _ocModalMostrar = async () => 7; window.open = () => ({});
        await enviarEstadoComisionista(__statementFixture.rack.id,__statementFixture.person.id);
        return fragment;
      });
      await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/estado.html')).href+'#'+fragment);
      await page.waitForFunction(() => document.querySelectorAll('.caja').length === 4);
      const text = await page.locator('#app').innerText();
      assert.match(text,/15[.,]00/); assert.match(text,/25[.,]00/);
      if (process.env.F123_MONEY_SCREENSHOTS) await page.screenshot({path:path.join(process.env.F123_MONEY_SCREENSHOTS,name+'-statement-mobile.png'),fullPage:true});
      await page.evaluate(() => { window.print = () => window.__printed = true; });
      await page.locator('.imprimir').click();
      assert.equal(await page.evaluate(() => window.__printed),true);
      await page.emulateMedia({media:'print'});
      assert.equal(await page.locator('.imprimir').isVisible(),false);
    } finally { await web.close(); }
  });
}
