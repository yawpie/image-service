# Multi-stage production build for Node.js + TypeScript + Prisma
ARG NODE_VERSION=20-slim

# 1) Base (Debian-based)
FROM node:${NODE_VERSION} AS base
WORKDIR /app

# install runtime/build libs (try libssl1.1, fallback to libssl3)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      openssl \
      gnupg \
      # try libssl1.1 first (available on bullseye), otherwise libssl3
 && (apt-get install -y --no-install-recommends libssl1.1 || apt-get install -y --no-install-recommends libssl3) \
 && rm -rf /var/lib/apt/lists/*

# 2) Dev deps (used for building) -- runs npm ci and prisma generate
FROM base AS deps_dev
ENV CI=true
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# copy prisma schema BEFORE generate
COPY prisma ./prisma
# Generate prisma client for same libc as base/runner (glibc)
RUN npx prisma generate

# 3) Build TypeScript using dev deps (reuses node_modules from deps_dev)
FROM base AS builder
WORKDIR /app
COPY --from=deps_dev /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build

# 4) Prod deps (pruned)
FROM base AS deps_prod
WORKDIR /app
COPY package*.json ./
COPY --from=deps_dev /app/node_modules ./node_modules
RUN npm prune --omit=dev --no-audit --no-fund

# 5) Runtime image (Debian-based, small-ish)
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

# Ensure uploads dir exists and node user owns it
RUN mkdir -p /app/uploads && chown -R node:node /app

# ensure runtime has ssl libs too (same approach as base)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && (apt-get install -y --no-install-recommends libssl1.1 || apt-get install -y --no-install-recommends libssl3) \
 && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=deps_prod /app/node_modules ./node_modules
COPY --chown=node:node --from=builder  /app/dist        ./dist
COPY --chown=node:node package*.json ./ 
COPY --chown=node:node prisma ./prisma

USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/index.js"]
