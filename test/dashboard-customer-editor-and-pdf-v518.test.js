'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..', 'docs');
const dash = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const mock = fs.readFileSync(path.join(root, 'mock-backend.js'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'sync-realtime.js'), 'utf8');

function isolated(source, from, to, args, values, exports_) {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, 'expected source boundary: ' + from);
  return Function(...args, source.slice(a, b) + '\nreturn {' + exports_.join(',') + '};')(...values);
}

test('dashboard customer recency follows a uniquely identified historical purchase, not a lookalike', () => {
  const clientes = [{id:'cust-a', nombre:'Therese Ann', recencia:null}];
  const ventas = [{clienteNombre:'Therese Ann', productoNombre:'Workshop', fecha:new Date().toISOString()}];
  const datos = {clientes,ventas,cobertura:{ventas:true}};
  const f = isolated(dash,'  function ventaEsDeCliente(v, c) {','  /* ---------------------------------------------------------------- VISTAS */',['datos'],[datos],['ventaEsDeCliente','clientesConCompras']);
  assert.equal(f.clientesConCompras()[0].recencia,0);
  assert.equal(f.ventaEsDeCliente(ventas[0],clientes[0]),true);
  assert.equal(f.ventaEsDeCliente({clienteId:'someone-else',clienteNombre:'Therese Ann'},clientes[0]),false);
  clientes.push({id:'cust-b',nombre:'Therese Ann'});
  assert.equal(f.ventaEsDeCliente(ventas[0],clientes[0]),false,'ambiguous legacy names cannot attach a purchase');
  clientes.pop();
  ventas[0].fecha='invalid';
  assert.equal(f.clientesConCompras()[0].recencia,'pending','missing date is not never');
});

test('commission money without a price remains pending and complete known zero remains zero', () => {
  const datos={cobertura:{ventas:true,liquidaciones:true}};
  const window={OCBusinessReadModel:{
    number:v=>v==null || v==='' || !Number.isFinite(Number(v))?null:Number(v),
    quantity:v=>v==null || !Number.isFinite(Number(v)) || Number(v)<=0?null:Number(v)
  }};
  const {comisionesConImportePendiente:f}=isolated(dash,'  function comisionesConImportePendiente(filas) {','  function cmPendienteVenta(v) {',['datos','window'],[datos,window],['comisionesConImportePendiente']);
  assert.equal(f([{comisionPct:25,precioUnit:null,cantidad:1,comisionAsociado:null}]),true);
  assert.equal(f([{comisionPct:25,precioUnit:0,cantidad:1,comisionAsociado:0}]),false);
  datos.cobertura.ventas=false;
  assert.equal(f([]),true,'unverified sales coverage cannot be 0 commission');
});

test('customer updates are single-target and PIN session guarded at the remote API', () => {
  assert.match(sync,/\{ m: "PATCH", re: \/\^\\\/api\\\/clientes/);
  assert.match(sync,/p\.para && p\.para !== deviceId\(\)/);
  assert.match(sync,/p\.fotoToken !== permiso\.token/);
  assert.match(mock,/body\.baseContacto/);
  assert.match(mock,/Customer changed on another device/);
  assert.match(dash,/data-edit-cliente/);
  assert.match(dash,/ordenar\("PATCH",ruta,payload,destino\)/);
});

test('PDF exports use direct jsPDF save rather than Tabulator cancelled downloader', () => {
  assert.match(dash,/function pdfDeTabla\(filename, negocio\)/);
  assert.match(dash,/doc\.autoTable\(\{head:\[titulos\]/);
  assert.match(dash,/doc\.save\(filename\)/);
  assert.doesNotMatch(dash,/tabla\.download\("pdf"/);
});

test('current release shell and exact edited assets have matching integrity hashes', () => {
  const v=JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'version-manifest.json'),'utf8'));
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const shellNumber=Number(String(v.shell||'').replace(/^f123-shell-v/,''));
  assert.ok(Number.isSafeInteger(shellNumber) && shellNumber>=518,'must include dashboard corrections');
  assert.equal(v.releaseName,'v'+shellNumber);
  assert.equal(manifest.shell,v.shell);
  assert.ok(sw.includes('const CACHE = "'+v.shell+'"'));
  for(const rel of ['mock-backend.js','sync-realtime.js','dashboard.html']){
    const bytes=fs.readFileSync(path.join(root,rel),'utf8').replace(/\r\n/g,'\n');
    const hash=crypto.createHash('sha256').update(bytes,'utf8').digest('hex');
    assert.equal(manifest.files['./'+rel],'sha256-'+hash,rel);
  }
});
