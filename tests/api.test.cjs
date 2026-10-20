const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { test, before, after, afterEach, mock } = require('node:test');
const sharp = require('sharp');
const { load, prisma, workspace, cleanup, logs } = require('./support.cjs');
const { hashApiKey } = load('utils/apiKey');
const admin = load('utils/checkAdminId');
const adminId = '11111111-1111-4111-8111-111111111111';
const keyService = load('services/apiKeyService');
const app = load('app').default;

let server;
let baseUrl;
let keyHash;
let png, jpeg, webp, tagged;

before(async () => {
  fs.mkdirSync(path.join(workspace, 'uploads'));
  const bitmap = sharp({ create: { width: 2, height: 2, channels: 3, background: '#4588bb' } });
  png = await bitmap.clone().png().toBuffer();
  jpeg = await bitmap.clone().jpeg().toBuffer();
  webp = await bitmap.clone().webp().toBuffer();
  tagged = await bitmap.clone().jpeg().withExif({ IFD0: { Copyright: 'sensitive fixture metadata' } }).toBuffer();
  keyHash = await hashApiKey('test-key');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => { mock.restoreAll(); logs.length = 0; });
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

test('CORS preflight accepts built-in school development origin even with CORS_ORIGIN set', async () => {
  const res = await request('/images', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://landing.dev.smkn4mtr.sch.id',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-api-key',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://landing.dev.smkn4mtr.sch.id');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
});

test('static images do not expose an unrelated STATIC_ORIGIN', async () => {
  const res = await request('/', { headers: { origin: 'https://landing.dev.smkn4mtr.sch.id' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://landing.dev.smkn4mtr.sch.id');
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
    assert.equal(persisted.mimeType, 'image/webp');
    assert.match(persisted.fileName, /^[a-f0-9-]{36}\.webp$/);
    assert.equal(persisted.path, `uploads/${folder}/${persisted.fileName}`);
    assert.equal(persisted.url, `https://images.test/${persisted.path}`);
    const stored = fs.readFileSync(path.join(workspace, persisted.path));
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 2);
    assert.equal(metadata.height, 2);
    assert.equal(persisted.size, stored.length);
    const download = await request(`/${persisted.path}`, { headers: { 'x-api-key': '' } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'image/webp');
    assert.equal(download.headers.get('access-control-allow-origin'), null);
    assert.equal(download.headers.get('access-control-allow-credentials'), 'true');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), stored);
  });
}

for (const [mime, extension] of [['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/pjpeg', 'jpg'], ['image/jpg', 'jpg']]) {
  test(`upload accepts supported MIME ${mime}`, async () => {
    authorize();
    mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const res = await request('/images', {
      method: 'POST', body: multipart({ type: mime, name: `photo.${extension}`, bytes: mime === 'image/webp' ? webp : jpeg }),
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).mimeType, 'image/webp');
  });
}

for (const [label, body, status] of [['missing file', () => new FormData(), 400], ['unsupported MIME', () => multipart({ type: 'text/plain', name: 'file.txt' }), 415]]) {
  test(`upload rejects ${label} without creating DB record or file`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async () => fakeImage());
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: body() });
    assert.equal(res.status, status);
    assert.equal(typeof (await res.json()).error, 'string');
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

for (const [label, input, status, message] of [
  ['oversized file', { bytes: Buffer.alloc(1025) }, 413, 'File too large'],
  ['wrong multipart field', { field: 'file' }, 400, 'Invalid multipart request'],
]) {
  test(`Multer rejects ${label} and leaves no partial files`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async () => fakeImage());
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: multipart(input) });
    assert.equal(res.status, status);
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

test('upload must reject a folder escaping upload directory', async () => {
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

async function generate(body, query = '', headers = {}) {
  return request(`/generate${query}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-provisioning-key': 'fixture-provisioning-key', ...headers },
  });
}

for (const [label, key] of [['anonymous', ''], ['wrong same length', 'wrong--provisioning-key'], ['short key', 'x'], ['long key', 'x'.repeat(128)]]) {
  test(`generate rejects ${label} before admin lookup or key mutation`, async () => {
    const validate = mock.method(admin, 'validateAdminId', async () => true);
    const create = mock.method(keyService, 'createApiKey', async () => ({ rawKey: 'secret' }));
    const res = await generate({ adminId, serviceName: 'dashboard' }, '', { 'x-provisioning-key': key });
    assert.equal(res.status, 401);
    assert.equal(validate.mock.callCount(), 0);
    assert.equal(create.mock.callCount(), 0);
    assert.doesNotMatch(JSON.stringify(await res.json()), /secret|fixture-provisioning-key/);
  });
}

for (const config of [undefined, '', '   ']) {
  test(`generate fails closed for provisioning config ${JSON.stringify(config)}`, async () => {
    const previous = process.env.IMAGE_SERVICE_PROVISIONING_KEY;
    if (config === undefined) delete process.env.IMAGE_SERVICE_PROVISIONING_KEY;
    else process.env.IMAGE_SERVICE_PROVISIONING_KEY = config;
    const validate = mock.method(admin, 'validateAdminId', async () => true);
    const create = mock.method(keyService, 'createApiKey', async () => ({ rawKey: 'secret' }));
    try {
      const res = await generate({ adminId, serviceName: 'dashboard' });
      assert.equal(res.status, 503);
      assert.equal(validate.mock.callCount(), 0);
      assert.equal(create.mock.callCount(), 0);
    } finally { process.env.IMAGE_SERVICE_PROVISIONING_KEY = previous; }
  });
}

for (const body of [null, [], {}, { adminId }, { adminId: 'not-a-uuid', serviceName: 'dashboard' }, { adminId: {}, serviceName: 'dashboard' },
  { adminId, serviceName: '' }, { adminId, serviceName: '   ' }, { adminId, serviceName: [] }, { adminId, serviceName: 'x'.repeat(256) }]) {
  test(`generate validates body ${JSON.stringify(body)}`, async () => {
    const validate = mock.method(admin, 'validateAdminId', async () => true);
    const res = await generate(body);
    assert.equal(res.status, 400);
    assert.equal(validate.mock.callCount(), 0);
    assert.doesNotMatch(JSON.stringify(await res.json()), /TypeError|stack|fixture-provisioning-key/);
  });
}

for (const [label, id, accepted] of [
  ['v1', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', true],
  ['v2', '00000000-0000-2000-8000-000000000000', true],
  ['v3', '6fa459ea-ee8a-3ca4-894e-db77e160355e', true],
  ['v4', '11111111-1111-4111-8111-111111111111', true],
  ['v5', '886313e1-3b8a-5372-9b90-0c9aee199e5d', true],
  ['NIL', '00000000-0000-0000-0000-000000000000', true],
  ['uppercase', '6FA459EA-EE8A-3CA4-894E-DB77E160355E', true],
  ['v6', '1ed6b1f4-6ab3-6cfe-86c4-5dd904348a1f', false],
  ['v7', '01890f47-6f00-7cc4-98c4-dc0c0c07398f', false],
  ['v8', '00000000-0000-8000-8000-000000000000', false],
  ['MAX', 'ffffffff-ffff-ffff-ffff-ffffffffffff', false],
  ['invalid variant', '11111111-1111-4111-7111-111111111111', false],
  ['invalid hex', 'g1111111-1111-4111-8111-111111111111', false],
  ['no separators', '11111111111141118111111111111111', false],
  ['leading whitespace', ' 11111111-1111-4111-8111-111111111111', false],
  ['trailing whitespace', '11111111-1111-4111-8111-111111111111 ', false],
  ['embedded NUL', '11111111-1111-4111-8111-111111111111\0', false],
]) {
  test(`generate preserves the original UUID acceptance contract: ${label}`, async () => {
    const validate = mock.method(admin, 'validateAdminId', async () => true);
    const create = mock.method(keyService, 'createApiKey', async () => ({ rawKey: 'new-key' }));
    const res = await generate({ adminId: id, serviceName: 'dashboard' });
    assert.equal(res.status, accepted ? 201 : 400);
    assert.equal(validate.mock.callCount(), accepted ? 1 : 0);
    assert.equal(create.mock.callCount(), accepted ? 1 : 0);
    if (accepted) assert.deepEqual(create.mock.calls[0].arguments, ['dashboard', id]);
    else assert.deepEqual(await res.json(), { error: 'adminId must be a UUID' });
  });
}

test('generate denies unknown or inactive admin without creating key', async () => {
  mock.method(admin, 'validateAdminId', async () => false);
  const create = mock.method(keyService, 'createApiKey', async () => {});
  const res = await generate({ adminId, serviceName: 'dashboard' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Forbidden' });
  assert.equal(create.mock.callCount(), 0);
});

for (const query of ['', '?verbose=true', '?verbose=false']) {
  test(`generate accepts server header, trims service and never exposes record: ${query || 'default'}`, async () => {
    mock.method(admin, 'validateAdminId', async (id) => id === adminId);
    const create = mock.method(keyService, 'createApiKey', async () => ({ rawKey: 'new-key', apiKey: { keyHash: 'secret-hash' } }));
    const res = await generate({ adminId, serviceName: '  dashboard  ' }, query);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { message: 'success', key: 'new-key' });
    assert.deepEqual(create.mock.calls[0].arguments, ['dashboard', adminId]);
  });
}

for (const stage of ['validate', 'create']) {
  test(`generate returns generic error without diagnostics on ${stage} failure`, async () => {
    const log = mock.method(console, 'error', () => {});
    mock.method(admin, 'validateAdminId', async () => { if (stage === 'validate') throw new Error('secret database url'); return true; });
    mock.method(keyService, 'createApiKey', async () => { throw new Error('secret key hash'); });
    const res = await generate({ adminId, serviceName: 'dashboard' });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal server error' });
    assert.equal(log.mock.callCount(), 0);
  });
}

for (const [label, bytes] of [
  ['SVG disguised as PNG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><script>alert(1)</script></svg>')],
  ['HTML disguised as PNG', () => Buffer.from('<html><script>alert(1)</script></html>')],
  ['fake bitmap', () => Buffer.from('not an image')],
  ['corrupt bitmap', () => { const corrupt = Buffer.from(png); corrupt[corrupt.length - 20] ^= 255; return corrupt; }],
  ['truncated JPEG', () => jpeg.subarray(0, jpeg.length - 30)],
  ['truncated PNG', () => png.subarray(0, 45)],
  ['excessive pixels', () => sharp({ create: { width: 5, height: 5, channels: 3, background: '#ffffff' } }).png().toBuffer()],
]) {
  test(`upload rejects ${label} before creating files or rows`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: multipart({ bytes: await bytes() }) });
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: 'Invalid or unsupported image' });
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

test('upload discards original extension and extra metadata from a real decoded bitmap', async () => {
  authorize();
  mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const res = await request('/images', { method: 'POST', body: multipart({ bytes: tagged, type: 'image/jpeg', name: '<script>alert(1)</script>.html' }) });
  assert.equal(res.status, 201);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const image = await res.json();
  assert.match(image.fileName, /^[a-f0-9-]{36}\.webp$/);
  assert.equal(image.mimeType, 'image/webp');
  const stored = fs.readFileSync(path.join(workspace, image.path));
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, 'webp');
  for (const field of ['exif', 'icc', 'xmp', 'iptc']) assert.equal(metadata[field], undefined);
  assert.equal(stored.includes(Buffer.from('sensitive fixture metadata')), false);
});

for (const query of [
  'folder=/outside', 'folder=..', 'folder=.', 'folder=./events', 'folder=events/../outside',
  'folder=events//outside', 'folder=events/', 'folder=', 'folder=C:/outside', 'folder=C:%5Coutside',
  'folder=..%5Coutside', 'folder=events%2Foutside', 'folder=%2E%2E/outside', 'folder=%252E%252E/outside',
  'folder[]=../outside', 'folder=x&folder=../outside', 'folder[child]=outside', 'fo%6Cder=events%2foutside',
  'folder=%00outside', 'folder=%252foutside',
]) {
  test(`upload rejects unsafe folder before multipart parsing: ${query}`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const beforeFiles = files();
    // Deliberately malformed multipart: folder validation must precede Multer.
    const res = await request(`/images?${query}`, { method: 'POST', body: 'no multipart boundary', headers: { 'content-type': 'multipart/form-data' } });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid folder' });
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

test('upload cannot follow an existing directory symlink outside the upload root', async () => {
  authorize();
  const outside = path.join(workspace, 'linked-outside');
  const link = path.join(workspace, 'uploads', 'linked');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const res = await request('/images?folder=linked/new', { method: 'POST', body: multipart() });
  assert.equal(res.status, 400);
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});

for (const [label, keys] of [
  ['unknown', () => [{ keyHash, isActive: true, expiresAt: null }]],
  ['no active', () => []],
  ['inactive', () => [{ keyHash, isActive: false, expiresAt: null }]],
  ['expired', () => [{ keyHash, isActive: true, expiresAt: new Date(0) }]],
]) {
  test(`HTTP auth returns 401 without hanging for ${label} key before file work`, async () => {
    mock.method(prisma.apikey, 'findMany', async () => keys());
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', headers: { 'x-api-key': label === 'unknown' ? 'unmatched' : 'test-key' }, body: multipart() });
    assert.equal(res.status, 401);
    assert.deepEqual(files(), beforeFiles);
  });
}

test('metadata GET returns a safe 500 on asynchronous database failure', async () => {
  authorize();
  mock.method(prisma.image, 'findUnique', async () => { throw Object.assign(new Error('private-db-url'), { detail: 'private record' }); });
  const res = await request('/images/private-id');
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal server error' });
});

for (const storedPath of ['../outside-delete.png', 'uploads/../outside-delete.png', 'uploads/linked/sentinel.png']) {
  test(`delete refuses an escaping legacy path: ${storedPath}`, async () => {
    authorize();
    const outside = path.join(workspace, 'outside-delete.png');
    const linkedSentinel = path.join(workspace, 'linked-outside', 'sentinel.png');
    fs.mkdirSync(path.dirname(linkedSentinel), { recursive: true });
    if (storedPath.includes('/linked/')) {
      const link = path.join(workspace, 'uploads', 'linked');
      if (!fs.existsSync(link)) fs.symlinkSync(path.dirname(linkedSentinel), link, process.platform === 'win32' ? 'junction' : 'dir');
    }
    fs.writeFileSync(outside, 'keep outside');
    fs.writeFileSync(linkedSentinel, 'keep linked');
    const image = fakeImage({ path: storedPath });
    mock.method(prisma.image, 'findUnique', async () => image);
    const remove = mock.method(prisma.image, 'delete', async () => image);
    const res = await request(`/images?url=${encodeURIComponent(image.url)}`, { method: 'DELETE' });
    assert.equal(res.status, 500);
    assert.equal(remove.mock.callCount(), 0);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep outside');
    assert.equal(fs.readFileSync(linkedSentinel, 'utf8'), 'keep linked');
  });
}

for (const body of ['{private malformed body', '{"private":"' + 'x'.repeat(110000) + '"}']) {
  test(`JSON parser error is safe (${body.length} bytes)`, async () => {
    const res = await request('/generate?secret=PRIVATE_QUERY', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, body.length > 100000 ? 413 : 400);
    assert.deepEqual(await res.json(), { error: body.length > 100000 ? 'Request too large' : 'Invalid JSON' });
  });
}

test('malformed multipart returns a safe 400 with no files', async () => {
  authorize();
  const beforeFiles = files();
  const res = await request('/images', { method: 'POST', body: 'PRIVATE_BODY', headers: { 'content-type': 'multipart/form-data; boundary=private-boundary' } });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Invalid multipart request' });
  assert.deepEqual(files(), beforeFiles);
});

test('access and action logs omit URLs, credentials, file data, bodies and stacks', async () => {
  authorize();
  const diagnostics = mock.method(console, 'log', () => {});
  const errors = mock.method(console, 'error', () => {});
  mock.method(prisma.image, 'create', async () => { throw Object.assign(new Error('PRIVATE_DB_DETAIL'), { detail: 'PRIVATE_RECORD' }); });
  const previousDebug = process.env.DEBUG;
  process.env.DEBUG = 'true';
  try {
    const res = await request('/images?private=PRIVATE_QUERY', { method: 'POST', body: multipart({ name: 'PRIVATE_FILENAME.png' }), headers: { authorization: 'Bearer PRIVATE_AUTH', 'x-provisioning-key': 'PRIVATE_PROVISIONING' } });
    assert.equal(res.status, 500);
    await res.json();
    assert.equal(diagnostics.mock.callCount(), 0);
    assert.equal(errors.mock.callCount(), 0);
    assert.ok(logs.length > 0);
    const logged = JSON.stringify(logs);
    assert.doesNotMatch(logged, /PRIVATE|test-key|keyHash|\/images|stack|originalname|buffer|headers|body/i);
    assert.match(logged, /POST/);
    assert.match(logged, /500/);
  } finally { process.env.DEBUG = previousDebug; }
});

test('upload rejects animated WebP before writing a file', async () => {
  authorize();
  const bytes = await sharp(Buffer.concat([Buffer.alloc(12, 0), Buffer.alloc(12, 255)]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(bytes, { animated: true }).metadata()).pages, 2);
  const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const beforeFiles = files();
  const res = await request('/images', { method: 'POST', body: multipart({ bytes, type: 'image/webp' }) });
  assert.equal(res.status, 415);
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(files(), beforeFiles);
});

test('upload never overwrites or cleans up an existing file on a name collision', async () => {
  authorize();
  const storage = load('utils/storage');
  mock.method(storage, 'generateFilename', () => 'collision.webp');
  const existing = path.join(workspace, 'uploads', 'default', 'collision.webp');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, 'keep existing file');
  const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const res = await request('/images', { method: 'POST', body: multipart() });
  assert.equal(res.status, 500);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'keep existing file');
});

test('upload removes only its newly created partial file on storage failure', async () => {
  authorize();
  const originalOpen = fs.promises.open;
  mock.method(fs.promises, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    const originalWrite = handle.writeFile.bind(handle);
    handle.writeFile = async (bytes) => { await originalWrite(bytes.subarray(0, 1)); throw new Error('PRIVATE_DISK_ERROR'); };
    return handle;
  });
  const beforeFiles = files();
  const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const res = await request('/images', { method: 'POST', body: multipart() });
  assert.equal(res.status, 500);
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(files(), beforeFiles);
});

for (const headers of [
  { 'content-type': 'application/json; charset=unsupported-fixture' },
  { 'content-type': 'application/json', 'content-encoding': 'unsupported-fixture' },
]) {
  test(`body parser rejects unsupported encoding safely: ${JSON.stringify(headers)}`, async () => {
    const res = await request('/generate', { method: 'POST', body: '{}', headers });
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: 'Invalid request' });
  });
}

for (const [label, bytes] of [['JPEG', () => jpeg], ['PNG', () => png], ['WebP', () => webp]]) {
  test(`upload rejects a ${label} missing its final byte`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const beforeFiles = files();
    const original = bytes();
    const res = await request('/images', { method: 'POST', body: multipart({ bytes: original.subarray(0, original.length - 1), type: label === 'WebP' ? 'image/webp' : label === 'JPEG' ? 'image/jpeg' : 'image/png' }) });
    assert.equal(res.status, 415);
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

for (const count of [10, 11]) {
  test(`multipart allows ten bounded metadata fields: ${count} fields`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const body = multipart();
    for (let i = 0; i < count; i++) body.append(`field${i}`, 'fixture');
    const res = await request('/images', { method: 'POST', body });
    assert.equal(res.status, count === 10 ? 201 : 400);
    assert.equal(create.mock.callCount(), count === 10 ? 1 : 0);
  });
}

test('multipart bounds each metadata field without files or rows', async () => {
  authorize();
  const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const beforeFiles = files();
  const body = multipart(); body.append('note', 'x'.repeat(16385));
  const res = await request('/images', { method: 'POST', body });
  assert.equal(res.status, 400);
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(files(), beforeFiles);
});

for (const [label, type, base64] of [
  ['two-frame APNG', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEACgAA6FTcAAAAABFJREFUeJxj+M/A8J8BjIEUAB/uA/3SUH0aAAAAGmZjVEwAAAABAAAAAgAAAAIAAAAAAAAAAAABAAoAAHMnNtQAAAATZmRBVAAAAAJ4nGNg+M8AQhAKABvyA/2ix+ebAAAAAElFTkSuQmCC'],
  ['one-frame APNG', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAABAAAAALQt6aAAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEACgAA6FTcAAAAABFJREFUeJxj+M/A8J8BjIEUAB/uA/3SUH0aAAAAAElFTkSuQmCC'],
  ['one-frame looping WebP', 'image/webp', 'UklGRlwAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAEAAAEAAGQAAAJWUDggGAAAADABAJ0BKgIAAgABQCYlpAADcAD+/TZoAA=='],
]) {
  test(`upload rejects an animation container: ${label}`, async () => {
    authorize();
    const bytes = Buffer.from(base64, 'base64');
    assert.equal((await sharp(bytes).raw().toBuffer()).length, 12, 'fixture contains a decodable 2x2 bitmap');
    const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: multipart({ bytes, type, name: label.endsWith('WebP') ? 'animated.webp' : 'animated.png' }) });
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: 'Invalid or unsupported image' });
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}

test('upload accepts static PNG pixel data containing the acTL byte sequence', async () => {
  authorize();
  const bytes = await sharp(Buffer.from([97, 99, 84, 76, 1, 2, 3, 4, 5, 6, 7, 8]), { raw: { width: 2, height: 2, channels: 3 } }).png({ compressionLevel: 0, adaptiveFiltering: false }).toBuffer();
  assert.equal(bytes.includes(Buffer.from('acTL')), true, 'static fixture contains the animation marker inside pixel data');
  mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
  const res = await request('/images', { method: 'POST', body: multipart({ bytes }) });
  assert.equal(res.status, 201);
  const image = await res.json();
  assert.equal(image.mimeType, 'image/webp');
  assert.equal((await sharp(fs.readFileSync(path.join(workspace, image.path))).metadata()).format, 'webp');
});

for (const [label, input] of [
  ['oversized length', () => { const bytes = Buffer.from(png); bytes.writeUInt32BE(0xffffffff, 8); return bytes; }],
  ['truncated header', () => Buffer.concat([png.subarray(0, -12), Buffer.from([0, 0]), png.subarray(-12)])],
  ['missing chunk CRC', () => Buffer.concat([png.subarray(0, -12), Buffer.from([0, 0, 0, 0, 116, 69, 88, 116]), png.subarray(-12)])],
]) {
  test(`upload rejects malformed PNG chunk boundaries: ${label}`, async () => {
    authorize();
    const create = mock.method(prisma.image, 'create', async ({ data }) => fakeImage(data));
    const beforeFiles = files();
    const res = await request('/images', { method: 'POST', body: multipart({ bytes: input() }) });
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: 'Invalid or unsupported image' });
    assert.equal(create.mock.callCount(), 0);
    assert.deepEqual(files(), beforeFiles);
  });
}
