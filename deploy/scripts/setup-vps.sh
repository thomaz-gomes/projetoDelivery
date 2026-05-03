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
echo -e "${GREEN}[1/6] Atualizando sistema...${NC}"
apt-get update && apt-get upgrade -y

# =========================================
# 2. Instalar Docker
# =========================================
echo -e "${GREEN}[2/6] Instalando Docker...${NC}"
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
# 3. Instalar Caddy
# =========================================
echo -e "${GREEN}[3/6] Instalando Caddy...${NC}"
if ! command -v caddy &> /dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
        gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
        tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
    systemctl enable caddy
    echo -e "${GREEN}Caddy instalado!${NC}"
else
    echo "Caddy já instalado, pulando..."
fi

# =========================================
# 4. Configurar Firewall (UFW)
# =========================================
echo -e "${GREEN}[4/6] Configurando firewall...${NC}"
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
# 5. Configurar Caddy
# =========================================
echo -e "${GREEN}[5/6] Configurando Caddy...${NC}"

# Remove default Caddy welcome page
rm -f /etc/caddy/Caddyfile

# Gerar Caddyfile substituindo placeholders pelos domínios reais
sed -e "s/API_DOMAIN_PLACEHOLDER/${API_DOMAIN}/g" \
    -e "s/APP_DOMAIN_PLACEHOLDER/${APP_DOMAIN}/g" \
    "$DEPLOY_DIR/caddy/Caddyfile" > /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile
systemctl is-active --quiet caddy \
    && systemctl reload caddy \
    || systemctl start caddy
echo -e "${GREEN}Caddy configurado!${NC}"

# =========================================
# 6. Verificar DNS
# =========================================
echo -e "${GREEN}[6/6] Verificação de DNS${NC}"
echo -e "${YELLOW}Certifique-se de que ${API_DOMAIN} e ${APP_DOMAIN} apontam para este servidor.${NC}"
echo -e "${YELLOW}O Caddy obterá os certificados SSL automaticamente no primeiro acesso.${NC}"
echo ""
echo "Verifique com:"
echo "  dig ${APP_DOMAIN} +short"
echo "  dig ${API_DOMAIN} +short"

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
