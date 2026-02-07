<#
  Instalador do Agente de Impressao - Delivery SaaS

  Este script configura o agente de impressao no computador do cliente:
  1. Detecta impressoras instaladas no Windows
  2. Solicita URL do backend, Store IDs e Token
  3. Gera o arquivo .env automaticamente
  4. Instala dependencias (se executando via Node.js)
  5. Configura inicio automatico via pm2 ou Tarefa Agendada
#>

$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
Set-Location $scriptDir

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Agente de Impressao - Delivery SaaS  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Detect printers ---
Write-Step "Detectando impressoras instaladas"
$printerList = @()
try {
    $printerList = Get-Printer | Select-Object -ExpandProperty Name
    if ($printerList.Count -eq 0) {
        Write-Warn "Nenhuma impressora encontrada no sistema."
    } else {
        Write-Host "  Impressoras encontradas:" -ForegroundColor White
        for ($i = 0; $i -lt $printerList.Count; $i++) {
            Write-Host "    [$($i+1)] $($printerList[$i])" -ForegroundColor White
        }
    }
} catch {
    Write-Warn "Nao foi possivel listar impressoras: $_"
}

# --- Step 2: Collect configuration ---
Write-Step "Configuracao do agente"

# Backend URL
$backendUrl = Read-Host "  URL do backend (ex: https://seu-app.com)"
if ([string]::IsNullOrWhiteSpace($backendUrl)) {
    $backendUrl = "http://localhost:3000"
    Write-Warn "Usando URL padrao: $backendUrl"
}

# Store IDs
$storeIds = Read-Host "  IDs das lojas (separados por virgula)"
if ([string]::IsNullOrWhiteSpace($storeIds)) {
    Write-Warn "Nenhum Store ID informado. Voce precisara editar o .env manualmente."
}

# Agent Token
$token = Read-Host "  Token do agente (gerado no painel > Configurar Impressao > Gerar Token)"
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Warn "Nenhum token informado. O agente nao conseguira autenticar sem token."
}

# Printer selection
$selectedPrinter = ""
if ($printerList.Count -gt 0) {
    $printerChoice = Read-Host "  Escolha a impressora (numero) ou Enter para padrao"
    if (-not [string]::IsNullOrWhiteSpace($printerChoice)) {
        $idx = [int]$printerChoice - 1
        if ($idx -ge 0 -and $idx -lt $printerList.Count) {
            $selectedPrinter = $printerList[$idx]
            Write-Ok "Impressora selecionada: $selectedPrinter"
        }
    }
}
if ([string]::IsNullOrWhiteSpace($selectedPrinter)) {
    $selectedPrinter = Read-Host "  Nome da impressora (ou Enter para deixar vazio)"
}

# Printer type
$printerType = Read-Host "  Tipo de impressora [EPSON/STAR] (padrao: EPSON)"
if ([string]::IsNullOrWhiteSpace($printerType)) { $printerType = "EPSON" }

# Paper width
$paperWidth = Read-Host "  Largura do papel em colunas [48 para 80mm / 32 para 58mm] (padrao: 48)"
if ([string]::IsNullOrWhiteSpace($paperWidth)) { $paperWidth = "48" }

# Copies
$copies = Read-Host "  Numero de copias por pedido (padrao: 1)"
if ([string]::IsNullOrWhiteSpace($copies)) { $copies = "1" }

# --- Step 3: Generate .env ---
Write-Step "Gerando arquivo .env"

$envContent = @"
# Configuracao do Agente de Impressao
BACKEND_SOCKET_URL=$backendUrl
STORE_IDS=$storeIds
PRINT_AGENT_TOKEN=$token
PRINTER_NAME=$selectedPrinter
PRINTER_TYPE=$printerType
PRINTER_WIDTH=$paperWidth
COPIES=$copies
DRY_RUN=false
"@

$envPath = Join-Path $scriptDir ".env"
Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Ok "Arquivo .env criado em: $envPath"

# --- Step 4: Check if running as .exe or Node.js ---
$exePath = Join-Path $scriptDir "delivery-print-agent.exe"
$isExe = Test-Path $exePath

if ($isExe) {
    Write-Step "Executavel detectado"
    Write-Ok "delivery-print-agent.exe encontrado"
} else {
    Write-Step "Instalando dependencias (npm)"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "  Node.js nao encontrado. Instale o Node 18+ em https://nodejs.org/" -ForegroundColor Red
        Write-Host "  Ou utilize o executavel .exe que nao requer Node.js." -ForegroundColor Red
        Read-Host "Pressione Enter para sair"
        exit 1
    }
    npm install --production 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Dependencias instaladas" }
    else { Write-Warn "Falha ao instalar dependencias" }
}

# --- Step 5: Test run ---
Write-Step "Teste de conexao"
Write-Host "  Deseja testar a conexao agora? (S/n)" -ForegroundColor White
$testChoice = Read-Host
if ($testChoice -ne "n" -and $testChoice -ne "N") {
    Write-Host "  Iniciando agente em modo teste (5 segundos)..." -ForegroundColor White
    if ($isExe) {
        $proc = Start-Process -FilePath $exePath -PassThru -NoNewWindow
    } else {
        $proc = Start-Process -FilePath "node" -ArgumentList "index.js" -PassThru -NoNewWindow
    }
    Start-Sleep -Seconds 5
    if (-not $proc.HasExited) {
        $proc.Kill()
        Write-Ok "Agente iniciou sem erros"
    } else {
        Write-Warn "O agente encerrou inesperadamente. Verifique as configuracoes."
    }
}

# --- Step 6: Auto-start setup ---
Write-Step "Inicio automatico"
Write-Host "  Como deseja iniciar o agente automaticamente?" -ForegroundColor White
Write-Host "    [1] Tarefa Agendada do Windows (recomendado)" -ForegroundColor White
Write-Host "    [2] pm2 (requer Node.js)" -ForegroundColor White
Write-Host "    [3] Nao configurar inicio automatico" -ForegroundColor White
$autoStart = Read-Host "  Escolha (1/2/3)"

switch ($autoStart) {
    "1" {
        try {
            $taskName = "DeliveryPrintAgent"
            $command = if ($isExe) { $exePath } else { "node" }
            $arguments = if ($isExe) { "" } else { "`"$(Join-Path $scriptDir 'index.js')`"" }

            $action = New-ScheduledTaskAction -Execute $command -Argument $arguments -WorkingDirectory $scriptDir
            $trigger = New-ScheduledTaskTrigger -AtLogon
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

            Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
            Write-Ok "Tarefa agendada '$taskName' criada. O agente iniciara automaticamente no login."
        } catch {
            Write-Warn "Falha ao criar tarefa agendada: $_"
            Write-Warn "Tente executar como Administrador."
        }
    }
    "2" {
        $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
        if (-not $pm2) {
            Write-Host "  Instalando pm2..." -ForegroundColor White
            npm install -g pm2 2>&1 | Out-Null
        }
        if ($isExe) {
            pm2 start $exePath --name delivery-print-agent
        } else {
            pm2 start index.js --name delivery-print-agent
        }
        pm2 save 2>&1 | Out-Null
        Write-Ok "Agente registrado no pm2. Use 'pm2 logs delivery-print-agent' para ver logs."
    }
    default {
        Write-Ok "Inicio automatico nao configurado. Inicie manualmente quando necessario."
    }
}

# --- Done ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Instalacao concluida!                 " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
if ($isExe) {
    Write-Host "  Para iniciar manualmente: .\delivery-print-agent.exe" -ForegroundColor White
} else {
    Write-Host "  Para iniciar manualmente: node index.js" -ForegroundColor White
}
Write-Host "  Para editar configuracao: notepad .env" -ForegroundColor White
Write-Host ""
Read-Host "Pressione Enter para sair"
