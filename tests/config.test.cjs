const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const { workspace, cleanup } = require('./support.cjs');
after(cleanup);
const modulePath = path.resolve(__dirname, '../dist/middleware/upload');
for (const variable of ['MAX_FILE_SIZE', 'MAX_IMAGE_PIXELS']) {
  for (const value of ['0', '-1', 'NaN', '1.5', 'Infinity']) {
    test(`upload limit ${variable} fails closed for ${value}`, () => {
      const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], { cwd: workspace, env: { ...process.env, [variable]: value }, encoding: 'utf8' });
      assert.notEqual(result.status, 0, 'invalid limits must not disable upload protections');
      assert.match(result.stderr, /positive integer/);
    });
  }
}
