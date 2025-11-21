<#
check_binaries.ps1

Verificações úteis para desenvolvimento em Windows:
- confirma caminhos para xmllint e openssl conforme `config.json`
- executa `--version`/`version` para verificar execução
- procura arquivos .pfx no `certsDir` configurado e (se `certPassword` estiver presente)
  tenta inspecionar cada PFX com OpenSSL em modo não-interativo

Uso:
  Abra PowerShell no diretório do módulo ou execute com caminho absoluto.

Exemplo:
  cd c:\Users\gomes\projetoDelivery\delivery-saas-backend\nfe-module
  .\scripts\check_binaries.ps1
#>

Set-StrictMode -Version Latest

function Resolve-PathMaybeRelative($baseDir, $p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return $null }
    if ([System.IO.Path]::IsPathRooted($p)) { return $p }
    return Join-Path $baseDir $p
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$moduleDir = Resolve-Path (Join-Path $scriptDir '..') | Select-Object -ExpandProperty Path
$configPath = Join-Path $moduleDir 'config.json'

if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found at $configPath. Copy config.sample.json -> config.json and edit first.";
    exit 2
}

try {
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to read/parse config.json: $_"; exit 2
}

Write-Host "Using config.json: $configPath`n"

# resolve tools
# access properties safely in case config.json doesn't define them
$xmllintCfg = if ($cfg.PSObject.Properties.Name -contains 'xmllint') { $cfg.xmllint } else { $null }
$opensslCfg  = if ($cfg.PSObject.Properties.Name -contains 'openssl')  { $cfg.openssl }  else { $null }

$xmllintPath = Resolve-PathMaybeRelative $moduleDir $xmllintCfg
$opensslPath = Resolve-PathMaybeRelative $moduleDir $opensslCfg

if (-not $xmllintPath) { $xmllintPath = 'xmllint' }
if (-not $opensslPath) { $opensslPath = 'openssl' }

Write-Host "Checking xmllint: $xmllintPath"
try {
    $xmllintOut = & $xmllintPath --version 2>&1
    Write-Host "xmllint: SUCCESS"
    Write-Host $xmllintOut
} catch {
    Write-Warning "xmllint failed to run: $_";
}

Write-Host `n"Checking openssl: $opensslPath"
try {
    $opensslOut = & $opensslPath version 2>&1
    Write-Host "openssl: SUCCESS"
    Write-Host $opensslOut
} catch {
    Write-Warning "openssl failed to run: $_";
}

# Certs check
$certsDirCfg = $cfg.certsDir
if (-not $certsDirCfg) {
    Write-Warning "No certsDir defined in config.json (skipping PFX checks)."
    exit 0
}

$certsDirPath = Resolve-PathMaybeRelative $moduleDir $certsDirCfg
Write-Host `n"Checking certsDir: $certsDirPath"
if (-not (Test-Path $certsDirPath)) {
    Write-Warning "certsDir path does not exist: $certsDirPath"; exit 0
}

$pfxFiles = @(Get-ChildItem -Path $certsDirPath -Filter '*.pfx' -File -ErrorAction SilentlyContinue)
if (-not $pfxFiles -or $pfxFiles.Count -eq 0) {
    Write-Warning "No .pfx files found under $certsDirPath"; exit 0
}

Write-Host "Found $($pfxFiles.Count) .pfx file(s):"
$pfxFiles | ForEach-Object { Write-Host " - $($_.Name)" }

# If we have openssl and a cert password in config, try to inspect each PFX non-interactively
if ($opensslPath -and $cfg.certPassword) {
    Write-Host `n"Attempting to inspect PFX files using OpenSSL (non-interactive)..."
    foreach ($pfx in $pfxFiles) {
        $pfxPath = $pfx.FullName
        Write-Host "\nInspecting: $($pfx.Name)"
        try {
            # use -nokeys to avoid printing private key; pass password from config (note: this is for local dev)
            $opensslArgs = @( 'pkcs12', '-info', '-in', $pfxPath, '-nokeys', '-passin', "pass:$($cfg.certPassword)" )
            $out = & $opensslPath @opensslArgs 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "OpenSSL returned exit code $LASTEXITCODE when inspecting $($pfx.Name)"
                Write-Host $out
            } else {
                Write-Host "OpenSSL inspection OK for $($pfx.Name)"
                # show a short summary: subject/issuer/dates
                $summary = $out -split "\r?\n" | Select-String -Pattern 'subject=|issuer=|Not Before:|Not After :' | Select-Object -First 10
                if ($summary) { $summary | ForEach-Object { Write-Host "  $_" } }
            }
        } catch {
            Write-Warning "Error running OpenSSL on $($pfx.Name): $_"
        }
    }
} else {
    if (-not $cfg.certPassword) { Write-Warning "certPassword not defined in config.json — skipping non-interactive PFX inspection. You can still test manually with OpenSSL." }
    else { Write-Warning "OpenSSL tool not available — cannot inspect PFX files." }
}

Write-Host `n"Checks complete. If xmllint and openssl reported SUCCESS and at least one PFX was inspected OK, your environment is ready for node-sped-nfe tests.";

exit 0
