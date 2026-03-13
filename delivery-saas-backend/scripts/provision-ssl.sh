#!/bin/sh
# Usage: provision-ssl.sh <domain> <backend_port>
# Generates Let's Encrypt cert and Nginx config for a custom domain.
#
# Steps:
#   1. Create HTTP-only Nginx config (needed for certbot validation)
#   2. Run certbot with --webroot to obtain certificate
#   3. Update Nginx config to include HTTPS with the certificate
#   4. Reload Nginx

set -eu

DOMAIN="$1"
BACKEND_PORT="${2:-3000}"
NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}.conf"
WEBROOT="/var/www/certbot"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@deliverysaas.com.br}"

echo "[provision-ssl] Starting for ${DOMAIN} (backend port ${BACKEND_PORT})"

# Ensure webroot directory exists
mkdir -p "${WEBROOT}/.well-known/acme-challenge"

# 1. Create HTTP-only config so certbot can validate via /.well-known/acme-challenge
cat > "$NGINX_CONF" <<CONF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF

echo "[provision-ssl] HTTP config created, testing and reloading Nginx..."
nginx -t && nginx -s reload

# 2. Obtain SSL certificate using webroot validation
echo "[provision-ssl] Running certbot for ${DOMAIN}..."
certbot certonly \
  --webroot \
  -w "$WEBROOT" \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$CERTBOT_EMAIL" \
  --no-eff-email

# 3. Update Nginx config to include HTTPS
cat > "$NGINX_CONF" <<CONF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF

# 4. Final reload with HTTPS
echo "[provision-ssl] HTTPS config created, final reload..."
nginx -t && nginx -s reload

echo "[provision-ssl] SSL provisioned successfully for ${DOMAIN}"
