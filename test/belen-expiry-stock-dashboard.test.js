const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const app=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
test('inventory expiry sort puts earliest expiry first and undated items last in both directions',()=>{
 const code=app.slice(app.indexOf('const COLUMNAS_INVENTARIO ='),app.indexOf('function pintarBotonesOrdenInventario()'));
 const c={window:{OCBusinessReadModel:require('../docs/core/business-read-model.js')}};vm.createContext(c);vm.runInContext(code+';this.columns=COLUMNAS_INVENTARIO;this.sort=ordenarInventario;this.set=(asc)=>{_ordenInv={col:"fechaCaducidad",asc}}',c);
 assert.ok(c.columns.some(x=>x.key==='fechaCaducidad'));
 const rows=[{id:'none',nombre:'A'},{id:'later',perecible:true,fechaCaducidad:'2026-12-02'},{id:'soon',perecible:true,fechaCaducidad:'2026-10-15'},{id:'invalid',perecible:true,fechaCaducidad:'bad'}];
 c.set(true);assert.deepEqual(Array.from(c.sort(rows),x=>x.id),['soon','later','none','invalid']);
 c.set(false);assert.deepEqual(Array.from(c.sort(rows),x=>x.id),['later','soon','none','invalid']);assert.equal(rows[0].id,'none','sorting cannot mutate store');
});
test('unchanged local snapshot cannot overwrite a newer remote dashboard photo with zero stock',async()=>{
 const html=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/dashboard.html'),'utf8');
 const code=html.slice(html.indexOf('  async function refrescarLocal('),html.indexOf('  function repintarVivo()'));
 const c={autorizado:true,bloquearSesionSiCambioTienda:()=>false,leerEstadoLocalActual:async()=>({_rev:8,productos:[{stockActual:0}]}),_ultimaRevRepintada:8,_fuenteDatosDashboard:'remota',stock:5,pintarDesdeLocal:e=>{c.stock=e.productos[0].stockActual;return true}};
 vm.createContext(c);vm.runInContext(code,c);await c.refrescarLocal(true);assert.equal(c.stock,5);
 c.leerEstadoLocalActual=async()=>({_rev:9,productos:[{stockActual:4}]});await c.refrescarLocal(true);assert.equal(c.stock,4,'a genuinely new local store still updates the board');
});
