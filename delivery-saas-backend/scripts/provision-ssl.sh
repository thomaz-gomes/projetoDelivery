#!/bin/sh
# Usage: provision-ssl.sh <domain> <backend_port>
# Generates Let's Encrypt cert and Nginx config for a custom domain.
#
# Runs INSIDE the backend Docker container with:
#   - /etc/nginx/sites-enabled bind-mounted from host
#   - /etc/letsencrypt bind-mounted from host
#   - /var/www/certbot bind-mounted from host
#   - pid: host (shares PID namespace with host for nginx reload)
#
# Steps:
#   1. Create HTTP-only Nginx config (needed for certbot validation)
#   2. Reload host Nginx via SIGHUP
#   3. Run certbot with --webroot to obtain certificate
#   4. Update Nginx config to include HTTPS
#   5. Reload host Nginx again

set -eu

DOMAIN="$1"
BACKEND_PORT="${2:-3000}"
NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}.conf"
WEBROOT="/var/www/certbot"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@deliverysaas.com.br}"

echo "[provision-ssl] Starting for ${DOMAIN} (backend port ${BACKEND_PORT})"

# Helper: reload host Nginx by running nginx -s reload via nsenter into PID 1's namespace.
# This executes the command in the host's mount/PID/net namespace, bypassing container isolation.
reload_nginx() {
  echo "[provision-ssl] Reloading nginx on host via nsenter..."
  nsenter -t 1 -m -u -i -n -- nginx -t && nsenter -t 1 -m -u -i -n -- nginx -s reload
}

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

echo "[provision-ssl] HTTP config created, reloading Nginx..."
reload_nginx
sleep 2

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
reload_nginx

echo "[provision-ssl] SSL provisioned successfully for ${DOMAIN}"
