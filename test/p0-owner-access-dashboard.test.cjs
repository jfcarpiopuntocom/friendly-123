'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/tablero-avanzado.js'), 'utf8');
function element() {
  return {
    dataset:{}, style:{cssText:''}, children:[], disabled:false, textContent:'', value:'',
    listeners:{}, addEventListener(type,fn){this.listeners[type]=fn;},
    async click(){return this.listeners.click?.();}, appendChild(el){this.children.push(el);},
    setAttribute(){}, focus(){}, remove(){this.removed=true},
    insertAdjacentElement(_where,el){this.editor=el}
  };
}
async function fixture() {
  const calls=[];
  let button, editButton;
  const box=element();
  box.querySelectorAll=(selector)=>{
    if(selector==='[data-u]'){
      button=element();button.dataset={u:'safe-user-A',act:'0'};button.textContent='Dar de baja';return [button];
    }
    if(selector==='[data-pin-edit]'){
      editButton=element();editButton.dataset={pinEdit:'safe-user-A'};return [editButton];
    }
    return [];
  };
  const tab=element();tab.children=[{}];
  const message=element();
  const nodes={'avz-sel':tab,'avz-cuerpo':box,'avz-msg':message};
  const doc={getElementById:id=>nodes[id]||null,createElement:()=>element()};
  const win={OCI18n:{getLang:()=> 'es'},__lienzo:{
    $:id=>doc.getElementById(id),esc:x=>String(x),money:x=>String(x),fecha:x=>x,
    ordenar:async (method,url,data)=>{
      calls.push({method,url,data});
      if(method==='GET'&&url==='/api/usuarios')return {ok:true,datos:[{id:'safe-user-A',nombre:'Usuario sintético',rol:'empleado',activo:true,email:null}]};
      if(method==='PATCH'&&url==='/api/usuarios/safe-user-A')return {ok:true,datos:{}};
      throw new Error('Unexpected order');
    }
  }};
  const ctx={window:win,document:doc,console,encodeURIComponent};vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'tablero-avanzado.js'});
  win.OCTableroAvanzado.pintar();
  await new Promise(resolve=>setImmediate(resolve));
  return {calls,box,message,button:()=>button,editButton:()=>editButton};
}
test('shows truthful owner guidance and never renders known PIN',async()=>{
 const f=await fixture();assert.match(f.box.innerHTML,/Controla quién entra/);assert.match(f.box.innerHTML,/desconectado/);
 assert.doesNotMatch(f.box.innerHTML,/123456|Contraseña actual/);
});
test('deactivation needs inline second click, not a modal',async()=>{
 const f=await fixture(), b=f.button();await b.click();
 assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
 assert.equal(b.textContent,'Confirmar baja');
 await b.click();assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
 assert.equal(f.calls.find(c=>c.method==='PATCH').data.activo,false);
});
test('new PIN uses existing authorized PATCH, not any extra backend; transient value cleared',async()=>{
 const f=await fixture(),b=f.editButton();await b.click();
 const editor=b.editor;assert.ok(editor);const [input,save]=editor.children;
 input.value='12';await save.click();assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
 input.value='734';await save.click();
 const requests=f.calls.filter(c=>c.method==='PATCH');assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/usuarios/safe-user-A');assert.equal(requests[0].data.pin,'734');
 assert.equal(input.value,'');assert.equal(editor.removed,true);
});
