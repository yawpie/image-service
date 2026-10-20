/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CI checks execute as CommonJS. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.join(__dirname, 'check-secrets.cjs');
const binary = process.env.GITLEAKS_BIN;
assert(binary && fs.existsSync(binary), 'GITLEAKS_BIN must name the verified local scanner');
function fixture() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const cwd = fs.mkdtempSync(path.join(temporaryRoot, 'smkn4-secret-gate-'));
  assert(cwd.startsWith(temporaryRoot + path.sep + 'smkn4-secret-gate-'), 'Fixture cleanup stays inside the temporary root');
  const git = (...args) => {
    const result = spawnSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\','/')}`, '-c', 'user.name=Security Fixture', '-c', 'user.email=security-fixture@example.invalid', ...args], { cwd, encoding:'utf8' });
    assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  git('init');fs.writeFileSync(path.join(cwd,'README.md'),'Synthetic scanner fixture\n');git('add','.');git('commit','-m','clean baseline');
  return {cwd,git,base:git('rev-parse','HEAD')};
}
function run(cwd, base) { return spawnSync(process.execPath,[script],{cwd,encoding:'utf8',env:{...process.env,SECURITY_SCAN_BASE:base}}); }
function expectFinding(result, synthetic) {
  const output=result.stdout+result.stderr;
  assert.equal(result.status,1);
  assert.match(output,/leaks found:\s*[1-9]\d*/,'Operational failures must not satisfy the positive control');
  assert(!output.includes(synthetic),'Scanner output must redact the credential');
}
test('allows clean history but rejects a secret added then deleted in the change range',()=>{
  const {cwd,git,base}=fixture();
  try {
    for (const candidate of [base,'','0'.repeat(40)]) assert.equal(run(cwd,candidate).status,0);
    const synthetic='ghp_'+require('node:crypto').randomBytes(27).toString('base64').replaceAll('/','A').replaceAll('+','B');
    fs.writeFileSync(path.join(cwd,'credential.env'),`GITHUB_TOKEN=${synthetic}\n`);
    git('add','.');git('commit','-m','synthetic positive control');expectFinding(run(cwd,base),synthetic);fs.unlinkSync(path.join(cwd,'credential.env'));git('add','-A');git('commit','-m','remove synthetic control');
    assert.equal(fs.existsSync(path.join(cwd,'credential.env')),false);
    for (const candidate of [base,'','0'.repeat(40)]) expectFinding(run(cwd,candidate),synthetic);
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
});
test('rejects malformed event base rather than passing it to a shell',()=>{
  const {cwd}=fixture();try{assert.notEqual(run(cwd,'HEAD; echo unsafe').status,0);}finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
