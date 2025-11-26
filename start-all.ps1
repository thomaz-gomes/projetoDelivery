<# Minimal start-all launcher (single, clean copy)

Usage: From the project root run:
  .\start-all.ps1

This file is intentionally minimal and ASCII-only to avoid parsing/encoding issues.
#>

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Ensure `.print-agent-token` exists and read it
$tokenFile = Join-Path $root '.print-agent-token'
if (-not (Test-Path $tokenFile)) { [System.IO.File]::WriteAllText($tokenFile, [guid]::NewGuid().ToString('N')) }
$token = [System.IO.File]::ReadAllText($tokenFile).Trim()
Write-Host ('PRINT_AGENT_TOKEN: {0}' -f $token)

# Prompt for companyId once (optional dev convenience)
$companyFile = Join-Path $root '.print-agent-company'
if (-not (Test-Path $companyFile)) {
  try {
    $companyId = Read-Host 'Enter the companyId (GUID) to bind the agent token to (leave empty to let server pick first company)'
    if ($companyId -and $companyId.Trim() -ne '') {
      $companyId = $companyId.Trim()
      # normalize 32-hex to hyphenated form
      if ($companyId -match '^[0-9a-fA-F]{32}$') {
        $companyId = $companyId -replace '([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})', '$1-$2-$3-$4-$5'
      }
      if ($companyId -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        try { [System.IO.File]::WriteAllText($companyFile, $companyId); Write-Host ("Saved companyId to {0}" -f $companyFile) -ForegroundColor Green } catch { Write-Host ("Failed to save companyId: {0}" -f $_) -ForegroundColor Yellow }
      } else {
        Write-Host 'Invalid companyId format — skipping. Backend will use first company.' -ForegroundColor Yellow
      }
    } else {
      Write-Host 'No companyId provided — backend will use the first company in DB by default.' -ForegroundColor Yellow
    }
  } catch {
    Write-Host 'Input cancelled or not available; skipping companyId prompt.' -ForegroundColor Yellow
  }
} else { Write-Host ("Using existing {0}" -f $companyFile) -ForegroundColor Green }

function Spawn-Service {
    param([string]$Name, [string]$WorkDir, [string]$ChildCommand)
    $child = "`$env:PRINT_AGENT_TOKEN='$token'; Set-Location -LiteralPath '$WorkDir'; $ChildCommand"
    Start-Process -FilePath powershell -ArgumentList '-NoExit','-Command',$child | Out-Null
    Write-Host ("Started {0}" -f $Name)
}

# Start backend if present
$backendDir = Join-Path $root 'delivery-saas-backend'
if (Test-Path $backendDir) { Spawn-Service 'Backend' $backendDir "if (Test-Path package.json) { npm run dev } else { node index.js }" } else { Write-Host 'Backend folder not found' }

# Start print agent if present
$agentDir = Join-Path $root 'delivery-print-agent'
if (Test-Path $agentDir) { Spawn-Service 'Print Agent' $agentDir 'node index.js' } else { Write-Host 'Print agent folder not found' }

# Start frontend if present
$frontendDir = Join-Path $root 'delivery-saas-frontend'
if (Test-Path $frontendDir) { Spawn-Service 'Frontend' $frontendDir "if (Test-Path package.json) { npm run dev }" } else { Write-Host 'Frontend folder not found' }

Write-Host 'Done.'

