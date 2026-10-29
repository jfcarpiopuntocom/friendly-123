const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const file of ['src/app/app-inline-06.js','docs/app-inline-06.min.js']){
  test(file+': summary preserves role/gate visibility without measuring layout for locked or unauthorized users',()=>{
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    const start=source.indexOf('function visible()'),end=source.indexOf('function actualizarFAB()',start);
    let classes=new Set(),reads=0,display='block',parent={};
    const gate={style:{get display(){return display;}},get offsetParent(){reads++;return parent;}};
    const c={document:{body:{classList:{contains:k=>classes.has(k)}},getElementById:()=>gate,querySelector:()=>null}};
    vm.createContext(c);vm.runInContext(source.slice(start,end),c);
    for(const roles of [[],['rol-empleado'],['rol-contador'],['rol-dueno','rol-demo']]){
      classes=new Set(roles);reads=0;assert.equal(c.visible(),false);assert.equal(reads,0,'no forced gate layout for an unauthorized role');
    }
    for(const role of ['rol-dueno','rol-admin']){
      classes=new Set([role]);display='block';parent={};assert.equal(c.visible(),false,'visible PIN gate suppresses summary');
      display='none';assert.equal(c.visible(),true,'authenticated owner/admin retains summary');
      display='block';parent=null;assert.equal(c.visible(),true,'detached gate does not suppress summary');
    }
  });
}
