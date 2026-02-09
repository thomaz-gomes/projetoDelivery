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

# =========================================
# 1. Backup do banco antes de atualizar
# =========================================
echo -e "${YELLOW}[1/5] Fazendo backup do banco...${NC}"
bash "$SCRIPT_DIR/backup-db.sh" || echo -e "${YELLOW}Aviso: backup falhou, continuando...${NC}"

# =========================================
# 2. Puxar código novo
# =========================================
echo -e "${YELLOW}[2/5] Atualizando código (git pull)...${NC}"
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
# 3. Rebuild dos containers
# =========================================
echo -e "${YELLOW}[3/5] Reconstruindo imagens Docker...${NC}"
cd "$PROJECT_DIR"
docker compose -f "$COMPOSE_FILE" build

# =========================================
# 4. Reiniciar containers (zero downtime: up recria apenas o que mudou)
# =========================================
echo -e "${YELLOW}[4/5] Reiniciando containers...${NC}"
docker compose -f "$COMPOSE_FILE" up -d

# =========================================
# 5. Limpeza de imagens antigas
# =========================================
echo -e "${YELLOW}[5/5] Limpando imagens antigas...${NC}"
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
