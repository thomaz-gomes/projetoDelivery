# Guia de Deploy - Delivery SaaS em VPS Linux

## Arquitetura no Servidor

```
Internet
   │
   ├── https://app.seudominio.com ──► Nginx (443) ──► Frontend (127.0.0.1:8080)
   │
   └── https://api.seudominio.com ──► Nginx (443) ──► Backend  (127.0.0.1:3000)
                                                          │
                                                          ├── PostgreSQL (rede interna Docker)
                                                          └── Socket.IO (WebSocket)
```

- **Nginx** roda no host, faz terminação SSL e proxy reverso
- **Docker** roda backend, frontend e banco de dados
- **Certbot** gerencia certificados SSL automaticamente
- **Print Agent** roda na máquina do cliente (Windows), conecta via WebSocket

---

## Pré-requisitos

- VPS com Ubuntu 22.04 ou 24.04 (mínimo 2GB RAM, 20GB disco)
- Acesso SSH root ou com sudo
- 2 domínios/subdomínios apontando para o IP do VPS
- Git instalado no servidor

---

## Passo 1: Configurar DNS

No painel do seu provedor de domínio, crie 2 registros tipo **A**:

| Tipo | Nome | Valor          |
|------|------|----------------|
| A    | api  | IP_DO_SEU_VPS  |
| A    | app  | IP_DO_SEU_VPS  |

Aguarde a propagação DNS (pode levar até 24h, geralmente 5-30min).

Verifique com:
```bash
ping api.seudominio.com.br
ping app.seudominio.com.br
```

---

## Passo 2: Clonar o Repositório no VPS

```bash
ssh root@IP_DO_SEU_VPS

# Clonar o projeto
cd /opt
git clone https://github.com/thomaz-gomes/projetoDelivery.git delivery
cd /opt/delivery
```

---

## Passo 3: Configurar Variáveis de Ambiente

```bash
# Copiar template
cp deploy/.env.example deploy/.env

# Editar com seus valores reais
nano deploy/.env
```

Preencha **obrigatoriamente**:

```env
# Seus domínios
API_DOMAIN=api.seudominio.com.br
APP_DOMAIN=app.seudominio.com.br

# URLs públicas (com https://)
VITE_API_URL=https://api.seudominio.com.br
PUBLIC_FRONTEND_URL=https://app.seudominio.com.br
FRONTEND_ORIGIN=https://app.seudominio.com.br

# Banco de dados - use uma senha forte!
POSTGRES_USER=delivery
POSTGRES_PASSWORD=SuaSenhaForteAqui123!
POSTGRES_DB=delivery_prod

# JWT Secret - gere um valor aleatório:
#   openssl rand -base64 32
JWT_SECRET=cole_o_valor_gerado_aqui

# Email para SSL
SSL_EMAIL=seu@email.com
```

---

## Passo 4: Executar Setup Inicial

```bash
cd /opt/delivery
sudo bash deploy/scripts/setup-vps.sh
```

Este script irá:
1. Atualizar o sistema
2. Instalar Docker, Nginx e Certbot
3. Configurar firewall (portas 22, 80, 443)
4. Configurar Nginx com seus domínios
5. Obter certificados SSL (Let's Encrypt)

---

## Passo 5: Primeiro Deploy

```bash
cd /opt/delivery
docker compose -f deploy/docker-compose.production.yml up -d --build
```

Aguarde ~2-3 minutos para build das imagens. Acompanhe os logs:

```bash
# Ver todos os logs
docker compose -f deploy/docker-compose.production.yml logs -f

# Ver apenas o backend
docker compose -f deploy/docker-compose.production.yml logs -f backend

# Ver status dos containers
docker compose -f deploy/docker-compose.production.yml ps
```

---

## Passo 6: Verificar

```bash
# API respondendo?
curl https://api.seudominio.com.br/health

# Frontend carregando?
curl -I https://app.seudominio.com.br

# Containers rodando?
docker compose -f deploy/docker-compose.production.yml ps
```

Acesse no navegador:
- **Frontend**: https://app.seudominio.com.br
- **API Health**: https://api.seudominio.com.br/health

---

## Como Atualizar (Deploy de nova versão)

Sempre que precisar atualizar o sistema:

```bash
ssh root@IP_DO_SEU_VPS
cd /opt/delivery
bash deploy/scripts/update.sh
```

O script faz automaticamente:
1. Backup do banco de dados
2. Salva arquivos `.env` locais temporariamente
3. `git pull` do código novo (com reset para evitar conflitos)
4. Restaura arquivos `.env` locais
5. Rebuild das imagens Docker
6. Reinicia os containers
7. Limpa imagens antigas
8. Verifica saúde da API

**Nenhum dado é perdido** - o banco e uploads ficam em volumes Docker persistentes.

### Se o update.sh falhar

Em caso de conflito git que o script não resolveu automaticamente:

```bash
cd /opt/delivery

# 1. Salvar .env manualmente
cp delivery-print-agent/.env /tmp/print-agent-env-backup
cp deploy/.env /tmp/deploy-env-backup

# 2. Resetar repositório completamente
git reset --hard HEAD
git clean -fd
git pull origin main

# 3. Restaurar .env
cp /tmp/print-agent-env-backup delivery-print-agent/.env
cp /tmp/deploy-env-backup deploy/.env

# 4. Continuar com update
docker compose -f deploy/docker-compose.production.yml up -d --build
```

---

## Backup e Restore

### Fazer Backup Manual
```bash
cd /opt/delivery
bash deploy/scripts/backup-db.sh
```
Backups ficam em `deploy/backups/` com rotação automática (últimos 7).

### Backup Automático (Cron)
```bash
# Editar crontab
crontab -e

# Adicionar (backup diário às 3h da manhã):
0 3 * * * /opt/delivery/deploy/scripts/backup-db.sh >> /var/log/delivery-backup.log 2>&1
```

### Restaurar Backup
```bash
# Descomprimir e restaurar
gunzip < deploy/backups/backup_20260207_030000.sql.gz | \
  docker compose -f deploy/docker-compose.production.yml exec -T delivery_db \
  psql -U delivery delivery_prod
```

---

## Troubleshooting

### Container não inicia
```bash
# Ver logs de erro
docker compose -f deploy/docker-compose.production.yml logs backend
docker compose -f deploy/docker-compose.production.yml logs delivery_db
```

### Erro de migração do Prisma
```bash
# Rodar migração manualmente
docker compose -f deploy/docker-compose.production.yml run --rm migrate
```

### Nginx não responde
```bash
# Testar configuração
sudo nginx -t

# Ver logs do nginx
sudo tail -f /var/log/nginx/error.log

# Reiniciar nginx
sudo systemctl restart nginx
```

### Renovar SSL manualmente
```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Sem espaço em disco
```bash
# Limpar tudo do Docker não utilizado
docker system prune -a --volumes
```

### WebSocket não conecta
Verifique se o nginx tem a config de upgrade do WebSocket:
```bash
cat /etc/nginx/sites-available/api.conf | grep -A5 socket.io
```

### Print Agent não conecta
No Print Agent (Windows), configure:
```env
BACKEND_SOCKET_URL=https://api.seudominio.com.br
```

---

## Comandos Úteis

```bash
# Entrar no container do backend
docker compose -f deploy/docker-compose.production.yml exec backend sh

# Entrar no banco de dados
docker compose -f deploy/docker-compose.production.yml exec delivery_db psql -U delivery delivery_prod

# Reiniciar apenas o backend
docker compose -f deploy/docker-compose.production.yml restart backend

# Parar tudo
docker compose -f deploy/docker-compose.production.yml down

# Parar tudo E apagar volumes (CUIDADO: perde dados!)
# docker compose -f deploy/docker-compose.production.yml down -v

# Ver uso de disco dos volumes
docker system df -v
```

---

## Estrutura de Arquivos no Servidor

```
/opt/delivery/                          # Raiz do projeto (git clone)
├── deploy/
│   ├── .env                            # Suas configurações (NÃO versionado)
│   ├── .env.example                    # Template das configurações
│   ├── docker-compose.production.yml   # Compose de produção
│   ├── backups/                        # Backups do banco (auto-rotação)
│   │   ├── backup_20260207_030000.sql.gz
│   │   └── ...
│   ├── nginx/
│   │   ├── api.conf                    # Template nginx (API)
│   │   └── app.conf                    # Template nginx (Frontend)
│   └── scripts/
│       ├── setup-vps.sh                # Setup inicial (1x)
│       ├── update.sh                   # Atualização
│       └── backup-db.sh               # Backup do banco
├── delivery-saas-backend/              # Código do backend
├── delivery-saas-frontend/             # Código do frontend
└── delivery-print-agent/              # Print agent (roda no Windows do cliente)

# Configs do Nginx (no host, fora do Docker):
/etc/nginx/sites-available/api.conf     # Gerado pelo setup-vps.sh
/etc/nginx/sites-available/app.conf     # Gerado pelo setup-vps.sh

# Certificados SSL (gerenciados pelo Certbot):
/etc/letsencrypt/live/api.seudominio.com.br/
/etc/letsencrypt/live/app.seudominio.com.br/

# Dados persistentes (volumes Docker):
/var/lib/docker/volumes/delivery_db_data/        # Banco PostgreSQL
/var/lib/docker/volumes/delivery_backend_uploads/ # Uploads de imagens
```

---

## O que NÃO é afetado nas atualizações

| Item | Onde fica | Persiste? |
|------|-----------|-----------|
| Banco de dados | Volume Docker `db_data` | Sim |
| Uploads (imagens) | Volume Docker `backend_uploads` | Sim |
| Certificados SSL | `/etc/letsencrypt/` (host) | Sim |
| Configs Nginx | `/etc/nginx/sites-available/` (host) | Sim |
| Arquivo `.env` | `deploy/.env` (não versionado) | Sim |
| Backups | `deploy/backups/` | Sim |
