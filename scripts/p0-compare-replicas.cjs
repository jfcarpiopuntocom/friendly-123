'use strict';
// P0: Offline, read-only, secret-free comparison of two independently recovered
// notebook exports. This does not reconcile customer data or choose a winner.
// Backups may contain customer information: NEVER upload them to CI.
const fs = require('node:fs');
const crypto=require('node:crypto');
function assertExport(x, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || x.parcial === true)
    throw Error(label + ': requires full notebook export');
  for (const k of ['productos', 'ventas', 'movimientos'])
    if (!Array.isArray(x[k])) throw Error(label + ': missing ' + k);
}
function inventory(items, kind) {
  const rows = new Map();
  for (const item of items) {
    const id = item && item.id;
    if (typeof id !== 'string' || !id || id.length > 250 || rows.has(id))
      throw Error(kind + ': missing or duplicate event/product ID');
    rows.set(id, item);
  }
  return rows;
}
const compareIds = (a, b) => {
  let onlyA = 0, onlyB = 0;
  for (const id of a.keys()) if (!b.has(id)) onlyA++;
  for (const id of b.keys()) if (!a.has(id)) onlyB++;
  return {leftTotal:a.size,rightTotal:b.size,onlyLeft:onlyA,onlyRight:onlyB};
};

// Compare same-ID facts as well: a missing-ID count of zero is not proof that
// a sale or audit entry was not modified. Canonical key order avoids false
// positives from JSON object property ordering differences.
function canonical(v) {
  if (v===null || typeof v!=='object') return JSON.stringify(v);
  if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
function conflictingFacts(a,b) {
  let n=0;
  for (const [id,v] of a) if (b.has(id) && canonical(v)!==canonical(b.get(id))) n++;
  return n;
}
const normCode = raw => typeof raw === 'string' ? raw.trim().toUpperCase().replace(/\s+/g, '') : '';
function compare(left, right) {
  assertExport(left, 'left'); assertExport(right, 'right');
  const leftLicense = normCode(left._recuperacion && left._recuperacion.licenseCode);
  const rightLicense = normCode(right._recuperacion && right._recuperacion.licenseCode);
  // notebookId was historically the *device* instanceId, so never use it
  // to assert cross-device identity. A shared license remains authoritative.
  const identity = leftLicense && rightLicense
    ? (leftLicense === rightLicense ? 'same-license-reported' : 'LICENSE_MISMATCH')
    : 'UNKNOWN_LICENSE';
  if (identity === 'LICENSE_MISMATCH') return {
    contract:'f123-replica-forensics-v1',identity,canAutoReconcile:false,
    result:'BLOCKED_IDENTITY', dataCompared:false
  };
  const productsA = inventory(left.productos,'left products');
  const productsB = inventory(right.productos,'right products');
  const salesA = inventory(left.ventas,'left sales');
  const salesB = inventory(right.ventas,'right sales');
  const movesA = inventory(left.movimientos,'left movements');
  const movesB = inventory(right.movimientos,'right movements');
  const products = compareIds(productsA,productsB);
  const sales = compareIds(salesA,salesB);
  const movements = compareIds(movesA,movesB);
  const salePayloadConflicts=conflictingFacts(salesA,salesB);
  const movementPayloadConflicts=conflictingFacts(movesA,movesB);
  let shared=0,physicalEpochForks=0,unequalPhysicalStock=0,
    sameEpochStockDrift=0,legacyStockDrift=0,counterDrift=0,invalidPhysicalStock=0,
    evidenceDrift=0,needsReconciliation=0;
  for (const [id,p] of productsA) {
    if (!productsB.has(id)) continue;
    shared++;
    const q = productsB.get(id);
    const a = p.stockActual,b = q.stockActual;
    if (!Number.isSafeInteger(a) || a<0 || !Number.isSafeInteger(b) || b<0) {
      invalidPhysicalStock++; continue;
    }
    const epochA=typeof p.stockEpochId==='string'?p.stockEpochId:'';
    const epochB=typeof q.stockEpochId==='string'?q.stockEpochId:'';
    const fork=!!(epochA && epochB && epochA!==epochB);
    if (fork) physicalEpochForks++;
    if (a!==b) {
      unequalPhysicalStock++;
      if (fork) { /* Report fork separately: NEVER decide by time or stock=7. */ }
      else if (epochA && epochB && epochA===epochB) sameEpochStockDrift++;
      else legacyStockDrift++;
    }
    if (!fork && epochA===epochB &&
      JSON.stringify(sortCounters(p.stockPN))!==JSON.stringify(sortCounters(q.stockPN))) counterDrift++;
    const pendingA=p.stockConciliacionPendiente===true,pendingB=q.stockConciliacionPendiente===true;
    if(pendingA||pendingB)needsReconciliation++;
    if(canonical(p.stockEvidencias||{})!==canonical(q.stockEvidencias||{})||pendingA!==pendingB)
      evidenceDrift++;
  }
  const mismatch=products.onlyLeft+products.onlyRight+sales.onlyLeft+sales.onlyRight+
    movements.onlyLeft+movements.onlyRight+unequalPhysicalStock+physicalEpochForks+
    counterDrift+invalidPhysicalStock+salePayloadConflicts+movementPayloadConflicts+
    evidenceDrift+needsReconciliation;
  return {
    contract:'f123-replica-forensics-v1',identity,dataCompared:true,
    canAutoReconcile:false,result:identity==='UNKNOWN_LICENSE'?'UNVERIFIED_IDENTITY':
      (mismatch?'RECONCILIATION_REQUIRED':'NO_DIFFERENCE_DETECTED'),
    productIds:products,saleIds:sales,movementIds:movements,
    salePayloadConflicts,movementPayloadConflicts,
    productEvidence:{shared,physicalEpochForks,unequalPhysicalStock,
      sameEpochStockDrift,legacyStockDrift,counterDrift,invalidPhysicalStock,
      evidenceDrift,needsReconciliation},
    // No product names, IDs, PINs, licenses, customer names, transaction detail
    // or hashes are output. Both original backups remain untouched.
    caveat:'Counts alone cannot prove that all causal events were delivered.'
  };
}
function sortCounters(pn) {
  if (!pn || typeof pn!=='object' || Array.isArray(pn)) return null;
  const out=Object.create(null);
  for (const k of Object.keys(pn).sort()) {
    const v=pn[k]||{};
    out[k]=[Number(v.add)||0,Number(v.sub)||0];
  }
  return out;
}

/** FOR LOCAL ANALYSIS ONLY. This output may include sensitive product/event IDs. */
function privateDetails(left,right){
  const summary=compare(left,right);
  if(summary.identity==='LICENSE_MISMATCH')return {...summary,PRIVATE_LOCAL_ONLY:true};
  const byId=rows=>new Map(rows.map(x=>[x.id,x]));
  const diff=(leftRows,rightRows)=>{
    const a=byId(leftRows),b=byId(rightRows);
    return {onlyInPC:[...a.keys()].filter(id=>!b.has(id)).sort(),
      onlyInPhone:[...b.keys()].filter(id=>!a.has(id)).sort(),
      incompatibleSameId:[...a.keys()].filter(id=>b.has(id)&&canonical(a.get(id))!==canonical(b.get(id))).sort()};
  };
  const pc=byId(left.productos),phone=byId(right.productos),physical=[];
  const state=o=>({stockActual:o.stockActual??null,stockBase:o.stockBase??null,
    stockEpochId:o.stockEpochId??null,stockPN:o.stockPN??null,
    stockEvidencias:o.stockEvidencias??null,
    stockConciliacionPendiente:o.stockConciliacionPendiente===true});
  for(const [id,item] of pc){
    if(!phone.has(id))continue;
    const a=state(item),b=state(phone.get(id));
    if(canonical(a)!==canonical(b))physical.push({productId:id,pc:a,phone:b});
  }
  return {PRIVATE_LOCAL_ONLY:true,summary,movements:diff(left.movimientos,right.movimientos),
    sales:diff(left.ventas,right.ventas),
    products:diff(left.productos,right.productos),physical,
    warning:'Exported JSON may not contain every Yjs update or causal dependency. Do not auto-apply or upload.'};
}

module.exports={compare,privateDetails};
if (require.main===module) {
  const args=process.argv.slice(2);
  const privateMode=args[0]==='--private-local';
  const paths=privateMode?args.slice(1):args;
  if (paths.length!==2) {
    process.stderr.write('Use: node scripts/p0-compare-replicas.cjs [--private-local] PC.json PHONE.json\n');
    process.exitCode=2;
  } else {
    try {
      // Refuse very large inputs instead of memory exhaustion. No network, no writes.
      for (const p of paths) if (fs.statSync(p).size>64*1024*1024) throw Error('backup too large');
      const left=JSON.parse(fs.readFileSync(paths[0],'utf8'));
      const right=JSON.parse(fs.readFileSync(paths[1],'utf8'));
      const report=privateMode?privateDetails(left,right):compare(left,right);
      if(privateMode)report.localBackupSHA256={
        pc:crypto.createHash('sha256').update(fs.readFileSync(paths[0])).digest('hex'),
        phone:crypto.createHash('sha256').update(fs.readFileSync(paths[1])).digest('hex')
      };
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
    } catch(e) {
      process.stderr.write('Read-only comparison failed: '+e.message+'\n');
      process.exitCode=2;
    }
  }
}
