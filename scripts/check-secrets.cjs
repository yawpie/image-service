const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

try {
  const binary = process.env.GITLEAKS_BIN;
  const base = process.env.SECURITY_SCAN_BASE || '';
  assert(binary && fs.existsSync(binary), 'GITLEAKS_BIN must name the verified local scanner');
  assert(!base || /^[0-9a-f]{40}$/i.test(base), 'Invalid secret-scan base SHA');
  const env = { ...process.env };
  const count = Number(env.GIT_CONFIG_COUNT || 0);
  assert(Number.isInteger(count) && count >= 0, 'Invalid Git environment configuration');
  env.GIT_CONFIG_COUNT = String(count + 1);
  env[`GIT_CONFIG_KEY_${count}`] = 'safe.directory';
  env[`GIT_CONFIG_VALUE_${count}`] = process.cwd().replaceAll('\\','/');
  const run = (command, args) => {
    const result = spawnSync(command, args, { env, stdio: 'inherit' });
    assert.equal(result.status, 0, `${command} failed (${result.status ?? result.error?.code ?? result.signal})`);
  };
  const range = base && !/^0{40}$/.test(base) ? `${base}..HEAD` : 'HEAD';
  if (range !== 'HEAD') run('git', ['rev-parse', '--verify', `${base}^{commit}`]);
  run(binary, ['dir', '.', '--redact=100', '--no-banner', '--no-color']);
  run(binary, ['git', '.', '--log-opts', range, '--redact=100', '--no-banner', '--no-color']);
} catch (error) { console.error(error.message); process.exitCode = 1; }
