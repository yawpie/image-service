const assert = require('node:assert/strict');
const { test, after, afterEach, mock } = require('node:test');
const { load, prisma, pg, response, cleanup } = require('./support.cjs');
const { apiKeyAuth } = load('middleware/apiKeyAuth');
const crypto = load('utils/apiKey');
const { createApiKey } = load('services/apiKeyService');
const { validateAdminId } = load('utils/checkAdminId');
const { checkDuplicateKey, deletePreviousKey } = load('utils/duplicateApiKey');
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

test('auth queries active keys, skips nonmatches, attaches owner, calls next once', async () => {
  const owner = { id: 'key-2', keyHash: 'matching-hash' };
  const query = mock.method(prisma.apikey, 'findMany', async () => [
    { id: 'key-1', keyHash: 'wrong-hash' }, owner, { id: 'key-3', keyHash: 'unused' },
  ]);
  const verify = mock.method(crypto, 'verifyApiKey', async (key, hash) => key === 'raw-key' && hash === owner.keyHash);
  const req = { header: (name) => name === 'x-api-key' ? 'raw-key' : undefined };
  const res = response();
  const next = mock.fn();
  await apiKeyAuth(req, res, next);
  assert.deepEqual(query.mock.calls[0].arguments, [{ where: { isActive: true } }]);
  assert.equal(verify.mock.callCount(), 2);
  assert.equal(req.apiKeyOwner, owner);
  assert.equal(next.mock.callCount(), 1);
  assert.equal(res.statusCode, undefined);
});

for (const failure of ['database', 'verification']) {
  test(`auth returns 500 and denies access on ${failure} failure`, async () => {
    mock.method(prisma.apikey, 'findMany', async () => {
      if (failure === 'database') throw new Error('DB unavailable');
      return [{ keyHash: 'hash' }];
    });
    mock.method(crypto, 'verifyApiKey', async () => { throw new Error('Invalid hash'); });
    const res = response();
    const next = mock.fn();
    await apiKeyAuth({ header: () => 'raw-key' }, res, next);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'An unexpected error occurred');
    assert.equal(next.mock.callCount(), 0);
  });
}

for (const [label, keys] of [['unmatched key', [{ keyHash: 'hash' }]], ['no active keys', []]]) {
  test(`auth must return 401 for ${label}`, { todo: 'Current middleware leaves unmatched keys unanswered and maps empty keys to 400.' }, async () => {
    mock.method(prisma.apikey, 'findMany', async () => keys);
    mock.method(crypto, 'verifyApiKey', async () => false);
    const res = response();
    const next = mock.fn();
    await apiKeyAuth({ header: () => 'wrong-key' }, res, next);
    assert.equal(next.mock.callCount(), 0);
    assert.equal(res.statusCode, 401);
  });
}

test('API key service stores only hash and returns raw key once', async () => {
  const record = { id: 'key-1', keyHash: 'hashed-key' };
  mock.method(crypto, 'generateApiKey', () => 'raw-key');
  const hash = mock.method(crypto, 'hashApiKey', async () => 'hashed-key');
  const create = mock.method(prisma.apikey, 'create', async () => record);
  assert.deepEqual(await createApiKey('dashboard', 'admin-1'), {
    serviceName: 'dashboard', rawKey: 'raw-key', apiKey: record,
  });
  assert.deepEqual(hash.mock.calls[0].arguments, ['raw-key']);
  assert.deepEqual(create.mock.calls[0].arguments, [{
    data: { keyHash: 'hashed-key', serviceName: 'dashboard', adminId: 'admin-1' },
  }]);
});

test('API key service does not return success when persistence fails', async () => {
  mock.method(crypto, 'hashApiKey', async () => 'hash');
  const error = new Error('Write failed');
  mock.method(prisma.apikey, 'create', async () => { throw error; });
  await assert.rejects(createApiKey('dashboard'), (actual) => actual === error);
});

test('admin validation rejects missing ID before opening a connection', async () => {
  await assert.rejects(validateAdminId(), { message: 'Admin ID is required' });
});

for (const [label, rows] of [['existing admin', [{ admin_id: 'admin-1' }]], ['unknown admin', []]]) {
  test(`admin validation handles ${label} with parameterized query and releases client`, async () => {
    const client = { query: mock.fn(async () => ({ rows })), release: mock.fn() };
    mock.method(pg, 'Pool', function (options) {
      assert.equal(options.connectionString, process.env.ADMIN_DATABASE_URL);
      return { connect: async () => client };
    });
    assert.equal(await validateAdminId('admin-1'), rows.length > 0);
    assert.deepEqual(client.query.mock.calls[0].arguments, [
      'SELECT admin_id FROM admin WHERE admin_id = $1', ['admin-1'],
    ]);
    assert.equal(client.release.mock.callCount(), 1);
  });
}

test('admin validation releases client even when query fails', async () => {
  mock.method(console, 'error', () => {});
  const client = { query: async () => { throw new Error('Offline'); }, release: mock.fn() };
  mock.method(pg, 'Pool', function () { return { connect: async () => client }; });
  await assert.rejects(validateAdminId('admin-1'), { message: 'Database query error' });
  assert.equal(client.release.mock.callCount(), 1);
});

test('admin validation propagates connection failure', async () => {
  const error = new Error('Connection failed');
  mock.method(pg, 'Pool', function () { return { connect: async () => { throw error; } }; });
  await assert.rejects(validateAdminId('admin-1'), (actual) => actual === error);
});

for (const [count, expected] of [[0, false], [1, true], [2, true]]) {
  test(`duplicate key check handles ${count} existing keys`, async () => {
    const query = mock.method(prisma.apikey, 'count', async () => count);
    assert.equal(await checkDuplicateKey('admin-1'), expected);
    assert.deepEqual(query.mock.calls[0].arguments, [{ where: { adminId: 'admin-1' } }]);
  });
}

test('key rotation deletes only keys belonging to requested admin', async () => {
  const query = mock.method(prisma.apikey, 'deleteMany', async () => ({ count: 1 }));
  await deletePreviousKey('admin-1');
  assert.deepEqual(query.mock.calls[0].arguments, [{ where: { adminId: 'admin-1' } }]);
});

for (const [name, fn, method] of [['duplicate check', checkDuplicateKey, 'count'], ['key deletion', deletePreviousKey, 'deleteMany']]) {
  test(`${name} rejects missing admin ID and surfaces database failure`, async () => {
    await assert.rejects(fn(''), { message: 'Admin ID is required' });
    mock.method(console, 'error', () => {});
    mock.method(prisma.apikey, method, async () => { throw new Error('Offline'); });
    await assert.rejects(fn('admin-1'), { message: 'Database query error' });
  });
}
