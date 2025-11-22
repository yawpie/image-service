ARG NODE_VERSION=20-slim

FROM node:${NODE_VERSION} AS base
WORKDIR /app

# Use apt (Debian-based)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      openssl \
      # try to install libssl1.1 if available on the distro
      libssl1.1 || true \
 && rm -rf /var/lib/apt/lists/*

FROM base AS deps_dev
ENV CI=true
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
# generate prisma client for the same libc as runner (glibc)
RUN npx prisma generate

FROM base AS builder
WORKDIR /app
COPY --from=deps_dev /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build

FROM base AS deps_prod
WORKDIR /app
COPY package*.json ./
COPY --from=deps_dev /app/node_modules ./node_modules
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /app/uploads && chown -R node:node /app

# ensure runtime has ssl libs too
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl libssl1.1 || true \
 && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=deps_prod /app/node_modules ./node_modules
COPY --chown=node:node --from=builder  /app/dist        ./dist
COPY --chown=node:node package*.json ./ 
COPY --chown=node:node prisma ./prisma

USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/index.js"]
