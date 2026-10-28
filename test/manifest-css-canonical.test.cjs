const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
test('manifest hashes published CSS consistently across Windows and Linux, preserving binary bytes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/gen-manifest.js'),'utf8');
 const start=source.indexOf('function sha256(file)'),end=source.indexOf('function extraerShell(',start);
 assert.ok(start>=0&&end>start);
 const context={fs,path,crypto,Buffer};vm.runInNewContext(source.slice(start,end),context);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'friendly-css-hash-'));
 try{
  const css=path.join(temp,'dashboard.css'),binary=path.join(temp,'photo.png');
  const lf='a {\n color: #FFFFFF;\n}\n';
  fs.writeFileSync(css,lf);const published=context.sha256(css);
  fs.writeFileSync(css,lf.replace(/\n/g,'\r\n'));assert.equal(context.sha256(css),published);
  const bytes=Buffer.from([0,13,10,255,13,10]);fs.writeFileSync(binary,bytes);
  assert.equal(context.sha256(binary),crypto.createHash('sha256').update(bytes).digest('hex'));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
