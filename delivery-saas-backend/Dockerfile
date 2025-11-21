FROM node:18-alpine AS builder
WORKDIR /app

# Install dependencies (including devDeps to allow prisma generate)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and generate Prisma client (if Prisma schema exists)
COPY . .
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi

FROM node:18-alpine
WORKDIR /app

# Copy node modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# If you want to run migrations on start, uncomment the line below and ensure
# PRISMA_COMMANDS are available in the image; otherwise run migrations externally.
# ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy || true && node src/server.js"]

CMD ["node", "src/server.js"]
