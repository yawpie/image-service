/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CI checks execute as CommonJS. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const hash = value => createHash('sha256').update(value).digest('hex');
const day = 86400000;
const skew = 300000;

function checkAudit(report, policy, scope, db, lockText, now = new Date()) {
  assert(['full', 'production'].includes(scope), 'Unknown audit scope');
  assert(policy?.owner && policy.triage, 'Missing triage owner or evidence');
  const reviewed = Date.parse(`${policy.reviewedAt}T00:00:00Z`);
  const expires = Date.parse(`${policy.expiresAt}T23:59:59Z`);
  assert(Number.isFinite(+now) && Number.isFinite(reviewed) && Number.isFinite(expires) && reviewed <= now && now <= expires && expires - reviewed <= 31 * day, 'Audit policy expired or invalid');
  const baseline = policy[scope];
  assert(Number.isInteger(baseline?.packageCount) && baseline.packageCount > 0 && /^[a-f0-9]{64}$/.test(baseline.inventorySha256) && Array.isArray(baseline.findings), 'Missing scoped package inventory/triage');
  assert.equal(hash(lockText.replace(/\r\n/g, '\n')), policy.lockSha256, 'Canonical LF lock content changed; rescan and review the new graph');
  const lock = JSON.parse(lockText);
  assert([2, 3].includes(lock?.lockfileVersion) && lock.packages && Object.hasOwn(lock.packages, ''), 'Invalid npm lockfile');

  const updated = Date.parse(db?.UpdatedAt);
  const downloaded = Date.parse(db?.DownloadedAt);
  const next = Date.parse(db?.NextUpdate);
  assert(db?.Version === 2 && [updated, downloaded, next].every(Number.isFinite) && updated <= +now + skew && downloaded <= +now + skew && downloaded >= updated - skew && +now - updated <= day && +now - downloaded <= day && next > now, 'Advisory DB missing, stale, expired or invalid');
  const created = Date.parse(report?.CreatedAt);
  assert(Number.isFinite(created) && created <= +now + skew && +now - created <= day && created >= downloaded - skew, 'Scan report stale or predates the DB download');
  assert(report?.SchemaVersion === 2 && report.Trivy?.Version === '0.76.0' && report.ArtifactType === 'filesystem' && !report.error, 'Invalid/failed pinned Trivy report');
  assert(Array.isArray(report.Results) && report.Results.length === 1, 'Expected one npm lockfile target');
  const result = report.Results[0];
  assert(result?.Target === 'package-lock.json' && result.Class === 'lang-pkgs' && result.Type === 'npm', 'Unexpected lockfile target/type');
  assert(Array.isArray(result.Packages) && result.Packages.length > 0, 'Empty package inventory');
  const inventory = [...new Set(result.Packages.map(pkg => {
    assert(typeof pkg?.Name === 'string' && pkg.Name && typeof pkg.Version === 'string' && pkg.Version, 'Invalid package inventory');
    return `${pkg.Name}@${pkg.Version}`;
  }))].sort();
  assert.equal(inventory.length, baseline.packageCount, 'Incomplete or changed package inventory');
  assert.equal(hash(JSON.stringify(inventory)), baseline.inventorySha256, 'Unexpected package versions in inventory');
  const findings = result.Vulnerabilities === undefined ? [] : result.Vulnerabilities;
  assert(Array.isArray(findings), 'Invalid vulnerability findings');
  for (const finding of findings) {
    assert(typeof finding?.VulnerabilityID === 'string' && finding.VulnerabilityID && typeof finding.PkgName === 'string' && typeof finding.InstalledVersion === 'string' && ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(finding.Severity) && (finding.FixedVersion === undefined || typeof finding.FixedVersion === 'string'), 'Invalid advisory identity/severity');
    assert(inventory.includes(`${finding.PkgName}@${finding.InstalledVersion}`), 'Advisory package absent from inventory');
    const fingerprint = { id: finding.VulnerabilityID, name: finding.PkgName, version: finding.InstalledVersion, severity: finding.Severity, fixed: finding.FixedVersion || '' };
    assert(baseline.findings.some(item => JSON.stringify(item) === JSON.stringify(fingerprint)), `Untriaged ${scope} advisory: ${finding.VulnerabilityID}/${finding.PkgName}`);
  }
  return findings.length;
}

module.exports = { checkAudit };
if (require.main === module) {
  try {
    assert.equal(process.argv.length, 7, 'Usage: node scripts/check-dependency-audit.cjs <policy.json> <full.json> <production.json> <db-metadata.json> <package-lock.json>');
    const policy = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const db = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
    const lock = fs.readFileSync(process.argv[6], 'utf8');
    for (const [scope, file] of [['full', process.argv[3]], ['production', process.argv[4]]]) {
      console.log(`${scope}: ${checkAudit(JSON.parse(fs.readFileSync(file, 'utf8')), policy, scope, db, lock)} Trivy findings match dated triage; release approval is separate`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
