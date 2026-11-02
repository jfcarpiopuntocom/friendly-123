'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'../docs');
const version=JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'version-manifest.json'),'utf8'));
test('v637 manifest matches all shell files',()=>{
 // Follows the sealed release (v637 onward) instead of pinning one number.
 const n=Number((version.shell.match(/^f123-shell-v(d+)$/)||[])[1]);
 assert.ok(n>=637,'shell at or after v637');
 assert.match(version.cacheGeneration,/^goldend+$/);
 assert.equal(manifest.shell,version.shell);
 for(const [rel,expected] of Object.entries(manifest.files)){
  const file=path.join(root,rel.slice(2));
  assert.ok(fs.existsSync(file),rel);
  let bytes=fs.readFileSync(file);
  if(/\.(html|js|json|css)$/i.test(file))bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'),'utf8');
  assert.equal('sha256-'+crypto.createHash('sha256').update(bytes).digest('hex'),expected,rel);
 }
});
