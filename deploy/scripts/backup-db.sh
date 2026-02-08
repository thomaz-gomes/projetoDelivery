#!/bin/bash
# =============================================================
# Backup do PostgreSQL via Docker
# Uso: bash deploy/scripts/backup-db.sh
# Backups salvos em: deploy/backups/
# Mantém os últimos 7 backups (rotação automática)
# =============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.production.yml"
BACKUP_DIR="$DEPLOY_DIR/backups"

# Carregar variáveis
source "$DEPLOY_DIR/.env"

# Criar diretório de backups
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"

echo -e "${YELLOW}Fazendo backup do banco de dados...${NC}"

# Verificar se o container do banco está rodando
if ! docker compose -f "$COMPOSE_FILE" ps delivery_db --status running -q 2>/dev/null | grep -q .; then
    echo -e "${RED}Container delivery_db não está rodando!${NC}"
    exit 1
fi

# Fazer dump e comprimir
docker compose -f "$COMPOSE_FILE" exec -T delivery_db \
    pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "$BACKUP_FILE"

# Verificar se o backup foi criado com sucesso
if [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}Backup criado: $BACKUP_FILE ($SIZE)${NC}"
else
    echo -e "${RED}Backup vazio ou falhou!${NC}"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Rotação: manter apenas os últimos 7 backups
echo -e "${YELLOW}Removendo backups antigos (mantendo últimos 7)...${NC}"
ls -t "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

TOTAL=$(ls "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null | wc -l)
echo -e "${GREEN}Total de backups mantidos: $TOTAL${NC}"
