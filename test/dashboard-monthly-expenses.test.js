const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const root=require('node:path').join(__dirname,'../docs');
const month=new Date().toLocaleDateString('en-CA',{year:'numeric',month:'2-digit'});
const period=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
test('Expenses compares actual monthly sales and expenses; returned sales do not inflate net',async()=>{
 const html=fs.readFileSync(root+'/index.html','utf8');
 const code=html.slice(html.indexOf('async function cargarGastos(){'),html.indexOf('async function registrarGasto(){'));
 const nodes=Object.fromEntries(['listaGastos','gastosResumen','gastoFecha','gastosPorCategoria'].map(k=>[k,{innerHTML:'',value:'',querySelectorAll:()=>[]}]));
 const sales=[{fecha:period+'-10T12:00:00Z',cantidad:2,precioUnit:25,ubicacionId:'a'},{fecha:period+'-11T12:00:00Z',cantidad:1,precioUnit:10,ubicacionId:'a',devuelta:true,fechaDevolucion:period+'-11'},{fecha:'2020-01-01',cantidad:1,precioUnit:1000}];
 const c={window:{OCAuth:{rolActual:()=> 'dueno'}},document:{getElementById:k=>nodes[k]},API:'/api',ubicacionActual:'todas',_gastoCatFiltro:'',fmtMoney:v=>'$'+Number(v).toFixed(2),escHtml:String,gastoCatLabel:String,fetch:async url=>({ok:true,json:async()=>url.includes('/gastos')?{gastos:[{concepto:'Synthetic expense',monto:12,fecha:period+'-10'}]}:url.includes('/ventas/todas')?sales:{resumenDia:{entra:50}}})};
 c.localStorage={getItem:()=>null}; vm.createContext(c); vm.runInContext(fs.readFileSync(root+'/core/sales-audit.js','utf8'),c); c.window.OCSalesAudit=c.OCSalesAudit; vm.runInContext(fs.readFileSync(root+'/core/business-read-model.js','utf8'),c); c.window.OCBusinessReadModel=c.OCBusinessReadModel; c.fechaGastoVisible=fecha=>c.OCBusinessReadModel.day(fecha,'America/Guayaquil'); vm.runInContext(code,c);await c.cargarGastos();
 assert.match(nodes.gastosResumen.innerHTML,/Sales this month[\s\S]*?\$50\.00/);
 assert.match(nodes.gastosResumen.innerHTML,/Sales less expenses[\s\S]*?\$38\.00/);
});
test('Monthly PDF contains sales and detailed expenses for the same month',()=>{
 const html=fs.readFileSync(root+'/dashboard.html','utf8');
 const code=html.slice(html.indexOf('  function reporte(cual) {'),html.indexOf('  /* ================================================== EL MANDO'));
 const tables=[],texts=[];
 class PDF{setFontSize(){}text(t){texts.push(t)}autoTable(t){tables.push(t);this.lastAutoTable={finalY:150}}save(){}}
 const c={window:{jspdf:{jsPDF:PDF},OCBusinessReadModel:require('../docs/core/business-read-model.js')},$:()=>({textContent:'Synthetic business'}),localStorage:{getItem:()=>null},zonaNegocioDashboard:()=>Intl.DateTimeFormat().resolvedOptions().timeZone,_fuenteDatosDashboard:'local',datos:{cobertura:{gastos:true,ventas:true},ventas:[{fecha:period+'-10',cantidad:2,precioUnit:25,costoUnit:5,productoNombre:'Synthetic sale'}],gastos:[{fecha:period+'-10',concepto:'Synthetic expense',monto:12},{fecha:'2020-01-01',concepto:'OLD',monto:1000},{fecha:period+'-10',concepto:'VOID',monto:1000,borrado:true}]},money:v=>'$'+Number(v).toFixed(2),plural:n=>String(n),fechaLocalDashboard:s=>s,mesLocalDe:s=>String(s).slice(0,7)};
 vm.createContext(c);vm.runInContext(code,c);c.reporte('mes');
 assert.ok(tables.some(t=>t.body.some(row=>row.includes('Synthetic expense'))),'expense detail must be printable alongside sales');
 assert.match(JSON.stringify(tables),/\$12\.00/);assert.match(JSON.stringify(tables),/\$28\.00/);
 assert.ok(!JSON.stringify(tables).includes('OLD'));assert.ok(!JSON.stringify(tables).includes('VOID'));
});
