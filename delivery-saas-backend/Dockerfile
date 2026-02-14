FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Install dependencies (including devDeps to allow prisma generate)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source
COPY . .

# Install nfe-module dependencies (sub-project with its own package.json)
RUN if [ -f nfe-module/package.json ]; then cd nfe-module && npm ci --silent --omit=dev && cd ..; fi

# Generate Prisma client (for both sqlite and postgres schemas if present)
# Ensure migrations are copied explicitly (avoid cases where changes were added after a previous build)
# This guarantees `/app/prisma/migrations` exists in the image even if .dockerignore or build context
# behaved unexpectedly. The build context already includes the repo root, so this is idempotent.
COPY prisma/migrations ./prisma/migrations
# Generate client for default schema (sqlite) if present
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate --schema=prisma/schema.prisma; fi
# Also generate client for Postgres schema (used in production) if present
RUN if [ -f prisma/schema.postgres.prisma ]; then npx prisma generate --schema=prisma/schema.postgres.prisma; fi

FROM node:20-bullseye-slim AS runtime
WORKDIR /app

# Install runtime utilities required by healthchecks
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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
