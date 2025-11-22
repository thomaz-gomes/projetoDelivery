param(
  [Parameter(Mandatory=$true)][string]$SshTarget,
  [Parameter(Mandatory=$true)][string]$RemoteDir,
  [Parameter(Mandatory=$true)][string]$BackendImage,
  [Parameter(Mandatory=$true)][string]$FrontendImage,
  [string]$LocalEnvFile
)

<#
Usage:
  ./scripts/deploy_to_easypanel.ps1 -SshTarget user@server.com -RemoteDir /home/user/deploy -BackendImage ghcr.io/OWNER/projetodelivery-backend:develop -FrontendImage ghcr.io/OWNER/projetodelivery-frontend:develop -LocalEnvFile .\prod.env
#>

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$composeLocal = Join-Path $repoRoot 'docker-compose.prod.yml'
$tmpCompose = Join-Path $env:TEMP 'docker-compose.deploy.yml'

# Read and replace placeholders
$composeContent = Get-Content $composeLocal -Raw
$composeContent = $composeContent -replace '\$\{BACKEND_IMAGE\}', $BackendImage
$composeContent = $composeContent -replace '\$\{FRONTEND_IMAGE\}', $FrontendImage
Set-Content -Path $tmpCompose -Value $composeContent -NoNewline

Write-Host "Uploading compose to $SshTarget:$RemoteDir/docker-compose.yml"
ssh $SshTarget "mkdir -p '$RemoteDir'"
scp $tmpCompose "$SshTarget:$RemoteDir/docker-compose.yml"

if ($LocalEnvFile -and (Test-Path $LocalEnvFile)) {
  Write-Host "Uploading env file $LocalEnvFile -> $RemoteDir/.env"
  scp $LocalEnvFile "$SshTarget:$RemoteDir/.env"
}

Write-Host "Preparing remote environment, running migrations and restarting stack"

$sshCmd = @"
set -e
cd '$RemoteDir'
# ensure db is up so migrations can run
docker compose -f docker-compose.yml up -d db
# pull latest images (don't fail the deploy on pull error)
docker compose -f docker-compose.yml pull || true
# run prisma migrations in a one-off container using the backend service
echo 'Running Prisma migrations...'
docker compose -f docker-compose.yml run --rm backend sh -lc 'npx prisma migrate deploy'
# finally bring the whole stack up
docker compose -f docker-compose.yml up -d --no-build
"@

ssh $SshTarget $sshCmd

Write-Host "`nDeploy complete."
