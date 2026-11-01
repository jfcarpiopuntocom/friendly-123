// JFC 2026-10-14: "la app entera app+dashboard tan reactive como entre las subsecciones... INSTANTANEO".
// Medido con el relay REAL entre dos aparatos: venta telefono -> compu 530 ms (v515) -> 62 ms (v516);
// tablero 600 -> 155 ms. Estas pruebas fijan las esperas internas para que nadie las vuelva a subir.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
test('quien cambia publica en <= 50 ms y una rafaga no posterga el envio',()=>{
  const from=src.indexOf('function pedirSeed() {');
  const to=src.indexOf('window.addEventListener("oc-catalogo-cambiado"',from);
  assert.ok(from>0&&to>from,'production seed scheduler exists');
  const body=src.slice(from,to);
  const m=/_tSeed\s*=\s*setTimeout\(function\s*\(\)\s*\{[\s\S]*?\},\s*(\d+)\)/.exec(body);
  assert.ok(m,'the actual seed timer must be measurable');
  const ms=Number(m[1]);
  assert.ok(ms>=0&&ms<=50,'espera de publicacion '+ms+' ms');
  assert.doesNotMatch(body,/clearTimeout/,'no se reinicia con cada evento');
});
test('quien recibe aplica en <= 50 ms',()=>{
  const a=src.indexOf('if (!_tAplica) _tAplica = setTimeout(');assert.ok(a>0);
  const ms=Number((/\}, (\d+)\)/.exec(src.slice(a,a+200))||[])[1]);
  assert.ok(ms>=0&&ms<=50,'espera de aplicacion '+ms+' ms');
});
