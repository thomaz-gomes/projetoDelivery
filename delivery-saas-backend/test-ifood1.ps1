# ============================================
# test-ifood.ps1
# Script de teste da integração iFood (login + poll)
# Compatível com PowerShell do Windows
# ============================================

Write-Host "========================================"
Write-Host " Iniciando teste de autenticação iFood"
Write-Host "========================================"

# CONFIGURAÇÕES
$baseUrl = "https://localhost:3000"
$email = "admin@example.com"
$password = "admin123"

# =====================================================
# 1️⃣ LOGIN
# =====================================================
Write-Host ""
Write-Host "===> Etapa 1: Fazendo login..."
$body = @{
  email = $email
  password = $password
} | ConvertTo-Json

try {
  $response = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Body $body -ContentType "application/json"
  $token = $response.token

  if (-not $token) {
    Write-Host "ERRO: o login não retornou um token. Verifique as credenciais." -ForegroundColor Red
    exit 1
  }

  Write-Host "Login bem-sucedido!"
  Write-Host "Usuário: $($response.user.name) ($($response.user.role))"
  Write-Host "Empresa: $($response.user.companyId)"
  Write-Host ""
  Write-Host "TOKEN JWT (completo):" -ForegroundColor Cyan
  Write-Host $token
}
catch {
  Write-Host ""
  Write-Host "ERRO ao fazer login:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if ($_.ErrorDetails.Message) {
    Write-Host "Detalhes:" $_.ErrorDetails.Message
  }
  exit 1
}

# =====================================================
# 2️⃣ POLLING DE PEDIDOS IFOOD
# =====================================================
Write-Host ""
Write-Host "===> Etapa 2: Executando /integrations/ifood/poll ..."
try {
  $poll = Invoke-RestMethod `
    -Uri "$baseUrl/integrations/ifood/poll" `
    -Method POST `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json"

  Write-Host ""
  Write-Host "Polling executado com sucesso:" -ForegroundColor Green
  $poll | ConvertTo-Json -Depth 6
}
catch {
  Write-Host ""
  Write-Host "ERRO ao executar o polling:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if ($_.ErrorDetails.Message) {
    Write-Host ""
    Write-Host "Detalhes:" $_.ErrorDetails.Message
  }
}

Write-Host ""
Write-Host "========================================"
Write-Host " Fim do teste iFood"
Write-Host "========================================"