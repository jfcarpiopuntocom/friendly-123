// venta-cantidad.test.js — friendly-123
// ============================================================================
// BUG QUE FIJA (JFC 2026-08-19, caza 33): el endpoint de venta convertia en
// SILENCIO cualquier cantidad invalida a 1. Pedir vender -5, o 0, o "dos"
// devolvia 200 y grababa una venta real de una unidad — movimiento de stock y
// de dinero que nadie pidio, sin un solo aviso.
//
// Estos casos corren mock-backend.js DE VERDAD dentro de un contexto de vm con
// los stubs minimos del navegador, y comprueban el stock antes y despues. No
// leen el codigo: lo ejecutan.
// ============================================================================
const { test } = require("node:test");
const assert = require("node:assert");

const fs=require('fs'),vm=require('vm');
function mkStore(){const m=new Map();return{get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v))},removeItem:k=>{m.delete(k)}};}
function mkWin(ls){const w={localStorage:ls,sessionStorage:mkStore(),location:{origin:'http://x',reload(){w.__r=true}},
 addEventListener:()=>{},dispatchEvent:()=>{},fetch:async()=>({ok:true,json:async()=>({})}),
 CustomEvent:class{constructor(t,o){this.type=t;Object.assign(this,o)}},URL,console:{warn(){},error(){},log(){}},
 setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,crypto:{randomUUID:()=>'id-'+Math.random().toString(36).slice(2)},
 indexedDB:undefined,navigator:{},Response,Headers,Request,JSON,
 document:{getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},addEventListener(){},appendChild(){}}),addEventListener(){},body:null,documentElement:{appendChild(){}}},__r:false};
 w.window=w;w.globalThis=w;w.self=w;return w;}
const src=fs.readFileSync(require('path').join(__dirname,'..','docs','mock-backend.js'),'utf8');
const w=mkWin(mkStore());vm.createContext(w);vm.runInContext(src,w);
const J=async(p,o)=>{const r=await w.fetch(p,o);return{s:r.status,b:await r.json()};};
const P=(o)=>({method:'POST',body:JSON.stringify(o)});
test('venta: cantidades invalidas se rechazan, no se adivinan', async () => {
 const chk=(n,c,d)=>{ assert.ok(c, n + (c?'':'  -> '+JSON.stringify(d).slice(0,200))); };

 const prods=(await J('/api/productos')).b;
 const p=prods.find(x=>x.stockActual>3);
 const st0=p.stockActual;

 // venta normal
 let r=await J(`/api/productos/${p.id}/venta`,{method:'POST',body:JSON.stringify({cantidad:2})});
 chk('venta 200',r.s===200||r.s===undefined,r);
 let after=(await J('/api/productos')).b.find(x=>x.id===p.id);
 chk('stock baja exactamente 2',after.stockActual===st0-2,{st0,now:after.stockActual});

 // venta con cantidad negativa
 r=await J(`/api/productos/${p.id}/venta`,{method:'POST',body:JSON.stringify({cantidad:-5})});
 chk('venta cantidad negativa RECHAZADA',r.s===400,r);
 after=(await J('/api/productos')).b.find(x=>x.id===p.id);
 chk('stock no subio con cantidad negativa',after.stockActual===st0-2,{now:after.stockActual});

 // venta cantidad 0
 r=await J(`/api/productos/${p.id}/venta`,{method:'POST',body:JSON.stringify({cantidad:0})});
 chk('venta cantidad 0 RECHAZADA',r.s===400,r);

 // sobreventa
 r=await J(`/api/productos/${p.id}/venta`,{method:'POST',body:JSON.stringify({cantidad:99999})});
 chk('sobreventa RECHAZADA',r.s===400,r);

 // cantidad no numerica
 r=await J(`/api/productos/${p.id}/venta`,{method:'POST',body:JSON.stringify({cantidad:"dos"})});
 chk('cantidad no numerica RECHAZADA',r.s===400,r);

 // producto inexistente
 r=await J('/api/productos/no-existe/venta',{method:'POST',body:JSON.stringify({cantidad:1})});
 chk('producto inexistente RECHAZADO',r.s===404||r.s===400,r);

 // cliente sin nombre
 r=await J('/api/clientes',{method:'POST',body:JSON.stringify({nombre:'   '})});
 chk('cliente sin nombre RECHAZADO',r.s===400,r);

});

test('transferencia: no se puede transferir a la misma percha ni al mismo producto', async () => {
  const chk=(n,c,d)=>{ assert.ok(c, n + (c?'':'  -> '+JSON.stringify(d).slice(0,200))); };
  const all=(await J('/api/productos')).b;
  const o=all.find(x=>x.stockActual>3);
  const so=o.stockActual;

  // B20: transferir un producto a si mismo restaba el stock y lo dejaba "en
  // transito" hacia la percha de la que nunca salio. Invisible en inventario,
  // y perdido del todo si nadie confirmaba la recepcion.
  let r=await J('/api/transferencias',P({productoOrigenId:o.id,productoDestinoId:o.id,cantidad:2}));
  chk('transferencia al mismo producto rechazada', r.s===400, r);
  let now=(await J('/api/productos')).b.find(x=>x.id===o.id).stockActual;
  chk('el stock no se movio', now===so, {so,now});

  // Cantidades invalidas en transferencia (ya estaban bien; quedan cubiertas)
  const porSku={}; all.forEach(x=>{(porSku[x.sku]=porSku[x.sku]||[]).push(x);});
  const par=Object.values(porSku).find(g=>g.length>1 && g[0].ubicacionId!==g[1].ubicacionId && g[0].stockActual>3);
  if (par) {
    const a=par[0], b=par[1], sa=a.stockActual;
    for (const mala of [-3, 0, 'tres', 2.5]) {
      r=await J('/api/transferencias',P({productoOrigenId:a.id,productoDestinoId:b.id,cantidad:mala}));
      chk('transferencia con cantidad '+JSON.stringify(mala)+' rechazada', r.s===400, r);
    }
    now=(await J('/api/productos')).b.find(x=>x.id===a.id).stockActual;
    chk('ninguna cantidad invalida toco el stock', now===sa, {sa,now});
  }
});
