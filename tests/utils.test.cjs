const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, after } = require('node:test');
const { load, response, workspace, cleanup } = require('./support.cjs');
const { Prisma } = require('@prisma/client');
const { generateApiKey, hashApiKey, verifyApiKey } = load('utils/apiKey');
const { ensureDirSync, generateDestination, generateFilename } = load('utils/storage');
const { handlePrismaNotFound } = load('utils/handleNotFound');
const { handlePrismaWrite } = load('utils/handlePrismaWrite');
const { sendData, sendError } = load('utils/send');
const errors = load('error/responseError');
after(cleanup);

function prismaError(code) {
  return new Prisma.PrismaClientKnownRequestError('Database rejected write', {
    code, clientVersion: '5.0.0',
  });
}

test('API keys contain 32 random bytes encoded as hex', () => {
  const keys = Array.from({ length: 20 }, generateApiKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[a-f0-9]{64}$/);
});

test('bcrypt salts hashes and accepts only the matching API key', async () => {
  const key = generateApiKey();
  const first = await hashApiKey(key);
  const second = await hashApiKey(key);
  assert.notEqual(first, key);
  assert.notEqual(first, second);
  assert.equal(await verifyApiKey(key, first), true);
  assert.equal(await verifyApiKey('wrong-key', first), false);
});

test('storage creates nested directories and preserves existing files', () => {
  const directory = path.join(workspace, 'nested', 'images');
  assert.equal(generateDestination(directory), directory);
  const sentinel = path.join(directory, 'existing.txt');
  fs.writeFileSync(sentinel, 'keep');
  ensureDirSync(directory);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});

for (const name of ['photo.png', 'photo.JPEG', 'no-extension', '../../photo.webp', 'active.html']) {
  test(`generated filename is always a random WebP name: ${name}`, () => {
    const filename = generateFilename(name);
    assert.match(filename, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/);
    assert.equal(filename.length, 41);
    assert.equal(path.extname(filename), '.webp');
    assert.equal(path.basename(filename), filename);
    assert.notEqual(generateFilename(name), filename);
  });
}

test('not-found wrapper returns existing objects and arrays unchanged', async () => {
  for (const value of [{ id: 'image-1' }, [{ id: 'key-1' }]]) {
    assert.equal(await handlePrismaNotFound(async () => value), value);
  }
});

for (const [label, query] of [
  ['null', async () => null],
  ['empty array', async () => []],
  ['Prisma P2025', async () => { throw prismaError('P2025'); }],
]) {
  test(`not-found wrapper maps ${label} to the custom 400 error`, async () => {
    await assert.rejects(handlePrismaNotFound(query, 'Image missing'), {
      name: 'BadRequestError', status: 400, message: 'Image missing',
    });
  });
}

test('Prisma wrappers propagate unrelated errors unchanged', async () => {
  const error = new Error('Connection failed');
  for (const wrap of [handlePrismaNotFound, handlePrismaWrite]) {
    await assert.rejects(wrap(async () => { throw error; }), (actual) => actual === error);
  }
  const known = prismaError('P2002');
  await assert.rejects(handlePrismaNotFound(async () => { throw known; }), (actual) => actual === known);
});

test('write wrapper returns successful result unchanged', async () => {
  const result = { id: 'image-1' };
  assert.equal(await handlePrismaWrite(async () => result), result);
});

for (const [code, status, message] of [
  ['P2002', 400, 'Duplicate value'],
  ['P2003', 400, 'Foreign key constraint failed'],
  ['P2004', 400, 'A database constraint failed'],
  ['P2025', 500, 'Save failed: Database rejected write'],
]) {
  test(`write wrapper maps ${code} to HTTP ${status}`, async () => {
    await assert.rejects(handlePrismaWrite(async () => { throw prismaError(code); }, 'Save failed'), {
      status, message,
    });
  });
}

for (const [name, status] of [['NotFoundError', 404], ['BadRequestError', 400], ['UnauthorizedError', 401], ['UnexpectedError', 500], ['FirebaseError', 500]]) {
  test(`${name} retains message, HTTP status, and Error identity`, () => {
    const error = new errors[name]('Request failed');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof errors.default);
    assert.equal(error.name, name);
    assert.equal(error.status, status);
    assert.equal(error.message, 'Request failed');
  });
}

test('sendData supports defaults and explicit status/message', () => {
  const res = response();
  sendData(res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: 'success' });
  sendData(res, { id: 'image-1' }, 'created', 201);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { message: 'created', id: 'image-1' });
});

test('sendError uses HTTP error status and configurable fallback', () => {
  const res = response();
  const expected = new errors.UnauthorizedError('Invalid key');
  sendError(res, expected);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Invalid key');
  const unknown = new Error('Offline');
  sendError(res, unknown);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'An unexpected error occurred');
  sendError(res, unknown, 400, 'Invalid request');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid request');
});
