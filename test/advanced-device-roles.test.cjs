'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer}=require('./helpers/e2e-app.cjs');

test('staff and accountant retain device naming in Advanced without owner panels or financial loads',async()=>{
  const {srv,base}=await startServer();let browser;
  try{
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1000,height:600}});
    await context.route(u=>!u.href.startsWith(base)&&!u.href.startsWith('data:')&&!u.href.startsWith('blob:'),r=>r.abort());
    await context.addInitScript(()=>{localStorage.setItem('f123::f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-DEVICE-ROLES'}));window.WebSocket=class{constructor(){this.readyState=3;}send(){}close(){}addEventListener(){}};});
    const page=await context.newPage();page.setDefaultTimeout(5000);
    await page.goto(base+'/index.html',{waitUntil:'load'});
    await page.waitForFunction(()=>window.OCSecure&&window.OCAuth&&window.OCMicelio);
    assert.equal(await page.evaluate(()=>OCSecure.guardarSecreto('843',['624'],'519','')),true);
    for(const [role,pin]of [['empleado','624'],['contador','519']]){
      for(const digit of pin)await page.locator('#oc-pad').getByRole('button',{name:digit,exact:true}).click();
      await page.waitForFunction(r=>window.OCAuth&&OCAuth.rolActual()===r,role);
      await page.evaluate(()=>{window.__advancedRequests=[];window.__advancedStacks=[];const fetchActual=window.fetch;window.fetch=(url,options)=>{__advancedRequests.push(String(url));__advancedStacks.push({url:String(url),stack:new Error().stack});return fetchActual(url,options);};});
      const advanced=page.locator('nav button[data-vista="avanzado"]');
      assert.equal(await advanced.isVisible(),true,role+' can reach its local identity control');
      await advanced.click();
      await page.waitForFunction(()=>document.querySelector('#vista-avanzado').classList.contains('activa'));
      const traces=await page.evaluate(()=>__advancedStacks);
      const ancestry=await page.locator('#oc-identity-settings').evaluate(el=>{const out=[];for(let a=el;a&&out.length<5;a=a.parentElement)out.push({id:a.id,tag:a.tagName,display:getComputedStyle(a).display,style:a.getAttribute('style')});return out;});
      assert.deepEqual(await page.evaluate(()=>__advancedRequests.filter(u=>/config|reportes|actividad|gastos/.test(u))),[],JSON.stringify({role,traces,ancestry}));
      const visible=await page.locator('#vista-avanzado').evaluate(el=>[...el.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.id));
      assert.deepEqual(visible,['oc-identity-settings'],JSON.stringify(ancestry));
      if(!await page.locator('#oc-identity-settings').evaluate(el=>el.open)) await page.locator('#oc-identity-settings summary').click();
      assert.equal(await page.locator('#oc-negocio-editar').isVisible(),false);
      assert.equal(await page.locator('#oc-header-apodo-btn').isVisible(),true);
      page.once('dialog',dialog=>dialog.accept('Synthetic '+role));
      await page.locator('#oc-header-apodo-btn').click();
      await page.waitForFunction(r=>OCMicelio.miApodo()==='Synthetic '+r,role);
      const denied=await page.evaluate(async()=>{const r=await fetch('/api/instancia/nombre',{method:'POST',body:JSON.stringify({nombre:'Unauthorized synthetic rename'})});return r.status;});
      assert.equal(denied,403,'device naming does not grant store ownership');
      await page.evaluate(()=>OCAuth.salir());
      await page.waitForFunction(()=>window.OCAuth&&!OCAuth.rolActual());
    }
    await context.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>srv.close(resolve));}
});
