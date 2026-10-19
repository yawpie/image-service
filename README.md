# Image Service

Express + TypeScript + Prisma + PostgreSQL. Use npm and the committed lockfile.

## API contract

This contract requires the security changes in this branch and a coordinated backend deployment. API keys grant **service-wide** image access; there is no per-admin image ownership or role model.

| Endpoint | Credential | Success |
| --- | --- | --- |
| `POST /generate` (JSON) | Server-only `x-provisioning-key` | `201 {"message":"success","key":"<raw key, returned once>"}` |
| `POST /images` (multipart field `image`) | `x-api-key` | `201` image metadata |
| `GET /images/:id` | `x-api-key` | `200` image metadata; `404` if missing |
| `DELETE /images?url=<encoded URL>` | `x-api-key` | `200 {"message":"success"}`; `404` if missing |
| `GET /uploads/<folder>/<file>` | Public | Static image bytes |
| `GET /` | Public | `Image Service OK` |

Provisioning accepts `{"adminId":"<UUID>","serviceName":"school-dashboard"}`. The ID must identify an existing **active** admin in the backend database (`admin.is_active = true`). `serviceName` must be a nonempty trimmed string of at most 255 characters. Only the hash is stored. A successful rotation atomically replaces previous keys for the same admin, across service names; failed persistence preserves the previous key. Concurrent rotations are serialized per admin, leaving only the latest committed replacement valid. `verbose=true` no longer exposes the database record or hash.

Set the same nonempty `IMAGE_SERVICE_PROVISIONING_KEY` in this service and the backend server. The backend derives `adminId` from its verified session and sends `x-provisioning-key` to `/generate`. Never put this secret in browser code, `NEXT_PUBLIC_*`, logs, or client cookies. Missing/blank configuration returns `503`; absent or incorrect credentials return `401` before any admin lookup or mutation. Missing `ADMIN_DATABASE_URL` also fails closed. Inactive/unknown admins return `403`; malformed bodies return `400`. Apply the backend's additive `admin.is_active` migration before enabling provisioning. Backend upload/delete callers use the server environment `IMAGE_SERVICE_API_KEY`; provisioning returns a raw key once and does not update that environment. Coordinate every replacement with updating the backend secret and restarting/redeploying its process. Image API keys are service credentials, separate from session logout/password revocation; they are not automatically revoked by logout.

All `/images` operations require an active, unexpired key. Missing, unknown, inactive, expired, or no active keys return `401`; database/hash failures return a generic `500`. CORS preserves the existing allowlist; it does not authenticate a request. The provisioning credential is server-to-server, independent of cookie CSRF protection.

New uploads accept bitmap **JPEG, PNG, and WebP** only, with MIME `image/jpeg`, `image/jpg`, `image/pjpeg`, `image/png`, or `image/webp`. MIME and extensions are not proof: the service fully decodes and re-encodes the image as WebP, strips extra metadata, and generates a random `.webp` name. SVG, HTML, corrupt/truncated images, animations, and images over the pixel limit return `415`. The default input-byte limit is **10 MiB** (`MAX_FILE_SIZE`) and the default pixel limit is **25,000,000** (`MAX_IMAGE_PIXELS`); both must be positive integers. Oversized multipart input returns `413`; malformed multipart, missing files, and unexpected fields return `400`. Authentication runs before multipart/file processing. Multipart requests allow one image, at most ten additional fields of 16 KiB each, and eleven total parts; excess fields/parts return `400`.

Optional `folder` is one string of safe relative segments such as `gallery/events` (letters, digits, `_`, `-` only per segment). Omit it for `default`. Absolute paths, dot segments, backslashes, percent-encoded separators, arrays, and empty segments return `400` before writing. New files stay under `UPLOAD_DIR`, including when it is an absolute volume path. URLs remain `/uploads/...`. Metadata fields stay `id`, `originalName`, `fileName`, `mimeType`, `size`, `path`, `url`, `createdAt`; `mimeType` and `size` describe the stored WebP. Original names are JSON metadata only. A failed new upload removes only its newly created file.

Existing uploaded files and metadata are not migrated, rewritten, or deleted. Existing relative `uploads/...` metadata paths remain readable/deletable when contained in the configured upload root; deletion refuses paths outside it. Public static legacy files remain public, so existing unsafe files need a separate inventory/cleanup decision. Storage/database failures return generic `500` responses. Access logs contain method, status, and duration only; action logs use fixed identifiers without bodies, URLs, headers, keys, file data, database messages, or stacks.

## Local development

Use Node.js 24 LTS and npm 10+ with the committed lockfile. Copy `.env.example` to `.env`, configure both database URLs and the provisioning secret, then:

```powershell
npm ci --no-audit --no-fund
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

The default port is 4000. The Docker build uses supported Node.js 24 on Debian Bookworm, runs as the `node` user, and removes unused global npm/Yarn from the runner. Mount persistent storage at `UPLOAD_DIR` with write access for that user (UID 1000). Apply image-service migrations as a separate deployment step; the runner contains the generated Prisma client, while the Prisma migration CLI remains in the build/development dependencies. The backend's `admin.is_active` migration must be applied before provisioning is enabled. See [container and CI evidence](docs/security/container-ci-remediation.md).

Sharp supplies native prebuilt binaries and TypeScript types; optional dependencies must be installed. See the [official installation requirements](https://sharp.pixelplumbing.com/install/), [untrusted input options](https://sharp.pixelplumbing.com/api-constructor/), and [default metadata stripping](https://sharp.pixelplumbing.com/api-output/#keepmetadata).

## Verification

```powershell
npm test
npm run build
```

`npm test` builds TypeScript and uses built-in `node:test`. HTTP tests use Express, Multer, Sharp decoding, temporary filesystem storage, and random loopback ports. Prisma and remote admin database boundaries are mocked in that suite; it needs no PostgreSQL, Docker, user uploads, or real credentials.

`npm run test:integration` verifies real PostgreSQL admin lookup, failed-write rollback, and concurrent key rotation. It requires explicit `SECURITY_TEST_DATABASE_URL` equal to `DATABASE_URL` and `SECURITY_TEST_ADMIN_DATABASE_URL` equal to `ADMIN_DATABASE_URL`; both must use `localhost`/`127.0.0.1` and a database ending `_test` or `_ci`. Use two isolated owned databases, apply this repository's migrations to the image database first, and supply an `admin` table with `admin_id UUID PRIMARY KEY, username TEXT UNIQUE NOT NULL, hashed_password TEXT NOT NULL, is_active BOOLEAN NOT NULL` in the admin fixture database (or the backend's migrated test schema). The script creates/deletes only synthetic fixture rows and never loads a production fallback. Do not point it at personal/shared development databases.

CI runs the mocked HTTP suite and guarded PostgreSQL checks with synthetic local databases. Local tests and CI do not prove staging/production deployment, reverse-proxy limits, persistent-volume permissions, or a production legacy-file inventory.
