# Headroom (github.com/headroomlabs-ai/headroom) on this computer, for the Web Agent's OpenRouter connection.
# Each model call's messages are compressed here before they go to OpenRouter.
#
#   powershell -ExecutionPolicy Bypass -File tools\headroom\start-headroom.ps1
#
# Then: Web Agent → Settings → Models → your OpenRouter connection → turn Headroom on, Headroom proxy = http://localhost:8787.
# Keep this window open while you use the extension. Nothing leaves this computer from Headroom: its beacon, update
# check and telemetry are off, and it only listens on 127.0.0.1. The OpenRouter key never goes to it.
$ErrorActionPreference = 'Stop'

$venv = Join-Path $env:LOCALAPPDATA 'WebAgent\headroom-venv'
$headroom = Join-Path $venv 'Scripts\headroom.exe'

if (-not (Test-Path $headroom)) {
  Write-Host 'Installing Headroom (first time only, a few minutes)...'
  # Headroom needs Python 3.11 or newer.
  $python = $null
  foreach ($v in '3.13', '3.12', '3.11') {
    & py "-$v" --version *> $null
    if ($LASTEXITCODE -eq 0) { $python = @('py', "-$v"); break }
  }
  if (-not $python) { throw 'Python 3.11 or newer is needed: install it from python.org, then run this again.' }
  & $python[0] $python[1] -m venv $venv
  & (Join-Path $venv 'Scripts\python.exe') -m pip install --quiet --upgrade 'headroom-ai[proxy]'
}

$env:HEADROOM_TELEMETRY = 'off'
$env:HEADROOM_BEACON = 'off'
$env:DO_NOT_TRACK = '1'
$env:HEADROOM_UPDATE_CHECK = 'off'
$env:HEADROOM_NO_CCR = '1'

Write-Host ''
Write-Host 'Headroom proxy: http://localhost:8787'
Write-Host 'In Web Agent -> Settings -> Models -> OpenRouter: turn Headroom on, then put this in Headroom proxy. Keep this window open.'
Write-Host '(The first request after start waits a few seconds while its text model loads.)'
Write-Host ''
& $headroom proxy --host 127.0.0.1 --port 8787 --no-ccr --no-telemetry
