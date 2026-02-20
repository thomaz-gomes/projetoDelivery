#!/bin/bash
# =============================================================
# Setup inicial do VPS - Execute apenas UMA VEZ
# Uso: sudo bash setup-vps.sh
# =============================================================
set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Setup do Delivery SaaS - VPS Linux     ${NC}"
echo -e "${GREEN}========================================${NC}"

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Execute como root: sudo bash setup-vps.sh${NC}"
    exit 1
fi

# --- Carregar variáveis do .env ---
DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    echo -e "${RED}Arquivo .env não encontrado em $DEPLOY_DIR/.env${NC}"
    echo -e "${YELLOW}Copie o .env.example e preencha os valores:${NC}"
    echo "  cp $DEPLOY_DIR/.env.example $DEPLOY_DIR/.env"
    echo "  nano $DEPLOY_DIR/.env"
    exit 1
fi

source "$DEPLOY_DIR/.env"

# Validar variáveis obrigatórias
for var in API_DOMAIN APP_DOMAIN SSL_EMAIL POSTGRES_PASSWORD JWT_SECRET; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}Variável $var não definida no .env${NC}"
        exit 1
    fi
done

echo -e "${YELLOW}Domínios: API=${API_DOMAIN} | APP=${APP_DOMAIN}${NC}"
echo ""

# =========================================
# 1. Atualizar sistema
# =========================================
echo -e "${GREEN}[1/7] Atualizando sistema...${NC}"
apt-get update && apt-get upgrade -y

# =========================================
# 2. Instalar Docker
# =========================================
echo -e "${GREEN}[2/7] Instalando Docker...${NC}"
if ! command -v docker &> /dev/null; then
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    echo -e "${GREEN}Docker instalado!${NC}"
else
    echo "Docker já instalado, pulando..."
fi

# =========================================
# 3. Instalar Nginx
# =========================================
echo -e "${GREEN}[3/7] Instalando Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt-get install -y nginx
    systemctl enable nginx
    echo -e "${GREEN}Nginx instalado!${NC}"
else
    echo "Nginx já instalado, pulando..."
fi

# =========================================
# 4. Instalar Certbot (Let's Encrypt)
# =========================================
echo -e "${GREEN}[4/7] Instalando Certbot...${NC}"
if ! command -v certbot &> /dev/null; then
    apt-get install -y certbot python3-certbot-nginx
    echo -e "${GREEN}Certbot instalado!${NC}"
else
    echo "Certbot já instalado, pulando..."
fi

# =========================================
# 5. Configurar Firewall (UFW)
# =========================================
echo -e "${GREEN}[5/7] Configurando firewall...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp   # SSH
    ufw allow 80/tcp   # HTTP
    ufw allow 443/tcp  # HTTPS
    ufw --force enable
    echo -e "${GREEN}Firewall configurado (22, 80, 443)${NC}"
else
    apt-get install -y ufw
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
fi

# =========================================
# 6. Configurar Nginx
# =========================================
echo -e "${GREEN}[6/7] Configurando Nginx...${NC}"

# Remover default site
rm -f /etc/nginx/sites-enabled/default

# Map WebSocket/polling — necessário para $connection_upgrade nos configs
cp "$DEPLOY_DIR/nginx/websocket.conf" /etc/nginx/conf.d/websocket.conf

# Copiar configs substituindo os placeholders pelos domínios reais
sed "s/API_DOMAIN_PLACEHOLDER/${API_DOMAIN}/g" "$DEPLOY_DIR/nginx/api.conf" > /etc/nginx/sites-available/api.conf
sed "s/APP_DOMAIN_PLACEHOLDER/${APP_DOMAIN}/g" "$DEPLOY_DIR/nginx/app.conf" > /etc/nginx/sites-available/app.conf

# Ativar sites
ln -sf /etc/nginx/sites-available/api.conf /etc/nginx/sites-enabled/api.conf
ln -sf /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/app.conf

# Testar config
nginx -t
systemctl reload nginx
echo -e "${GREEN}Nginx configurado!${NC}"

# =========================================
# 7. Obter Certificados SSL
# =========================================
echo -e "${GREEN}[7/7] Obtendo certificados SSL...${NC}"
echo -e "${YELLOW}Certifique-se de que os DNS de ${API_DOMAIN} e ${APP_DOMAIN} já apontam para este servidor!${NC}"
read -p "Os DNS já estão configurados? (s/n): " dns_ok

if [ "$dns_ok" = "s" ] || [ "$dns_ok" = "S" ]; then
    certbot --nginx -d "${API_DOMAIN}" -d "${APP_DOMAIN}" --email "${SSL_EMAIL}" --agree-tos --non-interactive
    echo -e "${GREEN}Certificados SSL obtidos!${NC}"

    # Configurar renovação automática
    systemctl enable certbot.timer
    echo -e "${GREEN}Renovação automática de SSL habilitada${NC}"
else
    echo -e "${YELLOW}Pule este passo agora. Quando os DNS estiverem prontos, execute:${NC}"
    echo "  sudo certbot --nginx -d ${API_DOMAIN} -d ${APP_DOMAIN} --email ${SSL_EMAIL} --agree-tos"
fi

# =========================================
# Criar diretório de backups
# =========================================
mkdir -p "$DEPLOY_DIR/backups"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Setup concluído!                       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Próximos passos:"
echo -e "  1. Verifique o .env em: ${YELLOW}$DEPLOY_DIR/.env${NC}"
echo -e "  2. Faça o primeiro deploy:"
echo -e "     ${YELLOW}cd $(dirname $DEPLOY_DIR) && docker compose -f deploy/docker-compose.production.yml up -d --build${NC}"
echo -e "  3. Para atualizações futuras use:"
echo -e "     ${YELLOW}bash $DEPLOY_DIR/scripts/update.sh${NC}"
