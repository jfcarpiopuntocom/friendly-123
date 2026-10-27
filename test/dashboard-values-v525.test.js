// v525: synthetic cross-device dashboard values. No production network/storage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function visor() {
  const html=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/dashboard.html'),'utf8');
  const ini=html.indexOf('  function recibirTrozo(p, emisor)');
  const fin=html.indexOf('  /* ---------------------------------------------------------------- VISTAS */',ini);
  assert.ok(ini>0&&fin>ini,'receptor existe');
  const mostradas=[], avisos=[], nodo={textContent:''};
  const venta=(price=10)=>({id:'sale-1',cantidad:1,precioUnit:price,costoUnit:4,
    devuelta:false,anulada:false,productoId:'product-1'});
  const producto=(stock=5,price=10)=>({id:'product-1',stockActual:stock,precio:price,costo:4});
  const gastos=(value=3)=>[{id:'expense-1',monto:value}];
  const c={datos:{ventas:[venta()],productos:[producto()],gastos:gastos(),
      cobertura:{ventas:true,productos:true,gastos:true}},
    fotoEnCurso:'prior',fotoFecha:'2026-10-15T12:00:00.000Z',
    editorDeviceId:'peer-a',_fuenteDatosDashboard:'remota',
    esperados:{},recibidos:{},fotoTemporal:{},totalTrozos:0,clavesTrozos:{},
    ultimoDato:0,reconexionMs:1500,$:()=>nodo,
    pulso:(mensaje)=>avisos.push(mensaje),mostrar(){mostradas.push(this.datos);},
    window:{OCBusinessReadModel:require('../docs/core/business-read-model.js')},
    Date,Number,Object,String};
  vm.createContext(c);
  vm.runInContext(html.slice(ini,fin)+'\nthis.receive=recibirTrozo;',c);
  function foto({id='candidate',emisor='peer-b',fecha='2026-10-15T12:05:00.000Z',
    ventas=[venta()],productos=[producto()],expenses=gastos(),
    cobertura={ventas:true,productos:true,gastos:true}}={}) {
    const tab=[['ventas',ventas],['productos',productos],['gastos',expenses],['cobertura',[cobertura]]];
    tab.forEach(([tabla,filas],k)=>c.receive({fotoId:id,generadaEn:fecha,
      tabla,filas,i:0,total:1,k,deTotal:tab.length,negocio:'Fixture business'},emisor));
  }
  return {c,foto,venta,producto,gastos,mostradas,avisos};
}

test('v525: same sale ID but different price on second peer cannot overwrite confirmed amounts',()=>{
  const v=visor();
  v.foto({ventas:[v.venta(19)]});
  assert.equal(v.mostradas.length,0);
  assert.equal(v.c.datos.ventas[0].precioUnit,10);
  assert.equal(v.c.receive.sinConciliar,true);
  assert.equal(v.c.fotoEnCurso,'','rejected clock cannot lock recovery');
  assert.match(v.avisos.at(-1),/differs|distintos/i);
});

test('v525: same sale IDs but conflicting stock cannot replace accepted inventory view',()=>{
  const v=visor();
  v.foto({productos:[v.producto(0)]});
  assert.equal(v.mostradas.length,0);
  assert.equal(v.c.datos.productos[0].stockActual,5);
  assert.equal(v.c.receive.sinConciliar,true);
});

test('v525: conflicting expenses for same record ID cannot change reported profit',()=>{
  const v=visor();
  v.foto({expenses:v.gastos(30)});
  assert.equal(v.mostradas.length,0);
  assert.equal(v.c.datos.gastos[0].monto,3);
  assert.equal(v.c.receive.sinConciliar,true);
});

test('v525: failed products read cannot masquerade as empty inventory',()=>{
  const v=visor();
  v.foto({productos:[],cobertura:{ventas:true,productos:false,gastos:true}});
  assert.equal(v.mostradas.length,0);
  assert.equal(v.c.datos.productos[0].stockActual,5);
  assert.equal(v.c.receive.sinConciliar,true);
});

test('v525: legitimate correction from same source device remains visible',()=>{
  const v=visor();
  v.foto({emisor:'peer-a',ventas:[v.venta(19)],productos:[v.producto(4)]});
  assert.equal(v.mostradas.length,1);
  assert.equal(v.c.datos.ventas[0].precioUnit,19);
  assert.equal(v.c.datos.productos[0].stockActual,4);
  assert.equal(v.c.receive.sinConciliar,false);
});

test('v525: additive sale on different device may legitimately reduce stock',()=>{
  const v=visor();
  const other=Object.assign({},v.venta(2),{id:'sale-2'});
  v.foto({ventas:[v.venta(),other],productos:[v.producto(4)]});
  assert.equal(v.mostradas.length,1);
  assert.equal(v.c.datos.ventas.length,2);
  assert.equal(v.c.datos.productos[0].stockActual,4);
  assert.equal(v.c.receive.sinConciliar,false);
});

test('v525: equivalent cross-device facts with numeric strings remain compatible',()=>{
  const v=visor();
  const sale=Object.assign({},v.venta(),{precioUnit:'10',cantidad:'1',costoUnit:'4'});
  const p=Object.assign({},v.producto(),{stockActual:'5',precio:'10',costo:'4'});
  v.foto({ventas:[sale],productos:[p],expenses:[{id:'expense-1',monto:'3'}]});
  assert.equal(v.mostradas.length,1);
  assert.equal(v.c.receive.sinConciliar,false);
});

test('v525: same sale ID with changed return state must not silently recalculate remotely',()=>{
  const v=visor();
  v.foto({ventas:[Object.assign({},v.venta(),{devuelta:true,fechaDevolucion:'2026-10-15'})]});
  assert.equal(v.mostradas.length,0);
  assert.equal(v.c.datos.ventas[0].devuelta,false);
});
