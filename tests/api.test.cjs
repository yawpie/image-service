const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { test, before, after, afterEach, mock } = require('node:test');
const { load, prisma, workspace, cleanup } = require('./support.cjs');
const { hashApiKey } = load('utils/apiKey');
const admin = load('utils/checkAdminId');
const duplicate = load('utils/duplicateApiKey');
const keyService = load('services/apiKeyService');
const app = load('app').default;

let server;
let baseUrl;
let keyHash;
// A real 1x1 PNG; multipart tests exercise Multer and disk storage.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=', 'base64');

before(async () => {
  fs.mkdirSync(path.join(workspace, 'uploads'));
  keyHash = await hashApiKey('test-key');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => {
  try {
    if (server) await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  } finally {
    cleanup();
  }
});

function authorize() {
  return mock.method(prisma.apikey, 'findMany', async () => [{ id: 'key-1', keyHash, isActive: true }]);
}

async function request(route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'x-api-key': 'test-key', ...options.headers },
    signal: AbortSignal.timeout(3000),
  });
}

function multipart({ type = 'image/png', name = 'photo.png', field = 'image', bytes = png } = {}) {
  const body = new FormData();
  body.append(field, new Blob([bytes], { type }), name);
  return body;
}

function fakeImage(overrides = {}) {
  return {
    id: 'image-1', originalName: 'photo.png', fileName: 'stored.png',
    mimeType: 'image/png', size: png.length, path: 'uploads/stored.png',
    url: 'https://images.test/uploads/stored.png', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function files() {
  const directory = path.join(workspace, 'uploads');
  return fs.existsSync(directory) ? fs.readdirSync(directory, { recursive: true }).sort() : [];
}

test('health endpoint responds without API key and sends security headers', async () => {
  const res = await request('/', { headers: { 'x-api-key': '' } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Image Service OK');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
});

test('CORS preflight accepts configured dashboard origin with credentials', async () => {
  const res = await request('/images', {
    method: 'OPTIONS',
    headers: { origin: 'https://dashboard.test', 'access-control-request-method': 'POST' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://dashboard.test');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
});

test('CORS does not grant access to unconfigured origins', async () => {
  const res = await request('/', { headers: { origin: 'https://untrusted.test' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

for (const [method, route] of [['POST', '/images'], ['GET', '/images/image-1'], ['DELETE', '/images?url=anything']]) {
  test(`${method} ${route} rejects missing API key before touching DB`, async () => {
    const query = mock.method(prisma.apikey, 'findMany', async () => []);
    const beforeFiles = files();
    const res = await request(route, {
      method, headers: { 'x-api-key': '' },
      ...(method === 'POST' ? { body: multipart() } : {}),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { message: 'API key missing' });
    assert.equal(query.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

for (const [label, route, folder] of [['default folder', '/images', 'default'], ['custom folder', '/images?folder=gallery/events', 'gallery/events']]) {
  test(`upload stores multipart image and metadata in ${label}`, async () => {
    authorize();
    let persisted;
    const create = mock.method(prisma.image, 'create', async ({ data }) => {
      persisted = data;
      return fakeImage(data);
    });
    const res = await request(route, { method: 'POST', body: multipart() });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), fakeImage(persisted));
    assert.equal(create.mock.callCount(), 1);
    assert.equal(persisted.originalName, 'photo.png');
    assert.equal(persisted.mimeType, 'image/png');
    assert.equal(persisted.size, png.length);
    assert.match(persisted.fileName, /^[a-f0-9-]{36}\.png$/);
    assert.equal(persisted.path, `uploads/${folder}/${persisted.fileName}`);
    assert.equal(persisted.url, `https://images.test/${persisted.path}`);
    assert.deepEqual(fs.readFileSync(path.join(workspace, persisted.path)), png);
    const download = await request(`/${persisted.path}`, { headers: { 'x-api-key': '' } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'image/png');
    assert.equal(download.headers.get('access-control-allow-origin'), 'https://dashboard.test');
    assert.equal(download.headers.get('access-control-allow-credentials'), 'true');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  });
}

for (const [mime, extension] of [['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/pjpeg', 'jpg']]) {
  test(`upload accepts configured MIME ${mime}`, async () => {
    authorize();
    mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const res = await request('/images', {
      method: 'POST', body: multipart({ type: mime, name: `photo.${extension}` }),
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).mimeType, mime);
  });
}

for (const [label, body] of [['missing file', () => new FormData()], ['unsupported MIME', () => multipart({ type: 'text/plain', name: 'file.txt' })]]) {
  test(`upload rejects ${label} without creating DB record or file`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async () => fakeImage());
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: body() });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /unsupported file type/);
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

for (const [label, input, message] of [
  ['oversized file', { bytes: Buffer.alloc(1025) }, 'File too large'],
  ['wrong multipart field', { field: 'file' }, 'Unexpected field'],
]) {
  test(`Multer rejects ${label} and leaves no partial files`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async () => fakeImage());
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: multipart(input) });
    // Current global handler reports Multer errors as 500.
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: message });
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

test('upload removes disk file when metadata write fails', async () => {
  authorize();
  mock.method(console, 'error', () => {});
  let uploadedPath;
  mock.method(prisma.image, 'create', async ({ data }) => {
    uploadedPath = path.join(workspace, data.path);
    assert.ok(fs.existsSync(uploadedPath));
    throw new Error('Database unavailable');
  });
  const res = await request('/images', { method: 'POST', body: multipart() });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal server error' });
  assert.equal(fs.existsSync(uploadedPath), false);
});

test('upload still reports DB failure when file cleanup also fails', async () => {
  authorize();
  mock.method(console, 'error', () => {});
  mock.method(prisma.image, 'create', async ({ data }) => {
    fs.unlinkSync(path.join(workspace, data.path));
    throw new Error('Database unavailable');
  });
  const res = await request('/images', { method: 'POST', body: multipart() });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal server error' });
});

test('upload must reject a folder escaping upload directory', { todo: 'folder query currently permits ../ traversal.' }, async () => {
  authorize();
  const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  // The traversal stays inside the disposable test workspace.
  const res = await request('/images?folder=../outside', { method: 'POST', body: multipart() });
  assert.equal(res.status, 400);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(fs.existsSync(path.join(workspace, 'outside')), false);
});

test('metadata GET returns matching image and queries requested ID', async () => {
  authorize();
  const image = fakeImage();
  const query = mock.method(prisma.image, 'findUnique', async () => image);
  const res = await request('/images/image-1');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), image);
  assert.deepEqual(query.mock.calls[0].arguments, [{ where: { id: 'image-1' } }]);
});

test('metadata GET returns 404 for missing image', async () => {
  authorize();
  mock.method(prisma.image, 'findUnique', async () => null);
  const res = await request('/images/missing');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
});

for (const [route, error] of [
  ['/images', 'url must be a string'],
  ['/images?url=', 'url is required'],
  ['/images?url=first&url=second', 'url must be a string'],
]) {
  test(`delete validates URL: ${route}`, async () => {
    authorize();
    const query = mock.method(prisma.image, 'findUnique', async () => null);
    const res = await request(route, { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
    assert.equal(query.mock.callCount(), 0);
  });
}

test('delete returns 404 and skips deletion when metadata is absent', async () => {
  authorize();
  mock.method(prisma.image, 'findUnique', async () => null);
  const remove = mock.method(prisma.image, 'delete', async () => {});
  const res = await request('/images?url=missing', { method: 'DELETE' });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
  assert.equal(remove.mock.callCount(), 0);
});

test('delete removes matching metadata and disk file', async () => {
  authorize();
  const image = fakeImage({ path: 'uploads/delete-me.png' });
  const filePath = path.join(workspace, image.path);
  fs.writeFileSync(filePath, png);
  const query = mock.method(prisma.image, 'findUnique', async () => image);
  const remove = mock.method(prisma.image, 'delete', async () => image);
  const res = await request(`/images?url=${encodeURIComponent(image.url)}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { message: 'success' });
  assert.deepEqual(query.mock.calls[0].arguments, [{ where: { url: image.url } }]);
  assert.deepEqual(remove.mock.calls[0].arguments, [{ where: { url: image.url } }]);
  assert.equal(fs.existsSync(filePath), false);
});

test('delete succeeds when disk file is already absent', async () => {
  authorize();
  mock.method(console, 'error', () => {});
  const image = fakeImage({ path: 'uploads/already-missing.png' });
  mock.method(prisma.image, 'findUnique', async () => image);
  mock.method(prisma.image, 'delete', async () => image);
  const res = await request(`/images?url=${encodeURIComponent(image.url)}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { message: 'success' });
});

for (const operation of ['findUnique', 'delete']) {
  test(`delete preserves file when DB ${operation} fails`, async () => {
    authorize();
    mock.method(console, 'error', () => {});
    const image = fakeImage({ path: `uploads/keep-${operation}.png` });
    const filePath = path.join(workspace, image.path);
    fs.writeFileSync(filePath, png);
    mock.method(prisma.image, 'findUnique', async () => image);
    mock.method(prisma.image, 'delete', async () => image);
    mock.method(prisma.image, operation, async () => { throw new Error('Database unavailable'); });
    const res = await request(`/images?url=${encodeURIComponent(image.url)}`, { method: 'DELETE' });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal server error' });
    assert.deepEqual(fs.readFileSync(filePath), png);
  });
}

async function generate(body, query = '') {
  return request(`/generate${query}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

for (const [body, error] of [[{}, 'adminId is required'], [{ adminId: 'admin-1' }, 'serviceName is required']]) {
  test(`generate validates required fields: ${error}`, async () => {
    const validate = mock.method(admin, 'validateAdminId', async () => true);
    const res = await generate(body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
    assert.equal(validate.mock.callCount(), 0);
  });
}

test('generate denies unknown admin without creating key', async () => {
  mock.method(admin, 'validateAdminId', async () => false);
  const create = mock.method(keyService, 'createApiKey', async () => {});
  const res = await generate({ adminId: 'unknown', serviceName: 'dashboard' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Forbidden' });
  assert.equal(create.mock.callCount(), 0);
});

for (const [query, verbose, isDuplicate] of [['', false, false], ['?verbose=true', true, true], ['?verbose=false', false, false]]) {
  test(`generate creates key and handles rotation: ${query || 'default'}`, async () => {
    const calls = [];
    const record = { id: 'key-1', serviceName: 'dashboard' };
    mock.method(admin, 'validateAdminId', async (id) => { calls.push(['validate', id]); return true; });
    mock.method(duplicate, 'checkDuplicateKey', async (id) => { calls.push(['check', id]); return isDuplicate; });
    mock.method(duplicate, 'deletePreviousKey', async (id) => { calls.push(['delete', id]); });
    mock.method(keyService, 'createApiKey', async (...args) => {
      calls.push(['create', ...args]);
      return { rawKey: 'new-key', apiKey: record };
    });
    const res = await generate({ adminId: 'admin-1', serviceName: 'dashboard' }, query);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), {
      message: 'success', key: 'new-key', ...(verbose ? { apiKey: record } : {}),
    });
    assert.deepEqual(calls, [
      ['validate', 'admin-1'], ['check', 'admin-1'],
      ...(isDuplicate ? [['delete', 'admin-1']] : []),
      ['create', 'dashboard', 'admin-1'],
    ]);
  });
}

for (const stage of ['validate', 'check', 'delete', 'create']) {
  test(`generate handles ${stage} failure and stops subsequent work`, async () => {
    mock.method(console, 'error', () => {});
    const calls = [];
    const step = (name, result) => async () => {
      calls.push(name);
      if (stage === name) throw new Error('Internal detail');
      return result;
    };
    mock.method(admin, 'validateAdminId', step('validate', true));
    mock.method(duplicate, 'checkDuplicateKey', step('check', true));
    mock.method(duplicate, 'deletePreviousKey', step('delete'));
    mock.method(keyService, 'createApiKey', step('create', { rawKey: 'key', apiKey: {} }));
    const res = await generate({ adminId: 'admin-1', serviceName: 'dashboard' });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal server error' });
    const steps = ['validate', 'check', 'delete', 'create'];
    assert.deepEqual(calls, steps.slice(0, steps.indexOf(stage) + 1));
  });
}

test('global handler hides malformed JSON details in production', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await request('/generate', {
      method: 'POST', body: '{bad json', headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Internal server error' });
  } finally {
    process.env.NODE_ENV = previous;
  }
});
