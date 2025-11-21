<#
fix-prisma-generate.ps1

Automates the common troubleshooting steps for the Windows EPERM error
when running `npx prisma generate`:

1) optionally stop node processes
2) optionally remove temporary .tmp files created by prisma client
3) optionally remove the prisma client folder to force regeneration
4) run `npm install` and `npx prisma generate`

Usage: run in PowerShell (recommended Run as Administrator):
  PS> .\scripts\fix-prisma-generate.ps1

The script prompts before destructive actions. Use with care.
#>

function Prompt-YesNo($message, $default = $false) {
    $yn = Read-Host "$message [y/N]"
    if ([string]::IsNullOrWhiteSpace($yn)) { return $default }
    return $yn.Trim().ToLower().StartsWith('y')
}

Write-Host "== Prisma generate helper =="
Write-Host "This script will help fix EPERM errors by stopping node processes and cleaning prisma client artifacts."

$cwd = Resolve-Path -Path .
Write-Host "Working directory: $cwd`n"

if (-not (Prompt-YesNo "Proceed with the troubleshooting steps?")) {
    Write-Host "Aborted by user."; exit 0
}

# 1) Stop node processes
if (Prompt-YesNo "Step 1: Stop all 'node' processes? This will kill running dev servers (npm run dev)." ) {
    $nodes = Get-Process -Name node -ErrorAction SilentlyContinue
    if ($nodes) {
        Write-Host "Found node processes:"; $nodes | Format-Table Id, ProcessName, StartTime -AutoSize
        if (Prompt-YesNo "Kill these processes now? (force)") {
            $nodes | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Host "Node processes stopped.`n"
        } else { Write-Host "Skipped killing node processes.`n" }
    } else { Write-Host "No node processes found.`n" }
}

# 2) Remove prisma tmp files
$prismaClientTmp = Join-Path -Path $pwd -ChildPath 'node_modules\.prisma\client\query_engine-windows.dll.node.tmp*'
if (Prompt-YesNo "Step 2: Remove prisma .tmp files if present? (safe)") {
    try {
        Get-ChildItem -Path (Join-Path $pwd 'node_modules\.prisma\client') -Filter 'query_engine-windows.dll.node.tmp*' -File -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "Removing tmp file: $($_.FullName)"; Remove-Item -Force -ErrorAction SilentlyContinue $_.FullName
        }
        Write-Host "Tmp files removed (if any).`n"
    } catch {
        Write-Warning "Failed to remove tmp files: $_"
    }
}

# 3) Optionally remove prisma client folder to force regeneration
if (Test-Path (Join-Path $pwd 'node_modules\.prisma\client')) {
    if (Prompt-YesNo "Step 3: Remove 'node_modules/.prisma/client' folder to force regeneration? (recommended if issues persist)") {
        try {
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $pwd 'node_modules\.prisma\client')
            Write-Host "Removed prisma client folder.`n"
        } catch {
            Write-Warning "Failed to remove prisma client folder: $_"
        }
    } else { Write-Host "Skipped removing prisma client folder.`n" }
} else { Write-Host "Prisma client folder not present; skipping step 3.`n" }

# 4) npm install and npx prisma generate
if (Prompt-YesNo "Step 4: Run 'npm install' and 'npx prisma generate' now? (may take a few minutes)") {
    try {
        Write-Host "Running npm install..."
        & npm install
        if ($LASTEXITCODE -ne 0) { Write-Warning "npm install returned code $LASTEXITCODE" }

        Write-Host "Running npx prisma generate..."
        & npx prisma generate
        if ($LASTEXITCODE -ne 0) { Write-Warning "prisma generate returned code $LASTEXITCODE" }
        else { Write-Host "prisma generate completed successfully." }
    } catch {
        Write-Error "Error while running install/generate: $_"
    }
}

Write-Host "Done. If you still see EPERM errors, try running PowerShell as Administrator and/or add an exclusion in Windows Defender for the project folder." 
