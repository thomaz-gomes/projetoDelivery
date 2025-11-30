<#
PowerShell installer for Delivery Print Agent (Windows)

- Checks Node.js
- Installs dependencies (npm install)
- Copies config.example.env -> .env if not present
- Opens .env for editing
- Optionally installs pm2 globally and starts the agent
#>

function Write-Log($msg) { Write-Host "[installer] $msg" }

Write-Log "Starting installation for Delivery Print Agent"

# 1) Check Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found. Please install Node 18+ from https://nodejs.org/ and re-run this script." -ForegroundColor Red
  exit 1
}

# 2) Install npm deps
Write-Log "Installing npm dependencies..."
Push-Location -Path $PSScriptRoot
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

# 3) Copy env
if (-not (Test-Path .env)) {
  Copy-Item -Path .\config.example.env -Destination .env -Force
  Write-Log "Created .env from config.example.env"
  Write-Host "Please edit the generated .env now to configure BACKEND_SOCKET_URL, STORE_ID and PRINTER_INTERFACE. Press Enter to open."
  Read-Host | Out-Null
  notepad .\.env
} else {
  Write-Log ".env already exists, leaving it unchanged"
}

# 4) Install pm2
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  Write-Log "Installing pm2 globally..."
  npm install -g pm2
  if ($LASTEXITCODE -ne 0) { Write-Host "pm2 install failed" -ForegroundColor Red }
}

# 5) Start service with pm2
Write-Log "Starting agent with pm2"
pm start
pm2 start ecosystem.config.js --only delivery-print-agent
pm2 save

Write-Log "Installation complete. Use 'pm2 logs delivery-print-agent' to watch logs."
Pop-Location
