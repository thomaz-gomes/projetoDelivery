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

# Copy node modules and built app from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Keep container stateless: run migrations outside the image or via a one-shot job.
CMD ["sh", "-lc", "npx prisma migrate deploy --schema=prisma/schema.postgres.prisma 2>/dev/null || true; node src/server.js"]
