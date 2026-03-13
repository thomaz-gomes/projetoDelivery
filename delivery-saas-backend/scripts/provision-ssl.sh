#!/bin/bash
# provision-ssl.sh — Runs ON THE HOST (not inside container)
# Called by a cron job every minute to process pending custom domain SSL requests.
#
# Setup (one-time on VPS):
#   mkdir -p /var/www/certbot/pending
#   cp provision-ssl.sh /opt/delivery/provision-ssl.sh
#   chmod +x /opt/delivery/provision-ssl.sh
#   crontab -e  →  * * * * * /opt/delivery/provision-ssl.sh >> /var/log/provision-ssl.log 2>&1

set -e

PENDING_DIR="/var/www/certbot/pending"
WEBROOT="/var/www/certbot"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@deliverysaas.com.br}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
LOCKFILE="/tmp/provision-ssl.lock"

# Prevent concurrent runs (e.g. multiple cron entries)
if [ -f "$LOCKFILE" ]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "[provision-ssl] Already running (PID $LOCK_PID), skipping."
    exit 0
  fi
  rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

mkdir -p "$PENDING_DIR" "$WEBROOT/.well-known/acme-challenge"

for request_file in "$PENDING_DIR"/*.domain; do
  [ -f "$request_file" ] || continue

  DOMAIN=$(cat "$request_file")
  BASE="${request_file%.domain}"
  NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}.conf"

  # Determine sibling domain (www <-> non-www)
  if echo "$DOMAIN" | grep -q '^www\.'; then
    SIBLING="${DOMAIN#www.}"
  else
    SIBLING="www.${DOMAIN}"
  fi
  ALL_DOMAINS="${DOMAIN} ${SIBLING}"

  echo "[provision-ssl] $(date) Processing $DOMAIN (+ $SIBLING)..."

  # 1. Create HTTP-only config for certbot validation (both domains)
  cat > "$NGINX_CONF" <<CONF
server {
    listen 80;
    server_name ${ALL_DOMAINS};

    client_max_body_size 20M;

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    # Socket.IO → backend (WebSocket upgrade)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Frontend (Vue SPA)
    location / {
        proxy_pass http://127.0.0.1:${FRONTEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF

  nginx -t && nginx -s reload
  sleep 2

  # 2. Run certbot — try both domains first, fall back to primary only
  CERTBOT_OK=0
  certbot certonly \
    --webroot \
    -w "$WEBROOT" \
    -d "$DOMAIN" -d "$SIBLING" \
    --non-interactive \
    --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --no-eff-email \
    && CERTBOT_OK=1

  if [ "$CERTBOT_OK" -eq 0 ]; then
    echo "[provision-ssl] certbot with both domains failed, trying $DOMAIN only..."
    certbot certonly \
      --webroot \
      -w "$WEBROOT" \
      -d "$DOMAIN" \
      --non-interactive \
      --agree-tos \
      --email "$CERTBOT_EMAIL" \
      --no-eff-email \
      && CERTBOT_OK=1
    # If only primary domain succeeded, nginx should only serve primary
    ALL_DOMAINS="${DOMAIN}"
  fi

  if [ "$CERTBOT_OK" -eq 0 ]; then
    echo "[provision-ssl] certbot FAILED for $DOMAIN"
    echo "failed" > "${BASE}.status"
    rm -f "$request_file"
    continue
  fi

  # 3. Update nginx config to HTTPS
  cat > "$NGINX_CONF" <<CONF
server {
    listen 80;
    server_name ${ALL_DOMAINS};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${ALL_DOMAINS};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    client_max_body_size 20M;

    # Socket.IO → backend (WebSocket upgrade)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Frontend (Vue SPA)
    location / {
        proxy_pass http://127.0.0.1:${FRONTEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF

  nginx -t && nginx -s reload

  echo "[provision-ssl] SSL provisioned for $DOMAIN (server_name: $ALL_DOMAINS)"
  echo "done" > "${BASE}.status"
  rm -f "$request_file"
done
