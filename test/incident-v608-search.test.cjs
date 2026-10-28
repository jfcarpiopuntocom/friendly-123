'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const body=source.slice(source.indexOf('let _venderCategoriaActiva ='),source.indexOf('// Gestor de categorías'));
function fixture(){
 const input={value:'',dataset:{},listeners:[],addEventListener(type,fn){this.listeners.push(fn)}};
 const chips={dataset:{},listeners:[],addEventListener(type,fn){this.listeners.push(fn)}};
 let buttons=[];
 class Search {addAll(rows){this.rows=rows.map(x=>({...x}))}search(q){return this.rows.filter(x=>[x.nombre,x.categoria,x.sku,x.barcode].some(v=>String(v||'').toLowerCase().includes(q.toLowerCase()))).map(x=>({id:x.id}))}}
 const context={Map,Set,MiniSearch:Search,escHtml:s=>s,window:{t:k=>k,OCAuth:{rolActual:()=> 'dueno'}},document:{getElementById:id=>id==='venderBuscarInput'?input:chips,querySelectorAll:()=>buttons},abrirGestorCategorias(){}};
 vm.createContext(context);vm.runInContext(body,context);
 return {input,chips,mount(rows){buttons=rows.map(p=>({dataset:{venderTile:p.id},style:{}}));context.window._productosVenderCache=rows;context.montarBuscadorVender(rows)},type(q){input.value=q;input.listeners[0]()},visible(){return buttons.filter(x=>x.style.display!=='none').map(x=>x.dataset.venderTile)},context};
}
test('Sold search uses refreshed name/SKU and keeps one live listener',()=>{
 const f=fixture();f.mount([{id:'one',nombre:'Old name',categoria:'One',sku:'OLD-SKU'},{id:'two',nombre:'Other',categoria:'Two'}]);
 f.type('OLD-SKU');assert.deepEqual(f.visible(),['one']);
 f.mount([{id:'one',nombre:'Edited name',categoria:'One',sku:'NEW-SKU'},{id:'two',nombre:'Other',categoria:'Two'}]);
 f.type('NEW-SKU');assert.deepEqual(f.visible(),['one']);f.type('OLD-SKU');assert.deepEqual(f.visible(),[]);f.type('Edited');assert.deepEqual(f.visible(),['one']);
 assert.equal(f.input.listeners.length,1);assert.equal(f.chips.listeners.length,1);
});
test('Sold filter has no full-array search per visible tile and retains category filtering',()=>{
 const f=fixture();const rows=Array.from({length:1200},(_,i)=>({id:String(i),nombre:'Product '+i,categoria:i%2?'Odd':'Even',sku:'SKU-'+i}));
 rows.find=()=>{throw Error('quadratic product scan')};f.mount(rows);f.type('SKU-1199');assert.deepEqual(f.visible(),['1199']);
 vm.runInContext('_venderCategoriaActiva="Even"',f.context);f.type('');assert.equal(f.visible().length,600);assert.ok(f.visible().every(id=>+id%2===0));
});
