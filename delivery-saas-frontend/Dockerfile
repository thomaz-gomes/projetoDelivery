FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Install dependencies and build the Vite app in a Debian-based image to
# avoid native build issues that sometimes occur on Alpine.
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and build
COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Optional nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
