const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const R=require('../docs/core/business-read-model.js');
const dash=fs.readFileSync(path.join(__dirname,'../docs/dashboard.html'),'utf8').replace(/\r\n/g,'\n');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8').replace(/\r\n/g,'\n');
const slice=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a);return s.slice(a,b);};
const sale=(extra={})=>({id:'synthetic-sale',productoId:'p',eventoId:'synthetic-am',eventoNombre:'Synthetic workshop',eventoFecha:'2026-10-15',fecha:'2026-10-15',cantidad:1,precioUnit:100,costoUnit:10,comisionAsociado:80,netoCasa:20,modoComision:'acuerdo',...extra});
const expense={id:'synthetic-expense',fecha:'2026-10-15',monto:5,eventoId:'synthetic-am',categoria:'services'};
test('event rows use the common economic contribution and preserve independent occurrences',()=>{
 const c={datos:{ventas:[sale(),sale({id:'synthetic-pm',eventoId:'synthetic-pm'})],gastos:[expense],ajustesComision:[],cobertura:{ajustesComision:true,gastos:true,finanzasCoherentes:true}},window:{OCBusinessReadModel:R},Number,Date,String,Object};
 vm.createContext(c);vm.runInContext(slice(dash,'  function filasEventos() {','  /* ======================================================================\n     PESTANIA COMISIONES'),c);
 const rows=vm.runInContext('filasEventos()',c);
 assert.equal(rows.length,2);assert.deepEqual(Array.from(rows,x=>x.contribucion).sort((a,b)=>a-b),[5,10]);
 assert.deepEqual(Array.from(rows,x=>x.gastosDirectos).sort((a,b)=>a-b),[0,5]);
});
test('PDF financial rows include the SAME common house result, separated from cash',()=>{
 const tables=[],texts=[];const PDF=require('./helpers/report-pdf.cjs').instrumentPDF(tables,texts);
 const c={datos:{ventas:[sale()],gastos:[expense],ajustesComision:[],cobertura:{ajustesComision:true,gastos:true,ventas:true,finanzasCoherentes:true,timezone:'America/Guayaquil'}},
  window:{OCReportPDF:require('./helpers/report-pdf.cjs').layout,OCBusinessReadModel:R,jspdf:{jsPDF:PDF}},localStorage:{getItem:()=> 'es'},
  $:()=>({textContent:'Synthetic shop'}),prompt:()=> '2026-10',money:n=>n==null?'—':'$'+n,
  zonaNegocioDashboard:()=> 'America/Guayaquil',fechaLocalDashboard:x=>x,mesLocalDe:()=> '2026-10',_fuenteDatosDashboard:'local',Number,Date,Object,String};
 vm.createContext(c);vm.runInContext(slice(dash,'  function reporte(cual) {','  /* ================================================== EL MANDO A DISTANCIA'),c);
 vm.runInContext('reporte("mes")',c);
 const summary=tables.find(t=>t.body&&t.body.some(r=>/Casa después|House after/.test(r[0])));
 assert.ok(summary,'economic house row is present');assert.ok(summary.body.some(r=>/Casa después/.test(r[0])&&r[1]==='$5'));
 assert.ok(texts.flat().join(' ').includes('dinero disponible'),'cash is explicitly separated');
});
test('snapshot obtains financial rows in one cut and carries its local revision',async()=>{
 const seen=[];
 const c={fetch:async url=>{seen.push(url);return {ok:true,json:async()=> url==='/api/reporting/corte'?{schema:1,revision:17,timezone:'America/Guayaquil',ventas:[sale()],gastos:[expense],ajustesComision:[]}:url==='/api/gastos'?{gastos:[]}:[]};},window:{},localStorage:{getItem:()=>null},Intl,Date,Array};
 vm.createContext(c);vm.runInContext(slice(sync,'  async function armarFoto() {','  /* Corta una tabla larga'),c);
 const foto=await vm.runInContext('armarFoto()',c);
 assert.equal(foto.ventas[0].id,'synthetic-sale');assert.equal(foto.gastos[0].id,'synthetic-expense');
 assert.equal(foto.cobertura.finanzasCoherentes,true);assert.equal(foto.cobertura.revisionFinanciera,17);
 assert.ok(!seen.some(u=>u.startsWith('/api/ventas/todas')||u==='/api/gastos'));
});
test('legacy snapshot remains readable but cannot claim coherent financial capture',async()=>{
 const c={fetch:async url=>({ok:url!=='/api/reporting/corte',json:async()=>url.startsWith('/api/ventas/todas')?[sale()]:url==='/api/gastos'?{gastos:[expense]}:[]}),window:{},localStorage:{getItem:()=>null},Intl,Date,Array};
 vm.createContext(c);vm.runInContext(slice(sync,'  async function armarFoto() {','  /* Corta una tabla larga'),c);
 const foto=await vm.runInContext('armarFoto()',c);assert.equal(foto.ventas.length,1);assert.equal(foto.gastos.length,1);
 assert.equal(foto.cobertura.finanzasCoherentes,false);
});
test('dashboard finance uses the common monthly house amount even while cash facts are pending',()=>{
 const target={innerHTML:'',textContent:''};
 const c={datos:{ventas:[sale()],gastos:[expense],transferencias:[],gastosMensuales:{},hechosFinancieros:[],
   ajustesComision:[],cobertura:{ajustesComision:true,ventas:true,gastos:true,finanzasCoherentes:true,hechosFinancieros:false}},
  $:()=>target,window:{OCBusinessReadModel:R},localStorage:{getItem:()=> 'es'},
  money:n=>n==null?'—':'$'+n,esc:String,flechaComisionesMesHtml:()=>'',zonaNegocioDashboard:()=> 'America/Guayaquil',
  Date:class extends Date{constructor(v){super(v||'2026-10-15T17:00:00Z');}},Object,Number,Array,String};
 vm.createContext(c);vm.runInContext(slice(dash,'  function pintarFinanzasFoto() {','  /* PERISCOPIO DE DATOS')+'\npintarFinanzasFoto();',c);
 assert.match(target.innerHTML,/Casa después[\s\S]*\$5/);
 assert.match(target.innerHTML,/dinero disponible/);
});
