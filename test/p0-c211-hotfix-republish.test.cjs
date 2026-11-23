'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const hotfix=fs.readFileSync(path.join(root,'.github/workflows/hotfix.yml'),'utf8');
const publish=fs.readFileSync(path.join(root,'.github/workflows/publicar.yml'),'utf8');
test('C211 RED historical: already-promoted stable ended hotfix job without candidate (skipped Pages)',()=>{
 const previous=cp.execFileSync('git',['show','ff59fe1195341d052e52deda9feb742ec4102b63:.github/workflows/hotfix.yml'],{cwd:root,encoding:'utf8'});
 assert.match(previous,/\[ "\$ESTABLE" = "\$GITHUB_SHA" \] && \{ echo "estable ya esta aqui; no repetir publicacion"; exit 0; \}/);
});
test('C211 GREEN: already-promoted exact SHA emits candidate so publish runs once',()=>{
 assert.match(hotfix,/\[ "\$ESTABLE" = "\$GITHUB_SHA" \] && \{[^\n]*echo "candidate=\$GITHUB_SHA" >> "\$GITHUB_OUTPUT"; exit 0; \}/);
 assert.match(hotfix,/if: needs\.probar-y-mover\.outputs\.candidate != ''/);
 assert.match(publish,/branches: \[master\]/);
 assert.match(publish,/paths: \["\.github\/workflows\/publicar\.yml"\]/);
 assert.match(publish,/git archive origin\/estable docs/);
 assert.match(publish,/actions\/deploy-pages@v4/);
});
