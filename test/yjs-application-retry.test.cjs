const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.YJS_SOURCE_OVERRIDE||path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
function fixture(){let timerId=0;const jobs=new Map(),delays=[],events={};const c={API:{doc:{on(){}}},document:{hidden:false,addEventListener:(k,f)=>{events[k]=f;},removeEventListener(){}},window:{addEventListener:(k,f)=>{events[k]=f;},removeEventListener(){}},localStorage:{getItem:()=>'{"licenseCode":"synthetic"}'},clearTimeout:id=>jobs.delete(id),setTimeout:(f,ms)=>{const id=++timerId;jobs.set(id,f);delays.push(ms);return id;}};vm.createContext(c);return{c,jobs,delays,events};}
test('catalog application never abandons a retained document after five failures',()=>{
 const f=fixture(),a=source.indexOf('    function falloAplicacion()'),b=source.indexOf('    function valores(',a);
 const helperStart=source.indexOf('  function reintentoLocalAplicacion('),helperEnd=source.indexOf('  function conectarHechos()',helperStart);
 if(helperStart>=0)vm.runInContext(source.slice(helperStart,helperEnd),f.c);
 vm.runInContext('var _primerMergeAceptado=true,_reintentoAplicar=null,_fallosAplicar=0,_MAX_FALLOS_APLICAR=5;var tries=0;function log(){};function aplicar(){tries++;falloAplicacion();}'+(helperStart>=0?'var _retryAplicar=reintentoLocalAplicacion(aplicar);':'')+source.slice(a,b),f.c);
 f.c.falloAplicacion();for(let i=0;i<12;i++){const job=[...f.jobs.entries()][0];assert.ok(job,'a retained Y.Doc still requires retry after attempt '+i);f.jobs.delete(job[0]);job[1]();assert.equal(f.jobs.size,1,'only one timer');}
 assert.equal(f.c.tries,12);assert.deepEqual(f.delays.slice(0,4),[2000,4000,8000,16000]);assert.equal(f.delays.at(-1),600000);
});
test('retry pauses while hidden, resumes immediately and cancels on success or notebook change',()=>{
 const f=fixture(),a=source.indexOf('  function reintentoLocalAplicacion('),b=source.indexOf('  function conectarHechos()',a);assert.ok(a>=0);
 vm.runInContext(source.slice(a,b)+';var runs=0,retry=reintentoLocalAplicacion(function(){runs++;});',f.c);
 f.c.retry.pedir();f.c.retry.pedir();assert.equal(f.jobs.size,1);
 f.c.document.hidden=true;const [id,job]=[...f.jobs][0];f.jobs.delete(id);job();assert.equal(f.c.runs,0);assert.equal(f.jobs.size,0);
 f.c.document.hidden=false;f.events.visibilitychange();assert.equal(f.c.runs,1);
 f.c.retry.pedir();f.c.retry.cancelar();assert.equal(f.jobs.size,0);f.events.online();assert.equal(f.c.runs,1);
 f.c.retry.pedir();f.c.API.doc={};f.events['oc-licencia-disponible']();assert.equal(f.jobs.size,0);f.events.online();assert.equal(f.c.runs,1);
});
