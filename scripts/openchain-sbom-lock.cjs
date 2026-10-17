'use strict';
/*
 * Offline, read-only CycloneDX 1.5 generator for npm lockfile v3.
 * Built-in Node modules only; never runs lifecycle scripts, installs or fetches packages.
 * It describes *locked dependencies*, not what is necessarily shipped in a PWA.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function own(o, key) { return Object.prototype.hasOwnProperty.call(o, key); }
function safeLoc(loc) {
  return typeof loc === 'string' && !loc.includes('\\') && !loc.includes('\0') &&
    (loc === '' || (loc.split('/').every(p => p !== '' && p !== '.' && p !== '..') && !loc.startsWith('/')));
}
function ref(loc) { return loc === '' ? 'npm-lock:root' : 'npm-lock:' + Buffer.from(loc).toString('base64url'); }
function logicalName(loc, pkg) {
  if (typeof pkg.name === 'string' && pkg.name.length) return pkg.name;
  const token = loc.lastIndexOf('node_modules/');
  return token >= 0 ? loc.slice(token + 13) : loc;
}
function purl(name, version) {
  if (!name || !version) return undefined;
  const scoped = name.startsWith('@') && name.includes('/');
  if (scoped) {
    const idx = name.indexOf('/');
    return `pkg:npm/${encodeURIComponent(name.slice(0, idx))}/${encodeURIComponent(name.slice(idx + 1))}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}
function resolveDependency(packages, origin, name) {
  // Node's ordinary nearest-node_modules lookup; supports nested lock locations.
  const visited = new Set();
  let cursor = origin;
  while (true) {
    const candidate = (cursor ? cursor + '/' : '') + 'node_modules/' + name;
    if (!visited.has(candidate) && own(packages, candidate)) return candidate;
    visited.add(candidate);
    const end = cursor.lastIndexOf('/node_modules/');
    if (end >= 0) cursor = cursor.slice(0, end);
    else if (cursor.startsWith('node_modules/')) cursor = '';
    else if (cursor) cursor = '';
    else break;
  }
  return null;
}
function generate(text, {source = 'package-lock.json'} = {}) {
  if (typeof text !== 'string') throw new TypeError('Expected raw lockfile text');
  const lock = JSON.parse(text);
  if (lock.lockfileVersion !== 3 || !lock.packages || !own(lock.packages, '') ||
    typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    throw new Error('Requires npm lockfileVersion 3 with root packages entry');
  }
  const locations = Object.keys(lock.packages).sort();
  if (locations.some(loc => !safeLoc(loc))) throw new Error('Unsafe package location');
  const root = lock.packages[''];
  if (!root || typeof root !== 'object') throw new Error('Invalid root package');
  const component = (loc, pkg) => {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Malformed package: ' + loc);
    const name = logicalName(loc, pkg);
    if (!name || typeof name !== 'string' || typeof pkg.version !== 'string') throw new Error('Package lacks name/version: ' + loc);
    const rec = {type: loc === '' ? 'application' : 'library', 'bom-ref': ref(loc), name, version: pkg.version};
    const url = purl(name, pkg.version);
    if (url) rec.purl = url;
    if (typeof pkg.license === 'string' && pkg.license.length) {
      // Preserve declaration VERBATIM as a name: SPDX assertions require separate validation.
      rec.licenses = [{license:{name:pkg.license}}];
    }
    const properties = [
      {name:'friendly:lock-location',value:loc || '(root)'},
      {name:'friendly:dev-only-declared',value:String(pkg.dev === true)},
    ];
    if (typeof pkg.integrity === 'string') properties.push({name:'friendly:registry-integrity',value:pkg.integrity});
    if (pkg.optional === true) properties.push({name:'friendly:optional',value:'true'});
    rec.properties = properties;
    return rec;
  };
  const rootComponent = component('', root);
  const components = locations.filter(x => x !== '').map(loc => component(loc, lock.packages[loc]));
  const dependencies = [];
  const unresolved = [];
  const licenseUnknown = [];
  for (const loc of locations) {
    const pkg = lock.packages[loc];
    if (!pkg.license || pkg.license === 'UNKNOWN' || pkg.license === 'UNLICENSED')
      licenseUnknown.push({location:loc || '(root)',name:logicalName(loc,pkg),declared:pkg.license || null});
    const targets = new Set();
    for (const kind of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) {
      const deps = pkg[kind];
      if (deps === undefined) continue;
      if (!deps || typeof deps !== 'object' || Array.isArray(deps)) throw new Error('Invalid dependency map: ' + loc);
      for (const name of Object.keys(deps)) {
        const target = resolveDependency(lock.packages, loc, name);
        if (target === null) unresolved.push({from:loc || '(root)',name,kind,optional:kind === 'optionalDependencies' || (pkg.peerDependenciesMeta?.[name]?.optional === true)});
        else targets.add(ref(target));
      }
    }
    dependencies.push({ref:ref(loc),dependsOn:[...targets].sort()});
  }
  const fileSha256 = crypto.createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex');
  const bom = {
    bomFormat:'CycloneDX',specVersion:'1.5',version:1,
    metadata:{component:rootComponent,properties:[
      {name:'friendly:lock-sha256',value:fileSha256},
      {name:'friendly:source',value:source},
      {name:'friendly:scope-warning',value:'npm lockfile only; does not identify shipped browser bundle, CDN, font, or embedded components'},
    ]},
    components, dependencies,
  };
  const report = {
    input:source,sha256:fileSha256,lockfileVersion:3,
    rootName:rootComponent.name,componentCount:components.length,
    dependencyGraphNodes:dependencies.length,
    resolvedEdges:dependencies.reduce((n,d)=>n+d.dependsOn.length,0),
    unresolved,licenseUnknown,
    scope:'Only packages in this npm lockfile; does not prove shipping, compliance, vulnerability status or source provenance',
    certification:'NOT assessed'
  };
  return {bom,report};
}
function main(argv = process.argv.slice(2)) {
  if (argv.length < 1 || argv.length > 2 || (argv[1] && !['--report','--bom'].includes(argv[1]))) {
    console.error('Usage: node scripts/openchain-sbom-lock.cjs <package-lock.json> [--bom|--report]');
    process.exitCode=2;return;
  }
  const filename=path.resolve(argv[0]);
  const {bom,report}=generate(fs.readFileSync(filename,'utf8'),{source:path.basename(filename)});
  const reportMode = argv[1] === '--report';
  process.stdout.write(JSON.stringify(reportMode?report:bom,null,2)+'\n');
  if (report.unresolved.some(x=>!x.optional)) process.exitCode=1;
}
if(require.main===module)try{main();}catch(e){console.error('OpenChain lock SBOM error:',e.message);process.exitCode=2;}
module.exports={generate,resolveDependency,purl};
