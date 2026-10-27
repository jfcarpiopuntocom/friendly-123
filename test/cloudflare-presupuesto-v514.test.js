// v593 follow-up: HTML shells now load extracted assets; read the extracted source so source-slice assertions keep working.
const P=require('./helpers/page-source.cjs').readFileSync;
// REGLA DURA JFC (pedida ~70 veces; textual 2026-10-14): "que no nos sature las cuentas el uso
// de los clientes en ninguna de mis apps". Estas pruebas fijan cada cuanto la app y el tablero
// pueden tocar Cloudflare. Subir una frecuencia exige cambiar esta prueba a proposito.
// Spec: CLAUDE.md, seccion "CLOUDFLARE: PRESUPUESTO DE CONSULTAS".
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const leer=(f)=>P(path.join(__dirname,'../docs',f),'utf8').replace(/\r\n/g,'\n');

test('tablero: version.json como maximo cada 10 min de fondo (antes cada 15 s)',()=>{
  const ms=[];const c={navigator:{serviceWorker:{addEventListener(){},controller:null}},window:{addEventListener(){}},document:{querySelector:()=>null,getElementById:()=>null,addEventListener(){},hidden:false},
    setInterval:(f,n)=>ms.push(n),setTimeout(){},fetch(){}};
  vm.createContext(c);vm.runInContext(leer('dashboard-updates.js'),c);
  assert.ok(ms.length>=1);for(const n of ms)assert.ok(n>=600000,'intervalo de fondo '+n+' ms');
});

test('tablero: la foto completa por el relay como maximo cada 60 s (antes cada 20 s)',()=>{
  const html=leer('dashboard.html');
  const a=html.indexOf('  var _fotoTick = 0;'),b=html.indexOf('}, 20000);',a)+10;assert.ok(a>0&&b>a);
  let cb,fotos=0;const c={autorizado:true,document:{hidden:false},bloquearSesionSiCambioTienda:()=>false,refrescarLocal:async()=>{},
    ws:{readyState:1},fotoToken:'t',pedirFoto:()=>{fotos++},setInterval:(f,n)=>{cb=f;assert.equal(n,20000)}};
  vm.createContext(c);vm.runInContext(html.slice(a,b),c);
  for(let i=0;i<9;i++)cb(); // 9 x 20 s = 3 min
  assert.equal(fotos,3,'3 fotos en 3 minutos');
});

test('app: reintentos de ops sin confirmar se espacian hasta 10 min y no golpean cada 30 s para siempre',()=>{
  const src=leer('sync-realtime.js');
  const a=src.indexOf('  let _retryDurableMs = 30000;'),b=src.indexOf('\n  }\n',src.indexOf('function reintentarDurable',a))+4;
  const esperas=[];let pend;const c={Math:{min:Math.min,round:Math.round,random:()=>0},leerCola:()=>[1],vaciarCola(){},
    setTimeout:(f,n)=>{esperas.push(n);pend=f;return 1},_retryDurable:null};
  vm.createContext(c);vm.runInContext('var _retryDurable=null;'+src.slice(a,b)+';this.go=reintentarDurable;',c);
  c.go();for(let i=0;i<8;i++){const f=pend;pend=null;f();}
  assert.equal(esperas[0],30000);assert.equal(esperas[1],60000);
  assert.equal(Math.max(...esperas),600000,'tope 10 min');
});
