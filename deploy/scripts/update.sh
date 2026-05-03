#!/bin/bash
# =============================================================
# Atualização do sistema - Execute para cada novo deploy
# Uso: bash deploy/scripts/update.sh
# =============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Detectar diretório do projeto (raiz do repo)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.production.yml"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Atualizando Delivery SaaS              ${NC}"
echo -e "${GREEN}========================================${NC}"

# Verificar se .env existe
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    echo -e "${RED}Arquivo .env não encontrado em $DEPLOY_DIR/.env${NC}"
    exit 1
fi

source "$DEPLOY_DIR/.env"

# =========================================
# 0. Sincronizar .env com .env.example (adicionar novas variáveis sem sobrescrever)
# =========================================
echo -e "${YELLOW}[0/7] Sincronizando variáveis de ambiente...${NC}"
if [ -f "$DEPLOY_DIR/.env.example" ]; then
    while IFS= read -r line; do
        # Skip comments and empty lines
        [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
        # Extract variable name
        varname="${line%%=*}"
        # Add to .env if not already present
        if ! grep -q "^${varname}=" "$DEPLOY_DIR/.env" 2>/dev/null; then
            echo "$line" >> "$DEPLOY_DIR/.env"
            echo -e "  ${GREEN}+ ${varname}${NC}"
        fi
    done < "$DEPLOY_DIR/.env.example"
fi

# =========================================
# 1. Backup do banco antes de atualizar
# =========================================
echo -e "${YELLOW}[1/7] Fazendo backup do banco...${NC}"
bash "$SCRIPT_DIR/backup-db.sh" || echo -e "${YELLOW}Aviso: backup falhou, continuando...${NC}"

# =========================================
# 2. Puxar código novo
# =========================================
echo -e "${YELLOW}[2/7] Atualizando código (git pull)...${NC}"
cd "$PROJECT_DIR"

# Limpar qualquer merge/stash pendente
git reset --hard HEAD 2>/dev/null || true
git stash drop 2>/dev/null || true

# Salvar arquivos locais críticos (que não devem estar no repo)
TEMP_BACKUP="/tmp/delivery-update-backup-$(date +%s)"
mkdir -p "$TEMP_BACKUP"

# Fazer backup de .env locais se existirem
if [ -f "delivery-print-agent/.env" ]; then
    echo -e "${YELLOW}Salvando delivery-print-agent/.env...${NC}"
    cp "delivery-print-agent/.env" "$TEMP_BACKUP/print-agent.env"
fi

if [ -f "delivery-saas-backend/.env" ]; then
    echo -e "${YELLOW}Salvando delivery-saas-backend/.env...${NC}"
    cp "delivery-saas-backend/.env" "$TEMP_BACKUP/backend.env"
fi

if [ -f "delivery-saas-frontend/.env" ]; then
    echo -e "${YELLOW}Salvando delivery-saas-frontend/.env...${NC}"
    cp "delivery-saas-frontend/.env" "$TEMP_BACKUP/frontend.env"
fi

# Fazer pull limpo
git pull origin main

# Restaurar arquivos locais
if [ -f "$TEMP_BACKUP/print-agent.env" ]; then
    echo -e "${YELLOW}Restaurando delivery-print-agent/.env...${NC}"
    cp "$TEMP_BACKUP/print-agent.env" "delivery-print-agent/.env"
fi

if [ -f "$TEMP_BACKUP/backend.env" ]; then
    cp "$TEMP_BACKUP/backend.env" "delivery-saas-backend/.env"
fi

if [ -f "$TEMP_BACKUP/frontend.env" ]; then
    cp "$TEMP_BACKUP/frontend.env" "delivery-saas-frontend/.env"
fi

# Limpar backup temporário
rm -rf "$TEMP_BACKUP"

# =========================================
# 3. Recarregar Caddy (se configurado)
# =========================================
echo -e "${YELLOW}[3/7] Atualizando configuração do Caddy...${NC}"

# Recarregar Caddy se o Caddyfile mudou
if command -v caddy &> /dev/null && [ -n "$API_DOMAIN" ] && [ -n "$APP_DOMAIN" ]; then
    sed -e "s/API_DOMAIN_PLACEHOLDER/${API_DOMAIN}/g" \
        -e "s/APP_DOMAIN_PLACEHOLDER/${APP_DOMAIN}/g" \
        -e "s/SSL_EMAIL_PLACEHOLDER/${SSL_EMAIL:-}/g" \
        "$DEPLOY_DIR/caddy/Caddyfile" > /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile && \
        (systemctl is-active --quiet caddy && systemctl reload caddy || systemctl start caddy)
fi

# =========================================
# 4. Rebuild dos containers
# =========================================
echo -e "${YELLOW}[4/7] Reconstruindo imagens Docker...${NC}"
cd "$PROJECT_DIR"
docker compose -f "$COMPOSE_FILE" build --no-cache

# =========================================
# 5. Aplicar migrações e registrar webhooks
# =========================================
echo -e "${YELLOW}[5/7] Aplicando migrações e registrando webhooks...${NC}"
docker compose -f "$COMPOSE_FILE" run --rm migrate

# =========================================
# 6. Reiniciar containers (zero downtime: up recria apenas o que mudou)
# =========================================
echo -e "${YELLOW}[6/7] Reiniciando containers...${NC}"
docker compose -f "$COMPOSE_FILE" up -d

# =========================================
# 7. Limpeza de imagens antigas
# =========================================
echo -e "${YELLOW}[7/7] Limpando imagens antigas...${NC}"
docker image prune -f

# =========================================
# Verificar saúde
# =========================================
echo ""
echo -e "${GREEN}Verificando containers...${NC}"
sleep 5
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Atualização concluída!                 ${NC}"
echo -e "${GREEN}========================================${NC}"

# Testar health endpoint
echo -e "Testando API..."
if curl -sf http://127.0.0.1:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}API respondendo OK${NC}"
else
    echo -e "${YELLOW}API ainda inicializando... verifique em alguns segundos:${NC}"
    echo "  curl http://127.0.0.1:3000/health"
fi
