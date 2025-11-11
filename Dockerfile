# Multi-stage production build for Node.js + TypeScript + Prisma
ARG NODE_VERSION=20-alpine

# 1) Base image we reuse to keep layers consistent (adds needed libs for Prisma)
FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN apk add --no-cache openssl ca-certificates

# 2) Install deps (with dev) and generate Prisma Client, then prune dev deps
FROM base AS deps
ENV CI=true
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
# Generate Prisma Client for linux-musl (alpine) runtime
RUN npx prisma generate
# Drop dev dependencies while keeping generated client + engines
RUN npm prune --omit=dev --no-audit --no-fund

# 3) Build TypeScript to dist using the deps (node_modules)
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build

# 4) Production runtime image (smallest possible)
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user and ensure writable app dir (for uploads if stored inside container)
RUN addgroup -g 1001 -S nodejs \
	&& adduser -S node -G nodejs -u 1001 \
	&& mkdir -p /app/uploads \
	&& chown -R node:node /app

# Only copy the pruned production node_modules and compiled sources
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node package*.json ./

# App defaults
ENV PORT=4000
EXPOSE 4000

USER node

# Start the app
CMD ["node", "dist/index.js"]
