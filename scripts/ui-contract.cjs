// Validador del contrato de UI (release/ui-contract.json).
// Por qué existe: el contrato dice qué controles ve cada rol; si alguien lo cambia
// (quita un control, un rol o un texto) tiene que haber un changeApproval de JFC.
// Uso CLI: node scripts/ui-contract.cjs [ref-git-previo]   (por defecto HEAD^)
const ROLES = ['dueno', 'admin', 'empleado', 'contador'];

// Devuelve la lista de errores (vacía = contrato válido).
// Si se pasa `prev` (contrato anterior) y hay diferencias, exige un changeApproval nuevo.
function validateContract(c, prev) {
  const e = [];
  if (c.schema !== 1) e.push('schema debe ser 1');
  const ids = new Set();
  for (const s of c.screens || []) for (const k of s.controls || []) {
    if (ids.has(k.id)) e.push('id duplicado: ' + k.id);
    ids.add(k.id);
    if (!k.selector) e.push(k.id + ': falta selector');
    if (!k.text || !k.text.en || !k.text.es) e.push(k.id + ': falta text.en o text.es');
    if (!Array.isArray(k.roles) || k.roles.some(r => !ROLES.includes(r))) e.push(k.id + ': roles inválidos');
  }
  if (prev && diffNeedsApproval(prev, c)) {
    const nuevas = (c.changeApproval || []).length - (prev.changeApproval || []).length;
    const ult = (c.changeApproval || []).at(-1);
    if (nuevas < 1 || !ult || ult.approvedBy !== 'JFC' || !ult.date || !ult.reason) {
      e.push('cambio de contrato sin changeApproval de JFC');
    }
  }
  return e;
}

// Compara ignorando changeApproval: agregar una aprobación sola no es "cambiar el contrato".
function diffNeedsApproval(prev, next) {
  const strip = c => JSON.stringify({ ...c, changeApproval: undefined });
  return strip(prev) !== strip(next);
}

if (require.main === module) {
  const fs = require('node:fs');
  const { execSync } = require('node:child_process');
  const cur = JSON.parse(fs.readFileSync('release/ui-contract.json', 'utf8'));
  // Si el contrato aún no existe en el commit previo, prev queda null (primer contrato).
  let prev = null;
  try {
    prev = JSON.parse(execSync('git show ' + (process.argv[2] || 'HEAD^') + ':release/ui-contract.json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (_) { /* sin contrato previo */ }
  const errs = validateContract(cur, prev);
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('ui-contract OK');
}
module.exports = { validateContract, diffNeedsApproval, ROLES };
