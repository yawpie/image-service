# Image Service (Express + TypeScript + Prisma + Postgres)

Endpoints:
- POST /images  (multipart form field `file`) -> returns JSON metadata (id, url, ...)
- GET /images/:id -> metadata

Run locally:
1. copy .env.example -> .env, sesuaikan DATABASE_URL
2. npm install
3. npx prisma generate
4. npx prisma migrate dev --name init_images
5. npm run dev

Docker (example):
- docker-compose up --build
