'use strict';
// Public display only; do not mutate internal shell or cache identities.
function publicVersionFromShell(shell) {
  const match = /^f123-shell-v([1-9][0-9]*)$/.exec(String(shell || ''));
  if (!match) throw new Error('invalid technical shell');
  const n = Number(match[1]);
  if (!Number.isSafeInteger(n) || n < 100 || n >= 1000)
    throw new Error('out-of-policy shell: v1.0 requires a separate release decision');
  return 'v0.' + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
}
module.exports = { publicVersionFromShell };
