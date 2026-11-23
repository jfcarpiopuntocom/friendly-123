'use strict';
// C237 (JFC 23 nov 2026, Safari crash): Sold must not render the full customer list inside every sale row.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const src=fs.readFileSync('src/app/app-inline-01.js','utf8');
test('C237: rows carry only their own customer; the full list is filled when the editor opens (pencil and Corregir)',()=>{
 assert.match(src,/const lista = completa \? _clientesVS\.slice\(\) : \[\];/);
 assert.match(src,/\$\{_opcionCliInicial\(v\)\}<\/select>/);
 assert.match(src,/_sel\.innerHTML = _opcionesCliente\(_v, true\); _sel\.value = _val;/);
 assert.equal((src.match(/_llenarClientesVS\(row, id\); \/\/ C237/g)||[]).length,2);
});

test('C239: search and Corregir mount sales beyond the first 120; Show more never repeats a row',()=>{
 assert.match(src,/if \(_filtroVS\.ids && _montarVS\) _montarVS\(_filtroVS\.ids\);/);
 assert.match(src,/if \(!row && _montarVS\) \{ _montarVS\(new Set\(\[String\(id\)\]\)\); row = _buscarFila\(\); \}/);
 assert.match(src,/\.filter\(\(v\) => !_filaMontadaVS\(v\)\); \/\/ C239/);
});
