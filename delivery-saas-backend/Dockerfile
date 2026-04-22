# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Main app dependencies
COPY package.json package-lock.json* ./
RUN npm ci --silent

# nfe-module dependencies — libxmljs2 is optional (XSD validation only) and
# its native C++ build takes 30+ min on Alpine. Skip it with --no-optional.
COPY nfe-module/package.json nfe-module/
RUN cd nfe-module && npm install --silent --omit=dev --no-optional

# ── Stage 2: build (prisma generate, etc.) ────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/nfe-module/node_modules ./nfe-module/node_modules

# Copy source AFTER deps are cached
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# ── Stage 3: runtime (lean image) ────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Runtime-only system packages (no build tools)
RUN apk add --no-cache \
    curl \
    ca-certificates \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont

# Puppeteer uses Alpine's Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy built app from builder
COPY --from=builder /app .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENV RUN_MIGRATIONS=1
CMD ["sh", "-lc", "if [ \"$RUN_MIGRATIONS\" = \"1\" ]; then node scripts/wait-for-db-and-migrate.js; fi; node src/server.js"]
