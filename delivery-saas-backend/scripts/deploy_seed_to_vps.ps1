<#
PowerShell helper: deploy_seed_to_vps.ps1
Usage (adjust variables in parameters or pass as args):

.\deploy_seed_to_vps.ps1 -VpsHost "vps.example.com" -VpsUser "deploy" -RemoteProjectPath "/srv/projetodelivery" -LocalSeedPath ".\prisma\seed_export.json"

Notes:
- Requires `scp` and `ssh` available (OpenSSH client).
- This script will:
  1) copy local seed to the VPS /tmp folder
  2) move it into the remote project `delivery-saas-backend/prisma/seed_export.json`
  3) run backup (pg_dump) on VPS (attempts to use POSTGRES env vars; prompts if missing)
  4) run `prisma db push` (non-destructive) inside backend container
  5) run the import script inside the backend container
#>
param(
    [Parameter(Mandatory=$true)] [string]$VpsHost,
    [Parameter(Mandatory=$true)] [string]$VpsUser,
    [Parameter(Mandatory=$false)] [string]$RemoteProjectPath = "/srv/projetodelivery",
    [Parameter(Mandatory=$false)] [string]$LocalSeedPath = ".\prisma\seed_export.json",
    [Parameter(Mandatory=$false)] [int]$SshPort = 22
)

$localSeed = Resolve-Path $LocalSeedPath -ErrorAction Stop
Write-Host "Local seed: $localSeed"
$remoteTmp = "/tmp/seed_export.json"

# Build remote commands as a single literal block (no PowerShell interpolation)
$remoteCmd = @'
mkdir -p {RemoteProject}/delivery-saas-backend/prisma
mv /tmp/seed_export.json {RemoteProject}/delivery-saas-backend/prisma/seed_export.json
cd {RemoteProject}
mkdir -p /srv/backups || true
echo 'Attempting pg_dump to /srv/backups'
if command -v pg_dump >/dev/null 2>&1; then PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h localhost -U postgres -d projetodelivery | gzip > /srv/backups/projetodelivery-$(date +%Y%m%d%H%M%S).sql.gz || echo 'pg_dump failed or POSTGRES_PASSWORD not set'; else echo 'pg_dump not found'; fi
docker compose -f docker-compose.prod.yml run --rm backend sh -c "npx prisma db push --schema=prisma/schema.postgres.prisma"
docker compose -f docker-compose.prod.yml run --rm backend sh -c "npx prisma generate && node scripts/import_seed_from_json.mjs prisma/seed_export.json"
'@

# Replace placeholder with actual remote project path
$remoteCmd = $remoteCmd -replace '\{RemoteProject\}', [Regex]::Escape($RemoteProjectPath)

Write-Host ('Copying seed to {0}@{1}:{2}' -f $VpsUser, $VpsHost, $remoteTmp)

# Use Start-Process to call scp with argument list to avoid quoting issues
$scpArgs = @('-P', $SshPort.ToString(), $localSeed.Path, ($VpsUser + '@' + $VpsHost + ':' + $remoteTmp))
$scp = Start-Process -FilePath 'scp' -ArgumentList $scpArgs -NoNewWindow -Wait -PassThru
if ($scp.ExitCode -ne 0) { Write-Error "scp failed with exit code $($scp.ExitCode)"; exit $scp.ExitCode }

Write-Host 'Running remote commands via ssh...'

# Run the remote block using ssh; pass the block as a single argument. Use bash -lc to ensure proper expansion on the remote side.
$sshArgs = @('-p', $SshPort.ToString(), ($VpsUser + '@' + $VpsHost), 'bash -lc ' + [char]34 + $remoteCmd + [char]34)
$ssh = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -NoNewWindow -Wait -PassThru
if ($ssh.ExitCode -ne 0) { Write-Error "Remote commands failed with exit code $($ssh.ExitCode)"; exit $ssh.ExitCode }

Write-Host 'Done. Seed transferred and import completed (or started). Check VPS logs for importer output.'