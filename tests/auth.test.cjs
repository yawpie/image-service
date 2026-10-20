const assert = require('node:assert/strict');
const { test, after, afterEach, mock } = require('node:test');
const { load, prisma, pg, response, cleanup } = require('./support.cjs');
const { apiKeyAuth } = load('middleware/apiKeyAuth');
const crypto = load('utils/apiKey');
const { createApiKey } = load('services/apiKeyService');
const { validateAdminId } = load('utils/checkAdminId');
const adminId = 'a1111111-1111-4111-8111-111111111111';
after(cleanup);
afterEach(() => mock.restoreAll());

test('auth rejects missing API key without querying database', async () => {
  const query = mock.method(prisma.apikey, 'findMany', async () => []);
  const res = response();
  const next = mock.fn();
  await apiKeyAuth({ header: () => undefined }, res, next);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { message: 'API key missing' });
  assert.equal(query.mock.callCount(), 0);
  assert.equal(next.mock.callCount(), 0);
});

test('auth permits an active unexpired matching key exactly once', async () => {
  const owner = { id: 'key-2', keyHash: 'matching-hash', isActive: true, expiresAt: new Date(Date.now() + 60000) };
  mock.method(prisma.apikey, 'findMany', async () => [
    { id: 'key-1', keyHash: 'wrong-hash', isActive: true, expiresAt: null }, owner,
  ]);
  mock.method(crypto, 'verifyApiKey', async (key, hash) => key === 'raw-key' && hash === owner.keyHash);
  const req = { header: () => 'raw-key' };
  const res = response();
  const next = mock.fn();
  await apiKeyAuth(req, res, next);
  assert.equal(next.mock.callCount(), 1);
  assert.equal(res.statusCode, undefined);
});

for (const [label, keys, matches] of [
  ['unmatched key', [{ keyHash: 'hash', isActive: true, expiresAt: null }], false],
  ['no active keys', [], false],
  ['inactive key', [{ keyHash: 'hash', isActive: false, expiresAt: null }], true],
  ['expired key', [{ keyHash: 'hash', isActive: true, expiresAt: new Date(0) }], true],
  ['key expiring now', [{ keyHash: 'hash', isActive: true, expiresAt: new Date() }], true],
]) {
  test(`auth must return 401 for ${label}`, async () => {
    mock.method(prisma.apikey, 'findMany', async () => keys);
    mock.method(crypto, 'verifyApiKey', async () => matches);
    const res = response();
    const next = mock.fn();
    await apiKeyAuth({ header: () => 'wrong-key' }, res, next);
    assert.equal(next.mock.callCount(), 0);
    assert.equal(res.statusCode, 401);
  });
}

for (const failure of ['database', 'verification']) {
  test(`auth returns safe 500 and denies access on ${failure} failure`, async () => {
    mock.method(prisma.apikey, 'findMany', async () => {
      if (failure === 'database') throw Object.assign(new Error('secret database detail'), { detail: 'secret' });
      return [{ keyHash: 'hash', isActive: true, expiresAt: null }];
    });
    mock.method(crypto, 'verifyApiKey', async () => { throw Object.assign(new Error('secret hash'), { detail: 'secret' }); });
    const res = response();
    const next = mock.fn();
    await apiKeyAuth({ header: () => 'raw-key' }, res, next);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'An unexpected error occurred');
    assert.doesNotMatch(JSON.stringify(res.body), /secret|raw-key|keyHash/);
    assert.equal(next.mock.callCount(), 0);
  });
}

test('API key service replaces same-admin keys inside one transaction and stores only a hash', async () => {
  mock.method(crypto, 'generateApiKey', () => 'raw-key');
  mock.method(crypto, 'hashApiKey', async () => 'hashed-key');
  const stored = [];
  const calls = [];
  const tx = {
    $executeRaw: async () => calls.push('lock'),
    apikey: {
      deleteMany: async ({ where }) => { calls.push('delete'); assert.deepEqual(where, { adminId: { equals: adminId, mode: 'insensitive' } }); },
      create: async ({ data }) => { calls.push('create'); stored.push(data); return { id: 'key-1', ...data }; },
    },
  };
  mock.method(prisma, '$transaction', async (fn) => fn(tx));
  const result = await createApiKey('dashboard', adminId.toUpperCase());
  assert.equal(result.rawKey, 'raw-key');
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], { keyHash: 'hashed-key', serviceName: 'dashboard', adminId });
  assert.deepEqual(calls, ['lock', 'delete', 'create']);
  assert.equal(JSON.stringify(stored).includes('raw-key'), false);
});

test('API key service hash failure cannot mutate keys', async () => {
  const transaction = mock.method(prisma, '$transaction', async () => {});
  mock.method(crypto, 'hashApiKey', async () => { throw new Error('hash failed'); });
  await assert.rejects(createApiKey('dashboard', adminId), { message: 'hash failed' });
  assert.equal(transaction.mock.callCount(), 0);
});

test('API key service does not return a raw key when transaction fails', async () => {
  mock.method(crypto, 'hashApiKey', async () => 'hash');
  const error = new Error('Write failed');
  mock.method(prisma, '$transaction', async () => { throw error; });
  await assert.rejects(createApiKey('dashboard', adminId), (actual) => actual === error);
});

test('admin validation rejects missing ID before opening a connection', async () => {
  await assert.rejects(validateAdminId(), { message: 'Admin ID is required' });
});

for (const config of [undefined, '', '   ']) {
  test(`admin validation has no ambient DB fallback for ${JSON.stringify(config)}`, async () => {
    const previous = process.env.ADMIN_DATABASE_URL;
    if (config === undefined) delete process.env.ADMIN_DATABASE_URL;
    else process.env.ADMIN_DATABASE_URL = config;
    const connect = mock.method(pg, 'Client', function () { throw new Error('must not construct'); });
    try {
      await assert.rejects(validateAdminId(adminId), /ADMIN_DATABASE_URL/);
      assert.equal(connect.mock.callCount(), 0);
    } finally { process.env.ADMIN_DATABASE_URL = previous; }
  });
}

for (const [label, rows] of [['active admin', [{ admin_id: adminId }]], ['unknown or inactive admin', []]]) {
  test(`admin validation handles ${label} and closes its connection`, async () => {
    const client = { connect: mock.fn(async () => {}), query: mock.fn(async () => ({ rows })), end: mock.fn(async () => {}) };
    mock.method(pg, 'Client', function (options) {
      assert.equal(options.connectionString, process.env.ADMIN_DATABASE_URL);
      return client;
    });
    assert.equal(await validateAdminId(adminId), rows.length > 0);
    assert.match(client.query.mock.calls[0].arguments[0], /admin_id = \$1 AND is_active = true/);
    assert.deepEqual(client.query.mock.calls[0].arguments[1], [adminId]);
    assert.equal(client.end.mock.callCount(), 1);
  });
}

for (const failure of ['connect', 'query']) {
  test(`admin validation closes connection on ${failure} failure without logging query details`, async () => {
    const error = new Error('secret connection info');
    const client = { connect: async () => {}, query: async () => ({ rows: [] }), end: mock.fn(async () => {}) };
    client[failure] = async () => { throw error; };
    mock.method(pg, 'Client', function () { return client; });
    const log = mock.method(console, 'error', () => {});
    await assert.rejects(validateAdminId(adminId), (actual) => actual === error);
    assert.equal(client.end.mock.callCount(), 1);
    assert.equal(log.mock.callCount(), 0);
  });
}
