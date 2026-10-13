// v493 (JFC 2026-10-13, "aprobado, quita el testigo"): the automatic promotion no longer
// needs a fresh witness from JFC's phone. Red, Detener, exact-SHA proof and QA still stop it.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const y=fs.readFileSync(path.resolve(__dirname,'../.github/workflows/promover.yml'),'utf8');
test('missing witness does not stop the promotion',()=>{
 assert.doesNotMatch(y,/if ! hayTestigo; then[^\n]*promover=no/);
 assert.match(y,/if ! hayTestigo; then echo "Sin testigo canario: se promueve igual/);
});
test('red, Detener, exact SHA proof and QA still stop it',()=>{
 assert.match(y,/if ! revisar; then echo "promover=no"/);
 assert.match(y,/DETENIDO por JFC/);
 assert.match(y,/release-control\.cjs published "\$GITHUB_SHA"/);
 assert.match(y,/release-control\.cjs gate "\$GITHUB_SHA"/);
});
