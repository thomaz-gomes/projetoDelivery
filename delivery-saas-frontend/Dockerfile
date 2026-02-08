FROM node:20-bullseye AS builder
WORKDIR /app

# Allow build-time API URL injection. Set VITE_API_URL as a build-arg in CI (e.g. GH Actions)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
# Allow enabling QZ Tray build-time flag so Vite picks up `import.meta.env.VITE_ENABLE_QZ`
# Set via `--build-arg VITE_ENABLE_QZ=1` when building to bake the flag into the static build.
ARG VITE_ENABLE_QZ=0
ENV VITE_ENABLE_QZ=${VITE_ENABLE_QZ}

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and build
COPY . .
# Run Vite build — it will pick up VITE_* env vars at build time
RUN npm run build

FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Optional nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
