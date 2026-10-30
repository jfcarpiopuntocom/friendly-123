// Revision nivel Linus, Bloque 1.9 (JFC 2026-09-25): dos pestanas del MISMO aparato
// (mismo localStorage) venden la ULTIMA unidad casi a la vez. Nunca puede quedar stock
// negativo ni dos ventas de una pieza unica.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DOCS = path.join(__dirname, '../docs');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
function servidor() {
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
    const f = path.join(DOCS, u);
    if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
}

for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
test('dos pestanas venden la ultima unidad a la vez: una sola venta, stock 0'+(engineName==='Chromium'?'':' (WebKit)'), async () => {
  const srv = servidor(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const web = await engine.launch({ headless: true });
  try {
    const ctx = await web.newContext();
    const t1 = await ctx.newPage(); await t1.goto(base, { waitUntil: 'networkidle' });
    const id = await t1.evaluate(async () => {
      const u = await (await fetch('/api/ubicaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Unica', tipo: 'propio' }) })).json();
      const p = await (await fetch('/api/productos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Pieza unica', barcode: 'UNICA-1', precio: 100, stockInicial: 1, ubicacionId: u.id }) })).json();
      return p.id;
    });
    await t1.waitForTimeout(1500);
    const t2 = await ctx.newPage(); await t2.goto(base, { waitUntil: 'networkidle' }); await t2.waitForTimeout(1500);
    assert.equal(await t2.locator('#oc-doble-tab').count(),0,'Web Locks coordinates each write; a second app tab must remain usable');
    const vender = (pg) => pg.evaluate(async (pid) => (await fetch(`/api/productos/${pid}/venta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cantidad: 1 }) })).status, id);
    const [s1, s2] = await Promise.all([vender(t1), vender(t2)]);
    await t1.waitForTimeout(2500);
    const leer = (pg) => pg.evaluate(async (pid) => {
      const p = (await (await fetch('/api/productos')).json()).find((x) => x.id === pid);
      const v = (await (await fetch('/api/ventas/todas')).json()).filter((x) => x.productoId === pid);
      return { stock: p && p.stockActual, ventas: v.length };
    }, id);
    const [e1, e2] = [await leer(t1), await leer(t2)];
    await t1.reload({ waitUntil: 'networkidle' }); await t1.waitForTimeout(1500);
    const e3 = await leer(t1);
    // Una sola dice "vendido"; la otra se RECHAZA (4xx, sin stock) en vez de perderse en silencio.
    const oks = [s1, s2].filter((x) => x === 200).length, rechazos = [s1, s2].filter((x) => x >= 400 && x < 500).length;
    return assert.deepEqual({ oks, rechazos, e1, e2, recargada: e3 }, { oks: 1, rechazos: 1, e1: { stock: 0, ventas: 1 }, e2: { stock: 0, ventas: 1 }, recargada: { stock: 0, ventas: 1 } });
  } finally { await web.close(); srv.close(); }
});

test('dos pestanas venden productos DISTINTOS: las dos ventas sobreviven (antes una borraba la otra)'+(engineName==='Chromium'?'':' (WebKit)'), async () => {
  const srv = servidor(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const web = await engine.launch({ headless: true });
  try {
    const ctx = await web.newContext();
    const t1 = await ctx.newPage(); await t1.goto(base, { waitUntil: 'networkidle' });
    const ids = await t1.evaluate(async () => {
      const post = async (u, b) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const u = await post('/api/ubicaciones', { nombre: 'Dos', tipo: 'propio' });
      const a = await post('/api/productos', { nombre: 'Tab A', barcode: 'TAB-A', precio: 5, stockInicial: 10, ubicacionId: u.id });
      const b = await post('/api/productos', { nombre: 'Tab B', barcode: 'TAB-B', precio: 7, stockInicial: 10, ubicacionId: u.id });
      return [a.id, b.id];
    });
    await t1.waitForTimeout(1200);
    const t2 = await ctx.newPage(); await t2.goto(base, { waitUntil: 'networkidle' }); await t2.waitForTimeout(1200);
    assert.equal(await t2.locator('#oc-doble-tab').count(),0,'Web Locks coordinates each write; a second app tab must remain usable');
    const vender = (pg, pid) => pg.evaluate(async (x) => (await fetch(`/api/productos/${x}/venta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cantidad: 1 }) })).status, pid);
    const firstStatuses = await Promise.all([vender(t1, ids[0]), vender(t2, ids[1])]);
    const thirdStatus = await vender(t1, ids[0]); // no silent rejection or duplicate
    console.log('P0-REJECT-STAGE', JSON.stringify({engineName,trace:await t1.evaluate(()=>window.__f123P0Trace||null)}));
    await t2.reload({ waitUntil: 'networkidle' });
    // A hard-coded 1200 ms under loaded WebKit was not an observation barrier.
    // Still FAIL after a bounded 8 s if any acknowledged sale is truly absent.
    await t2.waitForFunction(async (x) => {
      const res = await fetch('/api/ventas/todas');
      if (!res.ok) return false;
      const rows=(await res.json()).filter(v=>x.includes(v.productoId));
      return rows.length===3;
    },ids,{timeout:8000,polling:150});
    const audit = (pg) => pg.evaluate(async (x) => {
      const ventas=(await (await fetch('/api/ventas/todas')).json()).filter(v=>x.includes(v.productoId));
      return {count:ventas.length,byProduct:x.map(id=>ventas.filter(v=>v.productoId===id).length),
        ids:ventas.map(v=>v.id)};
    },ids);
    const [a,b]=await Promise.all([audit(t1),audit(t2)]);
    console.log('TWO-TAB-FORENSIC',JSON.stringify({engineName,firstStatuses,thirdStatus,a,b}));
    assert.deepEqual(firstStatuses,[200,200],'each independent concurrent sale must ACK explicitly');
    assert.equal(thirdStatus,200,'same tab subsequent sale also ACKs');
    assert.equal(b.count,3,'all three acknowledged sales survive other tab reload');
    assert.deepEqual(b.byProduct,[2,1],'both products retain their distinct sales');
  } finally { await web.close(); srv.close(); }
});
}

test('without Web Locks the compatibility tab guard remains available',async()=>{
 const srv=servidor();await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const web=await chromium.launch({headless:true});
 try{
  const ctx=await web.newContext();
  await ctx.addInitScript(()=>{Object.defineProperty(navigator,'locks',{value:undefined});window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};});
  const base=`http://127.0.0.1:${srv.address().port}/`;
  const first=await ctx.newPage();await first.goto(base,{waitUntil:'load'});
  const second=await ctx.newPage();await second.goto(base,{waitUntil:'load'});
  await second.locator('#oc-doble-tab').waitFor({state:'visible'});
  assert.match(await second.locator('#oc-doble-tab').innerText(),/cannot coordinate writes|no puede coordinar escrituras/);
  assert.doesNotMatch(await second.locator('#oc-doble-tab').innerText(),/Use here anyway|de todos modos/);
  const write=page=>page.evaluate(async()=>{window.OCAuth={rolActual:()=> 'dueno'};const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Synthetic guarded rack',tipo:'propio'})});return r.status;});
  assert.equal(await write(second),409,'the guarded tab cannot write even when a request bypasses its UI');
  assert.equal(await write(first),200,'the primary tab stays usable');
  await first.close();await second.reload({waitUntil:'load'});
  assert.equal(await second.locator('#oc-doble-tab').count(),0);
  assert.equal(await write(second),200,'closing the primary tab releases legacy ownership after reload');
 }finally{await web.close();srv.close();}
});
