# Multi-stage production build for Node.js + TypeScript + Prisma
ARG NODE_VERSION=20-alpine

# 1) Base (common packages for Prisma on Alpine)
FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN apk add --no-cache openssl ca-certificates

# 2) Dev deps (used for building)
FROM base AS deps_dev
ENV CI=true
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate

# 3) Build TypeScript using dev deps
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

# 5) Runtime image (small)
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /app/uploads && chown -R node:node /app

COPY --chown=node:node --from=deps_prod /app/node_modules ./node_modules
COPY --chown=node:node --from=builder  /app/dist        ./dist
COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma

USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/index.js"]
