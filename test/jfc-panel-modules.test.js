'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../docs/panel-modules.js'),'utf8');
const titles=['Sonar de Canarios','Resumen','Licencias · instancias activas','Papelera · licencias borradas (recuperables)','Instancias · detalle','Control de versiones','Códigos maestros de recuperación','Roadmap · distribución friendly-123','⚠️ Solo para ti — no compartir','Roles y aclaraciones','Notas operativas','Herramientas de marketing','Mapa del código'];
function element(type='div'){return {type,children:[],attributes:{},appendChild(c){this.children.push(c);return c},setAttribute(k,v){this.attributes[k]=v},querySelectorAll(){return []},style:{},id:'',href:'',className:'',textContent:''}}
function run(){
 let network=0,storage=0;
 const headings=titles.map(t=>Object.assign(element('h2'),{textContent:t})),main=element('main');
 main.firstChild=element('p');main.querySelectorAll=s=>s==='h2'?headings:[];main.insertBefore=n=>{main.nav=n};
 const doc={readyState:'complete',head:element('head'),querySelector:s=>s==='#panel main'?main:null,getElementById:id=>main.nav?.id===id?main.nav:null,createElement:element,addEventListener(){}};
 const context={document:doc,fetch(){network++;throw Error('network forbidden')},localStorage:{setItem(){storage++},getItem(){storage++;throw Error('storage forbidden')}},console};
 vm.runInNewContext(source,context);
 return {doc,main,headings,network,storage};
}
function walk(n,pred,result=[]){if(pred(n))result.push(n);for(const c of n.children||[])walk(c,pred,result);return result}
test('all thirteen original sections stay linked and intact',()=>{
 const x=run();assert.ok(x.main.nav);
 const links=walk(x.main.nav,n=>n.type==='a');
 assert.equal(links.length,titles.length);assert.equal(new Set(links.map(n=>n.href)).size,titles.length);
 assert.ok(links.every(a=>x.headings.some(h=>'#'+h.id===a.href)));
});
test('navigation reads no local secrets and calls no backend',()=>{const x=run();assert.equal(x.network,0);assert.equal(x.storage,0)});
test('accessible anchors and mobile-friendly touch targets',()=>{
 const x=run(),css=x.doc.head.children[0].textContent;
 assert.match(css,/:focus-visible/);assert.match(css,/min-height:44px/);
 assert.ok(walk(x.main.nav,n=>n.type==='a').every(n=>n.href.startsWith('#jfc-sec-')));
});