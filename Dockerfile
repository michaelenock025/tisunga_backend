# Dockerfile
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

# Production image
FROM node:20-slim AS production

# Install system dependencies
RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r tisunga && useradd -r -g tisunga tisunga

WORKDIR /app

# Copy package files and install production dependencies as root first
COPY package*.json ./
RUN npm ci --only=production

# Copy Prisma and source code
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src ./src
COPY prisma ./prisma

# Create directories and fix permissions
RUN mkdir -p logs uploads && \
    chown -R tisunga:tisunga /app

# Switch to non-root user
USER tisunga

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]