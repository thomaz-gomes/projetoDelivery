<#
Automated migration script: SQLite (dev.db) -> Postgres (remote)

Usage (example):
  .\migrate-automated.ps1 \
    -RemoteHost 72.60.7.28 -RemotePort 5555 -RemoteUser tomgomes -RemotePass 03t01F007TF \
    -RemoteDb tomgomes_migrated

The script will:
 - verify Docker is available
 - find the non-empty dev.db in common locations
 - backup the local dev.db (copy)
 - optionally create a remote test DB
 - run `prisma db push` (inside a node container) to apply schema.postgres.prisma
 - run pgloader to import /data/dev.db into the remote DB
 - save logs under C:\Users\$env:USERNAME\ (pgloader and dbpush logs)

Be careful: this script targets the remote DB you pass. Default uses a test DB name `tomgomes_migrated`.
#>
param(
  [string]$PrismaFolder = "C:\Users\gomes\projetoDelivery\delivery-saas-backend",
  [string]$RemoteHost = "72.60.7.28",
  [int]$RemotePort = 5555,
  [string]$RemoteUser = "tomgomes",
  [string]$RemotePass = "03t01F007TF",
  [string]$RemoteDb = "tomgomes_migrated",
  [string]$BackupFolder = "C:\Users\gomes\backups",
  [string]$LogFolder = "C:\Users\gomes",
  [string]$NodeImage = 'node:20-bullseye',
  [string]$PgloaderImage = 'dimitri/pgloader:latest',
  [switch]$CreateRemoteDb
)

function Write-Log { param($m) $ts = (Get-Date).ToString('s'); Write-Host "[$ts] $m" }

# Check Docker
Write-Log "Checking Docker availability..."
try { docker -v | Out-Null } catch { Write-Error "Docker not available in PATH or not running."; exit 1 }

# Test connectivity
Write-Log ("Testing connectivity to {0}:{1}..." -f $RemoteHost, $RemotePort)
$tc = Test-NetConnection -ComputerName $RemoteHost -Port $RemotePort -InformationLevel Quiet
if (-not $tc) { Write-Warning "Cannot reach ${RemoteHost}:${RemotePort}. Ensure network and firewall allow access." }

# Locate dev.db candidates
$possible = @(
  (Join-Path $PrismaFolder 'prisma\dev.db'),
  (Join-Path $PrismaFolder 'prisma\prisma\dev.db'),
  (Join-Path $PrismaFolder 'prisma\prisma\prisma\dev.db')
)
$found = @()
foreach ($p in $possible) {
  if (Test-Path $p) {
    $fi = Get-Item $p
    $found += [PSCustomObject]@{ Path = $p; Length = $fi.Length; LastWriteTime = $fi.LastWriteTime }
  }
}
if ($found.Count -eq 0) { Write-Error "No dev.db candidates found under $PrismaFolder\prisma"; exit 1 }

# Choose largest non-zero file if available
$nonzero = $found | Where-Object { $_.Length -gt 0 } | Sort-Object -Property Length -Descending
if ($nonzero.Count -gt 0) {
  $devdb = $nonzero[0].Path
} else {
  # fallback to the first (may be zero-length)
  $devdb = $found | Select-Object -First 1 | ForEach-Object { $_.Path }
}
Write-Log "Selected SQLite file: $devdb"

# Backup local dev.db to BackupFolder
if (-not (Test-Path $BackupFolder)) { New-Item -ItemType Directory -Path $BackupFolder -Force | Out-Null }
$bakname = Join-Path $BackupFolder ("dev.db.bak.{0:yyyyMMddHHmmss}" -f (Get-Date))
Copy-Item -Path $devdb -Destination $bakname -Force
Write-Log "Local dev.db backed up to: $bakname"

# If selected dev.db is not at prisma/dev.db, copy it there (so pgloader mount uses /data/dev.db)
$targetDev = Join-Path $PrismaFolder 'prisma\dev.db'
if ($devdb -ne $targetDev) {
  Write-Log "Copying $devdb -> $targetDev"
  Copy-Item -Path $devdb -Destination $targetDev -Force
}

# Ensure log folder exists
if (-not (Test-Path $LogFolder)) { New-Item -ItemType Directory -Path $LogFolder -Force | Out-Null }
$pgloaderLog = Join-Path $LogFolder 'pgloader-after-copy.log'
$dbpushLog = Join-Path $LogFolder 'prisma-dbpush.log'
$dbpushLogErr = Join-Path $LogFolder 'prisma-dbpush.err.log'
$pgloaderLogErr = Join-Path $LogFolder 'pgloader-after-copy.err.log'

# Optionally create remote DB
if ($CreateRemoteDb) {
  Write-Log "Creating remote database $RemoteDb if not exists..."
  $createCmd = "CREATE DATABASE $RemoteDb;"
  $createArgs = @(
    'run','--rm','-i',
    '-e', "PGPASSWORD=$RemotePass",
    'postgres:15','psql','-h',$RemoteHost,'-p',$RemotePort,'-U',$RemoteUser,'-d','postgres','-c',$createCmd
  )
  Start-Process -FilePath 'docker' -ArgumentList $createArgs -NoNewWindow -Wait -RedirectStandardOutput $dbpushLog -RedirectStandardError $dbpushLogErr
}

# Run prisma db push inside node container
Write-Log ("Running prisma db push (applying schema.postgres.prisma) on {0}:{1}..." -f $RemoteHost, $RemotePort)
$dbUrl = "postgres://${RemoteUser}:${RemotePass}@${RemoteHost}:${RemotePort}/${RemoteDb}?sslmode=disable"
Write-Log "Running docker (prisma db push) with DATABASE_URL=${dbUrl}"
$nodeArgs = @(
  'run','--rm',
  '-e', "DATABASE_URL=$dbUrl",
  '-v', "${PrismaFolder}:/app",
  '-w', '/app',
  $NodeImage,
  'bash','-lc', "npm install --no-audit --no-fund --silent && npx prisma db push --schema=prisma/schema.postgres.prisma"
)
Write-Log "Executing: docker $($nodeArgs -join ' ')"
Start-Process -FilePath 'docker' -ArgumentList $nodeArgs -NoNewWindow -Wait -RedirectStandardOutput $dbpushLog -RedirectStandardError $dbpushLogErr
Write-Log "prisma db push finished; log: $dbpushLog"

# Run pgloader to migrate data
$dbUrlEsc = $dbUrl
Write-Log ("Running pgloader to import /data/dev.db -> {0}@{1}:{2}/{3}" -f $RemoteUser, $RemoteHost, $RemotePort, $RemoteDb)
Write-Log ("Running pgloader to import /data/dev.db -> {0}" -f $dbUrlEsc)

# Ensure _prisma_migrations exists with a proper DEFAULT (CURRENT_TIMESTAMP) to avoid pgloader creating a bad quoted default
Write-Log "Ensuring _prisma_migrations table exists with correct defaults..."
$createPrismaMigrationsCmd = "CREATE TABLE IF NOT EXISTS _prisma_migrations (id text, checksum text, finished_at timestamptz, migration_name text, logs text, rolled_back_at timestamptz, started_at timestamptz DEFAULT CURRENT_TIMESTAMP, applied_steps_count integer DEFAULT 0);"
$ensureArgs = @(
  'run','--rm',
  '-e', "PGPASSWORD=$RemotePass",
  'postgres:15','psql','-h',$RemoteHost,'-p',$RemotePort,'-U',$RemoteUser,'-d',$RemoteDb,'-c',$createPrismaMigrationsCmd
)
Start-Process -FilePath 'docker' -ArgumentList $ensureArgs -NoNewWindow -Wait -RedirectStandardOutput $dbpushLog -RedirectStandardError $dbpushLogErr
$pgArgs = @(
  'run','--rm',
  '-v', "${PrismaFolder}\prisma:/data",
  $PgloaderImage,
  'pgloader','--verbose','/data/dev.db', $dbUrl
)
Write-Log "Executing: docker $($pgArgs -join ' ')"
Start-Process -FilePath 'docker' -ArgumentList $pgArgs -NoNewWindow -Wait -RedirectStandardOutput $pgloaderLog -RedirectStandardError $pgloaderLogErr
Write-Log "If pgloader still fails due to _prisma_migrations, running an alternative pgloader run that excludes that table..."

# Create a pgloader load file that excludes the problematic _prisma_migrations table
$loadFilePath = Join-Path ($PrismaFolder + '\prisma') 'pgloader_exclude_migrations.load'
$loadFileContent = @"
LOAD DATABASE
  FROM sqlite:///data/dev.db
  INTO $dbUrl

  WITH include drop, create tables, create indexes, reset sequences

  EXCLUDING TABLE NAMES LIKE '_prisma_migrations';

"@

Set-Content -Path $loadFilePath -Value $loadFileContent -Force
Write-Log "Wrote pgloader loadfile: $loadFilePath"

$pgArgs2 = @(
  'run','--rm',
  '-v', "${PrismaFolder}\prisma:/data",
  $PgloaderImage,
  'pgloader','--verbose', "/data/$(Split-Path -Leaf $loadFilePath)"
)
Write-Log "Executing alternative: docker $($pgArgs2 -join ' ')"
Start-Process -FilePath 'docker' -ArgumentList $pgArgs2 -NoNewWindow -Wait -RedirectStandardOutput $pgloaderLog -RedirectStandardError $pgloaderLogErr
Write-Log "Alternative pgloader finished; log: $pgloaderLog"
Write-Log "pgloader finished; log: $pgloaderLog"

# Quick validation: list public tables and count orders
Write-Log "Listing tables on remote DB (public schema)..."
$listArgs = @(
  'run','--rm',
  '-e', "PGPASSWORD=$RemotePass",
  'postgres:15','psql','-h',$RemoteHost,'-p',$RemotePort,'-U',$RemoteUser,'-d',$RemoteDb,'-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
)
Start-Process -FilePath 'docker' -ArgumentList $listArgs -NoNewWindow -Wait -RedirectStandardOutput $dbpushLog -RedirectStandardError $dbpushLogErr

Write-Log "Counting orders (if table exists)..."
$countArgs = @(
  'run','--rm',
  '-e', "PGPASSWORD=$RemotePass",
  'postgres:15','psql','-h',$RemoteHost,'-p',$RemotePort,'-U',$RemoteUser,'-d',$RemoteDb,'-c',"SELECT count(*) FROM orders;"
)
Start-Process -FilePath 'docker' -ArgumentList $countArgs -NoNewWindow -Wait -RedirectStandardOutput $dbpushLog -RedirectStandardError $dbpushLogErr

Write-Log "Done. Check logs: $dbpushLog and $pgloaderLog"

# Print last 200 lines of pgloader log
Write-Log "Last lines of pgloader log:"
Get-Content $pgloaderLog -Tail 200 | ForEach-Object { Write-Host $_ }

Write-Log "Migration script finished." 