const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readTestEnvironment } = require('../scripts/check-security-db.cjs');
const image = 'postgresql://synthetic:fixture@127.0.0.1:5432/image_test?schema=public';
const admin = 'postgresql://synthetic:fixture@localhost:5432/admin_ci';
const valid = { DATABASE_URL: image, SECURITY_TEST_DATABASE_URL: image, ADMIN_DATABASE_URL: admin, SECURITY_TEST_ADMIN_DATABASE_URL: admin };

test('security DB checks accept only explicit separate loopback test databases', () => {
  assert.deepEqual(readTestEnvironment(valid), { DATABASE_URL: image, ADMIN_DATABASE_URL: admin });
});
for (const [label, overrides] of [
  ['absent URLs', { DATABASE_URL: undefined, SECURITY_TEST_DATABASE_URL: undefined }],
  ['implicit admin', { SECURITY_TEST_ADMIN_DATABASE_URL: undefined }],
  ['mismatched URL', { DATABASE_URL: 'postgresql://localhost/image_other_test' }],
  ['remote host', { DATABASE_URL: 'postgresql://example.invalid/image_test', SECURITY_TEST_DATABASE_URL: 'postgresql://example.invalid/image_test' }],
  ['development database', { DATABASE_URL: 'postgresql://localhost/images', SECURITY_TEST_DATABASE_URL: 'postgresql://localhost/images' }],
  ['URL host override', { DATABASE_URL: `${image}&host=example.invalid`, SECURITY_TEST_DATABASE_URL: `${image}&host=example.invalid` }],
  ['other schema', { DATABASE_URL: image.replace('public', 'private'), SECURITY_TEST_DATABASE_URL: image.replace('public', 'private') }],
  ['shared database', { ADMIN_DATABASE_URL: image, SECURITY_TEST_ADMIN_DATABASE_URL: image }],
]) test(`security DB guard rejects ${label} before connecting`, () => assert.throws(() => readTestEnvironment({ ...valid, ...overrides })));
