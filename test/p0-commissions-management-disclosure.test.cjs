'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/app-inline-01.js','utf8');
function extract(s){const a=s.indexOf("function tarjetaPromotora(pr)"),b=s.indexOf("function rankingComisionistasPlegable",a);if(a<0||b<a)throw Error("bounds");return s.slice(a,b);}
async function exercise(s,{open,query=""}={}){
const nodes=new Map(),listeners={},people=[{id:"a",nombre:"Alpha",comisionBase:0},{id:"b",nombre:"Beta",comisionBase:25}];let html="",edits=[],requests=[];
const make=id=>({id,value:"",dataset:{},style:{},innerHTML:"",textContent:"",querySelectorAll(sel){if(id!=="listaPromotoras")return [];const re=sel.includes("archivar")?/data-archivar-promotora="([^"]+)" data-nombre-promotora="([^"]+)"/g:/data-abrir-promotora="([^"]+)"/g;return [...this.innerHTML.matchAll(re)].map(m=>({dataset:{abrirPromotora:m[1],archivarPromotora:m[1],nombrePromotora:m[2]},addEventListener(n,f){listeners[(sel.includes("archivar")?"archive-":"edit-")+m[1]]=f}}))},addEventListener(n,f){listeners[id+"-"+n]=f}});
const box={querySelector(sel){if(sel==="[data-comm-directory-fold]")return open===undefined?null:{open};if(sel==="#promBuscar")return query?{value:query}:null;return null;},set innerHTML(s){html=s;nodes.clear();for(const m of s.matchAll(/id="([^"]+)"/g))nodes.set(m[1],make(m[1]))},get innerHTML(){return html}};
const document={getElementById:id=>id==="gestionPromotoras"?box:nodes.get(id),querySelectorAll:()=>[]};
const fetch=async(url,opt)=>{requests.push([url,opt?.method||"GET"]);return {json:async()=>url==="/api/promotoras"?people:[]}};
const env={document,fetch,API:"/api",window:{t:k=>k,tf:(k,a)=>k+JSON.stringify(a)},normalizarTexto:s=>String(s).toLowerCase(),escHtml:s=>String(s),abrirEditorComisionista:id=>edits.push(id),ocConfirm:async()=>false,ocAlert:async()=>{}};
await new Function(...Object.keys(env),"let _promotorasVivasCache=[];"+extract(s)+"\nreturn renderGestionPromotoras();")(...Object.values(env));const list=nodes.get("listaPromotoras");if(listeners["edit-b"])listeners["edit-b"]();if(listeners["archive-b"])await listeners["archive-b"]();
return {fold:html.includes("data-comm-directory-fold"),open:html.includes("data-comm-directory-fold open"),heading:(html.match(/comm\.g\.listHeading/g)||[]).length,formOutside:html.indexOf("btnAltaPromotora")<html.indexOf("data-comm-directory-fold"),query:nodes.get("promBuscar").value,alpha:list.innerHTML.includes('data-abrir-promotora="a"'),beta:list.innerHTML.includes('data-abrir-promotora="b"'),edits,requests,archive:!!listeners["archive-b"]};
}
test('directory: independent disclosure, one heading, all agents including zero, edit and archive preserved',async()=>{const r=await exercise(source);assert.ok(r.fold&&r.open&&r.formOutside&&r.alpha&&r.beta&&r.archive);assert.equal(r.heading,1);assert.deepEqual(r.edits,['b']);assert.ok(r.requests.every(x=>x[1]==='GET'));});
test('directory: closed disclosure and search survive reactive repaint',async()=>{const r=await exercise(source,{open:false,query:'beta'});assert.equal(r.open,false);assert.equal(r.query,'beta');assert.equal(r.alpha,false);assert.equal(r.beta,true);});
