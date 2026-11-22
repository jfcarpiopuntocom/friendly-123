// C200: los .min.js de arranque deben salir EXACTOS de las fuentes comentadas, y index.html/sw.js servirlos.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.join(__dirname,'..');
test('C200: docs/*.min.js al dia con su fuente (node scripts/build-min-scripts.cjs)',()=>{
  const r=cp.spawnSync(process.execPath,['scripts/build-min-scripts.cjs','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr+r.stdout);
});
test('C200: index.html carga el .min.js y sw.js lo precachea (nunca la fuente de 2 formas)',()=>{
  const html=fs.readFileSync(path.join(root,'docs/index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'docs/sw.js'),'utf8');
  for(const n of ['mock-backend','sync-yjs','avanzado-extra','auth-ui','i18n','sync-realtime']){
    assert.ok(html.includes(`./${n}.min.js`)&&!html.includes(`src="./${n}.js"`),n+' en index.html');
    assert.ok(sw.includes(`"./${n}.min.js"`)&&!sw.includes(`"./${n}.js"`),n+' en sw.js');
  }
});
