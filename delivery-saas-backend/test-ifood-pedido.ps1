# ============================================
# test-ifood-pedido.ps1
# Simula recebimento de pedido do iFood via webhook local
# ============================================

Write-Host "========================================"
Write-Host " Teste: Simulação de Pedido iFood (Webhook)"
Write-Host "========================================"

# Configuração
$baseUrl = "https://localhost:3000"
$webhookUrl = "$baseUrl/webhooks/ifood"
$sampleFile = "sample/ifood-webhook.json"

# Verifica se o arquivo existe
if (-not (Test-Path $sampleFile)) {
  Write-Host "❌ Arquivo de exemplo não encontrado: $sampleFile" -ForegroundColor Red
  exit 1
}

Write-Host "➡️ Enviando payload de pedido para $webhookUrl ..."
try {
  $response = Invoke-RestMethod -Uri $webhookUrl `
    -Method POST `
    -ContentType "application/json" `
    -InFile $sampleFile

  Write-Host "✅ Pedido simulado enviado com sucesso!" -ForegroundColor Green
  $response | ConvertTo-Json -Depth 6
}
catch {
  Write-Host "❌ Erro ao enviar pedido simulado:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if ($_.ErrorDetails.Message) {
    Write-Host "Detalhes:" $_.ErrorDetails.Message
  }
}

Write-Host ""
Write-Host "========================================"
Write-Host " Fim do teste de pedido iFood"
Write-Host "========================================"