const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mock } = require('node:test');

const originalCwd = process.cwd();
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'image-service-test-'));
process.chdir(workspace);
Object.assign(process.env, {
  NODE_ENV: 'test',
  DEBUG: 'false',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  ADMIN_DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  UPLOAD_DIR: 'uploads',
  MAX_FILE_SIZE: '1024',
  MAX_IMAGE_PIXELS: '16',
  IMAGE_SERVICE_PROVISIONING_KEY: 'fixture-provisioning-key',
  ALLOWED_MIME: 'image/jpeg,image/png,image/webp,image/pjpeg',
  HOST: 'https://images.test',
  CORS_ORIGIN: '["https://dashboard.test"]',
  STATIC_ORIGIN: 'https://dashboard.test',
});

function load(file) {
  return require(path.join(__dirname, '..', 'dist', file));
}

function replaceModule(id, exports) {
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const unexpected = async () => { throw new Error('Unexpected database call'); };
const prisma = {
  $transaction: unexpected,
  image: { create: unexpected, findUnique: unexpected, delete: unexpected },
  apikey: { create: unexpected, findMany: unexpected, count: unexpected, deleteMany: unexpected },
};
replaceModule(require.resolve('../dist/lib/prisma'), { prisma });
replaceModule(require.resolve('../dist/utils/logger'), {
  __esModule: true,
  default: { info() {}, error() {} },
});
const pg = { Client: function () { throw new Error('Unexpected admin database call'); }, Pool: function () { throw new Error('Unexpected admin database call'); } };
replaceModule(require.resolve('pg'), pg);

function response() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function cleanup() {
  mock.restoreAll();
  process.chdir(originalCwd);
  const relative = path.relative(os.tmpdir(), workspace);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.ok(path.basename(workspace).startsWith('image-service-test-'));
  fs.rmSync(workspace, { recursive: true, force: true });
}

module.exports = { load, prisma, pg, response, workspace, cleanup };

