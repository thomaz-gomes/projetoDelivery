param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Token,
  [switch]$AcceptSelfSigned
)

if (-not $Token) {
  Write-Host "Usage: .\create_and_complete_test_order.ps1 -Token <ADMIN_JWT> [-BaseUrl <url>] [-AcceptSelfSigned]"
  exit 1
}

# Allow self-signed certs for local dev when requested
if ($AcceptSelfSigned -and $BaseUrl.StartsWith("https", [System.StringComparison]::InvariantCultureIgnoreCase)) {
  Write-Host "Accepting self-signed HTTPS certs for this session (dev only)"
  add-type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint srvPoint, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
  [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
}

$headers = @{
  "Authorization" = "Bearer $Token"
  "Content-Type"  = "application/json"
}

# Minimal test order payload with coupon 'cupomteste'
$payload = @{
  items = @(@{ name = 'Teste Item'; quantity = 1; price = 10 })
  type = 'PICKUP'
  customerPhone = '0000000000'
  customerName = 'Teste Cliente'
  coupon = @{ code = 'cupomteste' }
  payment = @{ method = 'CASH'; amount = 10 }
}

Write-Host "Creating test order with coupon 'cupomteste' at $BaseUrl"
try {
  $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/orders" -Headers $headers -Body (ConvertTo-Json $payload -Depth 6)
} catch {
  Write-Host "Failed to create order:" -ForegroundColor Red
  Write-Host $_.Exception.Response.StatusCode.Value__  -ForegroundColor Red -ErrorAction SilentlyContinue
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 2
}

if (-not $resp.id) {
  Write-Host "Unexpected response creating order:" -ForegroundColor Yellow
  $resp | ConvertTo-Json | Write-Host
  exit 3
}

$orderId = $resp.id
Write-Host "Created order id: $orderId  (displayId: $($resp.displayId))"

# Wait briefly to let DB hooks/processes settle
Start-Sleep -Seconds 1

# Now patch status to CONCLUIDO to trigger affiliate tracking
$patch = @{ status = 'CONCLUIDO'; payments = @(@{ method = 'CASH'; amount = 10 }) }
Write-Host "Patching order status to CONCLUIDO to trigger affiliate tracking"
try {
  $patched = Invoke-RestMethod -Method Patch -Uri "$BaseUrl/orders/$orderId/status" -Headers $headers -Body (ConvertTo-Json $patch -Depth 6)
  Write-Host "Patched order result: status = $($patched.status)"
} catch {
  Write-Host "Failed to patch order status:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 4
}

Write-Host "Done. Now check your backend terminal for lines starting with [affiliates] to inspect why commission was/was not created." -ForegroundColor Green
Write-Host "If you want, paste the [affiliates] lines here and I will analyze them."