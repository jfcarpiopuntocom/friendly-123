'use strict';
// C226 (JFC 23 nov 2026): "los 4 botones son click on/off y si se dejan todos off, sale todo RAW como siempre he pedido";
// "By artist/associate debe ser des-elegible".
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const app=fs.readFileSync('src/app/app-inline-01.js','utf8'),person=fs.readFileSync('docs/commissions-by-person.js','utf8');
function sacar(nombre){const i=app.indexOf('function '+nombre+'(');let d=0,j=app.indexOf('{',i);for(let k=j;k<app.length;k++){if(app[k]==='{')d++;else if(app[k]==='}'&&--d===0)return app.slice(i,k+1);}throw Error(nombre);}
test('C226: tapping the pressed group turns it off -> RAW (total); tapping another turns it on',()=>{
 const ctx={window:{_ocComHistoryGroup:'producto',_ocVistaComisiones:'product'},document:{getElementById:()=>null},_ocMesComisiones:null,cargarComisiones(){}};
 vm.createContext(ctx);vm.runInContext(sacar('cambiarRangoComisionesGlobal'),ctx);
 ctx.cambiarRangoComisionesGlobal('grupo','producto');assert.equal(ctx.window._ocComHistoryGroup,'total');
 ctx.cambiarRangoComisionesGlobal('grupo','cliente');assert.equal(ctx.window._ocComHistoryGroup,'cliente');
 ctx.cambiarRangoComisionesGlobal('grupo','cliente');assert.equal(ctx.window._ocComHistoryGroup,'total');
});
test('C226: coming from By artist, the tapped group turns ON and By artist is released',()=>{
 let released=false;
 const ctx={window:{_ocComHistoryGroup:'producto',_ocVistaComisiones:'person'},document:{getElementById:()=>null},_ocMesComisiones:null,cargarComisiones(){},
  cambiarVistaComisiones(v){released=v==='product';ctx.window._ocVistaComisiones='product';}};
 vm.createContext(ctx);vm.runInContext(sacar('cambiarRangoComisionesGlobal'),ctx);
 ctx.cambiarRangoComisionesGlobal('grupo','producto');
 assert.equal(released,true);assert.equal(ctx.window._ocComHistoryGroup,'producto');
});
test('C226: By artist / associate toggles off on a second tap and releases the group buttons while on',()=>{
 assert.match(person,/if \(isPerson\(\)\) \{\s*root\.cambiarVistaComisiones\('product'\);/);
 assert.match(person,/\[data-commissions-view-global\]/);
});
