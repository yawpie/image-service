const assert = require('node:assert/strict');

function readTestEnvironment(env = process.env) {
  const values = {};
  for (const [target, explicit] of [['DATABASE_URL', 'SECURITY_TEST_DATABASE_URL'], ['ADMIN_DATABASE_URL', 'SECURITY_TEST_ADMIN_DATABASE_URL']]) {
    assert.ok(env[explicit] && env[target] === env[explicit], `${explicit} must explicitly match ${target}`);
    const url = new URL(env[explicit]);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname), 'Only loopback PostgreSQL test databases are allowed');
    assert.match(decodeURIComponent(url.pathname), /^\/[a-zA-Z0-9_]+_(test|ci)$/, 'Database name must end in _test or _ci');
    for (const [key, value] of url.searchParams) assert.ok(key === 'schema' && value === 'public', 'Only schema=public is allowed in test database URL options');
    values[target] = env[explicit];
  }
  const image = new URL(values.DATABASE_URL);
  const admin = new URL(values.ADMIN_DATABASE_URL);
  assert.ok(image.host !== admin.host || image.pathname !== admin.pathname, 'Image and admin fixtures must use separate databases');
  return values;
}

function runChecks() {
  Object.assign(process.env, readTestEnvironment());
  process.env.NODE_ENV = 'test';
  const { test, before, after } = require('node:test');
  const { randomUUID } = require('node:crypto');
  const { Client } = require('pg');
  const { prisma } = require('../dist/lib/prisma');
  const { createApiKey } = require('../dist/services/apiKeyService');
  const { validateAdminId } = require('../dist/utils/checkAdminId');
  const { verifyApiKey, hashApiKey } = require('../dist/utils/apiKey');
  const adminId = 'a' + randomUUID().slice(1);
  const otherAdminId = randomUUID();
  const constraint = `security_check_${adminId.replaceAll('-', '')}`;
  const image = new Client({ connectionString: process.env.DATABASE_URL });
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  let connectedImage = false;
  let connectedAdmin = false;
  let constraintCreated = false;
  let previousHash;

  before(async () => {
    await image.connect(); connectedImage = true;
    await admin.connect(); connectedAdmin = true;
    await admin.query('INSERT INTO admin (admin_id, username, hashed_password, is_active) VALUES ($1, $2, $3, true)', [adminId, `security-check-${adminId}`, 'synthetic-unusable-password']);
    previousHash = await hashApiKey('synthetic-previous-key');
    await prisma.apikey.create({ data: { adminId: adminId.toUpperCase(), serviceName: 'security-check-previous', keyHash: previousHash } });
    await prisma.apikey.create({ data: { adminId: otherAdminId, serviceName: 'security-check-unrelated', keyHash: previousHash } });
    // Only this synthetic admin/service combination fails; no existing rows are validated or changed.
    await image.query(`ALTER TABLE apikey ADD CONSTRAINT "${constraint}" CHECK ("adminId" IS DISTINCT FROM '${adminId}' OR "serviceName" <> 'security-check-reject') NOT VALID`);
    constraintCreated = true;
  });

  after(async () => {
    try {
      if (constraintCreated) await image.query(`ALTER TABLE apikey DROP CONSTRAINT "${constraint}"`);
      if (connectedImage) await prisma.apikey.deleteMany({ where: { adminId: { in: [adminId, adminId.toUpperCase(), otherAdminId] } } });
      if (connectedAdmin) await admin.query('DELETE FROM admin WHERE admin_id = $1', [adminId]);
    } finally {
      await prisma.$disconnect();
      await image.end();
      await admin.end();
    }
  });

  test('real PostgreSQL admin lookup rejects unknown and inactive admins', async () => {
    assert.equal(await validateAdminId(adminId), true);
    assert.equal(await validateAdminId(randomUUID()), false);
    await admin.query('UPDATE admin SET is_active = false WHERE admin_id = $1', [adminId]);
    try { assert.equal(await validateAdminId(adminId), false, 'inactive admin must be denied'); }
    finally { await admin.query('UPDATE admin SET is_active = true WHERE admin_id = $1', [adminId]); }
  });

  test('real PostgreSQL insert failure rolls back key replacement', async () => {
    await assert.rejects(createApiKey('security-check-reject', adminId));
    const rows = await prisma.apikey.findMany({ where: { adminId: { equals: adminId, mode: 'insensitive' } } });
    assert.equal(rows.length, 1, 'failed rotation must preserve previous record');
    assert.equal(rows[0].keyHash, previousHash);
    assert.equal(await verifyApiKey('synthetic-previous-key', rows[0].keyHash), true);
  });

  test('real PostgreSQL concurrent rotations leave exactly one live replacement', async () => {
    const results = await Promise.all([createApiKey('security-check-first', adminId.toUpperCase()), createApiKey('security-check-second', adminId)]);
    const rows = await prisma.apikey.findMany({ where: { adminId: { equals: adminId, mode: 'insensitive' } } });
    assert.equal(rows.length, 1, 'concurrent rotations must replace previous keys');
    assert.equal(rows[0].isActive, true);
    assert.equal(rows[0].adminId, adminId, 'stored UUID must be canonical lowercase');
    assert.equal(await verifyApiKey('synthetic-previous-key', rows[0].keyHash), false);
    const matches = await Promise.all(results.map(({ rawKey }) => verifyApiKey(rawKey, rows[0].keyHash)));
    assert.equal(matches.filter(Boolean).length, 1);
    assert.equal(rows[0].keyHash.includes(results[0].rawKey), false);
    assert.equal(rows[0].keyHash.includes(results[1].rawKey), false);
    assert.equal(await prisma.apikey.count({ where: { adminId: otherAdminId } }), 1, 'other admin keys must survive');
  });
}

module.exports = { readTestEnvironment };
if (require.main === module) runChecks();
