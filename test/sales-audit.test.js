const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function core(){const w={};w.globalThis=w;vm.createContext(w);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/core/sales-audit.js'),'utf8'),w);return w.OCSalesAudit;}
const sale=(id,amount,extra={})=>({id,fecha:'2026-10-09T01:00:00Z',cantidad:1,precioUnit:amount,productoNombre:'Bar drink',ubicacionId:'bar',...extra});
test('sales audit: 34 in cash is distinct from credit, noncash, unspecified and returns; original facts unchanged',()=>{
 const c=core();const rows=[sale('a',17,{formaPago:'cash'}),sale('b',17,{formaPago:'efectivo'}),sale('c',20,{formaPago:'fiado'}),sale('d',7,{formaPago:'card'}),sale('e',9),sale('f',5,{formaPago:'cash',devuelta:true}),sale('g',80,{anulada:true})];const before=JSON.stringify(rows);
 const r=c.report(rows,{from:'2026-10-08',to:'2026-10-08',timeZone:'America/Guayaquil'});
 assert.equal(r.salesCents,7500);assert.equal(r.returnedCents,500);assert.equal(r.netCents,7000);assert.equal(r.cashCents,3400);assert.equal(r.creditCents,2000);assert.equal(r.nonCashCents,700);assert.equal(r.unspecifiedCents,900);assert.equal(r.rows.length,6);assert.equal(JSON.stringify(rows),before);
});
test('sales audit filters event/rack/product and corrected local date; cents sum without floating drift',()=>{
 const c=core(),rows=[sale('a',0.1,{productoNombre:'Tea',cantidad:3,eventoNombre:'Embroidery',formaPago:'cash'}),sale('b',0.2,{ubicacionId:'other'}),sale('c',5,{fecha:'2026-10-09T04:59:59Z',relojDesfaseMs:2000})];
 const r=c.report(rows,{from:'2026-10-08',to:'2026-10-08',rack:'bar',query:'embroidery',timeZone:'America/Guayaquil'});assert.equal(r.netCents,30);assert.equal(r.rows[0].day,'2026-10-08');assert.equal(c.report(rows,{from:'2026-10-09',to:'2026-10-09',timeZone:'America/Guayaquil'}).netCents,500);
});
