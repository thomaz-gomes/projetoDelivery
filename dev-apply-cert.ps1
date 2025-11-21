<#
Copies SSL files from frontend ssl folder into backend ssl folder and prints next steps.

Usage (PowerShell):
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  .\dev-apply-cert.ps1

#>

param(
  [string]$RepoRoot = "$PSScriptRoot",
  [string]$FrontendSsl = 'delivery-saas-frontend\ssl',
  [string]$BackendSsl = 'delivery-saas-backend\ssl'
)

function FullPath([string]$p){ Join-Path -Path $RepoRoot -ChildPath $p }

$srcDir = FullPath($FrontendSsl)
$dstDir = FullPath($BackendSsl)

Write-Host "Source SSL dir: $srcDir"
Write-Host "Destination SSL dir: $dstDir"

if (-not (Test-Path $srcDir)){
  Write-Error "Source directory not found: $srcDir"; exit 1
}

if (-not (Test-Path $dstDir)){
  Write-Host "Destination does not exist. Creating: $dstDir"; New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}

$mappings = @(
  @{ src='private.key'; dst='localhost-key.pem' },
  @{ src='certificate.crt'; dst='localhost.pem' },
  @{ src='ca_bundle.crt'; dst='ca_bundle.crt' }
)

foreach($map in $mappings){
  $s = Join-Path $srcDir $map.src
  $d = Join-Path $dstDir $map.dst
  if (Test-Path $s){
    Copy-Item -Path $s -Destination $d -Force
    Write-Host "Copied $($map.src) -> $d"
  } else {
    Write-Warning "Source file not found: $s (skipping)"
  }
}

Write-Host "\nDone. To complete the setup follow these steps:"
Write-Host "1) If the CA bundle exists and you want your browser to trust it, run PowerShell as Administrator and execute:"
Write-Host "   certutil -addstore -f Root \"$dstDir\ca_bundle.crt\""
Write-Host "   (Skip this if the certificate is already trusted.)"
Write-Host "2) Restart the backend so it picks up the new cert files (or nodemon will auto-reload). Example:" 
Write-Host "   cd $RepoRoot\delivery-saas-backend; npm run dev"
Write-Host "3) Restart the frontend dev server (so it honors VITE_API_URL if needed):"
Write-Host "   cd $RepoRoot\delivery-saas-frontend; npm run dev -- --host dev.redemultilink.com.br"
Write-Host "4) Open https://dev.redemultilink.com.br:5173 and try login again."
