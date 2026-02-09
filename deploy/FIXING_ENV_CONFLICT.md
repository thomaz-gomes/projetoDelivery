# Resolvendo conflito do .env no servidor

## Problema
O arquivo `delivery-print-agent/.env` foi removido do repositório Git, mas ainda existe localmente no servidor, causando conflito durante `git pull`.

## Solução Rápida (No Servidor)

### Opção 1: Manter o .env e fazer pull com stash automático
```bash
cd /opt/delivery
git stash push -u delivery-print-agent/.env
git pull origin main
git stash pop
```

### Opção 2: Usar o script atualizado
O script `deploy/scripts/update.sh` foi atualizado para lidar com isso automaticamente:
```bash
bash deploy/scripts/update.sh
```

### Opção 3: Resolver manualmente (se necessário)
```bash
# 1. Fazer backup do .env
cp delivery-print-agent/.env delivery-print-agent/.env.backup

# 2. Descartar alterações locais do arquivo removido
git checkout -- delivery-print-agent/.env

# 3. Fazer pull
git pull origin main

# 4. Restaurar o .env do backup (se necessário)
cp delivery-print-agent/.env.backup delivery-print-agent/.env
```

## Prevenção Futura
- O arquivo `.gitignore` na raiz e em `delivery-print-agent/` agora garantem que `.env` seja ignorado
- O script `update.sh` agora faz stash automático de alterações locais antes do pull

## Verificação
Para confirmar que o .env está sendo ignorado:
```bash
git status
# Não deve mostrar delivery-print-agent/.env

git check-ignore -v delivery-print-agent/.env
# Deve mostrar a regra do .gitignore
```
