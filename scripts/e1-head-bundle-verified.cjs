'use strict';
// One-time, LAB-branch-only parity hotfix: never touches client data or SQL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const cp = require('node:child_process');
const root = path.resolve(__dirname,'..');
const get = p => fs.readFileSync(path.join(root,p),'utf8');
const digest = s => 'sha256-'+crypto.createHash('sha256').update(s).digest('hex');
const branch = cp.execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
if (branch !== 'work/v564-name-finance-safety-20261022') throw Error('STOP: wrong branch '+branch);
const vendor = 'docs/vendor/supabase-relay.min.js', manifestPath = 'docs/version-manifest.json';
if (!get('supabase-relay/transport.mjs').includes("'head-result'")) throw Error('STOP: source HEAD missing');
if (!get('docs/index.html').includes('src="./vendor/supabase-relay.min.js"')) throw Error('STOP: not the shipped asset');
const original=get(vendor), manifest=get(manifestPath), parsed=JSON.parse(manifest);
if (parsed.files['./vendor/supabase-relay.min.js']!==digest(original)) throw Error('STOP: manifest drift');
const oldList='["op","ckpt","pull","ts"].includes';
const newList='["op","ckpt","pull","ts","head"].includes';
const oldHandler='if(A||!S)return R(this,u,ue).call(this);if(v.k==="ts")return R(this,u,yt).call(this,S);';
const head='if(v.k==="head")return R(this,u,yt).call(this,A||!S?{k:"head-result",v:2,unsupported:!0}:{k:"head-result",v:2,rev:S.rev,seq:S.seq});';
const count=(s,n)=>s.split(n).length-1;
if(count(original,newList)===2 && original.includes(head)){console.log('E1 HEAD already present, no-op');process.exit(0);}
if(count(original,oldList)!==2 || count(original,oldHandler)!==1 || original.includes('"head-result"')) throw Error('STOP: unexpected bundle shape');
const dirty=cp.execFileSync('git',['status','--porcelain','--',vendor,manifestPath],{cwd:root,encoding:'utf8'}).trim();
if(dirty)throw Error('STOP: uncommitted vendor/manifest changes');
const updated=original.split(oldList).join(newList).replace(oldHandler,head+oldHandler);
if(count(updated,newList)!==2 || count(updated,head)!==1)throw Error('STOP: proof invariant');
new vm.Script(updated,{filename:'supabase-relay.min.js'});
const before=parsed.files['./vendor/supabase-relay.min.js'],after=digest(updated);
if(count(manifest,before)!==1)throw Error('STOP: duplicate hash in manifest');
const newManifest=manifest.replace(before,after);
if(JSON.parse(newManifest).files['./vendor/supabase-relay.min.js']!==after)throw Error('STOP: bad manifest');
try {
 fs.writeFileSync(path.join(root,vendor),updated);
 fs.writeFileSync(path.join(root,manifestPath),newManifest);
 if(digest(get(vendor))!==after)throw Error('STOP: written digest mismatch');
} catch(e) {
 fs.writeFileSync(path.join(root,vendor),original);
 fs.writeFileSync(path.join(root,manifestPath),manifest);
 throw e;
}
console.log('E1 HEAD parity fixed, only vendor+manifest; old hash '+before+' new '+after);
