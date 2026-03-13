#!/bin/bash
# provision-ssl.sh — Runs ON THE HOST (not inside container)
# Called by a cron job every minute to process pending custom domain SSL requests.
#
# Setup (one-time on VPS):
#   mkdir -p /var/www/certbot/pending
#   cp provision-ssl.sh /opt/delivery/provision-ssl.sh
#   chmod +x /opt/delivery/provision-ssl.sh
#   crontab -e  →  * * * * * /opt/delivery/provision-ssl.sh >> /var/log/provision-ssl.log 2>&1

set -u

PENDING_DIR="/var/www/certbot/pending"
WEBROOT="/var/www/certbot"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@deliverysaas.com.br}"
BACKEND_PORT="${BACKEND_PORT:-3000}"

mkdir -p "$PENDING_DIR" "$WEBROOT/.well-known/acme-challenge"

for request_file in "$PENDING_DIR"/*.domain; do
  [ -f "$request_file" ] || continue

  DOMAIN=$(cat "$request_file")
  BASE="${request_file%.domain}"
  NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}.conf"

  echo "[provision-ssl] $(date) Processing $DOMAIN..."

  # 1. Create HTTP-only config for certbot validation
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

  nginx -t && nginx -s reload
  sleep 2

  # 2. Run certbot
  certbot certonly \
    --webroot \
    -w "$WEBROOT" \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --no-eff-email

  if [ $? -ne 0 ]; then
    echo "[provision-ssl] certbot FAILED for $DOMAIN"
    echo "failed" > "${BASE}.status"
    rm -f "$request_file"
    continue
  fi

  # 3. Update nginx config to HTTPS
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

  nginx -t && nginx -s reload

  echo "[provision-ssl] SSL provisioned for $DOMAIN"
  echo "done" > "${BASE}.status"
  rm -f "$request_file"
done
