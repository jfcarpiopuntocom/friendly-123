'use strict';
// Deterministic PREVIEW of exactly one release from the integrated candidate.
// CI runs this in a disposable checkout; it never pushes, deploys, or contacts customer data.
// The printed base64 blocks are exact checked-out bytes for atomic Git-tree sealing.
const fs=require('node:fs'),cp=require('node:child_process');
const source='f123-shell-v636',target='f123-shell-v639',newName='shell v639';
const fromGeneration='golden183',toGeneration='golden186';
const versionPath='docs/version.json',swPath='docs/sw.js',dashPath='docs/dashboard.html';
const manifestPath='docs/version-manifest.json';
const version=JSON.parse(fs.readFileSync(versionPath,'utf8'));
if (![source,target].includes(version.shell))throw Error('Unexpected shell baseline; refusing to seal');
if(version.shell===source){
  if(version.cacheGeneration!==fromGeneration)throw Error('Unexpected base cache generation');
  version.version=newName;version.shell=target;version.releaseName=newName;
  version.cacheGeneration=toGeneration;version.fecha='2026-10-31';
  version.changelog='P0 integrated: durable stock ACK recovery; verified canonical Owner PIN route; proportional friendly logo ink. Customer data unchanged.';
  fs.writeFileSync(versionPath,JSON.stringify(version,null,2)+'\n');
  let sw=fs.readFileSync(swPath,'utf8');
  for(const [oldValue,newValue] of [
    ['const CACHE = "'+source+'"','const CACHE = "'+target+'"'],
    ['const CACHE_GENERACION = "-'+fromGeneration+'"','const CACHE_GENERACION = "-'+toGeneration+'"']
  ]){
    if(sw.split(oldValue).length!==2)throw Error('Ambiguous SW replacement '+oldValue);
    sw=sw.replace(oldValue,newValue);
  }
  fs.writeFileSync(swPath,sw);
  let dash=fs.readFileSync(dashPath,'utf8');
  if(dash.split(source).length!==2||dash.split('shell v636').length!==3)
    throw Error('Unexpected dashboard identity; refusing to seal');
  dash=dash.replace(source,target).replaceAll('shell v636',newName);
  fs.writeFileSync(dashPath,dash);
}
if(version.shell===target&&version.cacheGeneration!==toGeneration)
  throw Error('Wrong seal generation');
cp.execFileSync(process.execPath,['scripts/gen-manifest.js'],{stdio:'inherit'});
cp.execFileSync('bash',['check-sw.sh'],{stdio:'inherit'});
const files=[versionPath,swPath,dashPath,manifestPath];
for(const file of files){
  const base64=fs.readFileSync(file).toString('base64');
  console.log('F123-SEALED-BLOB-START '+file);
  for(let i=0;i<base64.length;i+=800)console.log(base64.slice(i,i+800));
  console.log('F123-SEALED-BLOB-END '+file);
}
console.log('F123-SEAL-PREVIEW-PASS '+target+' '+toGeneration+' files='+files.length);
