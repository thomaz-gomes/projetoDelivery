<#
Copies/exports certificates from backend ssl folder to frontend ssl folder.

Usage (PowerShell):
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  .\sync-cert-backend-to-frontend.ps1

If a PFX is present in the backend ssl directory and OpenSSL is available, the script will
export the certificate and private key into PEM files usable by the Vite dev server.

#>

param(
  [string]$RepoRoot = "$PSScriptRoot",
  [string]$BackendSsl = 'delivery-saas-backend\ssl',
  [string]$FrontendSsl = 'delivery-saas-frontend\ssl',
  [string]$PfxPassword = ''
)

function FullPath([string]$p){ Join-Path -Path $RepoRoot -ChildPath $p }

$backendDir = FullPath($BackendSsl)
$frontendDir = FullPath($FrontendSsl)

Write-Host "Backend SSL dir: $backendDir"
Write-Host "Frontend SSL dir: $frontendDir"

if (-not (Test-Path $backendDir)){
  Write-Error "Backend SSL directory not found: $backendDir"; exit 1
}

if (-not (Test-Path $frontendDir)){
  Write-Host "Frontend SSL dir does not exist. Creating: $frontendDir"; New-Item -ItemType Directory -Path $frontendDir -Force | Out-Null
}

# prefer explicit PFX if present
$pfx = Get-ChildItem -Path $backendDir -Filter *.pfx -ErrorAction SilentlyContinue | Select-Object -First 1

function CopyIfExists($src, $dst){
  if (Test-Path $src){ Copy-Item -Path $src -Destination $dst -Force; Write-Host "Copied: $src -> $dst" } else { Write-Host "Not found (skipped): $src" }
}

if ($pfx){
  Write-Host "Found PFX: $($pfx.FullName)"
  $openssl = Get-Command openssl -ErrorAction SilentlyContinue
  if (-not $openssl){
    Write-Warning "OpenSSL not found in PATH. Cannot extract PEM from PFX.\nFalling back to copying existing PEM files if present in backend ssl.\nInstall OpenSSL or export PEM files from your certificate tool and retry."
  } else {
    # export cert(s) and key using openssl
    $pfxPath = $pfx.FullName
    $tempCerts = Join-Path $env:TEMP "dev-sync-certs-$(Get-Random).pem"
    $tempKey = Join-Path $env:TEMP "dev-sync-key-$(Get-Random).pem"
    try{
      $pwArg = ''
      if ($PfxPassword -ne ''){ $pwArg = "-passin pass:$PfxPassword" }
      & $openssl.Source pkcs12 -in "$pfxPath" -nokeys $pwArg -out "$tempCerts" 2>&1 | Out-String | Write-Host
      & $openssl.Source pkcs12 -in "$pfxPath" -nocerts -nodes $pwArg -out "$tempKey" 2>&1 | Out-String | Write-Host

      # Place outputs into frontend ssl files expected by Vite
      $dstCert = Join-Path $frontendDir 'certificate.crt'
      $dstKey = Join-Path $frontendDir 'private.key'
      $dstCa = Join-Path $frontendDir 'ca_bundle.crt'

      Copy-Item -Path $tempCerts -Destination $dstCert -Force
      Write-Host "Exported certificate(s) -> $dstCert"
      Copy-Item -Path $tempKey -Destination $dstKey -Force
      Write-Host "Exported private key -> $dstKey"

      # Use the certs file also as ca bundle if it contains chain
      Copy-Item -Path $tempCerts -Destination $dstCa -Force
      Write-Host "Also copied certs as CA bundle -> $dstCa"

      Remove-Item $tempCerts -Force -ErrorAction SilentlyContinue
      Remove-Item $tempKey -Force -ErrorAction SilentlyContinue
      Write-Host "Done. Restart the frontend dev server to pick up the new SSL files."
      exit 0
    } catch {
      Write-Warning "Failed to extract PEM from PFX: $($_.Exception.Message)"
    }
  }
}

# No usable PFX extraction path (or OpenSSL missing). Try copying common PEM names from backend to frontend.
$candidates = @(
  @{src='localhost-key.pem'; dst='private.key'},
  @{src='localhost-crt.pem'; dst='certificate.crt'},
  @{src='localhost-chain.pem'; dst='ca_bundle.crt'},
  @{src='localhost-chain-only.pem'; dst='ca_bundle.crt'},
  @{src='localhost.pem'; dst='certificate.crt'},
  @{src='private.key'; dst='private.key'},
  @{src='certificate.crt'; dst='certificate.crt'},
  @{src='ca_bundle.crt'; dst='ca_bundle.crt'}
)

$copied = $false
foreach($m in $candidates){
  $s = Join-Path $backendDir $m.src
  $d = Join-Path $frontendDir $m.dst
  if (Test-Path $s){
    Copy-Item -Path $s -Destination $d -Force
    Write-Host "Copied $($m.src) -> $d"
    $copied = $true
  }
}

if (-not $copied){
  Write-Warning "No known PEM or PFX files were found in backend ssl. Please export PEM files or install OpenSSL to convert PFX. Files checked:"
  $candidates | ForEach-Object { Write-Host " - $($_.src)" }
  exit 2
} else {
  Write-Host "Done. Restart the frontend dev server to pick up the new SSL files. Example: `cd $RepoRoot\delivery-saas-frontend; npm run dev -- --host dev.redemultilink.com.br`"
}
