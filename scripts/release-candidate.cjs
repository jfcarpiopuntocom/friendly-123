// Publication may assemble only the stable commit already tested by hotfix.
// Empty expected SHA preserves the existing manual dispatch/recovery routes.
function assertStableCandidate(expected, stable) {
  if (!/^[0-9a-f]{40}$/.test(stable)) throw Error('Invalid stable commit');
  if (expected && (!/^[0-9a-f]{40}$/.test(expected) || expected !== stable)) {
    throw Error('Stable changed after focused checks; refusing to publish another candidate');
  }
  return stable;
}
if (require.main === module) assertStableCandidate(process.argv[2], process.argv[3]);
module.exports = { assertStableCandidate };
