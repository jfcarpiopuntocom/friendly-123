'use strict';
// v738 (JFC 2026-11-11): el tablero (dashboard.html) lleva los arreglos de hoy. Sintetico: sin red, sin datos de clientes.
//  (a) ninguna escritura del tablero depende del turno de pestana; (b) una recarga automatica por version;
//  (c) registro local de errores y recargas con las mismas claves que la app; (d) sin modales de error/aviso.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const DOCS=path.join(__dirname,'../docs'),ORIGIN='http://localhost:18738';
const html=fs.readFileSync(path.join(DOCS,'dashboard.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]*\ssrc="\.\/([^"]+)"/g)].map(m=>m[1]);
const TYPES={'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2'};

test('(a)(b) el tablero no carga el turno de pestana y su unica recarga automatica es la de dashboard-updates.js',()=>{
  assert.ok(scripts.includes('dashboard-updates.js'));
  for(const f of scripts){
    assert.ok(!/tab-session|mock-backend/.test(f),f+' no debe cargarse en el tablero');
    const src=fs.readFileSync(path.join(DOCS,f),'utf8');
    assert.ok(!/OC_TAB_READONLY|oc-tab-session-changed/.test(src),f+' no debe consultar el turno de pestana');
    const recargas=(src.match(/location\.(?:reload|replace|assign)\(|location\.href\s*=[^=]|\.navigate\(|history\.go\(0\)/g)||[]).length;
    // salud-app.js (compartido): recarga solo con un clic del usuario en su propia franja; no es automatica.
    const permitidas={'dashboard-updates.js':1,'salud-app.js':1}[f]||0;
    assert.equal(recargas,permitidas,f+': recargas inesperadas');
  }
  assert.ok(!/http-equiv\s*=\s*["']?refresh/i.test(html),'sin meta refresh');
  const upd=fs.readFileSync(path.join(DOCS,'dashboard-updates.js'),'utf8');
  assert.match(upd,/bridge\.safe\(\)[\s\S]*bridge\.prepare\(\)[\s\S]*f123_dash_recarga:[\s\S]*location\.reload\(\)/,'la recarga va despues de safe() y prepare() y del tope por version');
});

test('(d) la politica de datos solo se abre a peticion y no hay alert/confirm de error en el arranque',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const ctx=await browser.newContext({serviceWorkers:'block'});
    await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());if(u.origin!==ORIGIN)return route.abort();
      const file=path.resolve(DOCS,decodeURIComponent(u.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();
      try{await route.fulfill({status:200,contentType:TYPES[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:''});}
    });
    await ctx.addInitScript(()=>{
      window.__nativos=[];
      for(const k of ['alert','confirm','prompt'])window[k]=function(){window.__nativos.push(k);return null;};
      window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};
    });
    const page=await ctx.newPage();
    await page.goto(ORIGIN+'/dashboard.html');await page.waitForTimeout(1500);
    // Provoca un error y un rechazo: el registro local los guarda y NO aparece nada.
    await page.evaluate(()=>{setTimeout(()=>{throw new Error('sintetico: fallo provocado');},0);Promise.reject(new Error('sintetico: rechazo provocado'));});
    await page.waitForTimeout(300);
    const r=await page.evaluate(()=>({
      nativos:window.__nativos,
      abiertos:[...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].filter(e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length>0).map(e=>e.id||e.tagName),
      fijos:[...document.body.children].filter(e=>getComputedStyle(e).position==='fixed'&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0).map(e=>e.id||e.tagName),
      errores:JSON.parse(localStorage.getItem('f123_errores_log')||'[]'),
    }));
    assert.deepEqual(r.nativos,[],'sin alert/confirm/prompt en el arranque');
    assert.deepEqual(r.abiertos,[],'ningun modal a la vista en el arranque ni tras un error');
    assert.deepEqual(r.fijos,[],'ninguna franja o capa fija nueva');
    assert.ok(r.errores.length>=2&&r.errores.length<=20,'el registro guarda los errores provocados: '+r.errores.length);
    for(const e of r.errores)assert.deepEqual(Object.keys(e).sort(),['k','m','s','t'],'misma forma que la app {k,m,s,t}');
    assert.ok(r.errores.some(e=>e.k==='error'&&/fallo provocado/.test(e.m)));
    assert.ok(r.errores.some(e=>e.k==='rechazo'&&/rechazo provocado/.test(e.m)));
    // La politica de datos es un texto que el usuario pide con un clic: oculta hasta entonces.
    assert.equal(await page.locator('#pol').isVisible(),false);
    // Tope del anillo: 20.
    await page.evaluate(()=>{for(let i=0;i<30;i++)setTimeout(()=>{throw new Error('sintetico '+i);},0);});
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('f123_errores_log')).length),20);
  }finally{await browser.close();}
});

test('(b)(c) una version nueva recarga como maximo una vez por version y deja bitacora local',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const ctx=await browser.newContext({serviceWorkers:'block'});
    let servido='f123-shell-v9001';
    await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());if(u.origin!==ORIGIN)return route.abort();
      if(u.pathname==='/version.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({shell:servido})});
      const file=path.resolve(DOCS,decodeURIComponent(u.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();
      try{
        let body=fs.readFileSync(file);
        // La copia fresca de dashboard.html anuncia la version nueva, como un despliegue real.
        if(u.pathname==='/dashboard.html'&&u.searchParams.has('dash'))body=Buffer.from(String(body).replace(/(name="dashboard-shell" content=")[^"]+/,'$1'+servido));
        await route.fulfill({status:200,contentType:TYPES[path.extname(file)]||'application/octet-stream',body});
      }catch(_){await route.fulfill({status:404,body:''});}
    });
    await ctx.addInitScript(()=>{
      window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};
      // Service worker sintetico que ya controla la pagina con el shell nuevo.
      const oyentes={message:[]};
      const controller={postMessage(){setTimeout(()=>{for(const f of oyentes.message)f({source:controller,data:{tipo:'shell-actual',shell:window.__shellControlador}});},0);}};
      window.__shellControlador=sessionStorage.getItem('__shell_ctrl')||'f123-shell-v9001';
      const reg={update:async()=>{},waiting:null};
      Object.defineProperty(Navigator.prototype,'serviceWorker',{configurable:true,get:()=>({controller,register:async()=>reg,getRegistration:async()=>reg,
        addEventListener:(k,f)=>{(oyentes[k]=oyentes[k]||[]).push(f);},removeEventListener:()=>{}})});
    });
    const page=await ctx.newPage();
    let cargas=0;page.on('load',()=>cargas++);
    await page.goto(ORIGIN+'/dashboard.html');
    // Primera carga + una recarga automatica (check a 1 s) + intento repetido que el tope omite.
    await page.waitForTimeout(3500);
    await page.evaluate(()=>window.OCDashboardUpdates.check());await page.waitForTimeout(800);
    await page.evaluate(()=>window.OCDashboardUpdates.check());await page.waitForTimeout(800);
    assert.equal(cargas,2,'una sola recarga para la version 9001 (carga inicial + 1)');
    let log=await page.evaluate(()=>JSON.parse(localStorage.getItem('f123_recargas_log')||'[]'));
    assert.equal(log.filter(x=>x.m==='dashboard-version').length,1,'una recarga anotada');
    for(const x of log)assert.deepEqual(Object.keys(x).sort(),['m','t','v'],'misma forma que la app {m,t,v}');
    // Otra version nueva: vuelve a tener su unica recarga.
    servido='f123-shell-v9002';
    await page.evaluate(()=>sessionStorage.setItem('__shell_ctrl','f123-shell-v9002'));
    await page.evaluate(()=>{window.__shellControlador='f123-shell-v9002';});
    await page.evaluate(()=>window.OCDashboardUpdates.check());await page.waitForTimeout(2500);
    assert.equal(cargas,3,'una sola recarga para la version 9002');
    log=await page.evaluate(()=>JSON.parse(localStorage.getItem('f123_recargas_log')||'[]'));
    assert.equal(log.filter(x=>x.m==='dashboard-version').length,2);
    assert.ok(log.length<=15);
    // No se muestra nada por el registro.
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')].filter(e=>e.getClientRects().length>0).length),0);
  }finally{await browser.close();}
});
