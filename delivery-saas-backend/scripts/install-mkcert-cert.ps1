param(
  [string]$SourceCert = "$env:USERPROFILE\localhost+2.pem",
  [string]$SourceKey = "$env:USERPROFILE\localhost+2-key.pem",
  [string]$DestDir = "$PSScriptRoot\..\ssl"
)

# Ensure destination exists
if (!(Test-Path -Path $DestDir)) {
  New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}

$destCert = Join-Path $DestDir "localhost.pem"
$destKey = Join-Path $DestDir "localhost-key.pem"

Write-Host "Source cert: $SourceCert"
Write-Host "Source key:  $SourceKey"
Write-Host "Destination: $DestDir"

if (!(Test-Path -Path $SourceCert)) {
  Write-Error "Source certificate not found: $SourceCert"
  exit 1
}
if (!(Test-Path -Path $SourceKey)) {
  Write-Error "Source key not found: $SourceKey"
  exit 1
}

Copy-Item -Path $SourceCert -Destination $destCert -Force
Copy-Item -Path $SourceKey -Destination $destKey -Force

Write-Host "Certificates copied to $DestDir"
Write-Host "Don't forget to add the ssl folder to your .gitignore (already added)."
