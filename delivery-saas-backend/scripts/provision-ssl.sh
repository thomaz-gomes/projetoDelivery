#!/bin/bash
# Usage: provision-ssl.sh <domain> <backend_port>
# Generates Let's Encrypt cert and Nginx config for a custom domain.

set -euo pipefail

DOMAIN="$1"
BACKEND_PORT="${2:-3000}"
NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}.conf"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@deliverysaas.com.br}"

# 1. Generate SSL certificate
certbot certonly \
  --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$CERTBOT_EMAIL" \
  --no-eff-email

# 2. Generate Nginx config
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

# 3. Reload Nginx
nginx -t && nginx -s reload

echo "SSL provisioned for ${DOMAIN}"
