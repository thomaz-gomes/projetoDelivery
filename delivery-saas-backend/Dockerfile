FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including devDeps to allow prisma generate)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source
COPY . .

# Install nfe-module dependencies (sub-project with its own package.json)
# libxmljs2 is a native C++ addon — install build tools first
RUN if [ -f nfe-module/package.json ]; then \
    apk add --no-cache python3 make g++ libxml2-dev && \
    cd nfe-module && npm ci --silent --omit=dev && cd ..; \
fi

# Gera Prisma Client (schema unificado — schema.prisma = PostgreSQL)
RUN npx prisma generate

FROM node:20-alpine AS runtime
WORKDIR /app

# Install runtime utilities + Chromium para Puppeteer (scraping headless)
RUN apk add --no-cache \
    curl \
    ca-certificates \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont

# Puppeteer usa o Chromium do Alpine, não o bundled
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy node modules and built app from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Keep container stateless: by default do not run migrations inside the runtime container.
# Set RUN_MIGRATIONS=1 to run the included wait-and-migrate script at container start.
ENV RUN_MIGRATIONS=1
# When RUN_MIGRATIONS=1 use the `wait-for-db-and-migrate.js` script which waits for the
# database to become ready and then runs `prisma db push` to sync the schema.
# This avoids race conditions where Prisma tries to connect while Postgres is still initializing.
CMD ["sh", "-lc", "if [ \"$RUN_MIGRATIONS\" = \"1\" ]; then node scripts/wait-for-db-and-migrate.js; fi; node src/server.js"]
