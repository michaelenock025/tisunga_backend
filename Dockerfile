# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

# ── Production image ──────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup -g 1001 -S tisunga && adduser -S tisunga -u 1001

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src ./src
COPY prisma ./prisma

RUN mkdir -p logs uploads && chown -R tisunga:tisunga /app

USER tisunga

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
