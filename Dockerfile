FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY prisma ./prisma
COPY . .

RUN npm run build
RUN npx prisma generate

ENV NODE_ENV=production

EXPOSE 4000
CMD ["node", "dist/index.js"]
