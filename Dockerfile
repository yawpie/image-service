# syntax=docker/dockerfile:1
ARG NODE_VERSION=24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM node:${NODE_VERSION} AS base
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends ca-certificates openssl libssl3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps_dev
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN ./node_modules/.bin/prisma generate

FROM base AS builder
COPY --from=deps_dev /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS deps_prod
COPY package.json package-lock.json ./
COPY --from=deps_dev /app/node_modules ./node_modules
RUN npm prune --omit=dev --no-audit --no-fund

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000
RUN mkdir -p /app/uploads && chown -R node:node /app \
 && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --chown=node:node --from=deps_prod /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
