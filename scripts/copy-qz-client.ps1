param(
  [string]$SourcePath = "E:\Program Files\QZ Tray\demo\js\qz-tray.js",
  [string]$DestPath = "..\delivery-saas-frontend\public\qz-tray.js"
)

Write-Host "Copying QZ Tray client from:`n  $SourcePath`n to`n  $DestPath`n"

if (-Not (Test-Path -Path $SourcePath)) {
  Write-Error "Source file not found: $SourcePath. Please verify QZ Tray is installed and the path is correct."
  exit 1
}

try {
  Copy-Item -Path $SourcePath -Destination $DestPath -Force
  Write-Host "Copied successfully. Restart your frontend dev server and reload the app."
} catch {
  Write-Error "Failed to copy file: $_"
  exit 2
}
