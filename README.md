# Image Service (Express + TypeScript + Prisma + Postgres)

Endpoints:

- POST /images (multipart form field `image`) -> returns JSON metadata (id, url, ...)
- GET /images/:id -> metadata

Run locally:

1. copy .env.example -> .env, sesuaikan DATABASE_URL
2. npm install
3. npx prisma generate
4. npx prisma migrate dev --name init_images
5. npm run dev

Docker (example):

- docker-compose up --build

## Docker image

Build the production image:

```powershell
docker build -t image-service:prod .
```

Run the container (Postgres required; set DATABASE_URL accordingly):

```powershell
docker run --rm -p 4000:4000 `
	-e NODE_ENV=production `
	-e DATABASE_URL="postgresql://postgres:password@localhost:5432/shared_db?schema=public" `
	-e PORT=4000 `
	-v ${PWD}/uploads:/app/uploads `
	--name image-service image-service:prod
```

Notes:

- The server exposes port 4000 by default.
- Static files are served from the `uploads` directory at the URL path `/uploads`.
- For production, mount a persistent volume to `/app/uploads` to retain files.
- Prisma migrations should be applied outside of the runtime container (e.g., CI/CD step with `prisma migrate deploy`), or via a one-off job container. This image ships without dev dependencies to keep it small.

## Test suite

Gunakan Node.js 20.13+ dan npm. Dari direktori `image-service`:

```powershell
npm ci
npm run prisma:generate
npm test
```

Dari root workspace: `npm --prefix image-service test`.
`npm test` membangun TypeScript lalu menjalankan `node:test` bawaan Node.js; tidak ada dependency test tambahan.

| File | Cakupan |
| --- | --- |
| `tests/utils.test.cjs` | Crypto API key, nama/direktori file, pemetaan error Prisma, respons HTTP |
| `tests/auth.test.cjs` | Middleware API key, pembuatan/rotasi key, validasi admin dan pelepasan client |
| `tests/api.test.cjs` | App Express asli: health, CORS, auth, multipart upload, file statis, metadata, delete, generate key, error handler |

Tes HTTP memakai port lokal acak, Multer dan filesystem asli. Prisma dan koneksi database admin dimock; PostgreSQL, Docker, `.env`, dan data upload pengguna tidak diperlukan. Setiap file test memakai direktori sementara terpisah yang dibersihkan setelah selesai. Batas upload tes 1 KiB agar kasus file terlalu besar tetap ringan.

Jalankan satu file setelah build, misalnya:

```powershell
npm run build
node --test tests/auth.test.cjs
```

Tiga tes regresi ditandai `TODO` dan tetap menjalankan assertion untuk menunjukkan bug saat ini:

- API key salah tidak menghasilkan respons; request dapat menggantung.
- Tidak ada key aktif menghasilkan 400, sedangkan tes mengharapkan 401.
- Query `folder=../outside` dapat menulis di luar direktori upload. Tes membatasi penulisan ini di dalam direktori sementara.

`TODO` tidak membuat exit code gagal; jangan mengartikannya sebagai bug yang sudah diperbaiki. Setelah bug diperbaiki, hapus penanda `todo` agar assertion menjadi pemeriksaan wajib. Tes juga mencatat perilaku saat ini: error Multer memakai HTTP 500.

Suite ini belum memverifikasi database/migrasi asli, container produksi, atau error database pada GET metadata. Logger diganti stub agar tes tidak membuat log aplikasi.

