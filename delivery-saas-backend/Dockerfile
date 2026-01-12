FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Install dependencies (including devDeps to allow prisma generate)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and generate Prisma client (for both sqlite and postgres schemas if present)
COPY . .
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
# Set RUN_MIGRATIONS=1 (for dev only) to run migrations at container start.
ENV RUN_MIGRATIONS=0
CMD ["sh", "-lc", "if [ \"$RUN_MIGRATIONS\" = \"1\" ]; then npx prisma migrate deploy --schema=prisma/schema.postgres.prisma 2>/dev/null || true; fi; node src/server.js"]
