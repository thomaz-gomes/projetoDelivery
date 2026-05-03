# Caddy Migration — Custom Domain SSL Automation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace nginx + certbot com Caddy para provisionar SSL automaticamente em custom domains sem intervenção manual.

**Architecture:** Caddy roda no host no lugar do nginx e usa on-demand TLS — quando chega o primeiro request HTTPS para um custom domain, ele chama `/internal/check-domain` no backend para validar, emite o cert via Let's Encrypt e armazena em cache. O backend deixa de escrever configs nginx e trigger files; o verify endpoint só precisa confirmar o DNS e atualizar o status no banco.

**Tech Stack:** Caddy v2, Express.js (backend existente), Prisma, Docker Compose (produção)

---

## Contexto: o que existe hoje e o que muda

### Fluxo atual (frágil)
1. Admin clica "verificar DNS" no painel
2. Backend (`POST /custom-domains/:id/verify`) resolve DNS, escreve config nginx em `/etc/nginx/sites-enabled/<domain>.conf` (bind mount), cria trigger file em `/var/www/certbot/pending/<id>.domain`
3. Cron do host (script não-existente no repo) deveria ler o trigger, rodar certbot, escrever `/var/www/certbot/pending/<id>.status`
4. Backend polling a cada 5 segundos esperando o `.status`

### Fluxo novo (Caddy)
1. Admin clica "verificar DNS" no painel
2. Backend verifica DNS → atualiza DB para `ACTIVE` + `SSL_ACTIVE` → retorna
3. Cliente acessa o domínio → Caddy chama `GET /internal/check-domain?domain=xxx` → backend retorna 200 → Caddy emite cert automaticamente

**Arquivos modificados:**
- Modificar: `delivery-saas-backend/src/routes/customDomain.js`
- Criar: `deploy/caddy/Caddyfile`
- Modificar: `deploy/scripts/setup-vps.sh`
- Modificar: `deploy/docker-compose.production.yml`

---

## Task 1: Caddyfile template

**Files:**
- Criar: `deploy/caddy/Caddyfile`

**Step 1: Criar o arquivo**

```
deploy/caddy/Caddyfile
```

```caddyfile
{
    # Caddy chama este endpoint antes de emitir cert para qualquer domínio desconhecido.
    # Retorno 2xx = autorizado; qualquer outro = recusado.
    on_demand_tls {
        ask http://localhost:3000/internal/check-domain
        interval 2m
        burst 5
    }
}

# Domínio principal do frontend (SaaS admin panel)
APP_DOMAIN_PLACEHOLDER {
    reverse_proxy localhost:8080
}

# Domínio principal da API
API_DOMAIN_PLACEHOLDER {
    # WebSocket (Socket.IO) — Caddy faz upgrade automaticamente
    reverse_proxy localhost:3000
}

# Catch-all HTTPS para custom domains dos clientes — on-demand TLS
:443 {
    tls {
        on_demand
    }
    reverse_proxy localhost:3000
}

# Redireciona HTTP → HTTPS para custom domains
:80 {
    redir https://{host}{uri} 301
}
```

**Step 2: Commit**

```bash
git add deploy/caddy/Caddyfile
git commit -m "feat(deploy): add Caddyfile template with on-demand TLS for custom domains"
```

---

## Task 2: Endpoint de validação para o Caddy

**Files:**
- Modificar: `delivery-saas-backend/src/routes/customDomain.js` (adicionar antes de `router.use(authMiddleware)`)

O Caddy chama este endpoint para cada domínio desconhecido. Deve retornar 200 se o domínio está ativo e pago, não-2xx caso contrário. Só aceita requisições de localhost.

**Step 1: Adicionar o endpoint**

Localizar o bloco que começa com `// All remaining routes require authentication` (linha 95) e adicionar o endpoint ANTES dele:

```js
// ---------- GET /internal/check-domain ----------
// Chamado pelo Caddy (on-demand TLS) para autorizar emissão de certificado.
// Só aceita requisições de localhost — o Caddy roda no host, não no container.
router.get('/internal/check-domain', async (req, res) => {
  const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '')
  if (ip !== '127.0.0.1' && ip !== '::1') return res.status(403).end()

  const domain = String(req.query.domain || '').toLowerCase().trim()
  if (!domain) return res.status(400).end()

  try {
    let record = await prisma.customDomain.findUnique({
      where: { domain },
      select: { status: true, paidUntil: true },
    })
    if (!record) {
      const alt = domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`
      record = await prisma.customDomain.findUnique({
        where: { domain: alt },
        select: { status: true, paidUntil: true },
      })
    }
    if (!record || record.status !== 'ACTIVE') return res.status(404).end()
    if (record.paidUntil && new Date(record.paidUntil) < new Date()) return res.status(403).end()
    return res.status(200).end()
  } catch (e) {
    console.error('[check-domain] error:', e.message)
    return res.status(500).end()
  }
})
```

**Step 2: Verificar que o endpoint está antes do authMiddleware**

O `router.use(authMiddleware)` está na linha ~96. O novo endpoint deve ficar entre o `resolve-public` e o `authMiddleware`.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/customDomain.js
git commit -m "feat(custom-domain): add /internal/check-domain endpoint for Caddy on-demand TLS"
```

---

## Task 3: Simplificar o verify endpoint (remover lógica nginx/certbot)

**Files:**
- Modificar: `delivery-saas-backend/src/routes/customDomain.js`

Com Caddy, o backend não precisa mais: escrever configs nginx, criar trigger files nem fazer polling. O verify endpoint só valida DNS e marca como `ACTIVE`.

**Step 1: Remover imports desnecessários**

Remover as linhas de import:
```js
import fs from 'fs'
import path from 'path'
```

E remover a constante:
```js
const SSL_PENDING_DIR = '/var/www/certbot/pending'
```

**Step 2: Remover a função `pollSslStatus`**

Deletar a função inteira (linhas 13–51 no arquivo original).

**Step 3: Substituir o corpo do `POST /:id/verify`**

Substituir tudo entre as chaves do handler por:

```js
router.post('/:id/verify', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const record = await prisma.customDomain.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })
    if (record.companyId !== req.user.companyId) return res.status(403).json({ message: 'Forbidden' })

    const serverIp = await getSetting('custom_domain_server_ip', 'CUSTOM_DOMAIN_SERVER_IP')
    if (!serverIp) return res.status(500).json({ message: 'IP do servidor não configurado. Configure em Configurações SaaS.' })

    // Resolve DNS (tenta domínio exato; se falhar, tenta variante www)
    let addresses
    const domainToResolve = record.domain
    try {
      addresses = await new Promise((resolve, reject) => {
        dns.resolve4(domainToResolve, (err, addrs) => (err ? reject(err) : resolve(addrs)))
      })
    } catch (dnsErr) {
      return res.status(400).json({
        verified: false,
        message: `DNS não resolvido para ${domainToResolve}: ${dnsErr.code || dnsErr.message}`,
      })
    }

    if (!addresses.includes(serverIp)) {
      return res.status(400).json({
        verified: false,
        message: `DNS aponta para ${addresses.join(', ')} — esperado ${serverIp}`,
        addresses,
        expected: serverIp,
      })
    }

    // DNS ok — ativa o domínio. Caddy emite o cert automaticamente no primeiro request.
    const updated = await prisma.customDomain.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        sslStatus: 'SSL_ACTIVE',
        verifiedAt: new Date(),
      },
    })

    res.json({ verified: true, status: updated.status, sslStatus: updated.sslStatus })
  } catch (e) {
    console.error('POST /custom-domains/:id/verify error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao verificar DNS', error: e?.message })
  }
})
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/customDomain.js
git commit -m "refactor(custom-domain): remove nginx/certbot file-based SSL provisioning, Caddy handles it automatically"
```

---

## Task 4: Remover bind mounts desnecessários do docker-compose

**Files:**
- Modificar: `deploy/docker-compose.production.yml`

**Step 1: Remover as linhas dos bind mounts do backend**

Remover do serviço `backend`:
```yaml
      # Custom domain SSL: write nginx configs + trigger files, host cron does certbot
      - /etc/nginx/sites-enabled:/etc/nginx/sites-enabled
      - /var/www/certbot:/var/www/certbot
```

**Step 2: Verificar**

O bloco `volumes` do backend deve ficar apenas:
```yaml
    volumes:
      - backend_uploads:/app/public/uploads
      - backend_certs:/app/secure/certs
      - backend_settings:/app/settings
```

**Step 3: Commit**

```bash
git add deploy/docker-compose.production.yml
git commit -m "chore(deploy): remove nginx/certbot bind mounts from backend container"
```

---

## Task 5: Atualizar setup-vps.sh para instalar Caddy

**Files:**
- Modificar: `deploy/scripts/setup-vps.sh`

**Step 1: Substituir instalação de nginx por Caddy**

Encontrar o bloco `[3/7] Instalando Nginx` e substituir por:

```bash
# =========================================
# 3. Instalar Caddy
# =========================================
echo -e "${GREEN}[3/7] Instalando Caddy...${NC}"
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
```

**Step 2: Remover instalação do Certbot (bloco [4/7])**

Deletar o bloco inteiro:
```bash
# =========================================
# 4. Instalar Certbot (Let's Encrypt)
# =========================================
...
```

Renumerar os blocos seguintes (firewall vira [4/6], nginx config vira [5/6], SSL vira [6/6]).

**Step 3: Substituir configuração do Nginx por Caddy**

Encontrar o bloco `[6/7] Configurando Nginx` e substituir por:

```bash
# =========================================
# 5. Configurar Caddy
# =========================================
echo -e "${GREEN}[5/6] Configurando Caddy...${NC}"

# Copiar Caddyfile substituindo placeholders pelos domínios reais
sed -e "s/API_DOMAIN_PLACEHOLDER/${API_DOMAIN}/g" \
    -e "s/APP_DOMAIN_PLACEHOLDER/${APP_DOMAIN}/g" \
    "$DEPLOY_DIR/caddy/Caddyfile" > /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
echo -e "${GREEN}Caddy configurado!${NC}"
```

**Step 4: Substituir bloco de SSL (certbot) pelo aviso de DNS**

Encontrar o bloco `[7/7] Obtendo Certificados SSL` e substituir por:

```bash
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
```

**Step 5: Atualizar mensagem final**

No final do script, atualizar as instruções para não mencionar certbot.

**Step 6: Commit**

```bash
git add deploy/scripts/setup-vps.sh
git commit -m "feat(deploy): replace nginx+certbot with Caddy in setup-vps.sh"
```

---

## Task 6: Migração no VPS existente (comandos manuais)

Esta task documenta os comandos para migrar o VPS que já roda nginx. Executar via SSH.

**Step 1: Instalar Caddy**

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

**Step 2: Gerar Caddyfile com os domínios do .env**

```bash
cd /opt/delivery
source deploy/.env
sed -e "s/API_DOMAIN_PLACEHOLDER/${API_DOMAIN}/g" \
    -e "s/APP_DOMAIN_PLACEHOLDER/${APP_DOMAIN}/g" \
    deploy/caddy/Caddyfile > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
```

**Step 3: Parar nginx, iniciar Caddy**

```bash
systemctl stop nginx
systemctl disable nginx
systemctl enable caddy
systemctl start caddy
systemctl status caddy
```

**Step 4: Deploy do backend atualizado**

```bash
cd /opt/delivery
git pull origin main
docker compose -f deploy/docker-compose.production.yml up -d --build backend
```

**Step 5: Verificar**

```bash
# API respondendo?
curl https://api.deliverywl.com.br/health

# Caddy obteve o cert?
curl -I https://app.deliverywl.com.br

# Logs do Caddy (deve mostrar cert emitido)
journalctl -u caddy -f
```

**Step 6: Testar custom domain**

Para um domínio já cadastrado no banco com status `ACTIVE`, acessar via browser — Caddy deve emitir o cert automaticamente no primeiro request (pode levar ~5 segundos).

---

## Notas

- **Caddy armazena os certs em** `/var/lib/caddy/.local/share/caddy/` — persiste entre reinicios.
- **Rate limit Let's Encrypt:** 5 certs por domínio por semana. O `interval 2m` e `burst 5` no Caddyfile protegem contra abuso.
- **Primeiro request lento:** quando Caddy ainda não tem o cert, o primeiro HTTPS leva alguns segundos para emissão. Subsequentes são instantâneos.
- **WebSockets (Socket.IO):** Caddy faz upgrade automático, sem configuração extra (diferente do nginx que precisava do `websocket.conf`).
- **`retry-ssl` endpoint:** com Caddy, o botão "retry SSL" no painel pode simplesmente chamar `verify` novamente — se o DNS estiver ok, o status já vai para ACTIVE e Caddy cuida do cert.
