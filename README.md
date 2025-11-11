# Image Service (Express + TypeScript + Prisma + Postgres)

Endpoints:

- POST /images (multipart form field `file`) -> returns JSON metadata (id, url, ...)
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

